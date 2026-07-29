/**
 * Creates bounded, overlapping textbook chunks while carrying exact source-page
 * membership into every chunk.
 */

const DEFAULT_MAX_WORDS = 700;
const DEFAULT_OVERLAP_WORDS = 90;

/**
 * @param {Array<{page: number, text: string}>} pages
 * @param {Array<object>} outlineNodes
 * @param {{maxWords?: number, overlapWords?: number}} options
 * @returns {Array<object>}
 */
export function chunkPages(pages, outlineNodes = [], options = {}) {
  const maxWords = positiveInteger(options.maxWords, DEFAULT_MAX_WORDS);
  const overlapWords = Math.min(
    positiveInteger(options.overlapWords, DEFAULT_OVERLAP_WORDS),
    Math.max(0, maxWords - 1),
  );
  const units = pages.flatMap((page) => tokenizePage(page));
  if (!units.length) return [];

  const chunks = [];
  const step = maxWords - overlapWords;
  for (let start = 0; start < units.length; start += step) {
    const slice = units.slice(start, start + maxWords);
    if (!slice.length) break;
    const pageNumbers = [...new Set(slice.map((unit) => unit.page))];
    const section = findSection(outlineNodes, pageNumbers[0], pageNumbers.at(-1));
    chunks.push({
      id: `chunk-${String(chunks.length + 1).padStart(4, "0")}`,
      sectionId: section?.id ?? null,
      sectionTitle: section?.title ?? "Complete document",
      text: joinUnits(slice),
      pages: pageNumbers,
      pageStart: pageNumbers[0],
      pageEnd: pageNumbers.at(-1),
      wordStart: start,
      wordEnd: start + slice.length - 1,
    });
    if (start + maxWords >= units.length) break;
  }
  return chunks;
}

/**
 * @param {Array<object>} chunks
 * @param {string} sectionId
 * @param {Array<object>} outlineNodes
 * @returns {Array<object>}
 */
export function chunksForSection(chunks, sectionId, outlineNodes = []) {
  const selected = outlineNodes.find((node) => node.id === sectionId);
  if (!selected) return chunks.filter((chunk) => chunk.sectionId === sectionId);
  return chunks.filter((chunk) => (
    chunk.pageEnd >= selected.pageStart && chunk.pageStart <= selected.pageEnd
  ));
}

function tokenizePage(page) {
  if (!Number.isInteger(page?.page) || typeof page?.text !== "string") return [];
  const units = [];
  page.text.split(/(\s+)/).forEach((part) => {
    if (!part) return;
    if (/^\s+$/.test(part)) {
      if (units.length) units.at(-1).spaceAfter = part.includes("\n") ? "\n" : " ";
      return;
    }
    units.push({ text: part, page: page.page, spaceAfter: " " });
  });
  return units;
}

function joinUnits(units) {
  return units
    .map((unit, index) => `${unit.text}${index === units.length - 1 ? "" : unit.spaceAfter}`)
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function findSection(nodes, firstPage, lastPage) {
  const candidates = nodes
    .filter((node) => node.kind === "lesson")
    .filter((node) => lastPage >= node.pageStart && firstPage <= node.pageEnd)
    .sort((a, b) => b.level - a.level || a.pageStart - b.pageStart);
  return candidates[0] ?? null;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
