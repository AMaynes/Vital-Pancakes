import assert from "node:assert/strict";
import test from "node:test";

import {
  createFloorPlanElement,
  createFloorPlanTemplate,
  formatFloorPlanDimension,
  normalizeFloorPlanSettings,
} from "./visual-board-floor-plan.mjs";

let nextId = 0;
const id = () => `id-${++nextId}`;

test("floor-plan settings normalize scale, units, and wall thickness", () => {
  assert.deepEqual(normalizeFloorPlanSettings({ units: "m", pixelsPerUnit: 40, wallThickness: 0.2, gridSize: 20 }), {
    enabled: false, units: "m", pixelsPerUnit: 40, wallThickness: 0.2, gridSize: 20, alignmentGuides: true,
    elementLibrary: { version: 1, items: [], hiddenBuiltIns: [] },
    templateLibrary: { version: 1, items: [], hiddenBuiltIns: [] },
  });
});

test("door and dimension elements remain ordinary grouped board objects", () => {
  const door = createFloorPlanElement("door", { x: 0, y: 0 }, {}, id);
  assert.deepEqual(door.map((object) => object.type), ["line", "arc"]);
  assert.ok(door.every((object) => object.groupId === door[0].groupId));
  const dimension = createFloorPlanElement("dimension", { x: 0, y: 0 }, {}, id);
  assert.equal(dimension[0].semantic.role, "floor-plan-dimension");
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
