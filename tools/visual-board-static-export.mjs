/**
 * Deterministic, DOM-free SVG serialization for Visual Board documents.
 *
 * The exporter consumes persisted board objects and bundled architectural
 * catalogs only. It performs no layout decisions and never mutates its input.
 */

import {
  ARCHITECTURE_FILL_PATTERNS,
  fitArchitectureSymbolFrame,
  getArchitectureMaterial,
  getArchitectureSymbol,
  normalizeArchitectureSettings,
  resolveMaterialStyle,
  sortArchitectureObjects,
} from "./visual-board-architecture.mjs?v=2";
import {
  getCurveBezierSegments,
  getQuadraticControlPoint,
} from "./visual-board-curves.mjs?v=2";
import {
  getObjectBounds,
  getObjectSegments,
  getShapeCenter,
} from "./visual-board-geometry.mjs?v=10";
import { normalizeImageCrop } from "./visual-board-image.mjs?v=1";
import { getTextColorSegments } from "./visual-board-rich-text.mjs?v=1";
import { getStrokeDashArray } from "./visual-board-strokes.mjs?v=1";
import { getTextWorldFontSize } from "./visual-board-text.mjs?v=2";
import {
  formatFloorPlanDimension,
  isFloorPlanObjectVisible,
} from "./visual-board-floor-plan.mjs?v=5";

const DEFAULT_EXPORT_PADDING = 24;
const DEFAULT_STROKE_COLOR = "#000000";
const DEFAULT_SYMBOL_FILL = "#eadfca";
const SAFE_RASTER_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i;
const TEXT_FONT_FAMILIES = Object.freeze({
  serif: 'Georgia, "Times New Roman", serif',
  sans: "Arial, Helvetica, sans-serif",
  mono: '"Courier New", Courier, monospace',
  typewriter: '"American Typewriter", "Courier New", serif',
  handwriting: '"Bradley Hand", "Segoe Print", cursive',
});

/**
 * Serializes a Visual Board document into a standalone SVG string.
 *
 * `viewBounds`, when supplied, is the exact exported world-space viewport.
 * Otherwise the exporter derives content bounds and applies `padding`.
 */
export function exportVisualBoardToSvg(board, options = {}) {
  assertBoard(board);
  const precision = normalizePrecision(options.precision);
  const objects = getExportObjects(board, options.includeHiddenLayers === true);
  const viewBounds = options.viewBounds
    ? normalizeViewBounds(options.viewBounds)
    : getVisualBoardExportBounds(board, options);
  const width = positiveNumber(options.width, viewBounds.width);
  const height = positiveNumber(options.height, viewBounds.height);
  const definitions = createDefinitionRegistry(precision);
  const renderContext = {
    board,
    definitions,
    precision,
    screenZoom: positiveNumber(options.screenZoom, 1),
  };
  const renderedObjects = objects
    .map((object, index) => renderObject(object, index, renderContext))
    .filter(Boolean)
    .join("");
  const title = typeof options.title === "string" && options.title.trim()
    ? `<title>${escapeXml(options.title.trim())}</title>`
    : "";
  const background = renderBackground(viewBounds, options.backgroundColor, precision);
  const definitionMarkup = definitions.toMarkup();

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` width="${number(width, precision)}"`,
    ` height="${number(height, precision)}"`,
    ` viewBox="${[
      viewBounds.x,
      viewBounds.y,
      viewBounds.width,
      viewBounds.height,
    ].map((value) => number(value, precision)).join(" ")}"`,
    ` shape-rendering="geometricPrecision"`,
    ` overflow="hidden">`,
    title,
    definitionMarkup,
    background,
    renderedObjects,
    `</svg>`,
  ].join("");
}

/**
 * Returns the padded world-space bounds used when no explicit viewport is
 * supplied. Hidden architectural layers are excluded by default.
 */
export function getVisualBoardExportBounds(board, options = {}) {
  assertBoard(board);
  const objects = getExportObjects(board, options.includeHiddenLayers === true);
  const padding = Math.max(0, finiteNumber(options.padding, DEFAULT_EXPORT_PADDING));
  const bounds = objects
    .map(getExportObjectBounds)
    .filter((value) => value.width > 0 && value.height > 0);

  if (!bounds.length) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const left = Math.min(...bounds.map((value) => value.x));
  const top = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return {
    x: left - padding,
    y: top - padding,
    width: Math.max(1, right - left + padding * 2),
    height: Math.max(1, bottom - top + padding * 2),
  };
}

function getExportObjects(board, includeHiddenLayers) {
  const architecture = normalizeArchitectureSettings(board.settings?.architecture);
  const layerSettings = includeHiddenLayers
    ? {
      layers: architecture.layers.map((layer) => ({ ...layer, visible: true })),
    }
    : architecture;
  return sortArchitectureObjects(board.objects, layerSettings)
    .filter((object) => isFloorPlanObjectVisible(
      object,
      board.objects,
      board.settings?.floorPlan,
    ))
    .filter((object) => object.hiddenInExport !== true);
}

function getExportObjectBounds(object) {
  let bounds;
  if (object.type === "dimension") {
    bounds = getDimensionBounds(object);
  } else if (object.type === "connector" || object.type === "shape") {
    bounds = boundsFromSegments(getObjectSegments(object));
  } else {
    bounds = getObjectBounds(object);
  }
  const strokePadding = Math.max(0, finiteNumber(object.strokeWidth, 1)) / 2;
  const shadow = object.shadow && typeof object.shadow === "object"
    ? object.shadow
    : null;
  const shadowBlur = shadow ? Math.max(0, finiteNumber(shadow.blur, 0)) : 0;
  const shadowOffsetX = shadow ? finiteNumber(shadow.offsetX, 0) : 0;
  const shadowOffsetY = shadow ? finiteNumber(shadow.offsetY, 0) : 0;
  const leftExpansion = strokePadding + shadowBlur + Math.max(0, -shadowOffsetX);
  const rightExpansion = strokePadding + shadowBlur + Math.max(0, shadowOffsetX);
  const topExpansion = strokePadding + shadowBlur + Math.max(0, -shadowOffsetY);
  const bottomExpansion = strokePadding + shadowBlur + Math.max(0, shadowOffsetY);
  return {
    x: bounds.x - leftExpansion,
    y: bounds.y - topExpansion,
    width: Math.max(1, bounds.width + leftExpansion + rightExpansion),
    height: Math.max(1, bounds.height + topExpansion + bottomExpansion),
  };
}

