import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_HIGHLIGHT_COLOR,
  getPdfHighlightBounds,
  normalizeHighlight,
  sanitizeAnnotations,
} from "./literature-analyzer-model.mjs";

test("normalizeHighlight converts a reverse drag into unit coordinates", () => {
  const result = normalizeHighlight(
    { x: 90, y: 80 },
    { x: 30, y: 20 },
    { left: 10, top: 10, width: 100, height: 100 },
  );

  assert.deepEqual(result, {
    x: 0.2,
    y: 0.1,
    width: 0.6,
    height: 0.6,
  });
});

test("normalizeHighlight clamps drags to the source surface", () => {
  const result = normalizeHighlight(
    { x: -20, y: 30 },
    { x: 160, y: 150 },
    { left: 10, top: 20, width: 100, height: 80 },
  );

  assert.deepEqual(result, {
    x: 0,
    y: 0.125,
    width: 1,
    height: 0.875,
  });
});

test("normalizeHighlight ignores accidental clicks", () => {
  const result = normalizeHighlight(
    { x: 20, y: 20 },
    { x: 23, y: 24 },
    { left: 0, top: 0, width: 100, height: 100 },
  );

  assert.equal(result, null);
});

test("getPdfHighlightBounds flips the vertical origin", () => {
  assert.deepEqual(
    getPdfHighlightBounds({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, 600, 800),
    { x: 60, y: 560, width: 180, height: 80 },
  );
});

test("sanitizeAnnotations drops malformed records and bounds comments", () => {
  const result = sanitizeAnnotations([
    {
      id: "good",
      pageNumber: 2,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.2,
      color: "not-a-color",
      comment: "a".repeat(5000),
    },
    {
      id: "outside",
      pageNumber: 1,
      x: 0.9,
      y: 0.2,
      width: 0.3,
      height: 0.2,
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].color, DEFAULT_HIGHLIGHT_COLOR);
  assert.equal(result[0].comment.length, 4000);
});
