/**
 * Overview & Purpose
 * Loads PDFs or embedded webpages, manages normalized highlights and attached
 * comments, persists annotations locally, and exports annotated PNG/PDF records.
 *
 * Architectural Relationships
 * Called by: literature-analyzer.html.
 * Calls: Bundled PDF.js, PDF-Lib, browser canvas, iframe, and localStorage APIs.
 *
 * External Resources
 * ../vendor/pdf.min.js, ../vendor/pdf.worker.min.js, ../vendor/pdf-lib.min.js,
 * and literature-analyzer-model.mjs.
 *
 * Notes
 * PDF bytes never leave the browser. Cross-origin browser security prevents
 * client code from copying pixels out of an embedded third-party webpage, so
 * webpage exports preserve the URL, highlight map, and comments instead.
 */

import { createId } from "../app/store.js";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  getPdfHighlightBounds,
  normalizeHighlight,
  sanitizeAnnotations,
} from "./literature-analyzer-model.mjs";

const { PDFDocument, StandardFonts, rgb } = globalThis.PDFLib;
globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = "../vendor/pdf.worker.min.js";

const STORAGE_KEY = "pinakes-vitae-literature-analyzer-v1";
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_SAVED_SOURCES = 50;

const fileInput = document.querySelector("#analysis-pdf-file");
const pdfDropZone = document.querySelector("#analysis-pdf-drop-zone");
const websiteForm = document.querySelector("#website-source-form");
const websiteInput = document.querySelector("#website-url");
const webFrame = document.querySelector("#analyzer-web-frame");
const openWebSource = document.querySelector("#open-web-source");
const emptyState = document.querySelector("#analyzer-empty");
const pdfStage = document.querySelector("#analyzer-pdf-stage");
const webStage = document.querySelector("#analyzer-web-stage");
const pdfCanvas = document.querySelector("#analyzer-pdf-canvas");
const pdfContext = pdfCanvas.getContext("2d");
const pdfHighlightLayer = document.querySelector("#pdf-highlight-layer");
const webHighlightLayer = document.querySelector("#web-highlight-layer");
const commentPanel = document.querySelector("#analyzer-comment-panel");
const commentInput = document.querySelector("#highlight-comment");
const deleteHighlightButton = document.querySelector("#delete-highlight");
const annotationList = document.querySelector("#annotation-list");
const highlightCount = document.querySelector("#highlight-count");
const clearButton = document.querySelector("#clear-highlights");
const exportPngButton = document.querySelector("#export-analysis-png");
const exportPdfButton = document.querySelector("#export-analysis-pdf");
const previousPageButton = document.querySelector("#analysis-previous-page");
const nextPageButton = document.querySelector("#analysis-next-page");
const pageCount = document.querySelector("#analysis-page-count");
const sourceName = document.querySelector("#analysis-source-name");
const status = document.querySelector("#analyzer-status");

let source = null;
let pdfBytes = null;
let pdfDocument = null;
let currentPageNumber = 1;
let annotations = [];
let selectedAnnotationId = null;
let activeColor = DEFAULT_HIGHLIGHT_COLOR;
let isHighlightMode = true;
let activeDraft = null;
let renderSequence = 0;

/**
 * Loads and renders a local PDF while restoring any saved annotations for the
 * same file identity.
 *
 * @param {File} file PDF selected or dropped by the user.
 */
async function loadPdf(file) {
  if (!file || !file.name.toLocaleLowerCase().endsWith(".pdf")) {
    window.alert("Please choose a PDF file.");
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    window.alert("Please choose a PDF smaller than 100 MB.");
    return;
  }

  try {
    setStatus("Loading PDF…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadedDocument = await globalThis.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    pdfBytes = bytes;
    pdfDocument = loadedDocument;
    currentPageNumber = 1;
    source = {
      type: "pdf",
      key: `pdf:${file.name}:${file.size}:${file.lastModified}`,
      name: file.name,
      url: "",
    };
    annotations = restoreAnnotations(source.key);
    selectedAnnotationId = null;
    showSource("pdf");
    await renderPdfPage();
    setStatus(`${file.name} · kept local`);
  } catch (error) {
    console.error("Unable to open the selected PDF.", error);
    setStatus("Could not open PDF");
    window.alert("This PDF could not be opened. Password-protected or damaged PDFs may not be supported.");
  }
}

/**
 * Validates and opens a website inside the constrained reading frame.
 *
 * @param {string} value User-entered URL.
 */
function loadWebsite(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    window.alert("Enter a complete website URL beginning with http:// or https://.");
    return;
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    window.alert("Only http:// and https:// website addresses can be opened.");
    return;
  }

  source = {
    type: "web",
    key: `url:${url.href}`,
    name: url.hostname,
    url: url.href,
  };
  pdfBytes = null;
  pdfDocument = null;
  currentPageNumber = 1;
  annotations = restoreAnnotations(source.key);
  selectedAnnotationId = null;
  webFrame.src = url.href;
  openWebSource.href = url.href;
  showSource("web");
  renderAnnotations();
  setStatus("Loading webpage…");
}

