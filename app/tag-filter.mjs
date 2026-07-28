/**
 * Normalizes editable entry tags into unique lowercase labels.
 *
 * @param {unknown} tags Candidate tags.
 * @returns {Array<string>} Safe tag labels.
 */
export function normalizeEntryTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(
    tags
      .filter((tag) => typeof tag === "string")
      .map((tag) => String(tag).trim().toLocaleLowerCase())
      .filter(Boolean),
  )];
}

/**
 * Returns all tags used by a collection, ordered by label.
 *
 * @param {Array<object>} items Tagged entries.
 * @returns {Array<{tag: string, count: number}>} Available filter choices.
 */
export function collectEntryTags(items) {
  const counts = new Map();
  items.forEach((item) => {
    normalizeEntryTags(item.tags).forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
}

/**
 * Filters entries inclusively: an item remains visible when it matches any
 * selected tag. With no selected tags the complete collection is returned.
 *
 * @param {Array<object>} items Tagged entries.
 * @param {Iterable<string>} selectedTags Active filter labels.
 * @returns {Array<object>} Matching entries.
 */
export function filterItemsByTags(items, selectedTags) {
  const selected = new Set(normalizeEntryTags([...selectedTags]));
  if (!selected.size) return items;
  return items.filter((item) => (
    normalizeEntryTags(item.tags).some((tag) => selected.has(tag))
  ));
}
