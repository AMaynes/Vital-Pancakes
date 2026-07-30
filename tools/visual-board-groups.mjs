import {
  CURVE_TYPES,
  LINE_TYPES,
  SHAPE_TYPES,
  getObjectBounds,
  getShapeCenter,
  rotatePoint,
} from "./visual-board-geometry.mjs";
import { transformCurveGeometry } from "./visual-board-curves.mjs?v=5";

export function normalizeGroupHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((level) => {
    if (level === null) return [null];
    const id = typeof level?.id === "string"
      ? level.id
      : typeof level?.groupId === "string"
        ? level.groupId
        : "";
    if (!id) return [];
    return [{
      id,
      rigidGroup: level.rigidGroup !== false,
    }];
  });
}

export function getObjectGroupFields(object) {
  const groupHistory = normalizeGroupHistory(object?.groupHistory);
  const groupId = typeof object?.groupId === "string" && object.groupId
    ? object.groupId
    : null;
  return {
    ...(groupId && groupHistory.length ? { groupHistory } : {}),
    ...(groupId
      ? {
        groupId,
        ...(object.rigidGroup ? { rigidGroup: true } : {}),
      }
      : {}),
  };
}

export function pushObjectGroupLevel(object, groupId, rigidGroup = true) {
  if (!object || typeof object !== "object" || !groupId) return false;
  const history = normalizeGroupHistory(object.groupHistory);
  history.push(object.groupId
    ? {
      id: object.groupId,
      rigidGroup: Boolean(object.rigidGroup),
    }
    : null);
  object.groupHistory = history;
  object.groupId = groupId;
  if (rigidGroup) object.rigidGroup = true;
  else delete object.rigidGroup;
  return true;
}

export function popObjectGroupLevel(object) {
  if (!object?.groupId) return null;
  const removed = {
    id: object.groupId,
    rigidGroup: Boolean(object.rigidGroup),
  };
  const history = normalizeGroupHistory(object.groupHistory);
  const previous = history.length ? history.pop() : null;
  if (history.length) object.groupHistory = history;
  else delete object.groupHistory;
  if (previous?.id) {
    object.groupId = previous.id;
    if (previous.rigidGroup) object.rigidGroup = true;
    else delete object.rigidGroup;
  } else {
    delete object.groupId;
    delete object.rigidGroup;
  }
  return removed;
}

export function getObjectGroupIds(object) {
  return [
    ...normalizeGroupHistory(object?.groupHistory)
      .map((level) => level?.id)
      .filter(Boolean),
    ...(typeof object?.groupId === "string" && object.groupId
      ? [object.groupId]
      : []),
  ];
}

export function objectBelongsToGroup(object, groupId) {
  return Boolean(groupId && getObjectGroupIds(object).includes(groupId));
}

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

export function padSelectionBounds(bounds, padding = 0) {
  const amount = Math.max(0, Number(padding) || 0);
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}

export function mapPaddedResizePointer(pointer, handleStart, resizeStart) {
  return {
    x: resizeStart.x + pointer.x - handleStart.x,
    y: resizeStart.y + pointer.y - handleStart.y,
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

export function transformSelectionObjects(
  objects,
  origin,
  {
    scale = 1,
    rotation = 0,
    translation = { x: 0, y: 0 },
  } = {},
) {
  const transformPoint = (point) => {
    const scaled = {
      x: origin.x + (point.x - origin.x) * scale,
      y: origin.y + (point.y - origin.y) * scale,
    };
    const rotated = rotatePoint(scaled, origin, rotation);
    return {
      x: rotated.x + translation.x,
      y: rotated.y + translation.y,
    };
  };
  return objects.map((object) => transformObject(
    object,
    transformPoint,
    scale,
    scale,
    rotation,
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
    return transformCurveGeometry(object, transformPoint);
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
