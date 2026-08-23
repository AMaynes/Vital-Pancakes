/**
 * Overview & Purpose
 * Loads PDFs, manages normalized highlights and attached
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
 * PDF bytes never leave the browser.
 */

import { createId } from "../app/store.js";
import {
  commitAnnotationHistory,
  createAnnotationHistory,
  DEFAULT_ANNOTATION_HISTORY_LIMIT,
  DEFAULT_HIGHLIGHT_COLOR,
  getPdfHighlightBounds,
  normalizeHighlight,
  redoAnnotationHistory,
  sanitizeAnnotations,
  undoAnnotationHistory,
} from "./literature-analyzer-model.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandString,
} from "./current-tool-ai-adapter.mjs";

const { PDFDocument, StandardFonts, rgb } = globalThis.PDFLib;
globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = "../vendor/pdf.worker.min.js";

const STORAGE_KEY = "pinakes-vitae-literature-analyzer-v1";
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_SAVED_SOURCES = 50;
const COMMENT_HISTORY_IDLE_MS = 700;
const MAX_DRAWING_STROKES = 500;
const MAX_DRAWING_POINTS = 1500;

const fileInput = document.querySelector("#analysis-pdf-file");
const pdfDropZone = document.querySelector("#analysis-pdf-drop-zone");
const emptyState = pdfDropZone;
const pdfStage = document.querySelector("#analyzer-pdf-stage");
const pdfCanvas = document.querySelector("#analyzer-pdf-canvas");
const pdfContext = pdfCanvas.getContext("2d");
const pdfHighlightLayer = document.querySelector("#pdf-highlight-layer");
const clearButton = document.querySelector("#clear-highlights");
const deleteHighlightButton = document.querySelector("#delete-highlight");
const exportPngButton = document.querySelector("#export-analysis-png");
const exportPdfButton = document.querySelector("#export-analysis-pdf");
const previousPageButton = document.querySelector("#analysis-previous-page");
const nextPageButton = document.querySelector("#analysis-next-page");
const pageCount = document.querySelector("#analysis-page-count");
const pageControls = document.querySelector(".analyzer-page-controls");
const status = document.querySelector("#analyzer-status");
const commentRail = document.querySelector("#analyzer-comment-rail");
const commentRailList = document.querySelector("#analyzer-comment-rail-list");
const commentDisplayToggle = document.querySelector("#comment-display-toggle");
const sideCommentsVisibility = document.querySelector("#side-comments-visibility");
const drawingColumn = document.querySelector("#analyzer-drawing-column");
const drawingPanel = document.querySelector("#analyzer-drawing-panel");
const drawingVisibilityToggle = document.querySelector("#drawing-visibility-toggle");
const drawingCanvas = document.querySelector("#analyzer-drawing-canvas");
const drawingContext = drawingCanvas.getContext("2d");
const drawingColorInput = document.querySelector("#drawing-color");
const drawingSizeInput = document.querySelector("#drawing-size");
const undoDrawingButton = document.querySelector("#undo-drawing");
const clearDrawingButton = document.querySelector("#clear-drawing");

let source = null;
let pdfBytes = null;
let pdfDocument = null;
let currentPageNumber = 1;
let annotations = [];
let selectedAnnotationId = null;
let activeColor = DEFAULT_HIGHLIGHT_COLOR;
let editingCommentId = null;
let activeDraft = null;
let renderSequence = 0;
let annotationHistory = createAnnotationHistory([], DEFAULT_ANNOTATION_HISTORY_LIMIT);
let isCommentHistoryTransactionOpen = false;
let commentHistoryTimer = null;
let commentDisplayMode = "side";
let sideCommentsVisible = true;
let drawingPanelVisible = true;
let drawingTool = "pen";
let drawingColor = drawingColorInput.value;
let drawingSize = Number(drawingSizeInput.value);
let drawingStrokes = [];
let activeDrawingStroke = null;
let drawingPanelSized = false;

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
    };
    const restoredState = restoreSourceState(source.key);
    annotations = restoredState.annotations;
    drawingStrokes = restoredState.drawingStrokes;
    resetAnnotationHistory();
    selectedAnnotationId = null;
    editingCommentId = null;
    showSource();
    await renderPdfPage();
    setStatus(`${file.name} · kept local`);
  } catch (error) {
    console.error("Unable to open the selected PDF.", error);
    setStatus("Could not open PDF");
    window.alert("This PDF could not be opened. Password-protected or damaged PDFs may not be supported.");
  }
}

