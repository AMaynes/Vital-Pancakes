import test from "node:test";
import assert from "node:assert/strict";

import {
  createEditableCurveGeometry,
  getCurveBezierSegments,
  getCurvePathPoints,
  getCurveVertices,
  getQuadraticControlPoint,
  getQuadraticCurvePoint,
  getQuadraticCurvePoints,
  insertCurveVertex,
  normalizeCurveGeometry,
  reinitializeCurveVertices,
  setCurveVertexPosition,
  transformCurveGeometry,
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

test("upgrading a legacy arc preserves its path exactly", () => {
  const arc = {
    x: 0,
    y: 0,
    midX: 50,
    midY: -40,
    endX: 100,
    endY: 0,
  };
  const editable = createEditableCurveGeometry(arc);

  assert.deepEqual(getCurveVertices(editable), [
    { x: 0, y: 0 },
    { x: 50, y: -40 },
    { x: 100, y: 0 },
  ]);
  [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1].forEach((progress) => {
    const expected = getQuadraticCurvePoint(arc, progress);
    const segmentIndex = progress <= 0.5 ? 0 : 1;
    const localProgress = progress <= 0.5 ? progress * 2 : (progress - 0.5) * 2;
    const segment = getCurveBezierSegments(editable)[segmentIndex];
    const actual = cubicPoint(segment, localProgress);
    assert.ok(Math.abs(actual.x - expected.x) < 1e-8);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-8);
  });
});

test("inserting a curve vertex adds one on-curve knot without changing the path", () => {
  const arc = {
    x: 0,
    y: 0,
    midX: 50,
    midY: -50,
    endX: 100,
    endY: 0,
  };
  const beforeSegments = getCurveBezierSegments(createEditableCurveGeometry(arc));
  const result = insertCurveVertex(arc, { x: 75, y: -35 });
  const afterSegments = getCurveBezierSegments(result.curve);

  assert.equal(result.inserted, true);
  assert.equal(getCurveVertices(result.curve).length, 4);
  assert.ok(result.point.y < 0);
  [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].forEach((progress) => {
    const expected = cubicPoint(beforeSegments[result.segmentIndex], progress);
    const splitProgress = result.progress;
    const afterSegmentIndex = progress <= splitProgress
      ? result.segmentIndex
      : result.segmentIndex + 1;
    const localProgress = progress <= splitProgress
      ? progress / splitProgress
      : (progress - splitProgress) / (1 - splitProgress);
    const actual = cubicPoint(afterSegments[afterSegmentIndex], localProgress);
    assert.ok(Math.abs(actual.x - expected.x) < 1e-8);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-8);
  });
});

test("moving an internal curve vertex moves its adjacent geometry", () => {
  const result = insertCurveVertex({
    x: 0,
    y: 0,
    midX: 50,
    midY: -40,
    endX: 100,
    endY: 0,
  }, { x: 75, y: -30 });
  const curve = result.curve;
  const originalStart = { ...curve.curvePoints[0] };
  const originalEnd = { ...curve.curvePoints.at(-1) };

  assert.equal(setCurveVertexPosition(curve, result.vertexIndex, { x: 75, y: 30 }), true);
  assert.deepEqual(curve.curvePoints[result.vertexIndex], { x: 75, y: 30 });
  assert.deepEqual(curve.curvePoints[0], originalStart);
  assert.deepEqual(curve.curvePoints.at(-1), originalEnd);
});

test("reinitializing a subdivided arc keeps only its ends and true apex", () => {
  const original = {
    x: 0,
    y: 0,
    midX: 50,
    midY: -50,
    endX: 100,
    endY: 0,
  };
  const firstInsert = insertCurveVertex(original, { x: 25, y: -35 }).curve;
  const subdivided = insertCurveVertex(firstInsert, { x: 75, y: -35 }).curve;
  const reinitialized = reinitializeCurveVertices(subdivided);
  const vertices = getCurveVertices(reinitialized);

  assert.equal(getCurveVertices(subdivided).length, 5);
  assert.deepEqual(vertices[0], { x: 0, y: 0 });
  assert.ok(Math.abs(vertices[1].x - 50) < 1e-8);
  assert.ok(Math.abs(vertices[1].y + 50) < 1e-8);
  assert.deepEqual(vertices[2], { x: 100, y: 0 });
});

