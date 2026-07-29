/**
 * Detects and normalizes an editable chapter/subchapter hierarchy from
 * normalized source pages and PDF/Markdown heading hints.
 */

/**
 * @param {Array<{page: number, text: string, headingHints?: Array<object>}>} pages
 * @param {string} fallbackTitle
 * @returns {{title: string, nodes: Array<object>}}
 */
export function detectOutline(pages, fallbackTitle = "Untitled book") {
  const candidates = collectCandidates(pages);
  const titleCandidate = candidates.find((candidate) => candidate.page <= 2 && candidate.level === 1);
  const title = titleCandidate?.title || cleanFileTitle(fallbackTitle);
  const headings = candidates.filter((candidate) => candidate !== titleCandidate);
  const nodes = [];
  const parents = new Map();

  headings.forEach((heading, index) => {
    const level = Math.min(2, Math.max(1, heading.level));
    const id = `section-${index + 1}`;
    const parentId = level > 1 ? parents.get(level - 1) ?? null : null;
    nodes.push({
      id,
      parentId,
      level,
      kind: level === 1 ? "chapter" : "lesson",
      title: heading.title,
      pageStart: heading.page,
      pageEnd: heading.page,
    });
    parents.set(level, id);
    [...parents.keys()].filter((key) => key > level).forEach((key) => parents.delete(key));
  });

  if (!nodes.length) {
    const firstPage = pages[0]?.page ?? 1;
    const lastPage = pages.at(-1)?.page ?? firstPage;
    nodes.push({
      id: "section-1",
      parentId: null,
      level: 1,
      kind: "lesson",
      title: title === "Untitled book" ? "Complete document" : title,
      pageStart: firstPage,
      pageEnd: lastPage,
    });
  }

  assignPageEnds(nodes, pages.at(-1)?.page ?? 1);
  const orderedNodes = nodes.flatMap((node) => {
    const needsFallbackLesson = node.kind === "chapter"
      && !nodes.some((candidate) => candidate.parentId === node.id && candidate.kind === "lesson");
    if (!needsFallbackLesson) return [node];
    return [node, {
      id: `${node.id}-lesson`,
      parentId: node.id,
      level: 2,
      kind: "lesson",
      title: `${node.title} lesson`,
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
    }];
  });
  return { title, nodes: orderedNodes };
}

/**
 * Repairs user-edited or persisted outline records.
 *
 * @param {unknown} outline
 * @param {number} lastPage
 * @returns {{title: string, nodes: Array<object>}}
 */
export function normalizeOutline(outline, lastPage = 1) {
  const title = typeof outline?.title === "string" && outline.title.trim()
    ? outline.title.trim().slice(0, 300)
    : "Untitled book";
  const inputNodes = Array.isArray(outline?.nodes) ? outline.nodes : [];
  const ids = new Set();
  const nodes = inputNodes.flatMap((node, index) => {
    if (!node || typeof node !== "object") return [];
    const id = typeof node.id === "string" && node.id.trim() && !ids.has(node.id)
      ? node.id.trim()
      : `section-${index + 1}`;
    ids.add(id);
    const level = Number(node.level) === 2 ? 2 : 1;
    return [{
      id,
      parentId: level === 2 && typeof node.parentId === "string" ? node.parentId : null,
      level,
      kind: level === 1 && node.kind === "chapter" ? "chapter" : "lesson",
      title: String(node.title ?? `Lesson ${index + 1}`).trim().slice(0, 300) || `Lesson ${index + 1}`,
      pageStart: clampPage(node.pageStart, lastPage),
      pageEnd: clampPage(node.pageEnd ?? node.pageStart, lastPage),
    }];
  });
  const existingIds = new Set(nodes.map((node) => node.id));
  nodes.forEach((node) => {
    if (node.level === 2 && !existingIds.has(node.parentId)) {
      node.level = 1;
      node.parentId = null;
    }
    if (node.pageEnd < node.pageStart) node.pageEnd = node.pageStart;
  });
  return { title, nodes };
}