/**
 * Replaces the empty drop target with the active PDF surface.
 */
function showSource() {
  emptyState.hidden = true;
  pdfStage.hidden = false;
  drawingColumn.hidden = false;
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
  sizeDrawingCanvas(Math.floor(viewport.width), Math.floor(viewport.height));

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
 * Rebuilds highlights and floating margin comments on the active PDF page.
 */
function renderAnnotations() {
  const layer = getActiveLayer();
  if (layer) {
    layer.replaceChildren();
    getVisibleAnnotations().forEach((annotation) => {
      const mark = document.createElement("div");
      const index = annotations.indexOf(annotation) + 1;
      mark.className = "highlight-mark";
      mark.dataset.annotationId = annotation.id;
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute("aria-label", `Highlight ${index}${annotation.comment ? `: ${annotation.comment}` : ""}`);
      applyNormalizedRectangle(mark, annotation);
      applyHighlightColor(mark, annotation.color);
      mark.classList.toggle("is-selected", annotation.id === selectedAnnotationId);
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        selectAnnotation(annotation.id);
      });
      mark.addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        selectAnnotation(annotation.id);
      });

      const badge = document.createElement("span");
      badge.className = "highlight-badge";
      badge.textContent = String(index);
      const commentButton = document.createElement("button");
      commentButton.type = "button";
      commentButton.className = "highlight-comment-button";
      commentButton.textContent = annotation.comment.trim() ? "·" : "+";
      commentButton.title = annotation.comment.trim() ? "Show comment" : "Add comment";
      commentButton.setAttribute("aria-label", commentButton.title);
      commentButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (annotation.comment.trim()) {
          selectAnnotation(annotation.id);
          return;
        }
        beginCommentEdit(annotation.id);
      });
      mark.append(badge, commentButton);
      if (commentDisplayMode === "hover" && (annotation.comment.trim() || annotation.id === editingCommentId)) {
        mark.append(createHoverComment(annotation, index));
      }
      layer.append(mark);
    });
  }
  renderCommentRail();
  updateControls();
}

/**
 * Returns annotations visible on the active PDF page.
 *
 * @returns {Array<object>} Visible highlights.
 */
function getVisibleAnnotations() {
  return annotations.filter((annotation) => annotation.pageNumber === currentPageNumber);
}

/**
 * Rebuilds Word-style comments floating beside the visible document page.
 */
