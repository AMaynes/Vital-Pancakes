/**
 * Overview & Purpose
 * Provides local PDF viewing, signatures, dates, real fillable text fields,
 * vector marks, and export with every added item embedded.
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
import {
  createPdfPlacement,
  duplicatePlacementById,
  PDF_PLACEMENT_KINDS,
  removePlacementById,
  updatePlacementById,
} from "./pdf-signer-placements.mjs?v=5";
import { addFillableTextField, drawVectorMark, drawWhiteout } from "./pdf-tool-export.mjs?v=2";
import {
  installCurrentToolAiHost,
  requireCommandRecord,
  requireCommandString,
  rejectUnknownCommandFields,
} from "./current-tool-ai-adapter.mjs";

const { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } = globalThis.PDFLib;
globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = "../vendor/pdf.worker.min.js";

const fileInput = document.querySelector("#pdf-file");
const dropZone = document.querySelector("#pdf-drop-zone");
const signatureInput = document.querySelector("#signature-name");
const signaturePreview = document.querySelector("#signature-preview");
const addSignatureButton = document.querySelector("#add-signature");
const dateInput = document.querySelector("#signature-date");
const addDateButton = document.querySelector("#add-date");
const fillableTextInput = document.querySelector("#fillable-text");
const fillableTextHint = document.querySelector("#fillable-text-hint");
const addTextFieldButton = document.querySelector("#add-text-field");
const fillableFontFamily = document.querySelector("#fillable-font-family");
const fillableFontSize = document.querySelector("#fillable-font-size");
const fillableWidthInput = document.querySelector("#fillable-width");
const fillableHeightInput = document.querySelector("#fillable-height");
const copyTextFieldButton = document.querySelector("#copy-text-field");
const pasteTextFieldButton = document.querySelector("#paste-text-field");
const sidebarGroups = [...document.querySelectorAll("[data-pdf-sidebar-group]")];
const fillableStyleButtons = {
  bold: document.querySelector("#fillable-bold"),
  italic: document.querySelector("#fillable-italic"),
  underline: document.querySelector("#fillable-underline"),
};
const markButtons = [...document.querySelectorAll("[data-mark-kind]")];
const downloadButton = document.querySelector("#download-signed-pdf");
const deletePlacementButton = document.querySelector("#delete-placement");
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
let fillableTextDraft = "";
let copiedFillablePlacement = null;
let renderedPageWidthPoints = 545;
let fillableStyleDraft = {
  fontFamily: "helvetica",
  fontSizeRatio: 0.022,
  bold: false,
  italic: false,
  underline: false,
};

const FONT_STYLES = {
  "signature-font-1": '"Snell Roundhand", "Segoe Script", cursive',
  "signature-font-2": '"Brush Script MT", "Bradley Hand", cursive',
  "signature-font-3": '"American Typewriter", Georgia, serif',
  "date-font": 'Georgia, "Times New Roman", serif',
  "form-font": "Arial, Helvetica, sans-serif",
  "mark-font": "Arial, Helvetica, sans-serif",
};

const PLACEMENT_LABELS = Object.freeze({
  signature: "Signature",
  date: "Date",
  "text-field": "Fillable field",
  checkmark: "Checkmark",
  circle: "Circle",
  "x-mark": "X",
  whiteout: "White-out area",
});

const FORM_FONT_STYLES = Object.freeze({
  helvetica: "Arial, Helvetica, sans-serif",
  "times-roman": 'Georgia, "Times New Roman", serif',
  courier: '"Courier New", Courier, monospace',
});

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
    fillableTextDraft = "";
    copiedFillablePlacement = null;
    fillableStyleDraft = {
      fontFamily: "helvetica",
      fontSizeRatio: 0.022,
      bold: false,
      italic: false,
      underline: false,
    };
    fillableTextInput.value = "";
    document.querySelector("#pdf-empty").hidden = true;
    pageStage.hidden = false;
    updateControls();
    await renderPage();
    openSidebarGroup("fillable");
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
  renderedPageWidthPoints = page.getViewport({ scale: 1 }).width;
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
 * Rebuilds draggable added items for the current PDF page.
 */
