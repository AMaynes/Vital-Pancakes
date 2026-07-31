/**
 * Floor Plan-only wall geometry.
 *
 * Wall shapes are editable line networks. Reconciliation splits crossings and
 * partial overlaps, removes duplicate runs, and classifies building runs by
 * whether they border one enclosed face (outer) or two (inner).
 */

import {
  transformSelectionObjects,
} from "./visual-board-groups.mjs?v=5";

export const FLOOR_PLAN_WALL_ELEMENT_IDS = Object.freeze([
  "outer-building-wall",
  "inner-building-wall",
  "outside-wall",
  "outside-fence",
]);
export const FLOOR_PLAN_WALL_SIDE_MIN = 3;
export const FLOOR_PLAN_WALL_SIDE_MAX = 9;

const EPSILON = 1e-6;
const POINT_PRECISION = 1e-4;
const BUILDING_FAMILY = "building";
const WALL_DEFINITIONS = Object.freeze({
  "outer-building-wall": {
    family: BUILDING_FAMILY,
    role: "floor-plan-outer-building-wall",
    multiplier: 1.6,
  },
  "inner-building-wall": {
    family: BUILDING_FAMILY,
    role: "floor-plan-inner-building-wall",
    multiplier: 1,
  },
  "outside-wall": {
    family: "outside-wall",
    role: "floor-plan-outside-wall",
    multiplier: 1.15,
  },
  "outside-fence": {
    family: "outside-fence",
    role: "floor-plan-outside-fence",
    multiplier: 0.45,
  },
});
const OPENING_TAGS = new Set([
  "door",
  "double-door",
  "sliding-door",
  "garage-door",
  "window",
]);
const SNAP_ELIGIBLE_ROLES = new Set([
  "floor-plan-outer-building-wall",
  "floor-plan-inner-building-wall",
  "floor-plan-outside-wall",
]);

export function isFloorPlanWallElement(kind) {
  return FLOOR_PLAN_WALL_ELEMENT_IDS.includes(kind);
}

export function normalizeFloorPlanWallSides(value) {
  const numeric = Number(value);
  return clampInteger(
    Number.isFinite(numeric) ? Math.round(numeric) : 4,
    FLOOR_PLAN_WALL_SIDE_MIN,
    FLOOR_PLAN_WALL_SIDE_MAX,
  );
}

export function isFloorPlanWallObject(object) {
  return Boolean(
    object?.type === "line"
    && Array.isArray(object.semantic?.tags)
    && object.semantic.tags.includes("wall-shape")
    && getWallDefinitionForObject(object),
  );
}

export function isFloorPlanOpeningUnit(objects) {
  if (!Array.isArray(objects) || !objects.length) return false;
  const groupIds = new Set(objects.map((object) => object?.groupId).filter(Boolean));
  if (groupIds.size > 1) return false;
  return objects.some((object) => (
    Array.isArray(object?.semantic?.tags)
    && object.semantic.tags.some((tag) => OPENING_TAGS.has(tag))
  ));
}

export function createFloorPlanWallShape(
  kind,
  origin,
  settings,
  createIdentifier,
) {
  const definition = WALL_DEFINITIONS[kind];
  if (!definition) {
    throw new TypeError(`Unsupported floor-plan wall type: ${kind}.`);
  }
  if (typeof createIdentifier !== "function") {
    throw new TypeError("Floor-plan walls need an identifier factory.");
  }
  const sideCount = normalizeFloorPlanWallSides(settings?.wallSides);
  const scale = clampNumber(Number(settings?.pixelsPerUnit) || 32, 4, 200);
  const thickness = resolveWallThickness(settings, definition.multiplier);
  const radius = scale * 5;
  const rotation = -Math.PI / 2 - Math.PI / sideCount;
  const points = Array.from({ length: sideCount }, (_, index) => {
    const angle = rotation + index / sideCount * Math.PI * 2;
    return {
      x: finite(origin?.x) + Math.cos(angle) * radius,
      y: finite(origin?.y) + Math.sin(angle) * radius,
    };
  });
  const wallPathId = createIdentifier();
  const vertexNetworkId = createIdentifier();
  const groupId = createIdentifier();
  const vertexIds = points.map(() => createIdentifier());

  return points.map((point, segmentIndex) => {
    const end = points[(segmentIndex + 1) % points.length];
    return {
      id: createIdentifier(),
      type: "line",
      x: point.x,
      y: point.y,
      endX: end.x,
      endY: end.y,
      color: "#24231f",
      strokeWidth: thickness,
      dashPattern: definition.dashPattern ?? "solid",
      fillOpacity: 1,
      opacity: 1,
      layerId: "structure",
      locked: false,
      groupId,
      vertexNetworkId,
      startVertexId: vertexIds[segmentIndex],
      endVertexId: vertexIds[(segmentIndex + 1) % points.length],
      semantic: {
        role: definition.role,
        tags: [
          "floor-plan",
          "tools",
          "wall-shape",
          kind,
          `wall-family-${definition.family}`,
        ],
        generatedBy: "floor-plan-mode",
        wallPathId,
        segmentIndex,
      },
    };
  });
}