function renderCommentRail() {
  if (!source || commentDisplayMode !== "side") {
    commentRail.hidden = true;
    commentRailList.replaceChildren();
    return;
  }
  const commentedAnnotations = getVisibleAnnotations()
    .filter((annotation) => annotation.comment.trim() || annotation.id === editingCommentId)
    .sort((left, right) => left.y - right.y);
  if (!commentedAnnotations.length) {
    commentRail.hidden = true;
    commentRailList.replaceChildren();
    return;
  }

  commentRail.hidden = false;
  commentRail.classList.toggle("are-comments-hidden", !sideCommentsVisible);
  sideCommentsVisibility.textContent = sideCommentsVisible ? "Hide comments" : "Show comments";
  sideCommentsVisibility.setAttribute("aria-pressed", String(sideCommentsVisible));
  commentRailList.style.minHeight = "100%";
  const fragment = document.createDocumentFragment();
  commentedAnnotations.forEach((annotation) => {
    const index = annotations.indexOf(annotation) + 1;
    const card = document.createElement("article");
    card.className = "analyzer-comment-rail-card";
    card.dataset.commentAnnotationId = annotation.id;
    card.dataset.anchorY = String(annotation.y);
    card.style.top = `${annotation.y * 100}%`;
    card.style.setProperty("--annotation-color", annotation.color);
    card.classList.toggle("is-selected", annotation.id === selectedAnnotationId);
    card.tabIndex = 0;

    const heading = document.createElement("span");
    heading.className = "analyzer-comment-rail-heading";
    const number = document.createElement("strong");
    number.textContent = String(index);
    const location = document.createElement("span");
    location.textContent = `Page ${annotation.pageNumber}`;
    heading.append(number, location);

    card.append(heading);
    if (annotation.id === editingCommentId) {
      const editor = document.createElement("textarea");
      editor.className = "analyzer-comment-editor";
      editor.maxLength = 4000;
      editor.value = annotation.comment;
      editor.placeholder = "Write a comment…";
      editor.setAttribute("aria-label", `Edit comment for highlight ${index}`);
      editor.addEventListener("click", (event) => event.stopPropagation());
      editor.addEventListener("dblclick", (event) => event.stopPropagation());
      editor.addEventListener("input", () => updateAnnotationComment(annotation.id, editor.value));
      editor.addEventListener("blur", finishInlineCommentEdit);
      editor.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        editor.blur();
      });
      card.append(editor);
    } else {
      const comment = document.createElement("span");
      comment.className = "analyzer-comment-rail-copy";
      comment.textContent = annotation.comment;
      card.append(comment);
    }
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      selectAnnotationInPlace(annotation.id);
    });
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      beginCommentEdit(annotation.id);
    });
    card.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      selectAnnotationInPlace(annotation.id);
    });
    fragment.append(card);
  });
  commentRailList.replaceChildren(fragment);
  window.requestAnimationFrame(() => {
    positionFloatingComments();
    commentRailList.querySelector(".analyzer-comment-editor")?.focus();
  });
}

function createHoverComment(annotation, index) {
  const container = document.createElement("span");
  container.className = "highlight-hover-comment";
  container.addEventListener("click", (event) => {
    event.stopPropagation();
    selectAnnotationInPlace(annotation.id);
  });
  container.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    beginCommentEdit(annotation.id);
  });
  if (annotation.id !== editingCommentId) {
    container.textContent = annotation.comment;
    return container;
  }
  const editor = document.createElement("textarea");
  editor.className = "analyzer-comment-editor";
  editor.maxLength = 4000;
  editor.value = annotation.comment;
  editor.placeholder = "Write a comment…";
  editor.setAttribute("aria-label", `Edit comment for highlight ${index}`);
  editor.addEventListener("input", () => updateAnnotationComment(annotation.id, editor.value));
  editor.addEventListener("blur", finishInlineCommentEdit);
  editor.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    editor.blur();
  });
  container.append(editor);
  window.requestAnimationFrame(() => editor.focus());
  return container;
}

/**
 * Prevents nearby margin comments from covering one another while retaining
 * their top-to-bottom relationship with the highlighted text.
 */
function positionFloatingComments() {
  if (commentRail.hidden) return;
  const cards = [...commentRailList.querySelectorAll(".analyzer-comment-rail-card")];
  const railHeight = commentRailList.clientHeight;
  let nextTop = 0;
  cards.forEach((card) => {
    const desiredTop = Number(card.dataset.anchorY || 0) * railHeight;
    const top = Math.max(desiredTop, nextTop);
    card.style.top = `${top}px`;
    nextTop = top + card.offsetHeight + 8;
  });
  commentRailList.style.minHeight = `${Math.max(railHeight, nextTop)}px`;
}

function beginCommentEdit(annotationId) {
  if (!annotations.some((annotation) => annotation.id === annotationId)) return;
  if (editingCommentId !== annotationId) finishCommentHistoryTransaction();
  selectedAnnotationId = annotationId;
  editingCommentId = annotationId;
  renderAnnotations();
}

function selectAnnotationInPlace(annotationId) {
  if (annotationId !== selectedAnnotationId) {
    finishCommentHistoryTransaction();
    editingCommentId = null;
  }
  selectedAnnotationId = annotationId;
  document.querySelectorAll("[data-annotation-id]").forEach((mark) => {
    mark.classList.toggle("is-selected", mark.dataset.annotationId === annotationId);
  });
  commentRailList.querySelectorAll("[data-comment-annotation-id]").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.commentAnnotationId === annotationId);
  });
  updateControls();
}

