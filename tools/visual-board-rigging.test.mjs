import test from "node:test";
import assert from "node:assert/strict";

import {
  createSharedGroupJoints,
  dragRigJoint,
  resolveConstrainedPoint,
} from "./visual-board-rigging.mjs";

function identifierFactory() {
  let index = 0;
  return () => `rig-${index += 1}`;
}

test("two selected groups create one external joint without rewriting their members", () => {
  const firstGroup = [
    {
      id: "upper-1",
      groupId: "upper",
      rigidGroup: true,
      type: "line",
      x: 0,
      y: 0,
      endX: 20,
      endY: 0,
      startVertexId: "internal-a",
      endVertexId: "internal-b",
    },
  ];
  const secondGroup = [
    {
      id: "lower-1",
      groupId: "lower",
      rigidGroup: true,
      type: "line",
      x: 18,
      y: 0,
      endX: 38,
      endY: 0,
      startVertexId: "internal-c",
      endVertexId: "internal-d",
    },
  ];
  const originalGroups = structuredClone([firstGroup, secondGroup]);
  const result = createSharedGroupJoints(
    [firstGroup, secondGroup],
    { bodies: [], joints: [] },
    identifierFactory(),
  );

  assert.equal(result.addedJoints.length, 1);
  assert.deepEqual(result.addedJoints[0].bodyIds, ["upper", "lower"]);
  assert.deepEqual(
    [result.addedJoints[0].x, result.addedJoints[0].y],
    [19, 0],
  );
  assert.equal(result.rig.bodies.length, 2);
  assert.deepEqual([firstGroup, secondGroup], originalGroups);
  assert.equal(firstGroup[0].startVertexId, "internal-a");
  assert.equal(secondGroup[0].endVertexId, "internal-d");
});

test("creating group joints again keeps the original joint and frame count", () => {
  const units = [
    [{ id: "a", groupId: "group-a", type: "line", x: 0, y: 0, endX: 10, endY: 0 }],
    [{ id: "b", groupId: "group-b", type: "line", x: 10, y: 0, endX: 20, endY: 0 }],
  ];
  const first = createSharedGroupJoints(units, null, identifierFactory());
  const second = createSharedGroupJoints(units, first.rig, identifierFactory());

  assert.equal(first.addedJoints.length, 1);
  assert.equal(second.addedJoints.length, 0);
  assert.equal(second.rig.joints.length, 1);
  assert.equal(second.rig.joints[0].id, first.rig.joints[0].id);
});

test("group joints use the visible crossing instead of the center of overlapping bounds", () => {
  const result = createSharedGroupJoints([
    [
      { id: "a1", groupId: "a", type: "line", x: 0, y: 0, endX: 10, endY: 10 },
      { id: "a2", groupId: "a", type: "line", x: 0, y: 20, endX: 10, endY: 10 },
    ],
    [
      { id: "b1", groupId: "b", type: "line", x: 10, y: 10, endX: 20, endY: 0 },
      { id: "b2", groupId: "b", type: "line", x: 10, y: 10, endX: 20, endY: 20 },
    ],
  ], null, identifierFactory());

  assert.deepEqual(
    [result.addedJoints[0].x, result.addedJoints[0].y],
    [10, 10],
  );
});

test("a locked distance resolves to the point on its circle closest to the cursor", () => {
  const point = resolveConstrainedPoint(
    { x: 8, y: 10 },
    { x: 10, y: 0 },
    [{ x: 0, y: 0, radius: 10 }],
  );

  assert.ok(Math.abs(Math.hypot(point.x, point.y) - 10) < 1e-9);
  assert.ok(point.y > 0);
});

test("multiple locked distances choose the nearest exact joint position", () => {
  const point = resolveConstrainedPoint(
    { x: 8, y: -10 },
    { x: 8, y: 6 },
    [
      { x: 0, y: 0, radius: 10 },
      { x: 16, y: 0, radius: 10 },
    ],
  );

  assert.ok(Math.abs(point.x - 8) < 1e-9);
  assert.ok(Math.abs(point.y + 6) < 1e-9);
  assert.ok(Math.abs(Math.hypot(point.x, point.y) - 10) < 1e-9);
  assert.ok(Math.abs(Math.hypot(point.x - 16, point.y) - 10) < 1e-9);
});

test("dragging a locked shared joint rotates both rigid groups without resizing them", () => {
  const objects = [
    {
      id: "upper-line",
      groupId: "upper",
      type: "line",
      x: 0,
      y: 0,
      endX: 8,
      endY: 6,
    },
    {
      id: "lower-line",
      groupId: "lower",
      type: "line",
      x: 8,
      y: 6,
      endX: 16,
      endY: 0,
    },
  ];
  const rig = {
    bodies: [
      {
        id: "upper",
        objectIds: ["upper-line"],
        jointIds: ["shoulder", "elbow"],
        dimensionsLocked: true,
      },
      {
        id: "lower",
        objectIds: ["lower-line"],
        jointIds: ["elbow", "wrist"],
        dimensionsLocked: true,
      },
      { id: "torso", objectIds: [], jointIds: ["shoulder"], dimensionsLocked: true },
      { id: "hand", objectIds: [], jointIds: ["wrist"], dimensionsLocked: true },
    ],
    joints: [
      { id: "shoulder", x: 0, y: 0, bodyIds: ["torso", "upper"] },
      { id: "elbow", x: 8, y: 6, bodyIds: ["upper", "lower"] },
      { id: "wrist", x: 16, y: 0, bodyIds: ["lower", "hand"] },
    ],
  };
  const result = dragRigJoint(objects, rig, "elbow", { x: 8, y: -10 });
  const upper = result.objects.find((object) => object.id === "upper-line");
  const lower = result.objects.find((object) => object.id === "lower-line");

  assert.ok(Math.abs(result.point.x - 8) < 1e-9);
  assert.ok(Math.abs(result.point.y + 6) < 1e-9);
  assert.ok(Math.abs(Math.hypot(upper.endX - upper.x, upper.endY - upper.y) - 10) < 1e-9);
  assert.ok(Math.abs(Math.hypot(lower.endX - lower.x, lower.endY - lower.y) - 10) < 1e-9);
  assert.deepEqual([upper.x, upper.y], [0, 0]);
  assert.deepEqual([lower.endX, lower.endY], [16, 0]);
});
