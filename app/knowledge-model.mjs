/**
 * Pure normalization, text search, backlinks, glossary, and graph policies.
 */

export const KNOWLEDGE_DOCUMENT_VERSION = 1;
export const GLOSSARY_VERSION = 1;
export const KNOWLEDGE_LINK_VERSION = 1;

const MAXIMUM_TEXT_LENGTH = 2_000_000;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from",
  "had", "has", "have", "he", "her", "his", "i", "if", "in", "into", "is", "it",
  "its", "not", "of", "on", "or", "our", "she", "that", "the", "their", "them",
  "there", "they", "this", "to", "was", "we", "were", "will", "with", "you", "your",
]);
const SENSITIVE_KEY = /(?:password|passphrase|credential|secret|privateSections?|cipher|encrypted|envelope|accessToken|refreshToken)/i;
const BINARY_KEY = /(?:blob|arrayBuffer|bytes|binary|dataUrl|base64)/i;

export function normalizeKnowledgeDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Knowledge documents must be objects.");
  }
  const id = cleanIdentifier(value.id, "document id");
  const title = cleanText(value.title, 500) || "Untitled entry";
  const text = cleanText(value.text, MAXIMUM_TEXT_LENGTH);
  const tags = normalizeTextArray(value.tags, 100, 160);
  const references = normalizeTextArray(value.references, 300, 500);
  const kind = cleanText(value.kind, 120) || "entry";
  const source = cleanText(value.source, 160) || "unknown";
  const recordId = cleanText(value.recordId, 500);
  const url = normalizeLocalUrl(value.url);
  return {
    version: KNOWLEDGE_DOCUMENT_VERSION,
    id,
    title,
    text,
    kind,
    source,
    recordId,
    url,
    tags,
    references,
    updatedAt: normalizeDate(value.updatedAt),
    fingerprint: hashText(`${title}\u0000${text}\u0000${tags.join("\u0000")}`),
  };
}

export function normalizeGlossaryEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Glossary entries must be objects.");
  }
  const term = cleanText(value.term, 300);
  if (!term) throw new TypeError("A glossary term is required.");
  const id = value.id ? cleanIdentifier(value.id, "glossary id") : `glossary-${hashText(term)}`;
  return {
    version: GLOSSARY_VERSION,
    id,
    term,
    definition: cleanText(value.definition, 100_000),
    aliases: normalizeTextArray(value.aliases, 100, 300),
    examples: normalizeTextArray(value.examples, 200, 20_000),
    links: normalizeTextArray(value.links, 200, 2_000),
    tags: normalizeTextArray(value.tags, 100, 160),
    createdAt: normalizeDate(value.createdAt),
    updatedAt: normalizeDate(value.updatedAt),
  };
}

export function normalizeKnowledgeLink(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Knowledge links must be objects.");
  }
  const sourceId = cleanIdentifier(value.sourceId, "source id");
  const targetId = cleanIdentifier(value.targetId, "target id");
  if (sourceId === targetId) throw new TypeError("A knowledge entry cannot link to itself.");
  const relation = cleanText(value.relation, 120) || "references";
  const origin = ["reference", "record", "manual", "ai"].includes(value.origin)
    ? value.origin
    : "manual";
  const status = origin === "ai"
    ? (["pending", "accepted", "rejected"].includes(value.status) ? value.status : "pending")
    : "accepted";
  return {
    version: KNOWLEDGE_LINK_VERSION,
    id: value.id
      ? cleanIdentifier(value.id, "link id")
      : `link-${hashText(`${sourceId}\u0000${targetId}\u0000${relation}\u0000${origin}`)}`,
    sourceId,
    targetId,
    relation,
    origin,
    status,
    rationale: cleanText(value.rationale, 4_000),
    createdAt: normalizeDate(value.createdAt),
    updatedAt: normalizeDate(value.updatedAt),
  };
}