/**
 * @param {Array<object>} nodes
 * @param {string} nodeId
 * @returns {Array<object>}
 */
export function getLessonNodes(nodes, nodeId) {
  const selected = nodes.find((node) => node.id === nodeId);
  if (!selected) return [];
  if (selected.kind === "lesson") return [selected];
  return nodes.filter((node) => node.parentId === selected.id && node.kind === "lesson");
}

function collectCandidates(pages) {
  const candidates = [];
  const seen = new Set();
  pages.forEach((page) => {
    const hints = Array.isArray(page.headingHints) ? page.headingHints : [];
    hints.forEach((hint) => {
      addCandidate(candidates, seen, {
        title: cleanHeading(hint.text),
        level: hint.markdown
          ? Math.min(2, Math.max(1, Number(hint.level) - 1))
          : (Number(hint.level) <= 1 ? 1 : 2),
        page: page.page,
      });
    });
    page.text.split("\n").forEach((line) => {
      const candidate = classifyHeading(line);
      if (candidate) {
        addCandidate(candidates, seen, {
          ...candidate,
          page: candidate.targetPage ?? page.page,
        });
      }
    });
  });
  const ordered = candidates.sort((a, b) => a.page - b.page || a.order - b.order);
  const deduplicated = [];
  const titleIndexes = new Map();
  ordered.forEach((candidate) => {
    const key = candidate.title.toLocaleLowerCase();
    const existingIndex = titleIndexes.get(key);
    if (existingIndex === undefined) {
      titleIndexes.set(key, deduplicated.length);
      deduplicated.push(candidate);
    } else if (deduplicated[existingIndex].fromToc && !candidate.fromToc) {
      deduplicated[existingIndex] = candidate;
    }
  });
  return deduplicated;
}

function addCandidate(candidates, seen, candidate) {
  if (!candidate.title || candidate.title.length > 180) return;
  const key = `${candidate.page}:${candidate.title.toLocaleLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ ...candidate, order: candidates.length });
}

function classifyHeading(line) {
  const value = cleanHeading(line);
  if (!value || value.length < 2 || value.length > 180) return null;
  const tocMatch = value.match(/^(.+?)\.{2,}\s*(\d{1,4})$/);
  if (tocMatch) {
    const heading = classifyHeading(tocMatch[1]);
    return heading
      ? {
        ...heading,
        title: cleanHeading(tocMatch[1]),
        targetPage: Number(tocMatch[2]),
        fromToc: true,
      }
      : null;
  }
  if (/^(chapter|part|unit)\s+([ivxlcdm]+|\d+)\b/i.test(value)) {
    return { title: value, level: 1 };
  }
  if (/^\d+\.\d+(?:\.\d+)?\s+\S/.test(value)) {
    return { title: value, level: 2 };
  }
  if (/^\d+[.)]\s+[A-Z]/.test(value)) {
    return { title: value, level: 1 };
  }
  if (value.length <= 80 && value === value.toUpperCase() && /[A-Z]{3}/.test(value)) {
    return { title: titleCase(value), level: 1 };
  }
  return null;
}

function assignPageEnds(nodes, lastPage) {
  nodes.forEach((node, index) => {
    const nextAtSameOrHigher = nodes.slice(index + 1)
      .find((candidate) => candidate.level <= node.level);
    node.pageEnd = Math.max(node.pageStart, (nextAtSameOrHigher?.pageStart ?? lastPage + 1) - 1);
  });
}

function cleanHeading(value) {
  return String(value ?? "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFileTitle(value) {
  return String(value ?? "Untitled book")
    .replace(/\.(pdf|txt|md)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Untitled book";
}

function titleCase(value) {
  return value.toLocaleLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function clampPage(value, lastPage) {
  const page = Number.parseInt(value, 10);
  return Number.isInteger(page) ? Math.min(Math.max(1, page), Math.max(1, lastPage)) : 1;
}
