import {
  CURVE_TYPES,
  LINE_TYPES,
  SHAPE_TYPES,
  getObjectBounds,
  getShapeCenter,
  rotatePoint,
} from "./visual-board-geometry.mjs";

export function getSelectionUnits(objects) {
  const units = [];
  const groupedUnits = new Map();
  (Array.isArray(objects) ? objects : []).forEach((object) => {
    if (!object || typeof object !== "object") return;
    if (!object.groupId) {
      units.push([object]);
      return;
    }
    if (!groupedUnits.has(object.groupId)) {
      const unit = [];
      groupedUnits.set(object.groupId, unit);
      units.push(unit);
    }
    groupedUnits.get(object.groupId).push(object);
  });
  return units;
}

export function getSelectionBounds(objects) {
  const bounds = objects.map(getObjectBounds);
  const minimumX = Math.min(...bounds.map((item) => item.x));
  const minimumY = Math.min(...bounds.map((item) => item.y));
  const maximumX = Math.max(...bounds.map((item) => item.x + item.width));
  const maximumY = Math.max(...bounds.map((item) => item.y + item.height));
  return {
    x: minimumX,
    y: minimumY,
    width: Math.max(1, maximumX - minimumX),
    height: Math.max(1, maximumY - minimumY),
  };
}

export function resizeSelectionObjects(
  objects,
  initialBounds,
  corner,
  worldPoint,
  minimumSize = 16,
) {
  const nextBounds = getResizedBounds(initialBounds, corner, worldPoint, minimumSize);
  const scaleX = nextBounds.width / initialBounds.width;
  const scaleY = nextBounds.height / initialBounds.height;
  const transformPoint = (point) => ({
    x: nextBounds.x + (point.x - initialBounds.x) * scaleX,
    y: nextBounds.y + (point.y - initialBounds.y) * scaleY,
  });
  return {
    bounds: nextBounds,
    objects: objects.map((object) => transformObject(
      object,
      transformPoint,
      scaleX,
      scaleY,
      0,
    )),
  };
}

export function rotateSelectionObjects(objects, center, angle) {
  return objects.map((object) => transformObject(
    object,
    (point) => rotatePoint(point, center, angle),
    1,
    1,
    angle,
  ));
}

function getResizedBounds(bounds, corner, point, minimumSize) {
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;

  if (corner === "nw") {
    const x = Math.min(point.x, right - minimumSize);
    const y = Math.min(point.y, bottom - minimumSize);
    return { x, y, width: right - x, height: bottom - y };
  }
  if (corner === "ne") {
    const y = Math.min(point.y, bottom - minimumSize);
    return {
      x: left,
      y,
      width: Math.max(minimumSize, point.x - left),
      height: bottom - y,
    };
  }
  if (corner === "sw") {
    const x = Math.min(point.x, right - minimumSize);
    return {
      x,
      y: top,
      width: right - x,
      height: Math.max(minimumSize, point.y - top),
    };
  }
  return {
    x: left,
    y: top,
    width: Math.max(minimumSize, point.x - left),
    height: Math.max(minimumSize, point.y - top),
  };
}

function transformObject(object, transformPoint, scaleX, scaleY, rotationDelta) {
  const transformed = { ...object };
  const transformCoordinates = (x, y) => transformPoint({ x, y });

  if (object.type === "pen") {
    transformed.points = object.points.map(transformPoint);
    return transformed;
  }
  if (object.type === "trace") {
    transformed.paths = object.paths.map((path) => path.map(transformPoint));
    return transformed;
  }
  if (CURVE_TYPES.has(object.type)) {
    const start = transformCoordinates(object.x, object.y);
    const middle = transformCoordinates(object.midX, object.midY);
    const end = transformCoordinates(object.endX, object.endY);
    return {
      ...transformed,
      x: start.x,
      y: start.y,
      midX: middle.x,
      midY: middle.y,
      endX: end.x,
      endY: end.y,
    };
  }
  if (LINE_TYPES.has(object.type)) {
    const start = transformCoordinates(object.x, object.y);
    const end = transformCoordinates(object.endX, object.endY);
    return {
      ...transformed,
      x: start.x,
      y: start.y,
      endX: end.x,
      endY: end.y,
    };
  }
  if (SHAPE_TYPES.has(object.type)) {
    const center = transformPoint(getShapeCenter(object));
    const width = Math.max(1, Math.abs(object.w * scaleX));
    const height = Math.max(1, Math.abs(object.h * scaleY));
    return {
      ...transformed,
      x: center.x - width / 2,
      y: center.y - height / 2,
      w: width,
      h: height,
      rotation: (object.rotation ?? 0) + rotationDelta,
      ...(Number.isFinite(object.shapeDepthX)
        ? { shapeDepthX: object.shapeDepthX * Math.abs(scaleX) }
        : {}),
      ...(Number.isFinite(object.shapeDepthY)
        ? { shapeDepthY: object.shapeDepthY * Math.abs(scaleY) }
        : {}),
    };
  }
  return transformed;
}
