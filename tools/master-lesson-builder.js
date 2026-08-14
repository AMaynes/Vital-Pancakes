/**
 * Coordinates the local Master Lesson Builder interface. Source extraction,
 * retrieval, validation, persistence, and generation policy live in focused
 * modules so this file owns only browser workflow and rendering.
 */

import { addItem, getSection, updateItem } from "../app/store.js?v=16";
import { chunkPages, chunksForSection } from "./master-lesson-chunking.mjs";
import {
  deleteBookData,
  getBook,
  getBookRecords,
  getJob,
  getLesson,
  getSummary,
  listBooks,
  putBook,
  putJob,
  putLesson,
  putSummary,
  replaceBookRecords,
} from "./master-lesson-db.mjs";
import { extractDocument } from "./master-lesson-extraction.mjs?v=2";
import {
  detectOutline,
  getLessonNodes,
  normalizeOutline,
} from "./master-lesson-outline.mjs?v=3";
import {
  buildAggregateSummaryPrompt,
  buildChatPrompt,
  buildChunkSummaryPrompt,
  buildLessonPrompt,
  buildRegenerateFieldPrompt,
} from "./master-lesson-prompts.mjs";
import {
  cancelQueue,
  completeQueueItem,
  createGenerationQueue,
  failQueueItem,
  nextQueueItem,
  normalizeGenerationQueue,
  pauseQueue,
  resumeQueue,
  retryQueue,
} from "./master-lesson-queue.mjs";
import { createRetrievalIndex } from "./master-lesson-retrieval.mjs";
import { findSavedLesson, lessonToStudyEntry } from "./master-lesson-study.mjs";
import { normalizePages } from "./master-lesson-text.mjs?v=2";
import {
  applyReviewRating,
  buildQuizQuestion,
  buildReviewCardsFromLesson,
  calculateReviewStats,
  defaultReviewSettings,
  getReviewQueue,
  mergeGeneratedReviewCards,
  normalizeReviewSettings,
  previewReviewRatings,
  undoLastReview,
  validateReviewCard,
} from "./master-lesson-review.mjs";
import { createAdaptiveReviewStudio } from "./master-lesson-review-ui.mjs";
import {
  createEmptyLesson,
  parseStructuredJSON,
  validateChatAnswer,
  validateLesson,
  validatePersistedBook,
} from "./master-lesson-validation.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
  requireCommandString,
} from "./current-tool-ai-adapter.mjs";

const elements = Object.fromEntries([
  "webgpu-status", "model-select", "load-model", "cancel-model", "model-progress-wrap",
  "model-progress", "model-progress-text", "model-estimate", "lesson-upload", "book-file", "choose-book",
  "book-list", "lesson-empty-state", "lesson-book-workspace", "book-title", "book-file-meta",
  "export-book-json", "delete-book", "processing-strip", "processing-title",
  "processing-message", "processing-progress", "pause-generation", "resume-generation",
  "retry-generation", "cancel-generation", "add-outline-chapter", "add-outline-lesson",
  "save-outline", "generate-selected-lesson", "generate-selected-chapter", "generate-book",
  "outline-tree", "lesson-editor-empty", "lesson-editor", "lesson-editor-heading",
  "book-overview",
  "lesson-editor-fields", "export-lesson-json", "export-lesson-markdown", "save-to-studies",
  "lesson-preview-content", "clear-chat", "chat-log", "chat-form", "chat-question",
  "source-dialog", "source-dialog-eyebrow", "source-dialog-title", "source-dialog-text",
  "lesson-toast-region", "review-sync-selected", "review-sync-book", "review-stats",
  "review-mode-flashcards", "review-mode-quiz", "review-undo", "review-queue",
  "review-card-stage", "review-settings-form", "review-retention", "review-new-limit",
  "review-short-term", "review-all-cards", "review-history", "review-editor-dialog",
  "review-editor-form", "review-editor-id", "review-editor-front", "review-editor-back",
  "review-editor-close", "review-editor-cancel",
].map((id) => [id, document.getElementById(id)]));

const MODEL_DETAILS = {
  "Llama-3.2-1B-Instruct-q4f16_1-MLC": "Small model · roughly 0.8 GB download and 0.9 GB GPU memory",
  "Llama-3.2-3B-Instruct-q4f16_1-MLC": "Medium model · roughly 2.0 GB download and 2.3 GB GPU memory",
};
const LESSON_TEXT_FIELDS = [
  ["title", "Lesson title", "text"],
  ["subtitle", "Subtitle", "text"],
  ["overview", "Overview", "textarea"],
  ["learningObjectives", "Learning objectives · one per line", "list"],
  ["prerequisites", "Prerequisites · one per line", "list"],
  ["keyConcepts", "Key concepts · term | explanation", "pairs"],
  ["workedExamples", "Worked examples · one per line", "list"],
  ["commonMisconceptions", "Common misconceptions · one per line", "list"],
  ["reviewQuestions", "Review questions · one per line", "list"],
  ["flashcards", "Flashcards · question | answer", "flashcards"],
  ["recap", "Recap", "textarea"],
];

let books = [];
let activeBook = null;
let activePages = [];
let activeChunks = [];
let activeLesson = null;
let activeJob = null;
let processingController = null;
let modelWorker = null;
let modelReady = false;
let loadedModelId = null;
let modelLoadPromise = null;
let activeGenerationRequestId = null;
let generationRunning = false;
let lessonSaveTimer = null;
let bookSaveTimer = null;
const generationRequests = new Map();
const reviewStudio = createAdaptiveReviewStudio({
  getActiveBook: () => activeBook,
  getActiveLesson: () => activeLesson,
  captureActiveLesson: () => {
    if (activeLesson && !elements["lesson-editor"].hidden) captureLessonEditor();
  },
  showToast,
});

initialize();

async function initialize() {
  bindEvents();
  await detectWebGpu();
  await refreshBookList();
  const selectedBookId = sessionStorage.getItem("vital-pancakes-master-lesson-book");
  const firstBook = books.find((book) => book.id === selectedBookId) ?? books[0];
  if (firstBook) await loadBook(firstBook.id);
}

function bindEvents() {
  elements["choose-book"].addEventListener("click", (event) => {
    event.stopPropagation();
    elements["book-file"].click();
  });
  elements["lesson-upload"].addEventListener("click", (event) => {
    if (!event.target.closest("button")) elements["book-file"].click();
  });
  elements["lesson-upload"].addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      elements["book-file"].click();
    }
  });
  elements["book-file"].addEventListener("change", () => {
    const [file] = elements["book-file"].files;
    if (file) processFile(file);
    elements["book-file"].value = "";
  });
  ["dragenter", "dragover"].forEach((type) => elements["lesson-upload"].addEventListener(type, (event) => {
    event.preventDefault();
    elements["lesson-upload"].classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((type) => elements["lesson-upload"].addEventListener(type, (event) => {
    event.preventDefault();
    elements["lesson-upload"].classList.remove("is-dragging");
  }));
  elements["lesson-upload"].addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    if (file) processFile(file);
  });

  elements["load-model"].addEventListener("click", loadSelectedModel);
  elements["cancel-model"].addEventListener("click", cancelModelLoad);
  elements["model-select"].addEventListener("change", () => {
    const details = MODEL_DETAILS[elements["model-select"].value];
    elements["model-progress-text"].textContent = details;
    elements["model-estimate"].textContent = details.replace(/^(Small|Medium) model · roughly /, "About ");
  });
  document.querySelectorAll("[data-lesson-tab]").forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.lessonTab));
  });
  elements["book-title"].addEventListener("input", () => {
    if (!activeBook) return;
    activeBook.title = elements["book-title"].value;
    activeBook.outline.title = elements["book-title"].value;
    scheduleBookSave();
  });
  elements["save-outline"].addEventListener("click", saveOutline);
  elements["add-outline-chapter"].addEventListener("click", () => addOutlineNode("chapter"));
  elements["add-outline-lesson"].addEventListener("click", () => addOutlineNode("lesson"));
  elements["generate-selected-lesson"].addEventListener("click", () => generateSelection("lesson"));
  elements["generate-selected-chapter"].addEventListener("click", () => generateSelection("chapter"));
  elements["generate-book"].addEventListener("click", () => generateSelection("book"));
  elements["pause-generation"].addEventListener("click", pauseGeneration);
  elements["resume-generation"].addEventListener("click", resumeGeneration);
  elements["retry-generation"].addEventListener("click", retryGeneration);
  elements["cancel-generation"].addEventListener("click", cancelGeneration);
  elements["delete-book"].addEventListener("click", deleteActiveBook);
  elements["export-book-json"].addEventListener("click", exportBook);
  elements["export-lesson-json"].addEventListener("click", () => exportLesson("json"));
  elements["export-lesson-markdown"].addEventListener("click", () => exportLesson("markdown"));
  elements["save-to-studies"].addEventListener("click", saveLessonToStudies);
  elements["clear-chat"].addEventListener("click", clearChat);
  elements["chat-form"].addEventListener("submit", askTextbook);
  reviewStudio.bindEvents();
}