function getDimensionBounds(object) {
  const layout = getDimensionLayout(object);
  const fontSize = Math.max(1, finiteNumber(object.fontSize, 12));
  const tickSize = Math.max(6, fontSize * 0.55);
  const labelWidth = estimateTextWidth(
    object.label || "000.00 ft",
    fontSize,
    TEXT_FONT_FAMILIES.sans,
  ) + 8;
  const points = [
    { x: object.x, y: object.y },
    { x: object.endX, y: object.endY },
    layout.start,
    layout.end,
    {
      x: layout.start.x - layout.normal.x * tickSize,
      y: layout.start.y - layout.normal.y * tickSize,
    },
    {
      x: layout.start.x + layout.normal.x * tickSize,
      y: layout.start.y + layout.normal.y * tickSize,
    },
    {
      x: layout.end.x - layout.normal.x * tickSize,
      y: layout.end.y - layout.normal.y * tickSize,
    },
    {
      x: layout.end.x + layout.normal.x * tickSize,
      y: layout.end.y + layout.normal.y * tickSize,
    },
    {
      x: layout.center.x - labelWidth / 2,
      y: layout.center.y - fontSize * 0.7,
    },
    {
      x: layout.center.x + labelWidth / 2,
      y: layout.center.y + fontSize * 0.7,
    },
  ];
  return boundsFromPoints(points);
}

function boundsFromSegments(segments) {
  return boundsFromPoints(segments.flatMap((segment) => segment));
}

function boundsFromPoints(points) {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xValues = points.map((point) => finiteNumber(point.x, 0));
  const yValues = points.map((point) => finiteNumber(point.y, 0));
  const left = Math.min(...xValues);
  const top = Math.min(...yValues);
  return {
    x: left,
    y: top,
    width: Math.max(1, Math.max(...xValues) - left),
    height: Math.max(1, Math.max(...yValues) - top),
  };
}

function renderObject(object, index, context) {
  if (!object || typeof object !== "object") return "";
  let content = "";
  let usesFrameTransform = false;

  if (object.type === "pen") {
    content = renderPen(object, context);
  } else if (object.type === "trace") {
    content = renderTrace(object, context);
  } else if (object.type === "line") {
    content = renderLine(object, context);
  } else if (object.type === "connector") {
    content = renderConnector(object, context);
  } else if (object.type === "arc") {
    content = renderArc(object, context);
  } else if (object.type === "dimension") {
    content = renderDimension(object, context);
  } else if (object.type === "shape") {
    content = renderCompoundShape(object, context);
  } else if (object.type === "rectangle") {
    content = renderRectangle(object, context);
    usesFrameTransform = true;
  } else if (object.type === "ellipse") {
    content = renderEllipse(object, context);
    usesFrameTransform = true;
  } else if (object.type === "area") {
    content = renderArea(object, context);
    usesFrameTransform = true;
  } else if (object.type === "wall") {
    content = renderWall(object, context);
    usesFrameTransform = true;
  } else if (object.type === "symbol") {
    content = renderSymbol(object, context);
    usesFrameTransform = true;
  } else if (object.type === "textbox") {
    content = renderTextbox(object, index, context);
    usesFrameTransform = true;
  } else if (object.type === "image") {
    content = renderImage(object, index, context);
    usesFrameTransform = true;
  }

  if (!content) return "";
  if (object.semantic?.role === "floor-plan-dimension" && object.type === "line") {
    content += renderLegacyDimensionLabel(object, context);
  }
  const attributes = [
    `data-object-type="${escapeXml(String(object.type ?? "unknown"))}"`,
    ...(object.id ? [`data-object-id="${escapeXml(String(object.id))}"`] : []),
    ...(object.layerId ? [`data-layer-id="${escapeXml(String(object.layerId))}"`] : []),
    ...(usesFrameTransform && getFrameTransform(object, context.precision)
      ? [`transform="${getFrameTransform(object, context.precision)}"`]
      : []),
    ...(finiteNumber(object.opacity, 1) < 1
      ? [`opacity="${number(clamp(finiteNumber(object.opacity, 1), 0, 1), context.precision)}"`]
      : []),
    ...(object.shadow
      ? [`filter="url(#${context.definitions.getShadowId(object.shadow)})"`]
      : []),
  ];
  return `<g ${attributes.join(" ")}>${content}</g>`;
}

function renderPen(object, context) {
  const points = Array.isArray(object.points) ? object.points : [];
  if (!points.length) return "";
  const pathPoints = points.length === 1
    ? [points[0], { x: points[0].x + 0.01, y: points[0].y + 0.01 }]
    : points;
  return `<path d="${pathFromPoints(pathPoints, false, context.precision)}" ${strokeAttributes(object, context)} fill="none"/>`;
}

function renderTrace(object, context) {
  const paths = Array.isArray(object.paths) ? object.paths : [];
  const pathMarkup = paths
    .filter((path) => Array.isArray(path) && path.length >= 3)
    .map((path) => pathFromPoints(path, true, context.precision))
    .join(" ");
  if (!pathMarkup) return "";
  return `<path d="${pathMarkup}" fill="${normalizeColor(object.color, DEFAULT_STROKE_COLOR)}" fill-rule="evenodd" stroke="none"/>`;
}

function renderLine(object, context) {
  return `<line x1="${number(object.x, context.precision)}" y1="${number(object.y, context.precision)}" x2="${number(object.endX, context.precision)}" y2="${number(object.endY, context.precision)}" ${strokeAttributes(object, context)} fill="none"/>`;
}

