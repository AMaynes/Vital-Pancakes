/**
 * Pure architectural geometry for Visual Board.
 *
 * The functions in this module compile caller-authored paths into exact,
 * editable board geometry. They do not choose layouts or move supplied points.
 */

export const ARCHITECTURE_WALL_JOINS = Object.freeze(["miter", "bevel", "round"]);
export const ARCHITECTURE_WALL_CAPS = Object.freeze(["butt", "square", "round"]);
export const ARCHITECTURE_PATH_OPERATIONS = Object.freeze(["M", "L", "Q", "C", "A", "Z"]);
export const ARCHITECTURE_SYMBOL_FITS = Object.freeze(["contain", "stretch"]);

const EPSILON = 0.0001;
const DEFAULT_CURVE_STEPS = 18;
const MAX_PATH_POINTS = 1_024;

/**
 * Samples an exact vector path into a bounded polygonal representation.
 *
 * Coordinates remain in world space. The result is suitable for editable
 * polygon areas, hit testing, and deterministic SVG/Canvas rendering.
 */
export function sampleArchitecturePath(commands, options = {}) {
  if (!Array.isArray(commands) || !commands.length) {
    throw new TypeError("Architecture path commands are required.");
  }
  const defaultCurveSteps = clampInteger(
    options.curveSteps,
    4,
    96,
    DEFAULT_CURVE_STEPS,
  );
  const points = [];
  let current = null;
  let subpathStart = null;
  let closed = false;

  commands.forEach((rawCommand, commandIndex) => {
    const command = normalizePathCommand(rawCommand, commandIndex);
    if (command.op === "M") {
      current = { x: command.x, y: command.y };
      subpathStart = { ...current };
      appendUniquePoint(points, current);
      return;
    }
    if (!current) {
      throw new TypeError(`Architecture path command ${commandIndex} must follow M.`);
    }
    if (command.op === "L") {
      current = { x: command.x, y: command.y };
      appendUniquePoint(points, current);
      return;
    }
    if (command.op === "Q") {
      const start = current;
      const steps = clampInteger(command.steps, 4, 96, defaultCurveSteps);
      for (let step = 1; step <= steps; step += 1) {
        const amount = step / steps;
        const inverse = 1 - amount;
        appendUniquePoint(points, {
          x: inverse * inverse * start.x
            + 2 * inverse * amount * command.cx
            + amount * amount * command.x,
          y: inverse * inverse * start.y
            + 2 * inverse * amount * command.cy
            + amount * amount * command.y,
        });
      }
      current = { x: command.x, y: command.y };
      return;
    }
    if (command.op === "C") {
      const start = current;
      const steps = clampInteger(command.steps, 4, 96, defaultCurveSteps);
      for (let step = 1; step <= steps; step += 1) {
        const amount = step / steps;
        const inverse = 1 - amount;
        appendUniquePoint(points, {
          x: inverse ** 3 * start.x
            + 3 * inverse * inverse * amount * command.c1x
            + 3 * inverse * amount * amount * command.c2x
            + amount ** 3 * command.x,
          y: inverse ** 3 * start.y
            + 3 * inverse * inverse * amount * command.c1y
            + 3 * inverse * amount * amount * command.c2y
            + amount ** 3 * command.y,
        });
      }
      current = { x: command.x, y: command.y };
      return;
    }
    if (command.op === "A") {
      const steps = clampInteger(command.steps, 4, 96, defaultCurveSteps);
      const sweep = normalizeArcSweep(
        command.startAngle,
        command.endAngle,
        command.clockwise,
      );
      for (let step = 0; step <= steps; step += 1) {
        const angle = sweep.start + sweep.delta * step / steps;
        appendUniquePoint(points, {
          x: command.cx + Math.cos(angle) * command.rx,
          y: command.cy + Math.sin(angle) * command.ry,
        });
      }
      current = points.at(-1);
      return;
    }
    if (command.op === "Z") {
      if (!subpathStart) {
        throw new TypeError(`Architecture path command ${commandIndex} has no subpath.`);
      }
      closed = true;
      current = { ...subpathStart };
      return;
    }
  });

  if (points.length > MAX_PATH_POINTS) {
    throw new RangeError(`Architecture path exceeds ${MAX_PATH_POINTS} sampled points.`);
  }
  return {
    points: removeClosingDuplicate(points),
    closed,
  };
}