async function detectWebGpu() {
  if (!navigator.gpu) {
    setWebGpuStatus("WebGPU unavailable", "error");
    elements["load-model"].disabled = true;
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    setWebGpuStatus("WebGPU ready", "ready");
    return true;
  } catch {
    setWebGpuStatus("WebGPU unavailable", "error");
    elements["load-model"].disabled = true;
    return false;
  }
}

function setWebGpuStatus(text, state = "") {
  elements["webgpu-status"].textContent = text;
  elements["webgpu-status"].className = `lesson-status-badge${state ? ` is-${state}` : ""}`;
}

async function processFile(file) {
  if (processingController) {
    showToast("Wait for the current book to finish processing.");
    return;
  }
  processingController = new AbortController();
  elements["model-progress-wrap"].hidden = false;
  elements["model-progress"].value = 0;
  elements["model-progress-text"].textContent = "Preparing local extraction";
  showProcessing("Reading source", "Preparing local extraction", 0, 1, "extracting");
  try {
    const extraction = await extractDocument(
      file,
      ({ completed, total, message }) => {
        showProcessing("Reading source", message, completed, total, "extracting");
        elements["model-progress"].value = total ? completed / total : 0;
        elements["model-progress-text"].textContent = message;
      },
      processingController.signal,
    );
    if (extraction.scanned) {
      throw new Error("This PDF contains little or no extractable text. It appears scanned and requires OCR before lesson building.");
    }
    const pages = normalizePages(extraction.pages);
    if (!pages.some((page) => page.text.trim())) {
      throw new Error("No readable text was found in this document.");
    }
    const outline = detectOutline(pages, file.name);
    const chunks = chunkPages(pages, outline.nodes);
    const now = new Date().toISOString();
    const bookId = crypto.randomUUID?.() ?? `book-${Date.now()}`;
    const book = {
      id: bookId,
      title: outline.title,
      fileName: file.name,
      fileType: extraction.fileType,
      pageCount: pages.length,
      outline,
      selectedNodeId: outline.nodes.find((node) => node.kind === "lesson")?.id ?? outline.nodes[0]?.id ?? null,
      modelId: null,
      summaries: {},
      processing: { phase: "ready", completed: 0, total: 0, message: "", error: "" },
      createdAt: now,
      updatedAt: now,
    };
    showProcessing("Indexing source", `${chunks.length} page-aware chunks`, 1, 1, "extracting");
    await putBook(book);
    await replaceBookRecords("pages", bookId, pages);
    await replaceBookRecords("chunks", bookId, chunks);
    await refreshBookList();
    await loadBook(bookId);
    showToast(`Processed ${pages.length} page${pages.length === 1 ? "" : "s"} locally.`);
  } catch (error) {
    if (error.name !== "AbortError") showToast(error.message || "Unable to process that file.", true);
  } finally {
    processingController = null;
    if (!modelLoadPromise) elements["model-progress-wrap"].hidden = true;
    hideProcessingIfIdle();
  }
}

async function refreshBookList() {
  books = (await listBooks()).map(validatePersistedBook).filter(Boolean);
  renderBookList();
}

function renderBookList() {
  elements["book-list"].replaceChildren();
  if (!books.length) {
    elements["book-list"].append(createElement("p", "lesson-empty-copy", "Processed books will appear here."));
    return;
  }
  books.forEach((book) => {
    const button = createElement("button", "lesson-book-button");
    button.type = "button";
    button.setAttribute("aria-current", String(book.id === activeBook?.id));
    button.append(
      createElement("strong", "", book.title),
      createElement("span", "", `${book.pageCount} page${book.pageCount === 1 ? "" : "s"} · ${book.fileType.toUpperCase()}`),
    );
    button.addEventListener("click", () => loadBook(book.id));
    elements["book-list"].append(button);
  });
}

async function loadBook(bookId) {
  if (generationRunning) {
    showToast("Pause or cancel the current generation before switching books.", true);
    return;
  }
  const book = validatePersistedBook(await getBook(bookId));
  if (!book) {
    showToast("That saved book could not be read.", true);
    return;
  }
  activeBook = book;
  activePages = (await getBookRecords("pages", book.id))
    .filter((page) => Number.isInteger(page?.page) && typeof page?.text === "string")
    .sort((a, b) => a.page - b.page);
  activeChunks = (await getBookRecords("chunks", book.id))
    .filter((chunk) => typeof chunk?.id === "string" && typeof chunk?.text === "string")
    .sort((a, b) => a.wordStart - b.wordStart);
  const persistedJob = normalizeGenerationQueue(await getJob(book.id));
  activeJob = persistedJob.items.length ? persistedJob : null;
  activeLesson = null;
  sessionStorage.setItem("vital-pancakes-master-lesson-book", book.id);
  elements["lesson-empty-state"].hidden = true;
  elements["lesson-book-workspace"].hidden = false;
  elements["book-title"].value = book.title;
  elements["book-file-meta"].textContent = `${book.fileName} · ${book.pageCount} page${book.pageCount === 1 ? "" : "s"}`;
  renderBookList();
  renderOutline();
  renderBookOverview();
  renderJob();
  clearChat();
  await loadSelectedLesson();
  await reviewStudio.loadBook(book.id);
}

function renderOutline() {
  elements["outline-tree"].replaceChildren();
  activeBook.outline.nodes.forEach((node) => {
    const row = createElement("div", `lesson-outline-row${node.id === activeBook.selectedNodeId ? " is-selected" : ""}`);
    row.dataset.level = node.level;
    row.dataset.nodeId = node.id;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(node.level));

    const selectButton = createElement("button", "lesson-select-node", node.id === activeBook.selectedNodeId ? "●" : "○");
    selectButton.type = "button";
    selectButton.title = `Select ${node.title}`;
    selectButton.setAttribute("aria-label", `Select ${node.title}`);
    selectButton.addEventListener("click", () => selectOutlineNode(node.id));

    const title = document.createElement("input");
    title.value = node.title;
    title.maxLength = 300;
    title.setAttribute("aria-label", "Outline title");
    title.addEventListener("input", () => {
      node.title = title.value;
      scheduleBookSave();
    });

    const kind = document.createElement("select");
    kind.setAttribute("aria-label", "Outline level");
    [["chapter", "Chapter"], ["lesson", "Lesson"]].forEach(([value, label]) => {
      const option = new Option(label, value, value === node.kind, value === node.kind);
      kind.add(option);
    });
    kind.addEventListener("change", () => {
      node.kind = kind.value;
      node.level = kind.value === "chapter" ? 1 : 2;
      node.parentId = node.level === 2 ? findParentChapter(node.id)?.id ?? null : null;
      renderOutline();
      scheduleBookSave();
      if (node.id === activeBook.selectedNodeId) loadSelectedLesson();
    });

    const start = pageInput(node.pageStart, "Start page", (value) => { node.pageStart = value; });
    const end = pageInput(node.pageEnd, "End page", (value) => { node.pageEnd = value; });
    const remove = createElement("button", "lesson-delete-node", "×");
    remove.type = "button";
    remove.title = "Remove outline item";
    remove.setAttribute("aria-label", `Remove ${node.title}`);
    remove.addEventListener("click", () => removeOutlineNode(node.id));
    row.append(selectButton, title, kind, start, end, remove);
    elements["outline-tree"].append(row);
  });
}

function pageInput(value, label, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = String(activeBook.pageCount);
  input.value = String(value);
  input.setAttribute("aria-label", label);
  input.addEventListener("change", () => {
    const page = Math.min(activeBook.pageCount, Math.max(1, Number.parseInt(input.value, 10) || 1));
    input.value = String(page);
    onChange(page);
    scheduleBookSave();
  });
  return input;
}

async function selectOutlineNode(nodeId) {
  activeBook.selectedNodeId = nodeId;
  await putBook(touchBook(activeBook));
  renderOutline();
  await loadSelectedLesson();
}