/**
 * Returns a new board object list with only Floor Plan wall-shape objects
 * replaced. All unrelated objects retain their original references.
 */
export function reconcileFloorPlanWalls(
  objects,
  settings,
  createIdentifier,
) {
  if (!Array.isArray(objects) || typeof createIdentifier !== "function") {
    return { objects: Array.isArray(objects) ? [...objects] : [], changed: false };
  }
  const walls = objects.filter(isFloorPlanWallObject);
  if (!walls.length) return { objects: [...objects], changed: false };

  const reconciledWalls = [];
  const families = new Map();
  walls.forEach((wall) => {
    const family = getWallDefinitionForObject(wall).family;
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(wall);
  });
  families.forEach((familyWalls, family) => {
    reconciledWalls.push(...reconcileWallFamily(
      familyWalls,
      family,
      settings,
      createIdentifier,
    ));
  });

  const wallIds = new Set(walls.map((wall) => wall.id));
  const firstWallIndex = objects.findIndex((object) => wallIds.has(object.id));
  const withoutWalls = objects.filter((object) => !wallIds.has(object.id));
  const insertionIndex = firstWallIndex < 0
    ? withoutWalls.length
    : objects.slice(0, firstWallIndex).filter((object) => !wallIds.has(object.id)).length;
  const nextObjects = [
    ...withoutWalls.slice(0, insertionIndex),
    ...reconciledWalls,
    ...withoutWalls.slice(insertionIndex),
  ];
  return {
    objects: nextObjects,
    changed: wallSignature(walls) !== wallSignature(reconciledWalls),
  };
}

/**
 * Snaps one door/window group to the nearest eligible Floor Plan wall.
 */
export function snapFloorPlanOpeningToWall(
  openingObjects,
  wallObjects,
  settings,
  maximumDistance,
) {
  if (!isFloorPlanOpeningUnit(openingObjects)) {
    return { objects: openingObjects, attachment: null, changed: false };
  }
  const walls = (Array.isArray(wallObjects) ? wallObjects : [])
    .filter((object) => (
      isFloorPlanWallObject(object)
      && SNAP_ELIGIBLE_ROLES.has(object.semantic?.role)
    ));
  if (!walls.length) {
    return detachOpening(openingObjects);
  }

  const center = getOpeningCenter(openingObjects);
  const threshold = Number.isFinite(maximumDistance)
    ? Math.max(0, maximumDistance)
    : clampNumber((Number(settings?.pixelsPerUnit) || 32) * 0.75, 18, 72);
  const candidate = walls
    .map((wall) => {
      const projection = projectPointToSegment(center, wall);
      return {
        wall,
        ...projection,
        distance: distance(center, projection.point),
      };
    })
    .filter((item) => item.distance <= threshold)
    .sort((first, second) => (
      first.distance - second.distance
      || String(first.wall.id).localeCompare(String(second.wall.id))
    ))[0];
  if (!candidate) return detachOpening(openingObjects);

  const previousAngle = openingObjects
    .map((object) => object.semantic?.wallAngle)
    .find(Number.isFinite) ?? 0;
  const wallAngle = Math.atan2(
    candidate.wall.endY - candidate.wall.y,
    candidate.wall.endX - candidate.wall.x,
  );
  const rotation = normalizeAngle(wallAngle - previousAngle);
  const transformed = transformSelectionObjects(openingObjects, center, {
    rotation,
    translation: {
      x: candidate.point.x - center.x,
      y: candidate.point.y - center.y,
    },
  }).map((object) => ({
    ...object,
    semantic: {
      ...(object.semantic ?? {}),
      tags: uniqueTags([...(object.semantic?.tags ?? []), "wall-attached"]),
      referenceId: candidate.wall.id,
      wallPathId: candidate.wall.semantic.wallPathId,
      segmentIndex: candidate.wall.semantic.segmentIndex,
      wallOffset: candidate.offset,
      wallAngle,
    },
  }));
  return {
    objects: transformed,
    attachment: {
      wallId: candidate.wall.id,
      wallPathId: candidate.wall.semantic.wallPathId,
      segmentIndex: candidate.wall.semantic.segmentIndex,
      offset: candidate.offset,
      angle: wallAngle,
    },
    changed: openingSignature(openingObjects) !== openingSignature(transformed),
  };
}

