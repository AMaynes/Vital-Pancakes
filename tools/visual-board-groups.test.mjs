import test from "node:test";
import assert from "node:assert/strict";

import {
  getSelectionBounds,
  getSelectionUnits,
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