function updateAnnotationComment(annotationId, comment) {
  beginCommentHistoryTransaction();
  annotations = annotations.map((annotation) => (
    annotation.id === annotationId ? { ...annotation, comment } : annotation
  ));
  persistAnnotations();
  updateControls();
}

function finishInlineCommentEdit() {
  if (!editingCommentId) return;
  finishCommentHistoryTransaction();
  editingCommentId = null;
  renderAnnotations();
}

/**
 * Selects one highlight and optionally focuses its comment field.
 *
 * @param {string|null} annotationId Highlight identifier.
 */
function selectAnnotation(annotationId) {
  const nextAnnotationId = annotationId === selectedAnnotationId ? null : annotationId;
  if (nextAnnotationId !== selectedAnnotationId) {
    finishCommentHistoryTransaction();
    editingCommentId = null;
  }
  selectedAnnotationId = nextAnnotationId;
  renderAnnotations();
}

/**
 * Starts a highlight rectangle on an active annotation surface.
 *
 * @param {PointerEvent} event Pointer-down event.
 */
function startHighlight(event) {
  if (!source || !activeColor || event.target !== event.currentTarget) return;
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
    pageNumber: currentPageNumber,
    ...rectangle,
    color: activeColor,
    comment: "",
    createdAt: new Date().toISOString(),
  };
  finishCommentHistoryTransaction();
  annotationHistory = commitAnnotationHistory(annotationHistory, [...annotations, annotation]);
  annotations = annotationHistory.present;
  selectedAnnotationId = annotation.id;
  persistAnnotations();
  renderAnnotations();
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
 * Returns the active annotation layer.
 *
 * @returns {HTMLElement|null} PDF highlight layer.
 */
function getActiveLayer() {
  return source ? pdfHighlightLayer : null;
}

function getSelectedAnnotation() {
  return annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;
}

/**
 * Resets undo and redo when a different source becomes active.
 */
function resetAnnotationHistory() {
  cancelCommentHistoryTransaction();
  annotationHistory = createAnnotationHistory(annotations, DEFAULT_ANNOTATION_HISTORY_LIMIT);
  annotations = annotationHistory.present;
}

/**
 * Begins a coalesced comment-edit transaction.
 */
function beginCommentHistoryTransaction() {
  if (!isCommentHistoryTransactionOpen) {
    isCommentHistoryTransactionOpen = true;
  }
  if (commentHistoryTimer) window.clearTimeout(commentHistoryTimer);
  commentHistoryTimer = window.setTimeout(finishCommentHistoryTransaction, COMMENT_HISTORY_IDLE_MS);
}

/**
 * Commits a burst of comment typing as one undoable history step.
 */
function finishCommentHistoryTransaction() {
  if (commentHistoryTimer) {
    window.clearTimeout(commentHistoryTimer);
    commentHistoryTimer = null;
  }
  if (!isCommentHistoryTransactionOpen) return;
  isCommentHistoryTransactionOpen = false;
  annotationHistory = commitAnnotationHistory(annotationHistory, annotations);
  annotations = annotationHistory.present;
  updateControls();
}

/**
 * Drops transaction bookkeeping while switching sources.
 */
function cancelCommentHistoryTransaction() {
  if (commentHistoryTimer) window.clearTimeout(commentHistoryTimer);
  commentHistoryTimer = null;
  isCommentHistoryTransactionOpen = false;
}

/**
 * Commits a discrete annotation mutation after any active comment edit.
 *
 * @param {Array<object>} nextAnnotations Updated annotation collection.
 */
function commitAnnotationChange(nextAnnotations) {
  finishCommentHistoryTransaction();
  annotationHistory = commitAnnotationHistory(annotationHistory, nextAnnotations);
  annotations = annotationHistory.present;
}

/**
 * Restores the preceding annotation state.
 */
function undoAnnotations() {
  finishCommentHistoryTransaction();
  editingCommentId = null;
  const nextHistory = undoAnnotationHistory(annotationHistory);
  if (nextHistory === annotationHistory) return;
  annotationHistory = nextHistory;
  annotations = annotationHistory.present;
  if (!getSelectedAnnotation()) selectedAnnotationId = null;
  persistAnnotations();
  renderAnnotations();
  setStatus("Undid annotation change");
}

