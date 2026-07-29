/**
 * Safe document parsing, outline, statistics, versioning, diff, and project
 * validation for Markdown & LaTeX Studio.
 */

export const STUDIO_FORMAT = "vital-pancakes-markdown-studio";
export const STUDIO_VERSION = 1;
export const DOCUMENT_MODES = new Set(["markdown", "markdown-math", "latex"]);

export function renderDocument(source, mode = "markdown") {
  if (!DOCUMENT_MODES.has(mode)) throw new TypeError(`Unsupported document mode: ${mode}.`);
  return mode === "latex" ? renderLatexPreview(source) : renderMarkdown(source, { math: mode === "markdown-math" });
}

export function renderMarkdown(source, options = {}) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let listType = null;
  let inCode = false;
  let codeLanguage = "";
  let codeLines = [];
  let inMath = false;
  let mathLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = null;
  };

  lines.forEach((line) => {
    const fence = /^```([\w-]*)\s*$/.exec(line);
    if (fence) {
      flushParagraph();
      closeList();
      if (inCode) {
        output.push(`<pre><code${codeLanguage ? ` class="language-${escapeAttribute(codeLanguage)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLines = [];
        codeLanguage = "";
      } else {
        inCode = true;
        codeLanguage = fence[1] ?? "";
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    if (options.math && /^\$\$\s*$/.test(line)) {
      flushParagraph();
      closeList();
      if (inMath) {
        output.push(mathMarkup(mathLines.join("\n"), true));
        mathLines = [];
        inMath = false;
      } else inMath = true;
      return;
    }
    if (inMath) {
      mathLines.push(line);
      return;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      const text = heading[2].trim();
      output.push(`<h${level} id="${slug(text)}">${inlineMarkdown(text, options.math)}</h${level}>`);
      return;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      closeList();
      output.push("<hr>");
      return;
    }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const type = ordered ? "ol" : "ul";
      if (listType !== type) {
        closeList();
        output.push(`<${type}>`);
        listType = type;
      }
      output.push(`<li>${inlineMarkdown((unordered || ordered)[1], options.math)}</li>`);
      return;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      output.push(`<blockquote>${inlineMarkdown(quote[1], options.math)}</blockquote>`);
      return;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      return;
    }
    paragraph.push(line.trim());
  });
  if (inCode) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  if (inMath) output.push(mathMarkup(mathLines.join("\n"), true));
  flushParagraph();
  closeList();
  return output.join("\n");
}

export function renderLatexPreview(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let inEquation = false;
  let equation = [];
  const flush = () => {
    if (!paragraph.length) return;
    output.push(`<p>${escapeHtml(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  lines.forEach((line) => {
    const section = /^\\(section|subsection|subsubsection)\*?\{([^}]*)\}/.exec(line.trim());
    if (section) {
      flush();
      const level = { section: 1, subsection: 2, subsubsection: 3 }[section[1]];
      output.push(`<h${level} id="${slug(section[2])}">${escapeHtml(section[2])}</h${level}>`);
      return;
    }
    if (/^\\begin\{(equation\*?|align\*?|displaymath)\}/.test(line.trim())) {
      flush();
      inEquation = true;
      return;
    }
    if (/^\\end\{(equation\*?|align\*?|displaymath)\}/.test(line.trim())) {
      output.push(mathMarkup(equation.join("\n"), true));
      equation = [];
      inEquation = false;
      return;
    }
    if (inEquation) {
      equation.push(line);
      return;
    }
    const title = /^\\(title|author)\{([^}]*)\}/.exec(line.trim());
    if (title) {
      flush();
      output.push(title[1] === "title" ? `<h1>${escapeHtml(title[2])}</h1>` : `<p><strong>${escapeHtml(title[2])}</strong></p>`);
      return;
    }
    if (/^\\(documentclass|usepackage|begin\{document\}|end\{document\}|maketitle)/.test(line.trim())) return;
    if (!line.trim()) flush();
    else paragraph.push(line.trim().replace(/\\\\$/, ""));
  });
  flush();
  return output.join("\n");
}

export function extractOutline(source, mode = "markdown") {
  const outline = [];
  String(source ?? "").replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
    if (mode === "latex") {
      const match = /^\\(section|subsection|subsubsection)\*?\{([^}]*)\}/.exec(line.trim());
      if (match) outline.push({ level: { section: 1, subsection: 2, subsubsection: 3 }[match[1]], text: match[2], line: index + 1, id: slug(match[2]) });
      return;
    }
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) outline.push({ level: match[1].length, text: stripInlineMarkup(match[2]), line: index + 1, id: slug(match[2]) });
  });
  return outline;
}

