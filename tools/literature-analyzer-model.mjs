/**
 * Overview & Purpose
 * Provides the pure geometry and stored-data validation used by the Literature
 * Analyzer without depending on browser rendering APIs.
 *
 * Architectural Relationships
 * Called by: literature-analyzer.js and its Node test suite.
 * Calls: None.
 *
 * External Resources
 * None.
 *
 * Notes
 * Highlight coordinates are normalized to the visible source surface. PDF
 * conversion flips the vertical axis because PDF pages use a bottom-left origin.
 */

export const DEFAULT_HIGHLIGHT_COLOR = "#f6d84a";
export const MAX_COMMENT_LENGTH = 4000;

/**
 * Converts a pointer drag into a normalized, clamped highlight rectangle.
 *
 * @param {{x: number, y: number}} start Pointer-down client coordinates.
 * @param {{x: number, y: number}} end Pointer-up client coordinates.
 * @param {{left: number, top: number, width: number, height: number}} surface Visible source bounds.
 * @param {number} minimumSizePx Smallest accepted width and height.
 * @returns {{x: number, y: number, width: number, height: number}|null} Normalized rectangle.
 */
export function normalizeHighlight(start, end, surface, minimumSizePx = 6) {
  if (!surface || surface.width <= 0 || surface.height <= 0) return null;
  const startX = clamp(start.x - surface.left, 0, surface.width);
  const startY = clamp(start.y - surface.top, 0, surface.height);
  const endX = clamp(end.x - surface.left, 0, surface.width);
  const endY = clamp(end.y - surface.top, 0, surface.height);
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  if (width < minimumSizePx || height < minimumSizePx) return null;

  return {
    x: left / surface.width,
    y: top / surface.height,
    width: width / surface.width,
    height: height / surface.height,
  };
}

/**
 * Converts a normalized top-left rectangle to PDF page coordinates.
 *
 * @param {{x: number, y: number, width: number, height: number}} annotation Highlight geometry.
 * @param {number} pageWidth PDF page width.
 * @param {number} pageHeight PDF page height.
 * @returns {{x: number, y: number, width: number, height: number}} PDF rectangle.
 */
export function getPdfHighlightBounds(annotation, pageWidth, pageHeight) {
  return {
    x: annotation.x * pageWidth,
    y: pageHeight - ((annotation.y + annotation.height) * pageHeight),
    width: annotation.width * pageWidth,
    height: annotation.height * pageHeight,
  };
}

/**
 * Validates untrusted annotations restored from browser storage.
 *
 * @param {unknown} value Stored value.
 * @returns {Array<object>} Safe normalized annotations.
 */
export function sanitizeAnnotations(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((annotation) => {
    if (!annotation || typeof annotation !== "object") return [];
    const x = finiteNumber(annotation.x);
    const y = finiteNumber(annotation.y);
    const width = finiteNumber(annotation.width);
    const height = finiteNumber(annotation.height);
    const pageNumber = Number(annotation.pageNumber);
    if (
      !annotation.id
      || x === null
      || y === null
      || width === null
      || height === null
      || !Number.isInteger(pageNumber)
      || pageNumber < 1
      || width <= 0
      || height <= 0
      || x < 0
      || y < 0
      || x + width > 1.000001
      || y + height > 1.000001
    ) {
      return [];
    }

    const color = /^#[0-9a-f]{6}$/i.test(String(annotation.color ?? ""))
      ? String(annotation.color).toLowerCase()
      : DEFAULT_HIGHLIGHT_COLOR;
    return [{
      id: String(annotation.id),
      pageNumber,
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      width: clamp(width, 0, 1),
      height: clamp(height, 0, 1),
      color,
      comment: String(annotation.comment ?? "").slice(0, MAX_COMMENT_LENGTH),
      createdAt: String(annotation.createdAt ?? ""),
    }];
  });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
