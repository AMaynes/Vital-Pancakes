import test from "node:test";
import assert from "node:assert/strict";

import {
  createEditableVertexNetwork,
  getVertexNetworkVertices,
  setVertexNetworkPosition,
} from "./visual-board-vertices.mjs";

function identifierFactory() {
  let index = 0;
  return () => `vertex-${index += 1}`;
}

test("touching line endpoints merge while separate endpoints remain editable", () => {
  const network = createEditableVertexNetwork([
    {
      id: "line-1",
      type: "line",
      x: 10,
      y: 20,
      endX: 100,
      endY: 20,
      assemblyId: "old-assembly",
    },
    {
      id: "line-2",
      type: "line",
      x: 100.004,
      y: 20.006,
      endX: 140,
      endY: 90,
      assemblyId: "old-assembly",
    },
  ], identifierFactory(), 0.01);

  assert.ok(network);
  assert.equal(network.objects.length, 2);
  assert.equal(network.vertices.length, 3);
  assert.equal(network.objects[0].endVertexId, network.objects[1].startVertexId);
  assert.ok(Math.abs(network.objects[0].endX - 100.002) < 1e-9);
  assert.ok(Math.abs(network.objects[1].x - 100.002) < 1e-9);
  assert.ok(Math.abs(network.objects[0].endY - 20.003) < 1e-9);
  assert.ok(Math.abs(network.objects[1].y - 20.003) < 1e-9);
  assert.equal(network.objects[0].groupId, network.objects[1].groupId);
  assert.equal(network.objects[0].vertexNetworkId, network.objects[1].vertexNetworkId);
  assert.equal("assemblyId" in network.objects[0], false);
});

test("moving a shared vertex reshapes every incident line only", () => {
  const network = createEditableVertexNetwork([
    { id: "line-1", type: "line", x: 0, y: 0, endX: 50, endY: 0 },
    { id: "line-2", type: "line", x: 50, y: 0, endX: 50, endY: 50 },
  ], identifierFactory(), 0);
  const sharedVertexId = network.objects[0].endVertexId;
  const updated = setVertexNetworkPosition(
    network.objects,
    sharedVertexId,
    { x: 70, y: 30 },
  );

  assert.equal(updated, 2);
  assert.deepEqual(
    [network.objects[0].endX, network.objects[0].endY],
    [70, 30],
  );
  assert.deepEqual(
    [network.objects[1].x, network.objects[1].y],
    [70, 30],
  );
  assert.deepEqual(
    [network.objects[0].x, network.objects[0].y],
    [0, 0],
  );

  const vertices = getVertexNetworkVertices(network.objects);
  assert.equal(vertices.length, 3);
  assert.deepEqual(
    vertices.find((vertex) => vertex.id === sharedVertexId),
    { id: sharedVertexId, x: 70, y: 30 },
  );
});

test("closely spaced curve vertices remain distinct unless they touch", () => {
  const network = createEditableVertexNetwork([
    { id: "curve-1", type: "line", x: 0, y: 0, endX: 0.02, endY: 0 },
    { id: "curve-2", type: "line", x: 0.02, y: 0, endX: 0.04, endY: 0.01 },
  ], identifierFactory(), 0.01);

  assert.equal(network.vertices.length, 3);
  assert.notEqual(network.objects[0].startVertexId, network.objects[0].endVertexId);
  assert.equal(network.objects[0].endVertexId, network.objects[1].startVertexId);
  assert.notEqual(network.objects[1].startVertexId, network.objects[1].endVertexId);
});

test("crossing lines split at one shared editable joint", () => {
  const network = createEditableVertexNetwork([
    { id: "horizontal", type: "line", x: 0, y: 50, endX: 100, endY: 50 },
    { id: "vertical", type: "line", x: 50, y: 0, endX: 50, endY: 100 },
  ], identifierFactory(), 0.01);

  assert.equal(network.objects.length, 4);
  assert.equal(network.vertices.length, 5);
  const centerVertices = network.objects.flatMap((object) => [
    object.startVertexId,
    object.endVertexId,
  ]).filter((vertexId) => {
    const vertex = network.vertices.find((candidate) => candidate.id === vertexId);
    return vertex.x === 50 && vertex.y === 50;
  });
  assert.equal(new Set(centerVertices).size, 1);
  assert.equal(centerVertices.length, 4);
});

