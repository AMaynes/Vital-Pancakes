import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [markup, styles, controller] = await Promise.all([
  readFile(new URL("./literature-analyzer.html", import.meta.url), "utf8"),
  readFile(new URL("./literature-analyzer.css", import.meta.url), "utf8"),
  readFile(new URL("./literature-analyzer.js", import.meta.url), "utf8"),
]);

test("literature analyzer uses a top tool strip instead of a left sidebar", () => {
  assert.match(markup, /class="analyzer-top-tools"/);
  assert.doesNotMatch(markup, /class="analyzer-sidebar"/);
  assert.match(styles, /\.literature-analyzer-workspace\s*\{[\s\S]*grid-template-rows:/);
  assert.match(styles, /\.analyzer-top-tools\s*\{[\s\S]*grid-template-columns:/);
});

test("comment creation is an explicit mode and comment clicks only select", () => {
  assert.match(markup, /data-analyzer-mode="comment"/);
  assert.doesNotMatch(markup, /comment-layout-toggle|comments-back-on-page/);
  assert.match(controller, /activeMode === "comment"/);
  assert.match(controller, /button\.addEventListener\("click", \(\) => navigateToAnnotation\(annotation\.id\)\)/);
  assert.doesNotMatch(controller, /navigateToAnnotation\(annotation\.id, true\)/);
});

test("comments float in a transparent margin beside the document", () => {
  assert.match(markup, /class="analyzer-document-layout"[\s\S]*class="analyzer-comment-rail"/);
  assert.match(styles, /\.analyzer-comment-rail-card\s*\{[\s\S]*position: absolute/);
  assert.match(controller, /button\.dataset\.anchorY = String\(annotation\.y\)/);
  assert.match(controller, /function positionFloatingComments\(\)/);
});
