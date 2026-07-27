import test from "node:test";
import assert from "node:assert/strict";

import { duplicateBoardObjects } from "./visual-board-clipboard.mjs";

function identifierFactory() {
  let index = 0;
  return () => `copy-${index += 1}`;
}

test("copying multiple objects preserves their layout and remaps their group", () => {
  const source = [
    {
      id: "line-1",
      type: "line",
      x: 10,
      y: 20,
      endX: 110,
      endY: 70,
      groupId: "group-1",
      locked: true,
    },
    {
      id: "text-1",
      type: "textbox",
      x: 140,
      y: 30,
      w: 160,
      h: 60,
      groupId: "group-1",
      locked: false,
    },
  ];

  const copies = duplicateBoardObjects(source, identifierFactory(), { x: 32, y: 64 });

  assert.equal(copies.length, 2);
  assert.notEqual(copies[0].id, source[0].id);
  assert.notEqual(copies[1].id, source[1].id);
  assert.equal(copies[0].groupId, copies[1].groupId);
  assert.notEqual(copies[0].groupId, source[0].groupId);
  assert.deepEqual(
    [copies[0].x, copies[0].y, copies[0].endX, copies[0].endY],
    [42, 84, 142, 134],
  );
  assert.deepEqual([copies[1].x, copies[1].y], [172, 94]);
  assert.equal(copies[0].locked, false);
  assert.deepEqual([source[0].x, source[0].y], [10, 20]);
});

test("copying divided lines preserves a movable, reassemblable source", () => {
  const assemblySource = {
    id: "shape-1",
    type: "rectangle",
    x: 20,
    y: 30,
    w: 100,
    h: 60,
  };
  const source = [
    {
      id: "part-1",
      type: "line",
      x: 20,
      y: 30,
      endX: 120,
      endY: 30,
      assemblyId: "assembly-1",
      assemblyIndex: 0,
      assemblyCount: 2,
      assemblySource,
    },
    {
      id: "part-2",
      type: "line",
      x: 120,
      y: 30,
      endX: 120,
      endY: 90,
      assemblyId: "assembly-1",
      assemblyIndex: 1,
      assemblyCount: 2,
      assemblySource,
    },
  ];

  const copies = duplicateBoardObjects(source, identifierFactory(), { x: 16, y: 16 });

  assert.equal(copies[0].assemblyId, copies[1].assemblyId);
  assert.notEqual(copies[0].assemblyId, source[0].assemblyId);
  assert.equal(copies[0].assemblySource.id, copies[1].assemblySource.id);
  assert.deepEqual(
    [copies[0].assemblySource.x, copies[0].assemblySource.y],
    [36, 46],
  );
  assert.deepEqual(
    [copies[1].x, copies[1].y, copies[1].endX, copies[1].endY],
    [136, 46, 136, 106],
  );
});

test("copying an editable vertex network remaps shared vertices together", () => {
  const source = [
    {
      id: "line-1",
      type: "line",
      x: 0,
      y: 0,
      endX: 50,
      endY: 0,
      groupId: "group-1",
      vertexNetworkId: "network-1",
      startVertexId: "vertex-a",
      endVertexId: "vertex-b",
    },
    {
      id: "line-2",
      type: "line",
      x: 50,
      y: 0,
      endX: 50,
      endY: 50,
      groupId: "group-1",
      vertexNetworkId: "network-1",
      startVertexId: "vertex-b",
      endVertexId: "vertex-c",
    },
  ];

  const copies = duplicateBoardObjects(source, identifierFactory(), { x: 16, y: 16 });

  assert.equal(copies[0].vertexNetworkId, copies[1].vertexNetworkId);
  assert.notEqual(copies[0].vertexNetworkId, source[0].vertexNetworkId);
  assert.equal(copies[0].endVertexId, copies[1].startVertexId);
  assert.notEqual(copies[0].endVertexId, source[0].endVertexId);
  assert.deepEqual(
    [copies[1].x, copies[1].y, copies[1].endX, copies[1].endY],
    [66, 16, 66, 66],
  );
});
