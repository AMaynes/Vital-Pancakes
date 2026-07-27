/**
 * Pure duplication helpers for Visual Board copy and paste.
 */

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
    }

    translateBoardObject(duplicate, offset.x, offset.y);
    return duplicate;
  });
}

function getMappedIdentifier(identifiers, originalIdentifier, createIdentifier) {
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

  if (Number.isFinite(object.x)) object.x += deltaX;
  if (Number.isFinite(object.y)) object.y += deltaY;
  if (Number.isFinite(object.endX)) object.endX += deltaX;
  if (Number.isFinite(object.endY)) object.endY += deltaY;
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