function renderConnector(object, context) {
  const startX = finiteNumber(object.x, 0);
  const startY = finiteNumber(object.y, 0);
  const endX = finiteNumber(object.endX, startX);
  const endY = finiteNumber(object.endY, startY);
  const angle = Math.atan2(endY - startY, endX - startX);
  const arrowSize = Math.max(14, finiteNumber(object.strokeWidth, 1) * 4);
  const arrowPoints = [
    { x: endX, y: endY },
    {
      x: endX - arrowSize * Math.cos(angle - Math.PI / 6),
      y: endY - arrowSize * Math.sin(angle - Math.PI / 6),
    },
    {
      x: endX - arrowSize * Math.cos(angle + Math.PI / 6),
      y: endY - arrowSize * Math.sin(angle + Math.PI / 6),
    },
  ];
  const color = normalizeColor(object.color, DEFAULT_STROKE_COLOR);
  return [
    renderLine(object, context),
    `<polygon points="${pointsAttribute(arrowPoints, context.precision)}" fill="${color}" stroke="none"/>`,
  ].join("");
}

function renderArc(object, context) {
  if (!Array.isArray(object.curvePoints)) {
    const control = getQuadraticControlPoint(object);
    const path = [
      `M ${number(object.x, context.precision)} ${number(object.y, context.precision)}`,
      `Q ${number(control.x, context.precision)} ${number(control.y, context.precision)}`,
      `${number(object.endX, context.precision)} ${number(object.endY, context.precision)}`,
    ].join(" ");
    return `<path d="${path}" ${strokeAttributes(object, context)} fill="none"/>`;
  }
  const segments = getCurveBezierSegments(object);
  if (!segments.length) return "";
  const path = [
    `M ${number(segments[0].start.x, context.precision)} ${number(segments[0].start.y, context.precision)}`,
    ...segments.map((segment) => (
      `C ${number(segment.control1.x, context.precision)} ${number(segment.control1.y, context.precision)} ${number(segment.control2.x, context.precision)} ${number(segment.control2.y, context.precision)} ${number(segment.end.x, context.precision)} ${number(segment.end.y, context.precision)}`
    )),
  ].join(" ");
  return `<path d="${path}" ${strokeAttributes(object, context)} fill="none"/>`;
}

function renderCompoundShape(object, context) {
  const segments = getObjectSegments(object);
  if (!segments.length) return "";
  const path = segments.map(([start, end]) => (
    `M ${number(start.x, context.precision)} ${number(start.y, context.precision)} L ${number(end.x, context.precision)} ${number(end.y, context.precision)}`
  )).join(" ");
  return `<path d="${path}" ${strokeAttributes(object, context)} fill="none"/>`;
}

function renderRectangle(object, context) {
  const paint = getObjectPaint(object, null, context);
  return `<rect x="${number(object.x, context.precision)}" y="${number(object.y, context.precision)}" width="${number(object.w, context.precision)}" height="${number(object.h, context.precision)}" ${paintAttributes(object, paint, context)}/>`;
}

function renderEllipse(object, context) {
  const paint = getObjectPaint(object, null, context);
  return `<ellipse cx="${number(finiteNumber(object.x, 0) + finiteNumber(object.w, 0) / 2, context.precision)}" cy="${number(finiteNumber(object.y, 0) + finiteNumber(object.h, 0) / 2, context.precision)}" rx="${number(Math.abs(finiteNumber(object.w, 0)) / 2, context.precision)}" ry="${number(Math.abs(finiteNumber(object.h, 0)) / 2, context.precision)}" ${paintAttributes(object, paint, context)}/>`;
}

function renderArea(object, context) {
  const vertices = Array.isArray(object.vertices)
    ? object.vertices.map((point) => ({
      x: finiteNumber(object.x, 0) + finiteNumber(point.x, 0) * finiteNumber(object.w, 0),
      y: finiteNumber(object.y, 0) + finiteNumber(point.y, 0) * finiteNumber(object.h, 0),
    }))
    : [];
  if (vertices.length < 3) return "";
  const paint = getObjectPaint(object, object.color, context);
  return `<polygon points="${pointsAttribute(vertices, context.precision)}" ${paintAttributes(object, paint, context)}/>`;
}

function renderWall(object, context) {
  const paint = getObjectPaint(object, object.fillColor ?? object.color, context);
  return `<rect x="${number(object.x, context.precision)}" y="${number(object.y, context.precision)}" width="${number(object.w, context.precision)}" height="${number(object.h, context.precision)}" ${paintAttributes(object, paint, context)}/>`;
}

function renderDimension(object, context) {
  const layout = getDimensionLayout(object);
  const tickSize = Math.max(6, finiteNumber(object.fontSize, 12) * 0.55);
  const path = [
    `M ${number(object.x, context.precision)} ${number(object.y, context.precision)} L ${number(layout.start.x, context.precision)} ${number(layout.start.y, context.precision)}`,
    `M ${number(object.endX, context.precision)} ${number(object.endY, context.precision)} L ${number(layout.end.x, context.precision)} ${number(layout.end.y, context.precision)}`,
    `M ${number(layout.start.x, context.precision)} ${number(layout.start.y, context.precision)} L ${number(layout.end.x, context.precision)} ${number(layout.end.y, context.precision)}`,
    `M ${number(layout.start.x - layout.normal.x * tickSize, context.precision)} ${number(layout.start.y - layout.normal.y * tickSize, context.precision)} L ${number(layout.start.x + layout.normal.x * tickSize, context.precision)} ${number(layout.start.y + layout.normal.y * tickSize, context.precision)}`,
    `M ${number(layout.end.x - layout.normal.x * tickSize, context.precision)} ${number(layout.end.y - layout.normal.y * tickSize, context.precision)} L ${number(layout.end.x + layout.normal.x * tickSize, context.precision)} ${number(layout.end.y + layout.normal.y * tickSize, context.precision)}`,
  ].join(" ");
  const fontSize = Math.max(1, finiteNumber(object.fontSize, 12));
  const label = object.label || formatFloorPlanDimension(
    { x: finiteNumber(object.x, 0), y: finiteNumber(object.y, 0) },
    { x: finiteNumber(object.endX, 0), y: finiteNumber(object.endY, 0) },
    context.board.settings?.floorPlan,
  );
  const labelWidth = estimateTextWidth(label, fontSize, TEXT_FONT_FAMILIES.sans) + 8;
  const color = normalizeColor(object.color, DEFAULT_STROKE_COLOR);
  return [
    `<path d="${path}" ${strokeAttributes(object, context, { forceSolid: true })} fill="none"/>`,
    `<rect x="${number(layout.center.x - labelWidth / 2, context.precision)}" y="${number(layout.center.y - fontSize * 0.7, context.precision)}" width="${number(labelWidth, context.precision)}" height="${number(fontSize * 1.4, context.precision)}" fill="#ffffff" stroke="none"/>`,
    `<text x="${number(layout.center.x, context.precision)}" y="${number(layout.center.y, context.precision)}" fill="${color}" font-family="${escapeXml(TEXT_FONT_FAMILIES.sans)}" font-size="${number(fontSize, context.precision)}" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>`,
  ].join("");
}

