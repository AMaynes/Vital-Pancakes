/**
 * Overview & Purpose
 * Provides local PDF viewing, page navigation, signature and date placement,
 * and export of a genuine signed PDF with every placed field embedded.
 *
 * Architectural Relationships
 * Called by: pdf-signer.html.
 * Calls: Bundled PDF.js and PDF-Lib browser distributions.
 *
 * External Resources
 * ../vendor/pdf.min.js, ../vendor/pdf.worker.min.js, and ../vendor/pdf-lib.min.js.
 *
 * Notes
 * Loaded PDF bytes never leave the browser. Placement coordinates are normalized
 * against each rendered page so export remains correct across PDF page sizes.
 */

import { createId } from "../app/store.js";

const { PDFDocument } = globalThis.PDFLib;
globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = "../vendor/pdf.worker.min.js";

const fileInput = document.querySelector("#pdf-file");
const dropZone = document.querySelector("#pdf-drop-zone");
const signatureInput = document.querySelector("#signature-name");
const signaturePreview = document.querySelector("#signature-preview");
const addSignatureButton = document.querySelector("#add-signature");
const dateInput = document.querySelector("#signature-date");
const addDateButton = document.querySelector("#add-date");
const downloadButton = document.querySelector("#download-signed-pdf");
const removeButton = document.querySelector("#remove-signature");
const pageStage = document.querySelector("#pdf-page-stage");
const signatureLayer = document.querySelector("#signature-layer");
const pdfCanvas = document.querySelector("#pdf-canvas");
const pdfContext = pdfCanvas.getContext("2d");

let pdfBytes = null;
let pdfDocument = null;
let pdfFileName = "document.pdf";
let currentPageNumber = 1;
let signatureFont = "signature-font-1";
let placements = [];
let selectedPlacementId = null;
let activeDrag = null;
let renderSequence = 0;

const FONT_STYLES = {
  "signature-font-1": '"Snell Roundhand", "Segoe Script", cursive',
  "signature-font-2": '"Brush Script MT", "Bradley Hand", cursive',
  "signature-font-3": '"American Typewriter", Georgia, serif',
  "date-font": 'Georgia, "Times New Roman", serif',
};

/**
 * Loads a user-selected PDF into PDF.js without uploading it.
 *
 * @param {File} file PDF file.
 */
async function loadPdf(file) {
  if (!file || (file.type && file.type !== "application/pdf") || !file.name.toLocaleLowerCase().endsWith(".pdf")) {
    window.alert("Please choose a PDF file.");
    return;
  }

  try {
    setStatus("Loading document…");
    pdfBytes = new Uint8Array(await file.arrayBuffer());
    pdfDocument = await globalThis.pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
    pdfFileName = file.name;
    currentPageNumber = 1;
    placements = [];
    selectedPlacementId = null;
    document.querySelector("#pdf-empty").hidden = true;
    pageStage.hidden = false;
    updateControls();
    await renderPage();
    setStatus(`${file.name} · kept local`);
  } catch (error) {
    console.error("Unable to open the selected PDF.", error);
    setStatus("Could not open PDF");
    window.alert("This PDF could not be opened. Password-protected or damaged PDFs may not be supported.");
  }
}

/**
 * Renders the current page at a comfortable working scale.
 */
async function renderPage() {
  if (!pdfDocument) return;
  const sequence = ++renderSequence;
  const page = await pdfDocument.getPage(currentPageNumber);
  const viewport = page.getViewport({ scale: 1.35 });
  const pixelRatio = window.devicePixelRatio || 1;

  pdfCanvas.width = Math.floor(viewport.width * pixelRatio);
  pdfCanvas.height = Math.floor(viewport.height * pixelRatio);
  pdfCanvas.style.width = `${Math.floor(viewport.width)}px`;
  pdfCanvas.style.height = `${Math.floor(viewport.height)}px`;
  pageStage.style.width = `${Math.floor(viewport.width)}px`;
  pageStage.style.height = `${Math.floor(viewport.height)}px`;

  await page.render({
    canvasContext: pdfContext,
    viewport,
    transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  }).promise;
  if (sequence !== renderSequence) return;
  renderPlacements();
  updateControls();
}

/**
 * Rebuilds draggable signature and date stamps for the current PDF page.
 */
function renderPlacements() {
  signatureLayer.replaceChildren();
  const currentPlacements = placements.filter((placement) => placement.pageNumber === currentPageNumber);
  currentPlacements.forEach((placement) => {
    const stamp = document.createElement("div");
    stamp.className = `signature-stamp ${placement.font} ${placement.kind === "date" ? "date-stamp" : ""}`;
    stamp.dataset.placementId = placement.id;
    stamp.textContent = placement.text;
    stamp.style.left = `${placement.xRatio * 100}%`;
    stamp.style.top = `${placement.yRatio * 100}%`;
    stamp.style.width = `${placement.widthRatio * 100}%`;
    stamp.style.fontSize = `${placement.fontSizeRatio * pageStage.clientWidth}px`;
    stamp.classList.toggle("is-selected", placement.id === selectedPlacementId);

    const resizeHandle = document.createElement("span");
    resizeHandle.className = "signature-resize";
    resizeHandle.title = `Resize ${placement.kind}`;
    stamp.append(resizeHandle);
    signatureLayer.append(stamp);
  });
  removeButton.disabled = !selectedPlacementId;
}

