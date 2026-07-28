/**
 * Keeps a declared font size readable while the board is zoomed out. Above
 * 100%, text scales with the rest of the board normally.
 */
export function getTextWorldFontSize(fontSize, zoom = 1) {
  const numericSize = Number(fontSize);
  const normalizedSize = Number.isFinite(numericSize) ? Math.max(1, numericSize) : 18;
  return normalizedSize / getOverviewZoom(zoom);
}

export function getDefaultTextboxSize(fontSize, zoom = 1) {
  const overviewZoom = getOverviewZoom(zoom);
  const worldFontSize = getTextWorldFontSize(fontSize, zoom);
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
