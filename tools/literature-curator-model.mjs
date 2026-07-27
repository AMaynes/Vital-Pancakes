/**
 * Pure data policies for Literature Curation.
 *
 * The browser UI owns dialogs and persistence; this module validates the
 * localStorage trust boundary and keeps curation and analysis updates immutable.
 */

export const LITERATURE_CURATION_VERSION = 1;
export const CURATION_TARGET_TYPES = ["Idea", "Claim", "Hypothesis"];
export const ANALYSIS_RELATIONSHIPS = ["Supports", "Complicates", "Contradicts", "Context"];

const TITLE_LIMIT = 160;
const TEXT_LIMIT = 6000;
const CITATION_LIMIT = 600;
const URL_LIMIT = 1200;

export function sanitizeLiteratureCurations(payload) {
  const source = Array.isArray(payload) ? payload : payload?.curations;
  if (!Array.isArray(source)) return [];
  return source
    .map(sanitizeCuration)
    .filter(Boolean)
    .sort(sortByUpdatedAt);
}

export function sanitizeCuration(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const id = normalizeText(candidate.id, 128);
  const title = normalizeText(candidate.title, TITLE_LIMIT);
  if (!id || !title) return null;

  return {
    id,
    title,
    targetType: normalizeOption(candidate.targetType, CURATION_TARGET_TYPES, "Idea"),
    statement: normalizeText(candidate.statement, TEXT_LIMIT, true),
    synthesis: normalizeText(candidate.synthesis, TEXT_LIMIT, true),
    analyses: (Array.isArray(candidate.analyses) ? candidate.analyses : [])
      .map(sanitizeAnalysis)
      .filter(Boolean)
      .sort(sortByUpdatedAt),
    createdAt: normalizeTimestamp(candidate.createdAt),
    updatedAt: normalizeTimestamp(candidate.updatedAt),
  };
}

export function sanitizeAnalysis(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const id = normalizeText(candidate.id, 128);
  const sourceTitle = normalizeText(candidate.sourceTitle, TITLE_LIMIT);
  if (!id || !sourceTitle) return null;

  return {
    id,
    sourceTitle,
    citation: normalizeText(candidate.citation, CITATION_LIMIT, true),
    sourceUrl: normalizeUrl(candidate.sourceUrl),
    relationship: normalizeOption(candidate.relationship, ANALYSIS_RELATIONSHIPS, "Context"),
    finding: normalizeText(candidate.finding, TEXT_LIMIT, true),
    analysis: normalizeText(candidate.analysis, TEXT_LIMIT, true),
    notes: normalizeText(candidate.notes, TEXT_LIMIT, true),
    createdAt: normalizeTimestamp(candidate.createdAt),
    updatedAt: normalizeTimestamp(candidate.updatedAt),
  };
}

export function upsertCuration(curations, candidate) {
  const normalized = sanitizeCuration(candidate);
  if (!normalized) return sanitizeLiteratureCurations(curations);
  return [
    normalized,
    ...sanitizeLiteratureCurations(curations).filter((curation) => curation.id !== normalized.id),
  ].sort(sortByUpdatedAt);
}

export function removeCuration(curations, curationId) {
  return sanitizeLiteratureCurations(curations)
    .filter((curation) => curation.id !== curationId);
}

export function upsertAnalysis(curations, curationId, candidate) {
  const normalizedAnalysis = sanitizeAnalysis(candidate);
  if (!normalizedAnalysis) return sanitizeLiteratureCurations(curations);

  return sanitizeLiteratureCurations(curations).map((curation) => {
    if (curation.id !== curationId) return curation;
    const analyses = [
      normalizedAnalysis,
      ...curation.analyses.filter((analysis) => analysis.id !== normalizedAnalysis.id),
    ].sort(sortByUpdatedAt);
    return {
      ...curation,
      analyses,
      updatedAt: normalizedAnalysis.updatedAt || curation.updatedAt,
    };
  }).sort(sortByUpdatedAt);
}

export function removeAnalysis(curations, curationId, analysisId, updatedAt = "") {
  return sanitizeLiteratureCurations(curations).map((curation) => {
    if (curation.id !== curationId) return curation;
    return {
      ...curation,
      analyses: curation.analyses.filter((analysis) => analysis.id !== analysisId),
      updatedAt: normalizeTimestamp(updatedAt) || curation.updatedAt,
    };
  }).sort(sortByUpdatedAt);
}

export function countRelationships(analyses) {
  return Object.fromEntries(ANALYSIS_RELATIONSHIPS.map((relationship) => [
    relationship,
    (Array.isArray(analyses) ? analyses : [])
      .filter((analysis) => analysis.relationship === relationship)
      .length,
  ]));
}

function normalizeText(value, limit, preserveLines = false) {
  const source = String(value ?? "");
  const normalized = preserveLines
    ? source.replace(/\r\n?/g, "\n").trim()
    : source.replace(/\s+/g, " ").trim();
  return normalized.slice(0, limit);
}

function normalizeOption(value, options, fallback) {
  const normalized = normalizeText(value, 32);
  return options.includes(normalized) ? normalized : fallback;
}

function normalizeUrl(value) {
  const normalized = normalizeText(value, URL_LIMIT);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeTimestamp(value) {
  const timestamp = normalizeText(value, 40);
  return Number.isNaN(Date.parse(timestamp)) ? "" : timestamp;
}

function sortByUpdatedAt(first, second) {
  return (second.updatedAt || second.createdAt).localeCompare(first.updatedAt || first.createdAt);
}