export function searchKnowledgeDocuments(documents, query, options = {}) {
  const normalizedQuery = cleanText(query, 500).toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const queryTokens = tokenize(normalizedQuery);
  const kind = cleanText(options.kind, 120);
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 40));
  return documents
    .map(normalizeKnowledgeDocument)
    .filter((document) => !kind || document.kind === kind)
    .map((document) => {
      const title = document.title.toLocaleLowerCase();
      const body = document.text.toLocaleLowerCase();
      const tags = document.tags.join(" ").toLocaleLowerCase();
      let score = 0;
      if (title === normalizedQuery) score += 80;
      if (title.includes(normalizedQuery)) score += 25;
      if (body.includes(normalizedQuery)) score += 12;
      queryTokens.forEach((token) => {
        if (title.includes(token)) score += 8;
        if (tags.includes(token)) score += 5;
        score += Math.min(6, countOccurrences(body, token));
      });
      return {
        ...document,
        score,
        snippet: buildSnippet(document.text, normalizedQuery, queryTokens),
      };
    })
    .filter((document) => document.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || String(right.updatedAt).localeCompare(String(left.updatedAt))
      || left.title.localeCompare(right.title)
    ))
    .slice(0, limit);
}

export function buildAutomaticKnowledgeLinks(documents, glossaryEntries = []) {
  const normalizedDocuments = documents.map(normalizeKnowledgeDocument);
  const normalizedGlossary = glossaryEntries.map(normalizeGlossaryEntry);
  const targets = new Map();
  normalizedDocuments.forEach((document) => {
    [
      document.id,
      document.recordId,
      document.title,
    ].filter(Boolean).forEach((key) => addTarget(targets, key, document.id));
  });
  normalizedGlossary.forEach((entry) => {
    const targetId = `glossary:${entry.id}`;
    [entry.term, ...entry.aliases].forEach((key) => addTarget(targets, key, targetId));
  });

  const links = [];
  normalizedDocuments.forEach((document) => {
    const references = [
      ...extractWikiReferences(`${document.title}\n${document.text}`),
      ...document.references.map((target) => ({ target, label: target, relation: "record" })),
    ];
    references.forEach((reference) => {
      const targetId = targets.get(normalizeLookup(reference.target));
      if (!targetId || targetId === document.id) return;
      links.push(normalizeKnowledgeLink({
        sourceId: document.id,
        targetId,
        relation: reference.relation === "record" ? "record reference" : "references",
        origin: reference.relation === "record" ? "record" : "reference",
        rationale: reference.label,
      }));
    });
  });
  return deduplicateLinks(links);
}

export function extractWikiReferences(text) {
  const source = String(text ?? "");
  const references = [];
  const pattern = /\[\[([^\]\n]{1,500})\]\]/g;
  for (const match of source.matchAll(pattern)) {
    const [targetPart, labelPart] = match[1].split("|", 2).map((part) => part.trim());
    if (!targetPart) continue;
    references.push({
      target: targetPart,
      label: labelPart || targetPart,
      relation: "wiki",
    });
  }
  return references;
}

export function getBacklinks(documentId, links, documents, glossaryEntries = []) {
  const documentMap = createNodeMap(documents, glossaryEntries);
  return links
    .map(normalizeKnowledgeLink)
    .filter((link) => link.targetId === documentId && link.status === "accepted")
    .map((link) => ({ ...link, source: documentMap.get(link.sourceId) ?? null }))
    .filter((entry) => entry.source);
}