/**
 * Switches the viewer between its empty, PDF, and webpage surfaces.
 *
 * @param {"pdf"|"web"} sourceType Active source type.
 */
function showSource(sourceType) {
  emptyState.hidden = true;
  pdfStage.hidden = sourceType !== "pdf";
  webStage.hidden = sourceType !== "web";
  openWebSource.hidden = sourceType !== "web";
  updateControls();
}

/**
 * Renders the active PDF page at a readable scale before rebuilding highlights.
 */
async function renderPdfPage() {
  if (!pdfDocument) return;
  const sequence = ++renderSequence;
  const page = await pdfDocument.getPage(currentPageNumber);
  const viewport = page.getViewport({ scale: 1.35 });
  const pixelRatio = window.devicePixelRatio || 1;

  pdfCanvas.width = Math.floor(viewport.width * pixelRatio);
  pdfCanvas.height = Math.floor(viewport.height * pixelRatio);
  pdfCanvas.style.width = `${Math.floor(viewport.width)}px`;
  pdfCanvas.style.height = `${Math.floor(viewport.height)}px`;
  pdfStage.style.width = `${Math.floor(viewport.width)}px`;
  pdfStage.style.height = `${Math.floor(viewport.height)}px`;

  await page.render({
    canvasContext: pdfContext,
    viewport,
    transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  }).promise;
  if (sequence !== renderSequence) return;
  renderAnnotations();
  updateControls();
}

/**
 * Rebuilds highlights on the active source and the sidebar index.
 */
function renderAnnotations() {
  const layer = getActiveLayer();
  if (layer) {
    layer.replaceChildren();
    getVisibleAnnotations().forEach((annotation) => {
      const mark = document.createElement("button");
      const index = annotations.indexOf(annotation) + 1;
      mark.type = "button";
      mark.className = "highlight-mark";
      mark.dataset.annotationId = annotation.id;
      mark.setAttribute("aria-label", `Highlight ${index}${annotation.comment ? `: ${annotation.comment}` : ""}`);
      applyNormalizedRectangle(mark, annotation);
      applyHighlightColor(mark, annotation.color);
      mark.classList.toggle("is-selected", annotation.id === selectedAnnotationId);
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        selectAnnotation(annotation.id);
      });

      const badge = document.createElement("span");
      badge.className = "highlight-badge";
      badge.textContent = String(index);
      mark.append(badge);
      layer.append(mark);
    });
  }
  renderAnnotationIndex();
  renderSelectedAnnotation();
  updateControls();
}

/**
 * Returns annotations visible on the active PDF page or webpage frame.
 *
 * @returns {Array<object>} Visible highlights.
 */
function getVisibleAnnotations() {
  if (source?.type === "pdf") {
    return annotations.filter((annotation) => annotation.pageNumber === currentPageNumber);
  }
  return annotations;
}

/**
 * Rebuilds the ordered highlight/comment index for the complete source.
 */
