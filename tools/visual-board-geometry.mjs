/**
 * Pure geometry helpers for the Visual Board.
 *
 * Keeping these calculations independent from the DOM makes rotated selection,
 * resizing, hit testing, and marquee selection deterministic and testable.
 */

import { getCurvePathPoints } from "./visual-board-curves.mjs?v=2";

export const SHAPE_TYPES = new Set([
  "rectangle",
  "ellipse",
  "shape",
  "textbox",
  "image",
  "area",
  "wall",
  "symbol",
]);
export const LINE_TYPES = new Set(["line", "connector", "dimension"]);
export const CURVE_TYPES = new Set(["arc"]);

const SHAPE_SEGMENT_BUILDERS = {
  triangle: () => polygonSegments([
    [0.5, 0],
    [1, 1],
    [0, 1],
  ]),
  diamond: () => polygonSegments([
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ]),
  hexagon: () => polygonSegments([
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ]),
  cube: (object) => {
    const depthX = getNormalizedDepth(object.shapeDepthX, object.w);
    const depthY = getNormalizedDepth(object.shapeDepthY, object.h);
    return joinedPolygons([
      [
        [0, depthY],
        [1 - depthX, depthY],
        [1 - depthX, 1],
        [0, 1],
      ],
      [
        [depthX, 0],
        [1, 0],
        [1, 1 - depthY],
        [depthX, 1 - depthY],
      ],
    ]);
  },
  cuboid: () => joinedPolygons([
    [
      [0.05, 0.34],
      [0.7, 0.34],
      [0.7, 0.88],
      [0.05, 0.88],
    ],
    [
      [0.3, 0.1],
      [0.95, 0.1],
      [0.95, 0.64],
      [0.3, 0.64],
    ],
  ]),
  pyramid: () => {
    const base = [
      [0.08, 0.66],
      [0.68, 0.66],
      [0.92, 0.88],
      [0.3, 0.88],
    ];
    const apex = [0.52, 0.08];
    return [
      ...polygonSegments(base),
      ...base.map((point) => [apex, point]),
    ];
  },
  "triangular-prism": () => joinedPolygons([
    [
      [0.08, 0.88],
      [0.35, 0.28],
      [0.62, 0.88],
    ],
    [
      [0.36, 0.66],
      [0.63, 0.08],
      [0.92, 0.66],
    ],
  ]),
  cylinder: () => [
    ...ellipseSegments(0.1, 0.08, 0.8, 0.3, 24),
    ...ellipseSegments(0.1, 0.62, 0.8, 0.3, 24),
    [[0.1, 0.23], [0.1, 0.77]],
    [[0.9, 0.23], [0.9, 0.77]],
  ],
  cone: () => [
    ...ellipseSegments(0.08, 0.67, 0.84, 0.25, 28),
    [[0.08, 0.795], [0.5, 0.08]],
    [[0.92, 0.795], [0.5, 0.08]],
  ],
};

function polygonSegments(points) {
  return points.map((point, index) => [
    point,
    points[(index + 1) % points.length],
  ]);
}

function joinedPolygons(polygons) {
  const polygonLines = polygons.flatMap(polygonSegments);
  const joins = polygons[0].map((point, index) => [point, polygons[1][index]]);
  return [...polygonLines, ...joins];
}

function ellipseSegments(x, y, width, height, count = 32) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const points = Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    return [
      centerX + Math.cos(angle) * radiusX,
      centerY + Math.sin(angle) * radiusY,
    ];
  });
  return polygonSegments(points);
}