/**
 * Keeps already attached openings on their wall after wall edits.
 */
export function reflowFloorPlanOpeningAttachments(objects, settings) {
  if (!Array.isArray(objects)) return { objects: [], changed: false };
  const walls = objects.filter(isFloorPlanWallObject);
  const openingGroups = collectAttachedOpeningGroups(objects);
  if (!openingGroups.length) return { objects: [...objects], changed: false };

  const replacements = new Map();
  openingGroups.forEach((openingObjects) => {
    const targetId = openingObjects[0].semantic?.referenceId;
    const target = walls.find((wall) => wall.id === targetId);
    const storedOffset = finite(openingObjects[0].semantic?.wallOffset);
    if (target && storedOffset <= segmentLength(target) + EPSILON) {
      const offset = clampNumber(storedOffset, 0, segmentLength(target));
      const point = pointAlongSegment(target, offset);
      const center = getOpeningCenter(openingObjects);
      const previousAngle = finite(openingObjects[0].semantic?.wallAngle);
      const wallAngle = Math.atan2(target.endY - target.y, target.endX - target.x);
      transformSelectionObjects(openingObjects, center, {
        rotation: normalizeAngle(wallAngle - previousAngle),
        translation: { x: point.x - center.x, y: point.y - center.y },
      }).forEach((object) => {
        replacements.set(object.id, {
          ...object,
          semantic: {
            ...(object.semantic ?? {}),
            wallPathId: target.semantic.wallPathId,
            segmentIndex: target.semantic.segmentIndex,
            wallOffset: offset,
            wallAngle,
          },
        });
      });
      return;
    }

    const snapped = snapFloorPlanOpeningToWall(
      openingObjects,
      walls,
      settings,
      clampNumber((Number(settings?.pixelsPerUnit) || 32) * 2, 32, 160),
    );
    snapped.objects.forEach((object) => replacements.set(object.id, object));
  });
  const nextObjects = objects.map((object) => replacements.get(object.id) ?? object);
  return {
    objects: nextObjects,
    changed: openingSignature(objects) !== openingSignature(nextObjects),
  };
}

function reconcileWallFamily(walls, family, settings, createIdentifier) {
  const splitSegments = splitAndDeduplicateSegments(walls, createIdentifier);
  const components = collectSegmentComponents(splitSegments);
  const faces = family === BUILDING_FAMILY
    ? collectBoundedFaces(splitSegments)
    : [];
  const thicknessByRole = {
    "floor-plan-outer-building-wall": resolveWallThickness(settings, 1.6),
    "floor-plan-inner-building-wall": resolveWallThickness(settings, 1),
    "floor-plan-outside-wall": resolveWallThickness(settings, 1.15),
    "floor-plan-outside-fence": resolveWallThickness(settings, 0.45),
  };
  const usedPathIds = new Set();

  return components.flatMap((component) => {
    const networkId = firstField(component, "vertexNetworkId") || createIdentifier();
    const groupId = firstField(component, "groupId") || createIdentifier();
    let wallPathId = component
      .map((segment) => segment.semantic?.wallPathId)
      .find(Boolean) || createIdentifier();
    if (usedPathIds.has(wallPathId)) wallPathId = createIdentifier();
    usedPathIds.add(wallPathId);
    const vertexIds = collectVertexIds(component, createIdentifier);
    return component
      .slice()
      .sort(compareSegments)
      .map((segment, segmentIndex) => {
        const definition = getWallDefinitionForObject(segment);
        const role = family === BUILDING_FAMILY
          ? classifyBuildingSegment(segment, faces)
          : definition.role;
        return {
          ...segment,
          strokeWidth: thicknessByRole[role],
          dashPattern: definition.dashPattern ?? "solid",
          groupId,
          rigidGroup: false,
          vertexNetworkId: networkId,
          startVertexId: vertexIds.get(pointKey(segment)),
          endVertexId: vertexIds.get(pointKey({
            x: segment.endX,
            y: segment.endY,
          })),
          semantic: {
            ...(segment.semantic ?? {}),
            role,
            wallPathId,
            segmentIndex,
          },
        };
      });
  });
}