test("a line endpoint touching another line creates a T-junction", () => {
  const network = createEditableVertexNetwork([
    { id: "horizontal", type: "line", x: 0, y: 50, endX: 100, endY: 50 },
    { id: "vertical", type: "line", x: 50, y: 0, endX: 50, endY: 50 },
  ], identifierFactory(), 0.01);

  assert.equal(network.objects.length, 3);
  assert.equal(network.vertices.length, 4);
  const joint = network.vertices.find((vertex) => vertex.x === 50 && vertex.y === 50);
  assert.ok(joint);
  assert.equal(
    network.objects.filter((object) => (
      object.startVertexId === joint.id || object.endVertexId === joint.id
    )).length,
    3,
  );
});

test("a line crossing a curve creates shared joints without flattening the curve", () => {
  const network = createEditableVertexNetwork([
    {
      id: "curve",
      type: "arc",
      x: 0,
      y: 50,
      midX: 50,
      midY: 0,
      endX: 100,
      endY: 50,
    },
    {
      id: "line",
      type: "line",
      x: 0,
      y: 25,
      endX: 100,
      endY: 25,
    },
  ], identifierFactory(), 0.01);

  const curve = network.objects.find((object) => object.type === "arc");
  const lines = network.objects.filter((object) => object.type === "line");
  assert.ok(curve);
  assert.equal(lines.length, 3);
  assert.equal(curve.curvePoints.length, 5);
  const sharedIds = new Set(lines.flatMap((line) => [
    line.startVertexId,
    line.endVertexId,
  ]).filter((id) => curve.curveVertexIds.includes(id)));
  assert.equal(sharedIds.size, 2);
});

test("two curves can share an inserted crossing vertex", () => {
  const network = createEditableVertexNetwork([
    {
      id: "horizontal",
      type: "arc",
      x: 0,
      y: 50,
      midX: 50,
      midY: 50,
      endX: 100,
      endY: 50,
    },
    {
      id: "vertical",
      type: "arc",
      x: 25,
      y: 0,
      midX: 25,
      midY: 25,
      endX: 25,
      endY: 100,
    },
  ], identifierFactory(), 0.01);

  assert.equal(network.objects.length, 2);
  const [horizontal, vertical] = network.objects;
  const sharedIds = horizontal.curveVertexIds.filter((id) => (
    vertical.curveVertexIds.includes(id)
  ));
  assert.equal(new Set(sharedIds).size, 1);
  assert.equal(horizontal.curvePoints.length, 4);
  assert.equal(vertical.curvePoints.length, 4);
});

test("moving a shared curve joint reshapes every incident curve", () => {
  const network = createEditableVertexNetwork([
    {
      id: "horizontal",
      type: "arc",
      x: 0,
      y: 50,
      midX: 50,
      midY: 50,
      endX: 100,
      endY: 50,
    },
    {
      id: "vertical",
      type: "arc",
      x: 25,
      y: 0,
      midX: 25,
      midY: 25,
      endX: 25,
      endY: 100,
    },
  ], identifierFactory(), 0.01);
  const [horizontal, vertical] = network.objects;
  const sharedId = horizontal.curveVertexIds.find((id) => (
    vertical.curveVertexIds.includes(id)
  ));

  assert.equal(
    setVertexNetworkPosition(network.objects, sharedId, { x: 30, y: 60 }),
    2,
  );
  const horizontalIndex = horizontal.curveVertexIds.indexOf(sharedId);
  const verticalIndex = vertical.curveVertexIds.indexOf(sharedId);
  assert.deepEqual(horizontal.curvePoints[horizontalIndex], { x: 30, y: 60 });
  assert.deepEqual(vertical.curvePoints[verticalIndex], { x: 30, y: 60 });
});
