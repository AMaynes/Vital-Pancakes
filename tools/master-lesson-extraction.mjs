/**
 * Extracts supported local files page by page. PDF.js is bundled by the site and
 * exposed as globalThis.pdfjsLib before this module is used.
 */

import { pagesFromPlainText } from "./master-lesson-text.mjs?v=2";

export async function extractDocument(file, onProgress = () => {}, signal = null) {
  const extension = file?.name?.split(".").pop()?.toLocaleLowerCase();
  if (!["pdf", "txt", "md"].includes(extension)) {
    throw new TypeError("Choose a text-based PDF, .txt, or .md file.");
  }
  if (signal?.aborted) throw abortError();

  if (extension === "pdf") {
    return extractPdf(file, onProgress, signal);
  }

  onProgress({ completed: 0, total: 1, message: "Reading text" });
  const text = await file.text();
  if (signal?.aborted) throw abortError();
  onProgress({ completed: 1, total: 1, message: "Text extracted" });
  return { fileType: extension, pages: pagesFromPlainText(text), scanned: false };
}

async function extractPdf(file, onProgress, signal) {
  const pdfjs = globalThis.pdfjsLib;
  if (!pdfjs?.getDocument) {
    throw new Error("The bundled PDF reader did not load. Reload the page and try again.");
  }
  pdfjs.GlobalWorkerOptions.workerSrc = "../vendor/pdf.worker.min.js";
  const bytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (signal?.aborted) {
      await loadingTask.destroy();
      throw abortError();
    }
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent({ normalizeWhitespace: false });
    pages.push(pageFromTextItems(pageNumber, content.items));
    onProgress({
      completed: pageNumber,
      total: document.numPages,
      message: `Extracting page ${pageNumber} of ${document.numPages}`,
    });
    page.cleanup();
  }
  await loadingTask.destroy();

  const characterCount = pages.reduce((total, page) => total + page.text.replace(/\s/g, "").length, 0);
  const nearlyEmptyPages = pages.filter((page) => page.text.replace(/\s/g, "").length < 20).length;
  const scanned = characterCount < Math.max(80, document.numPages * 20)
    || nearlyEmptyPages / document.numPages >= 0.8;
  return { fileType: "pdf", pages, scanned };
}

function pageFromTextItems(pageNumber, items) {
  const lines = new Map();
  items.forEach((item) => {
    if (!item?.str?.trim()) return;
    const x = Number(item.transform?.[4] ?? 0);
    const y = Number(item.transform?.[5] ?? 0);
    const height = Math.abs(Number(item.height || item.transform?.[3] || 0));
    const key = Math.round(y / 2) * 2;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ text: item.str.trim(), x, height });
  });

  const orderedLines = [...lines.entries()]
    .sort(([firstY], [secondY]) => secondY - firstY)
    .map(([, lineItems]) => {
      const sorted = lineItems.sort((a, b) => a.x - b.x);
      return {
        text: sorted.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
        height: sorted.reduce((sum, item) => sum + item.height, 0) / sorted.length,
      };
    })
    .filter((line) => line.text);
  const bodyHeight = median(orderedLines.map((line) => line.height).filter((height) => height > 0)) || 10;
  const headingHints = orderedLines
    .filter((line) => line.text.length <= 180 && line.height >= bodyHeight * 1.22)
    .map((line) => ({
      text: line.text,
      level: line.height >= bodyHeight * 1.65 ? 1 : 2,
    }));

  return {
    page: pageNumber,
    text: orderedLines.map((line) => line.text).join("\n"),
    headingHints,
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function abortError() {
  return new DOMException("Document processing was cancelled.", "AbortError");
}
