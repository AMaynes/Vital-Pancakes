import assert from "node:assert/strict";
import test from "node:test";

import {
  getDefaultTextboxSize,
  getTextWorldFontSize,
} from "./visual-board-text.mjs";

test("textbox font sizes keep their declared screen size while zoomed out", () => {
  assert.equal(getTextWorldFontSize(12, 1), 12);
  assert.equal(getTextWorldFontSize(12, 0.25), 48);
  assert.equal(getTextWorldFontSize(12, 0.25) * 0.25, 12);
  assert.equal(getTextWorldFontSize(12, 2) * 2, 24);
});

test("click-created textboxes retain usable screen dimensions at overview zoom", () => {
  assert.deepEqual(getDefaultTextboxSize(18, 1), {
    width: 210,
    height: 72,
  });
  assert.deepEqual(getDefaultTextboxSize(18, 0.25), {
    width: 840,
    height: 288,
  });
});
