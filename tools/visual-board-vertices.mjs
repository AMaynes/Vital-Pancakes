/**
 * Pure shared-vertex helpers for editable Visual Board path networks.
 *
 * Straight paths split into independent line objects at crossings. Curves stay
 * intact and gain on-curve knots at crossings. Every incident path then refers
 * to the same draggable vertex identifier.
 */

import {
  createEditableCurveGeometry,
  getCurveBezierSegments,
  getCurveVertices,
  insertCurveVertexAt,
  setCurveVertexPosition,
  setCurveVertexPositionPreservingHandles,
} from "./visual-board-curves.mjs?v=6";
import {
  popObjectGroupLevel,
  pushObjectGroupLevel,
} from "./visual-board-groups.mjs?v=4";

const CURVE_SAMPLE_STEPS = 128;
const SPLIT_EPSILON = 1e-7;
const INSERTABLE_LINE_TYPES = new Set(["line", "connector"]);

export function createEditableVertexNetwork(
  sourceObjects,
  createIdentifier,
  mergeDistance = 0.01,
) {
  if (!Array.isArray(sourceObjects) || !sourceObjects.length) return null;
  if (typeof createIdentifier !== "function") return null;
  if (!sourceObjects.every(isSupportedPath)) return null;

  const prepared = preparePathsAtJoints(
    sourceObjects.map(cloneValue),
    createIdentifier,
    Math.max(0, mergeDistance),
  );
  const members = prepared.flatMap(getObjectVertexMembers);
  const parents = members.map((_, index) => index);
  mergeTouchingMembers(members, parents, Math.max(0, mergeDistance));

  const networkId = createIdentifier();
  const groupId = createIdentifier();
  const clusters = new Map();
  members.forEach((member, index) => {
    const root = findRoot(parents, index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(member);
  });

  const vertices = [...clusters.values()].map((clusterMembers) => {
    const curveMember = clusterMembers.find((member) => member.object.type === "arc");
    const vertex = {
      id: createIdentifier(),
      x: curveMember?.point.x
        ?? average(clusterMembers.map((member) => member.point.x)),
      y: curveMember?.point.y
        ?? average(clusterMembers.map((member) => member.point.y)),
    };
    clusterMembers.forEach((member) => {
      member.vertex = vertex;
    });
    return vertex;
  });

  prepared.forEach((object) => {
    if (object.vertexNetworkId && object.groupId && !object.rigidGroup) {
      popObjectGroupLevel(object);
    }
    clearAssemblyData(object);
    pushObjectGroupLevel(object, groupId, false);
    object.vertexNetworkId = networkId;

    const objectMembers = members.filter((member) => member.object === object);
    if (object.type === "arc") {
      object.curveVertexIds = Array(object.curvePoints.length).fill(null);
      objectMembers.forEach((member) => {
        object.curveVertexIds[member.vertexIndex] = member.vertex.id;
        setCurveVertexPositionPreservingHandles(
          object,
          member.vertexIndex,
          member.vertex,
        );
      });
      return;
    }

    const start = objectMembers.find((member) => member.endpoint === "start").vertex;
    const end = objectMembers.find((member) => member.endpoint === "end").vertex;
    object.startVertexId = start.id;
    object.endVertexId = end.id;
    object.x = start.x;
    object.y = start.y;
    object.endX = end.x;
    object.endY = end.y;
  });

  return {
    objects: prepared,
    networkId,
    groupId,
    vertices,
  };
}

/**
 * Splits the nearest selected line at an exact projected point. Standalone
 * lines are upgraded to a vertex network; existing network identity is kept.
 */
export function insertLineVertex(
  sourceLines,
  target,
  createIdentifier,
  maximumDistance = Infinity,
) {
  if (
    !Array.isArray(sourceLines)
    || typeof createIdentifier !== "function"
    || !Number.isFinite(target?.x)
    || !Number.isFinite(target?.y)
  ) {
    return null;
  }
  const distanceLimit = Number.isFinite(maximumDistance)
    ? Math.max(0, maximumDistance)
    : Infinity;
  const candidate = sourceLines
    .filter((line) => (
      INSERTABLE_LINE_TYPES.has(line?.type)
      && !line.locked
      && Number.isFinite(line.x)
      && Number.isFinite(line.y)
      && Number.isFinite(line.endX)
      && Number.isFinite(line.endY)
    ))
    .map((line) => {
      const projection = projectPointOntoLine(target, line);
      return {
        line,
        projection,
        distance: distanceBetween(target, projection.point),
      };
    })
    .filter(({ projection, distance }) => (
      distance <= distanceLimit
      && projection.progress > SPLIT_EPSILON
      && projection.progress < 1 - SPLIT_EPSILON
    ))
    .sort((first, second) => (
      first.distance - second.distance
      || String(first.line.id ?? "").localeCompare(String(second.line.id ?? ""))
    ))[0];
  if (!candidate) return null;

  const source = candidate.line;
  const hasNetworkIdentity = [
    source.vertexNetworkId,
    source.startVertexId,
    source.endVertexId,
  ].every((value) => typeof value === "string" && value);
  const base = hasNetworkIdentity
    ? cloneValue(source)
    : createEditableVertexNetwork([source], createIdentifier, 0)?.objects[0];
  if (!base) return null;

  const point = clonePoint(candidate.projection.point);
  const vertexId = createIdentifier();
  const first = cloneValue(base);
  const second = cloneValue(base);
  second.id = createIdentifier();
  first.endX = point.x;
  first.endY = point.y;
  first.endVertexId = vertexId;
  second.x = point.x;
  second.y = point.y;
  second.startVertexId = vertexId;
  if (base.type === "connector") {
    first.arrowStart = Boolean(base.arrowStart);
    first.arrowEnd = false;
    second.arrowStart = false;
    second.arrowEnd = base.arrowEnd !== false;
  }

  return {
    sourceObjectId: source.id,
    objects: [first, second],
    networkId: first.vertexNetworkId,
    groupId: first.groupId,
    vertexId,
    point,
    progress: candidate.projection.progress,
  };
}

function preparePathsAtJoints(objects, createIdentifier, mergeDistance) {
  objects = objects.map((object) => (
    object.type === "arc" ? createEditableCurveGeometry(object) : object
  ));
  const sampledSegments = objects.flatMap((object, objectIndex) => (
    sampleObjectSegments(object, objectIndex)
  ));
  const splitRequests = objects.map(() => []);

  getPotentialSegmentPairs(sampledSegments, mergeDistance)
    .forEach(([firstIndex, secondIndex]) => {
      const first = sampledSegments[firstIndex];
      const second = sampledSegments[secondIndex];
      if (segmentsAreNeighbors(first, second)) return;
      const intersection = getSegmentIntersection(first, second);
      if (!intersection) return;
      const point = interpolateLine(first, intersection.firstProgress);
      addSplitRequest(
        splitRequests[first.objectIndex],
        mapSegmentProgress(first, intersection.firstProgress),
        point,
      );
      addSplitRequest(
        splitRequests[second.objectIndex],
        mapSegmentProgress(second, intersection.secondProgress),
        point,
      );
    });

  if (mergeDistance > 0) {
    objects.forEach((source, sourceIndex) => {
      getExistingPathPoints(source).forEach((point) => {
        sampledSegments.forEach((segment) => {
          if (segment.objectIndex === sourceIndex) return;
          const projection = projectPointOntoLine(point, segment);
          if (
            projection.progress > SPLIT_EPSILON
            && projection.progress < 1 - SPLIT_EPSILON
            && distanceBetween(point, projection.point) <= mergeDistance
          ) {
            addSplitRequest(
              splitRequests[segment.objectIndex],
              mapSegmentProgress(segment, projection.progress),
              point,
            );
          }
        });
      });
    });
  }

  return objects.flatMap((object, objectIndex) => {
    if (object.type === "arc") {
      return [insertCurveJointRequests(object, splitRequests[objectIndex])];
    }
    return splitLineAtRequests(
      object,
      splitRequests[objectIndex],
      createIdentifier,
    );
  });
}

function sampleObjectSegments(object, objectIndex) {
  if (object.type !== "arc") {
    return [{
      objectIndex,
      sampleIndex: 0,
      pathType: "line",
      segmentIndex: 0,
      startProgress: 0,
      endProgress: 1,
      x: object.x,
      y: object.y,
      endX: object.endX,
      endY: object.endY,
    }];
  }

  return getCurveBezierSegments(object).flatMap((segment, segmentIndex) => (
    Array.from({ length: CURVE_SAMPLE_STEPS }, (_, sampleIndex) => {
      const startProgress = sampleIndex / CURVE_SAMPLE_STEPS;
      const endProgress = (sampleIndex + 1) / CURVE_SAMPLE_STEPS;
      const start = cubicPoint(segment, startProgress);
      const end = cubicPoint(segment, endProgress);
      return {
        objectIndex,
        sampleIndex,
        pathType: "curve",
        segmentIndex,
        startProgress,
        endProgress,
        x: start.x,
        y: start.y,
        endX: end.x,
        endY: end.y,
      };
    })
  ));
}

function getPotentialSegmentPairs(segments, padding) {
  if (segments.length < 2) return [];
  const lengths = segments
    .map((segment) => distanceBetween(
      { x: segment.x, y: segment.y },
      { x: segment.endX, y: segment.endY },
    ))
    .sort((first, second) => first - second);
  const medianLength = lengths[Math.floor(lengths.length / 2)] || 16;
  const cellSize = Math.min(128, Math.max(8, medianLength * 4));
  const buckets = new Map();
  const pairKeys = new Set();
  const pairs = [];

  segments.forEach((segment, segmentIndex) => {
    const minimumX = Math.min(segment.x, segment.endX) - padding;
    const maximumX = Math.max(segment.x, segment.endX) + padding;
    const minimumY = Math.min(segment.y, segment.endY) - padding;
    const maximumY = Math.max(segment.y, segment.endY) + padding;
    const firstColumn = Math.floor(minimumX / cellSize);
    const lastColumn = Math.floor(maximumX / cellSize);
    const firstRow = Math.floor(minimumY / cellSize);
    const lastRow = Math.floor(maximumY / cellSize);

    for (let column = firstColumn; column <= lastColumn; column += 1) {
      for (let row = firstRow; row <= lastRow; row += 1) {
        const cellKey = `${column},${row}`;
        const existing = buckets.get(cellKey) ?? [];
        existing.forEach((otherIndex) => {
          const pairKey = otherIndex * segments.length + segmentIndex;
          if (pairKeys.has(pairKey)) return;
          pairKeys.add(pairKey);
          pairs.push([otherIndex, segmentIndex]);
        });
        existing.push(segmentIndex);
        buckets.set(cellKey, existing);
      }
    }
  });
  return pairs;
}

function segmentsAreNeighbors(first, second) {
  if (first.objectIndex !== second.objectIndex) return false;
  if (first.pathType === "line") return true;
  if (first.segmentIndex === second.segmentIndex) {
    return Math.abs(first.sampleIndex - second.sampleIndex) <= 1;
  }
  if (first.segmentIndex + 1 === second.segmentIndex) {
    return first.sampleIndex === CURVE_SAMPLE_STEPS - 1 && second.sampleIndex === 0;
  }
  if (second.segmentIndex + 1 === first.segmentIndex) {
    return second.sampleIndex === CURVE_SAMPLE_STEPS - 1 && first.sampleIndex === 0;
  }
  return false;
}

function addSplitRequest(requests, location, point) {
  const atPathEndpoint = location.pathType === "line"
    ? location.progress <= SPLIT_EPSILON || location.progress >= 1 - SPLIT_EPSILON
    : location.progress <= SPLIT_EPSILON || location.progress >= 1 - SPLIT_EPSILON;
  if (atPathEndpoint) return;

  const duplicate = requests.find((request) => (
    request.pathType === location.pathType
    && request.segmentIndex === location.segmentIndex
    && Math.abs(request.progress - location.progress) <= SPLIT_EPSILON
  ));
  if (duplicate) {
    duplicate.point = {
      x: (duplicate.point.x + point.x) / 2,
      y: (duplicate.point.y + point.y) / 2,
    };
    return;
  }
  requests.push({ ...location, point: clonePoint(point) });
}

function insertCurveJointRequests(object, requests) {
  let curve = createEditableCurveGeometry(object);
  const bySegment = new Map();
  requests.filter((request) => request.pathType === "curve").forEach((request) => {
    const segmentRequests = bySegment.get(request.segmentIndex) ?? [];
    segmentRequests.push(request);
    bySegment.set(request.segmentIndex, segmentRequests);
  });

  [...bySegment.keys()].sort((first, second) => second - first).forEach((segmentIndex) => {
    let upperProgress = 1;
    bySegment.get(segmentIndex)
      .sort((first, second) => second.progress - first.progress)
      .forEach((request) => {
        const localProgress = clamp(request.progress / upperProgress, 0.001, 0.999);
        const result = insertCurveVertexAt(curve, segmentIndex, localProgress);
        curve = result.curve;
        upperProgress = request.progress;
      });
  });
  return curve;
}

function splitLineAtRequests(line, requests, createIdentifier) {
  const positions = [
    { progress: 0, point: { x: line.x, y: line.y } },
    ...requests
      .filter((request) => request.pathType === "line")
      .map((request) => ({
        progress: request.progress,
        point: request.point,
      })),
    { progress: 1, point: { x: line.endX, y: line.endY } },
  ]
    .sort((first, second) => first.progress - second.progress)
    .filter((item, index, values) => (
      index === 0
      || Math.abs(item.progress - values[index - 1].progress) > SPLIT_EPSILON
    ));

  return positions.slice(1).map((end, segmentIndex) => {
    const start = positions[segmentIndex];
    const segment = cloneValue(line);
    if (segmentIndex > 0) segment.id = createIdentifier();
    segment.x = start.point.x;
    segment.y = start.point.y;
    segment.endX = end.point.x;
    segment.endY = end.point.y;
    return segment;
  });
}

function getObjectVertexMembers(object) {
  if (object.type === "arc") {
    return getCurveVertices(object).map((point, vertexIndex) => ({
      object,
      vertexIndex,
      point,
    }));
  }
  return [
    {
      object,
      endpoint: "start",
      point: { x: object.x, y: object.y },
    },
    {
      object,
      endpoint: "end",
      point: { x: object.endX, y: object.endY },
    },
  ];
}

function getExistingPathPoints(object) {
  return object.type === "arc"
    ? getCurveVertices(object)
    : [
      { x: object.x, y: object.y },
      { x: object.endX, y: object.endY },
    ];
}

function mapSegmentProgress(segment, progress) {
  if (segment.pathType === "line") {
    return { pathType: "line", segmentIndex: 0, progress };
  }
  return {
    pathType: "curve",
    segmentIndex: segment.segmentIndex,
    progress: segment.startProgress
      + (segment.endProgress - segment.startProgress) * progress,
  };
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

function interpolateLine(line, progress) {
  return {
    x: line.x + (line.endX - line.x) * progress,
    y: line.y + (line.endY - line.y) * progress,
  };
}

function cubicPoint(segment, progress) {
  const remaining = 1 - progress;
  return {
    x: remaining ** 3 * segment.start.x
      + 3 * remaining ** 2 * progress * segment.control1.x
      + 3 * remaining * progress ** 2 * segment.control2.x
      + progress ** 3 * segment.end.x,
    y: remaining ** 3 * segment.start.y
      + 3 * remaining ** 2 * progress * segment.control1.y
      + 3 * remaining * progress ** 2 * segment.control2.y
      + progress ** 3 * segment.end.y,
  };
}

function mergeTouchingMembers(members, parents, mergeDistance) {
  if (mergeDistance === 0) {
    const exactPoints = new Map();
    members.forEach((member, index) => {
      const key = `${member.point.x},${member.point.y}`;
      if (exactPoints.has(key)) union(parents, exactPoints.get(key), index);
      else exactPoints.set(key, index);
    });
    return;
  }

  const buckets = new Map();
  members.forEach((member, index) => {
    const column = Math.floor(member.point.x / mergeDistance);
    const row = Math.floor(member.point.y / mergeDistance);
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        const nearby = buckets.get(`${column + columnOffset},${row + rowOffset}`) ?? [];
        nearby.forEach((otherIndex) => {
          if (
            distanceBetween(member.point, members[otherIndex].point)
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
    if (object.type === "arc") {
      getCurveVertices(object).forEach((point, index) => {
        addVertexPoint(vertices, object.curveVertexIds?.[index], point.x, point.y);
      });
      return;
    }
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
    if (object.type === "arc") {
      (object.curveVertexIds ?? []).forEach((candidateId, vertexIndex) => {
        if (candidateId !== vertexId) return;
        if (setCurveVertexPosition(object, vertexIndex, point)) updatedEndpoints += 1;
      });
      return;
    }
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

export function mergeVertexNetworkVertices(objects, sourceVertexId, targetVertexId) {
  if (!Array.isArray(objects)
    || !sourceVertexId
    || !targetVertexId
    || sourceVertexId === targetVertexId
    || verticesShareObject(objects, sourceVertexId, targetVertexId)) {
    return null;
  }
  const vertices = getVertexNetworkVertices(objects);
  const source = vertices.find((vertex) => vertex.id === sourceVertexId);
  const target = vertices.find((vertex) => vertex.id === targetVertexId);
  if (!source || !target) return null;

  setVertexNetworkPosition(objects, targetVertexId, target);
  setVertexNetworkPosition(objects, sourceVertexId, target);
  const affectedObjectIds = [];
  objects.forEach((object) => {
    let affected = false;
    if (object.type === "arc") {
      object.curveVertexIds = (object.curveVertexIds ?? []).map((vertexId) => {
        if (vertexId !== sourceVertexId) return vertexId;
        affected = true;
        return targetVertexId;
      });
    } else {
      if (object.startVertexId === sourceVertexId) {
        object.startVertexId = targetVertexId;
        affected = true;
      }
      if (object.endVertexId === sourceVertexId) {
        object.endVertexId = targetVertexId;
        affected = true;
      }
    }
    if (affected) affectedObjectIds.push(object.id);
  });
  return {
    sourceVertexId,
    targetVertexId,
    x: target.x,
    y: target.y,
    affectedObjectIds,
  };
}

export function mergeVertexNetworkVertexAtNearest(
  objects,
  sourceVertexId,
  maximumDistance,
) {
  const vertices = getVertexNetworkVertices(objects);
  const source = vertices.find((vertex) => vertex.id === sourceVertexId);
  if (!source) return null;
  const distanceLimit = Math.max(0, Number(maximumDistance) || 0);
  const target = vertices
    .filter((vertex) => (
      vertex.id !== sourceVertexId
      && !verticesShareObject(objects, sourceVertexId, vertex.id)
    ))
    .map((vertex) => ({
      vertex,
      distance: distanceBetween(source, vertex),
    }))
    .filter((candidate) => candidate.distance <= distanceLimit)
    .sort((first, second) => (
      first.distance - second.distance
      || first.vertex.id.localeCompare(second.vertex.id)
    ))[0]?.vertex;
  return target
    ? mergeVertexNetworkVertices(objects, sourceVertexId, target.id)
    : null;
}

function verticesShareObject(objects, firstVertexId, secondVertexId) {
  return objects.some((object) => {
    const vertexIds = object.type === "arc"
      ? object.curveVertexIds ?? []
      : [object.startVertexId, object.endVertexId];
    return vertexIds.includes(firstVertexId) && vertexIds.includes(secondVertexId);
  });
}

function addVertexPoint(vertices, vertexId, x, y) {
  if (typeof vertexId !== "string" || !vertexId) return;
  if (!vertices.has(vertexId)) vertices.set(vertexId, []);
  vertices.get(vertexId).push({ x, y });
}

function clearAssemblyData(object) {
  delete object.assemblyId;
  delete object.assemblyIndex;
  delete object.assemblyCount;
  delete object.assemblySource;
  delete object.startVertexId;
  delete object.endVertexId;
  delete object.vertexNetworkId;
  if (object.type !== "arc") delete object.curveVertexIds;
}

function isSupportedPath(object) {
  return Boolean(
    object
    && typeof object === "object"
    && (
      object.type === "arc"
      || (
        Number.isFinite(object.x)
        && Number.isFinite(object.y)
        && Number.isFinite(object.endX)
        && Number.isFinite(object.endY)
      )
    )
  );
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

function crossProduct(first, second) {
  return first.x * second.y - first.y * second.x;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distanceBetween(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
