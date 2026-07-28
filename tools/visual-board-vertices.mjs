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

  const lines = splitLinesAtJoints(
    sourceLines.map(cloneValue),
    createIdentifier,
    Math.max(0, mergeDistance),
  );
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

  mergeTouchingEndpoints(endpoints, parents, Math.max(0, mergeDistance));

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

/**
 * Splits crossing lines and T-junctions before endpoint clustering so every
 * visible joint becomes one shared draggable vertex.
 */
function splitLinesAtJoints(lines, createIdentifier, mergeDistance) {
  const splitPositions = lines.map(() => [0, 1]);
  getPotentialLinePairs(lines, mergeDistance).forEach(([firstIndex, secondIndex]) => {
    const first = lines[firstIndex];
    const second = lines[secondIndex];
    const intersection = getSegmentIntersection(first, second);
    if (intersection) {
      addSplitPosition(splitPositions[firstIndex], intersection.firstProgress);
      addSplitPosition(splitPositions[secondIndex], intersection.secondProgress);
    }
    if (mergeDistance <= 0) return;
    addNearbyEndpointSplits(first, second, splitPositions[secondIndex], mergeDistance);
    addNearbyEndpointSplits(second, first, splitPositions[firstIndex], mergeDistance);
  });

  return lines.flatMap((line, lineIndex) => {
    const positions = splitPositions[lineIndex]
      .sort((first, second) => first - second)
      .filter((position, index, values) => (
        index === 0 || Math.abs(position - values[index - 1]) > 1e-9
      ));
    return positions.slice(1).map((endProgress, segmentIndex) => {
      const startProgress = positions[segmentIndex];
      const segment = cloneValue(line);
      if (segmentIndex > 0) segment.id = createIdentifier();
      const start = interpolateLine(line, startProgress);
      const end = interpolateLine(line, endProgress);
      segment.x = start.x;
      segment.y = start.y;
      segment.endX = end.x;
      segment.endY = end.y;
      return segment;
    });
  });
}

function getPotentialLinePairs(lines, padding) {
  if (lines.length < 2) return [];
  const lengths = lines
    .map((line) => distanceBetween(
      { x: line.x, y: line.y },
      { x: line.endX, y: line.endY },
    ))
    .sort((first, second) => first - second);
  const medianLength = lengths[Math.floor(lengths.length / 2)] || 16;
  const cellSize = Math.min(128, Math.max(8, medianLength * 4));
  const buckets = new Map();
  const pairKeys = new Set();
  const pairs = [];

  lines.forEach((line, lineIndex) => {
    const minimumX = Math.min(line.x, line.endX) - padding;
    const maximumX = Math.max(line.x, line.endX) + padding;
    const minimumY = Math.min(line.y, line.endY) - padding;
    const maximumY = Math.max(line.y, line.endY) + padding;
    const firstColumn = Math.floor(minimumX / cellSize);
    const lastColumn = Math.floor(maximumX / cellSize);
    const firstRow = Math.floor(minimumY / cellSize);
    const lastRow = Math.floor(maximumY / cellSize);

    for (let column = firstColumn; column <= lastColumn; column += 1) {
      for (let row = firstRow; row <= lastRow; row += 1) {
        const cellKey = `${column},${row}`;
        const existingLines = buckets.get(cellKey) ?? [];
        existingLines.forEach((otherIndex) => {
          const pairKey = otherIndex * lines.length + lineIndex;
          if (pairKeys.has(pairKey)) return;
          pairKeys.add(pairKey);
          pairs.push([otherIndex, lineIndex]);
        });
        existingLines.push(lineIndex);
        buckets.set(cellKey, existingLines);
      }
    }
  });
  return pairs;
}

function getSegmentIntersection(first, second) {
  const firstDelta = {
    x: first.endX - first.x,
    y: first.endY - first.y,
  };
  const secondDelta = {
    x: second.endX - second.x,
    y: second.endY - second.y,
  };
  const denominator = crossProduct(firstDelta, secondDelta);
  if (Math.abs(denominator) <= 1e-12) return null;
  const betweenStarts = {
    x: second.x - first.x,
    y: second.y - first.y,
  };
  const firstProgress = crossProduct(betweenStarts, secondDelta) / denominator;
  const secondProgress = crossProduct(betweenStarts, firstDelta) / denominator;
  const epsilon = 1e-9;
  if (
    firstProgress < -epsilon
    || firstProgress > 1 + epsilon
    || secondProgress < -epsilon
    || secondProgress > 1 + epsilon
  ) {
    return null;
  }
  return {
    firstProgress: clamp(firstProgress, 0, 1),
    secondProgress: clamp(secondProgress, 0, 1),
  };
}

function addNearbyEndpointSplits(source, target, targetSplits, mergeDistance) {
  [
    { x: source.x, y: source.y },
    { x: source.endX, y: source.endY },
  ].forEach((endpoint) => {
    const projection = projectPointOntoLine(endpoint, target);
    if (
      projection.progress > 1e-9
      && projection.progress < 1 - 1e-9
      && distanceBetween(endpoint, projection.point) <= mergeDistance
    ) {
      addSplitPosition(targetSplits, projection.progress);
    }
  });
}

function projectPointOntoLine(point, line) {
  const deltaX = line.endX - line.x;
  const deltaY = line.endY - line.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) {
    return { progress: 0, point: { x: line.x, y: line.y } };
  }
  const progress = clamp(
    ((point.x - line.x) * deltaX + (point.y - line.y) * deltaY) / lengthSquared,
    0,
    1,
  );
  return {
    progress,
    point: interpolateLine(line, progress),
  };
}

function addSplitPosition(positions, progress) {
  if (progress > 1e-9 && progress < 1 - 1e-9) positions.push(progress);
}

function interpolateLine(line, progress) {
  return {
    x: line.x + (line.endX - line.x) * progress,
    y: line.y + (line.endY - line.y) * progress,
  };
}

function crossProduct(first, second) {
  return first.x * second.y - first.y * second.x;
}

function mergeTouchingEndpoints(endpoints, parents, mergeDistance) {
  if (mergeDistance === 0) {
    const exactPoints = new Map();
    endpoints.forEach((endpoint, index) => {
      const key = `${endpoint.point.x},${endpoint.point.y}`;
      if (exactPoints.has(key)) union(parents, exactPoints.get(key), index);
      else exactPoints.set(key, index);
    });
    return;
  }

  const buckets = new Map();
  endpoints.forEach((endpoint, index) => {
    const column = Math.floor(endpoint.point.x / mergeDistance);
    const row = Math.floor(endpoint.point.y / mergeDistance);
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        const nearby = buckets.get(`${column + columnOffset},${row + rowOffset}`) ?? [];
        nearby.forEach((otherIndex) => {
          if (
            distanceBetween(endpoint.point, endpoints[otherIndex].point)
            <= mergeDistance
          ) {
            union(parents, otherIndex, index);
          }
        });
      }
    }
    const key = `${column},${row}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(index);
    buckets.set(key, bucket);
  });
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

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distanceBetween(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
