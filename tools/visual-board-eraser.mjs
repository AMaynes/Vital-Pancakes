/**
 * Brush-local vector erasing for Visual Board objects.
 *
 * The eraser clips visible strokes against a circular brush. It operates on
 * individual objects, so group membership never expands the erase target.
 */

import { getCurvePathPoints } from "./visual-board-curves.mjs?v=4";
import { getObjectSegments } from "./visual-board-geometry.mjs?v=11";

const EPSILON = 1e-6;
const SEGMENT_TYPES = new Set([
  "rectangle",
  "ellipse",
  "shape",
  "area",
  "wall",
]);

/**
 * Returns replacement objects for one brush sample.
 *
 * The original object is returned by reference when the brush changes nothing.
 */
export function eraseObjectNear(object, point, radius, createIdentifier) {
  if (!object || object.locked || object.type === "image") return [object];
  const effectiveRadius = Math.max(0, Number(radius)) + Math.max(0, object.strokeWidth ?? 1) / 2;

  if (object.type === "pen") {
    return erasePolylineObject(object, object.points, point, effectiveRadius, createIdentifier);
  }
  if (object.type === "trace") {
    return eraseTraceObject(object, point, effectiveRadius, createIdentifier);
  }
  if (object.type === "arc") {
    return erasePolylineObject(
      object,
      getCurvePathPoints(object, { tolerance: 0.75, maximumSegmentLength: 12 }),
      point,
      effectiveRadius,
      createIdentifier,
    );
  }
  if (["line", "connector", "dimension"].includes(object.type)) {
    return eraseLineObject(object, point, effectiveRadius, createIdentifier);
  }
  if (SEGMENT_TYPES.has(object.type)) {
    return eraseSegmentObject(object, point, effectiveRadius, createIdentifier);
  }
  return [object];
}

function erasePolylineObject(object, points, center, radius, createIdentifier) {
  const clipped = clipPolylineOutsideCircle(points, center, radius);
  if (!clipped.changed) return [object];
  return clipped.runs.map((run, index) => createPenFragment(
    object,
    run,
    index,
    createIdentifier,
  ));
}

function eraseTraceObject(object, center, radius, createIdentifier) {
  const containingPathCount = object.paths.filter((path) => pointInPolygon(center, path)).length;
  const boundaryDistance = Math.min(
    ...object.paths.flatMap((path) => closedPathSegments(path).map(
      ([start, end]) => distancePointToSegment(center, start, end),
    )),
  );
  if (containingPathCount % 2 === 1 && boundaryDistance >= radius) {
    return [{
      ...object,
      paths: [...object.paths, createCirclePath(center, radius)],
    }];
  }

  let changed = false;
  const untouchedPaths = [];
  const clippedRuns = [];
  object.paths.forEach((path) => {
    const clipped = clipPolylineOutsideCircle([...path, path[0]], center, radius);
    if (clipped.changed) {
      changed = true;
      clippedRuns.push(...clipped.runs);
    } else {
      untouchedPaths.push(path);
    }
  });
  if (!changed) return [object];
  const results = [];
  if (untouchedPaths.length) {
    results.push({ ...object, paths: untouchedPaths });
  }
  clippedRuns.forEach((run) => {
    results.push(createPenFragment(
      object,
      run,
      results.length,
      createIdentifier,
    ));
  });
  if (results.length && results[0].id !== object.id) results[0].id = object.id;
  return results;
}

function eraseLineObject(object, center, radius, createIdentifier) {
  const start = { x: object.x, y: object.y };
  const end = { x: object.endX, y: object.endY };
  const intervals = getOutsideSegmentIntervals(start, end, center, radius);
  if (isWholeSegment(intervals)) return [object];

  return intervals.map(([from, to], index) => {
    const keepsStart = from <= EPSILON;
    const keepsEnd = to >= 1 - EPSILON;
    const arrowStart = object.type === "connector" && keepsStart && Boolean(object.arrowStart);
    const arrowEnd = object.type === "connector" && keepsEnd && object.arrowEnd !== false;
    const fragment = {
      ...object,
      id: index === 0 ? object.id : createIdentifier(),
      type: arrowStart || arrowEnd ? "connector" : "line",
      ...pointToLineCoordinates(
        interpolatePoint(start, end, from),
        interpolatePoint(start, end, to),
      ),
    };
    delete fragment.label;
    delete fragment.offset;
    delete fragment.fontSize;
    delete fragment.assemblyId;
    delete fragment.assemblyIndex;
    delete fragment.assemblyCount;
    delete fragment.assemblySource;
    if (fragment.type === "connector") {
      fragment.arrowStart = arrowStart;
      fragment.arrowEnd = arrowEnd;
    } else {
      delete fragment.arrowStart;
      delete fragment.arrowEnd;
    }
    preserveFragmentVertices(fragment, object, keepsStart, keepsEnd, createIdentifier);
    return fragment;
  });
}

function eraseSegmentObject(object, center, radius, createIdentifier) {
  const segmentResults = getObjectSegments(object).map(([start, end]) => ({
    start,
    end,
    intervals: getOutsideSegmentIntervals(start, end, center, radius),
  }));
  if (segmentResults.every((result) => isWholeSegment(result.intervals))) return [object];

  const fragments = [];
  segmentResults.forEach(({ start, end, intervals }) => {
    intervals.forEach(([from, to]) => {
      fragments.push({
        ...object,
        id: fragments.length === 0 ? object.id : createIdentifier(),
        type: "line",
        ...pointToLineCoordinates(
          interpolatePoint(start, end, from),
          interpolatePoint(start, end, to),
        ),
      });
    });
  });
  fragments.forEach((fragment) => {
    delete fragment.fillColor;
    delete fragment.fillOpacity;
    delete fragment.rotation;
    delete fragment.w;
    delete fragment.h;
    delete fragment.vertices;
    delete fragment.shapeKind;
    delete fragment.symbolId;
    delete fragment.vertexNetworkId;
    delete fragment.startVertexId;
    delete fragment.endVertexId;
  });
  return fragments;
}

