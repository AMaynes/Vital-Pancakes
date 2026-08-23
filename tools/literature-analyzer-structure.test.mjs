import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [markup, styles, controller] = await Promise.all([
  readFile(new URL("./literature-analyzer.html", import.meta.url), "utf8"),
  readFile(new URL("./literature-analyzer.css", import.meta.url), "utf8"),
  readFile(new URL("./literature-analyzer.js", import.meta.url), "utf8"),
]);

test("literature analyzer keeps only ink colors in its compact top tool strip", () => {
  const toolbar = markup.match(/<div class="tool-toolbar analyzer-toolbar">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? "";
  assert.match(toolbar, /class="analyzer-ink-tools"/);
  assert.doesNotMatch(markup, /analyzer-top-tools|analyzer-comment-panel|annotation-list|data-analyzer-mode/);
  assert.match(styles, /\.analyzer-toolbar\s*\{[\s\S]*min-height: 34px/);
});

test("the full empty reader is the only PDF browse and drop target", () => {
  assert.match(markup, /<label class="pdf-empty analyzer-empty" id="analysis-pdf-drop-zone">[\s\S]*id="analysis-pdf-file"/);
  assert.doesNotMatch(markup, /website-url|website-source-form|analyzer-web-stage/);
  assert.doesNotMatch(controller, /loadWebsite|createWebAnnotation|webHighlightLayer|websiteForm/);
});

test("selected highlights expose comment creation and margin comments edit on double click", () => {
  assert.match(controller, /className = "highlight-comment-button"/);
  assert.match(styles, /\.highlight-mark\.is-selected \.highlight-comment-button\s*\{[\s\S]*display: grid/);
  assert.match(controller, /card\.addEventListener\("dblclick"[\s\S]*beginCommentEdit\(annotation\.id\)/);
  assert.match(controller, /annotation\.comment\.trim\(\) \|\| annotation\.id === editingCommentId/);
  assert.match(styles, /\.analyzer-comment-editor\s*\{/);
});

test("comments remain floating beside the PDF instead of forming a fixed column", () => {
  assert.match(markup, /class="analyzer-document-layout"[\s\S]*class="analyzer-comment-rail"/);
  assert.match(styles, /\.analyzer-comment-rail-card\s*\{[\s\S]*position: absolute/);
  assert.match(controller, /card\.dataset\.anchorY = String\(annotation\.y\)/);
  assert.match(controller, /function positionFloatingComments\(\)/);
});