function addOutlineNode(kind) {
  const id = `section-${crypto.randomUUID?.() ?? Date.now()}`;
  const parent = kind === "lesson"
    ? findParentChapter(activeBook.selectedNodeId) ?? activeBook.outline.nodes.find((node) => node.kind === "chapter")
    : null;
  const page = activeBook.outline.nodes.find((node) => node.id === activeBook.selectedNodeId)?.pageStart ?? 1;
  activeBook.outline.nodes.push({
    id,
    parentId: parent?.id ?? null,
    level: kind === "chapter" ? 1 : 2,
    kind,
    title: kind === "chapter" ? "New chapter" : "New lesson",
    pageStart: page,
    pageEnd: page,
  });
  activeBook.selectedNodeId = id;
  renderOutline();
  scheduleBookSave();
  loadSelectedLesson();
}

function removeOutlineNode(nodeId) {
  const node = activeBook.outline.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || !window.confirm(`Remove “${node.title}” from this outline? Generated lessons remain saved locally.`)) return;
  const childIds = new Set(activeBook.outline.nodes.filter((candidate) => candidate.parentId === nodeId).map(({ id }) => id));
  activeBook.outline.nodes = activeBook.outline.nodes.filter((candidate) => candidate.id !== nodeId && !childIds.has(candidate.id));
  activeBook.selectedNodeId = activeBook.outline.nodes[0]?.id ?? null;
  renderOutline();
  scheduleBookSave();
  loadSelectedLesson();
}

function findParentChapter(nodeId) {
  const nodes = activeBook.outline.nodes;
  const selected = nodes.find((node) => node.id === nodeId);
  if (selected?.kind === "chapter") return selected;
  if (selected?.parentId) return nodes.find((node) => node.id === selected.parentId) ?? null;
  const selectedIndex = nodes.findIndex((node) => node.id === nodeId);
  return nodes.slice(0, Math.max(0, selectedIndex + 1)).reverse().find((node) => node.kind === "chapter") ?? null;
}

async function saveOutline() {
  activeBook.outline = normalizeOutline(activeBook.outline, activeBook.pageCount);
  activeBook.title = elements["book-title"].value.trim() || activeBook.title;
  activeBook.outline.title = activeBook.title;
  activeChunks = chunkPages(activePages, activeBook.outline.nodes);
  await replaceBookRecords("chunks", activeBook.id, activeChunks);
  await putBook(touchBook(activeBook));
  await refreshBookList();
  renderOutline();
  showToast("Outline and page-aware chunks saved.");
}

function scheduleBookSave() {
  window.clearTimeout(bookSaveTimer);
  bookSaveTimer = window.setTimeout(async () => {
    activeBook.outline = normalizeOutline(activeBook.outline, activeBook.pageCount);
    await putBook(touchBook(activeBook));
    await refreshBookList();
  }, 450);
}

async function loadSelectedLesson() {
  const node = activeBook.outline.nodes.find((candidate) => candidate.id === activeBook.selectedNodeId);
  if (!node || node.kind !== "lesson") {
    activeLesson = null;
    renderLessonEditor();
    reviewStudio.render();
    return;
  }
  activeLesson = await getLesson(activeBook.id, node.id);
  renderLessonEditor();
  reviewStudio.render();
}

function renderLessonEditor() {
  const node = activeBook?.outline.nodes.find((candidate) => candidate.id === activeBook.selectedNodeId);
  const hasLessonNode = node?.kind === "lesson";
  elements["lesson-editor-empty"].hidden = Boolean(hasLessonNode);
  elements["lesson-editor"].hidden = !hasLessonNode;
  if (!hasLessonNode) {
    elements["lesson-editor-fields"].replaceChildren();
    renderLessonPreview();
    return;
  }
  activeLesson = createEmptyLesson(activeLesson ?? lessonSeed(node));
  elements["lesson-editor-heading"].textContent = activeLesson.title || node.title;
  elements["lesson-editor-fields"].replaceChildren();
  LESSON_TEXT_FIELDS.forEach(([field, label, type]) => {
    elements["lesson-editor-fields"].append(createLessonField(field, label, type));
  });
  elements["lesson-editor-fields"].insertBefore(
    createSectionsField(),
    elements["lesson-editor-fields"].children[6],
  );
  renderLessonPreview();
}

function createLessonField(field, labelText, type) {
  const wrapper = createElement("section", "lesson-editor-field");
  wrapper.dataset.field = field;
  const header = document.createElement("header");
  const label = createElement("label", "", labelText);
  label.htmlFor = `lesson-field-${field}`;
  const regenerate = createElement("button", "button button-small", "Regenerate");
  regenerate.type = "button";
  regenerate.addEventListener("click", () => regenerateField(field));
  header.append(label, regenerate);
  const input = type === "text" ? document.createElement("input") : document.createElement("textarea");
  input.id = `lesson-field-${field}`;
  input.name = field;
  if (type === "text") input.type = "text";
  else input.rows = field === "overview" || field === "recap" ? 5 : 4;
  input.value = lessonFieldValue(activeLesson[field], type);
  input.addEventListener("input", captureLessonEditor);
  wrapper.append(header, input);
  return wrapper;
}

function createSectionsField() {
  const wrapper = createElement("section", "lesson-editor-field");
  wrapper.dataset.field = "sections";
  const header = document.createElement("header");
  header.append(createElement("label", "", "Detailed lesson sections"));
  const add = createElement("button", "button button-small", "+ Section");
  add.type = "button";
  add.addEventListener("click", () => {
    captureLessonEditor();
    activeLesson.sections.push({ heading: "New section", content: "", citations: [] });
    renderLessonEditor();
  });
  header.append(add);
  wrapper.append(header);
  activeLesson.sections.forEach((section, index) => {
    const editor = createElement("div", "lesson-section-editor");
    editor.dataset.sectionIndex = String(index);
    const controls = document.createElement("header");
    const heading = document.createElement("input");
    heading.value = section.heading;
    heading.setAttribute("aria-label", `Section ${index + 1} heading`);
    heading.dataset.sectionHeading = String(index);
    heading.addEventListener("input", captureLessonEditor);
    const regenerate = createElement("button", "button button-small", "Regenerate");
    regenerate.type = "button";
    regenerate.addEventListener("click", () => regenerateSection(index));
    const remove = createElement("button", "button button-danger-quiet button-small", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
      captureLessonEditor();
      activeLesson.sections.splice(index, 1);
      renderLessonEditor();
      scheduleLessonSave();
    });
    controls.append(heading, regenerate, remove);
    const content = document.createElement("textarea");
    content.value = section.content;
    content.rows = 7;
    content.setAttribute("aria-label", `Section ${index + 1} content`);
    content.dataset.sectionContent = String(index);
    content.addEventListener("input", captureLessonEditor);
    const citations = createElement("div", "lesson-citations");
    section.citations.forEach((citation) => citations.append(createCitationButton(citation)));
    editor.append(controls, content, citations);
    wrapper.append(editor);
  });
  return wrapper;
}

function captureLessonEditor() {
  if (!activeLesson) return;
  LESSON_TEXT_FIELDS.forEach(([field, , type]) => {
    const input = elements["lesson-editor-fields"].querySelector(`[name="${field}"]`);
    if (input) activeLesson[field] = parseLessonField(input.value, type);
  });
  activeLesson.sections = [...elements["lesson-editor-fields"].querySelectorAll(".lesson-section-editor")]
    .map((editor, index) => ({
      heading: editor.querySelector(`[data-section-heading="${index}"]`)?.value.trim() || "Lesson section",
      content: editor.querySelector(`[data-section-content="${index}"]`)?.value.trim() ?? "",
      citations: activeLesson.sections[index]?.citations ?? [],
    }));
  activeLesson.sourcePages = [...new Set(
    activeLesson.sections.flatMap((section) => section.citations.map((citation) => citation.page)),
  )].sort((a, b) => a - b);
  elements["lesson-editor-heading"].textContent = activeLesson.title;
  renderLessonPreview();
  scheduleLessonSave();
}

function scheduleLessonSave() {
  window.clearTimeout(lessonSaveTimer);
  lessonSaveTimer = window.setTimeout(async () => {
    const nodeId = activeBook?.selectedNodeId;
    if (!nodeId || !activeLesson) return;
    await putLesson(activeBook.id, nodeId, activeLesson);
  }, 450);
}

function lessonFieldValue(value, type) {
  if (type === "list") return (value ?? []).join("\n");
  if (type === "pairs") return (value ?? []).map((entry) => `${entry.term} | ${entry.explanation}`).join("\n");
  if (type === "flashcards") return (value ?? []).map((entry) => `${entry.question} | ${entry.answer}`).join("\n");
  return String(value ?? "");
}

function parseLessonField(value, type) {
  if (type === "list") return lineList(value);
  if (type === "pairs") return pairList(value, "term", "explanation");
  if (type === "flashcards") return pairList(value, "question", "answer");
  return value.trim();
}