function splitAndDeduplicateSegments(walls, createIdentifier) {
  const splitPoints = walls.map(() => [0, 1]);
  for (let firstIndex = 0; firstIndex < walls.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < walls.length; secondIndex += 1) {
      addSegmentSplitPoints(
        walls[firstIndex],
        walls[secondIndex],
        splitPoints[firstIndex],
        splitPoints[secondIndex],
      );
    }
  }

  const sourceIdUsed = new Set();
  const pieces = [];
  walls.forEach((wall, wallIndex) => {
    const positions = uniqueNumbers(splitPoints[wallIndex]).sort((a, b) => a - b);
    positions.slice(1).forEach((endProgress, pieceIndex) => {
      const startProgress = positions[pieceIndex];
      if (endProgress - startProgress <= EPSILON) return;
      const start = interpolateSegment(wall, startProgress);
      const end = interpolateSegment(wall, endProgress);
      if (distance(start, end) <= EPSILON) return;
      const retainsWholeSource = positions.length === 2;
      const canReuseSourceId = retainsWholeSource || !sourceIdUsed.has(wall.id);
      if (canReuseSourceId) sourceIdUsed.add(wall.id);
      pieces.push({
        ...wall,
        id: canReuseSourceId ? wall.id : createIdentifier(),
        x: start.x,
        y: start.y,
        endX: end.x,
        endY: end.y,
      });
    });
  });

  const unique = new Map();
  pieces.forEach((piece) => {
    const key = undirectedSegmentKey(piece);
    const existing = unique.get(key);
    if (!existing || compareSegmentPriority(piece, existing) < 0) {
      unique.set(key, piece);
    }
  });
  return [...unique.values()];
}

function addSegmentSplitPoints(first, second, firstPoints, secondPoints) {
  const firstDelta = { x: first.endX - first.x, y: first.endY - first.y };
  const secondDelta = { x: second.endX - second.x, y: second.endY - second.y };
  const betweenStarts = { x: second.x - first.x, y: second.y - first.y };
  const denominator = cross(firstDelta, secondDelta);

  if (Math.abs(denominator) > EPSILON) {
    const firstProgress = cross(betweenStarts, secondDelta) / denominator;
    const secondProgress = cross(betweenStarts, firstDelta) / denominator;
    if (withinSegment(firstProgress) && withinSegment(secondProgress)) {
      firstPoints.push(clampNumber(firstProgress, 0, 1));
      secondPoints.push(clampNumber(secondProgress, 0, 1));
    }
    return;
  }
  if (Math.abs(cross(betweenStarts, firstDelta)) > EPSILON) return;

  [
    projectProgress({ x: second.x, y: second.y }, first),
    projectProgress({ x: second.endX, y: second.endY }, first),
  ].filter(withinSegment).forEach((progress) => firstPoints.push(clampNumber(progress, 0, 1)));
  [
    projectProgress({ x: first.x, y: first.y }, second),
    projectProgress({ x: first.endX, y: first.endY }, second),
  ].filter(withinSegment).forEach((progress) => secondPoints.push(clampNumber(progress, 0, 1)));
}

