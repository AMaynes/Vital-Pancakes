/**
 * Overview & Purpose
 * Defines stable Canvas 2D dash patterns for Visual Board ink.
 *
 * Architectural Relationships
 * Called by: visual-board.js before drawing every stroked object.
 * Calls: no application modules.
 *
 * Notes
 * Dots use a short, finite ink segment instead of an effectively zero-length
 * dash. Rounded line caps turn that segment into a visible dot without relying
 * on browser-specific handling of zero-length dashes.
 */

function normalizeStrokeWidth(strokeWidth) {
  const numericWidth = Number(strokeWidth);
  return Number.isFinite(numericWidth) ? Math.max(1, numericWidth) : 1;
}

function getDotInkLength(strokeWidth) {
  return Math.max(0.5, strokeWidth * 0.12);
}

export function getStrokeDashArray(pattern = "solid", strokeWidth = 1) {
  const unit = normalizeStrokeWidth(strokeWidth);
  const dotInkLength = getDotInkLength(unit);

  if (pattern === "dashed") return [unit * 5, unit * 3.2];
  if (pattern === "dotted") return [dotInkLength, unit * 2.8];
  if (pattern === "dash-dot") {
    return [unit * 6, unit * 2.6, dotInkLength, unit * 2.6];
  }
  if (pattern === "long-dash") return [unit * 9, unit * 3.5];
  return [];
}