export function findRelatedDocuments(documentId, documents, links = [], options = {}) {
  const normalized = documents.map(normalizeKnowledgeDocument);
  const source = normalized.find((document) => document.id === documentId);
  if (!source) return [];
  const sourceTokens = new Set(tokenize(`${source.title} ${source.tags.join(" ")} ${source.text}`));
  const linked = new Set(
    links.map(normalizeKnowledgeLink).flatMap((link) => {
      if (link.status !== "accepted") return [];
      if (link.sourceId === documentId) return [link.targetId];
      if (link.targetId === documentId) return [link.sourceId];
      return [];
    }),
  );
  return normalized
    .filter((document) => document.id !== documentId)
    .map((document) => {
      const targetTokens = new Set(tokenize(`${document.title} ${document.tags.join(" ")} ${document.text}`));
      const overlap = [...sourceTokens].filter((token) => targetTokens.has(token));
      const denominator = Math.max(1, Math.sqrt(sourceTokens.size * targetTokens.size));
      const score = overlap.length / denominator + (linked.has(document.id) ? 1 : 0);
      return { ...document, relatedScore: score, sharedTerms: overlap.slice(0, 8) };
    })
    .filter((document) => document.relatedScore > 0.05)
    .sort((left, right) => right.relatedScore - left.relatedScore)
    .slice(0, Math.max(1, Math.min(50, Number(options.limit) || 8)));
}

export function buildKnowledgeGraph(documents, links, glossaryEntries = [], options = {}) {
  const limit = Math.max(10, Math.min(500, Number(options.limit) || 160));
  const normalizedDocuments = documents.map(normalizeKnowledgeDocument);
  const normalizedGlossary = glossaryEntries.map(normalizeGlossaryEntry);
  const allNodes = [
    ...normalizedDocuments.map((document) => ({
      id: document.id,
      label: document.title,
      kind: document.kind,
      url: document.url,
      source: document.source,
    })),
    ...normalizedGlossary.map((entry) => ({
      id: `glossary:${entry.id}`,
      label: entry.term,
      kind: "glossary",
      url: null,
      source: "glossary",
    })),
  ];
  const acceptedLinks = deduplicateLinks(
    links.map(normalizeKnowledgeLink).filter((link) => link.status === "accepted"),
  );
  const degree = new Map();
  acceptedLinks.forEach((link) => {
    degree.set(link.sourceId, (degree.get(link.sourceId) ?? 0) + 1);
    degree.set(link.targetId, (degree.get(link.targetId) ?? 0) + 1);
  });
  const nodes = allNodes
    .sort((left, right) => (
      (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0)
      || left.label.localeCompare(right.label)
    ))
    .slice(0, limit);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes: nodes.map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 })),
    links: acceptedLinks.filter((link) => nodeIds.has(link.sourceId) && nodeIds.has(link.targetId)),
    truncated: allNodes.length > nodes.length,
    totalNodes: allNodes.length,
  };
}

export function collectIndexableText(value, options = {}) {
  const parts = [];
  const visited = new WeakSet();
  const maximumLength = Math.max(1_000, Number(options.maximumLength) || MAXIMUM_TEXT_LENGTH);
  const maximumValues = Math.max(100, Number(options.maximumValues) || 50_000);
  let collectedLength = 0;
  let visitedValues = 0;

  function append(valuePart) {
    const separatorLength = parts.length ? 1 : 0;
    const remainingLength = maximumLength - collectedLength - separatorLength;
    if (remainingLength <= 0) return;
    const text = String(valuePart).slice(0, remainingLength);
    if (!text) return;
    parts.push(text);
    collectedLength += separatorLength + text.length;
  }

  function visit(current, key = "") {
    if (collectedLength >= maximumLength || visitedValues >= maximumValues) return;
    visitedValues += 1;
    if (SENSITIVE_KEY.test(key) || BINARY_KEY.test(key)) return;
    if (typeof current === "string") {
      if (/^data:[^,]+;base64,/i.test(current)) return;
      append(current);
      return;
    }
    if (typeof current === "number" || typeof current === "boolean" || typeof current === "bigint") {
      append(current);
      return;
    }
    if (!current || typeof current !== "object" || current instanceof Blob || ArrayBuffer.isView(current)) return;
    if (visited.has(current)) return;
    visited.add(current);
    if (Array.isArray(current)) {
      current.forEach((entry) => visit(entry, key));
      return;
    }
    Object.entries(current).forEach(([entryKey, entryValue]) => visit(entryValue, entryKey));
  }

  visit(value);
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, maximumLength);
}

