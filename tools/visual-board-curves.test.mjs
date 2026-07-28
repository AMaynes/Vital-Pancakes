import test from "node:test";
import assert from "node:assert/strict";

import {
  getQuadraticControlPoint,
  getQuadraticCurvePoint,
  getQuadraticCurvePoints,
} from "./visual-board-curves.mjs";

test("the stored middle handle lies on the curve", () => {
  const arc = {
    x: 0,
    y: 0,
    midX: 50,
    midY: -30,
    endX: 100,
    endY: 0,
  };

  assert.deepEqual(getQuadraticCurvePoint(arc, 0.5), { x: 50, y: -30 });
  assert.deepEqual(getQuadraticControlPoint(arc), { x: 50, y: -60 });
});

test("curve sampling adds vertices as curvature increases", () => {
  const straight = getQuadraticCurvePoints({
    x: 0,
    y: 0,
    midX: 50,
    midY: 0,
    endX: 100,
    endY: 0,
  });
  const curved = getQuadraticCurvePoints({
    x: 0,
    y: 0,
    midX: 50,
    midY: -80,
    endX: 100,
    endY: 0,
  });

  assert.equal(straight.length, 5);
  assert.ok(curved.length > straight.length);
  assert.deepEqual(curved[Math.floor(curved.length / 2)], { x: 50, y: -80 });
});
