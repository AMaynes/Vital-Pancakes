/**
 * Pure editable-curve helpers for the Visual Board.
 *
 * Legacy arcs keep their three stored points and quadratic rendering. Once an
 * arc is edited as a complex curve, it stores on-curve vertices plus cubic
 * handles. Splitting a segment therefore adds a vertex without changing the
 * visible path.
 */

const CURVE_EPSILON = 1e-9;

export function getQuadraticControlPoint(arc) {
  return {
    x: 2 * arc.midX - (arc.x + arc.endX) / 2,
    y: 2 * arc.midY - (arc.y + arc.endY) / 2,
  };
}

export function getQuadraticCurvePoint(arc, progress) {
  const control = getQuadraticControlPoint(arc);
  const remaining = 1 - progress;
  return {
    x: remaining * remaining * arc.x
      + 2 * remaining * progress * control.x
      + progress * progress * arc.endX,
    y: remaining * remaining * arc.y
      + 2 * remaining * progress * control.y
      + progress * progress * arc.endY,
  };
}

/**
 * Returns every user-editable point on the path. The middle point of a legacy
 * arc is also a real on-curve point.
 */
export function getCurveVertices(arc) {
  const data = readStoredCurveData(arc);
  if (data) return data.points.map(clonePoint);
  return [
    { x: arc.x, y: arc.y },
    { x: arc.midX, y: arc.midY },
    { x: arc.endX, y: arc.endY },
  ];
}

/**
 * Returns cubic segments for drawing, sampling, export, and intersection work.
 */
export function getCurveBezierSegments(arc) {
  const data = readStoredCurveData(arc);
  if (data) {
    return data.handles.map((handles, index) => ({
      index,
      start: clonePoint(data.points[index]),
      control1: clonePoint(handles.control1),
      control2: clonePoint(handles.control2),
      end: clonePoint(data.points[index + 1]),
    }));
  }

  const start = { x: arc.x, y: arc.y };
  const end = { x: arc.endX, y: arc.endY };
  const control = getQuadraticControlPoint(arc);
  return [{
    index: 0,
    start,
    control1: interpolatePoint(start, control, 2 / 3),
    control2: interpolatePoint(end, control, 2 / 3),
    end,
  }];
}

/**
 * Normalizes optional complex-curve data while retaining legacy coordinates.
 */
export function normalizeCurveGeometry(arc) {
  const normalized = {
    ...arc,
    x: finite(arc.x, 0),
    y: finite(arc.y, 0),
    endX: finite(arc.endX, finite(arc.x, 0)),
    endY: finite(arc.endY, finite(arc.y, 0)),
  };
  normalized.midX = finite(arc.midX, (normalized.x + normalized.endX) / 2);
  normalized.midY = finite(arc.midY, (normalized.y + normalized.endY) / 2);

  const data = readStoredCurveData(arc);
  if (!data) {
    delete normalized.curvePoints;
    delete normalized.curveHandles;
    delete normalized.curveVertexIds;
    return normalized;
  }

  normalized.curvePoints = data.points.map(clonePoint);
  normalized.curveHandles = data.handles.map(cloneHandles);
  const vertexIds = normalizeVertexIds(arc.curveVertexIds, data.points.length);
  if (vertexIds) normalized.curveVertexIds = vertexIds;
  else delete normalized.curveVertexIds;
  synchronizeLegacyCoordinates(normalized);
  return normalized;
}

/**
 * Converts a legacy quadratic into two exact cubic segments whose knots are
 * start, stored middle, and end.
 */
export function createEditableCurveGeometry(arc) {
  const existing = readStoredCurveData(arc);
  if (existing) {
    return normalizeCurveGeometry({
      ...arc,
      curvePoints: existing.points,
      curveHandles: existing.handles,
    });
  }

  const segment = getCurveBezierSegments(arc)[0];
  const split = splitCubicSegment(segment, 0.5);
  return normalizeCurveGeometry({
    ...arc,
    curvePoints: [segment.start, split.point, segment.end],
    curveHandles: [
      {
        control1: split.first.control1,
        control2: split.first.control2,
      },
      {
        control1: split.second.control1,
        control2: split.second.control2,
      },
    ],
  });
}

