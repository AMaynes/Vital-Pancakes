/**
 * Deterministic architectural primitives and bundled vector catalogs.
 *
 * The catalog contains rendering instructions only. It never chooses a layout:
 * callers provide every position, dimension, rotation, material, and layer.
 */

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export const ARCHITECTURE_FILL_PATTERNS = Object.freeze([
  "solid",
  "hatch",
  "crosshatch",
  "dots",
  "tile",
  "wood",
  "grass",
  "water",
  "stone",
  "pavers",
]);

export const DEFAULT_ARCHITECTURE_LAYERS = Object.freeze([
  layer("site", "Site", -60),
  layer("landscape", "Landscape", -50),
  layer("materials", "Materials", -40),
  layer("structure", "Structure", 0),
  layer("openings", "Doors & windows", 10),
  layer("fixtures", "Fixtures", 20),
  layer("furniture", "Furniture", 30),
  layer("labels", "Labels", 40),
  layer("dimensions", "Dimensions", 50),
]);

const MATERIALS = Object.freeze({
  paper: material("Paper", "#fbf8ef", "solid", "#d8d0c0"),
  lawn: material("Lawn", "#b8d89f", "grass", "#71935f"),
  water: material("Water", "#80cbe3", "water", "#3e91ae"),
  stone: material("Stone", "#c9b89d", "stone", "#8d7c65"),
  pavers: material("Pavers", "#d8c5a3", "pavers", "#9d8769"),
  concrete: material("Concrete", "#d6d5cf", "dots", "#9b9a94"),
  gravel: material("Gravel", "#c8c1b5", "dots", "#8f887c"),
  hardwood: material("Hardwood", "#cf9e65", "wood", "#8b5f35"),
  tile: material("Tile", "#dce7e3", "tile", "#8aa39b"),
  carpet: material("Carpet", "#d8c7ba", "crosshatch", "#9e8878"),
  glass: material("Glass", "#bfe7ef", "hatch", "#5795a5", 0.7),
  planting: material("Planting bed", "#7ca168", "grass", "#45693b"),
  flowers: material("Flower bed", "#d58ca3", "dots", "#8b4962"),
  roof: material("Roof", "#b69a7b", "hatch", "#725c46"),
  decking: material("Decking", "#d6b37c", "wood", "#957044"),
});

