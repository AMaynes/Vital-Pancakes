/**
 * Portable Visual Board character packages with embedded local image assets.
 */

import { getSelectionBounds, transformSelectionObjects } from "./visual-board-groups.mjs";
import {
  getConnectedRigBodyIds,
  normalizeRig,
} from "./visual-board-rigging.mjs";

export const CHARACTER_FORMAT = "vital-pancakes-character";
export const CHARACTER_VERSION = 1;

export class CharacterFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "CharacterFileError";
  }
}

export function createCharacterPackage(objects, assets, rig, selectedObjectIds, name = "Character") {
  const selectedIds = new Set(selectedObjectIds);
  const selectedObjects = objects.filter((object) => selectedIds.has(object.id));
  if (!selectedObjects.length) throw new CharacterFileError("Select a character before saving.");

  const selectedBodyIds = selectedObjects.map((object) => object.groupId).filter(Boolean);
  const connectedBodyIds = getConnectedRigBodyIds(rig, selectedBodyIds);
  const includedObjects = objects.filter((object) => (
    selectedIds.has(object.id) || (object.groupId && connectedBodyIds.has(object.groupId))
  ));
  const includedObjectIds = new Set(includedObjects.map((object) => object.id));
  const includedBodies = (rig?.bodies ?? []).filter((body) => connectedBodyIds.has(body.id));
  const includedBodyIds = new Set(includedBodies.map((body) => body.id));
  const includedJoints = (rig?.joints ?? []).filter((joint) => (
    joint.bodyIds.every((bodyId) => includedBodyIds.has(bodyId))
  ));
  const includedJointIds = new Set(includedJoints.map((joint) => joint.id));
  const assetIds = new Set(includedObjects.map((object) => object.assetId).filter(Boolean));
  const includedAssets = Object.fromEntries(
    [...assetIds]
      .filter((assetId) => assets?.[assetId])
      .map((assetId) => [assetId, cloneValue(assets[assetId])]),
  );

  return {
    format: CHARACTER_FORMAT,
    version: CHARACTER_VERSION,
    name: normalizeName(name),
    objects: cloneValue(includedObjects),
    assets: includedAssets,
    rig: {
      bodies: cloneValue(includedBodies).map((body) => ({
        ...body,
        objectIds: body.objectIds.filter((objectId) => includedObjectIds.has(objectId)),
        jointIds: body.jointIds.filter((jointId) => includedJointIds.has(jointId)),
      })),
      joints: cloneValue(includedJoints),
    },
  };
}

export function instantiateCharacter(rawCharacter, createIdentifier, placementPoint) {
  validateCharacter(rawCharacter);
  if (typeof createIdentifier !== "function") {
    throw new CharacterFileError("The character could not be assigned new identifiers.");
  }

  const objectIds = createIdentifierMap(rawCharacter.objects.map((object) => object.id), createIdentifier);
  const groupIds = createIdentifierMap(
    rawCharacter.objects.map((object) => object.groupId).filter(Boolean),
    createIdentifier,
  );
  const networkIds = createIdentifierMap(
    rawCharacter.objects.map((object) => object.vertexNetworkId).filter(Boolean),
    createIdentifier,
  );
  const vertexIds = createIdentifierMap(
    rawCharacter.objects.flatMap((object) => [
      object.startVertexId,
      object.endVertexId,
    ]).filter(Boolean),
    createIdentifier,
  );
  const assemblyIds = createIdentifierMap(
    rawCharacter.objects.map((object) => object.assemblyId).filter(Boolean),
    createIdentifier,
  );
  const assemblySourceIds = createIdentifierMap(
    rawCharacter.objects.map((object) => object.assemblySource?.id).filter(Boolean),
    createIdentifier,
  );
  const assetIds = createIdentifierMap(Object.keys(rawCharacter.assets ?? {}), createIdentifier);
  const jointIds = createIdentifierMap(
    (rawCharacter.rig?.joints ?? []).map((joint) => joint.id),
    createIdentifier,
  );

  let objects = cloneValue(rawCharacter.objects).map((object) => {
    object.id = objectIds.get(object.id);
    if (object.groupId) object.groupId = groupIds.get(object.groupId);
    if (object.vertexNetworkId) object.vertexNetworkId = networkIds.get(object.vertexNetworkId);
    if (object.startVertexId) object.startVertexId = vertexIds.get(object.startVertexId);
    if (object.endVertexId) object.endVertexId = vertexIds.get(object.endVertexId);
    if (object.assemblyId) object.assemblyId = assemblyIds.get(object.assemblyId);
    if (object.assemblySource?.id) {
      object.assemblySource.id = assemblySourceIds.get(object.assemblySource.id);
    }
    if (object.assetId) object.assetId = assetIds.get(object.assetId);
    return object;
  });
  const assets = Object.fromEntries(
    Object.entries(rawCharacter.assets ?? {}).map(([assetId, asset]) => [
      assetIds.get(assetId),
      cloneValue(asset),
    ]),
  );
  const rig = {
    bodies: (rawCharacter.rig?.bodies ?? []).map((body) => ({
      id: groupIds.get(body.id),
      objectIds: body.objectIds.map((objectId) => objectIds.get(objectId)).filter(Boolean),
      jointIds: body.jointIds.map((jointId) => jointIds.get(jointId)).filter(Boolean),
      dimensionsLocked: Boolean(body.dimensionsLocked),
    })).filter((body) => body.id),
    joints: (rawCharacter.rig?.joints ?? []).map((joint) => ({
      id: jointIds.get(joint.id),
      x: Number(joint.x),
      y: Number(joint.y),
      bodyIds: joint.bodyIds.map((bodyId) => groupIds.get(bodyId)).filter(Boolean),
    })),
  };

  const bounds = getSelectionBounds(objects);
  const target = {
    x: Number.isFinite(placementPoint?.x) ? placementPoint.x : bounds.x + bounds.width / 2,
    y: Number.isFinite(placementPoint?.y) ? placementPoint.y : bounds.y + bounds.height / 2,
  };
  const translation = {
    x: target.x - (bounds.x + bounds.width / 2),
    y: target.y - (bounds.y + bounds.height / 2),
  };
  objects = transformSelectionObjects(objects, { x: 0, y: 0 }, { translation });
  objects.forEach((object) => {
    if (!object.assemblySource) return;
    [object.assemblySource] = transformSelectionObjects(
      [object.assemblySource],
      { x: 0, y: 0 },
      { translation },
    );
  });
  rig.joints.forEach((joint) => {
    joint.x += translation.x;
    joint.y += translation.y;
  });

  return {
    name: normalizeName(rawCharacter.name),
    objects,
    assets,
    rig: normalizeRig(rig, objects),
  };
}

export function createCharacterFilename(name) {
  const safeName = normalizeName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "character";
  return `${safeName}.vp-character.json`;
}

function validateCharacter(rawCharacter) {
  if (
    !rawCharacter
    || rawCharacter.format !== CHARACTER_FORMAT
    || rawCharacter.version !== CHARACTER_VERSION
    || !Array.isArray(rawCharacter.objects)
    || !rawCharacter.objects.length
  ) {
    throw new CharacterFileError("This is not a supported Visual Board character file.");
  }
  if (rawCharacter.objects.some((object) => !object || typeof object.id !== "string")) {
    throw new CharacterFileError("The character file contains invalid artwork.");
  }
}

function createIdentifierMap(values, createIdentifier) {
  return new Map([...new Set(values)].map((value) => [value, createIdentifier()]));
}

function normalizeName(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : "Character";
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