/**
 * Rebuilds an editable curve around its meaningful X/Y extrema and endpoints.
 * Shared network joints are retained even when they are not extrema.
 */
export function reinitializeCurveVertices(
  arc,
  { createIdentifier, preserveVertexIds = [] } = {},
) {
  const editable = createEditableCurveGeometry(arc);
  if (!readStoredCurveData(arc)) return editable;

  const segments = getCurveBezierSegments(editable);
  if (!segments.length) return editable;
  const preservedIds = new Set(
    [...preserveVertexIds].filter((value) => typeof value === "string" && value),
  );
  const candidates = collectCurveKeyLocations(editable, segments, preservedIds);
  const locations = selectMeaningfulCurveLocations(candidates);
  const points = locations.map((location) => clonePoint(location.point));
  if (
    points.length === editable.curvePoints.length
    && points.every((point, index) => (
      distanceBetween(point, editable.curvePoints[index]) <= 1e-7
    ))
  ) {
    return editable;
  }

  const next = normalizeCurveGeometry({
    ...editable,
    curvePoints: points,
    curveHandles: createReinitializedHandles(segments, locations),
  });
  if (editable.vertexNetworkId) {
    const existingIds = editable.curveVertexIds ?? [];
    next.curveVertexIds = locations.map((location) => {
      const existingId = Number.isInteger(location.sourceVertexIndex)
        ? existingIds[location.sourceVertexIndex]
        : null;
      if (existingId && preservedIds.has(existingId)) return existingId;
      return typeof createIdentifier === "function"
        ? createIdentifier()
        : existingId ?? null;
    });
  } else {
    delete next.curveVertexIds;
  }
  return normalizeCurveGeometry(next);
}

export function getCurvePoint(arc, segmentIndex, progress) {
  const segment = getCurveBezierSegments(arc)[segmentIndex];
  if (!segment) return null;
  return getCubicPoint(segment, clamp(progress, 0, 1));
}

export function getNearestCurveLocation(
  arc,
  target,
  { samplesPerSegment = 32, refinementSteps = 12 } = {},
) {
  const segments = getCurveBezierSegments(arc);
  if (!segments.length) return null;
  let best = null;

  segments.forEach((segment, segmentIndex) => {
    let previous = segment.start;
    for (let sampleIndex = 1; sampleIndex <= samplesPerSegment; sampleIndex += 1) {
      const endProgress = sampleIndex / samplesPerSegment;
      const end = getCubicPoint(segment, endProgress);
      const projection = projectPointOntoSegment(target, previous, end);
      const startProgress = (sampleIndex - 1) / samplesPerSegment;
      const progress = startProgress
        + (endProgress - startProgress) * projection.progress;
      const distance = distanceBetween(target, projection.point);
      if (!best || distance < best.distance) {
        best = { segmentIndex, progress, point: projection.point, distance };
      }
      previous = end;
    }
  });

  let span = 1 / samplesPerSegment;
  for (let step = 0; step < refinementSteps; step += 1) {
    const leftProgress = clamp(best.progress - span, 0, 1);
    const rightProgress = clamp(best.progress + span, 0, 1);
    const firstThird = leftProgress + (rightProgress - leftProgress) / 3;
    const secondThird = rightProgress - (rightProgress - leftProgress) / 3;
    const firstPoint = getCubicPoint(segments[best.segmentIndex], firstThird);
    const secondPoint = getCubicPoint(segments[best.segmentIndex], secondThird);
    if (distanceBetween(target, firstPoint) <= distanceBetween(target, secondPoint)) {
      best.progress = firstThird;
      best.point = firstPoint;
      best.distance = distanceBetween(target, firstPoint);
    } else {
      best.progress = secondThird;
      best.point = secondPoint;
      best.distance = distanceBetween(target, secondPoint);
    }
    span /= 2;
  }
  return best;
}

/**
 * Inserts a point at the nearest place on the path. The returned curve is a
 * clone, and the original path geometry remains exact.
 */
