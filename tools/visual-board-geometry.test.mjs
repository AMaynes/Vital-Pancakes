import test from "node:test";
import assert from "node:assert/strict";

import {
  distanceBetween,
  getLineSelectionCorners,
  getMarqueeSelectionCandidates,
  getObjectBounds,
  getObjectSegments,
  getShapeCorners,
  isExplodableObject,
  normalizeShape,
  objectIntersectsRectangle,
  pointHitsObject,
  resizeShapeFromCorner,
  snapValue,
} from "./visual-board-geometry.mjs";

test("normalizeShape converts reverse drags into positive geometry", () => {
  assert.deepEqual(
    normalizeShape({ x: 30, y: 40, w: -20, h: -10 }),
    { x: 10, y: 30, w: 20, h: 10 },
  );
});

test("rotated shape bounds follow its world-space corners", () => {
  const object = { type: "rectangle", x: 0, y: 0, w: 100, h: 40, rotation: Math.PI / 2 };
  const bounds = getObjectBounds(object);
  assert.ok(Math.abs(bounds.width - 40) < 0.0001);
  assert.ok(Math.abs(bounds.height - 100) < 0.0001);
});

test("corner resizing keeps the opposite corner fixed", () => {
  const object = { type: "rectangle", x: 10, y: 20, w: 100, h: 50, rotation: Math.PI / 6 };
  const originalSouthWest = getShapeCorners(object).sw;
  const resized = resizeShapeFromCorner(object, "ne", { x: 180, y: 5 });
  const resizedSouthWest = getShapeCorners(resized).sw;
  assert.ok(Math.abs(originalSouthWest.x - resizedSouthWest.x) < 0.0001);
  assert.ok(Math.abs(originalSouthWest.y - resizedSouthWest.y) < 0.0001);
  assert.ok(resized.w >= 16);
  assert.ok(resized.h >= 16);
});

test("hit testing respects shape rotation", () => {
  const object = {
    type: "rectangle",
    x: 0,
    y: 0,
    w: 100,
    h: 30,
    rotation: Math.PI / 4,
    strokeWidth: 2,
  };
  assert.equal(pointHitsObject(object, { x: 50, y: 15 }, 0), true);
  assert.equal(pointHitsObject(object, { x: 0, y: 80 }, 0), false);
});

test("marquee intersection and grid snapping use world coordinates", () => {
  const object = { type: "connector", x: 40, y: 40, endX: 120, endY: 90, strokeWidth: 3 };
  assert.equal(
    objectIntersectsRectangle(object, { x: 80, y: 60, width: 80, height: 80 }),
    true,
  );
  assert.equal(
    objectIntersectsRectangle(object, { x: 200, y: 200, width: 20, height: 20 }),
    false,
  );
  assert.equal(snapValue(47, 32), 32);
  assert.equal(snapValue(50, 32), 64);
});

test("a marquee over locked content can select only unlocked objects", () => {
  const lockedBackground = {
    id: "background",
    type: "rectangle",
    x: 0,
    y: 0,
    w: 500,
    h: 500,
    rotation: 0,
    locked: true,
  };
  const first = {
    id: "first",
    type: "rectangle",
    x: 100,
    y: 100,
    w: 40,
    h: 40,
    rotation: 0,
    locked: false,
  };
  const second = {
    id: "second",
    type: "line",
    x: 180,
    y: 180,
    endX: 220,
    endY: 220,
    strokeWidth: 3,
    locked: false,
  };

  assert.deepEqual(
    getMarqueeSelectionCandidates(
      [lockedBackground, first, second],
      { x: 80, y: 80, width: 180, height: 180 },
      { includeLocked: false },
    ).map((object) => object.id),
    ["first", "second"],
  );
});

test("a marquee inside a diagonal line's bounds does not select the distant line", () => {
  const line = {
    type: "line",
    x: 0,
    y: 0,
    endX: 200,
    endY: 100,
    strokeWidth: 4,
  };

  assert.equal(
    objectIntersectsRectangle(line, { x: 80, y: 5, width: 20, height: 15 }),
    false,
  );
  assert.equal(
    objectIntersectsRectangle(line, { x: 80, y: 35, width: 20, height: 15 }),
    true,
  );
});

