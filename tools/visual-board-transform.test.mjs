import assert from "node:assert/strict";
import test from "node:test";

import { flipBoardSelection, getAlignmentSnap } from "./visual-board-transform.mjs";

test("group flips preserve IDs, locks, joints, and arrow direction", () => {
  const objects = [
    { id: "a", type: "line", x: 0, y: 0, endX: 10, endY: 0, groupId: "g1", locked: true },
    { id: "arrow", type: "connector", x: 20, y: 0, endX: 30, endY: 0, groupId: "g2", startVertexId: "v1", endVertexId: "v2" },
  ];
  const rig = {
    bodies: [{ id: "g1" }, { id: "g2" }],
    joints: [{ id: "joint", x: 15, y: 0, bodyIds: ["g1", "g2"] }],
  };
  const result = flipBoardSelection(objects, rig, "horizontal");
  assert.deepEqual(result.objects.map((object) => object.id), ["a", "arrow"]);
  assert.equal(result.objects[0].locked, true);
  assert.equal(result.objects[1].startVertexId, "v1");
  assert.equal(result.objects[1].endVertexId, "v2");
  assert.equal(result.objects[1].x, 10);
  assert.equal(result.objects[1].endX, 0);
  assert.equal(result.rig.joints[0].x, 15);
});

test("text stays readable unless glyph mirroring is explicit", () => {
  const text = { id: "t", type: "textbox", x: 0, y: 0, w: 100, h: 40, rotation: 0.2 };
  const readable = flipBoardSelection([text], { bodies: [], joints: [] }, "horizontal").objects[0];
  assert.equal(readable.rotation, 0.2);
  assert.equal(readable.flipX, undefined);
  const mirrored = flipBoardSelection([text], { bodies: [], joints: [] }, "horizontal", { mirrorText: true }).objects[0];
  assert.equal(mirrored.flipX, true);
});

test("image flips preserve non-destructive crop data", () => {
  const image = { id: "i", type: "image", x: 0, y: 0, w: 100, h: 50, rotation: 0, crop: { x: 10, y: 20, width: 80, height: 40 } };
  const result = flipBoardSelection([image], { bodies: [], joints: [] }, "vertical").objects[0];
  assert.deepEqual(result.crop, image.crop);
  assert.equal(result.flipY, true);
});

test("alignment guides snap edges and centers within tolerance", () => {
  const snap = getAlignmentSnap(
    { x: 9, y: 48, width: 20, height: 20 },
    [{ x: 10, y: 50, width: 100, height: 40 }],
    3,
  );
  assert.equal(snap.deltaX, 1);
  assert.equal(snap.deltaY, 2);
  assert.deepEqual(snap.guides.map((guide) => guide.axis).sort(), ["horizontal", "vertical"]);
});

test("curve flips preserve editable knots and vertex identities", () => {
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
    curveVertexIds: ["a", "b", "c"],
  };
  const flipped = flipBoardSelection(
    [curve],
    { bodies: [], joints: [] },
    "horizontal",
  ).objects[0];

  assert.deepEqual(flipped.curvePoints, [
    { x: 100, y: 0 },
    { x: 50, y: -20 },
    { x: 0, y: 0 },
  ]);
  assert.deepEqual(flipped.curveVertexIds, ["a", "b", "c"]);
});
