/**
 * Deterministic architectural primitives and bundled vector catalogs.
 *
 * The catalog contains rendering instructions only. It never chooses a layout:
 * callers provide every position, dimension, rotation, material, and layer.
 */

import {
  fitArchitectureSymbolFrame,
  pointToSegmentDistance,
  polygonsIntersect,
} from "./visual-board-architecture-geometry.mjs?v=1";

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
  "brick",
  "shingle",
  "marble",
  "slate",
  "sand",
  "mulch",
  "hedge",
  "asphalt",
]);

export const DEFAULT_ARCHITECTURE_LAYERS = Object.freeze([
  layer("reference", "Reference", -100),
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
  brick: material("Brick", "#bd8068", "brick", "#744d3e"),
  shingles: material("Roof shingles", "#796f65", "shingle", "#4b433d"),
  marble: material("Marble", "#ece9e1", "marble", "#aaa59d"),
  slate: material("Slate", "#7f8b91", "slate", "#4d585e"),
  sand: material("Sand", "#e1cc9b", "sand", "#a58e5e"),
  mulch: material("Mulch", "#79523d", "mulch", "#4d3125"),
  hedge: material("Hedge", "#527a4d", "hedge", "#31512f"),
  asphalt: material("Asphalt", "#777875", "asphalt", "#464743"),
  plaster: material("Plaster wall", "#e7dfd0", "solid", "#6d6258"),
  cabinetry: material("Cabinetry", "#b98b5b", "wood", "#735238"),
});

const ARCHITECTURE_STYLE_PRESETS = Object.freeze({
  "estate-illustrated": stylePreset(
    "Estate illustrated",
    {
      ink: "#43382f",
      wall: "#665448",
      wallFill: "#e4d8c6",
      accent: "#a56b3e",
      glass: "#bfe6ea",
      label: "#443a32",
    },
    {
      detail: 0.75,
      furniture: 1,
      partition: 5,
      exterior: 10,
      site: 7,
      boundary: 12,
      dimension: 0.75,
    },
    {
      title: typography("sans", 34, 700, 1.08),
      section: typography("sans", 24, 700, 1.08),
      room: typography("sans", 15, 600, 1.05),
      dimension: typography("sans", 11, 400, 1),
      note: typography("sans", 10, 400, 1.12),
    },
  ),
  technical: stylePreset(
    "Technical drawing",
    {
      ink: "#202020",
      wall: "#202020",
      wallFill: "#f4f4f1",
      accent: "#496879",
      glass: "#d8edf3",
      label: "#202020",
    },
    {
      detail: 0.55,
      furniture: 0.75,
      partition: 4,
      exterior: 8,
      site: 4,
      boundary: 8,
      dimension: 0.6,
    },
    {
      title: typography("sans", 32, 700, 1.05),
      section: typography("sans", 22, 700, 1.05),
      room: typography("sans", 14, 600, 1),
      dimension: typography("sans", 10, 400, 1),
      note: typography("sans", 9, 400, 1.08),
    },
  ),
  "presentation-soft": stylePreset(
    "Presentation soft",
    {
      ink: "#4b433d",
      wall: "#73665b",
      wallFill: "#f0e8dc",
      accent: "#8d5b46",
      glass: "#cae9ec",
      label: "#3e3833",
    },
    {
      detail: 0.8,
      furniture: 1,
      partition: 4,
      exterior: 8,
      site: 5,
      boundary: 9,
      dimension: 0.7,
    },
    {
      title: typography("serif", 36, 700, 1.1),
      section: typography("sans", 23, 700, 1.08),
      room: typography("sans", 15, 600, 1.08),
      dimension: typography("sans", 11, 400, 1),
      note: typography("sans", 10, 400, 1.12),
    },
  ),
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
  "door-single-reverse": hingedDoorSymbol("Reverse single door", false),
  "door-french": frenchDoorSymbol(),
  "door-sliding": slidingDoorSymbol(),
  "door-pocket": pocketDoorSymbol(),
  "door-bifold": bifoldDoorSymbol(),
  "window-casement": casementWindowSymbol(),
  "window-fixed": fixedWindowSymbol(),
  "window-bay": bayWindowSymbol(),
  "stairs-l": lStairsSymbol(),
  "stairs-u": uStairsSymbol(),
  "stairs-spiral": spiralStairsSymbol(),
  elevator: elevatorSymbol(),
  "column-square": simpleFixtureSymbol("Square column", "architecture", 2, 2, "stone", true),
  railing: railingSymbol(),
  "north-arrow": northArrowSymbol(),

  "bed-king": bedVariantSymbol("King bed", 6.4, 7, 2),
  "bed-full": bedVariantSymbol("Full bed", 4.5, 6.5, 2),
  "bed-bunk": bunkBedSymbol(),
  crib: cribSymbol(),
  nightstand: storageFurnitureSymbol("Nightstand", 2, 2, 2),
  dresser: storageFurnitureSymbol("Dresser", 6, 2, 6),
  wardrobe: storageFurnitureSymbol("Wardrobe", 6, 2.2, 3),
  "bedroom-bench": upholsteredBenchSymbol("Bedroom bench", 5, 2),

  "sofa-loveseat": sofaVariantSymbol("Loveseat", 5, 3, 2),
  "sofa-sectional-l": sectionalSofaSymbol(),
  "media-console": storageFurnitureSymbol("Media console", 7, 1.8, 4),
  "side-table": roundTableSymbol("Side table", 2.2, 2),
  "dining-table-4": diningTableSymbol("Dining table for four", 5, 4, 4),
  "dining-table-8": diningTableSymbol("Dining table for eight", 9, 4.5, 8),
  "dining-table-round-4": roundDiningTableSymbol(),
  "piano-grand": grandPianoSymbol(),
  "piano-upright": uprightPianoSymbol(),
  ottoman: upholsteredBenchSymbol("Ottoman", 3.5, 2.5),
  "console-table": storageFurnitureSymbol("Console table", 6, 1.8, 3),
  "rug-rect": rugSymbol(),

  "office-chair": officeChairSymbol(),
  "conference-table": diningTableSymbol("Conference table", 10, 4, 8),
  "filing-cabinet": storageFurnitureSymbol("Filing cabinet", 3, 2, 3),
  printer: simpleFixtureSymbol("Printer", "office", 2.5, 2, "glass", true),
  "drafting-table": draftingTableSymbol(),

  "counter-run": counterRunSymbol(),
  "cabinet-base": storageFurnitureSymbol("Base cabinet", 4, 2, 2),
  "cabinet-tall": storageFurnitureSymbol("Tall cabinet", 3, 2, 3),
  microwave: applianceSymbol("Microwave", 2.5, 2, 1),
  "oven-wall": applianceSymbol("Wall oven", 3, 2, 2),
  cooktop: cooktopSymbol(),
  "wine-fridge": applianceSymbol("Wine refrigerator", 2.5, 2.5, 4),
  "pantry-shelves": storageFurnitureSymbol("Pantry shelves", 6, 1.5, 6),
  "kitchen-table-4": diningTableSymbol("Kitchen table for four", 5, 3.5, 4),

  "double-vanity": doubleVanitySymbol(),
  bidet: simpleFixtureSymbol("Bidet", "bathroom", 2.5, 3.5, "paper", false),
  "shower-double": showerVariantSymbol("Double shower", 7, 4),
  "shower-corner": cornerShowerSymbol(),
  "bathtub-freestanding": freestandingTubSymbol(),
  "linen-cabinet": storageFurnitureSymbol("Linen cabinet", 3, 2, 3),
  "sauna-heater": saunaHeaterSymbol(),

  washer: laundryMachineSymbol("Washer"),
  dryer: laundryMachineSymbol("Dryer"),
  "water-heater": tankEquipmentSymbol("Water heater"),
  boiler: tankEquipmentSymbol("Boiler"),
  "utility-sink": simpleFixtureSymbol("Utility sink", "utility", 3.5, 2.5, "glass", false),
  "electrical-panel": panelEquipmentSymbol("Electrical panel"),
  "hvac-unit": hvacUnitSymbol(),

  "tool-cabinet": storageFurnitureSymbol("Tool cabinet", 6, 2, 6),
  pegboard: pegboardSymbol(),
  "storage-rack": storageFurnitureSymbol("Storage rack", 8, 2.5, 5),
  "table-saw": tableSawSymbol(),
  "drill-press": drillPressSymbol(),

  "dumbbell-rack": dumbbellRackSymbol(),
  "exercise-bike": exerciseBikeSymbol(),
  elliptical: ellipticalSymbol(),
  "rowing-machine": rowingMachineSymbol(),
  "yoga-mat": yogaMatSymbol(),
  "punching-bag": punchingBagSymbol(),

  truck: vehicleVariantSymbol("Pickup truck", 8, 17, true),
  suv: vehicleVariantSymbol("SUV", 8, 16, false),
  bicycle: bicycleSymbol(),
  motorcycle: motorcycleSymbol(),
  "outdoor-table": diningTableSymbol("Outdoor table", 7, 4, 6),
  grill: grillSymbol(),
  "fire-pit": firePitSymbol(),
  pergola: pergolaSymbol(),
  "lounge-chair": loungeChairSymbol(),
  "pool-steps": poolStepsSymbol(),
  fountain: fountainSymbol(),
  mailbox: mailboxSymbol(),

  "tree-evergreen": evergreenTreeSymbol(),
  "tree-ornamental": ornamentalTreeSymbol(),
  hedge: hedgeSymbol(),
  planter: planterSymbol(),
  "rock-cluster": rockClusterSymbol(),
  pond: pondSymbol(),
  "flower-cluster": flowerClusterSymbol(),
  groundcover: groundcoverSymbol(),
  "garden-bed": gardenBedSymbol(false),
  "vegetable-bed": gardenBedSymbol(true),
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
      preserveAspectRatio: value.preserveAspectRatio,
    })),
    fillPatterns: [...ARCHITECTURE_FILL_PATTERNS],
    defaultLayers: DEFAULT_ARCHITECTURE_LAYERS.map((value) => ({ ...value })),
    stylePresets: Object.entries(ARCHITECTURE_STYLE_PRESETS).map(([id, value]) => ({
      id,
      label: value.label,
      palette: { ...value.palette },
      lineWeights: { ...value.lineWeights },
      typography: cloneTypography(value.typography),
    })),
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

