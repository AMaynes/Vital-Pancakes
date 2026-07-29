/**
 * Creates and restores Visual Board history entries without retaining mutable
 * references to the live board or its current selection.
 */

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

/**
 * Captures board content together with the selected object identifiers.
 *
 * @param {Array<object>} objects Current board objects.
 * @param {Array<object>} selectedObjects Current selected object references.
 * @param {object} rig Current rigid-body joints and dimension locks.
 * @param {{settings?: object, view?: object}} extras Optional board context.
 * @returns {{objects: Array<object>, selectedIds: Array<string>, rig: object, settings?: object, view?: object}}
 */
export function createBoardHistoryEntry(objects, selectedObjects, rig = null, extras = {}) {
  return {
    objects: cloneValue(objects),
    selectedIds: selectedObjects
      .map((object) => object?.id)
      .filter((id) => typeof id === "string" && id.length > 0),
    rig: cloneValue(rig),
    ...(extras.settings ? { settings: cloneValue(extras.settings) } : {}),
    ...(extras.view ? { view: cloneValue(extras.view) } : {}),
  };
}

/**
 * Restores cloned objects and reconnects the selection to those new instances.
 * Missing selected objects are omitted, such as when undo removes a new item.
 *
 * @param {{objects?: Array<object>, selectedIds?: Array<string>}} entry History entry.
 * @param {(object: object) => object | null} normalizeObject Object migration callback.
 * @returns {{objects: Array<object>, selectedObjects: Array<object>, rig: object, settings?: object, view?: object}}
 */
export function restoreBoardHistoryEntry(entry, normalizeObject = (object) => object) {
  const objects = (Array.isArray(entry?.objects) ? cloneValue(entry.objects) : [])
    .map(normalizeObject)
    .filter(Boolean);
  const objectsById = new Map(objects.map((object) => [object.id, object]));
  const selectedObjects = (Array.isArray(entry?.selectedIds) ? entry.selectedIds : [])
    .map((id) => objectsById.get(id))
    .filter(Boolean);

  return {
    objects,
    selectedObjects,
    rig: cloneValue(entry?.rig),
    ...(entry?.settings ? { settings: cloneValue(entry.settings) } : {}),
    ...(entry?.view ? { view: cloneValue(entry.view) } : {}),
  };
}
