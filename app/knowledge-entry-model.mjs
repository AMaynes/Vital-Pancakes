/**
 * Pure parsing and hierarchy helpers for rich Studies, Ideas, cooking guides,
 * and project maps. User-authored text stays plain text and is rendered by the
 * caller without injecting HTML.
 */

export const KNOWLEDGE_BLOCK_TYPES = Object.freeze([
  "text",
  "section",
  "subsection",
  "image",
  "diagram",
  "interactable",
  "video",
  "equation",
]);

const BLOCK_TYPE_SET = new Set(KNOWLEDGE_BLOCK_TYPES);

/**
 * Parses the compact block language used by the entry editor.
 *
 * Each block starts with `::type Optional title`. Everything until the next
 * directive is that block's body. Plain text without a directive becomes a
 * text block, so old notes remain readable.
 */
export function parseKnowledgeContent(source) {
  const text = String(source ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const blocks = [];
  let current = null;
  const commit = () => {
    if (!current) return;
    current.body = current.lines.join("\n").trim();
    delete current.lines;
    if (current.title || current.body) blocks.push(current);
  };

  text.split("\n").forEach((line) => {
    const match = /^::([a-z-]+)(?:\s+(.+))?\s*$/i.exec(line.trim());
    if (match && BLOCK_TYPE_SET.has(match[1].toLocaleLowerCase())) {
      commit();
      current = {
        id: "",
        type: match[1].toLocaleLowerCase(),
        title: String(match[2] ?? "").trim(),
        lines: [],
      };
      return;
    }
    current ??= { id: "", type: "text", title: "", lines: [] };
    current.lines.push(line);
  });
  commit();

  const counts = new Map();
  return blocks.map((block, index) => {
    const base = slugify(block.title || `${block.type}-${index + 1}`) || `block-${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return { ...block, id: count === 1 ? base : `${base}-${count}` };
  });
}

export function buildKnowledgeOutline(source) {
  return parseKnowledgeContent(source)
    .filter((block) => ["section", "subsection"].includes(block.type) && block.title)
    .map(({ id, title, type }) => ({ id, title, level: type === "section" ? 2 : 3 }));
}

/**
 * Reads `Term | definition | optional linked study id` lines.
 */
export function parseDefinitionLines(source) {
  return uniqueByFirstField(parsePipeRows(source, 3)
    .map(([term, definition, linkedStudyId]) => ({ term, definition, linkedStudyId }))
    .filter(({ term }) => term));
}

/**
 * Reads `Label | URL` lines used for linked notecards.
 */
export function parseNotecardLinks(source) {
  return parsePipeRows(source, 2)
    .map(([label, url]) => ({ label: label || url, url }))
    .filter(({ label, url }) => label && url);
}

/**
 * Reads `id | parent id | label | note | optional study id` project-map rows.
 * Missing and cyclic parents are promoted to the project root.
 */
export function parseProjectMap(source) {
  const nodes = parsePipeRows(source, 5).map(([id, parentId, label, note, studyId], index) => ({
    id: slugify(id || label) || `part-${index + 1}`,
    parentId: slugify(parentId),
    label: label || id || `Part ${index + 1}`,
    note,
    studyId,
  }));
  const unique = [];
  const seen = new Set();
  nodes.forEach((node) => {
    let id = node.id;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${node.id}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    unique.push({ ...node, id });
  });
  const ids = new Set(unique.map(({ id }) => id));
  return unique.map((node) => ({
    ...node,
    parentId: node.parentId && ids.has(node.parentId) && !createsCycle(node.id, node.parentId, unique)
      ? node.parentId
      : "",
  }));
}

export function buildProjectMapTree(source) {
  const nodes = parseProjectMap(source).map((node) => ({ ...node, children: [] }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = [];
  nodes.forEach((node) => {
    const parent = byId.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

export function normalizeFolderPath(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join(" / ");
}

export function normalizeFolderCatalog(entries, folders = []) {
  const normalized = [
    ...(Array.isArray(folders) ? folders : []),
    ...(Array.isArray(entries) ? entries.map((entry) => entry?.folderPath) : []),
  ]
    .map(normalizeFolderPath)
    .filter(Boolean);
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

export function groupEntriesByFolder(entries, folders = [], options = {}) {
  const groups = new Map();
  normalizeFolderCatalog(entries, folders).forEach((folder) => groups.set(folder, []));
  if (options.includeUnfiled) groups.set("Unfiled", []);
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const folder = normalizeFolderPath(entry?.folderPath) || "Unfiled";
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(entry);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === "Unfiled") return 1;
      if (right === "Unfiled") return -1;
      return left.localeCompare(right);
    })
    .map(([folder, folderEntries]) => ({ folder, entries: folderEntries }));
}

function parsePipeRows(source, width) {
  const rows = Array.isArray(source) ? source : String(source ?? "").split("\n");
  return rows
    .map((row) => String(row ?? "").trim())
    .filter(Boolean)
    .map((row) => {
      const values = row.split("|").map((value) => value.trim());
      return Array.from({ length: width }, (_, index) => values[index] ?? "");
    });
}

function uniqueByFirstField(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.term.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createsCycle(id, parentId, nodes) {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  let current = parentId;
  const visited = new Set([id]);
  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);
    current = parents.get(current) ?? "";
  }
  return false;
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