const SYMBOLS = Object.freeze({
  "door-single": symbol("Single door", "architecture", 3, 3, [
    linePart(0.08, 0.08, 0.08, 0.92, "primary", 1.3),
    linePart(0.08, 0.08, 0.92, 0.08, "primary", 1.3),
    arcPart(0.08, 0.08, 0.84, 0, Math.PI / 2, "secondary"),
  ]),
  "door-double": symbol("Double door", "architecture", 6, 3, [
    linePart(0.5, 0.08, 0.08, 0.92, "primary", 1.2),
    linePart(0.5, 0.08, 0.92, 0.92, "primary", 1.2),
    arcPart(0.5, 0.08, 0.42, Math.PI / 2, Math.PI, "secondary"),
    arcPart(0.5, 0.08, 0.42, 0, Math.PI / 2, "secondary"),
  ]),
  window: symbol("Window", "architecture", 4, 0.5, [
    rectPart(0.02, 0.18, 0.96, 0.64, "glass", "primary"),
    linePart(0.5, 0.18, 0.5, 0.82, "secondary"),
  ]),
  "stairs-straight": symbol("Straight stairs", "architecture", 4, 9, [
    rectPart(0.04, 0.02, 0.92, 0.96, "paper", "primary"),
    ...Array.from({ length: 9 }, (_, index) => (
      linePart(0.04, 0.11 + index * 0.095, 0.96, 0.11 + index * 0.095, "secondary")
    )),
    linePart(0.5, 0.9, 0.5, 0.14, "accent", 1.2),
    polygonPart([[0.45, 0.2], [0.5, 0.1], [0.55, 0.2]], "accent", "accent"),
  ]),
  column: symbol("Column", "architecture", 2, 2, [
    ellipsePart(0.08, 0.08, 0.84, 0.84, "stone", "primary"),
    ellipsePart(0.27, 0.27, 0.46, 0.46, "paper", "secondary"),
  ]),
  "bed-queen": symbol("Queen bed", "bedroom", 5, 7, [
    rectPart(0.04, 0.03, 0.92, 0.94, "paper", "primary"),
    rectPart(0.08, 0.05, 0.84, 0.18, "secondary", "secondary"),
    rectPart(0.1, 0.1, 0.36, 0.15, "paper", "secondary"),
    rectPart(0.54, 0.1, 0.36, 0.15, "paper", "secondary"),
    linePart(0.5, 0.26, 0.5, 0.95, "secondary"),
  ]),
  "bed-twin": symbol("Twin bed", "bedroom", 3.2, 6.5, [
    rectPart(0.05, 0.03, 0.9, 0.94, "paper", "primary"),
    rectPart(0.1, 0.08, 0.8, 0.18, "secondary", "secondary"),
    rectPart(0.18, 0.11, 0.64, 0.14, "paper", "secondary"),
  ]),
  sofa: symbol("Sofa", "living", 7, 3, [
    roundedRectPart(0.03, 0.08, 0.94, 0.84, 0.12, "secondary", "primary"),
    roundedRectPart(0.12, 0.22, 0.76, 0.58, 0.08, "paper", "secondary"),
    linePart(0.38, 0.23, 0.38, 0.8, "secondary"),
    linePart(0.62, 0.23, 0.62, 0.8, "secondary"),
  ]),
  armchair: symbol("Armchair", "living", 3.2, 3.2, [
    roundedRectPart(0.05, 0.05, 0.9, 0.9, 0.16, "secondary", "primary"),
    roundedRectPart(0.21, 0.18, 0.58, 0.62, 0.1, "paper", "secondary"),
  ]),
  "coffee-table": symbol("Coffee table", "living", 4.5, 2.5, [
    ellipsePart(0.03, 0.08, 0.94, 0.84, "hardwood", "primary"),
    ellipsePart(0.16, 0.22, 0.68, 0.56, "paper", "secondary"),
  ]),
  "dining-table-6": symbol("Dining table for six", "living", 7, 4, [
    roundedRectPart(0.18, 0.15, 0.64, 0.7, 0.08, "hardwood", "primary"),
    ...[
      [0.28, 0.02, 0.14, 0.12], [0.58, 0.02, 0.14, 0.12],
      [0.28, 0.86, 0.14, 0.12], [0.58, 0.86, 0.14, 0.12],
      [0.02, 0.38, 0.14, 0.24], [0.84, 0.38, 0.14, 0.24],
    ].map(([x, y, w, h]) => roundedRectPart(x, y, w, h, 0.04, "secondary", "secondary")),
  ]),
  desk: symbol("Desk", "office", 5, 2.5, [
    rectPart(0.03, 0.08, 0.94, 0.68, "hardwood", "primary"),
    rectPart(0.12, 0.2, 0.28, 0.42, "paper", "secondary"),
    roundedRectPart(0.38, 0.78, 0.24, 0.2, 0.06, "secondary", "secondary"),
  ]),
  chair: symbol("Chair", "furniture", 2, 2, [
    roundedRectPart(0.12, 0.12, 0.76, 0.66, 0.08, "secondary", "primary"),
    linePart(0.12, 0.78, 0.12, 0.96, "primary"),
    linePart(0.88, 0.78, 0.88, 0.96, "primary"),
  ]),
  bookcase: symbol("Bookcase", "office", 5, 1.5, [
    rectPart(0.02, 0.05, 0.96, 0.9, "hardwood", "primary"),
    ...Array.from({ length: 5 }, (_, index) => (
      linePart(0.19 + index * 0.155, 0.08, 0.19 + index * 0.155, 0.92, "secondary")
    )),
  ]),
  fireplace: symbol("Fireplace", "living", 5, 2, [
    rectPart(0.02, 0.08, 0.96, 0.84, "stone", "primary"),
    rectPart(0.25, 0.35, 0.5, 0.57, "primary", "primary"),
    arcPart(0.5, 0.78, 0.18, Math.PI, Math.PI * 2, "accent"),
  ]),
  "kitchen-island": symbol("Kitchen island", "kitchen", 8, 3.5, [
    roundedRectPart(0.02, 0.08, 0.96, 0.78, 0.05, "stone", "primary"),
    rectPart(0.09, 0.22, 0.82, 0.5, "paper", "secondary"),
    ...[0.2, 0.5, 0.8].map((x) => ellipsePart(x - 0.055, 0.87, 0.11, 0.11, "secondary", "secondary")),
  ]),
  refrigerator: symbol("Refrigerator", "kitchen", 3, 3.5, [
    rectPart(0.05, 0.04, 0.9, 0.92, "glass", "primary"),
    linePart(0.05, 0.38, 0.95, 0.38, "secondary"),
    linePart(0.68, 0.1, 0.68, 0.32, "accent"),
  ]),
  range: symbol("Range", "kitchen", 3, 3, [
    rectPart(0.04, 0.04, 0.92, 0.92, "glass", "primary"),
    ...[[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]]
      .map(([x, y]) => ellipsePart(x - 0.12, y - 0.12, 0.24, 0.24, "paper", "secondary")),
  ]),
  sink: symbol("Sink", "kitchen", 3, 2, [
    roundedRectPart(0.05, 0.08, 0.9, 0.8, 0.12, "glass", "primary"),
    roundedRectPart(0.18, 0.2, 0.64, 0.5, 0.1, "paper", "secondary"),
    arcPart(0.5, 0.18, 0.2, Math.PI, Math.PI * 2, "accent"),
  ]),
  dishwasher: symbol("Dishwasher", "kitchen", 3, 3, [
    rectPart(0.04, 0.04, 0.92, 0.92, "glass", "primary"),
    linePart(0.12, 0.2, 0.88, 0.2, "secondary"),
    linePart(0.38, 0.13, 0.62, 0.13, "accent"),
  ]),
  toilet: symbol("Toilet", "bathroom", 2.5, 4, [
    roundedRectPart(0.18, 0.03, 0.64, 0.2, 0.04, "paper", "primary"),
    ellipsePart(0.08, 0.2, 0.84, 0.74, "paper", "primary"),
    ellipsePart(0.25, 0.34, 0.5, 0.42, "glass", "secondary"),
  ]),
  vanity: symbol("Vanity", "bathroom", 5, 2, [
    rectPart(0.03, 0.08, 0.94, 0.84, "hardwood", "primary"),
    ellipsePart(0.32, 0.23, 0.36, 0.44, "glass", "secondary"),
    arcPart(0.5, 0.28, 0.16, Math.PI, Math.PI * 2, "accent"),
  ]),
  shower: symbol("Shower", "bathroom", 4, 4, [
    rectPart(0.03, 0.03, 0.94, 0.94, "tile", "primary"),
    linePart(0.06, 0.06, 0.94, 0.94, "secondary"),
    linePart(0.94, 0.06, 0.06, 0.94, "secondary"),
    ellipsePart(0.42, 0.42, 0.16, 0.16, "glass", "accent"),
  ]),
  bathtub: symbol("Bathtub", "bathroom", 6, 3, [
    roundedRectPart(0.02, 0.05, 0.96, 0.9, 0.18, "paper", "primary"),
    roundedRectPart(0.12, 0.18, 0.76, 0.64, 0.16, "water", "secondary"),
    ellipsePart(0.82, 0.42, 0.08, 0.16, "accent", "accent"),
  ]),
  "washer-dryer": symbol("Washer and dryer", "utility", 6, 3, [
    rectPart(0.02, 0.04, 0.46, 0.92, "glass", "primary"),
    rectPart(0.52, 0.04, 0.46, 0.92, "glass", "primary"),
    ellipsePart(0.1, 0.24, 0.3, 0.54, "paper", "secondary"),
    ellipsePart(0.6, 0.24, 0.3, 0.54, "paper", "secondary"),
  ]),
  workbench: symbol("Workshop bench", "workshop", 8, 3, [
    rectPart(0.02, 0.08, 0.96, 0.38, "hardwood", "primary"),
    rectPart(0.08, 0.46, 0.12, 0.48, "stone", "secondary"),
    rectPart(0.8, 0.46, 0.12, 0.48, "stone", "secondary"),
    ...Array.from({ length: 6 }, (_, index) => ellipsePart(0.28 + index * 0.08, 0.22, 0.03, 0.06, "accent", "accent")),
  ]),
  "gym-bench": symbol("Weight bench", "gym", 7, 3, [
    roundedRectPart(0.2, 0.32, 0.58, 0.28, 0.08, "secondary", "primary"),
    linePart(0.28, 0.6, 0.18, 0.92, "primary", 1.2),
    linePart(0.7, 0.6, 0.82, 0.92, "primary", 1.2),
    linePart(0.08, 0.18, 0.92, 0.18, "accent", 1.4),
    ...[0.08, 0.92].map((x) => ellipsePart(x - 0.06, 0.08, 0.12, 0.2, "accent", "primary")),
  ]),
  treadmill: symbol("Treadmill", "gym", 7, 3, [
    roundedRectPart(0.08, 0.5, 0.84, 0.34, 0.12, "glass", "primary"),
    linePart(0.75, 0.5, 0.88, 0.12, "primary", 1.4),
    linePart(0.68, 0.12, 0.94, 0.12, "accent", 1.2),
  ]),
  "sauna-bench": symbol("Sauna bench", "sauna", 7, 2.5, [
    ...Array.from({ length: 6 }, (_, index) => (
      rectPart(0.03 + index * 0.16, 0.15, 0.12, 0.58, "hardwood", "secondary")
    )),
    linePart(0.08, 0.74, 0.08, 0.95, "primary"),
    linePart(0.92, 0.74, 0.92, 0.95, "primary"),
  ]),
  pool: symbol("Swimming pool", "site", 16, 34, [
    roundedRectPart(0.02, 0.02, 0.96, 0.96, 0.08, "water", "primary"),
    roundedRectPart(0.1, 0.08, 0.8, 0.84, 0.06, "glass", "secondary"),
    ...Array.from({ length: 5 }, (_, index) => (
      arcPart(0.5, 0.2 + index * 0.14, 0.28, 0.15, Math.PI - 0.15, "accent")
    )),
  ]),
  "hot-tub": symbol("Hot tub", "site", 8, 8, [
    ellipsePart(0.02, 0.02, 0.96, 0.96, "stone", "primary"),
    ellipsePart(0.14, 0.14, 0.72, 0.72, "water", "secondary"),
    ...[[0.35, 0.35], [0.65, 0.35], [0.35, 0.65], [0.65, 0.65]]
      .map(([x, y]) => ellipsePart(x - 0.025, y - 0.025, 0.05, 0.05, "paper", "accent")),
  ]),
  car: symbol("Car", "site", 7, 15, [
    roundedRectPart(0.12, 0.03, 0.76, 0.94, 0.18, "secondary", "primary"),
    roundedRectPart(0.2, 0.22, 0.6, 0.5, 0.12, "glass", "secondary"),
    linePart(0.2, 0.47, 0.8, 0.47, "secondary"),
    ...[[0.04, 0.22], [0.86, 0.22], [0.04, 0.7], [0.86, 0.7]]
      .map(([x, y]) => roundedRectPart(x, y, 0.1, 0.16, 0.03, "primary", "primary")),
  ]),
  "tree-deciduous": symbol("Deciduous tree", "landscape", 8, 8, [
    ellipsePart(0.1, 0.16, 0.56, 0.62, "planting", "primary"),
    ellipsePart(0.36, 0.05, 0.54, 0.62, "planting", "primary"),
    ellipsePart(0.28, 0.36, 0.5, 0.54, "planting", "primary"),
    ellipsePart(0.43, 0.43, 0.14, 0.14, "hardwood", "secondary"),
  ]),
  "tree-palm": symbol("Palm tree", "landscape", 8, 8, [
    ellipsePart(0.42, 0.42, 0.16, 0.16, "hardwood", "secondary"),
    ...Array.from({ length: 8 }, (_, index) => {
      const angle = index / 8 * Math.PI * 2;
      return linePart(
        0.5,
        0.5,
        0.5 + Math.cos(angle) * 0.43,
        0.5 + Math.sin(angle) * 0.43,
        "primary",
        2,
      );
    }),
  ]),
  shrub: symbol("Shrub", "landscape", 4, 4, [
    ellipsePart(0.04, 0.18, 0.58, 0.64, "planting", "primary"),
    ellipsePart(0.38, 0.1, 0.58, 0.7, "planting", "primary"),
    ellipsePart(0.22, 0.38, 0.58, 0.56, "planting", "primary"),
  ]),
  "flower-bed": symbol("Flower bed", "landscape", 8, 4, [
    roundedRectPart(0.02, 0.12, 0.96, 0.76, 0.18, "planting", "primary"),
    ...Array.from({ length: 9 }, (_, index) => (
      ellipsePart(0.09 + index * 0.1, 0.32 + (index % 2) * 0.22, 0.08, 0.16, "flowers", "accent")
    )),
  ]),
  "gate-double": symbol("Double gate", "site", 12, 3, [
    linePart(0.02, 0.04, 0.02, 0.96, "primary", 1.8),
    linePart(0.98, 0.04, 0.98, 0.96, "primary", 1.8),
    linePart(0.04, 0.1, 0.5, 0.9, "primary", 1.2),
    linePart(0.5, 0.9, 0.96, 0.1, "primary", 1.2),
    linePart(0.04, 0.9, 0.5, 0.1, "secondary"),
    linePart(0.5, 0.1, 0.96, 0.9, "secondary"),
  ]),
});