/**
 * Reapplies the next annotation state.
 */
function redoAnnotations() {
  finishCommentHistoryTransaction();
  editingCommentId = null;
  const nextHistory = redoAnnotationHistory(annotationHistory);
  if (nextHistory === annotationHistory) return;
  annotationHistory = nextHistory;
  annotations = annotationHistory.present;
  if (!getSelectedAnnotation()) selectedAnnotationId = null;
  persistAnnotations();
  renderAnnotations();
  setStatus("Redid annotation change");
}

/**
 * Restores validated annotations for one source identity.
 *
 * @param {string} sourceKey Source identity.
 * @returns {Array<object>} Restored highlights.
 */
function restoreSourceState(sourceKey) {
  try {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const savedSource = state.sources?.[sourceKey] || {};
    return {
      annotations: sanitizeAnnotations(savedSource.annotations),
      drawingStrokes: sanitizeDrawingStrokes(savedSource.drawingStrokes),
    };
  } catch (error) {
    console.error("Unable to restore saved literature annotations.", error);
    return { annotations: [], drawingStrokes: [] };
  }
}

function sanitizeDrawingStrokes(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_DRAWING_STROKES).map((stroke) => ({
    pageNumber: Math.max(1, Number.parseInt(stroke?.pageNumber, 10) || 1),
    tool: stroke?.tool === "eraser" ? "eraser" : "pen",
    color: /^#[0-9a-f]{6}$/i.test(stroke?.color) ? stroke.color : "#1b1d1a",
    size: Math.min(24, Math.max(1, Number(stroke?.size) || 4)),
    points: Array.isArray(stroke?.points)
      ? stroke.points.slice(0, MAX_DRAWING_POINTS).map((point) => ({
        x: Math.min(1, Math.max(0, Number(point?.x) || 0)),
        y: Math.min(1, Math.max(0, Number(point?.y) || 0)),
      }))
      : [],
  })).filter((stroke) => stroke.points.length);
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
      annotations,
      drawingStrokes,
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
 * Downloads the active annotated PDF page as a PNG.
 */
async function exportPng() {
  if (!source) return;
  try {
    exportPngButton.disabled = true;
    exportPngButton.textContent = "Preparing…";
    const outputCanvas = createPdfPageExportCanvas();
    const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The browser could not create the PNG.");
    downloadBlob(blob, `${safeBaseName(source.name)}-page-${currentPageNumber}-annotated.png`);
    setStatus("Annotated PNG downloaded");
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
 * Exports highlights into a copy of the original PDF.
 */
async function exportPdf() {
  if (!source) return;
  try {
    exportPdfButton.disabled = true;
    exportPdfButton.textContent = "Preparing…";
    const outputDocument = await createAnnotatedPdf();
    const outputBytes = await outputDocument.save();
    downloadBlob(
      new Blob([outputBytes], { type: "application/pdf" }),
      `${safeBaseName(source.name)}-annotated.pdf`,
    );
    setStatus("Annotated PDF downloaded");
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
    const location = `Page ${annotation.pageNumber}`;
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
    const location = `Page ${annotation.pageNumber}`;
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

function sizeDrawingCanvas(pageWidth, pageHeight) {
  if (!drawingPanelSized) {
    drawingPanel.style.width = `${Math.floor(pageWidth / 2)}px`;
    drawingPanel.style.height = `${Math.floor(pageHeight / 2)}px`;
    drawingPanelSized = true;
  }
  window.requestAnimationFrame(syncDrawingCanvasSize);
}

function syncDrawingCanvasSize() {
  if (drawingPanel.hidden || !drawingCanvas.clientWidth || !drawingCanvas.clientHeight) return;
  const pixelRatio = window.devicePixelRatio || 1;
  const width = drawingCanvas.clientWidth;
  const height = drawingCanvas.clientHeight;
  const nextWidth = Math.max(1, Math.floor(width * pixelRatio));
  const nextHeight = Math.max(1, Math.floor(height * pixelRatio));
  if (drawingCanvas.width === nextWidth && drawingCanvas.height === nextHeight) return;
  drawingCanvas.width = nextWidth;
  drawingCanvas.height = nextHeight;
  drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  renderDrawing();
}

function renderDrawing() {
  const pixelRatio = window.devicePixelRatio || 1;
  const width = drawingCanvas.width / pixelRatio;
  const height = drawingCanvas.height / pixelRatio;
  drawingContext.save();
  drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawingContext.clearRect(0, 0, width, height);
  drawingStrokes
    .filter((stroke) => stroke.pageNumber === currentPageNumber)
    .forEach((stroke) => drawStroke(stroke, width, height));
  if (activeDrawingStroke) drawStroke(activeDrawingStroke, width, height);
  drawingContext.restore();
}

function drawStroke(stroke, width, height) {
  if (!stroke.points.length) return;
  drawingContext.save();
  drawingContext.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  drawingContext.strokeStyle = stroke.color;
  drawingContext.lineWidth = stroke.tool === "eraser" ? stroke.size * 2.5 : stroke.size;
  drawingContext.lineCap = "round";
  drawingContext.lineJoin = "round";
  drawingContext.beginPath();
  stroke.points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) drawingContext.moveTo(x, y);
    else drawingContext.lineTo(x, y);
  });
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    drawingContext.lineTo(point.x * width + 0.01, point.y * height + 0.01);
  }
  drawingContext.stroke();
  drawingContext.restore();
}

