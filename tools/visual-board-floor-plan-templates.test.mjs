import assert from "node:assert/strict";
import test from "node:test";

import {
  addFloorPlanTemplate,
  createEmptyFloorPlanTemplateLibrary,
  createFloorPlanTemplateRecord,
  getFloorPlanTemplateCatalog,
  getFloorPlanTemplateRecord,
  normalizeFloorPlanTemplateLibrary,
  removeFloorPlanTemplate,
  replaceFloorPlanTemplate,
  restoreBuiltInFloorPlanTemplate,
  updateFloorPlanTemplate,
} from "./visual-board-floor-plan-templates.mjs";

const BUILT_INS = ["bedroom", "bathroom"];

function character(name = "Custom room", objects = [{ id: "wall", type: "line" }]) {
  return {
    format: "vital-pancakes-character",
    version: 1,
    name,
    objects,
    assets: {},
    rig: { bodies: [], joints: [] },
  };
}

test("custom templates can be added, edited, and removed immutably", () => {
  const empty = createEmptyFloorPlanTemplateLibrary();
  const record = createFloorPlanTemplateRecord(character(), {
    id: "custom-room",
    name: "Garden suite",
    category: "rooms",
    createdAt: 10,
  });
  const added = addFloorPlanTemplate(empty, record, BUILT_INS);
  const updated = updateFloorPlanTemplate(
    added,
    "custom-room",
    { name: "Garden guest suite", description: "Rear wing", category: "structures" },
    BUILT_INS,
    20,
  );
  const removed = removeFloorPlanTemplate(updated, "custom-room", BUILT_INS);

  assert.equal(empty.items.length, 0);
  assert.equal(updated.items[0].name, "Garden guest suite");
  assert.equal(updated.items[0].description, "Rear wing");
  assert.equal(updated.items[0].updatedAt, 20);
  assert.equal(updated.items[0].category, "structures");
  assert.equal(removed.items.length, 0);
});

test("built-ins can be replaced, hidden, and restored", () => {
  const empty = createEmptyFloorPlanTemplateLibrary();
  const replaced = replaceFloorPlanTemplate(
    empty,
    "bedroom",
    character("My bedroom", [
      { id: "wall", type: "line" },
      { id: "bed", type: "symbol" },
    ]),
    { id: "bedroom-override", name: "My bedroom", updatedAt: 25 },
    BUILT_INS,
  );
  const catalog = getFloorPlanTemplateCatalog(replaced, BUILT_INS);
  const hidden = removeFloorPlanTemplate(replaced, "bedroom", BUILT_INS);
  const restored = restoreBuiltInFloorPlanTemplate(hidden, "bedroom", BUILT_INS);

  assert.equal(catalog.find((item) => item.id === "bedroom").source, "override");
  assert.equal(catalog.find((item) => item.id === "bedroom").objectCount, 2);
  assert.equal(
    getFloorPlanTemplateRecord(replaced, "bedroom", BUILT_INS).id,
    "bedroom-override",
  );
  assert.deepEqual(hidden.hiddenBuiltIns, ["bedroom"]);
  assert.equal(hidden.items.length, 0);
  assert.equal(getFloorPlanTemplateCatalog(restored, BUILT_INS)[0].visible, true);
});

test("normalization rejects images, assets, duplicate IDs, and unknown overrides", () => {
  const valid = createFloorPlanTemplateRecord(character(), { id: "valid" });
  const image = {
    ...valid,
    id: "image",
    character: character("Image", [{ id: "image", type: "image", assetId: "asset" }]),
  };
  image.character.assets = { asset: { dataUrl: "data:image/png;base64,AA==" } };
  const normalized = normalizeFloorPlanTemplateLibrary({
    version: 99,
    items: [
      valid,
      valid,
      image,
      { ...valid, id: "unknown", replacesBuiltIn: "kitchen" },
    ],
    hiddenBuiltIns: ["bedroom", "unknown"],
  }, BUILT_INS);

  assert.deepEqual(normalized.items.map((item) => item.id), ["valid"]);
  assert.deepEqual(normalized.hiddenBuiltIns, ["bedroom"]);
});