export function insertCurveVertex(arc, target, options = {}) {
  const editable = createEditableCurveGeometry(arc);
  const location = getNearestCurveLocation(editable, target, options);
  if (!location) return { curve: editable, inserted: false, vertexIndex: -1 };
  const result = insertCurveVertexAt(
    editable,
    location.segmentIndex,
    clamp(location.progress, 0.001, 0.999),
  );
  return {
    ...result,
    segmentIndex: location.segmentIndex,
    progress: clamp(location.progress, 0.001, 0.999),
  };
}

export function insertCurveVertexAt(arc, segmentIndex, progress) {
  const editable = createEditableCurveGeometry(arc);
  const segments = getCurveBezierSegments(editable);
  const segment = segments[segmentIndex];
  if (!segment) {
    return { curve: editable, inserted: false, vertexIndex: -1 };
  }

  const resolvedProgress = clamp(progress, 0.001, 0.999);
  const split = splitCubicSegment(segment, resolvedProgress);
  const curvePoints = editable.curvePoints.map(clonePoint);
  const curveHandles = editable.curveHandles.map(cloneHandles);
  curvePoints.splice(segmentIndex + 1, 0, split.point);
  curveHandles.splice(
    segmentIndex,
    1,
    {
      control1: split.first.control1,
      control2: split.first.control2,
    },
    {
      control1: split.second.control1,
      control2: split.second.control2,
    },
  );

  const next = normalizeCurveGeometry({
    ...editable,
    curvePoints,
    curveHandles,
    ...(Array.isArray(editable.curveVertexIds)
      ? {
        curveVertexIds: [
          ...editable.curveVertexIds.slice(0, segmentIndex + 1),
          null,
          ...editable.curveVertexIds.slice(segmentIndex + 1),
        ],
      }
      : {}),
  });
  return {
    curve: next,
    inserted: true,
    vertexIndex: segmentIndex + 1,
    point: clonePoint(split.point),
  };
}

/**
 * Moves one visible curve vertex and rebuilds restrained automatic handles
 * from the visible points. This keeps segments direct and avoids hidden-handle
 * overshoot after a large drag.
 */
export function setCurveVertexPosition(arc, vertexIndex, point) {
  const editable = createEditableCurveGeometry(arc);
  if (vertexIndex < 0 || vertexIndex >= editable.curvePoints.length) return false;
  editable.curvePoints[vertexIndex] = clonePoint(point);
  editable.curveHandles = createAutomaticHandles(editable.curvePoints);
  synchronizeLegacyCoordinates(editable);
  replaceCurveGeometry(arc, editable);
  return true;
}

/**
 * Snaps an existing knot while retaining its incoming and outgoing handles.
 * Vertex-network creation uses this for tiny intersection corrections so the
 * rest of the curve does not get rebuilt.
 */
export function setCurveVertexPositionPreservingHandles(arc, vertexIndex, point) {
  const editable = createEditableCurveGeometry(arc);
  if (vertexIndex < 0 || vertexIndex >= editable.curvePoints.length) return false;
  const current = editable.curvePoints[vertexIndex];
  const delta = {
    x: point.x - current.x,
    y: point.y - current.y,
  };
  if (Math.hypot(delta.x, delta.y) <= CURVE_EPSILON) return true;

  editable.curvePoints[vertexIndex] = clonePoint(point);
  if (vertexIndex > 0) {
    editable.curveHandles[vertexIndex - 1].control2.x += delta.x;
    editable.curveHandles[vertexIndex - 1].control2.y += delta.y;
  }
  if (vertexIndex < editable.curveHandles.length) {
    editable.curveHandles[vertexIndex].control1.x += delta.x;
    editable.curveHandles[vertexIndex].control1.y += delta.y;
  }
  synchronizeLegacyCoordinates(editable);
  replaceCurveGeometry(arc, editable);
  return true;
}