/**
 * Adds a new centered signature placement to the visible page.
 */
function addSignature() {
  if (!pdfDocument || !signatureInput.value.trim()) return;
  const placement = {
    id: createId(),
    kind: "signature",
    pageNumber: currentPageNumber,
    text: signatureInput.value.trim(),
    font: signatureFont,
    xRatio: 0.36,
    yRatio: 0.72,
    widthRatio: 0.28,
    fontSizeRatio: 0.045,
  };
  placements.push(placement);
  selectedPlacementId = placement.id;
  renderPlacements();
  updateControls();
}

/**
 * Adds a formatted date placement to the visible page.
 */
function addDate() {
  if (!pdfDocument || !dateInput.value) return;
  const placement = {
    id: createId(),
    kind: "date",
    pageNumber: currentPageNumber,
    text: formatDateValue(dateInput.value),
    font: "date-font",
    xRatio: 0.68,
    yRatio: 0.78,
    widthRatio: 0.18,
    fontSizeRatio: 0.026,
  };
  placements.push(placement);
  selectedPlacementId = placement.id;
  renderPlacements();
  updateControls();
}

/**
 * Formats a date input value without converting it through UTC.
 *
 * @param {string} value ISO-style date input value.
 * @returns {string} Readable month/day/year date.
 */
function formatDateValue(value) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(year, month - 1, day));
}

/**
 * Returns today's date in the value format required by an HTML date input.
 *
 * @returns {string} Local calendar date as YYYY-MM-DD.
 */
function getTodayInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Starts dragging or resizing a placed signature or date.
 *
 * @param {PointerEvent} event Pointer-down event on the signature layer.
 */
function startPlacementGesture(event) {
  const stamp = event.target.closest(".signature-stamp");
  if (!stamp) {
    selectedPlacementId = null;
    renderPlacements();
    return;
  }
  event.preventDefault();
  const placement = placements.find((candidate) => candidate.id === stamp.dataset.placementId);
  if (!placement) return;
  selectedPlacementId = placement.id;
  stamp.setPointerCapture(event.pointerId);
  stamp.classList.add("is-dragging");
  activeDrag = {
    placement,
    stamp,
    pointerId: event.pointerId,
    mode: event.target.classList.contains("signature-resize") ? "resize" : "move",
    startX: event.clientX,
    startY: event.clientY,
    startLeft: placement.xRatio,
    startTop: placement.yRatio,
    startWidth: placement.widthRatio,
  };
  removeButton.disabled = false;
}

/**
 * Updates a normalized placement during a pointer gesture.
 *
 * @param {PointerEvent} event Pointer-move event.
 */
function movePlacement(event) {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
  const deltaXRatio = (event.clientX - activeDrag.startX) / pageStage.clientWidth;
  const deltaYRatio = (event.clientY - activeDrag.startY) / pageStage.clientHeight;
  const { placement } = activeDrag;

  if (activeDrag.mode === "resize") {
    placement.widthRatio = clamp(activeDrag.startWidth + deltaXRatio, 0.12, 0.65);
    placement.fontSizeRatio = placement.widthRatio * 0.16;
    activeDrag.stamp.style.width = `${placement.widthRatio * 100}%`;
    activeDrag.stamp.style.fontSize = `${placement.fontSizeRatio * pageStage.clientWidth}px`;
  } else {
    placement.xRatio = clamp(activeDrag.startLeft + deltaXRatio, 0, 1 - placement.widthRatio);
    const stampHeightRatio = activeDrag.stamp.offsetHeight / pageStage.clientHeight;
    placement.yRatio = clamp(activeDrag.startTop + deltaYRatio, 0, 1 - stampHeightRatio);
    activeDrag.stamp.style.left = `${placement.xRatio * 100}%`;
    activeDrag.stamp.style.top = `${placement.yRatio * 100}%`;
  }
}

/**
 * Completes an active placement gesture.
 *
 * @param {PointerEvent} event Pointer-up event.
 */
function endPlacementGesture(event) {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
  activeDrag.stamp.classList.remove("is-dragging");
  activeDrag = null;
  renderPlacements();
}

/**
 * Produces a transparent PNG of a styled signature or date.
 *
 * @param {object} placement Signature or date placement.
 * @returns {Promise<Uint8Array>} PNG bytes.
 */