export function getArchitectureCatalog() {
  return {
    materials: Object.entries(MATERIALS).map(([id, value]) => ({
      id,
      label: value.label,
      fillColor: value.fillColor,
      fillPattern: value.fillPattern,
      strokeColor: value.strokeColor,
    })),
    symbols: Object.entries(SYMBOLS).map(([id, value]) => ({
      id,
      label: value.label,
      category: value.category,
      nominalWidth: value.nominalWidth,
      nominalHeight: value.nominalHeight,
    })),
    fillPatterns: [...ARCHITECTURE_FILL_PATTERNS],
    defaultLayers: DEFAULT_ARCHITECTURE_LAYERS.map((value) => ({ ...value })),
  };
}

export function getArchitectureMaterial(materialId) {
  return MATERIALS[materialId] ? { ...MATERIALS[materialId] } : null;
}

export function getArchitectureSymbol(symbolId) {
  const definition = SYMBOLS[symbolId];
  return definition
    ? { ...definition, parts: definition.parts.map(clonePart) }
    : null;
}

export function normalizeArchitectureSettings(value = {}) {
  const layers = normalizeLayers(value.layers);
  return {
    layers: layers.length
      ? layers
      : DEFAULT_ARCHITECTURE_LAYERS.map((item) => ({ ...item })),
  };
}