function lineList(value) {
  return String(value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function pairList(value, firstKey, secondKey) {
  return lineList(value).map((line) => {
    const separator = line.indexOf("|");
    const first = separator < 0 ? line : line.slice(0, separator);
    const second = separator < 0 ? "" : line.slice(separator + 1);
    return { [firstKey]: first.trim(), [secondKey]: second.trim() };
  });
}

function lessonSeed(node) {
  const chapter = activeBook.outline.nodes.find((candidate) => candidate.id === node.parentId);
  return {
    title: node.title,
    sourceTitle: activeBook.title,
    chapter: chapter?.title ?? (node.level === 1 ? node.title : ""),
    subchapter: node.level === 2 ? node.title : "",
  };
}

function renderLessonPreview() {
  const root = elements["lesson-preview-content"];
  root.replaceChildren();
  if (!activeLesson) {
    root.append(createElement("p", "lesson-empty-copy", "Select or generate a lesson to preview it."));
    return;
  }
  const article = document.createElement("article");
  const titlePage = createElement("header", "lesson-preview-title-page");
  titlePage.append(
    createElement("span", "", [activeLesson.chapter, activeLesson.subchapter].filter(Boolean).join(" · ") || activeLesson.sourceTitle),
    createElement("h1", "", activeLesson.title),
  );
  if (activeLesson.subtitle) titlePage.append(createElement("p", "", activeLesson.subtitle));
  article.append(titlePage);
  appendPreviewList(article, "Learning objectives", activeLesson.learningObjectives);
  appendPreviewList(article, "Prerequisites", activeLesson.prerequisites);
  appendPreviewPairs(article, "Key concepts", activeLesson.keyConcepts, "term", "explanation");
  if (activeLesson.overview) article.append(createElement("h2", "", "Overview"), createElement("p", "", activeLesson.overview));
  activeLesson.sections.forEach((section) => {
    article.append(createElement("h2", "", section.heading), createElement("p", "", section.content));
    const citations = createElement("div", "lesson-citations");
    section.citations.forEach((citation) => citations.append(createCitationButton(citation)));
    article.append(citations);
  });
  appendPreviewList(article, "Worked examples", activeLesson.workedExamples);
  appendPreviewList(article, "Common misconceptions", activeLesson.commonMisconceptions);
  appendPreviewList(article, "Review questions", activeLesson.reviewQuestions);
  appendPreviewPairs(article, "Flashcards", activeLesson.flashcards, "question", "answer");
  if (activeLesson.recap) article.append(createElement("h2", "", "Recap"), createElement("p", "", activeLesson.recap));
  root.append(article);
}

function appendPreviewList(parent, title, values) {
  if (!values?.length) return;
  parent.append(createElement("h2", "", title));
  const list = document.createElement("ul");
  values.forEach((value) => list.append(createElement("li", "", value)));
  parent.append(list);
}

function appendPreviewPairs(parent, title, values, firstKey, secondKey) {
  if (!values?.length) return;
  parent.append(createElement("h2", "", title));
  const grid = createElement("div", "lesson-preview-grid");
  values.forEach((value) => {
    const block = createElement("div", "lesson-preview-block");
    block.append(createElement("strong", "", value[firstKey]), createElement("p", "", value[secondKey]));
    grid.append(block);
  });
  parent.append(grid);
}

function createCitationButton(citation) {
  const button = createElement("button", "lesson-citation", `p. ${citation.page}`);
  button.type = "button";
  button.title = `${citation.chunkId} · source page ${citation.page}`;
  button.addEventListener("click", () => showSourcePage(citation.page, citation.chunkId));
  return button;
}

function showSourcePage(pageNumber, chunkId = "") {
  const page = activePages.find((candidate) => candidate.page === Number(pageNumber));
  elements["source-dialog-eyebrow"].textContent = chunkId || "SOURCE PAGE";
  elements["source-dialog-title"].textContent = `Page ${pageNumber}`;
  elements["source-dialog-text"].textContent = page?.text || "This source page is no longer available.";
  elements["source-dialog"].showModal();
}

async function generateSelection(scope) {
  if (!activeBook) return;
  if (!modelReady) {
    showToast("Load a local model before generating.", true);
    return;
  }
  await saveOutline();
  const selected = activeBook.outline.nodes.find((node) => node.id === activeBook.selectedNodeId);
  let lessons = [];
  if (scope === "book") {
    lessons = activeBook.outline.nodes.filter((node) => node.kind === "lesson");
  } else if (scope === "chapter") {
    const chapter = selected?.kind === "chapter" ? selected : findParentChapter(selected?.id);
    if (chapter) lessons = getLessonNodes(activeBook.outline.nodes, chapter.id);
  } else if (selected?.kind === "lesson") {
    lessons = [selected];
  }
  if (!lessons.length) {
    showToast(`Select a ${scope === "chapter" ? "chapter" : "lesson"} first.`, true);
    return;
  }
  activeJob = {
    ...createGenerationQueue(lessons.map((lesson) => lesson.id)),
    scope,
    state: "running",
  };
  await putJob(activeBook.id, activeJob);
  renderJob();
  runGenerationQueue();
}

async function runGenerationQueue() {
  if (generationRunning || !activeBook || activeJob.state !== "running") return;
  generationRunning = true;
  try {
    while (activeJob.state === "running") {
      const next = nextQueueItem(activeJob);
      activeJob = next.queue;
      if (!next.item) break;
      await putJob(activeBook.id, activeJob);
      renderJob();
      try {
        await generateLesson(next.item);
        activeJob = completeQueueItem(activeJob, next.item);
        await putJob(activeBook.id, activeJob);
        if (next.item === activeBook.selectedNodeId) await loadSelectedLesson();
      } catch (error) {
        if (
          activeJob.state === "cancelled"
          || error.name === "AbortError"
          || error.name === "PauseError"
        ) break;
        activeJob = failQueueItem(activeJob, next.item, error);
        await putJob(activeBook.id, activeJob);
      }
      renderJob();
    }
    if (activeJob.state === "complete" && activeJob.scope === "book") {
      activeJob = {
        ...activeJob,
        state: "running",
        aggregatePending: true,
        message: "Building chapter and book overviews",
      };
      await putJob(activeBook.id, activeJob);
      renderJob();
      try {
        await generateBookOverview();
        activeJob = {
          ...activeJob,
          state: "complete",
          aggregatePending: false,
          message: "Book generation complete",
        };
        await putJob(activeBook.id, activeJob);
        renderBookOverview();
      } catch (error) {
        if (
          error.name !== "AbortError"
          && error.name !== "PauseError"
          && activeJob.state !== "cancelled"
        ) {
          activeJob = { ...activeJob, state: "error", error: String(error.message ?? error) };
          await putJob(activeBook.id, activeJob);
        }
      }
    } else if (activeJob.state === "complete" && activeJob.scope === "chapter") {
      activeJob = {
        ...activeJob,
        state: "running",
        aggregatePending: true,
        message: "Building chapter overview",
      };
      await putJob(activeBook.id, activeJob);
      renderJob();
      try {
        await generateSelectedChapterOverview();
        activeJob = {
          ...activeJob,
          state: "complete",
          aggregatePending: false,
          message: "Chapter generation complete",
        };
        await putJob(activeBook.id, activeJob);
      } catch (error) {
        if (
          error.name !== "AbortError"
          && error.name !== "PauseError"
          && activeJob.state !== "cancelled"
        ) {
          activeJob = { ...activeJob, state: "error", error: String(error.message ?? error) };
          await putJob(activeBook.id, activeJob);
        }
      }
    }
  } finally {
    generationRunning = false;
    renderJob();
  }
}

async function generateLesson(lessonId) {
  const node = activeBook.outline.nodes.find((candidate) => candidate.id === lessonId);
  if (!node) throw new Error("The queued lesson is no longer in the outline.");
  const relevantChunks = chunksForSection(activeChunks, node.id, activeBook.outline.nodes);
  if (!relevantChunks.length) throw new Error(`No extracted source text overlaps “${node.title}”.`);
  const summaries = [];

  for (let index = 0; index < relevantChunks.length; index += 1) {
    assertJobCanContinue();
    const chunk = relevantChunks[index];
    const summaryId = `chunk:${chunk.id}`;
    let summary = await getSummary(activeBook.id, summaryId);
    if (!summary) {
      updateJobMessage(`Summarizing ${node.title} · chunk ${index + 1} of ${relevantChunks.length}`);
      const output = await requestGeneration(buildChunkSummaryPrompt(chunk), 650);
      summary = parseStructuredJSON(output);
      await putSummary(activeBook.id, summaryId, summary);
    }
    summaries.push(JSON.stringify(summary));
  }

  assertJobCanContinue();
  updateJobMessage(`Combining summaries for ${node.title}`);
  const sectionSummaryId = `section:${node.id}`;
  let sectionSummary = await getSummary(activeBook.id, sectionSummaryId);
  if (!sectionSummary) {
    const output = await requestGeneration(buildAggregateSummaryPrompt({
      label: node.title,
      summaries,
    }), 850);
    sectionSummary = parseStructuredJSON(output);
    await putSummary(activeBook.id, sectionSummaryId, sectionSummary);
  }

  assertJobCanContinue();
  updateJobMessage(`Writing lesson: ${node.title}`);
  const seed = lessonSeed(node);
  const output = await requestGeneration(buildLessonPrompt({
    bookTitle: activeBook.title,
    chapter: seed.chapter,
    subchapter: seed.subchapter,
    chunks: relevantChunks,
    summaries: [JSON.stringify(sectionSummary), ...summaries],
  }), 2800);
  const lesson = validateLesson(output, relevantChunks, seed);
  await putLesson(activeBook.id, lessonId, lesson);
}

async function generateBookOverview() {
  const chapterSummaries = [];
  for (const chapter of activeBook.outline.nodes.filter((node) => node.kind === "chapter")) {
    assertJobCanContinue();
    const lessons = getLessonNodes(activeBook.outline.nodes, chapter.id);
    const summaries = (await Promise.all(
      lessons.map((lesson) => getSummary(activeBook.id, `section:${lesson.id}`)),
    )).filter(Boolean).map(JSON.stringify);
    if (!summaries.length) continue;
    updateJobMessage(`Building chapter overview: ${chapter.title}`);
    const output = await requestGeneration(buildAggregateSummaryPrompt({ label: chapter.title, summaries }), 850);
    const summary = parseStructuredJSON(output);
    await putSummary(activeBook.id, `chapter:${chapter.id}`, summary);
    chapterSummaries.push(JSON.stringify(summary));
  }
  if (chapterSummaries.length) {
    assertJobCanContinue();
    updateJobMessage("Building complete book overview");
    const output = await requestGeneration(buildAggregateSummaryPrompt({
      label: activeBook.title,
      summaries: chapterSummaries,
    }), 1000);
    activeBook.summaries.book = parseStructuredJSON(output);
    await putSummary(activeBook.id, "book", activeBook.summaries.book);
    await putBook(touchBook(activeBook));
  }
}

async function generateSelectedChapterOverview() {
  assertJobCanContinue();
  const lessonIds = new Set(activeJob.items);
  const chapter = activeBook.outline.nodes.find((node) => (
    node.kind === "chapter"
    && activeBook.outline.nodes.some((candidate) => (
      candidate.parentId === node.id && lessonIds.has(candidate.id)
    ))
  ));
  if (!chapter) return;
  const summaries = (await Promise.all(
    activeJob.items.map((lessonId) => getSummary(activeBook.id, `section:${lessonId}`)),
  )).filter(Boolean).map(JSON.stringify);
  if (!summaries.length) return;
  const output = await requestGeneration(buildAggregateSummaryPrompt({
    label: chapter.title,
    summaries,
  }), 850);
  const summary = parseStructuredJSON(output);
  await putSummary(activeBook.id, `chapter:${chapter.id}`, summary);
  activeBook.summaries.chapters = {
    ...(activeBook.summaries.chapters ?? {}),
    [chapter.id]: summary,
  };
  await putBook(touchBook(activeBook));
}

function renderBookOverview() {
  const overview = activeBook?.summaries?.book;
  elements["book-overview"].hidden = !overview;
  elements["book-overview"].replaceChildren();
  if (!overview) return;
  elements["book-overview"].append(
    createElement("h2", "", "Book overview"),
    createElement("p", "", String(overview.summary ?? "")),
  );
  if (Array.isArray(overview.learningObjectives) && overview.learningObjectives.length) {
    const list = document.createElement("ul");
    overview.learningObjectives.forEach((objective) => list.append(createElement("li", "", String(objective))));
    elements["book-overview"].append(list);
  }
}

function assertJobCanContinue() {
  if (activeJob.state === "cancelled") throw new DOMException("Generation cancelled.", "AbortError");
  if (activeJob.state === "paused") {
    const error = new Error("Generation paused.");
    error.name = "PauseError";
    throw error;
  }
}

function pauseGeneration() {
  if (!activeJob) return;
  activeJob = pauseQueue(activeJob);
  activeJob.message = "Paused after the current model step";
  putJob(activeBook.id, activeJob);
  renderJob();
}

function resumeGeneration() {
  if (!activeJob) return;
  activeJob = resumeQueue(activeJob);
  putJob(activeBook.id, activeJob);
  renderJob();
  runGenerationQueue();
}

function retryGeneration() {
  if (!activeJob) return;
  activeJob = retryQueue(activeJob);
  putJob(activeBook.id, activeJob);
  renderJob();
  runGenerationQueue();
}

function cancelGeneration() {
  if (!activeJob) return;
  activeJob = cancelQueue(activeJob);
  if (activeGenerationRequestId) cancelGenerationRequest(activeGenerationRequestId);
  putJob(activeBook.id, activeJob);
  renderJob();
}

function updateJobMessage(message) {
  activeJob.message = message;
  putJob(activeBook.id, activeJob);
  renderJob();
}

function renderJob() {
  const job = activeJob;
  const visible = job && !["complete"].includes(job.state) && job.items.length;
  elements["processing-strip"].hidden = !visible;
  if (!job) return;
  const completed = job.completed.length;
  elements["processing-title"].textContent = {
    running: "Generating locally",
    paused: "Generation paused",
    cancelled: "Generation cancelled",
    error: "Generation needs attention",
    complete: "Generation complete",
  }[job.state] ?? "Lesson generation";
  elements["processing-message"].textContent = job.error || job.message || `${completed} of ${job.items.length} lessons`;
  elements["processing-progress"].max = Math.max(1, job.items.length);
  elements["processing-progress"].value = completed;
  elements["pause-generation"].hidden = job.state !== "running";
  elements["resume-generation"].hidden = !["paused", "cancelled"].includes(job.state);
  elements["retry-generation"].hidden = job.state !== "error";
  elements["cancel-generation"].hidden = !["running", "paused"].includes(job.state);
}

function showProcessing(title, message, completed, total, phase) {
  if (phase !== "extracting" && activeJob) return renderJob();
  elements["processing-strip"].hidden = false;
  elements["processing-title"].textContent = title;
  elements["processing-message"].textContent = message;
  elements["processing-progress"].max = Math.max(1, total);
  elements["processing-progress"].value = completed;
  elements["pause-generation"].hidden = true;
  elements["resume-generation"].hidden = true;
  elements["retry-generation"].hidden = true;
  elements["cancel-generation"].hidden = false;
  elements["cancel-generation"].onclick = () => processingController?.abort();
}

function hideProcessingIfIdle() {
  elements["cancel-generation"].onclick = null;
  if (activeJob) renderJob();
  else elements["processing-strip"].hidden = true;
}

async function regenerateField(field) {
  if (!modelReady || !activeLesson) return showToast("Load a local model first.", true);
  captureLessonEditor();
  const chunks = selectedLessonChunks();
  try {
    showProcessing("Regenerating field", field, 0, 1, "generation");
    const output = await requestGeneration(buildRegenerateFieldPrompt({
      field,
      currentLesson: activeLesson,
      chunks,
    }), 1200);
    const parsed = parseStructuredJSON(output);
    activeLesson = validateLesson({ ...activeLesson, [field]: parsed[field] }, chunks, lessonSeed(selectedNode()));
    await putLesson(activeBook.id, activeBook.selectedNodeId, activeLesson);
    renderLessonEditor();
    showToast(`${humanize(field)} regenerated.`);
  } catch (error) {
    showToast(error.message || "Unable to regenerate that field.", true);
  } finally {
    hideProcessingIfIdle();
  }
}

async function regenerateSection(index) {
  if (!modelReady || !activeLesson) return showToast("Load a local model first.", true);
  captureLessonEditor();
  const chunks = selectedLessonChunks();
  const sectionContext = { ...activeLesson, sections: [activeLesson.sections[index]] };
  try {
    showProcessing("Regenerating section", activeLesson.sections[index]?.heading ?? "Lesson section", 0, 1, "generation");
    const output = await requestGeneration(buildRegenerateFieldPrompt({
      field: "sections",
      currentLesson: sectionContext,
      chunks,
    }), 1400);
    const parsed = parseStructuredJSON(output);
    const replacement = validateLesson({ ...activeLesson, sections: parsed.sections }, chunks, lessonSeed(selectedNode())).sections[0];
    if (!replacement) throw new Error("The model did not return a usable lesson section.");
    activeLesson.sections[index] = replacement;
    await putLesson(activeBook.id, activeBook.selectedNodeId, activeLesson);
    renderLessonEditor();
    showToast("Lesson section regenerated.");
  } catch (error) {
    showToast(error.message || "Unable to regenerate that section.", true);
  } finally {
    hideProcessingIfIdle();
  }
}

function selectedNode() {
  return activeBook.outline.nodes.find((node) => node.id === activeBook.selectedNodeId);
}

function selectedLessonChunks() {
  return chunksForSection(activeChunks, activeBook.selectedNodeId, activeBook.outline.nodes);
}

async function askTextbook(event) {
  event.preventDefault();
  const question = elements["chat-question"].value.trim();
  if (!question) return;
  if (!activeBook) return showToast("Choose a processed book first.", true);
  if (!modelReady) return showToast("Load a local model before chatting.", true);
  const retrieved = createRetrievalIndex(activeChunks).search(question, 5);
  appendChatMessage("You", question, "user");
  elements["chat-question"].value = "";
  if (!retrieved.length) {
    appendChatAnswer({
      answer: "The available textbook text does not support a source-grounded answer.",
      citations: [],
    });
    return;
  }
  try {
    const output = await requestGeneration(buildChatPrompt(question, retrieved), 1100);
    appendChatAnswer(validateChatAnswer(output, retrieved));
  } catch (error) {
    appendChatMessage("Local model", error.message || "Unable to answer that question.", "answer");
  }
}

function appendChatMessage(label, text, type) {
  if (elements["chat-log"].querySelector(".lesson-empty-copy")) elements["chat-log"].replaceChildren();
  const message = createElement("article", `lesson-chat-message is-${type}`);
  message.append(createElement("strong", "", label), createElement("p", "", text));
  elements["chat-log"].append(message);
  elements["chat-log"].scrollTop = elements["chat-log"].scrollHeight;
  return message;
}

function appendChatAnswer(answer) {
  const message = appendChatMessage("Textbook answer", answer.answer, "answer");
  const footer = document.createElement("footer");
  answer.citations.forEach((citation) => footer.append(createCitationButton(citation)));
  if (activeLesson) {
    const addSection = createElement("button", "button button-small", "Add to lesson");
    addSection.type = "button";
    addSection.addEventListener("click", async () => {
      activeLesson.sections.push({
        heading: "From textbook chat",
        content: answer.answer,
        citations: answer.citations,
      });
      activeLesson.sourcePages = [...new Set([...activeLesson.sourcePages, ...answer.citations.map(({ page }) => page)])].sort((a, b) => a - b);
      await putLesson(activeBook.id, activeBook.selectedNodeId, activeLesson);
      renderLessonEditor();
      selectTab("lesson");
      showToast("Answer added to the lesson.");
    });
    footer.append(addSection);
  }
  const saveNote = createElement("button", "button button-small", "Save note");
  saveNote.type = "button";
  saveNote.addEventListener("click", () => {
    addItem("studies", {
      title: `Textbook note · ${activeBook.title}`,
      summary: answer.answer.slice(0, 220),
      researchQuestion: "",
      hypothesis: "",
      method: "",
      evidence: answer.citations.map(({ page, chunkId }) => `Page ${page} · ${chunkId}`),
      findings: answer.answer,
      limitations: "Generated locally from retrieved textbook excerpts; verify against the cited pages.",
      nextSteps: "",
      notes: "",
      tags: [activeBook.title, "textbook note"],
    });
    showToast("Textbook note saved to Studies.");
  });
  footer.append(saveNote);
  message.append(footer);
}

function clearChat() {
  elements["chat-log"].replaceChildren(createElement(
    "p",
    "lesson-empty-copy",
    activeBook ? "Ask a question about this processed textbook." : "Load a book and local model, then ask a question.",
  ));
}

async function saveLessonToStudies() {
  if (!activeLesson || !activeBook.selectedNodeId) return;
  captureLessonEditor();
  await putLesson(activeBook.id, activeBook.selectedNodeId, activeLesson);
  const studies = getSection("studies");
  const existing = findSavedLesson(studies, activeBook.id, activeBook.selectedNodeId);
  let copy = false;
  if (existing) {
    const replace = window.confirm("This lesson is already in Studies. Replace the saved version?");
    if (replace) {
      updateItem("studies", existing.id, lessonToStudyEntry({
        lesson: activeLesson,
        bookId: activeBook.id,
        lessonId: activeBook.selectedNodeId,
      }));
      showToast("Saved Study lesson replaced.");
      return;
    }
    copy = window.confirm("Save this lesson as a separate copy instead?");
    if (!copy) return;
  }
  addItem("studies", lessonToStudyEntry({
    lesson: activeLesson,
    bookId: activeBook.id,
    lessonId: activeBook.selectedNodeId,
    copy,
  }));
  showToast(copy ? "Lesson copy saved to Studies." : "Lesson saved to Studies.");
}

async function exportBook() {
  if (!activeBook) return;
  const [summaries, lessons, reviewCards, reviewLogs, reviewSettings] = await Promise.all([
    getBookRecords("summaries", activeBook.id),
    getBookRecords("lessons", activeBook.id),
    getBookRecords("reviewCards", activeBook.id),
    getBookRecords("reviewLogs", activeBook.id),
    getBookRecords("reviewSettings", activeBook.id),
  ]);
  downloadFile(
    `${safeFileName(activeBook.title)}-lesson-book.json`,
    JSON.stringify({
      book: activeBook,
      summaries,
      lessons,
      adaptiveReview: {
        cards: reviewCards,
        logs: reviewLogs,
        settings: reviewSettings[0] ?? defaultReviewSettings(),
      },
    }, null, 2),
    "application/json",
  );
}

function exportLesson(format) {
  if (!activeLesson) return;
  const baseName = safeFileName(activeLesson.title);
  if (format === "json") {
    downloadFile(`${baseName}.json`, JSON.stringify(activeLesson, null, 2), "application/json");
  } else {
    downloadFile(`${baseName}.md`, lessonToMarkdown(activeLesson), "text/markdown");
  }
}

async function deleteActiveBook() {
  if (!activeBook || !window.confirm(`Delete “${activeBook.title}” and all of its local extracted text, lessons, review cards, and history?`)) return;
  const bookId = activeBook.id;
  await deleteBookData(bookId);
  activeBook = null;
  activePages = [];
  activeChunks = [];
  activeLesson = null;
  activeJob = null;
  reviewStudio.clear();
  elements["lesson-book-workspace"].hidden = true;
  elements["lesson-empty-state"].hidden = false;
  await refreshBookList();
  const next = books.find((book) => book.id !== bookId);
  if (next) await loadBook(next.id);
  showToast("Book deleted from this browser.");
}

function selectTab(tabName) {
  document.querySelectorAll("[data-lesson-tab]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.lessonTab === tabName));
  });
  document.querySelectorAll("[data-lesson-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.lessonPanel !== tabName;
  });
  if (tabName === "review") reviewStudio.render();
}