function getDrawingPoint(event) {
  const bounds = drawingCanvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
}

function startDrawing(event) {
  if (!source || event.button !== 0) return;
  event.preventDefault();
  drawingCanvas.setPointerCapture(event.pointerId);
  activeDrawingStroke = {
    pageNumber: currentPageNumber,
    tool: drawingTool,
    color: drawingColor,
    size: drawingSize,
    points: [getDrawingPoint(event)],
  };
  renderDrawing();
}

function continueDrawing(event) {
  if (!activeDrawingStroke || !drawingCanvas.hasPointerCapture(event.pointerId)) return;
  event.preventDefault();
  if (activeDrawingStroke.points.length >= MAX_DRAWING_POINTS) return;
  const point = getDrawingPoint(event);
  const previousPoint = activeDrawingStroke.points.at(-1);
  if (Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) < 0.001) return;
  activeDrawingStroke.points.push(point);
  renderDrawing();
}

function finishDrawing(event) {
  if (!activeDrawingStroke) return;
  if (drawingCanvas.hasPointerCapture(event.pointerId)) drawingCanvas.releasePointerCapture(event.pointerId);
  drawingStrokes.push(activeDrawingStroke);
  drawingStrokes = drawingStrokes.slice(-MAX_DRAWING_STROKES);
  activeDrawingStroke = null;
  persistAnnotations();
  renderDrawing();
  updateDrawingControls();
}

function updateDrawingControls() {
  const pageStrokes = drawingStrokes.some((stroke) => stroke.pageNumber === currentPageNumber);
  undoDrawingButton.disabled = !pageStrokes;
  clearDrawingButton.disabled = !pageStrokes;
}

function updateControls() {
  const hasSource = Boolean(source);
  const hasPdf = hasSource && Boolean(pdfDocument);
  clearButton.disabled = !annotations.length;
  deleteHighlightButton.disabled = !getSelectedAnnotation();
  exportPngButton.disabled = !hasSource;
  exportPdfButton.disabled = !hasSource;
  previousPageButton.disabled = !hasPdf || currentPageNumber <= 1;
  nextPageButton.disabled = !hasPdf || currentPageNumber >= pdfDocument.numPages;
  pageControls.hidden = !hasPdf;
  pageCount.textContent = hasPdf ? `Page ${currentPageNumber} / ${pdfDocument.numPages}` : "Page 0 / 0";
  commentDisplayToggle.disabled = !hasSource;
  drawingVisibilityToggle.disabled = !hasSource;
  updateDrawingControls();
}

function setStatus(message) {
  status.textContent = message;
}