function getDimensionLayout(object) {
  const startX = finiteNumber(object.x, 0);
  const startY = finiteNumber(object.y, 0);
  const endX = finiteNumber(object.endX, startX);
  const endY = finiteNumber(object.endY, startY);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const length = Math.max(0.001, Math.hypot(deltaX, deltaY));
  const normal = { x: -deltaY / length, y: deltaX / length };
  const offset = finiteNumber(object.offset, 24);
  const start = { x: startX + normal.x * offset, y: startY + normal.y * offset };
  const end = { x: endX + normal.x * offset, y: endY + normal.y * offset };
  return {
    normal,
    start,
    end,
    center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  };
}

function renderSymbol(object, context) {
  const definition = getArchitectureSymbol(object.symbolId);
  if (!definition) return "";
  const frame = fitArchitectureSymbolFrame(object, definition);
  const parts = definition.parts
    .map((part) => renderSymbolPart(part, object, frame, context))
    .join("");
  return `<g data-symbol-id="${escapeXml(String(object.symbolId))}">${parts}</g>`;
}

function renderSymbolPart(part, object, frame, context) {
  const stroke = resolveSymbolPaint(part.stroke, object, true);
  const fill = resolveSymbolPaint(part.fill, object, false);
  const lineWidth = Math.max(
    0.7,
    finiteNumber(object.strokeWidth, 2) * finiteNumber(part.width, 1),
  );
  const paint = [
    `fill="${part.fill ? fill : "none"}"`,
    `stroke="${part.stroke ? stroke : "none"}"`,
    `stroke-width="${number(lineWidth, context.precision)}"`,
    `stroke-linecap="round"`,
    `stroke-linejoin="round"`,
  ].join(" ");

  if (part.type === "rect" || part.type === "rounded-rect") {
    const x = finiteNumber(frame.x, 0) + finiteNumber(part.x, 0) * finiteNumber(frame.w, 0);
    const y = finiteNumber(frame.y, 0) + finiteNumber(part.y, 0) * finiteNumber(frame.h, 0);
    const width = finiteNumber(part.w, 0) * finiteNumber(frame.w, 0);
    const height = finiteNumber(part.h, 0) * finiteNumber(frame.h, 0);
    const radius = part.type === "rounded-rect"
      ? Math.min(Math.abs(width), Math.abs(height)) * finiteNumber(part.radius, 0)
      : 0;
    return `<rect x="${number(x, context.precision)}" y="${number(y, context.precision)}" width="${number(width, context.precision)}" height="${number(height, context.precision)}"${radius ? ` rx="${number(radius, context.precision)}" ry="${number(radius, context.precision)}"` : ""} ${paint}/>`;
  }
  if (part.type === "ellipse") {
    const centerX = finiteNumber(frame.x, 0)
      + (finiteNumber(part.x, 0) + finiteNumber(part.w, 0) / 2) * finiteNumber(frame.w, 0);
    const centerY = finiteNumber(frame.y, 0)
      + (finiteNumber(part.y, 0) + finiteNumber(part.h, 0) / 2) * finiteNumber(frame.h, 0);
    return `<ellipse cx="${number(centerX, context.precision)}" cy="${number(centerY, context.precision)}" rx="${number(Math.abs(finiteNumber(part.w, 0) * finiteNumber(frame.w, 0)) / 2, context.precision)}" ry="${number(Math.abs(finiteNumber(part.h, 0) * finiteNumber(frame.h, 0)) / 2, context.precision)}" ${paint}/>`;
  }
  if (part.type === "line") {
    return `<line x1="${number(finiteNumber(frame.x, 0) + finiteNumber(part.x1, 0) * finiteNumber(frame.w, 0), context.precision)}" y1="${number(finiteNumber(frame.y, 0) + finiteNumber(part.y1, 0) * finiteNumber(frame.h, 0), context.precision)}" x2="${number(finiteNumber(frame.x, 0) + finiteNumber(part.x2, 0) * finiteNumber(frame.w, 0), context.precision)}" y2="${number(finiteNumber(frame.y, 0) + finiteNumber(part.y2, 0) * finiteNumber(frame.h, 0), context.precision)}" ${paint}/>`;
  }
  if (part.type === "arc") {
    const radius = finiteNumber(part.radius, 0)
      * Math.min(Math.abs(finiteNumber(frame.w, 0)), Math.abs(finiteNumber(frame.h, 0)));
    const centerX = finiteNumber(frame.x, 0) + finiteNumber(part.cx, 0) * finiteNumber(frame.w, 0);
    const centerY = finiteNumber(frame.y, 0) + finiteNumber(part.cy, 0) * finiteNumber(frame.h, 0);
    const startAngle = finiteNumber(part.startAngle, 0);
    const endAngle = finiteNumber(part.endAngle, 0);
    const start = {
      x: centerX + Math.cos(startAngle) * radius,
      y: centerY + Math.sin(startAngle) * radius,
    };
    const end = {
      x: centerX + Math.cos(endAngle) * radius,
      y: centerY + Math.sin(endAngle) * radius,
    };
    const sweep = endAngle - startAngle;
    const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
    const sweepFlag = sweep >= 0 ? 1 : 0;
    return `<path d="M ${number(start.x, context.precision)} ${number(start.y, context.precision)} A ${number(radius, context.precision)} ${number(radius, context.precision)} 0 ${largeArc} ${sweepFlag} ${number(end.x, context.precision)} ${number(end.y, context.precision)}" ${paint}/>`;
  }
  if (part.type === "polygon" && Array.isArray(part.points)) {
    const points = part.points.map(([x, y]) => ({
      x: finiteNumber(frame.x, 0) + finiteNumber(x, 0) * finiteNumber(frame.w, 0),
      y: finiteNumber(frame.y, 0) + finiteNumber(y, 0) * finiteNumber(frame.h, 0),
    }));
    return `<polygon points="${pointsAttribute(points, context.precision)}" ${paint}/>`;
  }
  return "";
}