function renderPlacements() {
  signatureLayer.replaceChildren();
  const currentPlacements = placements.filter((placement) => placement.pageNumber === currentPageNumber);
  currentPlacements.forEach((placement) => {
    const stamp = document.createElement("div");
    stamp.className = [
      "pdf-placement",
      placement.font,
      placement.kind === "date" ? "date-stamp" : "",
      placement.kind === "text-field" ? "text-field-stamp" : "",
      isMarkPlacement(placement) ? "mark-stamp" : "",
      placement.kind === "whiteout" ? "whiteout-stamp" : "",
    ].filter(Boolean).join(" ");
    stamp.dataset.placementId = placement.id;
    stamp.dataset.placementKind = placement.kind;
    stamp.dataset.placementText = placement.text;
    stamp.tabIndex = 0;
    stamp.setAttribute("role", "group");
    stamp.setAttribute(
      "aria-label",
      `${placement.id === selectedPlacementId ? "Selected " : ""}${PLACEMENT_LABELS[placement.kind]}${placement.text ? `: ${placement.text}` : ""}`,
    );
    stamp.style.left = `${placement.xRatio * 100}%`;
    stamp.style.top = `${placement.yRatio * 100}%`;
    stamp.style.width = `${placement.widthRatio * 100}%`;
    stamp.style.height = `${placement.heightRatio * 100}%`;
    stamp.style.fontSize = `${placement.fontSizeRatio * pageStage.clientWidth}px`;
    stamp.classList.toggle("is-selected", placement.id === selectedPlacementId);
    stamp.classList.toggle("is-locked", placement.locked);
    let fillableEditor = null;

    if (placement.kind === "text-field") {
      const editor = document.createElement("textarea");
      fillableEditor = editor;
      editor.className = "pdf-fillable-editor";
      editor.value = placement.text;
      editor.placeholder = "Fillable text";
      editor.maxLength = 500;
      editor.setAttribute("aria-label", "Fillable field text");
      editor.style.fontFamily = FORM_FONT_STYLES[placement.fontFamily];
      editor.style.fontWeight = placement.bold ? "700" : "400";
      editor.style.fontStyle = placement.italic ? "italic" : "normal";
      editor.style.textDecoration = placement.underline ? "underline" : "none";
      editor.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        selectPlacement(placement.id);
      });
      editor.addEventListener("focus", () => selectPlacement(placement.id));
      editor.addEventListener("input", () => updateFillableText(placement.id, editor.value));
      stamp.append(editor);

      const moveEdges = ["top", "right", "bottom", "left"].map((edge) => {
        const moveEdge = document.createElement("span");
        moveEdge.className = "pdf-placement-edge";
        moveEdge.dataset.moveEdge = edge;
        moveEdge.title = placement.locked ? "Unlock to move" : "Drag fillable field";
        moveEdge.setAttribute("aria-hidden", "true");
        return moveEdge;
      });
      stamp.append(...moveEdges);
    } else {
      const content = document.createElement("span");
      content.className = "pdf-placement-content";
      content.textContent = placement.text;
      stamp.append(content);
    }

    const resizeHandles = ["nw", "ne", "sw", "se"].map((corner) => {
      const resizeHandle = document.createElement("span");
      resizeHandle.className = "pdf-placement-resize";
      resizeHandle.dataset.resizeCorner = corner;
      resizeHandle.title = `Resize ${placement.kind} from ${corner.toUpperCase()}`;
      resizeHandle.setAttribute("aria-hidden", "true");
      return resizeHandle;
    });

    const lockControl = document.createElement("button");
    lockControl.className = "pdf-placement-lock";
    lockControl.type = "button";
    lockControl.title = placement.locked ? `Unlock ${placement.kind}` : `Lock ${placement.kind} in place`;
    lockControl.setAttribute("aria-label", lockControl.title);
    lockControl.setAttribute("aria-pressed", String(placement.locked));
    lockControl.innerHTML = placement.locked ? `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="10" width="14" height="10" rx="2"></rect>
        <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
      </svg>
    ` : `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="10" width="14" height="10" rx="2"></rect>
        <path d="M8 10V7a4 4 0 0 1 7.4-2.1"></path>
      </svg>
    `;
    lockControl.addEventListener("pointerdown", (event) => event.stopPropagation());
    lockControl.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePlacementLock(placement.id);
    });

    const deleteControl = document.createElement("button");
    deleteControl.className = "pdf-placement-delete";
    deleteControl.type = "button";
    deleteControl.title = `Delete ${placement.kind}`;
    deleteControl.setAttribute("aria-label", `Delete placed ${placement.kind}`);
    deleteControl.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path>
      </svg>
    `;
    deleteControl.addEventListener("pointerdown", (event) => event.stopPropagation());
    deleteControl.addEventListener("click", (event) => {
      event.stopPropagation();
      deletePlacement(placement.id);
    });

    stamp.append(...resizeHandles);
    if (placement.kind === "text-field" && placement.id === selectedPlacementId) {
      const dimensions = document.createElement("span");
      dimensions.className = "pdf-placement-dimensions";
      dimensions.textContent = formatPlacementDimensions(placement);
      stamp.append(dimensions);
    }
    stamp.append(lockControl);
    stamp.append(deleteControl);
    stamp.addEventListener("focus", () => selectPlacement(placement.id));
    signatureLayer.append(stamp);
    if (fillableEditor) fitFillablePreviewText(fillableEditor, placement);
  });
  deletePlacementButton.disabled = !selectedPlacementId;
  syncFillableTextControl();
}

/**
 * Adds a new centered signature placement to the visible page.
 */
function addSignature() {
  if (!pdfDocument || !signatureInput.value.trim()) return;
  const placement = createPdfPlacement({
    id: createId(),
    kind: "signature",
    pageNumber: currentPageNumber,
    text: signatureInput.value.trim(),
    font: signatureFont,
  });
  placements.push(placement);
  selectedPlacementId = placement.id;
  renderPlacements();
  updateControls();
  setStatus("Signature placed · selected");
}

/**
 * Adds a formatted date placement to the visible page.
 */
function addDate() {
  if (!pdfDocument || !dateInput.value) return;
  const placement = createPdfPlacement({
    id: createId(),
    kind: "date",
    pageNumber: currentPageNumber,
    text: formatDateValue(dateInput.value),
  });
  placements.push(placement);
  selectedPlacementId = placement.id;
  renderPlacements();
  updateControls();
  setStatus("Date placed · selected");
}

/**
 * Adds a genuine PDF text field to the visible page.
 */
function addTextField() {
  if (!pdfDocument) return;
  const placement = createPdfPlacement({
    id: createId(),
    kind: "text-field",
    pageNumber: currentPageNumber,
    text: fillableTextInput.value,
    ...fillableStyleDraft,
  });
  placements.push(placement);
  selectedPlacementId = placement.id;
  renderPlacements();
  updateControls();
  setStatus("Fillable field placed · edit its text anytime");
}

/**
 * Adds one vector mark to the visible page.
 *
 * @param {string} kind Checkmark, circle, X, or white-out placement kind.
 */
function addMark(kind) {
  if (!pdfDocument || !["checkmark", "circle", "x-mark", "whiteout"].includes(kind)) return;
  const placement = createPdfPlacement({
    id: createId(),
    kind,
    pageNumber: currentPageNumber,
  });
  placements.push(placement);
  selectedPlacementId = placement.id;
  renderPlacements();
  updateControls();
  setStatus(`${PLACEMENT_LABELS[kind]} placed · selected`);
}

/**
 * Updates the live and exported value of one fillable field.
 *
 * @param {string} placementId Field identifier.
 * @param {string} text Next field value.
 */
function updateFillableText(placementId, text) {
  const current = placements.find((placement) => placement.id === placementId);
  if (!current || current.kind !== "text-field") return;
  const result = updatePlacementById(placements, placementId, { text });
  placements = result.placements;
  if (selectedPlacementId === placementId && fillableTextInput.value !== text) {
    fillableTextInput.value = text;
  }
  const stamp = signatureLayer.querySelector(`[data-placement-id="${CSS.escape(placementId)}"]`);
  if (stamp) {
    stamp.dataset.placementText = text;
    stamp.setAttribute("aria-label", `Selected Fillable field${text ? `: ${text}` : ""}`);
    const editor = stamp.querySelector(".pdf-fillable-editor");
    if (editor) fitFillablePreviewText(editor, result.updated);
  }
}

function fitFillablePreviewText(editor, placement) {
  const fieldHeight = placement.heightRatio * pageStage.clientHeight;
  editor.style.padding = fieldHeight < 12 ? "0 1px" : "3px 5px";
  const minimum = 1;
  const maximum = Math.max(minimum, placement.fontSizeRatio * pageStage.clientWidth);
  let fitted = maximum;
  editor.style.fontSize = `${fitted}px`;
  while (fitted > minimum && (editor.scrollWidth > editor.clientWidth + 1 || editor.scrollHeight > editor.clientHeight + 1)) {
    fitted = Math.max(minimum, fitted - 0.5);
    editor.style.fontSize = `${fitted}px`;
  }
}

function updateFillableStyle(changes) {
  const selected = placements.find((placement) => placement.id === selectedPlacementId);
  if (selected?.kind === "text-field") {
    const result = updatePlacementById(placements, selected.id, changes);
    placements = result.placements;
    renderPlacements();
  } else {
    fillableStyleDraft = { ...fillableStyleDraft, ...changes };
    syncFillableTextControl();
  }
}

function togglePlacementLock(placementId) {
  const placement = placements.find((candidate) => candidate.id === placementId);
  if (!placement) return;
  const result = updatePlacementById(placements, placementId, { locked: !placement.locked });
  placements = result.placements;
  selectedPlacementId = placementId;
  renderPlacements();
  updateControls();
  setStatus(`${PLACEMENT_LABELS[placement.kind]} ${result.updated.locked ? "locked" : "unlocked"}`);
}

function copySelectedFillable() {
  const placement = placements.find((candidate) => candidate.id === selectedPlacementId);
  if (placement?.kind !== "text-field") return;
  copiedFillablePlacement = { ...placement };
  updateControls();
  setStatus("Fillable copied");
}

function pasteCopiedFillable() {
  if (!pdfDocument || !copiedFillablePlacement) return;
  const offsetXRatio = 10 / pageStage.clientWidth;
  const offsetYRatio = 10 / pageStage.clientHeight;
  const placement = createPdfPlacement({
    ...copiedFillablePlacement,
    id: createId(),
    pageNumber: currentPageNumber,
    xRatio: Math.min(copiedFillablePlacement.xRatio + offsetXRatio, 1 - copiedFillablePlacement.widthRatio),
    yRatio: Math.min(copiedFillablePlacement.yRatio + offsetYRatio, 1 - copiedFillablePlacement.heightRatio),
    locked: false,
  });
  placements.push(placement);
  selectedPlacementId = placement.id;
  renderPlacements();
  updateControls();
  setStatus("Fillable pasted · exact size preserved");
}

function updateSelectedFillableDimension(dimension, pixelValue) {
  const placement = placements.find((candidate) => candidate.id === selectedPlacementId);
  if (placement?.kind !== "text-field" || placement.locked) return;
  const stagePixels = dimension === "width" ? pageStage.clientWidth : pageStage.clientHeight;
  const positionRatio = dimension === "width" ? placement.xRatio : placement.yRatio;
  const ratioField = dimension === "width" ? "widthRatio" : "heightRatio";
  const pixels = Math.max(1, Math.round(Number(pixelValue) || 1));
  const ratio = clamp(pixels / stagePixels, 0.008, 1 - positionRatio);
  const result = updatePlacementById(placements, placement.id, { [ratioField]: ratio });
  placements = result.placements;
  renderPlacements();
  updateControls();
}

function formatPlacementDimensions(placement) {
  return `${Math.round(placement.widthRatio * pageStage.clientWidth)} × ${Math.round(placement.heightRatio * pageStage.clientHeight)} px`;
}

function openSidebarGroup(groupName) {
  sidebarGroups.forEach((group) => { group.open = group.dataset.pdfSidebarGroup === groupName; });
}

function isMarkPlacement(placement) {
  return ["checkmark", "circle", "x-mark"].includes(placement.kind);
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
 * Starts dragging or resizing an added PDF item.
 *
 * @param {PointerEvent} event Pointer-down event on the signature layer.
 */
function startPlacementGesture(event) {
  if (event.target.closest("button, textarea, input")) return;
  const stamp = event.target.closest(".pdf-placement");
  if (!stamp) {
    selectPlacement(null);
    return;
  }
  event.preventDefault();
  const placement = placements.find((candidate) => candidate.id === stamp.dataset.placementId);
  if (!placement) return;
  selectPlacement(placement.id);
  const isResizeHandle = event.target.classList.contains("pdf-placement-resize");
  const isMoveEdge = event.target.classList.contains("pdf-placement-edge");
  if (placement.locked && (isResizeHandle || isMoveEdge || placement.kind !== "text-field")) return;
  if (placement.kind === "text-field" && !isResizeHandle && !isMoveEdge) return;
  stamp.setPointerCapture(event.pointerId);
  stamp.classList.add("is-dragging");
  activeDrag = {
    placement,
    stamp,
    pointerId: event.pointerId,
    mode: isResizeHandle ? "resize" : "move",
    corner: event.target.dataset.resizeCorner ?? "se",
    startX: event.clientX,
    startY: event.clientY,
    startLeft: placement.xRatio,
    startTop: placement.yRatio,
    startWidth: placement.widthRatio,
    startHeight: placement.heightRatio,
  };
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
    const minimumWidth = 0.008;
    const minimumHeight = 0.008;
    const startRight = activeDrag.startLeft + activeDrag.startWidth;
    const startBottom = activeDrag.startTop + activeDrag.startHeight;
    const resizeWest = activeDrag.corner.includes("w");
    const resizeNorth = activeDrag.corner.includes("n");

    if (resizeWest) {
      placement.xRatio = clamp(activeDrag.startLeft + deltaXRatio, 0, startRight - minimumWidth);
      placement.widthRatio = startRight - placement.xRatio;
    } else {
      placement.widthRatio = clamp(activeDrag.startWidth + deltaXRatio, minimumWidth, 1 - activeDrag.startLeft);
    }
    if (resizeNorth) {
      placement.yRatio = clamp(activeDrag.startTop + deltaYRatio, 0, startBottom - minimumHeight);
      placement.heightRatio = startBottom - placement.yRatio;
    } else {
      placement.heightRatio = clamp(activeDrag.startHeight + deltaYRatio, minimumHeight, 1 - activeDrag.startTop);
    }
    if (isMarkPlacement(placement)) {
      placement.fontSizeRatio = Math.min(placement.widthRatio, placement.heightRatio) * 0.72;
    } else if (!["text-field", "whiteout"].includes(placement.kind)) {
      placement.fontSizeRatio = placement.widthRatio * 0.16;
    }
    activeDrag.stamp.style.left = `${placement.xRatio * 100}%`;
    activeDrag.stamp.style.top = `${placement.yRatio * 100}%`;
    activeDrag.stamp.style.width = `${placement.widthRatio * 100}%`;
    activeDrag.stamp.style.height = `${placement.heightRatio * 100}%`;
    activeDrag.stamp.style.fontSize = `${placement.fontSizeRatio * pageStage.clientWidth}px`;
    const dimensions = activeDrag.stamp.querySelector(".pdf-placement-dimensions");
    if (dimensions) dimensions.textContent = formatPlacementDimensions(placement);
    if (placement.kind === "text-field") {
      fillableWidthInput.value = String(Math.round(placement.widthRatio * pageStage.clientWidth));
      fillableHeightInput.value = String(Math.round(placement.heightRatio * pageStage.clientHeight));
      const editor = activeDrag.stamp.querySelector(".pdf-fillable-editor");
      if (editor) fitFillablePreviewText(editor, placement);
    }
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
 * Selects one placed field and refreshes its accessible and visual state.
 *
 * @param {string | null} placementId Placement identifier, or null to clear.
 */
function selectPlacement(placementId) {
  selectedPlacementId = placements.some((placement) => placement.id === placementId)
    ? placementId
    : null;
  const selected = placements.find((placement) => placement.id === selectedPlacementId);
  if (selected?.kind === "text-field") openSidebarGroup("fillable");
  signatureLayer.querySelectorAll(".pdf-placement").forEach((stamp) => {
    const isSelected = stamp.dataset.placementId === selectedPlacementId;
    stamp.classList.toggle("is-selected", isSelected);
    stamp.setAttribute(
      "aria-label",
      `${isSelected ? "Selected " : ""}${PLACEMENT_LABELS[stamp.dataset.placementKind]}${stamp.dataset.placementText ? `: ${stamp.dataset.placementText}` : ""}`,
    );
  });
  syncFillableTextControl();
  updateControls();
}

/**
 * Shows the selected fillable field in the sidebar editor, or the new-field draft.
 */
function syncFillableTextControl() {
  const selected = placements.find((placement) => placement.id === selectedPlacementId);
  const isEditingField = selected?.kind === "text-field";
  const nextValue = isEditingField ? selected.text : fillableTextDraft;
  const style = isEditingField ? selected : fillableStyleDraft;
  if (fillableTextInput.value !== nextValue) fillableTextInput.value = nextValue;
  fillableFontFamily.value = style.fontFamily;
  fillableFontSize.value = String(Math.round(style.fontSizeRatio * renderedPageWidthPoints));
  Object.entries(fillableStyleButtons).forEach(([property, button]) => {
    button.setAttribute("aria-pressed", String(Boolean(style[property])));
  });
  fillableWidthInput.value = isEditingField
    ? String(Math.round(selected.widthRatio * pageStage.clientWidth))
    : "";
  fillableHeightInput.value = isEditingField
    ? String(Math.round(selected.heightRatio * pageStage.clientHeight))
    : "";
  fillableWidthInput.disabled = !isEditingField || selected.locked;
  fillableHeightInput.disabled = !isEditingField || selected.locked;
  copyTextFieldButton.disabled = !isEditingField;
  pasteTextFieldButton.disabled = !pdfDocument || !copiedFillablePlacement;
  fillableTextHint.textContent = isEditingField
    ? "Editing the selected fillable field. Changes update immediately."
    : "Select a field to edit its text here or directly on the page.";
  fillableTextHint.classList.toggle("is-editing", isEditingField);
}

/**
 * Removes a placed field from both the viewer overlay and export data.
 *
 * @param {string | null} placementId Placement identifier.
 */
function deletePlacement(placementId) {
  const result = removePlacementById(placements, placementId);
  if (!result.removed) return;
  placements = result.placements;
  selectedPlacementId = null;
  renderPlacements();
  updateControls();
  setStatus(`${PLACEMENT_LABELS[result.removed.kind]} deleted`);
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
 * Embeds signatures/dates, creates real form fields, and draws vector marks.
 */
async function downloadSignedPdf() {
  if (!pdfBytes || !placements.length) return;
  try {
    downloadButton.disabled = true;
    downloadButton.textContent = "Preparing…";
    const outputDocument = await PDFDocument.load(pdfBytes.slice());
    const pages = outputDocument.getPages();
    const form = outputDocument.getForm();
    const formFonts = {
      helvetica: {
        regular: await outputDocument.embedFont(StandardFonts.Helvetica),
        bold: await outputDocument.embedFont(StandardFonts.HelveticaBold),
        italic: await outputDocument.embedFont(StandardFonts.HelveticaOblique),
        boldItalic: await outputDocument.embedFont(StandardFonts.HelveticaBoldOblique),
      },
      "times-roman": {
        regular: await outputDocument.embedFont(StandardFonts.TimesRoman),
        bold: await outputDocument.embedFont(StandardFonts.TimesRomanBold),
        italic: await outputDocument.embedFont(StandardFonts.TimesRomanItalic),
        boldItalic: await outputDocument.embedFont(StandardFonts.TimesRomanBoldItalic),
      },
      courier: {
        regular: await outputDocument.embedFont(StandardFonts.Courier),
        bold: await outputDocument.embedFont(StandardFonts.CourierBold),
        italic: await outputDocument.embedFont(StandardFonts.CourierOblique),
        boldItalic: await outputDocument.embedFont(StandardFonts.CourierBoldOblique),
      },
    };

    for (const [placementIndex, placement] of placements.entries()) {
      const page = pages[placement.pageNumber - 1];
      if (!page) continue;
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();
      if (placement.kind === "text-field") {
        const styleKey = placement.bold && placement.italic
          ? "boldItalic"
          : placement.bold ? "bold" : placement.italic ? "italic" : "regular";
        addFillableTextField({
          form,
          formFont: formFonts[placement.fontFamily][styleKey],
          page,
          pageWidth,
          pageHeight,
          placement,
          placementIndex,
          rgb,
          PDFName,
          PDFHexString,
        });
      } else if (placement.kind === "whiteout") {
        drawWhiteout(page, placement, pageWidth, pageHeight, rgb);
      } else if (isMarkPlacement(placement)) {
        drawVectorMark(page, placement, pageWidth, pageHeight, rgb);
      } else {
        const pngBytes = await createPlacementPng(placement);
        const placementImage = await outputDocument.embedPng(pngBytes);
        const drawWidth = pageWidth * placement.widthRatio;
        const drawHeight = pageHeight * placement.heightRatio;
        page.drawImage(placementImage, {
          x: pageWidth * placement.xRatio,
          y: pageHeight - pageHeight * placement.yRatio - drawHeight,
          width: drawWidth,
          height: drawHeight,
        });
      }
    }

    const signedBytes = await outputDocument.save();
    const blob = new Blob([signedBytes], { type: "application/pdf" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const baseName = pdfFileName.replace(/\.pdf$/i, "");
    link.href = downloadUrl;
    link.download = `${baseName}-edited.pdf`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setStatus("Edited PDF downloaded");
  } catch (error) {
    console.error("Unable to create the edited PDF.", error);
    window.alert("The edited copy could not be created. The original PDF has not been changed.");
  } finally {
    downloadButton.textContent = "Download PDF";
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
  addTextFieldButton.disabled = !hasDocument;
  markButtons.forEach((button) => { button.disabled = !hasDocument; });
  downloadButton.disabled = !hasDocument || placements.length === 0;
  deletePlacementButton.disabled = !selectedPlacementId;
  const selected = placements.find((placement) => placement.id === selectedPlacementId);
  copyTextFieldButton.disabled = selected?.kind !== "text-field";
  pasteTextFieldButton.disabled = !hasDocument || !copiedFillablePlacement;
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
fillableTextInput.addEventListener("input", () => {
  const selected = placements.find((placement) => placement.id === selectedPlacementId);
  if (selected?.kind === "text-field") {
    updateFillableText(selected.id, fillableTextInput.value);
  } else {
    fillableTextDraft = fillableTextInput.value;
  }
});
fillableFontFamily.addEventListener("change", () => {
  updateFillableStyle({ fontFamily: fillableFontFamily.value });
});
fillableFontSize.addEventListener("change", () => {
  const points = clamp(Number(fillableFontSize.value) || 12, 4, 32);
  fillableFontSize.value = String(points);
  updateFillableStyle({ fontSizeRatio: points / renderedPageWidthPoints });
});
Object.entries(fillableStyleButtons).forEach(([property, button]) => {
  button.addEventListener("click", () => {
    updateFillableStyle({ [property]: button.getAttribute("aria-pressed") !== "true" });
  });
});
fillableWidthInput.addEventListener("change", () => {
  updateSelectedFillableDimension("width", fillableWidthInput.value);
});
fillableHeightInput.addEventListener("change", () => {
  updateSelectedFillableDimension("height", fillableHeightInput.value);
});
copyTextFieldButton.addEventListener("click", copySelectedFillable);
pasteTextFieldButton.addEventListener("click", pasteCopiedFillable);
sidebarGroups.forEach((group) => {
  group.addEventListener("toggle", () => {
    if (!group.open) return;
    sidebarGroups.forEach((candidate) => {
      if (candidate !== group) candidate.open = false;
    });
  });
});
document.querySelectorAll(".font-choice").forEach((button) => {
  button.addEventListener("click", () => {
    signatureFont = button.dataset.font;
    document.querySelectorAll(".font-choice").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
    signaturePreview.className = `signature-preview ${signatureFont}`;
  });
});

addSignatureButton.addEventListener("click", addSignature);
addDateButton.addEventListener("click", addDate);
addTextFieldButton.addEventListener("click", addTextField);
markButtons.forEach((button) => {
  button.addEventListener("click", () => addMark(button.dataset.markKind));
});
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
deletePlacementButton.addEventListener("click", () => deletePlacement(selectedPlacementId));

document.addEventListener("pointerdown", (event) => {
  if (!selectedPlacementId) return;
  if (event.target.closest(".pdf-placement, .pdf-text-tools, .pdf-field-geometry, #fillable-text, #delete-placement")) return;
  selectPlacement(null);
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isEditing = target instanceof Element
    && (target.matches("input, textarea, select") || target.closest("[contenteditable='true']"));
  if (isEditing) return;

  const usesCommandKey = event.ctrlKey || event.metaKey;
  if (usesCommandKey && event.key.toLocaleLowerCase() === "c") {
    const selected = placements.find((placement) => placement.id === selectedPlacementId);
    if (selected?.kind === "text-field") {
      event.preventDefault();
      copySelectedFillable();
    }
    return;
  }
  if (usesCommandKey && event.key.toLocaleLowerCase() === "v" && copiedFillablePlacement) {
    event.preventDefault();
    pasteCopiedFillable();
    return;
  }

  if ((event.key === "Delete" || event.key === "Backspace") && selectedPlacementId) {
    event.preventDefault();
    deletePlacement(selectedPlacementId);
  } else if (event.key === "Escape" && selectedPlacementId) {
    event.preventDefault();
    selectPlacement(null);
  }
});

signatureLayer.addEventListener("pointerdown", startPlacementGesture);
signatureLayer.addEventListener("pointermove", movePlacement);
signatureLayer.addEventListener("pointerup", endPlacementGesture);
signatureLayer.addEventListener("pointercancel", endPlacementGesture);
dateInput.value = getTodayInputValue();
updateControls();

installCurrentToolAiHost({
  id: "pdf-signer",
  title: "PDF Tool",
  description: "Describes and stages added signatures, dates, styled fillable text fields, marks, and white-out areas on a local PDF.",
  limitations: [
    "AI commands cannot choose a local PDF file.",
    "AI commands only manage added items; they do not detect or remove original PDF content.",
    "PDF export remains an explicit user action.",
    "PDF bytes are never included in AI context.",
  ],
  getSnapshot: () => ({
    document: {
      loaded: Boolean(pdfDocument),
      name: pdfDocument ? pdfFileName : "",
      currentPage: pdfDocument ? currentPageNumber : 0,
      pageCount: pdfDocument?.numPages ?? 0,
    },
    placements: placements.map((placement) => ({ ...placement })),
    selectedPlacementId,
  }),
  getContext: (_options, snapshot) => ({
    document: {
      loaded: snapshot.document.loaded,
      currentPage: snapshot.document.currentPage,
      pageCount: snapshot.document.pageCount,
    },
    placementCount: snapshot.placements.length,
    placementKinds: Object.fromEntries(PDF_PLACEMENT_KINDS.map((kind) => [
      kind,
      snapshot.placements.filter((placement) => placement.kind === kind).length,
    ])),
    selectedPlacementId: snapshot.selectedPlacementId,
  }),
  commitSnapshot(nextState) {
    if (!pdfDocument) throw new Error("Choose a PDF before applying placement changes.");
    const nextPlacements = nextState.placements.map((placement) => createPdfPlacement(placement));
    if (nextPlacements.some((placement) => placement.pageNumber > pdfDocument.numPages)) {
      throw new Error("A placement page is outside the open PDF.");
    }
    if (new Set(nextPlacements.map((placement) => placement.id)).size !== nextPlacements.length) {
      throw new Error("Placement IDs must be unique.");
    }
    placements = nextPlacements;
    selectedPlacementId = placements.some((placement) => placement.id === nextState.selectedPlacementId)
      ? nextState.selectedPlacementId
      : null;
    renderPlacements();
    updateControls();
    setStatus("AI placement changes applied locally");
  },
  commands: [
    {
      type: "document.describe",
      description: "Describe the open PDF without exposing its bytes.",
      permissions: ["read-content"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return { value: state.document };
      },
    },
    {
      type: "placements.list",
      description: "List added signatures, dates, fillable fields, and marks with normalized geometry.",
      permissions: ["read-content", "sensitive-data"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return { value: state.placements };
      },
    },
    {
      type: "placements.add",
      description: "Add one signature, date, styled fillable text field, checkmark, circle, X, or white-out area to an open PDF page.",
      permissions: ["create", "sensitive-data"],
      mutates: true,
      schema: {
        type: "object",
        required: ["placement"],
        properties: {
          placement: {
            type: "object",
            required: ["kind"],
            properties: {
              id: { type: "string", maxLength: 128 },
              kind: { type: "string", enum: PDF_PLACEMENT_KINDS },
              pageNumber: { type: "integer", minimum: 1 },
              text: { type: "string", maxLength: 500 },
              font: {
                type: "string",
                enum: [
                  "signature-font-1",
                  "signature-font-2",
                  "signature-font-3",
                  "date-font",
                  "form-font",
                  "mark-font",
                  "whiteout",
                ],
              },
              fontFamily: { type: "string", enum: ["helvetica", "times-roman", "courier"] },
              bold: { type: "boolean" },
              italic: { type: "boolean" },
              underline: { type: "boolean" },
              locked: { type: "boolean" },
              xRatio: { type: "number", minimum: 0, maximum: 0.98 },
              yRatio: { type: "number", minimum: 0, maximum: 0.98 },
              widthRatio: { type: "number", minimum: 0.008, maximum: 1 },
              heightRatio: { type: "number", minimum: 0.008, maximum: 1 },
              fontSizeRatio: { type: "number", minimum: 0.008, maximum: 0.2 },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      example: {
        type: "placements.add",
        placement: {
          kind: "text-field",
          pageNumber: 1,
          text: "Editable answer",
          fontFamily: "times-roman",
          bold: true,
          underline: true,
          xRatio: 0.2,
          yRatio: 0.4,
          widthRatio: 0.35,
          heightRatio: 0.08,
        },
      },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["placement"], commandIndex);
        if (!state.document.loaded) throw new Error("Choose a PDF before adding placements.");
        const record = requireCommandRecord(command.placement, "placement", commandIndex);
        rejectPlacementFields(record, [
          "id",
          "kind",
          "pageNumber",
          "text",
          "font",
          "fontFamily",
          "bold",
          "italic",
          "underline",
          "locked",
          "xRatio",
          "yRatio",
          "widthRatio",
          "heightRatio",
          "fontSizeRatio",
        ]);
        const id = record.id === undefined
          ? createId()
          : requireCommandString(record.id, "placement.id", commandIndex, { maximumLength: 128 });
        if (state.placements.some((placement) => placement.id === id)) {
          throw new Error(`Placement ID already exists: ${id}.`);
        }
        const kind = requireCommandString(record.kind, "placement.kind", commandIndex, { maximumLength: 32 });
        const pageNumber = record.pageNumber === undefined
          ? state.document.currentPage
          : Number(record.pageNumber);
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > state.document.pageCount) {
          throw new Error("placement.pageNumber must identify a page in the open PDF.");
        }
        const placement = createPdfPlacement({ ...record, id, kind, pageNumber });
        return {
          state: {
            ...state,
            placements: [...state.placements, placement],
            selectedPlacementId: placement.id,
          },
          createdIds: [placement.id],
          value: placement,
        };
      },
    },
    {
      type: "placements.update",
      description: "Edit an added item's geometry or a fillable field's text, font family, size, and emphasis.",
      permissions: ["update", "sensitive-data"],
      mutates: true,
      schema: {
        type: "object",
        required: ["placementId", "changes"],
        properties: {
          placementId: { type: "string" },
          changes: {
            type: "object",
            minProperties: 1,
            properties: {
              text: { type: "string", maxLength: 500 },
              fontFamily: { type: "string", enum: ["helvetica", "times-roman", "courier"] },
              bold: { type: "boolean" },
              italic: { type: "boolean" },
              underline: { type: "boolean" },
              locked: { type: "boolean" },
              xRatio: { type: "number", minimum: 0, maximum: 0.98 },
              yRatio: { type: "number", minimum: 0, maximum: 0.98 },
              widthRatio: { type: "number", minimum: 0.008, maximum: 1 },
              heightRatio: { type: "number", minimum: 0.008, maximum: 1 },
              fontSizeRatio: { type: "number", minimum: 0.008, maximum: 0.2 },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      example: {
        type: "placements.update",
        placementId: "field-id",
        changes: { text: "Updated answer" },
      },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["placementId", "changes"], commandIndex);
        const placementId = requireCommandString(
          command.placementId,
          "placementId",
          commandIndex,
          { maximumLength: 128 },
        );
        const changes = requireCommandRecord(command.changes, "changes", commandIndex);
        rejectPlacementFields(changes, [
          "text",
          "fontFamily",
          "bold",
          "italic",
          "underline",
          "locked",
          "xRatio",
          "yRatio",
          "widthRatio",
          "heightRatio",
          "fontSizeRatio",
        ]);
        const current = state.placements.find((placement) => placement.id === placementId);
        if (!current) throw new Error(`Placement not found: ${placementId}.`);
        const changesFillableStyle = ["text", "fontFamily", "bold", "italic", "underline"]
          .some((field) => changes[field] !== undefined);
        if (changesFillableStyle && current.kind !== "text-field") {
          throw new Error("Only fillable-field text and formatting can be modified.");
        }
        const result = updatePlacementById(state.placements, placementId, changes);
        return {
          state: { ...state, placements: result.placements, selectedPlacementId: placementId },
          updatedIds: [placementId],
          value: result.updated,
        };
      },
    },
    {
      type: "placements.duplicate",
      description: "Duplicate a fillable field with the same text, typography, and exact normalized dimensions.",
      permissions: ["create", "sensitive-data"],
      mutates: true,
      schema: {
        type: "object",
        required: ["placementId"],
        properties: {
          placementId: { type: "string" },
          id: { type: "string", maxLength: 128 },
          pageNumber: { type: "integer", minimum: 1 },
          offsetXRatio: { type: "number", minimum: -1, maximum: 1 },
          offsetYRatio: { type: "number", minimum: -1, maximum: 1 },
        },
        additionalProperties: false,
      },
      example: {
        type: "placements.duplicate",
        placementId: "field-id",
        offsetXRatio: 0,
        offsetYRatio: 0.04,
      },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(
          command,
          ["placementId", "id", "pageNumber", "offsetXRatio", "offsetYRatio"],
          commandIndex,
        );
        const placementId = requireCommandString(
          command.placementId,
          "placementId",
          commandIndex,
          { maximumLength: 128 },
        );
        const current = state.placements.find((placement) => placement.id === placementId);
        if (!current) throw new Error(`Placement not found: ${placementId}.`);
        if (current.kind !== "text-field") throw new Error("Only fillable fields can be duplicated.");
        const id = command.id === undefined
          ? createId()
          : requireCommandString(command.id, "id", commandIndex, { maximumLength: 128 });
        const pageNumber = command.pageNumber === undefined ? current.pageNumber : Number(command.pageNumber);
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > state.document.pageCount) {
          throw new Error("pageNumber must identify a page in the open PDF.");
        }
        const result = duplicatePlacementById(state.placements, placementId, {
          id,
          pageNumber,
          offsetXRatio: command.offsetXRatio,
          offsetYRatio: command.offsetYRatio,
        });
        return {
          state: { ...state, placements: result.placements, selectedPlacementId: id },
          createdIds: [id],
          value: result.duplicated,
        };
      },
    },
    {
      type: "placements.remove",
      description: "Remove one item previously added by this tool; original PDF content is never removed.",
      permissions: ["delete"],
      mutates: true,
      schema: {
        type: "object",
        required: ["placementId"],
        properties: { placementId: { type: "string" } },
        additionalProperties: false,
      },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["placementId"], commandIndex);
        const placementId = requireCommandString(
          command.placementId,
          "placementId",
          commandIndex,
          { maximumLength: 128 },
        );
        const result = removePlacementById(state.placements, placementId);
        if (!result.removed) throw new Error(`Placement not found: ${placementId}.`);
        return {
          state: { ...state, placements: result.placements, selectedPlacementId: null },
          deletedIds: [placementId],
          value: result.removed,
        };
      },
    },
  ],
});

function rejectPlacementFields(record, allowedFields) {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(record).find((field) => !allowed.has(field));
  if (unknown) throw new TypeError(`Unknown placement field: ${unknown}.`);
}