function clearHighlights() {
  if (!annotations.length) return;
  const confirmed = window.confirm("Clear every highlight and comment for this source?");
  if (!confirmed) return;
  commitAnnotationChange([]);
  selectedAnnotationId = null;
  editingCommentId = null;
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

document.querySelectorAll("[data-highlight-color]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextColor = activeColor === button.dataset.highlightColor
      ? null
      : button.dataset.highlightColor;
    setHighlightMode(nextColor);
    const selected = getSelectedAnnotation();
    if (selected && nextColor) {
      commitAnnotationChange(
        annotations.map((annotation) => (
          annotation.id === selected.id
            ? { ...annotation, color: nextColor }
            : annotation
        )),
      );
      persistAnnotations();
      renderAnnotations();
    }
  });
});

function setHighlightMode(color) {
  activeColor = color;
  document.querySelectorAll("[data-highlight-color]").forEach((candidate) => {
    const isActive = candidate.dataset.highlightColor === activeColor;
    candidate.classList.toggle("is-active", isActive);
    candidate.setAttribute("aria-checked", String(isActive));
  });
  pdfHighlightLayer.classList.toggle("is-drawing-mode", Boolean(activeColor));
  if (!activeColor) {
    finishCommentHistoryTransaction();
    selectedAnnotationId = null;
    editingCommentId = null;
    renderAnnotations();
  }
}

function deleteSelectedHighlight() {
  const selected = getSelectedAnnotation();
  if (!selected) return;
  commitAnnotationChange(annotations.filter((annotation) => annotation.id !== selected.id));
  selectedAnnotationId = null;
  editingCommentId = null;
  persistAnnotations();
  renderAnnotations();
  setStatus("Deleted selected highlight and comment");
}

commentDisplayToggle.addEventListener("click", () => {
  commentDisplayMode = commentDisplayMode === "side" ? "hover" : "side";
  const isSideMode = commentDisplayMode === "side";
  commentDisplayToggle.textContent = isSideMode ? "Comments: Side" : "Comments: Hover";
  commentDisplayToggle.title = isSideMode
    ? "Show comments only while hovering over highlights"
    : "Show comments beside the document";
  renderAnnotations();
});

sideCommentsVisibility.addEventListener("click", (event) => {
  event.stopPropagation();
  sideCommentsVisible = !sideCommentsVisible;
  renderCommentRail();
});

drawingVisibilityToggle.addEventListener("click", () => {
  drawingPanelVisible = !drawingPanelVisible;
  drawingColumn.classList.toggle("is-collapsed", !drawingPanelVisible);
  drawingPanel.hidden = !drawingPanelVisible;
  drawingVisibilityToggle.textContent = drawingPanelVisible ? "Hide drawing" : "Show drawing";
  drawingVisibilityToggle.setAttribute("aria-expanded", String(drawingPanelVisible));
  if (drawingPanelVisible) window.requestAnimationFrame(syncDrawingCanvasSize);
});

document.querySelectorAll("[data-drawing-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    drawingTool = button.dataset.drawingTool;
    document.querySelectorAll("[data-drawing-tool]").forEach((candidate) => {
      candidate.classList.toggle("is-active", candidate === button);
    });
  });
});
drawingColorInput.addEventListener("input", () => {
  drawingColor = drawingColorInput.value;
});
drawingSizeInput.addEventListener("input", () => {
  drawingSize = Number(drawingSizeInput.value);
});
undoDrawingButton.addEventListener("click", () => {
  const index = drawingStrokes.findLastIndex((stroke) => stroke.pageNumber === currentPageNumber);
  if (index < 0) return;
  drawingStrokes.splice(index, 1);
  persistAnnotations();
  renderDrawing();
  updateDrawingControls();
});
clearDrawingButton.addEventListener("click", () => {
  drawingStrokes = drawingStrokes.filter((stroke) => stroke.pageNumber !== currentPageNumber);
  persistAnnotations();
  renderDrawing();
  updateDrawingControls();
});
drawingCanvas.addEventListener("pointerdown", startDrawing);
drawingCanvas.addEventListener("pointermove", continueDrawing);
drawingCanvas.addEventListener("pointerup", finishDrawing);
drawingCanvas.addEventListener("pointercancel", finishDrawing);

