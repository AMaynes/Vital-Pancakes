/**
 * Pure shared-vertex helpers for editable Visual Board line networks.
 */

export function createEditableVertexNetwork(
  sourceLines,
  createIdentifier,
  mergeDistance = 0.01,
) {
  if (!Array.isArray(sourceLines) || !sourceLines.length) return null;
  if (typeof createIdentifier !== "function") return null;

  const lines = sourceLines.map(cloneValue);
  const endpoints = lines.flatMap((line, lineIndex) => [
    {
      lineIndex,
      endpoint: "start",
      point: { x: line.x, y: line.y },
    },
    {
      lineIndex,
      endpoint: "end",
      point: { x: line.endX, y: line.endY },
    },
  ]);
  const parents = endpoints.map((_, index) => index);

  for (let first = 0; first < endpoints.length; first += 1) {
    for (let second = first + 1; second < endpoints.length; second += 1) {
      if (distanceBetween(endpoints[first].point, endpoints[second].point) <= mergeDistance) {
        union(parents, first, second);
      }
    }
  }

  const networkId = createIdentifier();
  const groupId = createIdentifier();
  const clusters = new Map();
  endpoints.forEach((endpoint, index) => {
    const root = findRoot(parents, index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(endpoint);
  });

  const vertices = [...clusters.values()].map((members) => {
    const vertex = {
      id: createIdentifier(),
      x: average(members.map((member) => member.point.x)),
      y: average(members.map((member) => member.point.y)),
    };
    members.forEach((member) => {
      member.vertex = vertex;
    });
    return vertex;
  });

  lines.forEach((line, lineIndex) => {
    const start = endpoints[lineIndex * 2].vertex;
    const end = endpoints[lineIndex * 2 + 1].vertex;

    delete line.assemblyId;
    delete line.assemblyIndex;
    delete line.assemblyCount;
    delete line.assemblySource;
    line.groupId = groupId;
    line.vertexNetworkId = networkId;
    line.startVertexId = start.id;
    line.endVertexId = end.id;
    line.x = start.x;
    line.y = start.y;
    line.endX = end.x;
    line.endY = end.y;
  });

  return {
    objects: lines,
    networkId,
    groupId,
    vertices,
  };
}

export function getVertexNetworkVertices(objects) {
  const vertices = new Map();
  objects.forEach((object) => {
    addVertexPoint(vertices, object.startVertexId, object.x, object.y);
    addVertexPoint(vertices, object.endVertexId, object.endX, object.endY);
  });
  return [...vertices.entries()].map(([id, points]) => ({
    id,
    x: average(points.map((point) => point.x)),
    y: average(points.map((point) => point.y)),
  }));
}

export function setVertexNetworkPosition(objects, vertexId, point) {
  let updatedEndpoints = 0;
  objects.forEach((object) => {
    if (object.startVertexId === vertexId) {
      object.x = point.x;
      object.y = point.y;
      updatedEndpoints += 1;
    }
    if (object.endVertexId === vertexId) {
      object.endX = point.x;
      object.endY = point.y;
      updatedEndpoints += 1;
    }
  });
  return updatedEndpoints;
}

function addVertexPoint(vertices, vertexId, x, y) {
  if (typeof vertexId !== "string" || !vertexId) return;
  if (!vertices.has(vertexId)) vertices.set(vertexId, []);
  vertices.get(vertexId).push({ x, y });
}

function findRoot(parents, index) {
  if (parents[index] !== index) parents[index] = findRoot(parents, parents[index]);
  return parents[index];
}

function union(parents, first, second) {
  const firstRoot = findRoot(parents, first);
  const secondRoot = findRoot(parents, second);
  if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function distanceBetween(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