function createPenFragment(object, points, index, createIdentifier) {
  const fragment = {
    ...object,
    id: index === 0 ? object.id : createIdentifier(),
    type: "pen",
    points,
  };
  [
    "x",
    "y",
    "midX",
    "midY",
    "endX",
    "endY",
    "curvePoints",
    "curveHandles",
    "curveVertexIds",
    "paths",
    "vertexNetworkId",
    "startVertexId",
    "endVertexId",
  ].forEach((key) => delete fragment[key]);
  return fragment;
}

function preserveFragmentVertices(fragment, source, keepsStart, keepsEnd, createIdentifier) {
  if (!source.vertexNetworkId) {
    delete fragment.vertexNetworkId;
    delete fragment.startVertexId;
    delete fragment.endVertexId;
    return;
  }
  fragment.vertexNetworkId = source.vertexNetworkId;
  fragment.startVertexId = keepsStart && source.startVertexId
    ? source.startVertexId
    : createIdentifier();
  fragment.endVertexId = keepsEnd && source.endVertexId
    ? source.endVertexId
    : createIdentifier();
}

/**
 * Clips a polyline while retaining only portions outside the circular brush.
 */
export function clipPolylineOutsideCircle(points, center, radius) {
  if (!Array.isArray(points) || points.length < 2) return { changed: false, runs: [] };
  const runs = [];
  let currentRun = [];
  let changed = false;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const intervals = getOutsideSegmentIntervals(start, end, center, radius);
    if (!isWholeSegment(intervals)) changed = true;
    if (!intervals.length) {
      pushCurrentRun(runs, currentRun);
      currentRun = [];
      continue;
    }

    intervals.forEach(([from, to], intervalIndex) => {
      const clippedStart = interpolatePoint(start, end, from);
      const clippedEnd = interpolatePoint(start, end, to);
      if (!samePoint(currentRun.at(-1), clippedStart)) {
        pushCurrentRun(runs, currentRun);
        currentRun = [clippedStart];
      }
      if (!samePoint(currentRun.at(-1), clippedEnd)) currentRun.push(clippedEnd);
      if (to < 1 - EPSILON || intervalIndex < intervals.length - 1) {
        pushCurrentRun(runs, currentRun);
        currentRun = [];
      }
    });
  }
  pushCurrentRun(runs, currentRun);
  return { changed, runs };
}

/**
 * Returns parameter ranges of a segment that remain outside a circle.
 */
export function getOutsideSegmentIntervals(start, end, center, radius) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const offsetX = start.x - center.x;
  const offsetY = start.y - center.y;
  const a = deltaX * deltaX + deltaY * deltaY;
  if (a <= EPSILON) {
    return Math.hypot(offsetX, offsetY) > radius ? [[0, 1]] : [];
  }

  const b = 2 * (offsetX * deltaX + offsetY * deltaY);
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
  const discriminant = b * b - 4 * a * c;
  const boundaries = [0, 1];
  if (discriminant > EPSILON) {
    const root = Math.sqrt(discriminant);
    const first = (-b - root) / (2 * a);
    const second = (-b + root) / (2 * a);
    if (first > EPSILON && first < 1 - EPSILON) boundaries.push(first);
    if (second > EPSILON && second < 1 - EPSILON) boundaries.push(second);
  }
  boundaries.sort((first, second) => first - second);

  const intervals = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index];
    const to = boundaries[index + 1];
    const middle = interpolatePoint(start, end, (from + to) / 2);
    if (Math.hypot(middle.x - center.x, middle.y - center.y) >= radius) {
      intervals.push([from, to]);
    }
  }
  return intervals;
}

function isWholeSegment(intervals) {
  return intervals.length === 1
    && intervals[0][0] <= EPSILON
    && intervals[0][1] >= 1 - EPSILON;
}

function interpolatePoint(start, end, progress) {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
}

function pointToLineCoordinates(start, end) {
  return { x: start.x, y: start.y, endX: end.x, endY: end.y };
}

function samePoint(first, second) {
  return Boolean(first && second)
    && Math.abs(first.x - second.x) <= EPSILON
    && Math.abs(first.y - second.y) <= EPSILON;
}

function pushCurrentRun(runs, run) {
  if (run.length >= 2 && !samePoint(run[0], run.at(-1))) runs.push(run);
}

function closedPathSegments(path) {
  return path.map((point, index) => [point, path[(index + 1) % path.length]]);
}

function distancePointToSegment(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const progress = Math.max(0, Math.min(1, (
    (point.x - start.x) * deltaX + (point.y - start.y) * deltaY
  ) / lengthSquared));
  return Math.hypot(
    point.x - (start.x + deltaX * progress),
    point.y - (start.y + deltaY * progress),
  );
}

function pointInPolygon(point, path) {
  let inside = false;
  for (let index = 0, previous = path.length - 1; index < path.length; previous = index, index += 1) {
    const currentPoint = path[index];
    const previousPoint = path[previous];
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < (
        (previousPoint.x - currentPoint.x)
        * (point.y - currentPoint.y)
        / (previousPoint.y - currentPoint.y)
        + currentPoint.x
      );
    if (crosses) inside = !inside;
  }
  return inside;
}

function createCirclePath(center, radius) {
  const pointCount = 32;
  return Array.from({ length: pointCount }, (_, index) => {
    const angle = index / pointCount * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}