function renderAnnotationIndex() {
  highlightCount.textContent = String(annotations.length);
  if (!annotations.length) {
    const empty = document.createElement("p");
    empty.className = "annotation-empty";
    empty.textContent = "Highlights and comments will be indexed here.";
    annotationList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  annotations.forEach((annotation, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "annotation-list-button";
    button.dataset.annotationId = annotation.id;
    button.style.setProperty("--annotation-color", annotation.color);
    button.classList.toggle("is-selected", annotation.id === selectedAnnotationId);

    const number = document.createElement("span");
    number.className = "annotation-list-number";
    number.textContent = String(index + 1);
    const copy = document.createElement("span");
    copy.className = "annotation-list-copy";
    const location = document.createElement("strong");
    location.textContent = source?.type === "pdf" ? `Page ${annotation.pageNumber}` : "Visible webpage";
    const comment = document.createElement("span");
    comment.className = "annotation-list-comment";
    comment.textContent = annotation.comment || "No comment yet";
    copy.append(location, comment);
    button.append(number, copy);
    button.addEventListener("click", () => navigateToAnnotation(annotation.id));
    fragment.append(button);
  });
  annotationList.replaceChildren(fragment);
}

/**
 * Shows the selected highlight's comment editor.
 */
function renderSelectedAnnotation() {
  const selected = getSelectedAnnotation();
  commentPanel.hidden = !selected;
  if (!selected) {
    commentInput.value = "";
    return;
  }
  if (commentInput.value !== selected.comment) {
    commentInput.value = selected.comment;
  }
}

/**
 * Navigates to a highlight's PDF page, then selects it.
 *
 * @param {string} annotationId Highlight identifier.
 */
async function navigateToAnnotation(annotationId) {
  const annotation = annotations.find((candidate) => candidate.id === annotationId);
  if (!annotation) return;
  if (source?.type === "pdf" && annotation.pageNumber !== currentPageNumber) {
    currentPageNumber = annotation.pageNumber;
    selectedAnnotationId = annotationId;
    await renderPdfPage();
    return;
  }
  selectAnnotation(annotationId);
}

/**
 * Selects one highlight and optionally focuses its comment field.
 *
 * @param {string|null} annotationId Highlight identifier.
 * @param {boolean} focusComment Whether to move focus into the comment editor.
 */
function selectAnnotation(annotationId, focusComment = false) {
  selectedAnnotationId = annotationId;
  renderAnnotations();
  if (focusComment && annotationId) {
    window.requestAnimationFrame(() => commentInput.focus());
  }
}

/**
 * Starts a highlight rectangle on an active annotation surface.
 *
 * @param {PointerEvent} event Pointer-down event.
 */
function startHighlight(event) {
  if (!source || !isHighlightMode || event.target !== event.currentTarget) return;
  event.preventDefault();
  const layer = event.currentTarget;
  layer.setPointerCapture(event.pointerId);
  const draftElement = document.createElement("span");
  draftElement.className = "highlight-mark is-draft";
  applyHighlightColor(draftElement, activeColor);
  layer.append(draftElement);
  activeDraft = {
    layer,
    pointerId: event.pointerId,
    start: { x: event.clientX, y: event.clientY },
    element: draftElement,
  };
}

/**
 * Updates the temporary highlight while the pointer moves.
 *
 * @param {PointerEvent} event Pointer-move event.
 */
function moveHighlight(event) {
  if (!activeDraft || event.pointerId !== activeDraft.pointerId) return;
  const rectangle = normalizeHighlight(
    activeDraft.start,
    { x: event.clientX, y: event.clientY },
    activeDraft.layer.getBoundingClientRect(),
    1,
  );
  if (rectangle) applyNormalizedRectangle(activeDraft.element, rectangle);
}

/**
 * Commits a completed highlight drag or discards an accidental click.
 *
 * @param {PointerEvent} event Pointer-up or cancellation event.
 */
function endHighlight(event) {
  if (!activeDraft || event.pointerId !== activeDraft.pointerId) return;
  const draft = activeDraft;
  activeDraft = null;
  draft.element.remove();
  if (event.type === "pointercancel") return;

  const rectangle = normalizeHighlight(
    draft.start,
    { x: event.clientX, y: event.clientY },
    draft.layer.getBoundingClientRect(),
  );
  if (!rectangle) return;
  const annotation = {
    id: createId(),
    pageNumber: source.type === "pdf" ? currentPageNumber : 1,
    ...rectangle,
    color: activeColor,
    comment: "",
    createdAt: new Date().toISOString(),
  };
  annotations.push(annotation);
  selectedAnnotationId = annotation.id;
  persistAnnotations();
  renderAnnotations();
  window.requestAnimationFrame(() => commentInput.focus());
}

/**
 * Applies normalized geometry to a positioned highlight element.
 *
 * @param {HTMLElement} element Highlight element.
 * @param {{x: number, y: number, width: number, height: number}} rectangle Geometry.
 */
function applyNormalizedRectangle(element, rectangle) {
  element.style.left = `${rectangle.x * 100}%`;
  element.style.top = `${rectangle.y * 100}%`;
  element.style.width = `${rectangle.width * 100}%`;
  element.style.height = `${rectangle.height * 100}%`;
}

/**
 * Applies translucent highlight colors while preserving an opaque outline.
 *
 * @param {HTMLElement} element Highlight element.
 * @param {string} color Hex color.
 */
function applyHighlightColor(element, color) {
  element.style.setProperty("--highlight-stroke", color);
  element.style.setProperty("--highlight-fill", hexToRgba(color, 0.38));
}

/**
 * Changes browse/highlight interaction without interfering with existing marks.
 *
 * @param {"browse"|"highlight"} mode Requested interaction mode.
 */
function setMode(mode) {
  isHighlightMode = mode === "highlight";
  document.querySelectorAll("[data-analyzer-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.analyzerMode === mode);
  });
  [pdfHighlightLayer, webHighlightLayer].forEach((layer) => {
    layer.classList.toggle("is-drawing-mode", isHighlightMode);
  });
}

