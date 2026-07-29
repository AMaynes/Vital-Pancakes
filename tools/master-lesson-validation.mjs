/**
 * Validates model and persistence output at trust boundaries. Citation records
 * survive only when both their chunk identifier and page occur in source data.
 */

const MAX_TEXT_LENGTH = 200_000;

export function createEmptyLesson(seed = {}) {
  return {
    title: cleanText(seed.title, "Untitled lesson"),
    subtitle: cleanText(seed.subtitle),
    sourceTitle: cleanText(seed.sourceTitle),
    chapter: cleanText(seed.chapter),
    subchapter: cleanText(seed.subchapter),
    overview: cleanText(seed.overview),
    learningObjectives: cleanStringArray(seed.learningObjectives),
    prerequisites: cleanStringArray(seed.prerequisites),
    keyConcepts: cleanObjectArray(seed.keyConcepts, ["term", "explanation"]),
    sections: cleanSections(seed.sections),
    workedExamples: cleanStringArray(seed.workedExamples),
    commonMisconceptions: cleanStringArray(seed.commonMisconceptions),
    reviewQuestions: cleanStringArray(seed.reviewQuestions),
    flashcards: cleanObjectArray(seed.flashcards, ["question", "answer"]),
    recap: cleanText(seed.recap),
    sourcePages: cleanPageArray(seed.sourcePages),
  };
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function parseStructuredJSON(value) {
  if (value && typeof value === "object") return value;
  const source = String(value ?? "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new SyntaxError("The model did not return a JSON object.");
  }
  const candidate = source
    .slice(firstBrace, lastBrace + 1)
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(candidate);
}

/**
 * @param {unknown} value
 * @param {Array<{id: string, pages: Array<number>}>} allowedChunks
 * @param {object} seed
 * @returns {object}
 */
export function validateLesson(value, allowedChunks = [], seed = {}) {
  const parsed = parseStructuredJSON(value);
  const lesson = createEmptyLesson({ ...seed, ...parsed });
  ["sourceTitle", "chapter", "subchapter"].forEach((field) => {
    if (typeof seed[field] === "string" && seed[field].trim()) {
      lesson[field] = seed[field].trim();
    }
  });
  const allowed = buildCitationMap(allowedChunks);
  lesson.sections = lesson.sections.map((section) => ({
    ...section,
    citations: validateCitations(section.citations, allowed),
  }));
  const citationPages = lesson.sections.flatMap((section) => section.citations.map(({ page }) => page));
  const allowedPages = new Set([...allowed.values()].flatMap((pages) => [...pages]));
  lesson.sourcePages = [...new Set([
    ...citationPages,
    ...lesson.sourcePages.filter((page) => allowedPages.has(page)),
  ])].sort((a, b) => a - b);
  return lesson;
}

/**
 * @param {unknown} value
 * @param {Array<{id: string, pages: Array<number>}>} allowedChunks
 * @returns {{answer: string, citations: Array<{page: number, chunkId: string}>}}
 */
export function validateChatAnswer(value, allowedChunks = []) {
  const parsed = parseStructuredJSON(value);
  const citations = validateCitations(parsed?.citations, buildCitationMap(allowedChunks));
  const answer = cleanText(parsed?.answer);
  if (!answer || !citations.length) {
    return {
      answer: "The available textbook text does not support a source-grounded answer.",
      citations: [],
    };
  }
  return { answer, citations };
}

/**
 * @param {unknown} value
 * @returns {object|null}
 */
export function validatePersistedBook(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string") return null;
  if (typeof value.title !== "string" || !Number.isInteger(value.pageCount) || value.pageCount < 1) {
    return null;
  }
  return {
    id: value.id,
    title: value.title.slice(0, 300),
    fileName: cleanText(value.fileName),
    fileType: ["pdf", "txt", "md"].includes(value.fileType) ? value.fileType : "txt",
    pageCount: value.pageCount,
    outline: value.outline && typeof value.outline === "object" ? value.outline : { title: value.title, nodes: [] },
    processing: normalizeProcessing(value.processing),
    selectedNodeId: typeof value.selectedNodeId === "string" ? value.selectedNodeId : null,
    modelId: typeof value.modelId === "string" ? value.modelId : null,
    summaries: value.summaries && typeof value.summaries === "object" ? value.summaries : {},
    createdAt: cleanText(value.createdAt),
    updatedAt: cleanText(value.updatedAt),
  };
}

function cleanSections(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .slice(0, 80)
    .map((entry) => ({
      heading: cleanText(entry.heading, "Lesson section"),
      content: cleanText(entry.content),
      citations: Array.isArray(entry.citations) ? entry.citations : [],
    }));
}

function cleanObjectArray(value, keys) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .slice(0, 200)
    .map((entry) => Object.fromEntries(keys.map((key) => [key, cleanText(entry[key])])));
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => cleanText(entry)).filter(Boolean).slice(0, 300);
}

function cleanPageArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((page) => Number.isInteger(page) && page > 0))]
    .sort((a, b) => a - b);
}

function cleanText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/\u0000/g, "").trim().slice(0, MAX_TEXT_LENGTH) || fallback;
}

function buildCitationMap(chunks) {
  return new Map(
    (Array.isArray(chunks) ? chunks : [])
      .filter((chunk) => typeof chunk?.id === "string" && Array.isArray(chunk.pages))
      .map((chunk) => [chunk.id, new Set(cleanPageArray(chunk.pages))]),
  );
}

function validateCitations(citations, allowed) {
  if (!Array.isArray(citations)) return [];
  const seen = new Set();
  return citations.flatMap((citation) => {
    const chunkId = typeof citation?.chunkId === "string" ? citation.chunkId : "";
    const page = Number(citation?.page);
    const key = `${chunkId}:${page}`;
    if (
      !chunkId
      || !Number.isInteger(page)
      || !allowed.get(chunkId)?.has(page)
      || seen.has(key)
    ) {
      return [];
    }
    seen.add(key);
    return [{ page, chunkId }];
  });
}

function normalizeProcessing(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
    phase: ["ready", "processing", "paused", "cancelled", "error", "complete"].includes(state.phase)
      ? state.phase
      : "ready",
    completed: Number.isInteger(state.completed) && state.completed >= 0 ? state.completed : 0,
    total: Number.isInteger(state.total) && state.total >= 0 ? state.total : 0,
    message: cleanText(state.message),
    error: cleanText(state.error),
  };
}
