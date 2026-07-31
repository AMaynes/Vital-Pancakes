import assert from "node:assert/strict";
import test from "node:test";

import {
  createFloorPlanWallShape,
  normalizeFloorPlanWallSides,
  reconcileFloorPlanWalls,
  reflowFloorPlanOpeningAttachments,
  snapFloorPlanOpeningToWall,
} from "./visual-board-floor-plan-walls.mjs";

let nextId = 0;
const id = () => `id-${++nextId}`;

function square(kind, x, y, size = 100) {
  const settings = {
    wallSides: 4,
    pixelsPerUnit: size / Math.sqrt(50),
    wallThickness: 0.5,
  };
  return createFloorPlanWallShape(kind, { x, y }, settings, id);
}

function lineKey(line) {
  const points = [
    `${Math.round(line.x)},${Math.round(line.y)}`,
    `${Math.round(line.endX)},${Math.round(line.endY)}`,
  ].sort();
  return points.join("|");
}

test("wall polygons clamp to three through nine editable faces", () => {
  assert.equal(normalizeFloorPlanWallSides(1), 3);
  assert.equal(normalizeFloorPlanWallSides(11), 9);
  const triangle = createFloorPlanWallShape(
    "outer-building-wall",
    { x: 100, y: 100 },
    { wallSides: 3, pixelsPerUnit: 20, wallThickness: 0.5 },
    id,
  );
  const nonagon = createFloorPlanWallShape(
    "outside-fence",
    { x: 100, y: 100 },
    { wallSides: 9, pixelsPerUnit: 20, wallThickness: 0.5 },
    id,
  );
  assert.equal(triangle.length, 3);
  assert.equal(nonagon.length, 9);
  assert.equal(new Set(triangle.map((wall) => wall.vertexNetworkId)).size, 1);
  assert.ok(nonagon.every((wall) => wall.semantic.role === "floor-plan-outside-fence"));
  assert.ok(nonagon.every((wall) => wall.strokeWidth < triangle[0].strokeWidth));
});