export function documentStatistics(source) {
  const text = String(source ?? "");
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return {
    characters: [...text].length,
    words,
    lines: text === "" ? 1 : text.split(/\r\n?|\n/).length,
    readingMinutes: words ? Math.max(1, Math.ceil(words / 220)) : 0,
  };
}

export function createVersion(document, source, reason = "Autosave", now = new Date()) {
  return {
    id: `version-${now.getTime()}`,
    at: now.toISOString(),
    reason,
    source: String(source),
    mode: document.mode,
  };
}

export function createLineDiff(before, after) {
  const left = String(before).split("\n");
  const right = String(after).split("\n");
  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = left[i] === right[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }
  const diff = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (left[i] === right[j]) {
      diff.push({ type: "same", text: left[i] });
      i += 1;
      j += 1;
    } else if (j < right.length && (i === left.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
      diff.push({ type: "add", text: right[j] });
      j += 1;
    } else {
      diff.push({ type: "remove", text: left[i] });
      i += 1;
    }
  }
  return diff;
}

export function validateStudioBackup(value) {
  if (!value || value.format !== STUDIO_FORMAT) throw new TypeError("This is not a Markdown & LaTeX Studio backup.");
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > STUDIO_VERSION) {
    throw new TypeError(`Unsupported Studio backup version: ${value.version}.`);
  }
  if (!Array.isArray(value.documents)) throw new TypeError("Studio backup documents are missing.");
  const ids = new Set();
  value.documents.forEach((document) => {
    if (!document?.id || ids.has(document.id)) throw new TypeError("Every document needs a unique id.");
    ids.add(document.id);
    if (document.name !== undefined
      && (typeof document.name !== "string" || !document.name.trim() || document.name.length > 220)) {
      throw new TypeError("Every document needs a valid name.");
    }
    if (!DOCUMENT_MODES.has(document.mode)) throw new TypeError(`Unsupported document mode: ${document.mode}.`);
    if (typeof document.source !== "string") throw new TypeError("Document source must be text.");
  });
  const migrated = structuredCloneSafe(value);
  migrated.documents = migrated.documents.map((document) => ({
    name: "Untitled.md",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    versions: [],
    ...document,
  }));
  return { ...migrated, version: STUDIO_VERSION };
}

export function sanitizeRenderedHtml(html) {
  if (typeof DOMParser !== "undefined") {
    const documentNode = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const allowed = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "STRONG", "EM", "DEL", "A", "HR", "BR", "SPAN", "DIV"]);
    [...documentNode.body.querySelectorAll("*")].forEach((node) => {
      if (!allowed.has(node.tagName)) {
        node.replaceWith(...node.childNodes);
        return;
      }
      [...node.attributes].forEach((attribute) => {
        const keep = (node.tagName === "A" && ["href", "rel"].includes(attribute.name))
          || (["class", "id", "data-latex", "data-display"].includes(attribute.name) && !attribute.name.startsWith("on"));
        if (!keep) node.removeAttribute(attribute.name);
      });
      if (node.tagName === "A") {
        node.setAttribute("href", safeLinkUrl(node.getAttribute("href")));
        node.setAttribute("rel", "noreferrer");
      }
    });
    return documentNode.body.innerHTML;
  }
  return String(html)
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:src|href)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, "");
}

function inlineMarkdown(value, math = false) {
  const tokens = [];
  let text = String(value);
  text = text.replace(/`([^`]+)`/g, (_, code) => token(tokens, `<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, href) => token(tokens, `<a href="${escapeAttribute(safeLinkUrl(href))}" rel="noreferrer">${escapeHtml(label)}</a>`));
  if (math) text = text.replace(/\$([^$\n]+)\$/g, (_, formula) => token(tokens, mathMarkup(formula, false)));
  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^\w])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\n]+)_/g, "$1<em>$2</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

function mathMarkup(formula, display) {
  return `<span class="math-render" data-latex="${escapeAttribute(formula)}" data-display="${display ? "true" : "false"}"><code>${escapeHtml(formula)}</code></span>`;
}

function token(tokens, html) {
  const index = tokens.push(html) - 1;
  return `\u0000${index}\u0000`;
}

function safeLinkUrl(value) {
  const url = String(value ?? "").trim();
  if (/^(https?:|mailto:|#|\/(?!\/)|\.\.?\/)/i.test(url)) return url;
  return "#";
}

function stripInlineMarkup(value) {
  return String(value).replace(/[*_~`[\]]/g, "").trim();
}

function slug(value) {
  return stripInlineMarkup(value).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