/**
 * Returns the active annotation layer.
 *
 * @returns {HTMLElement|null} PDF or website layer.
 */
function getActiveLayer() {
  if (source?.type === "pdf") return pdfHighlightLayer;
  if (source?.type === "web") return webHighlightLayer;
  return null;
}

function getSelectedAnnotation() {
  return annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;
}

/**
 * Restores validated annotations for one source identity.
 *
 * @param {string} sourceKey Source identity.
 * @returns {Array<object>} Restored highlights.
 */
function restoreAnnotations(sourceKey) {
  try {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return sanitizeAnnotations(state.sources?.[sourceKey]?.annotations);
  } catch (error) {
    console.error("Unable to restore saved literature annotations.", error);
    return [];
  }
}

/**
 * Persists the current source's annotations and caps inactive source history.
 */
function persistAnnotations() {
  if (!source) return;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const state = parsed && typeof parsed === "object" ? parsed : {};
    const sources = state.sources && typeof state.sources === "object" ? state.sources : {};
    sources[source.key] = {
      type: source.type,
      name: source.name,
      url: source.url,
      annotations,
      updatedAt: new Date().toISOString(),
    };

    const trimmedSources = Object.fromEntries(
      Object.entries(sources)
        .sort(([, left], [, right]) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
        .slice(0, MAX_SAVED_SOURCES),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sources: trimmedSources }));
    setStatus(`${source.name} · annotations saved`);
  } catch (error) {
    console.error("Unable to save literature annotations.", error);
    setStatus("Annotations could not be saved");
  }
}

/**
 * Downloads the active PDF page or website annotation map as a PNG.
 */
async function exportPng() {
  if (!source) return;
  try {
    exportPngButton.disabled = true;
    exportPngButton.textContent = "Preparing…";
    const outputCanvas = source.type === "pdf"
      ? createPdfPageExportCanvas()
      : createWebAnnotationExportCanvas();
    const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The browser could not create the PNG.");
    const suffix = source.type === "pdf" ? `-page-${currentPageNumber}` : "-web";
    downloadBlob(blob, `${safeBaseName(source.name)}${suffix}-annotated.png`);
    setStatus(source.type === "pdf" ? "Annotated PNG downloaded" : "Web annotation map downloaded");
  } catch (error) {
    console.error("Unable to export the annotated PNG.", error);
    window.alert("The annotated PNG could not be created.");
  } finally {
    exportPngButton.textContent = "Export PNG";
    updateControls();
  }
}

/**
 * Creates a PNG-ready canvas containing the current PDF page, marks, and
 * comment index.
 *
 * @returns {HTMLCanvasElement} Composed canvas.
 */
function createPdfPageExportCanvas() {
  const pageAnnotations = getVisibleAnnotations();
  const baseWidth = pdfCanvas.width;
  const baseHeight = pdfCanvas.height;
  const output = createCanvasWithCommentColumn(baseWidth, baseHeight, pageAnnotations);
  const context = output.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, baseWidth, baseHeight);
  context.drawImage(pdfCanvas, 0, 0);
  drawCanvasHighlights(context, pageAnnotations, { x: 0, y: 0, width: baseWidth, height: baseHeight });
  drawCanvasComments(context, pageAnnotations, baseWidth, output.width - baseWidth, output.height);
  return output;
}

/**
 * Creates a browser-safe webpage annotation map. The live frame's URL and
 * comments are retained, but cross-origin page pixels are intentionally absent.
 *
 * @returns {HTMLCanvasElement} Composed canvas.
 */
