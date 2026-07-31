import test from "node:test";
import assert from "node:assert/strict";

import {
  createEditableVertexNetwork,
  getVertexNetworkVertices,
  insertLineVertex,
  mergeVertexNetworkVertexAtNearest,
  mergeVertexNetworkVertices,
  setVertexNetworkPosition,
} from "./visual-board-vertices.mjs";
import {
  getCurvePoint,
  getQuadraticCurvePoint,
} from "./visual-board-curves.mjs";

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

test("creating vertices preserves the exact original arc", () => {
  const source = {
    id: "curve",
    type: "arc",
    x: 0,
    y: 40,
    midX: 45,
    midY: -20,
    endX: 120,
    endY: 60,
  };
  const expected = Array.from({ length: 17 }, (_, index) => (
    getQuadraticCurvePoint(source, index / 16)
  ));
  const network = createEditableVertexNetwork(
    [source],
    identifierFactory(),
    0.01,
  );
  const curve = network.objects[0];
  const actual = Array.from({ length: 17 }, (_, index) => {
    const progress = index / 16;
    const segmentIndex = progress < 0.5 ? 0 : 1;
    const localProgress = segmentIndex === 0
      ? progress * 2
      : (progress - 0.5) * 2;
    return getCurvePoint(curve, segmentIndex, localProgress);
  });

  actual.forEach((point, index) => {
    assert.ok(Math.abs(point.x - expected[index].x) < 1e-8);
    assert.ok(Math.abs(point.y - expected[index].y) < 1e-8);
  });
});

test("grouped paths retain their previous group beneath the vertex network", () => {
  const network = createEditableVertexNetwork([
    {
      id: "first",
      type: "line",
      x: 0,
      y: 0,
      endX: 20,
      endY: 20,
      groupId: "small-group",
      rigidGroup: true,
    },
    {
      id: "second",
      type: "line",
      x: 20,
      y: 20,
      endX: 40,
      endY: 0,
      groupId: "small-group",
      rigidGroup: true,
    },
  ], identifierFactory(), 0.01);

  assert.ok(network.objects.every((object) => object.groupId === network.groupId));
  assert.ok(network.objects.every((object) => !object.rigidGroup));
  assert.ok(network.objects.every((object) => (
    object.groupHistory.at(-1)?.id === "small-group"
    && object.groupHistory.at(-1)?.rigidGroup
  )));
  assert.equal(network.objects[0].endVertexId, network.objects[1].startVertexId);
});

test("dropping grouped network vertices together merges their identities", () => {
  const network = createEditableVertexNetwork([
    {
      id: "first",
      type: "line",
      x: 0,
      y: 0,
      endX: 40,
      endY: 0,
      groupId: "small-group",
      rigidGroup: true,
    },
    {
      id: "second",
      type: "line",
      x: 100,
      y: 0,
      endX: 140,
      endY: 0,
      groupId: "small-group",
      rigidGroup: true,
    },
  ], identifierFactory(), 0.01);
  const sourceVertexId = network.objects[0].endVertexId;
  const targetVertexId = network.objects[1].startVertexId;

  setVertexNetworkPosition(
    network.objects,
    sourceVertexId,
    { x: 100.004, y: 0.003 },
  );
  const merged = mergeVertexNetworkVertexAtNearest(
    network.objects,
    sourceVertexId,
    0.01,
  );

  assert.equal(merged.targetVertexId, targetVertexId);
  assert.equal(network.objects[0].endVertexId, targetVertexId);
  assert.deepEqual(
    [network.objects[0].endX, network.objects[0].endY],
    [100, 0],
  );
  assert.equal(getVertexNetworkVertices(network.objects).length, 3);
  assert.ok(network.objects.every((object) => (
    object.groupHistory.at(-1)?.id === "small-group"
  )));
});

test("vertex merging refuses to collapse both ends of one path", () => {
  const network = createEditableVertexNetwork([
    { id: "line", type: "line", x: 0, y: 0, endX: 10, endY: 0 },
  ], identifierFactory(), 0.01);

  assert.equal(
    mergeVertexNetworkVertices(
      network.objects,
      network.objects[0].startVertexId,
      network.objects[0].endVertexId,
    ),
    null,
  );
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

test("adding a line vertex creates two segments with one shared joint", () => {
  const result = insertLineVertex(
    [{ id: "line", type: "line", x: 0, y: 0, endX: 100, endY: 0 }],
    { x: 40, y: 3 },
    identifierFactory(),
    5,
  );

  assert.ok(result);
  assert.equal(result.sourceObjectId, "line");
  assert.deepEqual(result.point, { x: 40, y: 0 });
  assert.equal(result.objects.length, 2);
  assert.equal(result.objects[0].id, "line");
  assert.equal(result.objects[0].endVertexId, result.vertexId);
  assert.equal(result.objects[1].startVertexId, result.vertexId);
  assert.equal(result.objects[0].vertexNetworkId, result.objects[1].vertexNetworkId);
  assert.equal(result.objects[0].groupId, result.objects[1].groupId);
  assert.deepEqual(
    [result.objects[0].endX, result.objects[0].endY],
    [40, 0],
  );
  assert.deepEqual(
    [result.objects[1].x, result.objects[1].y],
    [40, 0],
  );
});

test("adding an arrow vertex preserves arrowheads only at the original ends", () => {
  const network = createEditableVertexNetwork([{
    id: "arrow",
    type: "connector",
    x: 0,
    y: 0,
    endX: 100,
    endY: 0,
    arrowStart: true,
    arrowEnd: true,
  }], identifierFactory(), 0);
  const original = network.objects[0];
  const result = insertLineVertex(
    [original],
    { x: 60, y: 0 },
    identifierFactory(),
  );

  assert.ok(result);
  assert.equal(result.networkId, original.vertexNetworkId);
  assert.equal(result.objects[0].startVertexId, original.startVertexId);
  assert.equal(result.objects[1].endVertexId, original.endVertexId);
  assert.equal(result.objects[0].arrowStart, true);
  assert.equal(result.objects[0].arrowEnd, false);
  assert.equal(result.objects[1].arrowStart, false);
  assert.equal(result.objects[1].arrowEnd, true);
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
  const sourceCurve = {
    id: "curve",
    type: "arc",
    x: 0,
    y: 50,
    midX: 50,
    midY: 0,
    endX: 100,
    endY: 50,
  };
  const originalPoints = Array.from({ length: 33 }, (_, index) => (
    getQuadraticCurvePoint(sourceCurve, index / 32)
  ));
  const network = createEditableVertexNetwork([
    sourceCurve,
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
  originalPoints.forEach((point, index) => {
    const progress = index / 32;
    const segmentIndex = Math.min(
      curve.curvePoints.length - 2,
      curve.curvePoints.findIndex((candidate, candidateIndex) => (
        candidateIndex > 0 && candidate.x / 100 >= progress
      )) - 1,
    );
    const startProgress = curve.curvePoints[segmentIndex].x / 100;
    const endProgress = curve.curvePoints[segmentIndex + 1].x / 100;
    const actual = getCurvePoint(
      curve,
      segmentIndex,
      (progress - startProgress) / (endProgress - startProgress),
    );
    assert.ok(Math.abs(actual.x - point.x) < 1e-8);
    assert.ok(Math.abs(actual.y - point.y) < 1e-8);
  });
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
