import test from "node:test";
import assert from "node:assert/strict";

import { getStrokeDashArray } from "./visual-board-strokes.mjs";

test("dotted ink remains finite across thin and thick strokes", () => {
  const thin = getStrokeDashArray("dotted", 1);
  const thick = getStrokeDashArray("dotted", 24);

  assert.deepEqual(thin, [0.5, 2.8]);
  assert.ok(thick[0] >= 0.5);
  assert.ok(thick[1] > thick[0]);
  [...thin, ...thick].forEach((length) => assert.ok(length > 0));
});

test("dash-dot uses the same stable finite dot segment", () => {
  const dotted = getStrokeDashArray("dotted", 12);
  const dashDot = getStrokeDashArray("dash-dot", 12);

  assert.equal(dashDot[2], dotted[0]);
  assert.ok(dashDot.every((length) => length > 0));
});

test("solid and established dash patterns retain their contracts", () => {
  assert.deepEqual(getStrokeDashArray("solid", 3), []);
  assert.deepEqual(getStrokeDashArray("dashed", 2), [10, 6.4]);
  assert.deepEqual(getStrokeDashArray("long-dash", 2), [18, 7]);
  assert.deepEqual(getStrokeDashArray("dotted", Number.NaN), [0.5, 2.8]);
});