function collectSegmentComponents(segments) {
  const pointToSegments = new Map();
  segments.forEach((segment, index) => {
    [
      pointKey(segment),
      pointKey({ x: segment.endX, y: segment.endY }),
    ].forEach((key) => {
      if (!pointToSegments.has(key)) pointToSegments.set(key, []);
      pointToSegments.get(key).push(index);
    });
  });
  const visited = new Set();
  const components = [];
  segments.forEach((segment, startIndex) => {
    if (visited.has(startIndex)) return;
    const queue = [startIndex];
    const component = [];
    visited.add(startIndex);
    while (queue.length) {
      const index = queue.shift();
      const candidate = segments[index];
      component.push(candidate);
      [
        pointKey(candidate),
        pointKey({ x: candidate.endX, y: candidate.endY }),
      ].forEach((key) => {
        (pointToSegments.get(key) ?? []).forEach((neighborIndex) => {
          if (visited.has(neighborIndex)) return;
          visited.add(neighborIndex);
          queue.push(neighborIndex);
        });
      });
    }
    components.push(component);
  });
  return components;
}

function collectBoundedFaces(segments) {
  const points = new Map();
  const neighbors = new Map();
  segments.forEach((segment) => {
    const startKey = pointKey(segment);
    const endKey = pointKey({ x: segment.endX, y: segment.endY });
    points.set(startKey, { x: segment.x, y: segment.y });
    points.set(endKey, { x: segment.endX, y: segment.endY });
    addNeighbor(neighbors, startKey, endKey);
    addNeighbor(neighbors, endKey, startKey);
  });
  neighbors.forEach((keys, key) => {
    const origin = points.get(key);
    keys.sort((firstKey, secondKey) => {
      const first = points.get(firstKey);
      const second = points.get(secondKey);
      return Math.atan2(first.y - origin.y, first.x - origin.x)
        - Math.atan2(second.y - origin.y, second.x - origin.x);
    });
  });

  const visited = new Set();
  const faces = [];
  neighbors.forEach((neighborKeys, startKey) => {
    neighborKeys.forEach((endKey) => {
      const directedKey = `${startKey}>${endKey}`;
      if (visited.has(directedKey)) return;
      const face = [];
      let previousKey = startKey;
      let currentKey = endKey;
      let guard = 0;
      while (guard <= segments.length * 2 + 2) {
        guard += 1;
        const edgeKey = `${previousKey}>${currentKey}`;
        if (visited.has(edgeKey)) break;
        visited.add(edgeKey);
        face.push(points.get(previousKey));
        const outgoing = neighbors.get(currentKey) ?? [];
        const reverseIndex = outgoing.indexOf(previousKey);
        if (reverseIndex < 0 || !outgoing.length) break;
        const nextKey = outgoing[
          (reverseIndex - 1 + outgoing.length) % outgoing.length
        ];
        previousKey = currentKey;
        currentKey = nextKey;
        if (previousKey === startKey && currentKey === endKey) {
          if (face.length >= 3 && signedArea(face) > EPSILON) faces.push(face);
          break;
        }
      }
    });
  });
  return faces;
}

function classifyBuildingSegment(segment, faces) {
  const length = segmentLength(segment);
  if (length <= EPSILON || !faces.length) return "floor-plan-outer-building-wall";
  const midpoint = {
    x: (segment.x + segment.endX) / 2,
    y: (segment.y + segment.endY) / 2,
  };
  const offset = Math.min(0.25, Math.max(0.01, length * 0.001));
  const normal = {
    x: -(segment.endY - segment.y) / length,
    y: (segment.endX - segment.x) / length,
  };
  const firstSide = {
    x: midpoint.x + normal.x * offset,
    y: midpoint.y + normal.y * offset,
  };
  const secondSide = {
    x: midpoint.x - normal.x * offset,
    y: midpoint.y - normal.y * offset,
  };
  const firstInside = faces.some((face) => pointInPolygon(firstSide, face));
  const secondInside = faces.some((face) => pointInPolygon(secondSide, face));
  return firstInside && secondInside
    ? "floor-plan-inner-building-wall"
    : "floor-plan-outer-building-wall";
}