async function createPlacementPng(placement) {
  const scale = 4;
  const isDate = placement.kind === "date";
  const fontSize = isDate ? 32 : 52;
  const canvasHeight = isDate ? 58 : 90;
  const placementCanvas = document.createElement("canvas");
  const placementContext = placementCanvas.getContext("2d");
  placementContext.font = `${fontSize}px ${FONT_STYLES[placement.font]}`;
  const measuredWidth = Math.ceil(placementContext.measureText(placement.text).width);
  placementCanvas.width = Math.max(isDate ? 150 : 240, measuredWidth + 35) * scale;
  placementCanvas.height = canvasHeight * scale;
  placementContext.scale(scale, scale);
  placementContext.font = `${fontSize}px ${FONT_STYLES[placement.font]}`;
  placementContext.fillStyle = "#17231f";
  placementContext.textBaseline = "middle";
  placementContext.fillText(placement.text, 14, canvasHeight / 2);
  const blob = await new Promise((resolve) => placementCanvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Unable to render the placed field.");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Embeds every placed signature and date into the original PDF.
 */
async function downloadSignedPdf() {
  if (!pdfBytes || !placements.length) return;
  try {
    downloadButton.disabled = true;
    downloadButton.textContent = "Preparing…";
    const outputDocument = await PDFDocument.load(pdfBytes.slice());
    const pages = outputDocument.getPages();

    for (const placement of placements) {
      const page = pages[placement.pageNumber - 1];
      if (!page) continue;
      const pngBytes = await createPlacementPng(placement);
      const placementImage = await outputDocument.embedPng(pngBytes);
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();
      const drawWidth = pageWidth * placement.widthRatio;
      const drawHeight = drawWidth * (placementImage.height / placementImage.width);
      page.drawImage(placementImage, {
        x: pageWidth * placement.xRatio,
        y: pageHeight - pageHeight * placement.yRatio - drawHeight,
        width: drawWidth,
        height: drawHeight,
      });
    }

    const signedBytes = await outputDocument.save();
    const blob = new Blob([signedBytes], { type: "application/pdf" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const baseName = pdfFileName.replace(/\.pdf$/i, "");
    link.href = downloadUrl;
    link.download = `${baseName}-signed.pdf`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setStatus("Signed copy downloaded");
  } catch (error) {
    console.error("Unable to create the signed PDF.", error);
    window.alert("The signed copy could not be created. The original PDF has not been changed.");
  } finally {
    downloadButton.textContent = "Download signed PDF";
    updateControls();
  }
}

/**
 * Keeps a numeric value within a closed interval.
 *
 * @param {number} value Candidate value.
 * @param {number} minimum Lower bound.
 * @param {number} maximum Upper bound.
 * @returns {number} Bounded value.
 */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Updates page, placement, and export control availability.
 */
function updateControls() {
  const hasDocument = Boolean(pdfDocument);
  document.querySelector("#page-count").textContent = hasDocument
    ? `Page ${currentPageNumber} / ${pdfDocument.numPages}`
    : "Page 0 / 0";
  document.querySelector("#previous-page").disabled = !hasDocument || currentPageNumber <= 1;
  document.querySelector("#next-page").disabled = !hasDocument || currentPageNumber >= pdfDocument.numPages;
  addSignatureButton.disabled = !hasDocument || !signatureInput.value.trim();
  addDateButton.disabled = !hasDocument || !dateInput.value;
  downloadButton.disabled = !hasDocument || placements.length === 0;
  removeButton.disabled = !selectedPlacementId;
}

/**
 * Updates the private-document status indicator.
 *
 * @param {string} message Status text.
 */
function setStatus(message) {
  document.querySelector("#pdf-status").textContent = message;
}

fileInput.addEventListener("change", () => loadPdf(fileInput.files[0]));
["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-over");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-over");
  });
});
dropZone.addEventListener("drop", (event) => loadPdf(event.dataTransfer.files[0]));

signatureInput.addEventListener("input", () => {
  signaturePreview.textContent = signatureInput.value.trim() || "Your signature";
  updateControls();
});
dateInput.addEventListener("change", updateControls);
document.querySelectorAll(".font-choice").forEach((button) => {
  button.addEventListener("click", () => {
    signatureFont = button.dataset.font;
    document.querySelectorAll(".font-choice").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
    signaturePreview.className = `signature-preview ${signatureFont}`;
  });
});

addSignatureButton.addEventListener("click", addSignature);
addDateButton.addEventListener("click", addDate);
downloadButton.addEventListener("click", downloadSignedPdf);
document.querySelector("#previous-page").addEventListener("click", async () => {
  if (currentPageNumber <= 1) return;
  currentPageNumber -= 1;
  selectedPlacementId = null;
  await renderPage();
});
document.querySelector("#next-page").addEventListener("click", async () => {
  if (!pdfDocument || currentPageNumber >= pdfDocument.numPages) return;
  currentPageNumber += 1;
  selectedPlacementId = null;
  await renderPage();
});
removeButton.addEventListener("click", () => {
  placements = placements.filter((placement) => placement.id !== selectedPlacementId);
  selectedPlacementId = null;
  renderPlacements();
  updateControls();
});

signatureLayer.addEventListener("pointerdown", startPlacementGesture);
signatureLayer.addEventListener("pointermove", movePlacement);
signatureLayer.addEventListener("pointerup", endPlacementGesture);
signatureLayer.addEventListener("pointercancel", endPlacementGesture);
dateInput.value = getTodayInputValue();
updateControls();
