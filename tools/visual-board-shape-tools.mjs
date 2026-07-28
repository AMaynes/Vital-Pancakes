/**
 * Pure shape-tool state helpers for the Visual Board split-button controls.
 */

export const SHAPE_TOOL_OPTIONS = Object.freeze({
  "2d": Object.freeze([
    "rectangle",
    "ellipse",
    "shape:triangle",
    "shape:diamond",
    "shape:hexagon",
  ]),
  "3d": Object.freeze([
    "shape:cube",
    "shape:pyramid",
    "shape:triangular-prism",
    "shape:cylinder",
    "shape:cone",
  ]),
});

/**
 * Identifies which split button owns a shape tool.
 *
 * @param {string} tool Tool identifier.
 * @returns {"2d"|"3d"|null} Owning picker family.
 */
export function getShapeToolFamily(tool) {
  if (SHAPE_TOOL_OPTIONS["2d"].includes(tool)) return "2d";
  if (SHAPE_TOOL_OPTIONS["3d"].includes(tool)) return "3d";
  return null;
}

/**
 * Retains each picker's most recent choice while other tools are used.
 *
 * @param {{2d: string, 3d: string}} choices Existing picker choices.
 * @param {string} nextTool Newly activated tool.
 * @returns {{2d: string, 3d: string}} Updated isolated choices.
 */
export function retainShapeToolChoice(choices, nextTool) {
  const family = getShapeToolFamily(nextTool);
  if (!family) return { ...choices };
  return { ...choices, [family]: nextTool };
}
