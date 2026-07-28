import test from "node:test";
import assert from "node:assert/strict";

import {
  CHARACTER_FORMAT,
  createCharacterFilename,
  createCharacterPackage,
  instantiateCharacter,
} from "./visual-board-character.mjs";

function identifierFactory() {
  let index = 0;
  return () => `import-${index += 1}`;
}

test("character export includes connected groups, internal vertices, locks, and image assets", () => {
  const objects = [
    {
      id: "upper",
      type: "line",
      groupId: "upper-group",
      rigidGroup: true,
      vertexNetworkId: "upper-network",
      startVertexId: "shoulder-vertex",
      endVertexId: "elbow-vertex",
      x: 0,
      y: 0,
      endX: 10,
      endY: 0,
      locked: true,
    },
    {
      id: "lower",
      type: "image",
      groupId: "lower-group",
      rigidGroup: true,
      assetId: "bone-image",
      x: 10,
      y: 0,
      w: 20,
      h: 10,
      rotation: 0,
      locked: false,
    },
  ];
  const rig = {
    bodies: [
      {
        id: "upper-group",
        objectIds: ["upper"],
        jointIds: ["elbow"],
        dimensionsLocked: true,
      },
      {
        id: "lower-group",
        objectIds: ["lower"],
        jointIds: ["elbow"],
        dimensionsLocked: false,
      },
    ],
    joints: [{ id: "elbow", x: 10, y: 0, bodyIds: ["upper-group", "lower-group"] }],
  };
  const character = createCharacterPackage(
    objects,
    { "bone-image": { name: "bone.png", dataUrl: "data:image/png;base64,AA==" } },
    rig,
    ["upper"],
    "Arm",
  );

  assert.equal(character.format, CHARACTER_FORMAT);
  assert.equal(character.name, "Arm");
  assert.deepEqual(character.objects.map((object) => object.id), ["upper", "lower"]);
  assert.equal(character.objects[0].startVertexId, "shoulder-vertex");
  assert.equal(character.objects[0].locked, true);
  assert.equal(character.rig.bodies[0].dimensionsLocked, true);
  assert.equal(character.assets["bone-image"].name, "bone.png");
});

test("character import remaps every relationship and centers it on the drop point", () => {
  const character = {
    format: CHARACTER_FORMAT,
    version: 1,
    name: "Arm",
    objects: [
      {
        id: "upper",
        type: "line",
        groupId: "upper-group",
        rigidGroup: true,
        vertexNetworkId: "network",
        startVertexId: "start",
        endVertexId: "shared",
        x: 0,
        y: 0,
        endX: 10,
        endY: 0,
        locked: true,
      },
      {
        id: "lower",
        type: "line",
        groupId: "lower-group",
        rigidGroup: true,
        vertexNetworkId: "network",
        startVertexId: "shared",
        endVertexId: "end",
        x: 10,
        y: 0,
        endX: 20,
        endY: 0,
        locked: false,
      },
    ],
    assets: {},
    rig: {
      bodies: [
        {
          id: "upper-group",
          objectIds: ["upper"],
          jointIds: ["elbow"],
          dimensionsLocked: true,
        },
        {
          id: "lower-group",
          objectIds: ["lower"],
          jointIds: ["elbow"],
          dimensionsLocked: false,
        },
      ],
      joints: [{ id: "elbow", x: 10, y: 0, bodyIds: ["upper-group", "lower-group"] }],
    },
  };
  const imported = instantiateCharacter(character, identifierFactory(), { x: 100, y: 200 });

  assert.equal(imported.objects.length, 2);
  assert.notEqual(imported.objects[0].id, "upper");
  assert.equal(imported.objects[0].vertexNetworkId, imported.objects[1].vertexNetworkId);
  assert.equal(imported.objects[0].endVertexId, imported.objects[1].startVertexId);
  assert.notEqual(imported.objects[0].groupId, imported.objects[1].groupId);
  assert.equal(imported.objects[0].locked, true);
  assert.deepEqual(
    [imported.rig.joints[0].x, imported.rig.joints[0].y],
    [100, 199.5],
  );
  assert.equal(imported.rig.bodies[0].dimensionsLocked, true);
  assert.ok(imported.rig.joints[0].bodyIds.includes(imported.objects[0].groupId));
  assert.ok(imported.rig.joints[0].bodyIds.includes(imported.objects[1].groupId));
});

test("character filenames are compact and use the drag-and-drop extension", () => {
  assert.equal(createCharacterFilename("Skull & Barbell"), "skull-barbell.vp-character.json");
});