export function transformCurveGeometry(arc, transformPoint) {
  if (typeof transformPoint !== "function") return normalizeCurveGeometry(arc);
  const data = readStoredCurveData(arc);
  if (!data) {
    const transformed = {
      ...arc,
      ...pointFields(transformPoint({ x: arc.x, y: arc.y }), "x", "y"),
      ...pointFields(transformPoint({ x: arc.midX, y: arc.midY }), "midX", "midY"),
      ...pointFields(transformPoint({ x: arc.endX, y: arc.endY }), "endX", "endY"),
    };
    return normalizeCurveGeometry(transformed);
  }
  return normalizeCurveGeometry({
    ...arc,
    curvePoints: data.points.map(transformPoint),
    curveHandles: data.handles.map((handles) => ({
      control1: transformPoint(handles.control1),
      control2: transformPoint(handles.control2),
    })),
  });
}

/**
 * Approximates any Visual Board curve with adaptive line segments.
 */
export function getCurvePathPoints(
  arc,
  { tolerance = 1.5, maximumSegmentLength = 48, maximumDepth = 10 } = {},
) {
  if (!readStoredCurveData(arc)) {
    const start = { x: arc.x, y: arc.y };
    const end = { x: arc.endX, y: arc.endY };
    const control = getQuadraticControlPoint(arc);
    const startControl = interpolatePoint(start, control, 0.5);
    const endControl = interpolatePoint(control, end, 0.5);
    const middle = interpolatePoint(startControl, endControl, 0.5);
    const points = [start];
    appendAdaptiveQuadraticPoints(
      points,
      start,
      startControl,
      middle,
      tolerance,
      maximumSegmentLength,
      maximumDepth,
    );
    appendAdaptiveQuadraticPoints(
      points,
      middle,
      endControl,
      end,
      tolerance,
      maximumSegmentLength,
      maximumDepth,
    );
    return points;
  }

  const segments = getCurveBezierSegments(arc);
  if (!segments.length) return [];
  const points = [clonePoint(segments[0].start)];
  segments.forEach((segment) => {
    appendAdaptiveCubicPoints(
      points,
      segment.start,
      segment.control1,
      segment.control2,
      segment.end,
      tolerance,
      maximumSegmentLength,
      maximumDepth,
    );
  });
  return points;
}

function appendAdaptiveQuadraticPoints(
  points,
  start,
  control,
  end,
  tolerance,
  maximumSegmentLength,
  remainingDepth,
) {
  const chordLength = distanceBetween(start, end);
  const flatness = distancePointToInfiniteLine(control, start, end);
  if (
    remainingDepth <= 0
    || (flatness <= tolerance && chordLength <= maximumSegmentLength)
  ) {
    points.push(clonePoint(end));
    return;
  }

  const firstControl = interpolatePoint(start, control, 0.5);
  const secondControl = interpolatePoint(control, end, 0.5);
  const curveMiddle = interpolatePoint(firstControl, secondControl, 0.5);
  appendAdaptiveQuadraticPoints(
    points,
    start,
    firstControl,
    curveMiddle,
    tolerance,
    maximumSegmentLength,
    remainingDepth - 1,
  );
  appendAdaptiveQuadraticPoints(
    points,
    curveMiddle,
    secondControl,
    end,
    tolerance,
    maximumSegmentLength,
    remainingDepth - 1,
  );
}

/**
 * Backward-compatible name retained for existing callers and saved projects.
 */
export function getQuadraticCurvePoints(arc, options = {}) {
  return getCurvePathPoints(arc, options);
}

function readStoredCurveData(arc) {
  const points = Array.isArray(arc?.curvePoints)
    ? arc.curvePoints.filter(isPoint).map(clonePoint)
    : [];
  if (points.length < 2) return null;
  const handles = Array.isArray(arc.curveHandles)
    ? arc.curveHandles.slice(0, points.length - 1).map((item) => (
      isPoint(item?.control1) && isPoint(item?.control2)
        ? cloneHandles(item)
        : null
    ))
    : [];
  if (handles.length !== points.length - 1 || handles.some((item) => !item)) {
    return {
      points,
      handles: createAutomaticHandles(points),
    };
  }
  return { points, handles };
}

