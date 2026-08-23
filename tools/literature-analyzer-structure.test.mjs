import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [markup, styles, controller] = await Promise.all([
  readFile(new URL("./literature-analyzer.html", import.meta.url), "utf8"),
  readFile(new URL("./literature-analyzer.css", import.meta.url), "utf8"),
  readFile(new URL("./literature-analyzer.js", import.meta.url), "utf8"),
]);

test("literature analyzer keeps ink and one comment view toggle in its compact top tool strip", () => {
  const toolbar = markup.match(/<div class="tool-toolbar analyzer-toolbar">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? "";
  assert.match(toolbar, /class="analyzer-ink-tools"/);
  assert.match(markup, /id="comment-display-toggle"/);
  assert.doesNotMatch(markup, /analyzer-top-tools|analyzer-comment-panel|annotation-list|data-analyzer-mode/);
  assert.match(styles, /\.analyzer-toolbar\s*\{[\s\S]*min-height: 34px/);
});

test("highlights toggle selection and escape clears the active selection", () => {
  assert.match(controller, /annotationId === selectedAnnotationId \? null : annotationId/);
  assert.match(controller, /event\.key === "Escape"[\s\S]*setHighlightMode\(null\)/);
  assert.match(controller, /activeColor === button\.dataset\.highlightColor[\s\S]*\? null/);
  assert.match(styles, /\.highlight-layer\.is-drawing-mode\s*\{[\s\S]*cursor: crosshair/);
  assert.doesNotMatch(styles, /\.highlight-mark:hover,\s*\.highlight-mark\.is-selected/);
});

test("selected highlights and comments can be deleted from the toolbar or keyboard", () => {
  assert.match(markup, /id="delete-highlight"/);
  assert.match(controller, /deleteHighlightButton\.addEventListener\("click", deleteSelectedHighlight\)/);
  assert.match(controller, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
  assert.match(controller, /function deleteSelectedHighlight\(\)/);
});

test("comments switch between a selectable side rail and hover display", () => {
  assert.match(markup, /id="side-comments-visibility"/);
  assert.match(controller, /commentDisplayMode === "hover"/);
  assert.match(controller, /className = "highlight-hover-comment"/);
  assert.match(controller, /card\.addEventListener\("click", \(event\) =>[\s\S]*selectAnnotationInPlace/);
});

test("a collapsible finite drawing canvas provides pen and eraser controls", () => {
  assert.match(markup, /id="drawing-visibility-toggle"/);
  assert.match(markup, /id="analyzer-drawing-canvas"/);
  assert.match(markup, /data-drawing-tool="pen"/);
  assert.match(markup, /data-drawing-tool="eraser"/);
  assert.match(controller, /function renderDrawing\(\)/);
  assert.match(controller, /drawingCanvas\.addEventListener\("pointerdown"/);
  assert.match(styles, /\.analyzer-drawing-panel\s*\{[\s\S]*resize: both/);
  assert.match(controller, /new ResizeObserver\(syncDrawingCanvasSize\)/);
  assert.match(controller, /drawingPanel\.style\.width = `\$\{Math\.floor\(pageWidth \/ 2\)\}px`/);
  assert.match(controller, /drawingPanel\.style\.height = `\$\{Math\.floor\(pageHeight \/ 2\)\}px`/);
  assert.match(styles, /\.analyzer-drawing-column\.is-collapsed\s*\{[\s\S]*width: max-content/);
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
