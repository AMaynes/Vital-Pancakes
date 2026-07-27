/**
 * Overview & Purpose
 * Provides pure placement-list operations for the PDF Signer.
 *
 * Architectural Relationships
 * Called by: pdf-signer.js and its adjacent test suite.
 * Calls: No browser or external APIs.
 *
 * Notes
 * Operations return new arrays so interaction code never mutates a list while
 * rendering or exporting it.
 */

/**
 * Removes one signature, date, or future placed field by identifier.
 *
 * @param {Array<object>} placements Current PDF field placements.
 * @param {string | null | undefined} placementId Identifier to remove.
 * @returns {{placements: Array<object>, removed: object | null}} Updated list
 * and the removed field when one was found.
 */
export function removePlacementById(placements, placementId) {
  const removed = placements.find((placement) => placement.id === placementId) ?? null;
  if (!removed) {
    return {
      placements: [...placements],
      removed: null,
    };
  }
  return {
    placements: placements.filter((placement) => placement.id !== placementId),
    removed,
  };
}