async function loadSelectedModel() {
  if (modelLoadPromise) return modelLoadPromise;
  const modelId = elements["model-select"].value;
  elements["load-model"].disabled = true;
  elements["model-progress-wrap"].hidden = false;
  elements["model-progress"].value = 0;
  elements["model-progress-text"].textContent = MODEL_DETAILS[modelId];
  modelWorker ??= createModelWorker();
  modelLoadPromise = new Promise((resolve, reject) => {
    const handleReady = (event) => {
      if (event.data?.type === "model-ready" && event.data.modelId === modelId) {
        modelWorker.removeEventListener("message", handleReady);
        modelReady = true;
        loadedModelId = modelId;
        elements["model-progress-wrap"].hidden = true;
        elements["load-model"].disabled = false;
        elements["load-model"].textContent = "Model loaded";
        setWebGpuStatus("Local model ready", "ready");
        if (activeBook) {
          activeBook.modelId = modelId;
          putBook(touchBook(activeBook));
        }
        resolve();
      }
      if (event.data?.type === "model-error") {
        modelWorker.removeEventListener("message", handleReady);
        reject(new Error(event.data.error));
      }
    };
    modelWorker.addEventListener("message", handleReady);
    modelWorker.postMessage({ type: "load", modelId });
  }).catch((error) => {
    modelReady = false;
    elements["model-progress-wrap"].hidden = true;
    elements["load-model"].disabled = false;
    setWebGpuStatus("Model load failed", "error");
    showToast(error.message || "Unable to load the local model.", true);
  }).finally(() => {
    modelLoadPromise = null;
  });
  return modelLoadPromise;
}