clearButton.addEventListener("click", clearHighlights);
deleteHighlightButton.addEventListener("click", deleteSelectedHighlight);
exportPngButton.addEventListener("click", exportPng);
exportPdfButton.addEventListener("click", exportPdf);
previousPageButton.addEventListener("click", async () => {
  if (currentPageNumber <= 1) return;
  finishCommentHistoryTransaction();
  currentPageNumber -= 1;
  selectedAnnotationId = null;
  editingCommentId = null;
  await renderPdfPage();
});
nextPageButton.addEventListener("click", async () => {
  if (!pdfDocument || currentPageNumber >= pdfDocument.numPages) return;
  finishCommentHistoryTransaction();
  currentPageNumber += 1;
  selectedAnnotationId = null;
  editingCommentId = null;
  await renderPdfPage();
});

pdfHighlightLayer.addEventListener("pointerdown", startHighlight);
pdfHighlightLayer.addEventListener("pointermove", moveHighlight);
pdfHighlightLayer.addEventListener("pointerup", endHighlight);
pdfHighlightLayer.addEventListener("pointercancel", endHighlight);

document.addEventListener("keydown", (event) => {
  const editingText = event.target instanceof HTMLElement
    && event.target.matches("input, textarea, [contenteditable='true']");
  const isDeleteShortcut = event.key === "Delete" || event.key === "Backspace";
  if (isDeleteShortcut && selectedAnnotationId && !editingText) {
    event.preventDefault();
    deleteSelectedHighlight();
    return;
  }
  const hasCommandModifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLocaleLowerCase();
  const isUndoShortcut = hasCommandModifier && key === "z" && !event.shiftKey;
  const isRedoShortcut = hasCommandModifier
    && ((key === "z" && event.shiftKey) || key === "y");
  if (isUndoShortcut && source) {
    event.preventDefault();
    undoAnnotations();
  } else if (isRedoShortcut && source) {
    event.preventDefault();
    redoAnnotations();
  } else if (event.key === "Escape" && (activeColor || selectedAnnotationId)) {
    event.preventDefault();
    setHighlightMode(null);
  }
});
window.addEventListener("resize", positionFloatingComments);
new ResizeObserver(syncDrawingCanvasSize).observe(drawingPanel);

updateControls();

installCurrentToolAiHost({
  id: "literature-analyzer",
  title: "Literature Analyzer",
  description: "Reads the active source and its locally stored annotation record.",
  limitations: [
    "AI commands cannot choose a local PDF.",
    "Highlight geometry editing and annotated-file export remain explicit page actions.",
  ],
  getSnapshot: () => ({
    source: source ? { ...source } : null,
    currentPage: source ? currentPageNumber : null,
    pageCount: pdfDocument?.numPages ?? null,
    annotations: annotations.map((annotation) => ({ ...annotation })),
    selectedAnnotationId,
    commentLayout: commentDisplayMode,
    drawingStrokeCount: drawingStrokes.length,
  }),
  getContext: (_options, snapshot) => ({
    source: snapshot.source ? { loaded: true, type: snapshot.source.type } : null,
    currentPage: snapshot.currentPage,
    pageCount: snapshot.pageCount,
    annotationCount: snapshot.annotations.length,
    selectedAnnotationId: snapshot.selectedAnnotationId,
    commentLayout: snapshot.commentLayout,
  }),
  commands: [
    {
      type: "source.describe",
      description: "Describe the active PDF source.",
      permissions: ["read-content"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return {
          value: {
            source: state.source,
            currentPage: state.currentPage,
            pageCount: state.pageCount,
            annotationCount: state.annotations.length,
          },
        };
      },
    },
    {
      type: "annotations.list",
      description: "List annotation geometry, colors, and attached comments.",
      permissions: ["read-content"],
      schema: {
        type: "object",
        properties: { annotationId: { type: "string" } },
        additionalProperties: false,
      },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["annotationId"], commandIndex);
        const annotationId = command.annotationId === undefined
          ? ""
          : requireCommandString(
            command.annotationId,
            "annotationId",
            commandIndex,
            { maximumLength: 128 },
          );
        return {
          value: annotationId
            ? state.annotations.filter((annotation) => annotation.id === annotationId)
            : state.annotations,
        };
      },
    },
  ],
});