export function getArchitectureStylePreset(presetId) {
  const preset = ARCHITECTURE_STYLE_PRESETS[presetId];
  return preset
    ? {
      ...preset,
      palette: { ...preset.palette },
      lineWeights: { ...preset.lineWeights },
      typography: cloneTypography(preset.typography),
    }
    : null;
}

export function normalizeArchitectureSettings(value = {}) {
  const layers = normalizeLayers(value.layers);
  const stylePresetId = ARCHITECTURE_STYLE_PRESETS[value.stylePreset]
    ? value.stylePreset
    : "estate-illustrated";
  const preset = ARCHITECTURE_STYLE_PRESETS[stylePresetId];
  return {
    layers: layers.length
      ? layers
      : DEFAULT_ARCHITECTURE_LAYERS.map((item) => ({ ...item })),
    stylePreset: stylePresetId,
    lineWeights: normalizeLineWeights(value.lineWeights, preset.lineWeights),
    typography: normalizeTypography(value.typography, preset.typography),
    palette: normalizePalette(value.palette, preset.palette),
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

export function resolveArchitectureLineWeight(value, settings = {}) {
  const architecture = normalizeArchitectureSettings(settings);
  if (typeof value === "string" && architecture.lineWeights[value] !== undefined) {
    return architecture.lineWeights[value];
  }
  return clamp(finite(value, architecture.lineWeights.detail), 0.25, 240);
}

export function resolveArchitectureTypography(value, settings = {}) {
  const architecture = normalizeArchitectureSettings(settings);
  const role = typeof value === "string" && architecture.typography[value]
    ? value
    : "room";
  return { role, ...architecture.typography[role] };
}

export { fitArchitectureSymbolFrame };

export function getArchitectureGeometryReport(objects, options = {}) {
  const records = (Array.isArray(objects) ? objects : [])
    .map((object) => ({
      object,
      bounds: getSimpleBounds(object),
      polygon: getSimplePolygon(object),
    }))
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
        if (
          clearance <= 0
          && first.polygon
          && second.polygon
          && !polygonsIntersect(first.polygon, second.polygon)
        ) {
          continue;
        }
        intersections.push({
          firstId: first.object.id,
          secondId: second.object.id,
          overlap: overlapBounds(first.bounds, second.bounds),
        });
      }
    }
  }
  const quality = getArchitectureQuality(records, options);
  return {
    objectCount: records.length,
    bounds: combineBounds(records.map((record) => record.bounds)),
    intersections: intersections.slice(0, 500),
    omittedIntersectionCount: Math.max(0, intersections.length - 500),
    quality,
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

function normalizeLineWeights(value, fallback) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.fromEntries(Object.entries(fallback).map(([role, width]) => [
    role,
    clamp(finite(source[role], width), 0.25, 240),
  ]));
}

function normalizeTypography(value, fallback) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.fromEntries(Object.entries(fallback).map(([role, preset]) => {
    const override = source[role] && typeof source[role] === "object"
      ? source[role]
      : {};
    return [
      role,
      {
        fontFamily: ["serif", "sans", "mono", "typewriter", "handwriting"]
          .includes(override.fontFamily)
          ? override.fontFamily
          : preset.fontFamily,
        fontSize: clamp(finite(override.fontSize, preset.fontSize), 6, 96),
        fontWeight: clamp(
          Math.round(finite(override.fontWeight, preset.fontWeight) / 100) * 100,
          300,
          800,
        ),
        lineHeight: clamp(finite(override.lineHeight, preset.lineHeight), 0.8, 3),
      },
    ];
  }));
}

function normalizePalette(value, fallback) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.fromEntries(Object.entries(fallback).map(([role, color]) => [
    role,
    normalizeHex(source[role], color),
  ]));
}

