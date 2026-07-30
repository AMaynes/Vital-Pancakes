/**
 * User-owned floor-plan template metadata and portable vector contents.
 *
 * Templates intentionally reuse the Visual Board character format so every
 * stored object remains editable and relationship identifiers can be remapped
 * safely when inserted. Raster assets are excluded; image-backed assemblies
 * belong in the general Board Library.
 */

import {
  CHARACTER_FORMAT,
  CHARACTER_VERSION,
} from "./visual-board-character.mjs";

export const FLOOR_PLAN_TEMPLATE_LIBRARY_VERSION = 1;
export const MAX_CUSTOM_FLOOR_PLAN_TEMPLATES = 100;
export const MAX_FLOOR_PLAN_TEMPLATE_OBJECTS = 500;

export function createEmptyFloorPlanTemplateLibrary() {
  return {
    version: FLOOR_PLAN_TEMPLATE_LIBRARY_VERSION,
    items: [],
    hiddenBuiltIns: [],
  };
}

export function normalizeFloorPlanTemplateLibrary(rawLibrary, builtInIds = []) {
  if (!rawLibrary || typeof rawLibrary !== "object") {
    return createEmptyFloorPlanTemplateLibrary();
  }

  const builtIns = new Set(normalizeBuiltInIds(builtInIds));
  const seenIds = new Set();
  const replacedBuiltIns = new Set();
  const items = (Array.isArray(rawLibrary.items) ? rawLibrary.items : [])
    .map((item) => normalizeTemplateRecord(item, builtIns))
    .filter((item) => {
      if (!item || seenIds.has(item.id)) return false;
      if (item.replacesBuiltIn && replacedBuiltIns.has(item.replacesBuiltIn)) return false;
      seenIds.add(item.id);
      if (item.replacesBuiltIn) replacedBuiltIns.add(item.replacesBuiltIn);
      return true;
    })
    .slice(0, MAX_CUSTOM_FLOOR_PLAN_TEMPLATES);

  const hiddenBuiltIns = [...new Set(
    (Array.isArray(rawLibrary.hiddenBuiltIns) ? rawLibrary.hiddenBuiltIns : [])
      .map(normalizeIdentifier)
      .filter((id) => builtIns.has(id)),
  )];

  return {
    version: FLOOR_PLAN_TEMPLATE_LIBRARY_VERSION,
    items,
    hiddenBuiltIns,
  };
}

export function createFloorPlanTemplateRecord(character, options = {}) {
  const id = normalizeIdentifier(options.id);
  if (!id) throw new TypeError("A floor-plan template needs an identifier.");

  const normalizedCharacter = normalizeTemplateCharacter(character);
  const createdAt = normalizeTimestamp(options.createdAt, Date.now());
  return {
    id,
    name: normalizeName(options.name ?? normalizedCharacter.name),
    description: normalizeDescription(options.description),
    category: normalizeCategory(options.category),
    createdAt,
    updatedAt: normalizeTimestamp(options.updatedAt, createdAt),
    replacesBuiltIn: normalizeIdentifier(options.replacesBuiltIn) || null,
    character: normalizedCharacter,
  };
}

export function addFloorPlanTemplate(library, record, builtInIds = []) {
  const normalizedLibrary = normalizeFloorPlanTemplateLibrary(library, builtInIds);
  const builtIns = new Set(normalizeBuiltInIds(builtInIds));
  const normalizedRecord = normalizeTemplateRecord(record, builtIns);
  if (!normalizedRecord) throw new TypeError("The floor-plan template is invalid.");
  if (normalizedRecord.replacesBuiltIn) {
    throw new TypeError("Use replaceFloorPlanTemplate to customize a built-in template.");
  }

  return {
    ...normalizedLibrary,
    items: [
      normalizedRecord,
      ...normalizedLibrary.items.filter((item) => item.id !== normalizedRecord.id),
    ].slice(0, MAX_CUSTOM_FLOOR_PLAN_TEMPLATES),
  };
}

