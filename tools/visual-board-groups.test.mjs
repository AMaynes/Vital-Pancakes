import test from "node:test";
import assert from "node:assert/strict";

import {
  getObjectGroupIds,
  getSelectionBounds,
  getSelectionUnits,
  mapPaddedResizePointer,
  padSelectionBounds,
  popObjectGroupLevel,
  pushObjectGroupLevel,
  resizeSelectionObjects,
  rotateSelectionObjects,
} from "./visual-board-groups.mjs";

test("grouped objects count as one logical selection unit", () => {
  const units = getSelectionUnits([
    { id: "group-a-1", groupId: "group-a" },
    { id: "group-a-2", groupId: "group-a" },
    { id: "group-b-1", groupId: "group-b" },
    { id: "loose" },
  ]);

  assert.deepEqual(
    units.map((unit) => unit.map((object) => object.id)),
    [["group-a-1", "group-a-2"], ["group-b-1"], ["loose"]],
  );
});

test("nested groups ungroup one level and restore their smaller groups", () => {
  const first = { id: "first", groupId: "arm", rigidGroup: true };
  const second = { id: "second", groupId: "hand", rigidGroup: true };

  pushObjectGroupLevel(first, "body", true);
  pushObjectGroupLevel(second, "body", true);

  assert.deepEqual(getObjectGroupIds(first), ["arm", "body"]);
  assert.equal(getSelectionUnits([first, second]).length, 1);

  popObjectGroupLevel(first);
  popObjectGroupLevel(second);

  assert.equal(first.groupId, "arm");
  assert.equal(second.groupId, "hand");
  assert.equal(first.rigidGroup, true);
  assert.equal(second.rigidGroup, true);
  assert.equal(getSelectionUnits([first, second]).length, 2);
});

test("group resizing preserves joined endpoints and scales around the opposite corner", () => {
  const objects = [
    { id: "first", type: "line", x: 0, y: 0, endX: 10, endY: 10 },
    { id: "second", type: "line", x: 10, y: 10, endX: 20, endY: 0 },
  ];
  const bounds = getSelectionBounds(objects);
  const resized = resizeSelectionObjects(objects, bounds, "se", { x: 40, y: 30 }, 1);

  assert.deepEqual(resized.bounds, { x: 0, y: 0, width: 40, height: 30 });
  assert.deepEqual(
    { x: resized.objects[0].endX, y: resized.objects[0].endY },
    { x: resized.objects[1].x, y: resized.objects[1].y },
  );
  assert.deepEqual(
    { x: resized.objects[1].endX, y: resized.objects[1].endY },
    { x: 40, y: 0 },
  );
});

test("group selection padding moves resize handles away without changing resize geometry", () => {
  const bounds = { x: 100, y: 80, width: 300, height: 220 };
  const padded = padSelectionBounds(bounds, 24);
  const handleStart = { x: padded.x, y: padded.y };
  const resizeStart = { x: bounds.x, y: bounds.y };

  assert.deepEqual(padded, { x: 76, y: 56, width: 348, height: 268 });
  assert.deepEqual(
    mapPaddedResizePointer(handleStart, handleStart, resizeStart),
    resizeStart,
  );
  assert.deepEqual(
    mapPaddedResizePointer({ x: 56, y: 46 }, handleStart, resizeStart),
    { x: 80, y: 70 },
  );
});

test("group rotation turns every member around one shared center", () => {
  const objects = [
    { id: "first", type: "line", x: 0, y: 0, endX: 10, endY: 0 },
    { id: "second", type: "line", x: 10, y: 0, endX: 10, endY: 10 },
  ];
  const rotated = rotateSelectionObjects(objects, { x: 5, y: 5 }, Math.PI / 2);

  assert.ok(Math.abs(rotated[0].x - 10) < 0.0001);
  assert.ok(Math.abs(rotated[0].y) < 0.0001);
  assert.ok(Math.abs(rotated[1].endX) < 0.0001);
  assert.ok(Math.abs(rotated[1].endY - 10) < 0.0001);
});

test("group transforms preserve complex curve knots and handles", () => {
  const curve = {
    id: "curve",
    type: "arc",
    x: 0,
    y: 0,
    midX: 50,
    midY: -20,
    endX: 100,
    endY: 0,
    curvePoints: [
      { x: 0, y: 0 },
      { x: 50, y: -20 },
      { x: 100, y: 0 },
    ],
    curveHandles: [
      {
        control1: { x: 20, y: -15 },
        control2: { x: 35, y: -20 },
      },
      {
        control1: { x: 65, y: -20 },
        control2: { x: 80, y: -15 },
      },
    ],
  };
  const rotated = rotateSelectionObjects([curve], { x: 50, y: 0 }, Math.PI)[0];

  assert.ok(Math.abs(rotated.curvePoints[0].x - 100) < 1e-8);
  assert.ok(Math.abs(rotated.curvePoints[2].x) < 1e-8);
  assert.equal(rotated.curveHandles.length, 2);
});