function createModelWorker() {
  const worker = new Worker("./master-lesson-worker.js?v=1", { type: "module" });
  worker.addEventListener("message", (event) => {
    const message = event.data ?? {};
    if (message.type === "model-progress") {
      elements["model-progress"].value = Math.min(1, Math.max(0, Number(message.progress) || 0));
      elements["model-progress-text"].textContent = message.text || "Loading local model";
    }
    if (message.requestId && generationRequests.has(message.requestId)) {
      const request = generationRequests.get(message.requestId);
      if (message.type === "generation-stream") request.onStream?.(message.text);
      if (message.type === "generation-complete") {
        generationRequests.delete(message.requestId);
        activeGenerationRequestId = null;
        request.resolve(message.text);
      }
      if (message.type === "generation-error") {
        generationRequests.delete(message.requestId);
        activeGenerationRequestId = null;
        request.reject(new Error(message.error));
      }
    }
  });
  worker.addEventListener("error", (event) => {
    modelReady = false;
    setWebGpuStatus("Model worker failed", "error");
    generationRequests.forEach(({ reject }) => reject(new Error(event.message || "The local model worker stopped.")));
    generationRequests.clear();
  });
  return worker;
}

function cancelModelLoad() {
  if (processingController) {
    processingController.abort();
    return;
  }
  modelWorker?.terminate();
  modelWorker = null;
  modelReady = false;
  loadedModelId = null;
  modelLoadPromise = null;
  elements["model-progress-wrap"].hidden = true;
  elements["load-model"].disabled = false;
  elements["load-model"].textContent = "Load model";
  setWebGpuStatus("WebGPU ready", "ready");
}