function resolveSymbolPaint(token, object, isStroke) {
  if (!token) return "none";
  const objectPaint = getObjectPaint(object, object.fillColor, null);
  if (token === "primary") {
    return isStroke ? objectPaint.strokeColor : objectPaint.fillColor ?? objectPaint.strokeColor;
  }
  if (token === "secondary") {
    return isStroke ? objectPaint.strokeColor : objectPaint.fillColor ?? DEFAULT_SYMBOL_FILL;
  }
  if (token === "accent") return normalizeColor(object.accentColor, "#9a6a1f");
  const material = getArchitectureMaterial(token);
  if (material) return isStroke ? material.strokeColor : material.fillColor;
  return isStroke ? objectPaint.strokeColor : objectPaint.fillColor ?? "#f7f4ec";
}

function renderTextbox(object, index, context) {
  const backgroundPaint = getObjectPaint(object, null, context);
  const background = backgroundPaint.hasFill
    ? `<rect x="${number(object.x, context.precision)}" y="${number(object.y, context.precision)}" width="${number(object.w, context.precision)}" height="${number(object.h, context.precision)}" fill="${backgroundPaint.fill}" fill-opacity="${number(backgroundPaint.fillOpacity, context.precision)}" stroke="none"/>`
    : "";
  const text = String(object.text ?? "");
  if (!text) return background;
  const fontFamily = TEXT_FONT_FAMILIES[object.fontFamily] ?? TEXT_FONT_FAMILIES.serif;
  const fontSize = getTextWorldFontSize(
    object.fontSize,
    context.screenZoom,
    object.scaleMode,
  );
  const padding = Math.max(0, finiteNumber(object.padding, 6));
  const maximumWidth = Math.max(20, finiteNumber(object.w, 0) - padding * 2);
  const lines = wrapTextTokens(text, maximumWidth, fontSize, fontFamily);
  const lineHeight = fontSize * clamp(finiteNumber(object.lineHeight, 1.25), 0.8, 3);
  const totalHeight = lines.length * lineHeight;
  const top = object.verticalAlign === "middle"
    ? finiteNumber(object.y, 0) + Math.max(padding, (finiteNumber(object.h, 0) - totalHeight) / 2)
    : object.verticalAlign === "bottom"
      ? finiteNumber(object.y, 0) + Math.max(
        padding,
        finiteNumber(object.h, 0) - padding - totalHeight,
      )
      : finiteNumber(object.y, 0) + padding;
  const textAnchor = object.textAlign === "center"
    ? "middle"
    : object.textAlign === "right"
      ? "end"
      : "start";
  const x = object.textAlign === "center"
    ? finiteNumber(object.x, 0) + finiteNumber(object.w, 0) / 2
    : object.textAlign === "right"
      ? finiteNumber(object.x, 0) + finiteNumber(object.w, 0) - padding
      : finiteNumber(object.x, 0) + padding;
  const clipId = context.definitions.addRectClip(
    `text-${index}`,
    object,
  );
  const lineMarkup = lines.map((line, lineIndex) => {
    const y = top + lineIndex * lineHeight;
    if (!line.tokens.length) {
      return `<tspan x="${number(x, context.precision)}" y="${number(y, context.precision)}">&#160;</tspan>`;
    }
    const segments = [];
    line.tokens.forEach((token, tokenIndex) => {
      if (tokenIndex > 0) {
        segments.push(...getTextColorSegments(
          " ",
          Math.max(0, token.start - 1),
          object.colorRanges,
          normalizeColor(object.color, DEFAULT_STROKE_COLOR),
        ));
      }
      segments.push(...getTextColorSegments(
        token.text,
        token.start,
        object.colorRanges,
        normalizeColor(object.color, DEFAULT_STROKE_COLOR),
      ));
    });
    return [
      `<tspan x="${number(x, context.precision)}" y="${number(y, context.precision)}">`,
      ...segments.map((segment) => (
        `<tspan fill="${normalizeColor(segment.color, DEFAULT_STROKE_COLOR)}">${escapeXml(segment.text)}</tspan>`
      )),
      `</tspan>`,
    ].join("");
  }).join("");
  const textMarkup = [
    `<text clip-path="url(#${clipId})"`,
    ` font-family="${escapeXml(fontFamily)}"`,
    ` font-size="${number(fontSize, context.precision)}"`,
    ` font-weight="${number(clamp(finiteNumber(object.fontWeight, 400), 300, 800), context.precision)}"`,
    ` text-anchor="${textAnchor}"`,
    ` dominant-baseline="text-before-edge"`,
    ` xml:space="preserve">`,
    lineMarkup,
    `</text>`,
  ].join("");
  return background + textMarkup;
}

function renderImage(object, index, context) {
  const asset = context.board.assets?.[object.assetId];
  const dataUrl = typeof asset?.dataUrl === "string" && SAFE_RASTER_DATA_URL.test(asset.dataUrl)
    ? asset.dataUrl.replace(/\s+/g, "")
    : null;
  if (!dataUrl) return renderMissingImage(object, context);

  const sourceWidth = positiveNumber(object.sourceWidth, positiveNumber(asset.width, object.w));
  const sourceHeight = positiveNumber(object.sourceHeight, positiveNumber(asset.height, object.h));
  const crop = normalizeImageCrop(object.crop, sourceWidth, sourceHeight);
  const frameWidth = positiveNumber(object.w, 1);
  const frameHeight = positiveNumber(object.h, 1);
  const scaleX = frameWidth / crop.width;
  const scaleY = frameHeight / crop.height;
  const imageX = finiteNumber(object.x, 0) - crop.x * scaleX;
  const imageY = finiteNumber(object.y, 0) - crop.y * scaleY;
  const clipId = context.definitions.addRectClip(`image-${index}`, object);
  return [
    `<g clip-path="url(#${clipId})">`,
    `<image href="${escapeXml(dataUrl)}"`,
    ` x="${number(imageX, context.precision)}"`,
    ` y="${number(imageY, context.precision)}"`,
    ` width="${number(sourceWidth * scaleX, context.precision)}"`,
    ` height="${number(sourceHeight * scaleY, context.precision)}"`,
    ` preserveAspectRatio="none"/>`,
    `</g>`,
  ].join("");
}