function createAutomaticHandles(points) {
  return points.slice(1).map((end, index) => {
    const start = points[index];
    const previous = points[index - 1] ?? start;
    const next = points[index + 2] ?? end;
    return {
      control1: {
        x: start.x + (end.x - previous.x) / 6,
        y: start.y + (end.y - previous.y) / 6,
      },
      control2: {
        x: end.x - (next.x - start.x) / 6,
        y: end.y - (next.y - start.y) / 6,
      },
    };
  });
}

function collectCurveKeyLocations(curve, segments, preservedIds) {
  const candidates = [];
  addCurveKeyLocation(candidates, {
    segmentIndex: 0,
    progress: 0,
    point: segments[0].start,
    endpoint: true,
    sourceVertexIndex: 0,
  });

  segments.forEach((segment, segmentIndex) => {
    ["x", "y"].forEach((axis) => {
      getCubicExtremaProgresses(segment, axis).forEach((progress) => {
        addCurveKeyLocation(candidates, {
          segmentIndex,
          progress,
          point: getCubicPoint(segment, progress),
          axes: [axis],
        });
      });
    });

    if (segmentIndex >= segments.length - 1) return;
    const sourceVertexIndex = segmentIndex + 1;
    const vertexId = curve.curveVertexIds?.[sourceVertexIndex];
    const axes = getBoundaryExtremaAxes(
      segment,
      segments[segmentIndex + 1],
    );
    if (axes.length || (vertexId && preservedIds.has(vertexId))) {
      addCurveKeyLocation(candidates, {
        segmentIndex,
        progress: 1,
        point: segment.end,
        axes,
        preserved: Boolean(vertexId && preservedIds.has(vertexId)),
        sourceVertexIndex,
      });
    }
  });

  const lastSegmentIndex = segments.length - 1;
  addCurveKeyLocation(candidates, {
    segmentIndex: lastSegmentIndex,
    progress: 1,
    point: segments[lastSegmentIndex].end,
    endpoint: true,
    sourceVertexIndex: segments.length,
  });
  return candidates.sort(compareCurveLocations);
}

function selectMeaningfulCurveLocations(candidates) {
  const retained = new Set();
  candidates.forEach((candidate, index) => {
    if (candidate.endpoint || candidate.preserved) retained.add(index);
  });

  ["x", "y"].forEach((axis) => {
    const axisCandidates = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => (
        candidate.endpoint || candidate.axes?.has(axis)
      ));
    const values = axisCandidates.map(({ candidate }) => candidate.point[axis]);
    const range = Math.max(...values) - Math.min(...values);
    const minimumProminence = Math.max(0.5, range * 0.01);
    axisCandidates.slice(1, -1).forEach((entry, index) => {
      const previous = axisCandidates[index].candidate.point[axis];
      const value = entry.candidate.point[axis];
      const next = axisCandidates[index + 2].candidate.point[axis];
      if (
        Math.min(Math.abs(value - previous), Math.abs(value - next))
        >= minimumProminence
      ) {
        retained.add(entry.index);
      }
    });
  });

  return candidates.filter((_, index) => retained.has(index));
}

function addCurveKeyLocation(candidates, location) {
  const pathPosition = location.segmentIndex + location.progress;
  const existing = candidates.find((candidate) => (
    Math.abs(candidate.pathPosition - pathPosition) <= 1e-7
  ));
  if (existing) {
    (location.axes ?? []).forEach((axis) => existing.axes.add(axis));
    existing.endpoint ||= Boolean(location.endpoint);
    existing.preserved ||= Boolean(location.preserved);
    if (Number.isInteger(location.sourceVertexIndex)) {
      existing.sourceVertexIndex = location.sourceVertexIndex;
    }
    return;
  }
  candidates.push({
    ...location,
    axes: new Set(location.axes ?? []),
    endpoint: Boolean(location.endpoint),
    preserved: Boolean(location.preserved),
    pathPosition,
    point: clonePoint(location.point),
  });
}

function compareCurveLocations(first, second) {
  return first.pathPosition - second.pathPosition;
}

