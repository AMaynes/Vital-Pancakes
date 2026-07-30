/**
 * Resolves a declared font size into world units.
 *
 * Document text defaults to world scaling so zoom never changes wrapping or
 * object layout. Screen scaling remains available only for explicit overlay
 * annotations.
 */
export function getTextWorldFontSize(fontSize, zoom = 1, scaleMode = "world") {
  const numericSize = Number(fontSize);
  const normalizedSize = Number.isFinite(numericSize) ? Math.max(1, numericSize) : 18;
  return scaleMode === "screen"
    ? normalizedSize / getOverviewZoom(zoom)
    : normalizedSize;
}

export function getDefaultTextboxSize(fontSize, zoom = 1, scaleMode = "world") {
  const overviewZoom = scaleMode === "screen" ? getOverviewZoom(zoom) : 1;
  const worldFontSize = getTextWorldFontSize(fontSize, zoom, scaleMode);
  return {
    width: Math.ceil(Math.max(210 / overviewZoom, worldFontSize * 11)),
    height: Math.ceil(Math.max(72 / overviewZoom, worldFontSize * 1.5 + 12)),
  };
}

function getOverviewZoom(zoom) {
  const numericZoom = Number(zoom);
  return Number.isFinite(numericZoom) && numericZoom > 0
    ? Math.min(1, numericZoom)
    : 1;
}