test("reinitializing an S curve retains both local extrema in path order", () => {
  const curve = normalizeCurveGeometry({
    type: "arc",
    x: 0,
    y: 0,
    midX: 50,
    midY: 0,
    endX: 120,
    endY: 0,
    curvePoints: [
      { x: 0, y: 0 },
      { x: 35, y: -50 },
      { x: 80, y: 50 },
      { x: 120, y: 0 },
    ],
  });
  const reinitialized = reinitializeCurveVertices(curve);
  const vertices = getCurveVertices(reinitialized);

  assert.equal(vertices.length, 4);
  assert.deepEqual(vertices[0], { x: 0, y: 0 });
  assert.ok(vertices[1].y < -40);
  assert.ok(vertices[2].y > 40);
  assert.deepEqual(vertices[3], { x: 120, y: 0 });
});

test("reinitializing filters dense low-prominence curve noise", () => {
  const curvePoints = Array.from({ length: 121 }, (_, index) => ({
    x: index,
    y: 40 * Math.sin(index / 120 * Math.PI * 2)
      + 0.15 * Math.sin(index / 120 * Math.PI * 20),
  }));
  const dense = normalizeCurveGeometry({
    type: "arc",
    x: 0,
    y: 0,
    midX: 60,
    midY: 0,
    endX: 120,
    endY: 0,
    curvePoints,
  });
  const vertices = getCurveVertices(reinitializeCurveVertices(dense));

  assert.equal(getCurveVertices(dense).length, 121);
  assert.ok(vertices.length >= 4);
  assert.ok(vertices.length <= 6);
});

test("reinitializing retains shared non-extrema joints and remaps other network ids", () => {
  const firstInsert = insertCurveVertex({
    x: 0,
    y: 0,
    midX: 50,
    midY: -50,
    endX: 100,
    endY: 0,
  }, { x: 25, y: -35 }).curve;
  const curve = {
    ...firstInsert,
    vertexNetworkId: "network",
    curveVertexIds: ["start", "shared-joint", "apex", "end"],
  };
  let identifier = 0;
  const reinitialized = reinitializeCurveVertices(curve, {
    preserveVertexIds: ["shared-joint"],
    createIdentifier: () => `new-${identifier += 1}`,
  });

  assert.equal(getCurveVertices(reinitialized).length, 4);
  assert.ok(reinitialized.curveVertexIds.includes("shared-joint"));
  assert.equal(reinitialized.curveVertexIds.filter(Boolean).length, 4);
  assert.equal(curve.curvePoints.length, 4);
});

test("curve transforms include knots and hidden handles", () => {
  const editable = createEditableCurveGeometry({
    x: 0,
    y: 0,
    midX: 50,
    midY: -40,
    endX: 100,
    endY: 0,
  });
  const transformed = transformCurveGeometry(editable, (point) => ({
    x: point.x + 10,
    y: point.y * 2,
  }));

  assert.deepEqual(getCurveVertices(transformed), [
    { x: 10, y: 0 },
    { x: 60, y: -80 },
    { x: 110, y: 0 },
  ]);
  assert.equal(transformed.curveHandles.length, 2);
});

function cubicPoint(segment, progress) {
  const remaining = 1 - progress;
  return {
    x: remaining ** 3 * segment.start.x
      + 3 * remaining ** 2 * progress * segment.control1.x
      + 3 * remaining * progress ** 2 * segment.control2.x
      + progress ** 3 * segment.end.x,
    y: remaining ** 3 * segment.start.y
      + 3 * remaining ** 2 * progress * segment.control1.y
      + 3 * remaining * progress ** 2 * segment.control2.y
      + progress ** 3 * segment.end.y,
  };
}