function collectVertexIds(segments, createIdentifier) {
  const ids = new Map();
  segments.forEach((segment) => {
    const startKey = pointKey(segment);
    const endKey = pointKey({ x: segment.endX, y: segment.endY });
    if (!ids.has(startKey) && segment.startVertexId) {
      ids.set(startKey, segment.startVertexId);
    }
    if (!ids.has(endKey) && segment.endVertexId) {
      ids.set(endKey, segment.endVertexId);
    }
  });
  segments.forEach((segment) => {
    [
      pointKey(segment),
      pointKey({ x: segment.endX, y: segment.endY }),
    ].forEach((key) => {
      if (!ids.has(key)) ids.set(key, createIdentifier());
    });
  });
  return ids;
}

function collectAttachedOpeningGroups(objects) {
  const groups = new Map();
  objects.forEach((object) => {
    if (!object?.semantic?.tags?.includes("wall-attached")) return;
    const key = object.groupId || object.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object);
  });
  return [...groups.values()].filter(isFloorPlanOpeningUnit);
}

function getOpeningCenter(objects) {
  const points = objects.flatMap((object) => {
    if (Array.isArray(object?.points)) return object.points;
    if (Array.isArray(object?.paths)) return object.paths.flat();
    if (Number.isFinite(object?.endX) && Number.isFinite(object?.endY)) {
      return [
        { x: finite(object.x), y: finite(object.y) },
        { x: finite(object.endX), y: finite(object.endY) },
        ...(Number.isFinite(object?.midX) && Number.isFinite(object?.midY)
          ? [{ x: object.midX, y: object.midY }]
          : []),
      ];
    }
    if (
      Number.isFinite(object?.x)
      && Number.isFinite(object?.y)
      && Number.isFinite(object?.w)
      && Number.isFinite(object?.h)
    ) {
      return [
        { x: object.x, y: object.y },
        { x: object.x + object.w, y: object.y + object.h },
      ];
    }
    return [];
  });
  if (!points.length) return { x: 0, y: 0 };
  const minimumX = Math.min(...points.map((point) => point.x));
  const maximumX = Math.max(...points.map((point) => point.x));
  const minimumY = Math.min(...points.map((point) => point.y));
  const maximumY = Math.max(...points.map((point) => point.y));
  return {
    x: (minimumX + maximumX) / 2,
    y: (minimumY + maximumY) / 2,
  };
}

function detachOpening(objects) {
  const detached = objects.map((object) => {
    if (!object.semantic?.tags?.includes("wall-attached")) return object;
    const semantic = { ...object.semantic };
    semantic.tags = semantic.tags.filter((tag) => tag !== "wall-attached");
    [
      "referenceId",
      "wallPathId",
      "segmentIndex",
      "wallOffset",
      "wallAngle",
    ].forEach((field) => delete semantic[field]);
    return { ...object, semantic };
  });
  return {
    objects: detached,
    attachment: null,
    changed: openingSignature(objects) !== openingSignature(detached),
  };
}

function getWallDefinitionForObject(object) {
  const tags = object?.semantic?.tags ?? [];
  const kind = FLOOR_PLAN_WALL_ELEMENT_IDS.find((id) => tags.includes(id));
  if (kind) return WALL_DEFINITIONS[kind];
  return Object.values(WALL_DEFINITIONS)
    .find((definition) => definition.role === object?.semantic?.role) ?? null;
}

function resolveWallThickness(settings, multiplier) {
  const units = ["ft", "m", "in", "cm"].includes(settings?.units)
    ? settings.units
    : "ft";
  const fallback = units === "ft" ? 0.5 : 0.15;
  const base = clampNumber(Number(settings?.wallThickness) || fallback, 0.02, 10);
  const scale = clampNumber(Number(settings?.pixelsPerUnit) || 32, 4, 200);
  return base * scale * multiplier;
}

function projectPointToSegment(point, segment) {
  const length = segmentLength(segment);
  if (length <= EPSILON) {
    return {
      point: { x: segment.x, y: segment.y },
      offset: 0,
      progress: 0,
    };
  }
  const progress = clampNumber(
    ((point.x - segment.x) * (segment.endX - segment.x)
      + (point.y - segment.y) * (segment.endY - segment.y))
      / (length * length),
    0,
    1,
  );
  return {
    point: interpolateSegment(segment, progress),
    offset: progress * length,
    progress,
  };
}