/**
 * Compiles a connected wall path into separated wall runs, join patches, and
 * opening frames. Opening intervals are removed from wall bodies, so doors and
 * windows are genuine gaps instead of symbols painted over solid walls.
 */
export function buildWallPathGeometry(value) {
  const points = normalizeWorldPoints(value?.points, 2, 256, "Wall path points");
  const thickness = positiveNumber(value?.thickness, "Wall path thickness");
  const closed = Boolean(value?.closed);
  const join = ARCHITECTURE_WALL_JOINS.includes(value?.join) ? value.join : "miter";
  const cap = ARCHITECTURE_WALL_CAPS.includes(value?.cap) ? value.cap : "butt";
  const segmentCount = closed ? points.length : points.length - 1;
  const segments = Array.from({ length: segmentCount }, (_, segmentIndex) => {
    const start = points[segmentIndex];
    const end = points[(segmentIndex + 1) % points.length];
    const length = distance(start, end);
    if (length < 1) {
      throw new RangeError(`Wall path segment ${segmentIndex} is shorter than one world unit.`);
    }
    return createSegmentRecord(start, end, segmentIndex, length);
  });
  const openingResult = normalizeWallOpenings(value?.openings, segments, thickness);
  const wallRuns = [];

  segments.forEach((segment) => {
    const intervals = subtractIntervals(
      segment.length,
      openingResult.openings
        .filter((opening) => opening.segmentIndex === segment.index)
        .map((opening) => ({
          start: opening.offset - opening.width / 2,
          end: opening.offset + opening.width / 2,
        })),
    );
    intervals.forEach((interval, runIndex) => {
      const start = pointAlongSegment(segment, interval.start);
      const end = pointAlongSegment(segment, interval.end);
      wallRuns.push({
        segmentIndex: segment.index,
        runIndex,
        start,
        end,
        length: interval.end - interval.start,
        thickness,
        rotation: segment.angle,
      });
    });
  });

  const joinPoints = closed ? points : points.slice(1, -1);
  const joints = joinPoints.map((point, index) => ({
    segmentIndex: closed ? index : index + 1,
    points: createJoinPatch(point, thickness, join),
  }));
  const caps = closed || cap === "butt"
    ? []
    : [
      createCapPatch(points[0], segments[0], thickness, cap, -1),
      createCapPatch(points.at(-1), segments.at(-1), thickness, cap, 1),
    ];

  return {
    points,
    thickness,
    closed,
    join,
    cap,
    wallRuns,
    joints: [...joints, ...caps],
    openings: openingResult.openings.map((opening) => (
      createOpeningFrame(opening, segments[opening.segmentIndex], thickness)
    )),
    issues: openingResult.issues,
  };
}

/**
 * Returns the drawing frame for a symbol while preserving its catalog aspect
 * ratio when `fit` is `contain`.
 */
export function fitArchitectureSymbolFrame(object, definition) {
  const frame = {
    x: finite(object?.x, 0),
    y: finite(object?.y, 0),
    w: Math.max(EPSILON, finite(object?.w, 1)),
    h: Math.max(EPSILON, finite(object?.h, 1)),
  };
  const fit = ARCHITECTURE_SYMBOL_FITS.includes(object?.fit)
    ? object.fit
    : definition?.preserveAspectRatio === false
      ? "stretch"
      : "contain";
  if (fit === "stretch") return frame;

  const nominalWidth = Math.max(EPSILON, finite(definition?.nominalWidth, 1));
  const nominalHeight = Math.max(EPSILON, finite(definition?.nominalHeight, 1));
  const scale = Math.min(frame.w / nominalWidth, frame.h / nominalHeight);
  const width = nominalWidth * scale;
  const height = nominalHeight * scale;
  return {
    x: frame.x + (frame.w - width) / 2,
    y: frame.y + (frame.h - height) / 2,
    w: width,
    h: height,
  };
}