function getCubicExtremaProgresses(segment, axis) {
  const start = segment.start[axis];
  const control1 = segment.control1[axis];
  const control2 = segment.control2[axis];
  const end = segment.end[axis];
  const roots = solveQuadratic(
    -start + 3 * control1 - 3 * control2 + end,
    2 * (start - 2 * control1 + control2),
    control1 - start,
  );
  return roots.filter((progress) => {
    if (progress <= 1e-6 || progress >= 1 - 1e-6) return false;
    const before = cubicDerivative(segment, progress - 1e-5)[axis];
    const after = cubicDerivative(segment, progress + 1e-5)[axis];
    return before * after < 0;
  });
}

function getBoundaryExtremaAxes(previous, next) {
  return ["x", "y"].filter((axis) => {
    const point = previous.end[axis];
    const before = getCubicPoint(previous, 1 - 1e-4)[axis];
    const after = getCubicPoint(next, 1e-4)[axis];
    return (
      (point > before && point > after)
      || (point < before && point < after)
    );
  });
}

function solveQuadratic(a, b, c) {
  if (Math.abs(a) <= CURVE_EPSILON) {
    return Math.abs(b) <= CURVE_EPSILON ? [] : [-c / b];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -CURVE_EPSILON) return [];
  if (Math.abs(discriminant) <= CURVE_EPSILON) return [-b / (2 * a)];
  const squareRoot = Math.sqrt(discriminant);
  return [
    (-b - squareRoot) / (2 * a),
    (-b + squareRoot) / (2 * a),
  ];
}

function cubicDerivative(segment, progress) {
  const remaining = 1 - progress;
  return {
    x: 3 * remaining * remaining * (segment.control1.x - segment.start.x)
      + 6 * remaining * progress * (segment.control2.x - segment.control1.x)
      + 3 * progress * progress * (segment.end.x - segment.control2.x),
    y: 3 * remaining * remaining * (segment.control1.y - segment.start.y)
      + 6 * remaining * progress * (segment.control2.y - segment.control1.y)
      + 3 * progress * progress * (segment.end.y - segment.control2.y),
  };
}

function createReinitializedHandles(segments, locations) {
  return locations.slice(1).map((endLocation, index) => {
    const startLocation = locations[index];
    const start = startLocation.point;
    const end = endLocation.point;
    const chord = { x: end.x - start.x, y: end.y - start.y };
    const distance = Math.hypot(chord.x, chord.y);
    const fallback = normalizeVector(chord, { x: 1, y: 0 });
    const startTangent = normalizeVector(
      getCurveLocationTangent(segments, startLocation),
      fallback,
    );
    const endTangent = normalizeVector(
      getCurveLocationTangent(segments, endLocation),
      fallback,
    );
    const handleLength = distance / 3;
    return {
      control1: {
        x: start.x + startTangent.x * handleLength,
        y: start.y + startTangent.y * handleLength,
      },
      control2: {
        x: end.x - endTangent.x * handleLength,
        y: end.y - endTangent.y * handleLength,
      },
    };
  });
}

function getCurveLocationTangent(segments, location) {
  const segment = segments[location.segmentIndex];
  if (!segment) return { x: 0, y: 0 };
  if (
    location.progress >= 1 - 1e-7
    && location.segmentIndex < segments.length - 1
  ) {
    const incoming = cubicDerivative(segment, 1);
    const outgoing = cubicDerivative(segments[location.segmentIndex + 1], 0);
    return {
      x: incoming.x + outgoing.x,
      y: incoming.y + outgoing.y,
    };
  }
  return cubicDerivative(segment, location.progress);
}

function normalizeVector(vector, fallback) {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= CURVE_EPSILON) return clonePoint(fallback);
  return { x: vector.x / length, y: vector.y / length };
}