export function updateFloorPlanTemplate(
  library,
  templateId,
  changes,
  builtInIds = [],
  updatedAt = Date.now(),
) {
  const normalizedLibrary = normalizeFloorPlanTemplateLibrary(library, builtInIds);
  const itemIndex = findTemplateRecordIndex(normalizedLibrary.items, templateId);
  if (itemIndex < 0) throw new TypeError("Only saved or customized templates can be edited.");

  const current = normalizedLibrary.items[itemIndex];
  const next = {
    ...current,
    name: changes?.name === undefined ? current.name : normalizeName(changes.name),
    description: changes?.description === undefined
      ? current.description
      : normalizeDescription(changes.description),
    category: changes?.category === undefined
      ? current.category
      : normalizeCategory(changes.category),
    updatedAt: normalizeTimestamp(updatedAt, Date.now()),
  };
  const items = [...normalizedLibrary.items];
  items[itemIndex] = next;
  return { ...normalizedLibrary, items };
}

export function replaceFloorPlanTemplate(
  library,
  templateId,
  character,
  options = {},
  builtInIds = [],
) {
  const normalizedLibrary = normalizeFloorPlanTemplateLibrary(library, builtInIds);
  const builtIns = new Set(normalizeBuiltInIds(builtInIds));
  const id = normalizeIdentifier(templateId);
  const normalizedCharacter = normalizeTemplateCharacter(character);
  const updatedAt = normalizeTimestamp(options.updatedAt, Date.now());

  if (builtIns.has(id)) {
    const existingIndex = normalizedLibrary.items.findIndex(
      (item) => item.replacesBuiltIn === id,
    );
    const existing = normalizedLibrary.items[existingIndex];
    const replacement = createFloorPlanTemplateRecord(normalizedCharacter, {
      id: existing?.id || normalizeIdentifier(options.id),
      name: options.name ?? existing?.name ?? formatBuiltInName(id),
      description: options.description ?? existing?.description ?? "",
      category: options.category ?? existing?.category,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
      replacesBuiltIn: id,
    });
    const items = normalizedLibrary.items.filter((item) => item.replacesBuiltIn !== id);
    items.unshift(replacement);
    return {
      ...normalizedLibrary,
      items: items.slice(0, MAX_CUSTOM_FLOOR_PLAN_TEMPLATES),
      hiddenBuiltIns: normalizedLibrary.hiddenBuiltIns.filter((candidate) => candidate !== id),
    };
  }

  const itemIndex = findTemplateRecordIndex(normalizedLibrary.items, id);
  if (itemIndex < 0) throw new TypeError("The floor-plan template does not exist.");
  const current = normalizedLibrary.items[itemIndex];
  const items = [...normalizedLibrary.items];
  items[itemIndex] = {
    ...current,
    name: options.name === undefined ? current.name : normalizeName(options.name),
    description: options.description === undefined
      ? current.description
      : normalizeDescription(options.description),
    category: options.category === undefined
      ? current.category
      : normalizeCategory(options.category),
    updatedAt,
    character: normalizedCharacter,
  };
  return { ...normalizedLibrary, items };
}

export function removeFloorPlanTemplate(library, templateId, builtInIds = []) {
  const normalizedLibrary = normalizeFloorPlanTemplateLibrary(library, builtInIds);
  const builtIns = new Set(normalizeBuiltInIds(builtInIds));
  const id = normalizeIdentifier(templateId);
  if (builtIns.has(id)) {
    return {
      ...normalizedLibrary,
      items: normalizedLibrary.items.filter((item) => item.replacesBuiltIn !== id),
      hiddenBuiltIns: [...new Set([...normalizedLibrary.hiddenBuiltIns, id])],
    };
  }
  return {
    ...normalizedLibrary,
    items: normalizedLibrary.items.filter((item) => item.id !== id),
  };
}