test("outlined 2D and 3D shapes produce selectable world-space segments", () => {
  const triangle = {
    type: "shape",
    shapeKind: "triangle",
    x: 10,
    y: 20,
    w: 120,
    h: 80,
    rotation: 0,
    strokeWidth: 3,
  };
  const cube = { ...triangle, shapeKind: "cube" };
  assert.equal(getObjectSegments(triangle).length, 3);
  assert.equal(getObjectSegments(cube).length, 12);
  assert.equal(pointHitsObject(triangle, { x: 70, y: 20 }, 2), true);
  assert.equal(pointHitsObject(triangle, { x: 70, y: 60 }, 2), false);
});

test("cube depth offsets place every vertex on the board grid", () => {
  const cube = {
    type: "shape",
    shapeKind: "cube",
    x: 64,
    y: 96,
    w: 352,
    h: 288,
    shapeDepthX: 64,
    shapeDepthY: 64,
    rotation: 0,
    strokeWidth: 3,
  };
  const vertices = getObjectSegments(cube).flat();
  assert.equal(vertices.length, 24);
  vertices.forEach((point) => {
    assert.equal(point.x % 32, 0);
    assert.equal(point.y % 32, 0);
  });
});

test("curved outlined shapes can be exploded into clean line approximations", () => {
  const ellipse = {
    type: "ellipse",
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    rotation: Math.PI / 8,
    strokeWidth: 2,
  };
  assert.equal(getObjectSegments(ellipse).length, 36);
  assert.equal(isExplodableObject(ellipse), true);
  assert.equal(isExplodableObject({ type: "textbox" }), false);
});

test("lines share connector bounds and hit-testing behavior", () => {
  const line = {
    type: "line",
    x: 20,
    y: 30,
    endX: 120,
    endY: 70,
    strokeWidth: 4,
  };
  assert.deepEqual(getObjectBounds(line), { x: 20, y: 30, width: 100, height: 40 });
  assert.equal(pointHitsObject(line, { x: 70, y: 50 }, 0), true);
  assert.equal(pointHitsObject(line, { x: 70, y: 75 }, 0), false);
});

test("diagonal line selection uses a narrow rotated rectangle", () => {
  const line = {
    type: "line",
    x: 0,
    y: 0,
    endX: 120,
    endY: 60,
  };
  const corners = getLineSelectionCorners(line, 8);
  const sideLength = distanceBetween(corners[0], corners[3]);
  const longEdgeLength = distanceBetween(corners[0], corners[1]);

  assert.ok(Math.abs(sideLength - 16) < 0.0001);
  assert.ok(Math.abs(longEdgeLength - (Math.hypot(120, 60) + 16)) < 0.0001);
  assert.ok(corners[0].y > line.y);
  assert.ok(corners[3].y < line.y);
});

test("three-point arcs use their curved outline for bounds and hit testing", () => {
  const arc = {
    type: "arc",
    x: 0,
    y: 50,
    midX: 50,
    midY: 0,
    endX: 100,
    endY: 50,
    strokeWidth: 3,
  };

  const bounds = getObjectBounds(arc);
  assert.deepEqual(bounds, { x: 0, y: 0, width: 100, height: 50 });
  assert.equal(pointHitsObject(arc, { x: 50, y: 0 }, 1), true);
  assert.equal(pointHitsObject(arc, { x: 50, y: 40 }, 1), false);
});

test("filled trace paths can be selected from their interior", () => {
  const trace = {
    type: "trace",
    paths: [[
      { x: 10, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 40 },
      { x: 10, y: 40 },
    ]],
    strokeWidth: 1,
  };

  assert.deepEqual(getObjectBounds(trace), { x: 10, y: 10, width: 30, height: 30 });
  assert.equal(pointHitsObject(trace, { x: 20, y: 20 }, 0), true);
  assert.equal(pointHitsObject(trace, { x: 50, y: 50 }, 0), false);
});