function renderMissingImage(object, context) {
  const x = finiteNumber(object.x, 0);
  const y = finiteNumber(object.y, 0);
  return [
    `<rect x="${number(x, context.precision)}" y="${number(y, context.precision)}" width="${number(object.w, context.precision)}" height="${number(object.h, context.precision)}" fill="none" stroke="#8d8d8d" stroke-width="1" stroke-dasharray="6 4"/>`,
    `<text x="${number(x + 10, context.precision)}" y="${number(y + 18, context.precision)}" fill="#8d8d8d" font-family="${escapeXml(TEXT_FONT_FAMILIES.sans)}" font-size="12">Missing image</text>`,
  ].join("");
}

function renderLegacyDimensionLabel(object, context) {
  const label = formatFloorPlanDimension(
    { x: finiteNumber(object.x, 0), y: finiteNumber(object.y, 0) },
    { x: finiteNumber(object.endX, 0), y: finiteNumber(object.endY, 0) },
    context.board.settings?.floorPlan,
  );
  const centerX = (finiteNumber(object.x, 0) + finiteNumber(object.endX, 0)) / 2;
  const centerY = (finiteNumber(object.y, 0) + finiteNumber(object.endY, 0)) / 2;
  const fontSize = 12;
  const width = estimateTextWidth(label, fontSize, TEXT_FONT_FAMILIES.sans) + 8;
  return [
    `<rect x="${number(centerX - width / 2, context.precision)}" y="${number(centerY - 18, context.precision)}" width="${number(width, context.precision)}" height="16" fill="#ffffff" stroke="none"/>`,
    `<text x="${number(centerX, context.precision)}" y="${number(centerY - 4, context.precision)}" fill="#24231f" font-family="${escapeXml(TEXT_FONT_FAMILIES.sans)}" font-size="12" text-anchor="middle">${escapeXml(label)}</text>`,
  ].join("");
}

function getObjectPaint(object, fallbackFill, context) {
  const material = getArchitectureMaterial(object.materialId);
  const materialStyle = material
    ? resolveMaterialStyle(object.materialId, {
      ...(object.fillColor ? { fillColor: object.fillColor } : {}),
      ...(object.fillPattern ? { fillPattern: object.fillPattern } : {}),
      ...(Number.isFinite(object.fillOpacity) ? { fillOpacity: object.fillOpacity } : {}),
      ...(object.color ? { color: object.color } : {}),
    })
    : null;
  const fillColor = normalizeOptionalColor(
    object.fillColor,
    materialStyle?.fillColor ?? fallbackFill,
  );
  const fillPattern = ARCHITECTURE_FILL_PATTERNS.includes(object.fillPattern)
    ? object.fillPattern
    : materialStyle?.fillPattern ?? "solid";
  const strokeColor = normalizeColor(
    object.color,
    materialStyle?.color ?? DEFAULT_STROKE_COLOR,
  );
  const hasFill = Boolean(fillColor);
  return {
    strokeColor,
    fillColor,
    fillPattern,
    fillOpacity: clamp(
      finiteNumber(object.fillOpacity, materialStyle?.fillOpacity ?? 1),
      0,
      1,
    ),
    hasFill,
    fill: hasFill && fillPattern !== "solid" && context
      ? `url(#${context.definitions.getPatternId(fillPattern, fillColor, strokeColor)})`
      : fillColor ?? "none",
  };
}

function paintAttributes(object, paint, context) {
  return [
    `fill="${paint.fill}"`,
    ...(paint.hasFill && paint.fillOpacity < 1
      ? [`fill-opacity="${number(paint.fillOpacity, context.precision)}"`]
      : []),
    strokeAttributes(object, context),
  ].join(" ");
}

function strokeAttributes(object, context, options = {}) {
  const width = Math.max(0.01, finiteNumber(object.strokeWidth, 1));
  const dash = options.forceSolid
    ? []
    : getStrokeDashArray(object.dashPattern, width);
  return [
    `stroke="${normalizeColor(object.color, DEFAULT_STROKE_COLOR)}"`,
    `stroke-width="${number(width, context.precision)}"`,
    `stroke-linecap="round"`,
    `stroke-linejoin="round"`,
    ...(dash.length
      ? [`stroke-dasharray="${dash.map((value) => number(value, context.precision)).join(" ")}"`]
      : []),
  ].join(" ");
}

function createDefinitionRegistry(precision) {
  const definitions = [];
  const patternIds = new Map();
  const shadowIds = new Map();
  let clipIndex = 0;

  return {
    getPatternId(pattern, fillColor, strokeColor) {
      const key = `${pattern}:${fillColor}:${strokeColor}`;
      if (patternIds.has(key)) return patternIds.get(key);
      const id = `vp-pattern-${patternIds.size + 1}`;
      patternIds.set(key, id);
      definitions.push(renderPatternDefinition(
        id,
        pattern,
        fillColor,
        strokeColor,
        precision,
      ));
      return id;
    },
    getShadowId(shadow) {
      const normalized = normalizeShadow(shadow);
      const key = JSON.stringify(normalized);
      if (shadowIds.has(key)) return shadowIds.get(key);
      const id = `vp-shadow-${shadowIds.size + 1}`;
      shadowIds.set(key, id);
      definitions.push([
        `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">`,
        `<feDropShadow dx="${number(normalized.offsetX, precision)}"`,
        ` dy="${number(normalized.offsetY, precision)}"`,
        ` stdDeviation="${number(normalized.blur / 2, precision)}"`,
        ` flood-color="${normalized.color}"`,
        ` flood-opacity="${number(normalized.opacity, precision)}"/>`,
        `</filter>`,
      ].join(""));
      return id;
    },
    addRectClip(prefix, frame) {
      clipIndex += 1;
      const id = `vp-clip-${prefix}-${clipIndex}`;
      definitions.push([
        `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">`,
        `<rect x="${number(frame.x, precision)}"`,
        ` y="${number(frame.y, precision)}"`,
        ` width="${number(frame.w, precision)}"`,
        ` height="${number(frame.h, precision)}"/>`,
        `</clipPath>`,
      ].join(""));
      return id;
    },
    toMarkup() {
      return definitions.length ? `<defs>${definitions.join("")}</defs>` : "";
    },
  };
}

