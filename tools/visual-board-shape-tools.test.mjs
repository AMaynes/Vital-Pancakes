import assert from "node:assert/strict";
import test from "node:test";

import {
  getShapeToolFamily,
  retainShapeToolChoice,
} from "./visual-board-shape-tools.mjs";

test("shape tools resolve to the correct split-button family", () => {
  assert.equal(getShapeToolFamily("rectangle"), "2d");
  assert.equal(getShapeToolFamily("shape:hexagon"), "2d");
  assert.equal(getShapeToolFamily("shape:cube"), "3d");
  assert.equal(getShapeToolFamily("shape:cone"), "3d");
  assert.equal(getShapeToolFamily("line"), null);
});

test("switching to a non-shape tool preserves both selected shape options", () => {
  const choices = { "2d": "shape:diamond", "3d": "shape:pyramid" };

  assert.deepEqual(retainShapeToolChoice(choices, "pen"), choices);
});

test("choosing a shape updates only its own retained option", () => {
  const choices = { "2d": "rectangle", "3d": "shape:cube" };

  assert.deepEqual(retainShapeToolChoice(choices, "shape:hexagon"), {
    "2d": "shape:hexagon",
    "3d": "shape:cube",
  });
});