export function extractRecordReferences(value) {
  if (!value || typeof value !== "object") return [];
  const references = [];
  const referenceKey = /(?:Ids?|references?|links?|source(?:Book|Lesson|Record)?Id)$/i;
  Object.entries(value).forEach(([key, entry]) => {
    if (!referenceKey.test(key)) return;
    if (typeof entry === "string") references.push(entry);
    if (Array.isArray(entry)) {
      entry.filter((item) => typeof item === "string").forEach((item) => references.push(item));
    }
  });
  return [...new Set(references.map((reference) => reference.trim()).filter(Boolean))];
}

export function suggestLexicalRelationships(documents, links = [], options = {}) {
  const timestamp = normalizeDate(options.timestamp);
  const existing = new Set(links.map((link) => {
    const normalized = normalizeKnowledgeLink(link);
    return `${normalized.sourceId}\u0000${normalized.targetId}`;
  }));
  const suggestions = [];
  documents.map(normalizeKnowledgeDocument).forEach((document) => {
    findRelatedDocuments(document.id, documents, [], { limit: 4 }).forEach((related) => {
      const [sourceId, targetId] = [document.id, related.id].sort();
      const key = `${sourceId}\u0000${targetId}`;
      if (existing.has(key) || related.relatedScore < 0.18) return;
      existing.add(key);
      suggestions.push(normalizeKnowledgeLink({
        sourceId,
        targetId,
        relation: "related concept",
        origin: "ai",
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
        rationale: related.sharedTerms.length
          ? `Shared terms: ${related.sharedTerms.join(", ")}`
          : "Potentially related content.",
      }));
    });
  });
  return suggestions
    .slice(0, Math.max(1, Math.min(100, Number(options.limit) || 20)));
}

export function deduplicateLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    const normalized = normalizeKnowledgeLink(link);
    const key = `${normalized.sourceId}\u0000${normalized.targetId}\u0000${normalized.relation}\u0000${normalized.origin}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(normalizeKnowledgeLink);
}

function createNodeMap(documents, glossaryEntries) {
  return new Map([
    ...documents.map(normalizeKnowledgeDocument).map((document) => [document.id, document]),
    ...glossaryEntries.map(normalizeGlossaryEntry).map((entry) => [
      `glossary:${entry.id}`,
      { id: `glossary:${entry.id}`, title: entry.term, kind: "glossary" },
    ]),
  ]);
}

function addTarget(targets, key, id) {
  const normalized = normalizeLookup(key);
  if (normalized && !targets.has(normalized)) targets.set(normalized, id);
}

function normalizeLookup(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function tokenize(value) {
  return [...String(value ?? "").normalize("NFKC").toLocaleLowerCase().matchAll(
    /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu,
  )]
    .map((match) => match[0])
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function buildSnippet(text, phrase, tokens) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const lower = source.toLocaleLowerCase();
  let index = lower.indexOf(phrase);
  if (index < 0) index = tokens.map((token) => lower.indexOf(token)).find((position) => position >= 0) ?? 0;
  const start = Math.max(0, index - 90);
  const end = Math.min(source.length, Math.max(index + phrase.length + 140, start + 260));
  return `${start ? "..." : ""}${source.slice(start, end).trim()}${end < source.length ? "..." : ""}`;
}

function countOccurrences(text, token) {
  let count = 0;
  let offset = 0;
  while (count < 6) {
    const index = text.indexOf(token, offset);
    if (index < 0) break;
    count += 1;
    offset = index + token.length;
  }
  return count;
}

function cleanIdentifier(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 700 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError(`A valid ${label} is required.`);
  }
  return normalized;
}

function cleanText(value, maximumLength) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximumLength);
}

function normalizeTextArray(value, maximumItems, maximumLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => cleanText(entry, maximumLength))
    .filter(Boolean))]
    .slice(0, maximumItems);
}

function normalizeDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
}

function normalizeLocalUrl(value) {
  const url = cleanText(value, 2_000);
  if (!url) return null;
  if (/^(?:javascript|data|vbscript):/i.test(url)) return null;
  return url;
}

function hashText(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