function renderPatternDefinition(id, pattern, fillColor, strokeColor, precision) {
  const stroke = normalizeColor(strokeColor, DEFAULT_STROKE_COLOR);
  const fill = normalizeColor(fillColor, "#ffffff");
  const base = `<rect width="24" height="24" fill="${fill}"/>`;
  let details = "";

  if (pattern === "hatch" || pattern === "crosshatch") {
    const reverse = pattern === "crosshatch"
      ? " M -6 0 L 24 30 M 6 -6 L 30 18"
      : "";
    details = `<path d="M -6 24 L 24 -6 M 6 30 L 30 6${reverse}" fill="none" stroke="${stroke}" stroke-opacity=".32" stroke-width="1"/>`;
  } else if (pattern === "dots") {
    details = `<g fill="${stroke}" fill-opacity=".34"><circle cx="5" cy="5" r="1.1"/><circle cx="18" cy="9" r="1.1"/><circle cx="10" cy="19" r="1.1"/><circle cx="22" cy="22" r="1.1"/></g>`;
  } else if (pattern === "tile") {
    details = `<path d="M .5 .5 H 23.5 V 23.5 H .5 Z M 12 0 V 24 M 0 12 H 24" fill="none" stroke="${stroke}" stroke-opacity=".32" stroke-width="1"/>`;
  } else if (pattern === "wood") {
    details = `<path d="M 0 5 C 6 3 15 7 24 5 M 0 12 C 6 10 15 14 24 12 M 0 19 C 6 17 15 21 24 19 M 14 10 A 3 1.5 0 1 0 20 10 A 3 1.5 0 1 0 14 10" fill="none" stroke="${stroke}" stroke-opacity=".32" stroke-width="1"/>`;
  } else if (pattern === "grass") {
    details = `<path d="M 4 20 L 2 15 M 4 20 L 6 14 M 10 13 L 8 8 M 10 13 L 12 7 M 17 22 L 15 17 M 17 22 L 19 16 M 21 9 L 19 4 M 21 9 L 23 3" fill="none" stroke="${stroke}" stroke-opacity=".32" stroke-width="1"/>`;
  } else if (pattern === "water") {
    details = `<path d="M 0 6 C 5 3 7 9 12 6 C 17 3 19 9 24 6 M 0 14 C 5 11 7 17 12 14 C 17 11 19 17 24 14 M 0 22 C 5 19 7 25 12 22 C 17 19 19 25 24 22" fill="none" stroke="${stroke}" stroke-opacity=".32" stroke-width="1"/>`;
  } else if (pattern === "stone") {
    details = `<path d="M 0 8 L 8 5 L 15 9 L 24 6 M 0 18 L 6 14 L 14 18 L 24 15 M 8 5 L 6 14 M 15 9 L 14 18" fill="none" stroke="${stroke}" stroke-opacity=".32" stroke-width="1"/>`;
  } else if (pattern === "pavers") {
    details = `<path d="M .5 .5 H 11.5 V 7.5 H .5 Z M 12.5 .5 H 23.5 V 7.5 H 12.5 Z M -5.5 8.5 H 5.5 V 15.5 H -5.5 Z M 6.5 8.5 H 17.5 V 15.5 H 6.5 Z M 18.5 8.5 H 29.5 V 15.5 H 18.5 Z M .5 16.5 H 11.5 V 23.5 H .5 Z M 12.5 16.5 H 23.5 V 23.5 H 12.5 Z" fill="none" stroke="${stroke}" stroke-opacity=".32" stroke-width="1"/>`;
  } else if (pattern === "brick") {
    details = `<path d="M 0 .5 H 24 M 0 8.5 H 24 M 0 16.5 H 24 M 6 .5 V 8.5 M 18 .5 V 8.5 M 0 8.5 V 16.5 M 12 8.5 V 16.5 M 24 8.5 V 16.5 M 6 16.5 V 24 M 18 16.5 V 24" fill="none" stroke="${stroke}" stroke-opacity=".32" stroke-width="1"/>`;
  } else if (pattern === "shingle") {
    details = `<path d="M -4 4 Q 0 9 4 4 Q 8 9 12 4 Q 16 9 20 4 Q 24 9 28 4 M 0 12 Q 4 17 8 12 Q 12 17 16 12 Q 20 17 24 12 M -4 20 Q 0 25 4 20 Q 8 25 12 20 Q 16 25 20 20 Q 24 25 28 20" fill="none" stroke="${stroke}" stroke-opacity=".32" stroke-width="1"/>`;
  } else if (pattern === "marble") {
    details = `<path d="M -2 5 C 5 0 8 13 15 7 C 20 3 22 15 28 11 M 3 24 C 8 17 14 23 22 16" fill="none" stroke="${stroke}" stroke-opacity=".28" stroke-width=".8"/>`;
  } else if (pattern === "slate") {
    details = `<path d="M .5 .5 H 11.5 V 11.5 H .5 Z M 12.5 .5 H 23.5 V 11.5 H 12.5 Z M .5 12.5 H 11.5 V 23.5 H .5 Z M 12.5 12.5 H 23.5 V 23.5 H 12.5 Z M 0 12 L 12 0 M 12 24 L 24 12" fill="none" stroke="${stroke}" stroke-opacity=".3" stroke-width="1"/>`;
  } else if (pattern === "sand") {
    details = `<g fill="${stroke}" fill-opacity=".28"><circle cx="5" cy="5" r=".7"/><circle cx="18" cy="9" r=".7"/><circle cx="10" cy="19" r=".7"/><circle cx="22" cy="22" r=".7"/><circle cx="3" cy="16" r=".55"/><circle cx="15" cy="3" r=".55"/></g>`;
  } else if (pattern === "mulch") {
    details = `<path d="M 2 6 Q 5 6 8 3 M 11 5 Q 14 9 17 9 M 4 17 Q 8 17 11 13 M 15 20 Q 19 19 23 15" fill="none" stroke="${stroke}" stroke-opacity=".34" stroke-width="1.2"/>`;
  } else if (pattern === "hedge") {
    details = `<path d="M 4 18 Q -1 12 4 8 Q 9 12 4 18 M 10 10 Q 5 4 10 0 Q 15 4 10 10 M 16 20 Q 11 14 16 10 Q 21 14 16 20 M 22 9 Q 17 3 22 -1 Q 27 3 22 9" fill="none" stroke="${stroke}" stroke-opacity=".36" stroke-width="1"/>`;
  } else if (pattern === "asphalt") {
    details = `<g fill="${stroke}" fill-opacity=".3"><circle cx="5" cy="5" r="1.1"/><circle cx="18" cy="9" r="1.1"/><circle cx="10" cy="19" r="1.1"/><circle cx="22" cy="22" r="1.1"/></g><path d="M 2 14 L 7 12 M 14 3 L 19 5 M 15 19 L 21 17" fill="none" stroke="${stroke}" stroke-opacity=".3" stroke-width="1"/>`;
  }

  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${number(24, precision)}" height="${number(24, precision)}">${base}${details}</pattern>`;
}