function createWebAnnotationExportCanvas() {
  const baseWidth = 1200;
  const baseHeight = 800;
  const output = createCanvasWithCommentColumn(baseWidth, baseHeight, annotations);
  const context = output.getContext("2d");
  context.fillStyle = "#f1eee6";
  context.fillRect(0, 0, baseWidth, baseHeight);
  context.fillStyle = "#171613";
  context.font = "600 34px Georgia";
  context.fillText("Annotated webpage", 42, 55);
  context.font = "18px sans-serif";
  context.fillStyle = "#5a554c";
  drawWrappedCanvasText(context, source.url, 42, 90, baseWidth - 84, 25);

  const mapBounds = { x: 42, y: 135, width: baseWidth - 84, height: baseHeight - 177 };
  context.fillStyle = "#fbfaf6";
  context.fillRect(mapBounds.x, mapBounds.y, mapBounds.width, mapBounds.height);
  context.strokeStyle = "#81796d";
  context.lineWidth = 2;
  context.strokeRect(mapBounds.x, mapBounds.y, mapBounds.width, mapBounds.height);
  context.fillStyle = "#81796d";
  context.font = "16px sans-serif";
  context.textAlign = "center";
  context.fillText("Highlight map of the visible webpage frame", baseWidth / 2, mapBounds.y + 32);
  context.textAlign = "left";
  drawCanvasHighlights(context, annotations, mapBounds);
  drawCanvasComments(context, annotations, baseWidth, output.width - baseWidth, output.height);
  return output;
}

/**
 * Exports highlights into the original PDF or creates a webpage analysis PDF.
 */
async function exportPdf() {
  if (!source) return;
  try {
    exportPdfButton.disabled = true;
    exportPdfButton.textContent = "Preparing…";
    const outputDocument = source.type === "pdf"
      ? await createAnnotatedPdf()
      : await createWebAnnotationPdf();
    const outputBytes = await outputDocument.save();
    downloadBlob(
      new Blob([outputBytes], { type: "application/pdf" }),
      `${safeBaseName(source.name)}-annotated.pdf`,
    );
    setStatus(source.type === "pdf" ? "Annotated PDF downloaded" : "Web analysis PDF downloaded");
  } catch (error) {
    console.error("Unable to export the annotated PDF.", error);
    window.alert("The annotated PDF could not be created. The source has not been changed.");
  } finally {
    exportPdfButton.textContent = "Export PDF";
    updateControls();
  }
}

/**
 * Draws every highlight into a copy of the source PDF and appends comments.
 *
 * @returns {Promise<PDFDocument>} Annotated PDF-Lib document.
 */
async function createAnnotatedPdf() {
  const outputDocument = await PDFDocument.load(pdfBytes.slice());
  const pages = outputDocument.getPages();
  const regularFont = await outputDocument.embedFont(StandardFonts.Helvetica);
  const boldFont = await outputDocument.embedFont(StandardFonts.HelveticaBold);

  annotations.forEach((annotation, index) => {
    const page = pages[annotation.pageNumber - 1];
    if (!page) return;
    const bounds = getPdfHighlightBounds(annotation, page.getWidth(), page.getHeight());
    const color = hexToRgb(annotation.color);
    page.drawRectangle({
      ...bounds,
      color: rgb(color.r, color.g, color.b),
      borderColor: rgb(color.r * 0.65, color.g * 0.65, color.b * 0.65),
      borderWidth: 0.7,
      opacity: 0.32,
      borderOpacity: 0.75,
    });
    drawPdfMarker(page, index + 1, bounds, boldFont);
  });

  appendCommentPages(outputDocument, regularFont, boldFont, source.name);
  return outputDocument;
}

/**
 * Builds a standalone PDF record for a webpage URL, its highlight map, and
 * attached comments.
 *
 * @returns {Promise<PDFDocument>} Web analysis document.
 */