export function sortArchitectureObjects(objects, architectureSettings) {
  const layers = normalizeArchitectureSettings(architectureSettings).layers;
  const layerMap = new Map(layers.map((item) => [item.id, item]));
  return (Array.isArray(objects) ? objects : [])
    .map((object, sourceIndex) => ({ object, sourceIndex }))
    .filter(({ object }) => layerMap.get(object.layerId)?.visible !== false)
    .sort((first, second) => (
      (layerMap.get(first.object.layerId)?.order ?? 0)
      - (layerMap.get(second.object.layerId)?.order ?? 0)
      || finite(first.object.zIndex, 0) - finite(second.object.zIndex, 0)
      || first.sourceIndex - second.sourceIndex
    ))
    .map(({ object }) => object);
}

export function resolveMaterialStyle(materialId, overrides = {}) {
  const materialValue = MATERIALS[materialId] ?? MATERIALS.paper;
  return {
    materialId: MATERIALS[materialId] ? materialId : "paper",
    fillColor: normalizeHex(overrides.fillColor, materialValue.fillColor),
    fillPattern: ARCHITECTURE_FILL_PATTERNS.includes(overrides.fillPattern)
      ? overrides.fillPattern
      : materialValue.fillPattern,
    fillOpacity: clamp(finite(overrides.fillOpacity, materialValue.fillOpacity), 0, 1),
    color: normalizeHex(overrides.color, materialValue.strokeColor),
  };
}