function pointAlongSegment(segment, offset) {
  const length = segmentLength(segment);
  return length <= EPSILON
    ? { x: segment.x, y: segment.y }
    : interpolateSegment(segment, offset / length);
}

function projectProgress(point, segment) {
  const deltaX = segment.endX - segment.x;
  const deltaY = segment.endY - segment.y;
  const denominator = deltaX * deltaX + deltaY * deltaY;
  if (denominator <= EPSILON) return 0;
  return (
    (point.x - segment.x) * deltaX
    + (point.y - segment.y) * deltaY
  ) / denominator;
}

function interpolateSegment(segment, progress) {
  return {
    x: segment.x + (segment.endX - segment.x) * progress,
    y: segment.y + (segment.endY - segment.y) * progress,
  };
}

function compareSegments(first, second) {
  return pointKey(first).localeCompare(pointKey(second))
    || pointKey({ x: first.endX, y: first.endY })
      .localeCompare(pointKey({ x: second.endX, y: second.endY }));
}

function compareSegmentPriority(first, second) {
  return Number(Boolean(first.locked)) - Number(Boolean(second.locked))
    || String(first.id).localeCompare(String(second.id));
}

function firstField(segments, field) {
  return segments
    .map((segment) => segment[field])
    .filter((value) => typeof value === "string" && value)
    .sort()[0] ?? "";
}

function addNeighbor(neighbors, key, neighborKey) {
  if (!neighbors.has(key)) neighbors.set(key, []);
  if (!neighbors.get(key).includes(neighborKey)) neighbors.get(key).push(neighborKey);
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (
      (current.y > point.y) !== (previous.y > point.y)
      && point.x < (
        (previous.x - current.x) * (point.y - current.y)
        / (previous.y - current.y)
        + current.x
      )
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function signedArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function segmentLength(segment) {
  return Math.hypot(segment.endX - segment.x, segment.endY - segment.y);
}

function undirectedSegmentKey(segment) {
  const start = pointKey(segment);
  const end = pointKey({ x: segment.endX, y: segment.endY });
  return start < end ? `${start}|${end}` : `${end}|${start}`;
}

function pointKey(point) {
  return `${quantize(point.x)},${quantize(point.y)}`;
}

function quantize(value) {
  return Math.round(finite(value) / POINT_PRECISION) * POINT_PRECISION;
}

function uniqueNumbers(values) {
  return [...values]
    .sort((a, b) => a - b)
    .filter((value, index, sorted) => (
      index === 0 || Math.abs(value - sorted[index - 1]) > EPSILON
    ));
}

function uniqueTags(tags) {
  return [...new Set(tags.filter(Boolean))].slice(0, 20);
}

function withinSegment(value) {
  return value >= -EPSILON && value <= 1 + EPSILON;
}

function cross(first, second) {
  return first.x * second.y - first.y * second.x;
}

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function normalizeAngle(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function wallSignature(walls) {
  return JSON.stringify(walls.map((wall) => ({
    id: wall.id,
    x: quantize(wall.x),
    y: quantize(wall.y),
    endX: quantize(wall.endX),
    endY: quantize(wall.endY),
    strokeWidth: quantize(wall.strokeWidth),
    dashPattern: wall.dashPattern,
    groupId: wall.groupId,
    vertexNetworkId: wall.vertexNetworkId,
    startVertexId: wall.startVertexId,
    endVertexId: wall.endVertexId,
    role: wall.semantic?.role,
    wallPathId: wall.semantic?.wallPathId,
    segmentIndex: wall.semantic?.segmentIndex,
  })).sort((first, second) => String(first.id).localeCompare(String(second.id))));
}

function openingSignature(objects) {
  return JSON.stringify(objects.map((object) => ({
    id: object.id,
    x: quantize(object.x),
    y: quantize(object.y),
    endX: quantize(object.endX),
    endY: quantize(object.endY),
    points: object.points?.map((point) => [quantize(point.x), quantize(point.y)]),
    rotation: quantize(object.rotation),
    referenceId: object.semantic?.referenceId,
    wallOffset: quantize(object.semantic?.wallOffset),
    wallAngle: quantize(object.semantic?.wallAngle),
  })));
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInteger(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