async function createWebAnnotationPdf() {
  const outputDocument = await PDFDocument.create();
  const regularFont = await outputDocument.embedFont(StandardFonts.Helvetica);
  const boldFont = await outputDocument.embedFont(StandardFonts.HelveticaBold);
  const page = outputDocument.addPage([612, 792]);
  page.drawText("Annotated webpage", {
    x: 45,
    y: 738,
    size: 22,
    font: boldFont,
    color: rgb(0.09, 0.08, 0.07),
  });
  const urlLines = wrapPdfText(toPdfSafeText(source.url), regularFont, 9, 522);
  urlLines.slice(0, 4).forEach((line, index) => {
    page.drawText(line, {
      x: 45,
      y: 714 - (index * 13),
      size: 9,
      font: regularFont,
      color: rgb(0.35, 0.33, 0.3),
    });
  });

  const map = { x: 45, y: 310, width: 522, height: 350 };
  page.drawRectangle({
    ...map,
    color: rgb(0.98, 0.97, 0.94),
    borderColor: rgb(0.5, 0.47, 0.43),
    borderWidth: 1,
  });
  page.drawText("Highlight map of the visible webpage frame", {
    x: 168,
    y: 640,
    size: 9,
    font: regularFont,
    color: rgb(0.45, 0.42, 0.38),
  });
  annotations.forEach((annotation, index) => {
    const color = hexToRgb(annotation.color);
    const bounds = {
      x: map.x + (annotation.x * map.width),
      y: map.y + map.height - ((annotation.y + annotation.height) * map.height),
      width: annotation.width * map.width,
      height: annotation.height * map.height,
    };
    page.drawRectangle({
      ...bounds,
      color: rgb(color.r, color.g, color.b),
      borderColor: rgb(color.r * 0.65, color.g * 0.65, color.b * 0.65),
      borderWidth: 0.6,
      opacity: 0.35,
    });
    drawPdfMarker(page, index + 1, bounds, boldFont);
  });
  page.drawText("Webpage pixels are protected by browser cross-origin security; this file preserves the source URL and annotation map.", {
    x: 45,
    y: 288,
    size: 7,
    font: regularFont,
    color: rgb(0.45, 0.42, 0.38),
  });
  appendCommentPages(outputDocument, regularFont, boldFont, source.url);
  return outputDocument;
}

/**
 * Adds numbered comment appendix pages when at least one highlight has text.
 *
 * @param {PDFDocument} document PDF-Lib document.
 * @param {object} regularFont Embedded font.
 * @param {object} boldFont Embedded bold font.
 * @param {string} sourceTitle Source name or URL.
 */
function appendCommentPages(document, regularFont, boldFont, sourceTitle) {
  const commentedAnnotations = annotations
    .map((annotation, index) => ({ annotation, number: index + 1 }))
    .filter(({ annotation }) => annotation.comment.trim());
  if (!commentedAnnotations.length) return;

  let page = null;
  let y = 0;
  const startPage = () => {
    page = document.addPage([612, 792]);
    page.drawText("Highlight comments", {
      x: 45,
      y: 742,
      size: 20,
      font: boldFont,
      color: rgb(0.09, 0.08, 0.07),
    });
    const sourceLines = wrapPdfText(toPdfSafeText(sourceTitle), regularFont, 8, 522);
    sourceLines.slice(0, 2).forEach((line, index) => {
      page.drawText(line, {
        x: 45,
        y: 720 - (index * 11),
        size: 8,
        font: regularFont,
        color: rgb(0.42, 0.39, 0.35),
      });
    });
    y = 685;
  };
  startPage();

  commentedAnnotations.forEach(({ annotation, number }) => {
    const lines = wrapPdfText(toPdfSafeText(annotation.comment), regularFont, 10, 490);
    if (y < 95) startPage();
    const color = hexToRgb(annotation.color);
    page.drawRectangle({
      x: 45,
      y: y - 2,
      width: 18,
      height: 18,
      color: rgb(color.r, color.g, color.b),
      borderColor: rgb(0.2, 0.18, 0.16),
      borderWidth: 0.5,
      opacity: 0.75,
    });
    page.drawText(String(number), {
      x: 50,
      y: y + 3,
      size: 8,
      font: boldFont,
      color: rgb(0.09, 0.08, 0.07),
    });
    const location = source?.type === "pdf" ? `Page ${annotation.pageNumber}` : "Visible webpage";
    page.drawText(location, {
      x: 72,
      y: y + 3,
      size: 10,
      font: boldFont,
      color: rgb(0.09, 0.08, 0.07),
    });
    y -= 20;
    lines.forEach((line) => {
      if (y < 55) {
        startPage();
        page.drawText(`Highlight ${number} continued`, {
          x: 45,
          y,
          size: 10,
          font: boldFont,
          color: rgb(0.09, 0.08, 0.07),
        });
        y -= 20;
      }
      page.drawText(line, {
        x: 72,
        y,
        size: 10,
        font: regularFont,
        color: rgb(0.25, 0.23, 0.21),
      });
      y -= 14;
    });
    y -= 24;
  });
}