function splitCubicSegment(segment, progress) {
  const startControl = interpolatePoint(segment.start, segment.control1, progress);
  const middleControl = interpolatePoint(segment.control1, segment.control2, progress);
  const endControl = interpolatePoint(segment.control2, segment.end, progress);
  const firstInner = interpolatePoint(startControl, middleControl, progress);
  const secondInner = interpolatePoint(middleControl, endControl, progress);
  const point = interpolatePoint(firstInner, secondInner, progress);
  return {
    point,
    first: {
      start: segment.start,
      control1: startControl,
      control2: firstInner,
      end: point,
    },
    second: {
      start: point,
      control1: secondInner,
      control2: endControl,
      end: segment.end,
    },
  };
}

function getCubicPoint(segment, progress) {
  const remaining = 1 - progress;
  const remainingSquared = remaining * remaining;
  const progressSquared = progress * progress;
  return {
    x: remainingSquared * remaining * segment.start.x
      + 3 * remainingSquared * progress * segment.control1.x
      + 3 * remaining * progressSquared * segment.control2.x
      + progressSquared * progress * segment.end.x,
    y: remainingSquared * remaining * segment.start.y
      + 3 * remainingSquared * progress * segment.control1.y
      + 3 * remaining * progressSquared * segment.control2.y
      + progressSquared * progress * segment.end.y,
  };
}

function appendAdaptiveCubicPoints(
  points,
  start,
  control1,
  control2,
  end,
  tolerance,
  maximumSegmentLength,
  remainingDepth,
) {
  const chordLength = distanceBetween(start, end);
  const flatness = Math.max(
    distancePointToInfiniteLine(control1, start, end),
    distancePointToInfiniteLine(control2, start, end),
  );
  if (
    remainingDepth <= 0
    || (flatness <= tolerance && chordLength <= maximumSegmentLength)
  ) {
    points.push(clonePoint(end));
    return;
  }

  const split = splitCubicSegment(
    { start, control1, control2, end },
    0.5,
  );
  appendAdaptiveCubicPoints(
    points,
    split.first.start,
    split.first.control1,
    split.first.control2,
    split.first.end,
    tolerance,
    maximumSegmentLength,
    remainingDepth - 1,
  );
  appendAdaptiveCubicPoints(
    points,
    split.second.start,
    split.second.control1,
    split.second.control2,
    split.second.end,
    tolerance,
    maximumSegmentLength,
    remainingDepth - 1,
  );
}

function replaceCurveGeometry(target, source) {
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
  ].forEach((key) => {
    if (key in source) target[key] = cloneValue(source[key]);
    else delete target[key];
  });
}

function synchronizeLegacyCoordinates(curve) {
  const points = curve.curvePoints;
  if (!Array.isArray(points) || points.length < 2) return;
  const middle = points[Math.floor(points.length / 2)];
  curve.x = points[0].x;
  curve.y = points[0].y;
  curve.midX = middle.x;
  curve.midY = middle.y;
  curve.endX = points.at(-1).x;
  curve.endY = points.at(-1).y;
}

function normalizeVertexIds(value, count) {
  if (!Array.isArray(value) || value.length !== count) return null;
  const normalized = value.map((item) => (
    typeof item === "string" && item ? item : null
  ));
  return normalized.some(Boolean) ? normalized : null;
}

function projectPointOntoSegment(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared <= CURVE_EPSILON) {
    return { progress: 0, point: clonePoint(start) };
  }
  const progress = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
    0,
    1,
  );
  return {
    progress,
    point: {
      x: start.x + deltaX * progress,
      y: start.y + deltaY * progress,
    },
  };
}

function distancePointToInfiniteLine(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0) return distanceBetween(point, start);
  return Math.abs(
    deltaY * point.x
      - deltaX * point.y
      + end.x * start.y
      - end.y * start.x,
  ) / length;
}

function interpolatePoint(first, second, progress) {
  return {
    x: first.x + (second.x - first.x) * progress,
    y: first.y + (second.y - first.y) * progress,
  };
}

function pointFields(point, xKey, yKey) {
  return { [xKey]: point.x, [yKey]: point.y };
}

function isPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function cloneHandles(handles) {
  return {
    control1: clonePoint(handles.control1),
    control2: clonePoint(handles.control2),
  };
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distanceBetween(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