export function getPolygonBounds(points) {
  const normalized = normalizeWorldPoints(points, 1, MAX_PATH_POINTS, "Polygon points");
  const left = Math.min(...normalized.map((point) => point.x));
  const top = Math.min(...normalized.map((point) => point.y));
  const right = Math.max(...normalized.map((point) => point.x));
  const bottom = Math.max(...normalized.map((point) => point.y));
  return {
    x: left,
    y: top,
    width: Math.max(EPSILON, right - left),
    height: Math.max(EPSILON, bottom - top),
  };
}

export function polygonsIntersect(firstValue, secondValue) {
  const first = normalizeWorldPoints(firstValue, 3, MAX_PATH_POINTS, "First polygon");
  const second = normalizeWorldPoints(secondValue, 3, MAX_PATH_POINTS, "Second polygon");
  if (!boundsIntersect(getPolygonBounds(first), getPolygonBounds(second))) return false;
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstStart = first[firstIndex];
    const firstEnd = first[(firstIndex + 1) % first.length];
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondStart = second[secondIndex];
      const secondEnd = second[(secondIndex + 1) % second.length];
      if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return true;
    }
  }
  return pointInPolygon(first[0], second) || pointInPolygon(second[0], first);
}

export function pointToSegmentDistance(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared <= EPSILON) return distance(point, start);
  const amount = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
    0,
    1,
  );
  return distance(point, {
    x: start.x + deltaX * amount,
    y: start.y + deltaY * amount,
  });
}