function drawPdfMarker(page, number, bounds, font) {
  const x = Math.min(page.getWidth() - 8, bounds.x + bounds.width);
  const y = Math.min(page.getHeight() - 8, bounds.y + bounds.height);
  page.drawCircle({
    x,
    y,
    size: 7,
    color: rgb(0.09, 0.08, 0.07),
    borderColor: rgb(1, 1, 1),
    borderWidth: 0.6,
  });
  page.drawText(String(number), {
    x: x - (number > 9 ? 4.3 : 2.4),
    y: y - 2.5,
    size: number > 99 ? 4.5 : 6,
    font,
    color: rgb(1, 1, 1),
  });
}

function createCanvasWithCommentColumn(baseWidth, baseHeight, sourceAnnotations) {
  const commentedAnnotations = sourceAnnotations.filter((annotation) => annotation.comment.trim());
  const hasComments = commentedAnnotations.length > 0;
  const commentsWidth = hasComments ? Math.max(360, Math.round(baseWidth * 0.38)) : 0;
  const estimatedCommentHeight = hasComments
    ? 95 + commentedAnnotations.reduce(
      (height, annotation) => height + 70 + (Math.ceil(annotation.comment.length / 44) * 18),
      0,
    )
    : 0;
  const canvas = document.createElement("canvas");
  canvas.width = baseWidth + commentsWidth;
  canvas.height = Math.max(baseHeight, estimatedCommentHeight);
  return canvas;
}

