import assert from "node:assert/strict";
import test from "node:test";

import {
  createBucketFillArea,
  findBucketFillTarget,
  findEnclosedVectorRegion,
} from "./visual-board-fill.mjs";

function line(id, x, y, endX, endY) {
  return { id, type: "line", x, y, endX, endY, strokeWidth: 2 };
}

test("a connected line boundary exposes its clicked interior", () => {
  const objects = [
    line("top", 0, 0, 100, 0),
    line("right", 100, 0, 100, 100),
    line("bottom", 100, 100, 0, 100),
    line("left", 0, 100, 0, 0),
  ];
  const polygon = findEnclosedVectorRegion(objects, { x: 40, y: 60 });
  assert.equal(polygon.length, 4);
  assert.deepEqual(new Set(polygon.map((point) => `${point.x}:${point.y}`)), new Set([
    "0:0",
    "100:0",
    "100:100",
    "0:100",
  ]));
});

test("an open boundary cannot be bucket filled", () => {
  const objects = [
    line("top", 0, 0, 100, 0),
    line("right", 100, 0, 100, 100),
    line("bottom", 100, 100, 0, 100),
  ];
  assert.equal(findEnclosedVectorRegion(objects, { x: 40, y: 60 }), null);
});

test("the smallest enclosing face wins when regions are nested", () => {
  const objects = [
    line("outer-top", 0, 0, 200, 0),
    line("outer-right", 200, 0, 200, 200),
    line("outer-bottom", 200, 200, 0, 200),
    line("outer-left", 0, 200, 0, 0),
    line("inner-top", 50, 50, 150, 50),
    line("inner-right", 150, 50, 150, 150),
    line("inner-bottom", 150, 150, 50, 150),
    line("inner-left", 50, 150, 50, 50),
  ];
  const polygon = findEnclosedVectorRegion(objects, { x: 100, y: 100 });
  assert.equal(Math.min(...polygon.map((point) => point.x)), 50);
  assert.equal(Math.max(...polygon.map((point) => point.x)), 150);
});

test("closed objects are painted directly and generated regions stay underneath", () => {
  const target = {
    id: "shape",
    type: "rectangle",
    x: 10,
    y: 20,
    w: 80,
    h: 60,
    rotation: 0,
  };
  assert.equal(findBucketFillTarget([target], { x: 40, y: 40 }), target);

  const area = createBucketFillArea([
    { x: 10, y: 20 },
    { x: 90, y: 20 },
    { x: 90, y: 80 },
    { x: 10, y: 80 },
  ], "#123456", () => "fill");
  assert.equal(area.id, "fill");
  assert.equal(area.fillColor, "#123456");
  assert.equal(area.zIndex, -10_000);
  assert.deepEqual(area.vertices[2], { x: 1, y: 1 });
});
