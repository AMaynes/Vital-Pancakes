/**
 * Pure three-point curve helpers for the Visual Board.
 *
 * An arc stores its start, end, and a middle point that lies on the curve.
 * Internally the middle point is converted to a quadratic Bezier control point.
 */

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
 * Approximates a three-point curve with more vertices where it bends.
 * The stored middle point is always included, even for a straight arc.
 */
export function getQuadraticCurvePoints(
  arc,
  { tolerance = 1.5, maximumSegmentLength = 48, maximumDepth = 10 } = {},
) {
  const start = { x: arc.x, y: arc.y };
  const end = { x: arc.endX, y: arc.endY };
  const control = getQuadraticControlPoint(arc);
  const startControl = midpoint(start, control);
  const endControl = midpoint(control, end);
  const middle = midpoint(startControl, endControl);
  const points = [start];

  appendAdaptiveCurvePoints(
    points,
    start,
    startControl,
    middle,
    tolerance,
    maximumSegmentLength,
    maximumDepth,
  );
  appendAdaptiveCurvePoints(
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

function appendAdaptiveCurvePoints(
  points,
  start,
  control,
  end,
  tolerance,
  maximumSegmentLength,
  remainingDepth,
) {
  const chordLength = Math.hypot(end.x - start.x, end.y - start.y);
  const flatness = distancePointToInfiniteLine(control, start, end);
  if (
    remainingDepth <= 0
    || (flatness <= tolerance && chordLength <= maximumSegmentLength)
  ) {
    points.push(end);
    return;
  }

  const firstControl = midpoint(start, control);
  const secondControl = midpoint(control, end);
  const curveMiddle = midpoint(firstControl, secondControl);
  appendAdaptiveCurvePoints(
    points,
    start,
    firstControl,
    curveMiddle,
    tolerance,
    maximumSegmentLength,
    remainingDepth - 1,
  );
  appendAdaptiveCurvePoints(
    points,
    curveMiddle,
    secondControl,
    end,
    tolerance,
    maximumSegmentLength,
    remainingDepth - 1,
  );
}

function distancePointToInfiniteLine(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(
    deltaY * point.x
      - deltaX * point.y
      + end.x * start.y
      - end.y * start.x,
  ) / length;
}

function midpoint(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}