function requestGeneration(prompt, maxTokens) {
  if (!modelReady || !modelWorker) return Promise.reject(new Error("Load a local model first."));
  const requestId = crypto.randomUUID?.() ?? `request-${Date.now()}-${Math.random()}`;
  activeGenerationRequestId = requestId;
  return new Promise((resolve, reject) => {
    generationRequests.set(requestId, {
      resolve,
      reject,
      onStream(text) {
        if (activeJob?.state === "running") {
          elements["processing-message"].textContent = `${activeJob.message || "Generating"} · ${text.length.toLocaleString()} characters`;
        }
      },
    });
    modelWorker.postMessage({
      type: "generate",
      requestId,
      system: prompt.system,
      user: prompt.user,
      maxTokens,
      temperature: 0.15,
    });
  });
}

function cancelGenerationRequest(requestId) {
  const request = generationRequests.get(requestId);
  if (request) {
    request.reject(new DOMException("Generation cancelled.", "AbortError"));
    generationRequests.delete(requestId);
  }
  modelWorker?.postMessage({ type: "cancel", requestId });
  activeGenerationRequestId = null;
}

function lessonToMarkdown(lesson) {
  const lines = [
    `# ${lesson.title}`,
    lesson.subtitle ? `\n_${lesson.subtitle}_` : "",
    `\n**Source:** ${lesson.sourceTitle}`,
    lesson.chapter ? `\n**Chapter:** ${lesson.chapter}` : "",
    lesson.subchapter ? `\n**Subchapter:** ${lesson.subchapter}` : "",
    lesson.overview ? `\n## Overview\n\n${lesson.overview}` : "",
    markdownList("Learning objectives", lesson.learningObjectives),
    markdownList("Prerequisites", lesson.prerequisites),
    lesson.keyConcepts.length ? `\n## Key concepts\n\n${lesson.keyConcepts.map(({ term, explanation }) => `- **${term}:** ${explanation}`).join("\n")}` : "",
    ...lesson.sections.map((section) => [
      `\n## ${section.heading}`,
      `\n${section.content}`,
      section.citations.length ? `\n\nSources: ${section.citations.map(({ page, chunkId }) => `p. ${page} (${chunkId})`).join(", ")}` : "",
    ].join("")),
    markdownList("Worked examples", lesson.workedExamples),
    markdownList("Common misconceptions", lesson.commonMisconceptions),
    markdownList("Review questions", lesson.reviewQuestions),
    lesson.flashcards.length ? `\n## Flashcards\n\n${lesson.flashcards.map(({ question, answer }) => `- **Q:** ${question}\n  **A:** ${answer}`).join("\n")}` : "",
    lesson.recap ? `\n## Recap\n\n${lesson.recap}` : "",
    lesson.sourcePages.length ? `\n## Source pages\n\n${lesson.sourcePages.join(", ")}` : "",
  ];
  return lines.filter(Boolean).join("\n").trim();
}

function markdownList(title, values) {
  return values?.length ? `\n## ${title}\n\n${values.map((value) => `- ${value}`).join("\n")}` : "";
}

function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value) {
  return String(value || "lesson")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "lesson";
}

function touchBook(book) {
  return { ...book, updatedAt: new Date().toISOString() };
}

function humanize(value) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function createElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function showToast(message, error = false) {
  const toast = createElement("div", `toast${error ? " is-error" : ""}`, message);
  elements["lesson-toast-region"].append(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 250);
  }, 3600);
}

