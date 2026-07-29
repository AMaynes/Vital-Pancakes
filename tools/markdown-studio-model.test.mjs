import assert from "node:assert/strict";
import test from "node:test";

import {
  createLineDiff,
  createVersion,
  documentStatistics,
  extractOutline,
  renderDocument,
  renderMarkdown,
  sanitizeRenderedHtml,
  validateStudioBackup,
} from "./markdown-studio-model.mjs";

test("Markdown rendering escapes raw active HTML and unsafe links", () => {
  const html = renderMarkdown("# Title\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))");
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /href="#"/);
});

test("parsing boundaries preserve fenced code and math as inert data", () => {
  const html = renderDocument("```html\n<img onerror=alert(1)>\n```\n\n$$\nx^2\n$$", "markdown-math");
  assert.match(html, /&lt;img onerror=alert/);
  assert.match(html, /data-latex="x\^2"/);
});

test("outline generation supports Markdown and LaTeX sections", () => {
  assert.deepEqual(extractOutline("# A\n## B", "markdown").map((item) => item.level), [1, 2]);
  assert.deepEqual(extractOutline("\\section{A}\n\\subsection{B}", "latex").map((item) => item.text), ["A", "B"]);
});

test("document statistics and version snapshots are deterministic", () => {
  assert.deepEqual(documentStatistics("one two\nthree"), { characters: 13, words: 3, lines: 2, readingMinutes: 1 });
  const version = createVersion({ mode: "markdown" }, "text", "Manual", new Date("2026-07-29T00:00:00Z"));
  assert.equal(version.at, "2026-07-29T00:00:00.000Z");
});

test("line diff distinguishes accepted and rejected replacements", () => {
  const diff = createLineDiff("same\nold", "same\nnew");
  assert.deepEqual(diff.map((line) => line.type), ["same", "add", "remove"]);
});

test("sanitization strips event handlers and JavaScript URLs", () => {
  const safe = sanitizeRenderedHtml('<p onclick="bad()">Text</p><a href="javascript:bad()">link</a><script>bad()</script>');
  assert.ok(!/onclick|javascript:|<script/i.test(safe));
});

test("backup import validates modes, sources, and versions", () => {
  const backup = {
    format: "vital-pancakes-markdown-studio", version: 1,
    documents: [{ id: "d", mode: "markdown", source: "# Safe" }],
  };
  assert.equal(validateStudioBackup(backup).documents.length, 1);
  assert.throws(() => validateStudioBackup({ ...backup, version: 5 }), /Unsupported/);
});