test("shared and partially overlapping wall runs become one editable run", () => {
  const first = square("outer-building-wall", 0, 0);
  const second = square("inner-building-wall", 100, 0);
  const reconciled = reconcileFloorPlanWalls(
    [...first, ...second],
    { pixelsPerUnit: 32, wallThickness: 0.5 },
    id,
  ).objects;
  const keys = reconciled.map(lineKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(reconciled.length, 7);
  assert.equal(
    reconciled.filter((wall) => wall.semantic.role === "floor-plan-inner-building-wall").length,
    1,
  );
  assert.equal(new Set(reconciled.map((wall) => wall.vertexNetworkId)).size, 1);
});

test("partial collinear overlaps split cleanly without duplicate wall pieces", () => {
  const first = square("outside-wall", 0, 0);
  const second = square("outside-wall", 50, 0);
  const reconciled = reconcileFloorPlanWalls(
    [...first, ...second],
    { pixelsPerUnit: 32, wallThickness: 0.5 },
    id,
  ).objects;
  const keys = reconciled.map(lineKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(reconciled.length > first.length);
  assert.equal(new Set(reconciled.map((wall) => wall.vertexNetworkId)).size, 1);
});

test("nested building shells classify outermost and inside walls by enclosure", () => {
  const outer = square("inner-building-wall", 0, 0, 160);
  const inner = square("outer-building-wall", 0, 0, 60);
  const reconciled = reconcileFloorPlanWalls(
    [...outer, ...inner],
    { pixelsPerUnit: 32, wallThickness: 0.5 },
    id,
  ).objects;
  const outerWalls = reconciled.filter((wall) => (
    wall.semantic.role === "floor-plan-outer-building-wall"
  ));
  const innerWalls = reconciled.filter((wall) => (
    wall.semantic.role === "floor-plan-inner-building-wall"
  ));
  assert.equal(outerWalls.length, 4);
  assert.equal(innerWalls.length, 4);
  assert.ok(outerWalls[0].strokeWidth > innerWalls[0].strokeWidth);
});

test("outside wall and fence types remain explicit and separate", () => {
  const outside = square("outside-wall", 0, 0);
  const fence = square("outside-fence", 0, 0);
  const reconciled = reconcileFloorPlanWalls(
    [...outside, ...fence],
    { pixelsPerUnit: 32, wallThickness: 0.5 },
    id,
  ).objects;
  assert.equal(reconciled.length, 8);
  assert.equal(
    reconciled.filter((wall) => wall.semantic.role === "floor-plan-outside-wall").length,
    4,
  );
  assert.equal(
    reconciled.filter((wall) => wall.semantic.role === "floor-plan-outside-fence").length,
    4,
  );
});

test("disconnected copied wall shapes receive separate path identities", () => {
  const first = square("outside-wall", -100, 0);
  const second = square("outside-wall", 100, 0).map((wall) => ({
    ...wall,
    semantic: {
      ...wall.semantic,
      wallPathId: first[0].semantic.wallPathId,
    },
  }));
  const reconciled = reconcileFloorPlanWalls(
    [...first, ...second],
    { pixelsPerUnit: 32, wallThickness: 0.5 },
    id,
  ).objects;
  assert.equal(
    new Set(reconciled.map((wall) => wall.semantic.wallPathId)).size,
    2,
  );
});

test("doors and windows snap to and slide along the nearest eligible wall", () => {
  const walls = square("outer-building-wall", 0, 0);
  const topWall = walls
    .filter((wall) => Math.abs(wall.endY - wall.y) < 0.001)
    .sort((first, second) => first.y - second.y)[0];
  const opening = [{
    id: "window",
    type: "line",
    x: -20,
    y: topWall.y + 10,
    endX: 20,
    endY: topWall.y + 10,
    groupId: "window-group",
    semantic: { role: "floor-plan-window", tags: ["floor-plan", "window"] },
  }];
  const firstSnap = snapFloorPlanOpeningToWall(
    opening,
    walls,
    { pixelsPerUnit: 32 },
    30,
  );
  assert.equal(firstSnap.attachment.wallId, topWall.id);
  assert.equal(firstSnap.objects[0].semantic.tags.includes("wall-attached"), true);
  assert.ok(Math.abs(firstSnap.objects[0].y - topWall.y) < 0.001);

  const moved = firstSnap.objects.map((object) => ({
    ...object,
    x: object.x + 25,
    endX: object.endX + 25,
  }));
  const secondSnap = snapFloorPlanOpeningToWall(
    moved,
    walls,
    { pixelsPerUnit: 32 },
    30,
  );
  assert.equal(secondSnap.attachment.wallId, topWall.id);
  assert.ok(secondSnap.attachment.offset > firstSnap.attachment.offset);
});

test("attached openings follow later wall movement", () => {
  const walls = square("outer-building-wall", 0, 0);
  const topWall = walls
    .filter((wall) => Math.abs(wall.endY - wall.y) < 0.001)
    .sort((first, second) => first.y - second.y)[0];
  const opening = [{
    id: "door",
    type: "line",
    x: -10,
    y: topWall.y + 5,
    endX: 10,
    endY: topWall.y + 5,
    groupId: "door-group",
    semantic: { role: "floor-plan-door", tags: ["floor-plan", "door"] },
  }];
  const snapped = snapFloorPlanOpeningToWall(opening, walls, {}, 20);
  const movedWalls = walls.map((wall) => ({
    ...wall,
    y: wall.y + 25,
    endY: wall.endY + 25,
  }));
  const reflowed = reflowFloorPlanOpeningAttachments(
    [...movedWalls, ...snapped.objects],
    {},
  );
  const movedOpening = reflowed.objects.find((object) => object.id === "door");
  assert.ok(Math.abs(movedOpening.y - (topWall.y + 25)) < 0.001);
});

test("ordinary board lines are untouched by Floor Plan reconciliation", () => {
  const ordinary = {
    id: "ordinary",
    type: "line",
    x: 0,
    y: 0,
    endX: 10,
    endY: 0,
    semantic: { role: "diagram-edge", tags: ["diagram"] },
  };
  const result = reconcileFloorPlanWalls([ordinary], {}, id);
  assert.equal(result.changed, false);
  assert.equal(result.objects[0], ordinary);
});
