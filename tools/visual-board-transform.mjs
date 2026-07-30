import {
  CURVE_TYPES,
  LINE_TYPES,
  SHAPE_TYPES,
  getObjectBounds,
  getShapeCenter,
} from "./visual-board-geometry.mjs?v=10";
import { transformCurveGeometry } from "./visual-board-curves.mjs?v=2";

/**
 * Mirrors complete selections while retaining IDs, groups, locks, vertex
 * relationships, arrow direction, crop data, and rig joint topology.
 */
export function flipBoardSelection(objects, rig, axis, options = {}) {
  if (!["horizontal", "vertical"].includes(axis)) throw new TypeError("Flip axis must be horizontal or vertical.");
  const source = objects ?? [];
  if (!source.length) return { objects: [], rig: clone(rig) };
  const center = options.center ?? selectionCenter(source);
  const mirrorText = Boolean(options.mirrorText);
  const transformed = source.map((object) => flipObject(object, center, axis, mirrorText));
  const selectedBodyIds = new Set(source.map((object) => object.groupId).filter(Boolean));
  const nextRig = clone(rig ?? { bodies: [], joints: [] });
  nextRig.joints = (nextRig.joints ?? []).map((joint) => (
    joint.bodyIds?.every((bodyId) => selectedBodyIds.has(bodyId))
      ? { ...joint, ...reflectPoint(joint, center, axis) }
      : joint
  ));
  return { objects: transformed, rig: nextRig, center };
}

export function getAlignmentSnap(movingBounds, otherBounds, tolerance = 6) {
  const movingX = [movingBounds.x, movingBounds.x + movingBounds.width / 2, movingBounds.x + movingBounds.width];
  const movingY = [movingBounds.y, movingBounds.y + movingBounds.height / 2, movingBounds.y + movingBounds.height];
  const targetX = otherBounds.flatMap((bounds) => [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width]);
  const targetY = otherBounds.flatMap((bounds) => [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height]);
  const xMatch = closestAlignment(movingX, targetX, tolerance);
  const yMatch = closestAlignment(movingY, targetY, tolerance);
  return {
    deltaX: xMatch?.delta ?? 0,
    deltaY: yMatch?.delta ?? 0,
    guides: [
      ...(xMatch ? [{ axis: "vertical", value: xMatch.target }] : []),
      ...(yMatch ? [{ axis: "horizontal", value: yMatch.target }] : []),
    ],
  };
}

function flipObject(object, center, axis, mirrorText) {
  const transformed = clone(object);
  if (object.type === "pen") {
    transformed.points = object.points.map((point) => reflectPoint(point, center, axis));
    return transformed;
  }
  if (object.type === "trace") {
    transformed.paths = object.paths.map((path) => path.map((point) => reflectPoint(point, center, axis)));
    return transformed;
  }
  if (CURVE_TYPES.has(object.type)) {
    return transformCurveGeometry(
      object,
      (point) => reflectPoint(point, center, axis),
    );
  }
  if (LINE_TYPES.has(object.type)) {
    Object.assign(transformed, reflectedCoordinates(object, center, axis, ["x", "y"], ["endX", "endY"]));
    return transformed;
  }
  if (SHAPE_TYPES.has(object.type)) {
    const objectCenter = reflectPoint(getShapeCenter(object), center, axis);
    transformed.x = objectCenter.x - object.w / 2;
    transformed.y = objectCenter.y - object.h / 2;
    if (object.type === "area") {
      transformed.vertices = object.vertices.map((point) => (
        axis === "horizontal"
          ? { x: 1 - point.x, y: point.y }
          : { x: point.x, y: 1 - point.y }
      ));
    }
    if (object.type === "textbox" && !mirrorText) {
      transformed.rotation = object.rotation ?? 0;
      return transformed;
    }
    transformed.rotation = -(object.rotation ?? 0);
    if (
      object.type === "image"
      || object.type === "symbol"
      || (object.type === "textbox" && mirrorText)
    ) {
      if (axis === "horizontal") transformed.flipX = !Boolean(object.flipX);
      else transformed.flipY = !Boolean(object.flipY);
    }
    return transformed;
  }
  return transformed;
}

function reflectedCoordinates(object, center, axis, ...pairs) {
  const output = {};
  pairs.forEach(([xKey, yKey]) => {
    const point = reflectPoint({ x: object[xKey], y: object[yKey] }, center, axis);
    output[xKey] = point.x;
    output[yKey] = point.y;
  });
  return output;
}

function reflectPoint(point, center, axis) {
  return axis === "horizontal"
    ? { x: center.x * 2 - point.x, y: point.y }
    : { x: point.x, y: center.y * 2 - point.y };
}

function selectionCenter(objects) {
  const bounds = objects.map(getObjectBounds);
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

function closestAlignment(moving, targets, tolerance) {
  let best = null;
  moving.forEach((value) => targets.forEach((target) => {
    const delta = target - value;
    if (Math.abs(delta) > tolerance) return;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, target };
  }));
  return best;
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