function getArchitectureQuality(records, options) {
  const openingRecords = records.filter((record) => (
    record.object.type === "symbol"
    && (
      record.object.semantic?.role === "architecture-opening"
      || record.object.semantic?.role === "architecture-opening-cut"
    )
  ));
  const walls = records
    .map((record) => record.object)
    .filter((object) => object.type === "wall")
    .map((object) => ({ object, ...getWallEndpoints(object) }));
  const endpointTolerance = Math.max(0.25, finite(options.endpointTolerance, 2));
  const disconnectedWallEndpoints = [];
  if (options.includeConnectivity !== false) {
    walls.forEach((wall) => {
      [wall.start, wall.end].forEach((endpoint, endpointIndex) => {
        const connected = walls.some((candidate) => {
          if (candidate.object.id === wall.object.id) return false;
          return pointToSegmentDistance(endpoint, candidate.start, candidate.end)
            <= endpointTolerance;
        }) || openingRecords.some((opening) => (
          opening.object.semantic?.wallPathId
          && opening.object.semantic.wallPathId === wall.object.semantic?.wallPathId
          && (
            opening.object.semantic.segmentIndex === undefined
            || wall.object.semantic?.segmentIndex === undefined
            || Number(opening.object.semantic.segmentIndex)
              === Number(wall.object.semantic.segmentIndex)
          )
          && pointWithinExpandedBounds(endpoint, opening.bounds, endpointTolerance)
        ));
        if (!connected) {
          disconnectedWallEndpoints.push({
            wallId: wall.object.id,
            endpoint: endpointIndex === 0 ? "start" : "end",
            point: roundPoint(endpoint),
          });
        }
      });
    });
  }

  const labelCollisions = [];
  if (options.includeLabelCollisions !== false) {
    const labels = records.filter((record) => record.object.type === "textbox");
    const obstacles = records.filter((record) => (
      ["wall", "symbol"].includes(record.object.type)
      && record.object.semantic?.role !== "architecture-opening"
      && record.object.semantic?.role !== "architecture-opening-cut"
    ));
    labels.forEach((label) => {
      obstacles.forEach((obstacle) => {
        if (!boundsOverlap(label.bounds, obstacle.bounds, 0)) return;
        if (
          label.polygon
          && obstacle.polygon
          && !polygonsIntersect(label.polygon, obstacle.polygon)
        ) {
          return;
        }
        labelCollisions.push({
          labelId: label.object.id,
          obstacleId: obstacle.object.id,
        });
      });
    });
  }

  const distortedSymbols = records
    .map((record) => record.object)
    .filter((object) => object.type === "symbol" && object.fit === "stretch")
    .map((object) => {
      const definition = SYMBOLS[object.symbolId];
      if (!definition) return null;
      const nominalRatio = definition.nominalWidth / definition.nominalHeight;
      const actualRatio = Math.abs(object.w / object.h);
      const distortion = Math.abs(actualRatio / nominalRatio - 1);
      return distortion > Math.max(0.05, finite(options.aspectRatioTolerance, 0.2))
        ? {
          symbolId: object.id,
          catalogId: object.symbolId,
          distortion: roundNumber(distortion),
        }
        : null;
    })
    .filter(Boolean);

  const roomAccessIssues = [];
  if (options.includeRoomAccess !== false) {
    const roomIds = records
      .map((record) => record.object.semantic?.roomId)
      .filter(Boolean);
    [...new Set(roomIds)].forEach((roomId) => {
      const roomArea = records.find((record) => (
        record.object.type === "area"
        && record.object.semantic?.roomId === roomId
      ));
      if (!roomArea) return;
      const hasOpening = records.some((record) => (
        record.object.type === "symbol"
        && record.object.semantic?.roomId === roomId
        && (
          record.object.semantic?.role === "architecture-opening"
          || record.object.semantic?.role === "architecture-opening-cut"
        )
      ));
      if (!hasOpening) {
        roomAccessIssues.push({ roomId, areaId: roomArea.object.id });
      }
    });
  }

  const minimumClearance = Math.max(0, finite(options.minimumClearance, 0));
  const clearanceIssues = [];
  if (minimumClearance > 0) {
    const obstacles = records.filter((record) => (
      ["symbol", "wall"].includes(record.object.type)
      && !record.object.semantic?.tags?.includes("clearance-ignore")
    ));
    for (let firstIndex = 0; firstIndex < obstacles.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < obstacles.length; secondIndex += 1) {
        const first = obstacles[firstIndex];
        const second = obstacles[secondIndex];
        if (!boundsOverlap(first.bounds, second.bounds, minimumClearance)) continue;
        clearanceIssues.push({
          firstId: first.object.id,
          secondId: second.object.id,
          minimumClearance,
        });
      }
    }
  }

  return {
    disconnectedWallEndpoints: disconnectedWallEndpoints.slice(0, 500),
    omittedDisconnectedWallEndpointCount: Math.max(
      0,
      disconnectedWallEndpoints.length - 500,
    ),
    labelCollisions: labelCollisions.slice(0, 500),
    omittedLabelCollisionCount: Math.max(0, labelCollisions.length - 500),
    distortedSymbols: distortedSymbols.slice(0, 500),
    roomAccessIssues: roomAccessIssues.slice(0, 500),
    clearanceIssues: clearanceIssues.slice(0, 500),
    omittedClearanceIssueCount: Math.max(0, clearanceIssues.length - 500),
  };
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

function getSimplePolygon(object) {
  if (!object || typeof object !== "object") return null;
  if (Array.isArray(object.points) && object.points.length >= 3) {
    return object.points.map((point) => ({ x: finite(point.x, 0), y: finite(point.y, 0) }));
  }
  if (Array.isArray(object.vertices) && object.vertices.length >= 3) {
    const points = object.vertices.map((point) => ({
      x: finite(object.x, 0) + finite(point.x, 0) * finite(object.w, 1),
      y: finite(object.y, 0) + finite(point.y, 0) * finite(object.h, 1),
    }));
    return rotateFramePoints(points, object);
  }
  if ([object.x, object.y, object.w, object.h].every(Number.isFinite)) {
    return rotateFramePoints([
      { x: object.x, y: object.y },
      { x: object.x + object.w, y: object.y },
      { x: object.x + object.w, y: object.y + object.h },
      { x: object.x, y: object.y + object.h },
    ], object);
  }
  return null;
}