export function getArchitectureGeometryReport(objects, options = {}) {
  const records = (Array.isArray(objects) ? objects : [])
    .map((object) => ({ object, bounds: getSimpleBounds(object) }))
    .filter((record) => record.bounds);
  const clearance = Math.max(0, finite(options.clearance, 0));
  const intersections = [];
  if (options.includeIntersections !== false) {
    for (let firstIndex = 0; firstIndex < records.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < records.length; secondIndex += 1) {
        const first = records[firstIndex];
        const second = records[secondIndex];
        if (
          first.object.groupId
          && first.object.groupId === second.object.groupId
          && options.includeWithinGroups !== true
        ) {
          continue;
        }
        if (!boundsOverlap(first.bounds, second.bounds, clearance)) continue;
        intersections.push({
          firstId: first.object.id,
          secondId: second.object.id,
          overlap: overlapBounds(first.bounds, second.bounds),
        });
      }
    }
  }
  return {
    objectCount: records.length,
    bounds: combineBounds(records.map((record) => record.bounds)),
    intersections: intersections.slice(0, 500),
    omittedIntersectionCount: Math.max(0, intersections.length - 500),
  };
}

function normalizeLayers(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item, index) => {
      const id = String(item?.id ?? "").trim().toLowerCase();
      if (!IDENTIFIER_PATTERN.test(id) || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        name: String(item?.name ?? id).trim().slice(0, 80) || id,
        order: clamp(finite(item?.order, index), -10_000, 10_000),
        visible: item?.visible !== false,
      };
    })
    .filter(Boolean)
    .slice(0, 64);
}