function drawCanvasHighlights(context, sourceAnnotations, bounds) {
  sourceAnnotations.forEach((annotation, index) => {
    const x = bounds.x + (annotation.x * bounds.width);
    const y = bounds.y + (annotation.y * bounds.height);
    const width = annotation.width * bounds.width;
    const height = annotation.height * bounds.height;
    context.fillStyle = hexToRgba(annotation.color, 0.38);
    context.fillRect(x, y, width, height);
    context.strokeStyle = annotation.color;
    context.lineWidth = Math.max(1, bounds.width / 900);
    context.strokeRect(x, y, width, height);
    context.fillStyle = "#171613";
    context.beginPath();
    context.arc(x + width, y, Math.max(9, bounds.width / 110), 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fff";
    context.font = `700 ${Math.max(9, bounds.width / 100)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(annotations.indexOf(annotation) + 1 || index + 1), x + width, y);
  });
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

function drawCanvasComments(context, sourceAnnotations, startX, width, height) {
  if (width <= 0) return;
  context.fillStyle = "#f1eee6";
  context.fillRect(startX, 0, width, height);
  context.strokeStyle = "#81796d";
  context.beginPath();
  context.moveTo(startX, 0);
  context.lineTo(startX, height);
  context.stroke();
  const padding = Math.max(24, width * 0.07);
  let y = 48;
  context.fillStyle = "#171613";
  context.font = `600 ${Math.max(20, width * 0.055)}px Georgia`;
  context.fillText("Highlight comments", startX + padding, y);
  y += 38;

  sourceAnnotations.forEach((annotation) => {
    if (!annotation.comment.trim() || y > height - 40) return;
    const index = annotations.indexOf(annotation) + 1;
    context.fillStyle = annotation.color;
    context.fillRect(startX + padding, y - 16, 22, 22);
    context.strokeStyle = "#171613";
    context.strokeRect(startX + padding, y - 16, 22, 22);
    context.fillStyle = "#171613";
    context.font = `700 ${Math.max(11, width * 0.032)}px sans-serif`;
    context.fillText(String(index), startX + padding + 7, y);
    const location = source?.type === "pdf" ? `Page ${annotation.pageNumber}` : "Visible webpage";
    context.fillText(location, startX + padding + 34, y);
    y += 24;
    context.fillStyle = "#5a554c";
    context.font = `${Math.max(11, width * 0.03)}px sans-serif`;
    y = drawWrappedCanvasText(
      context,
      annotation.comment,
      startX + padding + 34,
      y,
      width - (padding * 2) - 34,
      Math.max(17, width * 0.045),
    ) + 22;
  });
}

function drawWrappedCanvasText(context, text, x, y, maximumWidth, lineHeight) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maximumWidth && line) {
      context.fillText(line, x, y);
      y += lineHeight;
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) context.fillText(line, x, y);
  return y;
}

function wrapPdfText(text, font, size, maximumWidth) {
  const lines = [];
  String(text).split(/\r?\n/).forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maximumWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    if (!words.length) lines.push("");
  });
  return lines;
}

function updateControls() {
  const hasSource = Boolean(source);
  const hasPdf = source?.type === "pdf" && Boolean(pdfDocument);
  clearButton.disabled = !annotations.length;
  exportPngButton.disabled = !hasSource;
  exportPdfButton.disabled = !hasSource;
  previousPageButton.disabled = !hasPdf || currentPageNumber <= 1;
  nextPageButton.disabled = !hasPdf || currentPageNumber >= pdfDocument.numPages;
  pageCount.textContent = hasPdf ? `Page ${currentPageNumber} / ${pdfDocument.numPages}` : "Page 0 / 0";
  sourceName.textContent = source?.name || "Choose a PDF or website";
}

function setStatus(message) {
  status.textContent = message;
}

function deleteSelectedHighlight() {
  if (!selectedAnnotationId) return;
  annotations = annotations.filter((annotation) => annotation.id !== selectedAnnotationId);
  selectedAnnotationId = null;
  persistAnnotations();
  renderAnnotations();
}

function clearHighlights() {
  if (!annotations.length) return;
  const confirmed = window.confirm("Clear every highlight and comment for this source?");
  if (!confirmed) return;
  annotations = [];
  selectedAnnotationId = null;
  persistAnnotations();
  renderAnnotations();
}

function downloadBlob(blob, filename) {
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

function safeBaseName(value) {
  return String(value || "analysis")
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "analysis";
}

function hexToRgb(value) {
  const normalized = String(value).replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

function hexToRgba(value, alpha) {
  const color = hexToRgb(value);
  return `rgb(${Math.round(color.r * 255)} ${Math.round(color.g * 255)} ${Math.round(color.b * 255)} / ${alpha})`;
}

function toPdfSafeText(value) {
  return String(value).normalize("NFKD").replace(/[^\x20-\x7E\n]/g, "?");
}

fileInput.addEventListener("change", () => loadPdf(fileInput.files[0]));
["dragenter", "dragover"].forEach((eventName) => {
  pdfDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    pdfDropZone.classList.add("is-over");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  pdfDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    pdfDropZone.classList.remove("is-over");
  });
});
pdfDropZone.addEventListener("drop", (event) => loadPdf(event.dataTransfer.files[0]));

websiteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadWebsite(websiteInput.value.trim());
});
webFrame.addEventListener("load", () => {
  if (source?.type === "web") setStatus(`${source.name} · embedded view loaded`);
});

document.querySelectorAll("[data-analyzer-mode]").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.analyzerMode));
});
document.querySelectorAll("[data-highlight-color]").forEach((button) => {
  button.addEventListener("click", () => {
    activeColor = button.dataset.highlightColor;
    document.querySelectorAll("[data-highlight-color]").forEach((candidate) => {
      const isActive = candidate === button;
      candidate.classList.toggle("is-active", isActive);
      candidate.setAttribute("aria-checked", String(isActive));
    });
    const selected = getSelectedAnnotation();
    if (selected) {
      selected.color = activeColor;
      persistAnnotations();
      renderAnnotations();
    }
  });
});

commentInput.addEventListener("input", () => {
  const selected = getSelectedAnnotation();
  if (!selected) return;
  selected.comment = commentInput.value;
  persistAnnotations();
  const listComment = annotationList.querySelector(
    `[data-annotation-id="${CSS.escape(selected.id)}"] .annotation-list-comment`,
  );
  if (listComment) listComment.textContent = selected.comment || "No comment yet";
});
commentInput.addEventListener("change", renderAnnotations);
deleteHighlightButton.addEventListener("click", deleteSelectedHighlight);
clearButton.addEventListener("click", clearHighlights);
exportPngButton.addEventListener("click", exportPng);
exportPdfButton.addEventListener("click", exportPdf);

previousPageButton.addEventListener("click", async () => {
  if (currentPageNumber <= 1) return;
  currentPageNumber -= 1;
  selectedAnnotationId = null;
  await renderPdfPage();
});
nextPageButton.addEventListener("click", async () => {
  if (!pdfDocument || currentPageNumber >= pdfDocument.numPages) return;
  currentPageNumber += 1;
  selectedAnnotationId = null;
  await renderPdfPage();
});

[pdfHighlightLayer, webHighlightLayer].forEach((layer) => {
  layer.addEventListener("pointerdown", startHighlight);
  layer.addEventListener("pointermove", moveHighlight);
  layer.addEventListener("pointerup", endHighlight);
  layer.addEventListener("pointercancel", endHighlight);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && selectedAnnotationId) {
    selectAnnotation(null);
  }
});

setMode("highlight");
updateControls();