function normalizeShadow(value) {
  return {
    color: normalizeColor(value?.color, "#000000"),
    opacity: clamp(finiteNumber(value?.opacity, 0.22), 0, 1),
    blur: clamp(finiteNumber(value?.blur, 8), 0, 240),
    offsetX: clamp(finiteNumber(value?.offsetX, 0), -240, 240),
    offsetY: clamp(finiteNumber(value?.offsetY, 4), -240, 240),
  };
}

function renderBackground(bounds, value, precision) {
  if (value === null || value === "transparent") return "";
  const fill = normalizeColor(value, "#ffffff");
  return `<rect x="${number(bounds.x, precision)}" y="${number(bounds.y, precision)}" width="${number(bounds.width, precision)}" height="${number(bounds.height, precision)}" fill="${fill}" stroke="none"/>`;
}

function wrapTextTokens(text, maximumWidth, fontSize, fontFamily) {
  const paragraphs = String(text).split(/\n/);
  const lines = [];
  let paragraphStart = 0;
  paragraphs.forEach((paragraph) => {
    const tokens = [...paragraph.matchAll(/\S+/g)].map((match) => ({
      text: match[0],
      start: paragraphStart + match.index,
    }));
    if (!tokens.length) {
      lines.push({ tokens: [] });
      paragraphStart += paragraph.length + 1;
      return;
    }
    let currentLine = [];
    tokens.forEach((token) => {
      const candidate = [...currentLine, token].map((item) => item.text).join(" ");
      if (
        estimateTextWidth(candidate, fontSize, fontFamily) > maximumWidth
        && currentLine.length
      ) {
        lines.push({ tokens: currentLine });
        currentLine = [token];
      } else {
        currentLine.push(token);
      }
    });
    lines.push({ tokens: currentLine });
    paragraphStart += paragraph.length + 1;
  });
  return lines;
}

function estimateTextWidth(text, fontSize, fontFamily) {
  const isMonospace = fontFamily.includes("Courier");
  const units = [...String(text)].reduce((total, character) => {
    if (isMonospace) return total + 0.6;
    if (character === " ") return total + 0.32;
    if (/[MW@#%&]/.test(character)) return total + 0.85;
    if (/[ilI1.,'`:;|!]/.test(character)) return total + 0.3;
    if (/[A-Z]/.test(character)) return total + 0.65;
    if (/[0-9]/.test(character)) return total + 0.56;
    return total + 0.54;
  }, 0);
  return units * fontSize;
}

function getFrameTransform(object, precision) {
  const center = getShapeCenter({
    x: finiteNumber(object.x, 0),
    y: finiteNumber(object.y, 0),
    w: finiteNumber(object.w, 0),
    h: finiteNumber(object.h, 0),
  });
  const transforms = [];
  const rotation = finiteNumber(object.rotation, 0);
  if (rotation) {
    transforms.push(
      `rotate(${number(rotation * 180 / Math.PI, precision)} ${number(center.x, precision)} ${number(center.y, precision)})`,
    );
  }
  if (object.flipX || object.flipY) {
    transforms.push(
      `translate(${number(center.x, precision)} ${number(center.y, precision)})`,
      `scale(${object.flipX ? -1 : 1} ${object.flipY ? -1 : 1})`,
      `translate(${number(-center.x, precision)} ${number(-center.y, precision)})`,
    );
  }
  return transforms.join(" ");
}

function pathFromPoints(points, closed, precision) {
  if (!points.length) return "";
  return [
    `M ${number(points[0].x, precision)} ${number(points[0].y, precision)}`,
    ...points.slice(1).map((point) => (
      `L ${number(point.x, precision)} ${number(point.y, precision)}`
    )),
    ...(closed ? ["Z"] : []),
  ].join(" ");
}

function pointsAttribute(points, precision) {
  return points
    .map((point) => `${number(point.x, precision)},${number(point.y, precision)}`)
    .join(" ");
}

function normalizeViewBounds(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("SVG viewBounds must be an object.");
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new TypeError("SVG viewBounds requires finite x/y and positive width/height.");
  }
  return { x, y, width, height };
}

function normalizePrecision(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.min(6, Math.max(0, Math.floor(numericValue)))
    : 3;
}

function assertBoard(board) {
  if (!board || typeof board !== "object" || !Array.isArray(board.objects)) {
    throw new TypeError("A Visual Board document with an objects array is required.");
  }
}

function normalizeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? ""))
    ? String(value).toLowerCase()
    : fallback;
}

function normalizeOptionalColor(value, fallback = null) {
  if (/^#[0-9a-f]{6}$/i.test(String(value ?? ""))) {
    return String(value).toLowerCase();
  }
  return /^#[0-9a-f]{6}$/i.test(String(fallback ?? ""))
    ? String(fallback).toLowerCase()
    : null;
}

function positiveNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : Math.max(1, finiteNumber(fallback, 1));
}

function finiteNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function number(value, precision) {
  const multiplier = 10 ** precision;
  const rounded = Math.round(finiteNumber(value, 0) * multiplier) / multiplier;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
