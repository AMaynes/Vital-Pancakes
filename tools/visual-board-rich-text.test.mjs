import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTextColorRange,
  getTextColorSegments,
  sanitizeTextColorRanges,
  updateTextColorRangesForEdit,
} from "./visual-board-rich-text.mjs";

test("highlight coloring replaces only the selected characters", () => {
  const ranges = applyTextColorRange(
    [{ start: 0, end: 5, color: "#ff0000" }],
    8,
    2,
    4,
    "#0000ff",
  );

  assert.deepEqual(ranges, [
    { start: 0, end: 2, color: "#ff0000" },
    { start: 2, end: 4, color: "#0000ff" },
    { start: 4, end: 5, color: "#ff0000" },
  ]);
});

test("adjacent ranges of the same color merge and malformed ranges are rejected", () => {
  assert.deepEqual(sanitizeTextColorRanges([
    { start: -4, end: 2, color: "#AA0000" },
    { start: 2, end: 7, color: "#aa0000" },
    { start: 1, end: 3, color: "red" },
  ], 5), [
    { start: 0, end: 5, color: "#aa0000" },
  ]);
});

test("text edits preserve unaffected colors and leave inserted text unformatted", () => {
  assert.deepEqual(updateTextColorRangesForEdit(
    [{ start: 0, end: 2, color: "#ff0000" }, { start: 4, end: 6, color: "#0000ff" }],
    "abcdef",
    "abXYcdef",
  ), [
    { start: 0, end: 2, color: "#ff0000" },
    { start: 6, end: 8, color: "#0000ff" },
  ]);
});

test("canvas segments combine base and highlighted colors at exact offsets", () => {
  assert.deepEqual(getTextColorSegments(
    "knowledge",
    3,
    [{ start: 5, end: 9, color: "#7b211a" }],
    "#000000",
  ), [
    { text: "kn", color: "#000000" },
    { text: "owle", color: "#7b211a" },
    { text: "dge", color: "#000000" },
  ]);
});
