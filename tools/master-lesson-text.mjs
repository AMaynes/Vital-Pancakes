/**
 * Normalizes page text while preserving the source page attached to every
 * character block. Uploaded text is untrusted and is never interpreted as HTML.
 */

const MIN_REPEAT_PAGES = 3;

/**
 * Removes repeated page furniture and repairs common extraction artifacts.
 *
 * @param {Array<{page: number, text: string, headingHints?: Array<object>}>} pages
 * @returns {Array<{page: number, text: string, headingHints: Array<object>}>}
 */
export function normalizePages(pages) {
  const validPages = Array.isArray(pages)
    ? pages
      .filter((page) => Number.isInteger(page?.page) && typeof page?.text === "string")
      .map((page) => ({
        page: page.page,
        text: page.text.replace(/\r\n?/g, "\n"),
        headingHints: Array.isArray(page.headingHints) ? page.headingHints : [],
      }))
    : [];
  const repeatedFurniture = findRepeatedFurniture(validPages);

  return validPages.map((page) => {
    const lines = page.text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((line, index, allLines) => {
        const isPageEdge = index <= 1 || index >= allLines.length - 2;
        return !isPageEdge || !repeatedFurniture.has(normalizeFurniture(line));
      });

    return {
      ...page,
      text: repairLines(lines).trim(),
    };
  });
}

/**
 * Splits plain text into source pages. Form feeds are treated as explicit page
 * boundaries; otherwise the document remains page 1 rather than inventing
 * citations.
 *
 * @param {string} text
 * @returns {Array<{page: number, text: string, headingHints: Array<object>}>}
 */
export function pagesFromPlainText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\f")
    .map((pageText, index) => ({
      page: index + 1,
      text: pageText,
      headingHints: collectMarkdownHeadingHints(pageText),
    }));
}

/**
 * @param {string} text
 * @returns {Array<{text: string, level: number}>}
 */
function collectMarkdownHeadingHints(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/))
    .filter(Boolean)
    .map((match) => ({
      text: match[2].trim(),
      level: Math.min(3, match[1].length),
      markdown: true,
    }));
}

/**
 * @param {Array<{text: string}>} pages
 * @returns {Set<string>}
 */
function findRepeatedFurniture(pages) {
  if (pages.length < MIN_REPEAT_PAGES) return new Set();
  const counts = new Map();

  pages.forEach((page) => {
    const lines = page.text.split("\n").map((line) => line.trim()).filter(Boolean);
    const edgeLines = [...lines.slice(0, 2), ...lines.slice(-2)];
    new Set(edgeLines.map(normalizeFurniture).filter(Boolean)).forEach((line) => {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    });
  });

  const threshold = Math.max(MIN_REPEAT_PAGES, Math.ceil(pages.length * 0.6));
  return new Set(
    [...counts.entries()]
      .filter(([line, count]) => count >= threshold && line.length <= 140)
      .map(([line]) => line),
  );
}

/**
 * @param {string} line
 * @returns {string}
 */
function normalizeFurniture(line) {
  return line
    .toLocaleLowerCase()
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {Array<string>} lines
 * @returns {string}
 */
function repairLines(lines) {
  const blocks = [];
  let paragraph = "";

  lines.forEach((line) => {
    const isHeading = looksLikeHeading(line);
    const isList = /^([-*•]|\d+[.)])\s+/.test(line);

    if (isHeading || isList) {
      if (paragraph) blocks.push(paragraph);
      blocks.push(line);
      paragraph = "";
      return;
    }

    if (!paragraph) {
      paragraph = line;
      return;
    }

    if (paragraph.endsWith("-") && /^[a-z]/.test(line)) {
      paragraph = `${paragraph.slice(0, -1)}${line}`;
      return;
    }

    paragraph += /[.!?:;”"')\]]$/.test(paragraph) ? `\n${line}` : ` ${line}`;
  });

  if (paragraph) blocks.push(paragraph);
  return blocks.join("\n\n");
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function looksLikeHeading(line) {
  const value = line.replace(/^#{1,6}\s+/, "").trim();
  return (
    /^#{1,6}\s+/.test(line)
    || /^(chapter|part|unit|section)\s+([ivxlcdm]+|\d+)\b/i.test(value)
    || /^\d+(?:\.\d+){0,3}\s+\S/.test(value)
    || (value.length >= 3 && value.length <= 90 && value === value.toUpperCase() && /[A-Z]/.test(value))
  );
}