export function restoreBuiltInFloorPlanTemplate(library, templateId, builtInIds = []) {
  const normalizedLibrary = normalizeFloorPlanTemplateLibrary(library, builtInIds);
  const builtIns = new Set(normalizeBuiltInIds(builtInIds));
  const id = normalizeIdentifier(templateId);
  if (!builtIns.has(id)) throw new TypeError("Only built-in templates can be restored.");
  return {
    ...normalizedLibrary,
    items: normalizedLibrary.items.filter((item) => item.replacesBuiltIn !== id),
    hiddenBuiltIns: normalizedLibrary.hiddenBuiltIns.filter((candidate) => candidate !== id),
  };
}

export function getFloorPlanTemplateCatalog(library, builtInIds = []) {
  const normalizedLibrary = normalizeFloorPlanTemplateLibrary(library, builtInIds);
  const hidden = new Set(normalizedLibrary.hiddenBuiltIns);
  const builtIns = normalizeBuiltInIds(builtInIds).map((id) => {
    const replacement = normalizedLibrary.items.find((item) => item.replacesBuiltIn === id);
    return {
      id,
      name: replacement?.name ?? formatBuiltInName(id),
      description: replacement?.description ?? "",
      category: replacement?.category ?? null,
      source: replacement ? "override" : "built-in",
      visible: !hidden.has(id),
      editable: Boolean(replacement),
      objectCount: replacement?.character.objects.length ?? null,
      updatedAt: replacement?.updatedAt ?? null,
    };
  });
  const custom = normalizedLibrary.items
    .filter((item) => !item.replacesBuiltIn)
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      source: "custom",
      visible: true,
      editable: true,
      objectCount: item.character.objects.length,
      updatedAt: item.updatedAt,
    }));
  return [...builtIns, ...custom];
}

export function getFloorPlanTemplateRecord(library, templateId, builtInIds = []) {
  const normalizedLibrary = normalizeFloorPlanTemplateLibrary(library, builtInIds);
  const id = normalizeIdentifier(templateId);
  return normalizedLibrary.items.find((item) => (
    item.id === id || item.replacesBuiltIn === id
  )) ?? null;
}

function normalizeTemplateRecord(rawRecord, builtIns) {
  if (!rawRecord || typeof rawRecord !== "object") return null;
  try {
    const record = createFloorPlanTemplateRecord(rawRecord.character, rawRecord);
    if (record.replacesBuiltIn && !builtIns.has(record.replacesBuiltIn)) return null;
    return record;
  } catch {
    return null;
  }
}

function normalizeTemplateCharacter(rawCharacter) {
  if (
    !rawCharacter
    || rawCharacter.format !== CHARACTER_FORMAT
    || rawCharacter.version !== CHARACTER_VERSION
    || !Array.isArray(rawCharacter.objects)
    || !rawCharacter.objects.length
    || rawCharacter.objects.length > MAX_FLOOR_PLAN_TEMPLATE_OBJECTS
  ) {
    throw new TypeError("A floor-plan template needs a valid editable object package.");
  }
  if (
    rawCharacter.objects.some((object) => (
      !object
      || typeof object.id !== "string"
      || object.type === "image"
      || Boolean(object.assetId)
    ))
    || Object.keys(rawCharacter.assets ?? {}).length
  ) {
    throw new TypeError("Floor-plan templates cannot contain image assets.");
  }

  const character = cloneValue(rawCharacter);
  character.name = normalizeName(character.name);
  character.assets = {};
  character.rig = {
    bodies: Array.isArray(character.rig?.bodies) ? character.rig.bodies : [],
    joints: Array.isArray(character.rig?.joints) ? character.rig.joints : [],
  };
  return character;
}

function findTemplateRecordIndex(items, templateId) {
  const id = normalizeIdentifier(templateId);
  return items.findIndex((item) => item.id === id || item.replacesBuiltIn === id);
}

function normalizeBuiltInIds(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeIdentifier)
      .filter(Boolean),
  )];
}

function normalizeIdentifier(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id) ? id : "";
}

function normalizeName(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 80)
    : "Floor-plan template";
}

function normalizeDescription(value) {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

function normalizeCategory(value) {
  return ["structures", "furniture", "rooms", "tools"].includes(value)
    ? value
    : null;
}

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : fallback;
}

function formatBuiltInName(value) {
  return String(value)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
