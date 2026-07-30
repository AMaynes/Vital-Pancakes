import assert from "node:assert/strict";
import test from "node:test";

import {
  getDefaultTextboxSize,
  getTextWorldFontSize,
} from "./visual-board-text.mjs";

test("document text remains in world units at every zoom", () => {
  assert.equal(getTextWorldFontSize(12, 1), 12);
  assert.equal(getTextWorldFontSize(12, 0.25), 12);
  assert.equal(getTextWorldFontSize(12, 0.25) * 0.25, 3);
  assert.equal(getTextWorldFontSize(12, 2) * 2, 24);
});

test("click-created textboxes have zoom-invariant world dimensions", () => {
  assert.deepEqual(getDefaultTextboxSize(18, 1), {
    width: 210,
    height: 72,
  });
  assert.deepEqual(getDefaultTextboxSize(18, 0.25), {
    width: 210,
    height: 72,
  });
});

test("explicit screen annotations retain the legacy readable-overlay behavior", () => {
  assert.equal(getTextWorldFontSize(12, 0.25, "screen"), 48);
  assert.deepEqual(getDefaultTextboxSize(18, 0.25, "screen"), {
    width: 840,
    height: 288,
  });
});
