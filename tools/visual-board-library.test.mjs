import test from "node:test";
import assert from "node:assert/strict";
import {
  addVisualBoardLibraryItem,
  createEmptyVisualBoardLibrary,
  createVisualBoardLibraryItem,
  filterVisualBoardLibraryItems,
  getVisualBoardLibraryItemSummary,
  normalizeVisualBoardLibrary,
  removeVisualBoardLibraryItem,
} from "./visual-board-library.mjs";

function characterPackage(name = "Locked arm") {
  return {
    format: "vital-pancakes-character",
    version: 1,
    name,
    objects: [
      {
        id: "upper",
        type: "line",
        groupId: "upper-group",
        vertexNetworkId: "arm-network",
        startVertexId: "shoulder",
        endVertexId: "elbow",
        locked: true,
      },
      {
        id: "lower",
        type: "line",
        groupId: "lower-group",
        vertexNetworkId: "arm-network",
        startVertexId: "elbow",
        endVertexId: "wrist",
      },
    ],
    assets: {
      texture: { name: "bone.png", type: "image/png", dataUrl: "data:image/png;base64,AA==" },
    },
    rig: {
      bodies: [
        { id: "upper-group", objectIds: ["upper"], jointIds: ["elbow-joint"], dimensionsLocked: true },
        { id: "lower-group", objectIds: ["lower"], jointIds: ["elbow-joint"], dimensionsLocked: false },
      ],
      joints: [{ id: "elbow-joint", x: 10, y: 10, bodyIds: ["upper-group", "lower-group"] }],
    },
  };
}

test("library items preserve vertices, groups, joints, locks, and embedded assets", () => {
  const character = characterPackage();
  const item = createVisualBoardLibraryItem(character, {
    id: "asset-1",
    name: "  Locked arm  ",
    createdAt: 50,
  });

  assert.equal(item.name, "Locked arm");
  assert.equal(item.character.objects[0].startVertexId, "shoulder");
  assert.equal(item.character.objects[0].groupId, "upper-group");
  assert.equal(item.character.rig.joints[0].bodyIds.length, 2);
  assert.equal(item.character.rig.bodies[0].dimensionsLocked, true);
  assert.equal(item.character.assets.texture.name, "bone.png");
  assert.notEqual(item.character, character);
});

test("adding, filtering, and removing library items is immutable", () => {
  const empty = createEmptyVisualBoardLibrary();
  const arm = createVisualBoardLibraryItem(characterPackage(), { id: "arm" });
  const cube = createVisualBoardLibraryItem({
    ...characterPackage("Cube"),
    objects: [{ id: "cube", type: "shape", shapeKind: "cube" }],
    rig: { bodies: [], joints: [] },
  }, { id: "cube" });

  const withArm = addVisualBoardLibraryItem(empty, arm);
  const withBoth = addVisualBoardLibraryItem(withArm, cube);
  const filtered = filterVisualBoardLibraryItems(withBoth.items, "cube");
  const removed = removeVisualBoardLibraryItem(withBoth, "arm");

  assert.equal(empty.items.length, 0);
  assert.deepEqual(withBoth.items.map((item) => item.id), ["cube", "arm"]);
  assert.deepEqual(filtered.map((item) => item.id), ["cube"]);
  assert.deepEqual(removed.items.map((item) => item.id), ["cube"]);
});

test("normalization rejects malformed and duplicate saved entries", () => {
  const item = createVisualBoardLibraryItem(characterPackage(), { id: "asset" });
  const normalized = normalizeVisualBoardLibrary({
    version: 99,
    items: [item, item, { id: "bad", character: {} }, null],
  });

  assert.equal(normalized.version, 1);
  assert.deepEqual(normalized.items.map((candidate) => candidate.id), ["asset"]);
});

test("library summaries count objects, groups, joints, and both lock types", () => {
  const item = createVisualBoardLibraryItem(characterPackage(), { id: "asset" });
  assert.deepEqual(getVisualBoardLibraryItemSummary(item), {
    objectCount: 2,
    groupCount: 2,
    jointCount: 1,
    lockCount: 2,
  });
});
