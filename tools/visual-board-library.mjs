/**
 * Persistent reusable Visual Board assets built from portable character
 * packages so groups, vertices, joints, locks, and embedded images stay intact.
 */

import {
  CHARACTER_FORMAT,
  CHARACTER_VERSION,
} from "./visual-board-character.mjs?v=3";
import { getObjectGroupIds } from "./visual-board-groups.mjs?v=4";

export const VISUAL_BOARD_LIBRARY_VERSION = 1;
export const MAX_VISUAL_BOARD_LIBRARY_ITEMS = 100;

export function createEmptyVisualBoardLibrary() {
  return {
    version: VISUAL_BOARD_LIBRARY_VERSION,
    items: [],
  };
}

export function normalizeVisualBoardLibrary(rawLibrary) {
  if (!rawLibrary || typeof rawLibrary !== "object") return createEmptyVisualBoardLibrary();

  const seenIds = new Set();
  const items = (Array.isArray(rawLibrary.items) ? rawLibrary.items : [])
    .map(normalizeLibraryItem)
    .filter((item) => {
      if (!item || seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    })
    .slice(0, MAX_VISUAL_BOARD_LIBRARY_ITEMS);

  return {
    version: VISUAL_BOARD_LIBRARY_VERSION,
    items,
  };
}

export function createVisualBoardLibraryItem(character, options = {}) {
  const id = normalizeIdentifier(options.id);
  if (!id) throw new TypeError("A library item needs an identifier.");

  const name = normalizeLibraryName(options.name ?? character?.name);
  const normalizedCharacter = normalizeCharacter(character, name);
  if (!normalizedCharacter) {
    throw new TypeError("A library item needs a valid Visual Board character package.");
  }

  const createdAt = normalizeTimestamp(options.createdAt, Date.now());
  return {
    id,
    name,
    createdAt,
    updatedAt: normalizeTimestamp(options.updatedAt, createdAt),
    character: normalizedCharacter,
  };
}

export function addVisualBoardLibraryItem(library, item) {
  const normalizedLibrary = normalizeVisualBoardLibrary(library);
  const normalizedItem = normalizeLibraryItem(item);
  if (!normalizedItem) throw new TypeError("The library item is invalid.");

  return {
    version: VISUAL_BOARD_LIBRARY_VERSION,
    items: [
      normalizedItem,
      ...normalizedLibrary.items.filter((candidate) => candidate.id !== normalizedItem.id),
    ].slice(0, MAX_VISUAL_BOARD_LIBRARY_ITEMS),
  };
}

export function removeVisualBoardLibraryItem(library, itemId) {
  const normalizedLibrary = normalizeVisualBoardLibrary(library);
  return {
    version: VISUAL_BOARD_LIBRARY_VERSION,
    items: normalizedLibrary.items.filter((item) => item.id !== itemId),
  };
}

export function filterVisualBoardLibraryItems(items, query) {
  const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!normalizedQuery) return [...items];

  return items.filter((item) => {
    const objectTypes = item.character.objects
      .map((object) => object.shapeKind || object.type)
      .join(" ");
    return `${item.name} ${objectTypes}`.toLowerCase().includes(normalizedQuery);
  });
}

export function getVisualBoardLibraryItemSummary(item) {
  const objects = item?.character?.objects ?? [];
  const bodies = item?.character?.rig?.bodies ?? [];
  const joints = item?.character?.rig?.joints ?? [];
  return {
    objectCount: objects.length,
    groupCount: new Set(objects.flatMap(getObjectGroupIds)).size,
    jointCount: joints.length,
    lockCount: objects.filter((object) => object.locked).length
      + bodies.filter((body) => body.dimensionsLocked).length,
  };
}

function normalizeLibraryItem(rawItem) {
  if (!rawItem || typeof rawItem !== "object") return null;
  const id = normalizeIdentifier(rawItem.id);
  if (!id) return null;
  const name = normalizeLibraryName(rawItem.name ?? rawItem.character?.name);
  const character = normalizeCharacter(rawItem.character, name);
  if (!character) return null;
  const createdAt = normalizeTimestamp(rawItem.createdAt, Date.now());
  return {
    id,
    name,
    createdAt,
    updatedAt: normalizeTimestamp(rawItem.updatedAt, createdAt),
    character,
  };
}

function normalizeCharacter(rawCharacter, name) {
  if (
    !rawCharacter
    || rawCharacter.format !== CHARACTER_FORMAT
    || rawCharacter.version !== CHARACTER_VERSION
    || !Array.isArray(rawCharacter.objects)
    || !rawCharacter.objects.length
  ) {
    return null;
  }
  const character = cloneValue(rawCharacter);
  character.name = name;
  character.assets = character.assets && typeof character.assets === "object"
    ? character.assets
    : {};
  character.rig = {
    bodies: Array.isArray(character.rig?.bodies) ? character.rig.bodies : [],
    joints: Array.isArray(character.rig?.joints) ? character.rig.joints : [],
  };
  return character;
}

function normalizeLibraryName(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 80)
    : "Board asset";
}

function normalizeIdentifier(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : "";
}

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : fallback;
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
