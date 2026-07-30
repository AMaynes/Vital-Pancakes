/**
 * Pure duplication helpers for Visual Board copy and paste.
 */

import { normalizeGroupHistory } from "./visual-board-groups.mjs?v=4";

export function duplicateBoardObjects(sourceObjects, createIdentifier, offset = { x: 32, y: 32 }) {
  if (!Array.isArray(sourceObjects) || typeof createIdentifier !== "function") return [];

  const groupIdentifiers = new Map();
  const assemblyIdentifiers = new Map();
  const assemblySourceIdentifiers = new Map();
  const vertexNetworkIdentifiers = new Map();
  const vertexIdentifiers = new Map();

  return sourceObjects.map((sourceObject) => {
    const duplicate = cloneValue(sourceObject);
    duplicate.id = createIdentifier();
    duplicate.locked = false;

    if (duplicate.groupId) {
      duplicate.groupId = getMappedIdentifier(
        groupIdentifiers,
        duplicate.groupId,
        createIdentifier,
      );
    }
    const groupHistory = normalizeGroupHistory(duplicate.groupHistory);
    if (groupHistory.length) {
      duplicate.groupHistory = groupHistory.map((level) => (
        level
          ? {
            ...level,
            id: getMappedIdentifier(
              groupIdentifiers,
              level.id,
              createIdentifier,
            ),
          }
          : null
      ));
    } else {
      delete duplicate.groupHistory;
    }

    if (duplicate.assemblyId) {
      duplicate.assemblyId = getMappedIdentifier(
        assemblyIdentifiers,
        duplicate.assemblyId,
        createIdentifier,
      );
    }

    if (duplicate.assemblySource) {
      const sourceIdentifier = duplicate.assemblySource.id || sourceObject.assemblyId;
      duplicate.assemblySource.id = getMappedIdentifier(
        assemblySourceIdentifiers,
        sourceIdentifier,
        createIdentifier,
      );
      translateBoardObject(duplicate.assemblySource, offset.x, offset.y);
    }

    if (duplicate.vertexNetworkId) {
      duplicate.vertexNetworkId = getMappedIdentifier(
        vertexNetworkIdentifiers,
        duplicate.vertexNetworkId,
        createIdentifier,
      );
      duplicate.startVertexId = getMappedIdentifier(
        vertexIdentifiers,
        duplicate.startVertexId,
        createIdentifier,
      );
      duplicate.endVertexId = getMappedIdentifier(
        vertexIdentifiers,
        duplicate.endVertexId,
        createIdentifier,
      );
      if (Array.isArray(duplicate.curveVertexIds)) {
        duplicate.curveVertexIds = duplicate.curveVertexIds.map((vertexId) => (
          getMappedIdentifier(vertexIdentifiers, vertexId, createIdentifier)
        ));
      }
    }

    translateBoardObject(duplicate, offset.x, offset.y);
    return duplicate;
  });
}

function getMappedIdentifier(identifiers, originalIdentifier, createIdentifier) {
  if (typeof originalIdentifier !== "string" || !originalIdentifier) return null;
  if (!identifiers.has(originalIdentifier)) {
    identifiers.set(originalIdentifier, createIdentifier());
  }
  return identifiers.get(originalIdentifier);
}

function translateBoardObject(object, deltaX, deltaY) {
  if (object.type === "pen" && Array.isArray(object.points)) {
    object.points.forEach((point) => {
      point.x += deltaX;
      point.y += deltaY;
    });
    return;
  }

  if (object.type === "trace" && Array.isArray(object.paths)) {
    object.paths.flat().forEach((point) => {
      point.x += deltaX;
      point.y += deltaY;
    });
    return;
  }

  if (object.type === "arc" && Array.isArray(object.curvePoints)) {
    object.curvePoints.forEach((point) => {
      point.x += deltaX;
      point.y += deltaY;
    });
    (object.curveHandles ?? []).forEach((handles) => {
      handles.control1.x += deltaX;
      handles.control1.y += deltaY;
      handles.control2.x += deltaX;
      handles.control2.y += deltaY;
    });
  }

  if (Number.isFinite(object.x)) object.x += deltaX;
  if (Number.isFinite(object.y)) object.y += deltaY;
  if (Number.isFinite(object.endX)) object.endX += deltaX;
  if (Number.isFinite(object.endY)) object.endY += deltaY;
  if (Number.isFinite(object.midX)) object.midX += deltaX;
  if (Number.isFinite(object.midY)) object.midY += deltaY;
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