function getSimpleBounds(object) {
  if (!object || typeof object !== "object") return null;
  if (Array.isArray(object.points) && object.points.length) {
    return pointsBounds(object.points);
  }
  if (Array.isArray(object.vertices) && object.vertices.length) {
    const points = object.vertices.map((point) => ({
      x: finite(object.x, 0) + finite(point.x, 0) * finite(object.w, 1),
      y: finite(object.y, 0) + finite(point.y, 0) * finite(object.h, 1),
    }));
    return pointsBounds(rotateFramePoints(points, object));
  }
  if (Number.isFinite(object.endX) && Number.isFinite(object.endY)) {
    const thickness = Math.max(1, finite(object.strokeWidth, finite(object.thickness, 1)));
    return {
      x: Math.min(object.x, object.endX) - thickness / 2,
      y: Math.min(object.y, object.endY) - thickness / 2,
      width: Math.abs(object.endX - object.x) + thickness,
      height: Math.abs(object.endY - object.y) + thickness,
    };
  }
  if ([object.x, object.y, object.w, object.h].every(Number.isFinite)) {
    return pointsBounds(rotateFramePoints([
      { x: object.x, y: object.y },
      { x: object.x + object.w, y: object.y },
      { x: object.x + object.w, y: object.y + object.h },
      { x: object.x, y: object.y + object.h },
    ], object));
  }
  return null;
}

function rotateFramePoints(points, object) {
  const angle = finite(object.rotation, 0);
  if (!angle) return points;
  const centerX = finite(object.x, 0) + finite(object.w, 0) / 2;
  const centerY = finite(object.y, 0) + finite(object.h, 0) / 2;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return points.map((point) => {
    const deltaX = point.x - centerX;
    const deltaY = point.y - centerY;
    return {
      x: centerX + deltaX * cosine - deltaY * sine,
      y: centerY + deltaX * sine + deltaY * cosine,
    };
  });
}

function pointsBounds(points) {
  const xValues = points.map((point) => finite(point.x, 0));
  const yValues = points.map((point) => finite(point.y, 0));
  const minimumX = Math.min(...xValues);
  const minimumY = Math.min(...yValues);
  return {
    x: minimumX,
    y: minimumY,
    width: Math.max(1, Math.max(...xValues) - minimumX),
    height: Math.max(1, Math.max(...yValues) - minimumY),
  };
}

function combineBounds(bounds) {
  if (!bounds.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function boundsOverlap(first, second, clearance) {
  return first.x - clearance <= second.x + second.width
    && first.x + first.width + clearance >= second.x
    && first.y - clearance <= second.y + second.height
    && first.y + first.height + clearance >= second.y;
}

function overlapBounds(first, second) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function layer(id, name, order) {
  return Object.freeze({ id, name, order, visible: true });
}

function material(label, fillColor, fillPattern, strokeColor, fillOpacity = 1) {
  return Object.freeze({ label, fillColor, fillPattern, strokeColor, fillOpacity });
}

function symbol(label, category, nominalWidth, nominalHeight, parts) {
  return Object.freeze({
    label,
    category,
    nominalWidth,
    nominalHeight,
    parts: Object.freeze(parts),
  });
}

function rectPart(x, y, w, h, fill, stroke) {
  return { type: "rect", x, y, w, h, fill, stroke };
}

function roundedRectPart(x, y, w, h, radius, fill, stroke) {
  return { type: "rounded-rect", x, y, w, h, radius, fill, stroke };
}

function ellipsePart(x, y, w, h, fill, stroke) {
  return { type: "ellipse", x, y, w, h, fill, stroke };
}

function linePart(x1, y1, x2, y2, stroke, width = 1) {
  return { type: "line", x1, y1, x2, y2, stroke, width };
}

function arcPart(cx, cy, radius, startAngle, endAngle, stroke, width = 1) {
  return { type: "arc", cx, cy, radius, startAngle, endAngle, stroke, width };
}

function polygonPart(points, fill, stroke) {
  return { type: "polygon", points, fill, stroke };
}

function clonePart(part) {
  return {
    ...part,
    ...(Array.isArray(part.points)
      ? { points: part.points.map((point) => [...point]) }
      : {}),
  };
}

function normalizeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value).toLowerCase() : fallback;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
