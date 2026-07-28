/**
 * Overview & Purpose
 * Keeps collection view preferences and deep-link construction independent
 * from the workspace DOM renderer.
 *
 * Architectural Relationships
 * Called by: app/main.js and app/content-view.test.mjs.
 * Calls: no browser-only APIs.
 */

export const CONTENT_VIEWS = Object.freeze({
  LIST: "list",
  GRID: "grid",
});

/**
 * Returns a supported collection view, falling back to list view.
 *
 * @param {unknown} value Candidate preference.
 * @returns {"list"|"grid"} Supported view.
 */
export function normalizeContentView(value) {
  return value === CONTENT_VIEWS.GRID ? CONTENT_VIEWS.GRID : CONTENT_VIEWS.LIST;
}

/**
 * Creates the per-collection persistence key.
 *
 * @param {string} sectionId Collection identifier.
 * @returns {string} Local-storage key.
 */
export function getContentViewStorageKey(sectionId) {
  return `vital-pancakes:content-view:${encodeURIComponent(String(sectionId))}`;
}

/**
 * Creates a stable workspace hash for a collection or one of its entries.
 *
 * @param {string} sectionId Collection identifier.
 * @param {string|null} itemId Optional entry identifier.
 * @returns {string} Encoded route hash.
 */
export function buildContentHash(sectionId, itemId = null) {
  const parameters = new URLSearchParams({ section: String(sectionId) });
  if (itemId) parameters.set("item", String(itemId));
  return `#${parameters.toString()}`;
}