function getWallEndpoints(object) {
  const center = {
    x: finite(object.x, 0) + finite(object.w, 0) / 2,
    y: finite(object.y, 0) + finite(object.h, 0) / 2,
  };
  const halfLength = finite(object.w, 0) / 2;
  const rotation = finite(object.rotation, 0);
  const offset = {
    x: Math.cos(rotation) * halfLength,
    y: Math.sin(rotation) * halfLength,
  };
  return {
    start: { x: center.x - offset.x, y: center.y - offset.y },
    end: { x: center.x + offset.x, y: center.y + offset.y },
  };
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

function pointWithinExpandedBounds(point, bounds, clearance) {
  return point.x >= bounds.x - clearance
    && point.x <= bounds.x + bounds.width + clearance
    && point.y >= bounds.y - clearance
    && point.y <= bounds.y + bounds.height + clearance;
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

function roundPoint(point) {
  return { x: roundNumber(point.x), y: roundNumber(point.y) };
}

function roundNumber(value) {
  return Math.round(finite(value, 0) * 1000) / 1000;
}

function layer(id, name, order) {
  return Object.freeze({ id, name, order, visible: true });
}

function material(label, fillColor, fillPattern, strokeColor, fillOpacity = 1) {
  return Object.freeze({ label, fillColor, fillPattern, strokeColor, fillOpacity });
}

function stylePreset(label, palette, lineWeights, typographyPresets) {
  return Object.freeze({
    label,
    palette: Object.freeze(palette),
    lineWeights: Object.freeze(lineWeights),
    typography: Object.freeze(Object.fromEntries(
      Object.entries(typographyPresets).map(([role, value]) => [
        role,
        Object.freeze(value),
      ]),
    )),
  });
}

function typography(fontFamily, fontSize, fontWeight, lineHeight) {
  return { fontFamily, fontSize, fontWeight, lineHeight };
}

function cloneTypography(value) {
  return Object.fromEntries(
    Object.entries(value).map(([role, preset]) => [role, { ...preset }]),
  );
}

function symbol(label, category, nominalWidth, nominalHeight, parts, options = {}) {
  return Object.freeze({
    label,
    category,
    nominalWidth,
    nominalHeight,
    preserveAspectRatio: options.preserveAspectRatio !== false,
    parts: Object.freeze(parts),
  });
}

function hingedDoorSymbol(label, opensClockwise = true) {
  return symbol(label, "opening", 3, 3, [
    linePart(0.08, 0.08, 0.08, 0.92, "primary", 1.3),
    linePart(0.08, 0.08, 0.92, opensClockwise ? 0.08 : 0.92, "primary", 1.3),
    arcPart(
      0.08,
      opensClockwise ? 0.08 : 0.92,
      0.84,
      opensClockwise ? 0 : -Math.PI / 2,
      opensClockwise ? Math.PI / 2 : 0,
      "secondary",
    ),
  ]);
}

function frenchDoorSymbol() {
  return symbol("French doors", "opening", 6, 3, [
    linePart(0.5, 0.08, 0.08, 0.92, "primary", 1.1),
    linePart(0.5, 0.08, 0.92, 0.92, "primary", 1.1),
    arcPart(0.5, 0.08, 0.42, Math.PI / 2, Math.PI, "secondary"),
    arcPart(0.5, 0.08, 0.42, 0, Math.PI / 2, "secondary"),
    linePart(0.2, 0.48, 0.38, 0.48, "accent"),
    linePart(0.62, 0.48, 0.8, 0.48, "accent"),
  ]);
}

function slidingDoorSymbol() {
  return symbol("Sliding door", "opening", 8, 1.2, [
    rectPart(0.02, 0.28, 0.96, 0.44, "glass", "primary"),
    linePart(0.5, 0.28, 0.5, 0.72, "secondary"),
    linePart(0.08, 0.18, 0.92, 0.18, "accent"),
    linePart(0.08, 0.82, 0.92, 0.82, "accent"),
  ]);
}

function pocketDoorSymbol() {
  return symbol("Pocket door", "opening", 6, 1.2, [
    rectPart(0.03, 0.3, 0.46, 0.4, "paper", "primary"),
    linePart(0.52, 0.5, 0.95, 0.5, "secondary"),
    linePart(0.72, 0.3, 0.95, 0.5, "accent"),
    linePart(0.72, 0.7, 0.95, 0.5, "accent"),
  ]);
}

function bifoldDoorSymbol() {
  return symbol("Bifold door", "opening", 6, 1.6, [
    linePart(0.04, 0.5, 0.28, 0.12, "primary", 1.2),
    linePart(0.28, 0.12, 0.5, 0.5, "primary", 1.2),
    linePart(0.5, 0.5, 0.72, 0.12, "primary", 1.2),
    linePart(0.72, 0.12, 0.96, 0.5, "primary", 1.2),
    linePart(0.04, 0.82, 0.96, 0.82, "secondary"),
  ]);
}

function casementWindowSymbol() {
  return symbol("Casement window", "opening", 5, 1, [
    rectPart(0.02, 0.16, 0.96, 0.68, "glass", "primary"),
    linePart(0.5, 0.16, 0.5, 0.84, "secondary"),
    linePart(0.08, 0.2, 0.46, 0.8, "accent"),
    linePart(0.92, 0.2, 0.54, 0.8, "accent"),
  ]);
}

function fixedWindowSymbol() {
  return symbol("Fixed window", "opening", 5, 1, [
    rectPart(0.02, 0.14, 0.96, 0.72, "glass", "primary"),
    rectPart(0.1, 0.24, 0.8, 0.52, "paper", "secondary"),
  ]);
}

function bayWindowSymbol() {
  return symbol("Bay window", "opening", 7, 2, [
    polygonPart([[0.04, 0.75], [0.2, 0.18], [0.8, 0.18], [0.96, 0.75]], "glass", "primary"),
    linePart(0.2, 0.18, 0.28, 0.75, "secondary"),
    linePart(0.8, 0.18, 0.72, 0.75, "secondary"),
    linePart(0.28, 0.75, 0.72, 0.75, "secondary"),
  ]);
}

function lStairsSymbol() {
  return symbol("L-shaped stairs", "architecture", 7, 8, [
    rectPart(0.04, 0.04, 0.44, 0.92, "paper", "primary"),
    rectPart(0.48, 0.52, 0.48, 0.44, "paper", "primary"),
    ...Array.from({ length: 7 }, (_, index) => (
      linePart(0.04, 0.15 + index * 0.115, 0.48, 0.15 + index * 0.115, "secondary")
    )),
    ...Array.from({ length: 5 }, (_, index) => (
      linePart(0.58 + index * 0.075, 0.52, 0.58 + index * 0.075, 0.96, "secondary")
    )),
    linePart(0.26, 0.86, 0.74, 0.72, "accent", 1.2),
  ]);
}

function uStairsSymbol() {
  return symbol("U-shaped stairs", "architecture", 8, 8, [
    rectPart(0.04, 0.04, 0.38, 0.92, "paper", "primary"),
    rectPart(0.58, 0.04, 0.38, 0.92, "paper", "primary"),
    rectPart(0.42, 0.72, 0.16, 0.24, "paper", "primary"),
    ...Array.from({ length: 8 }, (_, index) => (
      linePart(0.04, 0.14 + index * 0.1, 0.42, 0.14 + index * 0.1, "secondary")
    )),
    ...Array.from({ length: 8 }, (_, index) => (
      linePart(0.58, 0.14 + index * 0.1, 0.96, 0.14 + index * 0.1, "secondary")
    )),
    linePart(0.23, 0.82, 0.77, 0.82, "accent", 1.2),
  ]);
}

function spiralStairsSymbol() {
  return symbol("Spiral stairs", "architecture", 7, 7, [
    ellipsePart(0.04, 0.04, 0.92, 0.92, "paper", "primary"),
    ...Array.from({ length: 12 }, (_, index) => {
      const angle = index / 12 * Math.PI * 2;
      return linePart(
        0.5,
        0.5,
        0.5 + Math.cos(angle) * 0.44,
        0.5 + Math.sin(angle) * 0.44,
        "secondary",
      );
    }),
    ellipsePart(0.43, 0.43, 0.14, 0.14, "stone", "accent"),
  ]);
}

function elevatorSymbol() {
  return symbol("Elevator", "architecture", 6, 6, [
    rectPart(0.04, 0.04, 0.92, 0.92, "paper", "primary"),
    linePart(0.5, 0.04, 0.5, 0.96, "secondary"),
    polygonPart([[0.25, 0.42], [0.36, 0.25], [0.47, 0.42]], "accent", "accent"),
    polygonPart([[0.53, 0.58], [0.64, 0.75], [0.75, 0.58]], "accent", "accent"),
  ]);
}

function railingSymbol() {
  return symbol("Railing", "architecture", 8, 1, [
    linePart(0.02, 0.18, 0.98, 0.18, "primary", 1.3),
    linePart(0.02, 0.82, 0.98, 0.82, "primary", 1.3),
    ...Array.from({ length: 8 }, (_, index) => (
      linePart(0.06 + index * 0.125, 0.18, 0.06 + index * 0.125, 0.82, "secondary")
    )),
  ]);
}

function northArrowSymbol() {
  return symbol("North arrow", "annotation", 3, 6, [
    linePart(0.5, 0.94, 0.5, 0.16, "primary", 1.4),
    polygonPart([[0.5, 0.02], [0.34, 0.28], [0.5, 0.2], [0.66, 0.28]], "primary", "primary"),
    linePart(0.28, 0.78, 0.28, 0.5, "secondary"),
    linePart(0.28, 0.5, 0.42, 0.78, "secondary"),
    linePart(0.42, 0.78, 0.42, 0.5, "secondary"),
  ]);
}

function bedVariantSymbol(label, width, height, pillows) {
  return symbol(label, "bedroom", width, height, [
    rectPart(0.04, 0.03, 0.92, 0.94, "paper", "primary"),
    rectPart(0.08, 0.05, 0.84, 0.2, "secondary", "secondary"),
    ...Array.from({ length: pillows }, (_, index) => {
      const pillowWidth = 0.72 / pillows;
      return roundedRectPart(
        0.14 + index * pillowWidth,
        0.09,
        pillowWidth - 0.04,
        0.14,
        0.05,
        "paper",
        "secondary",
      );
    }),
    linePart(0.08, 0.3, 0.92, 0.3, "secondary"),
  ]);
}

function bunkBedSymbol() {
  return symbol("Bunk bed", "bedroom", 4, 7, [
    rectPart(0.08, 0.04, 0.84, 0.36, "paper", "primary"),
    rectPart(0.08, 0.6, 0.84, 0.36, "paper", "primary"),
    linePart(0.12, 0.04, 0.12, 0.96, "primary", 1.3),
    linePart(0.88, 0.04, 0.88, 0.96, "primary", 1.3),
    ...[0.16, 0.28, 0.4, 0.52, 0.64, 0.76, 0.88].map((y) => (
      linePart(0.68, y, 0.88, y, "secondary")
    )),
  ]);
}

function cribSymbol() {
  return symbol("Crib", "bedroom", 3.5, 6, [
    roundedRectPart(0.05, 0.04, 0.9, 0.92, 0.08, "paper", "primary"),
    ...Array.from({ length: 8 }, (_, index) => (
      linePart(0.12 + index * 0.11, 0.08, 0.12 + index * 0.11, 0.92, "secondary")
    )),
  ]);
}

function storageFurnitureSymbol(label, width, height, divisions) {
  return symbol(label, "storage", width, height, [
    rectPart(0.03, 0.06, 0.94, 0.88, "hardwood", "primary"),
    ...Array.from({ length: Math.max(1, divisions - 1) }, (_, index) => (
      linePart(
        (index + 1) / divisions,
        0.08,
        (index + 1) / divisions,
        0.92,
        "secondary",
      )
    )),
    ...Array.from({ length: Math.min(divisions, 6) }, (_, index) => (
      ellipsePart((index + 0.5) / divisions - 0.015, 0.46, 0.03, 0.08, "accent", "accent")
    )),
  ]);
}

function upholsteredBenchSymbol(label, width, height) {
  return symbol(label, "living", width, height, [
    roundedRectPart(0.04, 0.12, 0.92, 0.7, 0.12, "secondary", "primary"),
    linePart(0.12, 0.82, 0.12, 0.96, "primary"),
    linePart(0.88, 0.82, 0.88, 0.96, "primary"),
  ]);
}

function sofaVariantSymbol(label, width, height, cushions) {
  return symbol(label, "living", width, height, [
    roundedRectPart(0.03, 0.08, 0.94, 0.84, 0.12, "secondary", "primary"),
    roundedRectPart(0.12, 0.22, 0.76, 0.58, 0.08, "paper", "secondary"),
    ...Array.from({ length: cushions - 1 }, (_, index) => (
      linePart(0.12 + (index + 1) * 0.76 / cushions, 0.23, 0.12 + (index + 1) * 0.76 / cushions, 0.8, "secondary")
    )),
  ]);
}

function sectionalSofaSymbol() {
  return symbol("L-sectional sofa", "living", 9, 7, [
    roundedRectPart(0.03, 0.05, 0.94, 0.38, 0.09, "secondary", "primary"),
    roundedRectPart(0.03, 0.39, 0.38, 0.56, 0.09, "secondary", "primary"),
    roundedRectPart(0.12, 0.16, 0.76, 0.18, 0.05, "paper", "secondary"),
    roundedRectPart(0.12, 0.43, 0.2, 0.43, 0.05, "paper", "secondary"),
  ]);
}

function roundTableSymbol(label, size) {
  return symbol(label, "living", size, size, [
    ellipsePart(0.05, 0.05, 0.9, 0.9, "hardwood", "primary"),
    ellipsePart(0.42, 0.42, 0.16, 0.16, "paper", "secondary"),
  ]);
}

function diningTableSymbol(label, width, height, chairCount) {
  const chairs = [];
  const sideCount = Math.max(1, Math.floor((chairCount - 2) / 2));
  for (let index = 0; index < sideCount; index += 1) {
    const x = 0.24 + index * 0.52 / Math.max(1, sideCount - 1);
    chairs.push(roundedRectPart(x - 0.07, 0.01, 0.14, 0.12, 0.03, "secondary", "secondary"));
    chairs.push(roundedRectPart(x - 0.07, 0.87, 0.14, 0.12, 0.03, "secondary", "secondary"));
  }
  chairs.push(roundedRectPart(0.01, 0.38, 0.13, 0.24, 0.03, "secondary", "secondary"));
  chairs.push(roundedRectPart(0.86, 0.38, 0.13, 0.24, 0.03, "secondary", "secondary"));
  return symbol(label, "living", width, height, [
    roundedRectPart(0.16, 0.15, 0.68, 0.7, 0.06, "hardwood", "primary"),
    ...chairs.slice(0, chairCount),
  ]);
}

function roundDiningTableSymbol() {
  return symbol("Round dining table for four", "living", 5.5, 5.5, [
    ellipsePart(0.19, 0.19, 0.62, 0.62, "hardwood", "primary"),
    ...[[0.42, 0.01, 0.16, 0.15], [0.42, 0.84, 0.16, 0.15], [0.01, 0.42, 0.15, 0.16], [0.84, 0.42, 0.15, 0.16]]
      .map(([x, y, w, h]) => roundedRectPart(x, y, w, h, 0.04, "secondary", "secondary")),
  ]);
}

function grandPianoSymbol() {
  return symbol("Grand piano", "living", 6, 7, [
    polygonPart([[0.08, 0.08], [0.84, 0.06], [0.94, 0.5], [0.68, 0.94], [0.16, 0.84]], "primary", "primary"),
    polygonPart([[0.16, 0.15], [0.75, 0.13], [0.8, 0.48], [0.58, 0.82], [0.22, 0.74]], "hardwood", "secondary"),
    ...Array.from({ length: 9 }, (_, index) => (
      linePart(0.16 + index * 0.055, 0.78 - index * 0.015, 0.2 + index * 0.055, 0.9 - index * 0.012, "paper")
    )),
  ]);
}

function uprightPianoSymbol() {
  return symbol("Upright piano", "living", 6, 2.5, [
    rectPart(0.03, 0.06, 0.94, 0.88, "hardwood", "primary"),
    rectPart(0.12, 0.58, 0.76, 0.23, "paper", "secondary"),
    ...Array.from({ length: 12 }, (_, index) => (
      linePart(0.14 + index * 0.064, 0.58, 0.14 + index * 0.064, 0.81, "secondary")
    )),
  ]);
}

function rugSymbol() {
  return symbol("Area rug", "living", 8, 6, [
    roundedRectPart(0.03, 0.04, 0.94, 0.92, 0.05, "secondary", "secondary"),
    roundedRectPart(0.1, 0.11, 0.8, 0.78, 0.04, "paper", "accent"),
    polygonPart([[0.5, 0.2], [0.8, 0.5], [0.5, 0.8], [0.2, 0.5]], "secondary", "accent"),
  ]);
}

function officeChairSymbol() {
  return symbol("Office chair", "office", 2.5, 2.5, [
    roundedRectPart(0.2, 0.15, 0.6, 0.56, 0.12, "secondary", "primary"),
    linePart(0.5, 0.7, 0.5, 0.84, "primary", 1.2),
    ...Array.from({ length: 5 }, (_, index) => {
      const angle = index / 5 * Math.PI * 2;
      return linePart(0.5, 0.82, 0.5 + Math.cos(angle) * 0.38, 0.82 + Math.sin(angle) * 0.16, "primary");
    }),
  ]);
}

function draftingTableSymbol() {
  return symbol("Drafting table", "office", 6, 3.5, [
    polygonPart([[0.06, 0.2], [0.88, 0.05], [0.96, 0.72], [0.14, 0.88]], "hardwood", "primary"),
    rectPart(0.22, 0.3, 0.48, 0.38, "paper", "secondary"),
    linePart(0.48, 0.74, 0.48, 0.98, "primary"),
  ]);
}

function counterRunSymbol() {
  return symbol("Counter run", "kitchen", 8, 2.2, [
    rectPart(0.02, 0.08, 0.96, 0.84, "stone", "primary"),
    linePart(0.02, 0.25, 0.98, 0.25, "accent"),
    ...Array.from({ length: 4 }, (_, index) => (
      linePart(0.2 + index * 0.2, 0.25, 0.2 + index * 0.2, 0.92, "secondary")
    )),
  ]);
}

function applianceSymbol(label, width, height, divisions) {
  return symbol(label, "kitchen", width, height, [
    rectPart(0.04, 0.04, 0.92, 0.92, "glass", "primary"),
    ...Array.from({ length: divisions }, (_, index) => (
      linePart(0.1, 0.2 + index * 0.6 / Math.max(1, divisions - 1), 0.9, 0.2 + index * 0.6 / Math.max(1, divisions - 1), "secondary")
    )),
    linePart(0.36, 0.12, 0.64, 0.12, "accent"),
  ]);
}

function cooktopSymbol() {
  return symbol("Cooktop", "kitchen", 3.5, 3, [
    rectPart(0.04, 0.04, 0.92, 0.92, "glass", "primary"),
    ...[[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]]
      .map(([x, y]) => ellipsePart(x - 0.13, y - 0.13, 0.26, 0.26, "paper", "secondary")),
  ]);
}

function doubleVanitySymbol() {
  return symbol("Double vanity", "bathroom", 8, 2.2, [
    rectPart(0.03, 0.08, 0.94, 0.84, "hardwood", "primary"),
    ellipsePart(0.18, 0.22, 0.24, 0.45, "glass", "secondary"),
    ellipsePart(0.58, 0.22, 0.24, 0.45, "glass", "secondary"),
    arcPart(0.3, 0.28, 0.11, Math.PI, Math.PI * 2, "accent"),
    arcPart(0.7, 0.28, 0.11, Math.PI, Math.PI * 2, "accent"),
  ]);
}

function showerVariantSymbol(label, width, height) {
  return symbol(label, "bathroom", width, height, [
    roundedRectPart(0.03, 0.03, 0.94, 0.94, 0.06, "tile", "primary"),
    linePart(0.06, 0.06, 0.94, 0.94, "secondary"),
    linePart(0.94, 0.06, 0.06, 0.94, "secondary"),
    ellipsePart(0.46, 0.46, 0.08, 0.08, "glass", "accent"),
  ]);
}

function cornerShowerSymbol() {
  return symbol("Corner shower", "bathroom", 4, 4, [
    polygonPart([[0.04, 0.04], [0.96, 0.04], [0.96, 0.96]], "tile", "primary"),
    arcPart(0.96, 0.04, 0.92, Math.PI / 2, Math.PI, "secondary"),
    ellipsePart(0.72, 0.22, 0.1, 0.1, "glass", "accent"),
  ]);
}

function freestandingTubSymbol() {
  return symbol("Freestanding bathtub", "bathroom", 6.5, 3.5, [
    ellipsePart(0.02, 0.06, 0.96, 0.88, "paper", "primary"),
    ellipsePart(0.12, 0.18, 0.76, 0.64, "water", "secondary"),
    arcPart(0.82, 0.28, 0.12, Math.PI, Math.PI * 2, "accent"),
  ]);
}

function saunaHeaterSymbol() {
  return symbol("Sauna heater", "sauna", 3, 3, [
    roundedRectPart(0.08, 0.08, 0.84, 0.84, 0.1, "stone", "primary"),
    ...[[0.3, 0.3], [0.55, 0.25], [0.72, 0.48], [0.4, 0.62], [0.62, 0.72]]
      .map(([x, y]) => ellipsePart(x - 0.1, y - 0.08, 0.2, 0.16, "secondary", "secondary")),
  ]);
}

function laundryMachineSymbol(label) {
  return symbol(label, "utility", 3, 3.2, [
    rectPart(0.04, 0.04, 0.92, 0.92, "glass", "primary"),
    ellipsePart(0.18, 0.24, 0.64, 0.58, "paper", "secondary"),
    ellipsePart(0.28, 0.34, 0.44, 0.38, "glass", "accent"),
    linePart(0.12, 0.16, 0.88, 0.16, "secondary"),
  ]);
}

function tankEquipmentSymbol(label) {
  return symbol(label, "utility", 3.5, 4.5, [
    roundedRectPart(0.12, 0.04, 0.76, 0.92, 0.18, "glass", "primary"),
    ellipsePart(0.12, 0.04, 0.76, 0.18, "paper", "secondary"),
    linePart(0.32, 0.02, 0.32, 0.18, "accent"),
    linePart(0.68, 0.02, 0.68, 0.18, "accent"),
  ]);
}

function panelEquipmentSymbol(label) {
  return symbol(label, "utility", 3, 4, [
    rectPart(0.05, 0.04, 0.9, 0.92, "paper", "primary"),
    ...Array.from({ length: 5 }, (_, index) => (
      linePart(0.18, 0.18 + index * 0.14, 0.82, 0.18 + index * 0.14, "secondary")
    )),
    ellipsePart(0.78, 0.46, 0.06, 0.08, "accent", "accent"),
  ]);
}

function hvacUnitSymbol() {
  return symbol("HVAC unit", "utility", 5, 5, [
    rectPart(0.04, 0.04, 0.92, 0.92, "glass", "primary"),
    ellipsePart(0.18, 0.18, 0.64, 0.64, "paper", "secondary"),
    ...Array.from({ length: 8 }, (_, index) => {
      const angle = index / 8 * Math.PI * 2;
      return linePart(0.5, 0.5, 0.5 + Math.cos(angle) * 0.28, 0.5 + Math.sin(angle) * 0.28, "secondary");
    }),
  ]);
}

function pegboardSymbol() {
  return symbol("Pegboard", "workshop", 8, 3, [
    rectPart(0.02, 0.04, 0.96, 0.92, "hardwood", "primary"),
    ...Array.from({ length: 6 }, (_, column) => (
      Array.from({ length: 3 }, (_, row) => (
        ellipsePart(0.1 + column * 0.15, 0.18 + row * 0.28, 0.025, 0.05, "secondary", "secondary")
      ))
    )).flat(),
  ]);
}

function tableSawSymbol() {
  return symbol("Table saw", "workshop", 6, 4, [
    rectPart(0.04, 0.08, 0.92, 0.84, "stone", "primary"),
    ellipsePart(0.34, 0.18, 0.32, 0.64, "paper", "accent"),
    linePart(0.5, 0.18, 0.5, 0.82, "accent", 1.5),
    linePart(0.16, 0.5, 0.84, 0.5, "secondary"),
  ]);
}

function drillPressSymbol() {
  return symbol("Drill press", "workshop", 3.5, 4.5, [
    rectPart(0.1, 0.72, 0.8, 0.22, "stone", "primary"),
    linePart(0.5, 0.12, 0.5, 0.78, "primary", 1.5),
    ellipsePart(0.22, 0.06, 0.56, 0.28, "glass", "primary"),
    rectPart(0.28, 0.42, 0.44, 0.16, "hardwood", "secondary"),
  ]);
}

function dumbbellRackSymbol() {
  return symbol("Dumbbell rack", "gym", 8, 2.5, [
    linePart(0.04, 0.26, 0.96, 0.26, "primary", 1.4),
    linePart(0.04, 0.74, 0.96, 0.74, "primary", 1.4),
    ...Array.from({ length: 6 }, (_, index) => (
      roundedRectPart(0.08 + index * 0.15, 0.14 + index % 2 * 0.48, 0.1, 0.2, 0.03, "accent", "primary")
    )),
  ]);
}

function exerciseBikeSymbol() {
  return symbol("Exercise bike", "gym", 5, 3.5, [
    ellipsePart(0.08, 0.42, 0.32, 0.46, "paper", "primary"),
    ellipsePart(0.6, 0.42, 0.32, 0.46, "paper", "primary"),
    linePart(0.24, 0.65, 0.52, 0.3, "primary", 1.3),
    linePart(0.52, 0.3, 0.76, 0.65, "primary", 1.3),
    linePart(0.52, 0.3, 0.72, 0.12, "primary", 1.3),
    linePart(0.66, 0.1, 0.84, 0.1, "accent", 1.2),
  ]);
}

function ellipticalSymbol() {
  return symbol("Elliptical trainer", "gym", 6, 3.5, [
    roundedRectPart(0.08, 0.65, 0.84, 0.22, 0.08, "glass", "primary"),
    linePart(0.28, 0.68, 0.42, 0.14, "primary", 1.4),
    linePart(0.72, 0.68, 0.58, 0.14, "primary", 1.4),
    linePart(0.35, 0.2, 0.18, 0.05, "accent", 1.2),
    linePart(0.65, 0.2, 0.82, 0.05, "accent", 1.2),
  ]);
}

function rowingMachineSymbol() {
  return symbol("Rowing machine", "gym", 8, 2.5, [
    roundedRectPart(0.05, 0.55, 0.9, 0.22, 0.05, "glass", "primary"),
    roundedRectPart(0.34, 0.38, 0.2, 0.26, 0.04, "secondary", "primary"),
    linePart(0.54, 0.48, 0.86, 0.18, "accent", 1.2),
    linePart(0.52, 0.5, 0.82, 0.5, "primary"),
  ]);
}

function yogaMatSymbol() {
  return symbol("Yoga mat", "gym", 7, 2.5, [
    roundedRectPart(0.03, 0.08, 0.94, 0.84, 0.12, "accent", "primary"),
    linePart(0.12, 0.5, 0.88, 0.5, "secondary"),
  ]);
}

function punchingBagSymbol() {
  return symbol("Punching bag", "gym", 2.5, 5, [
    linePart(0.5, 0.02, 0.5, 0.18, "primary", 1.3),
    roundedRectPart(0.2, 0.16, 0.6, 0.78, 0.2, "accent", "primary"),
    linePart(0.35, 0.04, 0.45, 0.18, "secondary"),
    linePart(0.65, 0.04, 0.55, 0.18, "secondary"),
  ]);
}

function vehicleVariantSymbol(label, width, height, hasBed) {
  return symbol(label, "site", width, height, [
    roundedRectPart(0.1, 0.03, 0.8, 0.94, 0.16, "secondary", "primary"),
    roundedRectPart(0.18, 0.18, 0.64, hasBed ? 0.3 : 0.52, 0.1, "glass", "secondary"),
    ...(hasBed ? [rectPart(0.18, 0.56, 0.64, 0.28, "paper", "secondary")] : []),
    linePart(0.18, 0.48, 0.82, 0.48, "secondary"),
    ...[[0.02, 0.2], [0.88, 0.2], [0.02, 0.7], [0.88, 0.7]]
      .map(([x, y]) => roundedRectPart(x, y, 0.1, 0.14, 0.03, "primary", "primary")),
  ]);
}

function bicycleSymbol() {
  return symbol("Bicycle", "site", 6, 2.5, [
    ellipsePart(0.02, 0.24, 0.3, 0.64, "paper", "primary"),
    ellipsePart(0.68, 0.24, 0.3, 0.64, "paper", "primary"),
    linePart(0.17, 0.56, 0.5, 0.28, "primary", 1.2),
    linePart(0.5, 0.28, 0.83, 0.56, "primary", 1.2),
    linePart(0.17, 0.56, 0.58, 0.62, "primary", 1.2),
    linePart(0.58, 0.62, 0.5, 0.28, "primary", 1.2),
  ]);
}

function motorcycleSymbol() {
  return symbol("Motorcycle", "site", 6, 2.8, [
    ellipsePart(0.02, 0.28, 0.3, 0.58, "paper", "primary"),
    ellipsePart(0.68, 0.28, 0.3, 0.58, "paper", "primary"),
    polygonPart([[0.2, 0.56], [0.45, 0.22], [0.72, 0.48], [0.58, 0.68]], "accent", "primary"),
    roundedRectPart(0.4, 0.1, 0.24, 0.2, 0.05, "secondary", "primary"),
  ]);
}

function grillSymbol() {
  return symbol("Outdoor grill", "site", 4, 3, [
    roundedRectPart(0.08, 0.15, 0.84, 0.58, 0.16, "primary", "primary"),
    linePart(0.12, 0.36, 0.88, 0.36, "secondary"),
    ...Array.from({ length: 5 }, (_, index) => (
      linePart(0.22 + index * 0.14, 0.2, 0.22 + index * 0.14, 0.66, "paper")
    )),
    linePart(0.25, 0.72, 0.2, 0.96, "primary"),
    linePart(0.75, 0.72, 0.8, 0.96, "primary"),
  ]);
}

function firePitSymbol() {
  return symbol("Fire pit", "site", 5, 5, [
    ellipsePart(0.04, 0.04, 0.92, 0.92, "stone", "primary"),
    ellipsePart(0.22, 0.22, 0.56, 0.56, "primary", "secondary"),
    polygonPart([[0.5, 0.24], [0.62, 0.48], [0.56, 0.7], [0.42, 0.62], [0.36, 0.42]], "accent", "accent"),
  ]);
}

function pergolaSymbol() {
  return symbol("Pergola", "site", 12, 8, [
    rectPart(0.04, 0.04, 0.92, 0.92, "paper", "primary"),
    ...Array.from({ length: 7 }, (_, index) => (
      linePart(0.1 + index * 0.13, 0.04, 0.1 + index * 0.13, 0.96, "hardwood", 1.2)
    )),
    ...[[0.04, 0.04], [0.9, 0.04], [0.04, 0.88], [0.9, 0.88]]
      .map(([x, y]) => rectPart(x, y, 0.06, 0.08, "stone", "primary")),
  ]);
}

function loungeChairSymbol() {
  return symbol("Lounge chair", "site", 3, 7, [
    roundedRectPart(0.12, 0.05, 0.76, 0.9, 0.12, "secondary", "primary"),
    linePart(0.12, 0.38, 0.88, 0.38, "secondary"),
    linePart(0.18, 0.94, 0.12, 0.99, "primary"),
    linePart(0.82, 0.94, 0.88, 0.99, "primary"),
  ]);
}

function poolStepsSymbol() {
  return symbol("Pool steps", "site", 5, 3, [
    ...Array.from({ length: 3 }, (_, index) => (
      arcPart(0.5, 0.92, 0.42 - index * 0.1, Math.PI, Math.PI * 2, index === 2 ? "accent" : "primary")
    )),
  ]);
}

function fountainSymbol() {
  return symbol("Fountain", "site", 6, 6, [
    ellipsePart(0.03, 0.03, 0.94, 0.94, "stone", "primary"),
    ellipsePart(0.14, 0.14, 0.72, 0.72, "water", "secondary"),
    ellipsePart(0.4, 0.4, 0.2, 0.2, "stone", "primary"),
    ...Array.from({ length: 8 }, (_, index) => {
      const angle = index / 8 * Math.PI * 2;
      return linePart(0.5, 0.5, 0.5 + Math.cos(angle) * 0.3, 0.5 + Math.sin(angle) * 0.3, "accent");
    }),
  ]);
}

function mailboxSymbol() {
  return symbol("Mailbox", "site", 2.5, 4, [
    roundedRectPart(0.12, 0.05, 0.76, 0.42, 0.16, "secondary", "primary"),
    linePart(0.5, 0.45, 0.5, 0.96, "primary", 1.3),
    linePart(0.7, 0.12, 0.94, 0.12, "accent", 1.2),
    linePart(0.94, 0.12, 0.94, 0.3, "accent", 1.2),
  ]);
}

function evergreenTreeSymbol() {
  return symbol("Evergreen tree", "landscape", 8, 8, [
    polygonPart([[0.5, 0.03], [0.82, 0.44], [0.68, 0.42], [0.92, 0.76], [0.58, 0.68], [0.5, 0.96], [0.42, 0.68], [0.08, 0.76], [0.32, 0.42], [0.18, 0.44]], "planting", "primary"),
    ellipsePart(0.44, 0.44, 0.12, 0.12, "hardwood", "secondary"),
  ]);
}

function ornamentalTreeSymbol() {
  return symbol("Ornamental tree", "landscape", 7, 7, [
    ...[[0.12, 0.22, 0.46, 0.48], [0.42, 0.1, 0.46, 0.48], [0.3, 0.38, 0.46, 0.46]]
      .map(([x, y, w, h]) => ellipsePart(x, y, w, h, "flowers", "primary")),
    ellipsePart(0.44, 0.44, 0.12, 0.12, "hardwood", "secondary"),
  ]);
}

function hedgeSymbol() {
  return symbol("Hedge", "landscape", 10, 3, [
    ...Array.from({ length: 6 }, (_, index) => (
      ellipsePart(index * 0.16, 0.1 + index % 2 * 0.12, 0.28, 0.74, "hedge", "primary")
    )),
  ]);
}

function planterSymbol() {
  return symbol("Planter", "landscape", 5, 3, [
    roundedRectPart(0.04, 0.2, 0.92, 0.7, 0.12, "stone", "primary"),
    ellipsePart(0.12, 0.08, 0.76, 0.42, "planting", "secondary"),
    ...[[0.26, 0.04], [0.48, 0.02], [0.7, 0.05]]
      .map(([x, y]) => ellipsePart(x - 0.1, y, 0.2, 0.35, "flowers", "accent")),
  ]);
}

function rockClusterSymbol() {
  return symbol("Rock cluster", "landscape", 7, 5, [
    ellipsePart(0.04, 0.3, 0.42, 0.58, "stone", "primary"),
    ellipsePart(0.32, 0.08, 0.46, 0.7, "stone", "primary"),
    ellipsePart(0.62, 0.36, 0.34, 0.48, "stone", "primary"),
    linePart(0.2, 0.42, 0.33, 0.67, "secondary"),
    linePart(0.52, 0.18, 0.61, 0.56, "secondary"),
  ]);
}

function pondSymbol() {
  return symbol("Garden pond", "landscape", 10, 7, [
    polygonPart([[0.1, 0.28], [0.28, 0.08], [0.64, 0.05], [0.92, 0.3], [0.84, 0.72], [0.54, 0.94], [0.2, 0.82], [0.04, 0.54]], "water", "primary"),
    ...[[0.28, 0.32], [0.62, 0.25], [0.55, 0.65]]
      .map(([x, y]) => ellipsePart(x, y, 0.18, 0.14, "planting", "accent")),
  ]);
}

function flowerClusterSymbol() {
  return symbol("Flower cluster", "landscape", 5, 5, [
    ...Array.from({ length: 11 }, (_, index) => {
      const angle = index / 11 * Math.PI * 2;
      const radius = index % 2 ? 0.3 : 0.42;
      return ellipsePart(
        0.5 + Math.cos(angle) * radius - 0.07,
        0.5 + Math.sin(angle) * radius - 0.07,
        0.14,
        0.14,
        index % 3 ? "flowers" : "accent",
        "primary",
      );
    }),
  ]);
}

function groundcoverSymbol() {
  return symbol("Groundcover", "landscape", 8, 5, [
    ...Array.from({ length: 13 }, (_, index) => {
      const column = index % 5;
      const row = Math.floor(index / 5);
      return ellipsePart(0.04 + column * 0.19 + row * 0.04, 0.08 + row * 0.28, 0.28, 0.38, "planting", "primary");
    }),
  ]);
}

function gardenBedSymbol(vegetable) {
  return symbol(vegetable ? "Vegetable bed" : "Garden bed", "landscape", 9, 5, [
    roundedRectPart(0.03, 0.05, 0.94, 0.9, 0.05, "mulch", "primary"),
    ...Array.from({ length: 4 }, (_, row) => (
      linePart(0.1, 0.2 + row * 0.2, 0.9, 0.2 + row * 0.2, vegetable ? "planting" : "flowers", 1.4)
    )),
    ...Array.from({ length: 8 }, (_, index) => (
      ellipsePart(0.14 + index % 4 * 0.22, 0.15 + Math.floor(index / 4) * 0.42, 0.08, 0.12, vegetable ? "planting" : "flowers", "accent")
    )),
  ]);
}

function simpleFixtureSymbol(label, category, width, height, fill, inset) {
  return symbol(label, category, width, height, [
    roundedRectPart(0.05, 0.05, 0.9, 0.9, 0.08, fill, "primary"),
    ...(inset ? [roundedRectPart(0.22, 0.22, 0.56, 0.56, 0.06, "paper", "secondary")] : []),
  ]);
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
