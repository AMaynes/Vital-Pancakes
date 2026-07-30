import assert from "node:assert/strict";
import test from "node:test";

import {
  FLOOR_PLAN_ELEMENT_DEFINITIONS,
  FLOOR_PLAN_TEMPLATE_DEFINITIONS,
  addFloorPlanRoom,
  createFloorPlanElement,
  createFloorPlanTemplate,
  cycleFloorPlanRoom,
  formatFloorPlanDimension,
  isFloorPlanObjectVisible,
  normalizeFloorPlanSettings,
  removeActiveFloorPlanRoom,
} from "./visual-board-floor-plan.mjs";

let nextId = 0;
const id = () => `id-${++nextId}`;

test("floor-plan settings normalize scale, units, and wall thickness", () => {
  assert.deepEqual(normalizeFloorPlanSettings({ units: "m", pixelsPerUnit: 40, wallThickness: 0.2, gridSize: 20 }), {
    enabled: false, units: "m", pixelsPerUnit: 40, wallThickness: 0.2, gridSize: 20, alignmentGuides: true,
    dimensionsVisible: true, labelsAlwaysVisible: false,
    elementLibrary: { version: 1, items: [], hiddenBuiltIns: [] },
    templateLibrary: { version: 1, items: [], hiddenBuiltIns: [] },
  });
});

test("door and dimension elements remain ordinary grouped board objects", () => {
  const door = createFloorPlanElement("door", { x: 0, y: 0 }, {}, id);
  assert.deepEqual(door.map((object) => object.type), ["line", "arc"]);
  assert.ok(door.every((object) => object.groupId === door[0].groupId));
  const dimension = createFloorPlanElement("dimension", { x: 0, y: 0 }, {}, id);
  assert.equal(dimension[0].type, "dimension");
  assert.equal(dimension[0].semantic.role, "floor-plan-dimension");
  assert.ok(dimension[0].startVertexId);
  assert.ok(dimension[0].endVertexId);
});

test("requested floor-plan catalogs expose exact tab groups and names", () => {
  assert.equal(FLOOR_PLAN_ELEMENT_DEFINITIONS["double-door"].name, "Double Door");
  assert.equal(FLOOR_PLAN_ELEMENT_DEFINITIONS["washer-dryer-combo"].group, "furniture");
  assert.equal(FLOOR_PLAN_ELEMENT_DEFINITIONS["layer-designator"].group, "tools");
  assert.equal(FLOOR_PLAN_TEMPLATE_DEFINITIONS["living-room"].name, "Livingroom");
  assert.equal(FLOOR_PLAN_TEMPLATE_DEFINITIONS["blank-house-shell"].name, "House Shell");
});

test("layer designators cycle, add, remove, and control room visibility", () => {
  const [designator] = createFloorPlanElement(
    "layer-designator",
    { x: 0, y: 0 },
    {},
    id,
  );
  const added = addFloorPlanRoom(designator, "Floor 2", id);
  Object.assign(designator, added);
  assert.equal(designator.floorPlanRooms.length, 2);
  assert.equal(designator.activeFloorPlanRoomId, added.room.id);

  const cycled = cycleFloorPlanRoom(designator, -1);
  assert.equal(cycled.activeFloorPlanRoomId, designator.floorPlanRooms[0].id);
  Object.assign(designator, cycled);

  const object = {
    id: "floor-object",
    semantic: {
      referenceId: designator.id,
      roomId: added.room.id,
    },
  };
  assert.equal(isFloorPlanObjectVisible(object, [designator], {}), false);
  Object.assign(designator, cycleFloorPlanRoom(designator, 1));
  assert.equal(isFloorPlanObjectVisible(object, [designator], {}), true);

  const removed = removeActiveFloorPlanRoom(designator);
  assert.equal(removed.removedRoomId, added.room.id);
  assert.equal(removed.floorPlanRooms.length, 1);
});

test("dimension and hover-label visibility settings preserve hidden objects", () => {
  const dimension = { id: "d", type: "dimension", semantic: { role: "floor-plan-dimension" } };
  const labeler = { id: "l", type: "textbox", semantic: { role: "floor-plan-labeler" } };
  assert.equal(isFloorPlanObjectVisible(dimension, [], { dimensionsVisible: false }), false);
  assert.equal(isFloorPlanObjectVisible(labeler, [], { labelsAlwaysVisible: false }), false);
  assert.equal(isFloorPlanObjectVisible(
    labeler,
    [],
    { labelsAlwaysVisible: false },
    { visibleLabelIds: new Set(["l"]) },
  ), true);
});

test("starter rooms contain editable walls, labels, and symbols", () => {
  const bedroom = createFloorPlanTemplate("bedroom", { x: 0, y: 0 }, {}, id);
  assert.ok(bedroom.some((object) => object.semantic.role === "floor-plan-wall"));
  assert.ok(bedroom.some((object) => object.type === "textbox"));
  assert.ok(bedroom.some((object) => object.semantic.tags.includes("bed")));
});

test("dimension calculation respects configured scale and units", () => {
  assert.equal(formatFloorPlanDimension({ x: 0, y: 0 }, { x: 320, y: 0 }, { pixelsPerUnit: 32, units: "ft" }), "10.0 ft");
});