installCurrentToolAiHost({
  id: "master-lesson-builder",
  title: "Master Lesson Builder",
  description: "Describes local textbook projects, outlines, and the selected generated lesson.",
  limitations: [
    "AI commands do not receive raw textbook pages or retrieval chunks.",
    "File import, model loading, generation, deletion, and export remain explicit user workflows.",
  ],
  getSnapshot: () => ({
    books: books.map((book) => ({
      id: book.id,
      title: book.title,
      fileName: book.fileName,
      fileType: book.fileType,
      pageCount: book.pageCount,
      selectedNodeId: book.selectedNodeId,
      processing: book.processing,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
    })),
    activeBook: activeBook
      ? {
        id: activeBook.id,
        title: activeBook.title,
        fileName: activeBook.fileName,
        fileType: activeBook.fileType,
        pageCount: activeBook.pageCount,
        outline: activeBook.outline,
        selectedNodeId: activeBook.selectedNodeId,
        processing: activeBook.processing,
      }
      : null,
    activeLesson: activeLesson ? createEmptyLesson(activeLesson) : null,
    generation: {
      running: generationRunning,
      modelReady,
      loadedModelId,
      job: activeJob,
    },
    review: reviewStudio.getSnapshot(),
  }),
  getContext: (_options, snapshot) => ({
    bookCount: snapshot.books.length,
    activeBook: snapshot.activeBook
      ? {
        id: snapshot.activeBook.id,
        pageCount: snapshot.activeBook.pageCount,
        selectedNodeId: snapshot.activeBook.selectedNodeId,
        outlineNodeCount: snapshot.activeBook.outline?.nodes?.length ?? 0,
      }
      : null,
    selectedLesson: snapshot.activeLesson
      ? {
        sectionCount: snapshot.activeLesson.sections.length,
        sourcePageCount: snapshot.activeLesson.sourcePages.length,
      }
      : null,
    generation: {
      running: snapshot.generation.running,
      modelReady: snapshot.generation.modelReady,
      loadedModelId: snapshot.generation.loadedModelId,
      jobState: snapshot.generation.job?.state ?? null,
    },
    review: {
      cards: snapshot.review.cards.length,
      due: getReviewQueue(snapshot.review.cards, new Date(), snapshot.review.settings).length,
      reviews: snapshot.review.logs.length,
      settings: snapshot.review.settings,
    },
  }),
  async commitSnapshot(nextState) {
    await reviewStudio.commitSnapshot(nextState.review);
  },
  commands: [
    {
      type: "books.list",
      description: "List local textbook projects without source page text.",
      permissions: ["read-content"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return { value: state.books };
      },
    },
    {
      type: "outline.get",
      description: "Read the active book's chapter and lesson outline.",
      permissions: ["read-content"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return {
          value: state.activeBook
            ? {
              bookId: state.activeBook.id,
              title: state.activeBook.title,
              outline: state.activeBook.outline,
              selectedNodeId: state.activeBook.selectedNodeId,
            }
            : null,
        };
      },
    },
    {
      type: "lesson.get",
      description: "Read the currently selected generated lesson and citations.",
      permissions: ["read-content"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return {
          value: state.activeLesson
            ? {
              bookId: state.activeBook?.id ?? null,
              lesson: state.activeLesson,
            }
            : null,
        };
      },
    },
    {
      type: "review.summary",
      description: "Read adaptive-review counts, due totals, and FSRS settings without card answers.",
      permissions: ["read-summary"],
      schema: { type: "object", additionalProperties: false },
      example: { type: "review.summary" },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        const stats = calculateReviewStats(state.review.cards);
        return {
          value: {
            ...stats,
            dueQueue: getReviewQueue(state.review.cards, new Date(), state.review.settings).length,
            reviewCount: state.review.logs.length,
            settings: state.review.settings,
          },
        };
      },
    },
    {
      type: "review.cards.list",
      description: "List adaptive-review cards including fronts, backs, sources, and schedule state.",
      permissions: ["read-content"],
      schema: {
        type: "object",
        properties: { lessonId: { type: "string" }, dueOnly: { type: "boolean" } },
        additionalProperties: false,
      },
      example: { type: "review.cards.list", dueOnly: true },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["lessonId", "dueOnly"], commandIndex);
        const source = command.dueOnly
          ? getReviewQueue(state.review.cards, new Date(), state.review.settings)
          : state.review.cards;
        return {
          value: source.filter((card) => !command.lessonId || card.lessonId === command.lessonId),
        };
      },
    },
    {
      type: "review.sync-selected-lesson",
      description: "Create or refresh cards from the selected lesson while preserving existing FSRS schedules and manual edits.",
      permissions: ["create", "update"],
      mutates: true,
      schema: { type: "object", additionalProperties: false },
      example: { type: "review.sync-selected-lesson" },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        if (!state.activeBook || !state.activeLesson || !state.activeBook.selectedNodeId) {
          throw new Error("Select a generated lesson before syncing review cards.");
        }
        const generated = buildReviewCardsFromLesson({
          lesson: state.activeLesson,
          bookId: state.activeBook.id,
          lessonId: state.activeBook.selectedNodeId,
        });
        if (!generated.length) throw new Error("The selected lesson has no flashcards or key concepts.");
        const cards = mergeGeneratedReviewCards(state.review.cards, generated);
        return {
          state: { ...state, review: { ...state.review, cards } },
          createdIds: cards
            .filter((card) => !state.review.cards.some((current) => current.id === card.id))
            .map((card) => card.id),
          updatedIds: cards
            .filter((card) => state.review.cards.some((current) => current.id === card.id))
            .map((card) => card.id),
          value: { generated: generated.length, total: cards.length },
        };
      },
    },
    {
      type: "review.cards.add",
      description: "Add one manual FSRS card to the active lesson.",
      permissions: ["create"],
      mutates: true,
      schema: {
        type: "object",
        required: ["front", "back"],
        properties: {
          front: { type: "string", maxLength: 20000 },
          back: { type: "string", maxLength: 100000 },
        },
        additionalProperties: false,
      },
      example: { type: "review.cards.add", front: "What is LTP?", back: "Persistent strengthening of synapses." },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["front", "back"], commandIndex);
        if (!state.activeBook?.id || !state.activeBook.selectedNodeId) {
          throw new Error("Select a lesson before adding a review card.");
        }
        const front = requireCommandString(command.front, "front", commandIndex, { maximumLength: 20_000 });
        const back = requireCommandString(command.back, "back", commandIndex, { maximumLength: 100_000 });
        const [seed] = buildReviewCardsFromLesson({
          lesson: {
            title: state.activeLesson?.title ?? "Manual review",
            flashcards: [{ question: front, answer: back }],
            sourcePages: state.activeLesson?.sourcePages ?? [],
          },
          bookId: state.activeBook.id,
          lessonId: state.activeBook.selectedNodeId,
        });
        const card = validateReviewCard({
          ...seed,
          id: `review-manual-${crypto.randomUUID?.() ?? Date.now()}`,
          sourceKey: `manual:${Date.now()}`,
          kind: "manual",
          manuallyEdited: true,
        });
        return {
          state: {
            ...state,
            review: { ...state.review, cards: [...state.review.cards, card] },
          },
          createdIds: [card.id],
          value: card,
        };
      },
    },
    {
      type: "review.cards.update",
      description: "Edit or suspend one adaptive-review card without resetting its schedule.",
      permissions: ["update"],
      mutates: true,
      schema: {
        type: "object",
        required: ["cardId", "changes"],
        properties: { cardId: { type: "string" }, changes: { type: "object" } },
        additionalProperties: false,
      },
      example: { type: "review.cards.update", cardId: "review-id", changes: { suspended: true } },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["cardId", "changes"], commandIndex);
        const cardId = requireCommandString(command.cardId, "cardId", commandIndex, { maximumLength: 500 });
        const changes = requireCommandRecord(command.changes, "changes", commandIndex);
        const unknown = Object.keys(changes).find((key) => !["front", "back", "suspended"].includes(key));
        if (unknown) throw new Error(`Unsupported review-card field: ${unknown}.`);
        const current = state.review.cards.find((card) => card.id === cardId);
        if (!current) throw new Error("Review card not found.");
        const card = validateReviewCard({
          ...current,
          ...(changes.front !== undefined ? {
            front: requireCommandString(changes.front, "changes.front", commandIndex, { maximumLength: 20_000 }),
            manuallyEdited: true,
          } : {}),
          ...(changes.back !== undefined ? {
            back: requireCommandString(changes.back, "changes.back", commandIndex, { maximumLength: 100_000 }),
            manuallyEdited: true,
          } : {}),
          ...(changes.suspended !== undefined ? { suspended: Boolean(changes.suspended) } : {}),
          updatedAt: new Date().toISOString(),
        });
        return {
          state: {
            ...state,
            review: {
              ...state.review,
              cards: state.review.cards.map((candidate) => candidate.id === cardId ? card : candidate),
            },
          },
          updatedIds: [cardId],
          value: card,
        };
      },
    },
    {
      type: "review.cards.delete",
      description: "Delete one review card without deleting its source lesson.",
      permissions: ["delete"],
      mutates: true,
      schema: {
        type: "object",
        required: ["cardId"],
        properties: { cardId: { type: "string" } },
        additionalProperties: false,
      },
      example: { type: "review.cards.delete", cardId: "review-id" },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["cardId"], commandIndex);
        const cardId = requireCommandString(command.cardId, "cardId", commandIndex, { maximumLength: 500 });
        if (!state.review.cards.some((card) => card.id === cardId)) throw new Error("Review card not found.");
        return {
          state: {
            ...state,
            review: {
              ...state.review,
              cards: state.review.cards.filter((card) => card.id !== cardId),
            },
          },
          deletedIds: [cardId],
        };
      },
    },
    {
      type: "review.rate",
      description: "Apply an Again, Hard, Good, or Easy grade through the local FSRS scheduler.",
      permissions: ["update"],
      mutates: true,
      schema: {
        type: "object",
        required: ["cardId", "rating"],
        properties: {
          cardId: { type: "string" },
          rating: { type: "string", enum: ["again", "hard", "good", "easy"] },
          reviewedAt: { type: "string" },
        },
        additionalProperties: false,
      },
      example: { type: "review.rate", cardId: "review-id", rating: "good" },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["cardId", "rating", "reviewedAt"], commandIndex);
        const cardId = requireCommandString(command.cardId, "cardId", commandIndex, { maximumLength: 500 });
        const card = state.review.cards.find((candidate) => candidate.id === cardId);
        if (!card) throw new Error("Review card not found.");
        const outcome = applyReviewRating(
          card,
          command.rating,
          command.reviewedAt ? new Date(command.reviewedAt) : new Date(),
          state.review.settings,
        );
        return {
          state: {
            ...state,
            review: {
              ...state.review,
              cards: state.review.cards.map((candidate) => candidate.id === cardId ? outcome.card : candidate),
              logs: [...state.review.logs, outcome.log],
            },
          },
          updatedIds: [cardId],
          value: { card: outcome.card, log: outcome.log },
        };
      },
    },
    {
      type: "review.settings.update",
      description: "Update bounded FSRS retention, interval, new-card, and learning-step settings.",
      permissions: ["update"],
      mutates: true,
      schema: {
        type: "object",
        required: ["changes"],
        properties: { changes: { type: "object" } },
        additionalProperties: false,
      },
      example: { type: "review.settings.update", changes: { requestRetention: 0.92, dailyNewLimit: 15 } },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["changes"], commandIndex);
        const changes = requireCommandRecord(command.changes, "changes", commandIndex);
        const unknown = Object.keys(changes).find((key) => (
          !["requestRetention", "maximumInterval", "dailyNewLimit", "enableShortTerm"].includes(key)
        ));
        if (unknown) throw new Error(`Unsupported review setting: ${unknown}.`);
        const settings = normalizeReviewSettings({ ...state.review.settings, ...changes });
        return {
          state: { ...state, review: { ...state.review, settings } },
          updatedIds: ["review-settings"],
          value: settings,
        };
      },
    },
  ],
});