function normalizePathCommand(value, commandIndex) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Architecture path command ${commandIndex} must be an object.`);
  }
  const op = String(value.op ?? "").toUpperCase();
  if (!ARCHITECTURE_PATH_OPERATIONS.includes(op)) {
    throw new TypeError(`Unsupported architecture path operation: ${op || "(missing)"}.`);
  }
  if (op === "Z") return { op };
  if (op === "A") {
    return {
      op,
      cx: requiredFinite(value.cx, `${op}.cx`),
      cy: requiredFinite(value.cy, `${op}.cy`),
      rx: positiveNumber(value.rx, `${op}.rx`),
      ry: positiveNumber(value.ry, `${op}.ry`),
      startAngle: requiredFinite(value.startAngle, `${op}.startAngle`),
      endAngle: requiredFinite(value.endAngle, `${op}.endAngle`),
      clockwise: value.clockwise !== false,
      steps: value.steps,
    };
  }
  const normalized = {
    op,
    x: requiredFinite(value.x, `${op}.x`),
    y: requiredFinite(value.y, `${op}.y`),
    steps: value.steps,
  };
  if (op === "Q") {
    normalized.cx = requiredFinite(value.cx, `${op}.cx`);
    normalized.cy = requiredFinite(value.cy, `${op}.cy`);
  }
  if (op === "C") {
    normalized.c1x = requiredFinite(value.c1x, `${op}.c1x`);
    normalized.c1y = requiredFinite(value.c1y, `${op}.c1y`);
    normalized.c2x = requiredFinite(value.c2x, `${op}.c2x`);
    normalized.c2y = requiredFinite(value.c2y, `${op}.c2y`);
  }
  return normalized;
}

function normalizeWallOpenings(value, segments, thickness) {
  const openings = [];
  const issues = [];
  (Array.isArray(value) ? value : []).forEach((rawOpening, openingIndex) => {
    if (!rawOpening || typeof rawOpening !== "object" || Array.isArray(rawOpening)) {
      throw new TypeError(`Wall opening ${openingIndex} must be an object.`);
    }
    const segmentIndex = clampInteger(
      rawOpening.segmentIndex,
      0,
      Math.max(0, segments.length - 1),
      -1,
    );
    if (segmentIndex < 0 || !segments[segmentIndex]) {
      issues.push({
        code: "opening-segment-missing",
        openingIndex,
        segmentIndex: rawOpening.segmentIndex,
      });
      return;
    }
    const segment = segments[segmentIndex];
    const width = positiveNumber(rawOpening.width, `Wall opening ${openingIndex} width`);
    const offset = finite(rawOpening.offset, segment.length / 2);
    const start = offset - width / 2;
    const end = offset + width / 2;
    if (start < 0 || end > segment.length) {
      issues.push({
        code: "opening-outside-wall",
        openingIndex,
        segmentIndex,
        start,
        end,
        segmentLength: segment.length,
      });
      return;
    }
    openings.push({
      openingIndex,
      segmentIndex,
      offset,
      width,
      kind: normalizeOpeningKind(rawOpening.kind),
      hinge: rawOpening.hinge === "right" ? "right" : "left",
      side: rawOpening.side === "outside" ? "outside" : "inside",
      sillDepth: Math.max(thickness, finite(rawOpening.sillDepth, thickness * 1.8)),
      clientKey: typeof rawOpening.clientKey === "string" ? rawOpening.clientKey : "",
      semantic: rawOpening.semantic && typeof rawOpening.semantic === "object"
        ? rawOpening.semantic
        : null,
    });
  });

  segments.forEach((segment) => {
    const segmentOpenings = openings
      .filter((opening) => opening.segmentIndex === segment.index)
      .sort((first, second) => first.offset - second.offset);
    for (let index = 1; index < segmentOpenings.length; index += 1) {
      const previous = segmentOpenings[index - 1];
      const current = segmentOpenings[index];
      if (previous.offset + previous.width / 2 > current.offset - current.width / 2) {
        issues.push({
          code: "openings-overlap",
          segmentIndex: segment.index,
          firstOpeningIndex: previous.openingIndex,
          secondOpeningIndex: current.openingIndex,
        });
      }
    }
  });
  return { openings, issues };
}

function createSegmentRecord(start, end, index, length) {
  const tangent = {
    x: (end.x - start.x) / length,
    y: (end.y - start.y) / length,
  };
  return {
    index,
    start,
    end,
    length,
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
    angle: Math.atan2(end.y - start.y, end.x - start.x),
  };
}

function subtractIntervals(length, exclusions) {
  const normalized = exclusions
    .map((interval) => ({
      start: clamp(interval.start, 0, length),
      end: clamp(interval.end, 0, length),
    }))
    .filter((interval) => interval.end - interval.start > EPSILON)
    .sort((first, second) => first.start - second.start);
  const merged = [];
  normalized.forEach((interval) => {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + EPSILON) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  });
  const runs = [];
  let cursor = 0;
  merged.forEach((interval) => {
    if (interval.start - cursor > EPSILON) {
      runs.push({ start: cursor, end: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  });
  if (length - cursor > EPSILON) runs.push({ start: cursor, end: length });
  return runs;
}

function pointAlongSegment(segment, offset) {
  return {
    x: segment.start.x + segment.tangent.x * offset,
    y: segment.start.y + segment.tangent.y * offset,
  };
}

function createJoinPatch(point, thickness, join) {
  const half = thickness / 2;
  if (join === "bevel") {
    return regularPolygon(point, half * 1.08, 6, Math.PI / 6);
  }
  if (join === "round") {
    return regularPolygon(point, half, 16, Math.PI / 16);
  }
  return regularPolygon(point, half * Math.SQRT2, 4, Math.PI / 4);
}

function createCapPatch(point, segment, thickness, cap, direction) {
  const half = thickness / 2;
  const center = cap === "square"
    ? {
      x: point.x + segment.tangent.x * half * direction,
      y: point.y + segment.tangent.y * half * direction,
    }
    : point;
  return {
    segmentIndex: segment.index,
    points: regularPolygon(center, cap === "round" ? half : half * Math.SQRT2, cap === "round" ? 16 : 4, cap === "round" ? 0 : segment.angle + Math.PI / 4),
  };
}

function createOpeningFrame(opening, segment, thickness) {
  const wallCenter = pointAlongSegment(segment, opening.offset);
  const isDoor = opening.kind.startsWith("door-");
  const symbolHeight = isDoor
    ? opening.kind === "door-double"
      ? opening.width / 2
      : opening.width
    : opening.sillDepth;
  const sideDirection = opening.side === "outside" ? -1 : 1;
  const center = isDoor
    ? {
      x: wallCenter.x + segment.normal.x * sideDirection * symbolHeight / 2,
      y: wallCenter.y + segment.normal.y * sideDirection * symbolHeight / 2,
    }
    : wallCenter;
  return {
    ...opening,
    wallCenter,
    x: center.x - opening.width / 2,
    y: center.y - symbolHeight / 2,
    w: opening.width,
    h: symbolHeight,
    rotation: segment.angle,
    flipX: opening.hinge === "right",
    flipY: opening.side === "outside",
    thickness,
  };
}

function regularPolygon(center, radius, count, rotation) {
  return Array.from({ length: count }, (_, index) => {
    const angle = rotation + index / count * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

function normalizeWorldPoints(value, minimum, maximum, field) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new RangeError(`${field} must contain ${minimum} to ${maximum} points.`);
  }
  return value.map((point, pointIndex) => {
    if (!point || typeof point !== "object" || Array.isArray(point)) {
      throw new TypeError(`${field}[${pointIndex}] must be a point.`);
    }
    return {
      x: requiredFinite(point.x, `${field}[${pointIndex}].x`),
      y: requiredFinite(point.y, `${field}[${pointIndex}].y`),
    };
  });
}

function normalizeOpeningKind(value) {
  const kind = String(value ?? "door-single");
  return [
    "door-single",
    "door-double",
    "door-french",
    "door-sliding",
    "door-pocket",
    "door-bifold",
    "window",
    "window-casement",
    "window-fixed",
    "window-bay",
  ].includes(kind)
    ? kind
    : "door-single";
}

function normalizeArcSweep(startAngle, endAngle, clockwise) {
  let delta = endAngle - startAngle;
  if (clockwise && delta < 0) delta += Math.PI * 2;
  if (!clockwise && delta > 0) delta -= Math.PI * 2;
  return { start: startAngle, delta };
}

function appendUniquePoint(points, point) {
  const previous = points.at(-1);
  if (!previous || distance(previous, point) > EPSILON) points.push(point);
}

function removeClosingDuplicate(points) {
  if (points.length > 2 && distance(points[0], points.at(-1)) <= EPSILON) {
    return points.slice(0, -1);
  }
  return points;
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);
  if (
    firstOrientation !== secondOrientation
    && thirdOrientation !== fourthOrientation
  ) {
    return true;
  }
  return firstOrientation === 0 && pointOnSegment(secondStart, firstStart, firstEnd)
    || secondOrientation === 0 && pointOnSegment(secondEnd, firstStart, firstEnd)
    || thirdOrientation === 0 && pointOnSegment(firstStart, secondStart, secondEnd)
    || fourthOrientation === 0 && pointOnSegment(firstEnd, secondStart, secondEnd);
}

function orientation(first, second, third) {
  const value = (second.y - first.y) * (third.x - second.x)
    - (second.x - first.x) * (third.y - second.y);
  if (Math.abs(value) <= EPSILON) return 0;
  return value > 0 ? 1 : 2;
}

function pointOnSegment(point, start, end) {
  return point.x <= Math.max(start.x, end.x) + EPSILON
    && point.x >= Math.min(start.x, end.x) - EPSILON
    && point.y <= Math.max(start.y, end.y) + EPSILON
    && point.y >= Math.min(start.y, end.y) - EPSILON;
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
    const crosses = (current.y > point.y) !== (previous.y > point.y)
      && point.x < (
        (previous.x - current.x) * (point.y - current.y)
        / ((previous.y - current.y) || EPSILON)
        + current.x
      );
    if (crosses) inside = !inside;
  }
  return inside;
}

function boundsIntersect(first, second) {
  return first.x <= second.x + second.width
    && first.x + first.width >= second.x
    && first.y <= second.y + second.height
    && first.y + first.height >= second.y;
}

function requiredFinite(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${field} must be finite.`);
  return number;
}

function positiveNumber(value, field) {
  const number = requiredFinite(value, field);
  if (number <= 0) throw new RangeError(`${field} must be positive.`);
  return number;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.round(number)))
    : fallback;
}

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