function getNormalizedDepth(depth, dimension) {
  const fallback = Math.abs(dimension) * 0.22;
  const resolvedDepth = Number.isFinite(depth) ? Math.abs(depth) : fallback;
  return clamp(resolvedDepth / Math.max(1, Math.abs(dimension)), 0.05, 0.45);
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function snapValue(value, gridSize) {
  return Math.round(value / gridSize) * gridSize;
}

export function normalizeShape(object) {
  const normalized = { ...object };
  if (normalized.w < 0) {
    normalized.x += normalized.w;
    normalized.w = Math.abs(normalized.w);
  }
  if (normalized.h < 0) {
    normalized.y += normalized.h;
    normalized.h = Math.abs(normalized.h);
  }
  return normalized;
}

export function getShapeCenter(object) {
  return {
    x: object.x + object.w / 2,
    y: object.y + object.h / 2,
  };
}

export function rotatePoint(point, center, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const deltaX = point.x - center.x;
  const deltaY = point.y - center.y;
  return {
    x: center.x + deltaX * cosine - deltaY * sine,
    y: center.y + deltaX * sine + deltaY * cosine,
  };
}

export function getShapeCorners(object) {
  const center = getShapeCenter(object);
  const rotation = object.rotation ?? 0;
  return {
    nw: rotatePoint({ x: object.x, y: object.y }, center, rotation),
    ne: rotatePoint({ x: object.x + object.w, y: object.y }, center, rotation),
    se: rotatePoint({ x: object.x + object.w, y: object.y + object.h }, center, rotation),
    sw: rotatePoint({ x: object.x, y: object.y + object.h }, center, rotation),
  };
}

export function getLocalPoint(object, worldPoint) {
  const center = getShapeCenter(object);
  return rotatePoint(worldPoint, center, -(object.rotation ?? 0));
}

export function distanceBetween(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function distancePointToSegment(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return distanceBetween(point, start);
  const projection = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
    0,
    1,
  );
  return distanceBetween(point, {
    x: start.x + projection * deltaX,
    y: start.y + projection * deltaY,
  });
}

/**
 * Returns a narrow rotated rectangle surrounding a straight line or arrow.
 */
export function getLineSelectionCorners(object, padding = 8) {
  const start = { x: object.x, y: object.y };
  const end = { x: object.endX, y: object.endY };
  const length = distanceBetween(start, end);
  if (length === 0) {
    return [
      { x: start.x - padding, y: start.y - padding },
      { x: start.x + padding, y: start.y - padding },
      { x: start.x + padding, y: start.y + padding },
      { x: start.x - padding, y: start.y + padding },
    ];
  }

  const tangent = {
    x: (end.x - start.x) / length,
    y: (end.y - start.y) / length,
  };
  const normal = { x: -tangent.y, y: tangent.x };
  return [
    {
      x: start.x - tangent.x * padding + normal.x * padding,
      y: start.y - tangent.y * padding + normal.y * padding,
    },
    {
      x: end.x + tangent.x * padding + normal.x * padding,
      y: end.y + tangent.y * padding + normal.y * padding,
    },
    {
      x: end.x + tangent.x * padding - normal.x * padding,
      y: end.y + tangent.y * padding - normal.y * padding,
    },
    {
      x: start.x - tangent.x * padding - normal.x * padding,
      y: start.y - tangent.y * padding - normal.y * padding,
    },
  ];
}

function normalizedPointToWorld(object, point) {
  const center = getShapeCenter(object);
  return rotatePoint({
    x: object.x + point[0] * object.w,
    y: object.y + point[1] * object.h,
  }, center, object.rotation ?? 0);
}

/**
 * Returns the visible outline of an object as world-space line segments.
 * Segment-based rendering lets compound shapes be exploded into independent
 * lines without maintaining a second geometry definition.
 */
export function getObjectSegments(object) {
  if (CURVE_TYPES.has(object.type)) {
    return pointsToSegments(getCurvePathPoints(object));
  }

  if (object.type === "trace") {
    return object.paths.flatMap((path) => pointsToSegments(path, true));
  }

  if (LINE_TYPES.has(object.type)) {
    const segments = [[
      { x: object.x, y: object.y },
      { x: object.endX, y: object.endY },
    ]];
    if (object.type === "connector") {
      const angle = Math.atan2(object.endY - object.y, object.endX - object.x);
      const arrowSize = Math.max(14, (object.strokeWidth ?? 1) * 4);
      if (object.arrowStart) {
        segments.push(...getArrowHeadSegments(
          { x: object.x, y: object.y },
          angle + Math.PI,
          arrowSize,
        ));
      }
      if (object.arrowEnd !== false) {
        segments.push(...getArrowHeadSegments(
          { x: object.endX, y: object.endY },
          angle,
          arrowSize,
        ));
      }
    }
    return segments;
  }

  let normalizedSegments = [];
  if (object.type === "rectangle" || object.type === "wall") {
    normalizedSegments = polygonSegments([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
  } else if (object.type === "area") {
    normalizedSegments = polygonSegments(
      object.vertices.map((point) => [point.x, point.y]),
    );
  } else if (object.type === "ellipse") {
    normalizedSegments = ellipseSegments(0, 0, 1, 1, 36);
  } else if (object.type === "shape") {
    normalizedSegments = SHAPE_SEGMENT_BUILDERS[object.shapeKind]?.(object) ?? [];
  }

  return normalizedSegments.map(([start, end]) => [
    normalizedPointToWorld(object, start),
    normalizedPointToWorld(object, end),
  ]);
}

function getArrowHeadSegments(tip, angle, arrowSize) {
  return [
    [
      tip,
      {
        x: tip.x - arrowSize * Math.cos(angle - Math.PI / 6),
        y: tip.y - arrowSize * Math.sin(angle - Math.PI / 6),
      },
    ],
    [
      tip,
      {
        x: tip.x - arrowSize * Math.cos(angle + Math.PI / 6),
        y: tip.y - arrowSize * Math.sin(angle + Math.PI / 6),
      },
    ],
  ];
}

export function isExplodableObject(object) {
  return LINE_TYPES.has(object.type)
    || CURVE_TYPES.has(object.type)
    || ["rectangle", "ellipse", "shape", "trace", "area", "wall"].includes(object.type);
}

export function getObjectBounds(object) {
  if (object.type === "pen") {
    const points = object.points ?? [];
    if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
    const xValues = points.map((point) => point.x);
    const yValues = points.map((point) => point.y);
    const minimumX = Math.min(...xValues);
    const minimumY = Math.min(...yValues);
    return {
      x: minimumX,
      y: minimumY,
      width: Math.max(1, Math.max(...xValues) - minimumX),
      height: Math.max(1, Math.max(...yValues) - minimumY),
    };
  }

  if (CURVE_TYPES.has(object.type)) {
    return getPointsBounds(getCurvePathPoints(object));
  }

  if (object.type === "trace") {
    return getPointsBounds(object.paths.flat());
  }

  if (LINE_TYPES.has(object.type)) {
    return {
      x: Math.min(object.x, object.endX),
      y: Math.min(object.y, object.endY),
      width: Math.max(1, Math.abs(object.endX - object.x)),
      height: Math.max(1, Math.abs(object.endY - object.y)),
    };
  }

  if (SHAPE_TYPES.has(object.type)) {
    const corners = Object.values(getShapeCorners(object));
    const xValues = corners.map((point) => point.x);
    const yValues = corners.map((point) => point.y);
    const minimumX = Math.min(...xValues);
    const minimumY = Math.min(...yValues);
    return {
      x: minimumX,
      y: minimumY,
      width: Math.max(1, Math.max(...xValues) - minimumX),
      height: Math.max(1, Math.max(...yValues) - minimumY),
    };
  }

  return { x: 0, y: 0, width: 0, height: 0 };
}

export function pointHitsObject(object, point, padding = 0) {
  const strokePadding = padding + (object.strokeWidth ?? 1) / 2;

  if (object.type === "pen") {
    const points = object.points ?? [];
    if (points.length === 1) return distanceBetween(point, points[0]) <= strokePadding;
    return points.slice(1).some((segmentEnd, index) => (
      distancePointToSegment(point, points[index], segmentEnd) <= strokePadding
    ));
  }

  if (CURVE_TYPES.has(object.type)) {
    return getObjectSegments(object).some(([start, end]) => (
      distancePointToSegment(point, start, end) <= strokePadding
    ));
  }

  if (object.type === "trace") {
    if (pointIsInsideClosedPaths(point, object.paths)) return true;
    return getObjectSegments(object).some(([start, end]) => (
      distancePointToSegment(point, start, end) <= strokePadding
    ));
  }

  if (LINE_TYPES.has(object.type)) {
    return distancePointToSegment(
      point,
      { x: object.x, y: object.y },
      { x: object.endX, y: object.endY },
    ) <= strokePadding;
  }

  if (object.type === "shape") {
    return getObjectSegments(object).some(([start, end]) => (
      distancePointToSegment(point, start, end) <= strokePadding
    ));
  }

  if (SHAPE_TYPES.has(object.type)) {
    const localPoint = getLocalPoint(object, point);
    if (object.type === "area") {
      return pointIsInsidePolygon(
        {
          x: (localPoint.x - object.x) / Math.max(1, object.w),
          y: (localPoint.y - object.y) / Math.max(1, object.h),
        },
        object.vertices,
      );
    }
    if (object.type === "ellipse") {
      const radiusX = object.w / 2 + strokePadding;
      const radiusY = object.h / 2 + strokePadding;
      if (radiusX <= 0 || radiusY <= 0) return false;
      const center = getShapeCenter(object);
      const normalizedX = (localPoint.x - center.x) / radiusX;
      const normalizedY = (localPoint.y - center.y) / radiusY;
      return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
    }
    return localPoint.x >= object.x - strokePadding
      && localPoint.x <= object.x + object.w + strokePadding
      && localPoint.y >= object.y - strokePadding
      && localPoint.y <= object.y + object.h + strokePadding;
  }

  return false;
}

export function rectanglesIntersect(first, second) {
  return first.x <= second.x + second.width
    && first.x + first.width >= second.x
    && first.y <= second.y + second.height
    && first.y + first.height >= second.y;
}

export function objectIntersectsRectangle(object, rectangle) {
  if (LINE_TYPES.has(object.type) || CURVE_TYPES.has(object.type)) {
    const strokePadding = (object.strokeWidth ?? 1) / 2;
    return getObjectSegments(object).some(([start, end]) => (
      segmentIntersectsRectangle(start, end, rectangle, strokePadding)
    ));
  }
  return rectanglesIntersect(getObjectBounds(object), rectangle);
}

function pointsToSegments(points, closed = false) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const segments = points.slice(1).map((end, index) => [points[index], end]);
  if (closed && points.length > 2) segments.push([points.at(-1), points[0]]);
  return segments;
}

function getPointsBounds(points) {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const minimumX = Math.min(...xValues);
  const minimumY = Math.min(...yValues);
  return {
    x: minimumX,
    y: minimumY,
    width: Math.max(1, Math.max(...xValues) - minimumX),
    height: Math.max(1, Math.max(...yValues) - minimumY),
  };
}

function pointIsInsideClosedPaths(point, paths) {
  let isInside = false;
  paths.forEach((path) => {
    path.forEach((start, index) => {
      const end = path[(index + 1) % path.length];
      const crossesRay = (start.y > point.y) !== (end.y > point.y)
        && point.x < (end.x - start.x) * (point.y - start.y)
          / (end.y - start.y) + start.x;
      if (crossesRay) isInside = !isInside;
    });
  });
  return isInside;
}

function pointIsInsidePolygon(point, vertices) {
  let isInside = false;
  vertices.forEach((start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    const crossesRay = (start.y > point.y) !== (end.y > point.y)
      && point.x < (end.x - start.x) * (point.y - start.y)
        / (end.y - start.y) + start.x;
    if (crossesRay) isInside = !isInside;
  });
  return isInside;
}

/**
 * Finds objects touched by a marquee, optionally treating locked objects as
 * non-interactive background content.
 */
export function getMarqueeSelectionCandidates(
  objects,
  rectangle,
  { includeLocked = true } = {},
) {
  return objects.filter((object) => (
    (includeLocked || !object.locked)
    && objectIntersectsRectangle(object, rectangle)
  ));
}

function segmentIntersectsRectangle(start, end, rectangle, padding = 0) {
  const left = rectangle.x - padding;
  const right = rectangle.x + rectangle.width + padding;
  const top = rectangle.y - padding;
  const bottom = rectangle.y + rectangle.height + padding;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const directions = [-deltaX, deltaX, -deltaY, deltaY];
  const distances = [
    start.x - left,
    right - start.x,
    start.y - top,
    bottom - start.y,
  ];
  let entry = 0;
  let exit = 1;

  for (let index = 0; index < directions.length; index += 1) {
    const direction = directions[index];
    const distance = distances[index];
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }

    const ratio = distance / direction;
    if (direction < 0) entry = Math.max(entry, ratio);
    else exit = Math.min(exit, ratio);
    if (entry > exit) return false;
  }

  return true;
}

export function resizeShapeFromCorner(initialObject, corner, worldPoint, minimumSize = 16) {
  const corners = getShapeCorners(initialObject);
  const oppositeCorner = {
    nw: "se",
    ne: "sw",
    se: "nw",
    sw: "ne",
  }[corner];
  const oppositePoint = corners[oppositeCorner];
  const rotation = initialObject.rotation ?? 0;
  const horizontalAxis = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const verticalAxis = { x: -Math.sin(rotation), y: Math.cos(rotation) };
  const horizontalSign = corner.includes("e") ? 1 : -1;
  const verticalSign = corner.includes("s") ? 1 : -1;
  const delta = {
    x: worldPoint.x - oppositePoint.x,
    y: worldPoint.y - oppositePoint.y,
  };
  const width = Math.max(
    minimumSize,
    (delta.x * horizontalAxis.x + delta.y * horizontalAxis.y) * horizontalSign,
  );
  const height = Math.max(
    minimumSize,
    (delta.x * verticalAxis.x + delta.y * verticalAxis.y) * verticalSign,
  );
  const center = {
    x: oppositePoint.x
      + horizontalAxis.x * horizontalSign * width / 2
      + verticalAxis.x * verticalSign * height / 2,
    y: oppositePoint.y
      + horizontalAxis.y * horizontalSign * width / 2
      + verticalAxis.y * verticalSign * height / 2,
  };
  return {
    ...initialObject,
    x: center.x - width / 2,
    y: center.y - height / 2,
    w: width,
    h: height,
  };
}
