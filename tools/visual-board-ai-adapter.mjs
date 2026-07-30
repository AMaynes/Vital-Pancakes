/**
 * Provider-independent Visual Board command adapter.
 *
 * Commands operate on cloned board state. The page controller supplies one
 * atomic commit callback, so a multi-command request becomes one saved,
 * undoable board action and a failed request never touches live state.
 */

import {
  AiCommandError,
  cloneJson,
  isRecord,
} from "../app/ai-command-protocol.mjs";
import {
  FLOOR_PLAN_ELEMENTS,
  FLOOR_PLAN_TEMPLATES,
  addFloorPlanRoom,
  createFloorPlanElement,
  createFloorPlanTemplate,
  hasFloorPlanRemovalPassword,
  moveFloorPlanRoom,
  normalizeFloorPlanSettings,
  normalizeFloorPlanRoomState,
  removeActiveFloorPlanRoom,
} from "./visual-board-floor-plan.mjs?v=6";
import {
  addFloorPlanTemplate,
  createFloorPlanTemplateRecord,
  getFloorPlanTemplateCatalog,
  getFloorPlanTemplateRecord,
  removeFloorPlanTemplate,
  replaceFloorPlanTemplate,
  restoreBuiltInFloorPlanTemplate,
  updateFloorPlanTemplate,
} from "./visual-board-floor-plan-templates.mjs?v=3";
import {
  createCharacterPackage,
  instantiateCharacter,
} from "./visual-board-character.mjs?v=2";
import {
  getCurveVertices,
  insertCurveVertex,
  normalizeCurveGeometry,
  reinitializeCurveVertices,
  transformCurveGeometry,
} from "./visual-board-curves.mjs?v=3";
import { createEditableVertexNetwork } from "./visual-board-vertices.mjs?v=3";
import {
  ARCHITECTURE_FILL_PATTERNS,
  getArchitectureCatalog,
  getArchitectureGeometryReport,
  getArchitectureStylePreset,
  getArchitectureMaterial,
  getArchitectureSymbol,
  normalizeArchitectureSettings,
  resolveArchitectureLineWeight,
  resolveArchitectureTypography,
  resolveMaterialStyle,
} from "./visual-board-architecture.mjs?v=2";
import {
  ARCHITECTURE_PATH_OPERATIONS,
  ARCHITECTURE_SYMBOL_FITS,
  ARCHITECTURE_WALL_CAPS,
  ARCHITECTURE_WALL_JOINS,
  buildWallPathGeometry,
  sampleArchitecturePath,
} from "./visual-board-architecture-geometry.mjs?v=1";
import {
  getObjectBounds,
  getObjectSegments,
} from "./visual-board-geometry.mjs?v=11";
import { flipBoardSelection } from "./visual-board-transform.mjs?v=3";

const MAX_OBJECTS_PER_REQUEST = 500;
const MAX_BOARD_OBJECTS = 10_000;
const MAX_TEXT_LENGTH = 4_000;
const MAX_NESTING_DEPTH = 12;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 48;
const COORDINATE_LIMIT = 1_000_000;
const DIMENSION_LIMIT = 100_000;
const DEFAULT_NODE_WIDTH = 190;
const DEFAULT_NODE_HEIGHT = 88;
const DEFAULT_HORIZONTAL_GAP = 110;
const DEFAULT_VERTICAL_GAP = 70;

const OBJECT_TYPES = new Set([
  "rectangle",
  "ellipse",
  "shape",
  "textbox",
  "line",
  "connector",
  "arc",
]);
const SHAPE_KINDS = new Set([
  "triangle",
  "diamond",
  "hexagon",
  "cube",
  "triangular-prism",
  "pyramid",
  "cylinder",
  "cone",
]);
const DASH_PATTERNS = new Set(["solid", "dashed", "dotted", "dash-dot", "long-dash"]);
const FONT_FAMILIES = new Set(["serif", "sans", "mono", "typewriter", "handwriting"]);
const DIAGRAM_TYPES = new Set([
  "flowchart",
  "mind-map",
  "hierarchy",
  "organization-chart",
  "timeline",
  "sequence",
  "comparison-table",
  "grid",
  "network",
]);
const LAYOUT_TYPES = new Set([
  "horizontal",
  "vertical",
  "grid",
  "align-left",
  "align-right",
  "align-top",
  "align-bottom",
  "distribute-horizontal",
  "distribute-vertical",
]);
const STYLE_PRESET_NAMES = Object.freeze([
  "current",
  "archival",
  "minimal",
  "technical",
  "monochrome",
  "color-coded",
  "presentation",
]);
const ARCHITECTURE_CATALOG = getArchitectureCatalog();
const ARCHITECTURE_SYMBOL_IDS = new Set(
  ARCHITECTURE_CATALOG.symbols.map((item) => item.id),
);
const ARCHITECTURE_MATERIAL_IDS = new Set(
  ARCHITECTURE_CATALOG.materials.map((item) => item.id),
);
const ARCHITECTURE_STYLE_PRESET_IDS = new Set(
  ARCHITECTURE_CATALOG.stylePresets.map((item) => item.id),
);
const ARCHITECTURE_TEXT_STYLES = new Set([
  "title",
  "section",
  "room",
  "dimension",
  "note",
]);
const ARCHITECTURE_LINE_WEIGHT_ROLES = new Set([
  "detail",
  "furniture",
  "partition",
  "exterior",
  "site",
  "boundary",
  "dimension",
]);
const ARCHITECTURE_OBJECT_TYPES = Object.freeze([
  "area",
  "wall",
  "symbol",
  "dimension",
]);
const OPENING_SYMBOL_IDS = new Set(
  ARCHITECTURE_CATALOG.symbols
    .filter((item) => item.category === "opening" || /^door-|^window/.test(item.id))
    .map((item) => item.id),
);
const ARCHITECTURE_SEMANTIC_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    label: { type: "string", maxLength: 240 },
    role: { type: "string", maxLength: 80 },
    tags: {
      type: "array",
      maxItems: MAX_TAGS,
      items: { type: "string", maxLength: MAX_TAG_LENGTH },
    },
    generatedBy: { type: "string", maxLength: 80 },
    diagramId: { type: "string", maxLength: 128 },
    clientRef: { type: "string", maxLength: 128 },
    sourceId: { type: "string", maxLength: 128 },
    targetId: { type: "string", maxLength: 128 },
    roomId: { type: "string", maxLength: 128 },
    wallPathId: { type: "string", maxLength: 128 },
    referenceId: { type: "string", maxLength: 128 },
    levelId: { type: "string", maxLength: 128 },
    segmentIndex: { type: "integer", minimum: 0 },
    openingIndex: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
});

const COMMAND_DEFINITIONS = Object.freeze([
  command("objects.create", ["create"], "Create one or more editable board objects."),
  command("objects.update", ["update"], "Update allowlisted properties on target objects."),
  command("objects.delete", ["delete"], "Delete explicit unlocked objects."),
  command("objects.transform", ["update"], "Move, resize, rotate, or flip target objects."),
  command("objects.duplicate", ["create"], "Duplicate target objects with an offset."),
  command("selection.set", ["update"], "Set the current selection using stable references."),
  command("objects.group", ["update"], "Group target objects into one rigid selection unit."),
  command("objects.ungroup", ["update"], "Ungroup target objects from their rigid groups."),
  command("curves.points.insert", ["update"], "Insert exact movable points at requested positions on one editable curve."),
  command("curves.vertices.reinitialize", ["update"], "Reduce curves to endpoints, meaningful extrema, and shared joints."),
  command("vertices.create", ["update"], "Create shared editable joints across selected paths and outlined shapes, including crossings."),
  command("objects.connect", ["create"], "Connect two objects with an arrow or line."),
  command("objects.disconnect", ["delete"], "Remove semantic connections between targets."),
  command("objects.layout", ["update"], "Arrange target objects with a deterministic layout."),
  command("template.insert", ["create"], "Insert a high-level reusable board template."),
  command("floor-plan.insert", ["create"], "Insert an editable floor-plan element or room template."),
  command("floor-plan.elements.list", ["read-summary"], "List built-in, customized, saved, and removed floor-plan elements."),
  command("floor-plan.elements.create", ["create"], "Save explicit editable board objects as a reusable floor-plan element."),
  command("floor-plan.elements.update", ["update"], "Rename or describe an existing saved or customized floor-plan element."),
  command("floor-plan.elements.replace", ["update"], "Replace an element's vector contents with explicit board objects."),
  command("floor-plan.elements.remove", ["delete"], "Delete a saved element or hide a built-in element."),
  command("floor-plan.elements.restore", ["update"], "Restore a built-in element and discard its replacement."),
  command("floor-plan.elements.insert", ["create"], "Insert a visible saved, customized, or built-in floor-plan element."),
  command("floor-plan.templates.list", ["read-summary"], "List built-in, customized, saved, and removed floor-plan templates."),
  command("floor-plan.templates.create", ["create"], "Save explicit editable board objects as a reusable floor-plan template."),
  command("floor-plan.templates.update", ["update"], "Rename or describe an existing saved or customized floor-plan template."),
  command("floor-plan.templates.replace", ["update"], "Replace a template's vector contents with explicit board objects."),
  command("floor-plan.templates.remove", ["delete"], "Delete a saved template or hide a built-in template."),
  command("floor-plan.templates.restore", ["update"], "Restore a built-in template and discard its replacement."),
  command("floor-plan.templates.insert", ["create"], "Insert a visible saved, customized, or built-in floor-plan template."),
  command("floor-plan.layers.move", ["update"], "Move a layer designator up or down one level without wrapping."),
  command("floor-plan.layers.cycle", ["update"], "Legacy alias for moving a layer designator one level without wrapping."),
  command("floor-plan.layers.add", ["create"], "Add and activate an automatically named positive or negative level."),
  command("floor-plan.layers.remove", ["delete"], "Remove the active level and its assigned objects."),
  command("diagram.create", ["create"], "Create a complete semantic diagram in one command."),
  command("viewport.focus", ["update"], "Focus the board viewport on targets or a point."),
  command("board.settings.update", ["update"], "Update grid, snapping, and floor-plan settings."),
  command("architecture.areas.create", ["create"], "Create exact filled architectural or landscape polygons."),
  command("architecture.paths.create", ["create"], "Create exact curved material polygons from caller-authored path commands."),
  command("architecture.walls.create", ["create"], "Create exact wall segments without choosing their layout."),
  command("architecture.wallPaths.create", ["create"], "Compile exact connected wall paths with real door and window gaps."),
  command("architecture.openings.create", ["create"], "Place exact door or window symbols chosen by the caller."),
  command("architecture.symbols.place", ["create"], "Place bundled vector symbols at exact frames and rotations."),
  command("architecture.labels.create", ["create"], "Create clipped, world-scaled architectural labels in exact boxes."),
  command("architecture.dimensions.create", ["create"], "Create exact architectural dimensions and labels."),
  command("architecture.materials.apply", ["update"], "Apply an exact bundled material to explicit targets."),
  command("architecture.style.set", ["update"], "Set deterministic architectural palette, line-weight, and typography presets."),
  command("architecture.layers.set", ["update"], "Replace the deterministic architecture layer stack."),
  command("architecture.references.configure", ["update"], "Configure explicit existing images as locked, local reference overlays."),
  command("architecture.inspect", ["read-summary"], "Measure explicit objects and report bounded intersections without changing the board."),
  command("architecture.validate", ["read-summary"], "Report wall connectivity, access, clearance, label, and symbol-quality issues without changing the board."),
]);

const TARGET_SCHEMA = Object.freeze({
  type: "object",
  description: "One or more existing objects. IDs come from getContext; clientKeys come from earlier commands in the same envelope.",
  properties: {
    ids: { type: "array", items: { type: "string" } },
    clientKeys: { type: "array", items: { type: "string" } },
    selection: { type: "boolean" },
    semanticRef: {
      type: "string",
      description: "Matches a stable semantic client, diagram, wall-path, room, level, or reference ID.",
    },
    diagramId: { type: "string" },
    wallPathId: { type: "string" },
    roomId: { type: "string" },
    levelId: { type: "string" },
    referenceId: { type: "string" },
    role: { type: "string" },
    tag: { type: "string" },
  },
  additionalProperties: false,
});

const PLACEMENT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    type: { enum: ["viewport-center", "selection", "available-space", "point"] },
    x: { type: "number" },
    y: { type: "number" },
  },
});

const REFERENCE_SCHEMA = Object.freeze({
  oneOf: [
    { type: "string", description: "Existing object ID." },
    {
      type: "object",
      properties: {
        id: { type: "string" },
        clientKey: { type: "string" },
      },
    },
  ],
});

const ARCHITECTURE_STYLE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    fillColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    accentColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    fillOpacity: { type: "number", minimum: 0, maximum: 1 },
    opacity: { type: "number", minimum: 0, maximum: 1 },
    fillPattern: { enum: [...ARCHITECTURE_FILL_PATTERNS] },
    strokeWidth: { type: "number", minimum: 0.25, maximum: 240 },
    lineWeight: { enum: [...ARCHITECTURE_LINE_WEIGHT_ROLES] },
    dashPattern: { enum: [...DASH_PATTERNS] },
    shadow: {
      type: "object",
      properties: {
        color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        opacity: { type: "number", minimum: 0, maximum: 1 },
        blur: { type: "number", minimum: 0, maximum: 100 },
        offsetX: { type: "number", minimum: -500, maximum: 500 },
        offsetY: { type: "number", minimum: -500, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
});

const ARCHITECTURE_ITEM_FIELDS = Object.freeze({
  clientKey: { type: "string" },
  layerId: { type: "string" },
  zIndex: { type: "number" },
  semantic: ARCHITECTURE_SEMANTIC_SCHEMA,
  style: ARCHITECTURE_STYLE_SCHEMA,
});

const ARCHITECTURE_LINE_WEIGHTS_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.fromEntries(
    [...ARCHITECTURE_LINE_WEIGHT_ROLES].map((role) => [
      role,
      { type: "number", minimum: 0.25, maximum: 240 },
    ]),
  ),
  additionalProperties: false,
});

const ARCHITECTURE_TYPOGRAPHY_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.fromEntries(
    [...ARCHITECTURE_TEXT_STYLES].map((role) => [
      role,
      {
        type: "object",
        properties: {
          fontFamily: { enum: [...FONT_FAMILIES] },
          fontSize: { type: "number", minimum: 6, maximum: 96 },
          fontWeight: { type: "integer", minimum: 300, maximum: 800 },
          lineHeight: { type: "number", minimum: 0.8, maximum: 3 },
        },
        additionalProperties: false,
      },
    ]),
  ),
  additionalProperties: false,
});

const ARCHITECTURE_PALETTE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.fromEntries(
    Object.keys(ARCHITECTURE_CATALOG.stylePresets[0]?.palette ?? {}).map((role) => [
      role,
      { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    ]),
  ),
  additionalProperties: false,
});

const ARCHITECTURE_PATH_COMMAND_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    op: { enum: [...ARCHITECTURE_PATH_OPERATIONS] },
    x: { type: "number" },
    y: { type: "number" },
    cx: { type: "number" },
    cy: { type: "number" },
    c1x: { type: "number" },
    c1y: { type: "number" },
    c2x: { type: "number" },
    c2y: { type: "number" },
    rx: { type: "number", exclusiveMinimum: 0 },
    ry: { type: "number", exclusiveMinimum: 0 },
    startAngle: { type: "number" },
    endAngle: { type: "number" },
    clockwise: { type: "boolean" },
    steps: { type: "integer", minimum: 4, maximum: 96 },
  },
  additionalProperties: false,
});

const ARCHITECTURE_WALL_OPENING_SCHEMA = Object.freeze({
  type: "object",
  required: ["segmentIndex", "offset", "width", "kind"],
  properties: {
    segmentIndex: { type: "integer", minimum: 0 },
    offset: { type: "number", minimum: 0 },
    width: { type: "number", exclusiveMinimum: 0 },
    kind: { enum: [...OPENING_SYMBOL_IDS] },
    hinge: { enum: ["left", "right"] },
    side: { enum: ["inside", "outside"] },
    sillDepth: { type: "number", exclusiveMinimum: 0 },
    clientKey: { type: "string" },
    semantic: { type: "object" },
  },
  additionalProperties: false,
});

const VISUAL_COMMAND_SCHEMAS = Object.freeze({
  "objects.create": schema(
    ["objects"],
    {
      objects: {
        type: "array",
        minItems: 1,
        maxItems: MAX_OBJECTS_PER_REQUEST,
        items: {
          type: "object",
          required: ["objectType"],
          properties: {
            objectType: { enum: [...OBJECT_TYPES] },
            shapeKind: { enum: [...SHAPE_KINDS] },
            clientKey: { type: "string" },
            label: { type: "string" },
            text: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number", exclusiveMinimum: 0 },
            h: { type: "number", exclusiveMinimum: 0 },
            endX: { type: "number" },
            endY: { type: "number" },
            arrowStart: { type: "boolean" },
            arrowEnd: { type: "boolean" },
            midX: { type: "number" },
            midY: { type: "number" },
            curvePoints: {
              type: "array",
              minItems: 3,
              maxItems: 128,
              items: pointSchema(),
              description: "Ordered on-curve vertices for a complex arc.",
            },
            rotation: { type: "number", description: "Radians." },
            color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
            strokeWidth: { type: "number", minimum: 1, maximum: 24 },
            dashPattern: { enum: [...DASH_PATTERNS] },
            fontSize: { type: "number", minimum: 8, maximum: 96 },
            fontFamily: { enum: [...FONT_FAMILIES] },
            locked: { type: "boolean" },
            semantic: { type: "object" },
          },
        },
      },
      placement: PLACEMENT_SCHEMA,
    },
  ),
  "objects.update": schema(
    ["patch"],
    {
      targets: TARGET_SCHEMA,
      target: TARGET_SCHEMA,
      patch: {
        type: "object",
        properties: {
          color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          fillColor: {
            oneOf: [
              { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
              { type: "null" },
            ],
          },
          accentColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          fillOpacity: { type: "number", minimum: 0, maximum: 1 },
          opacity: { type: "number", minimum: 0, maximum: 1 },
          fillPattern: { enum: [...ARCHITECTURE_FILL_PATTERNS] },
          materialId: { enum: [...ARCHITECTURE_MATERIAL_IDS] },
          strokeWidth: { type: "number", minimum: 0.25, maximum: 240 },
          dashPattern: { enum: [...DASH_PATTERNS] },
          layerId: { type: "string" },
          zIndex: { type: "number", minimum: -10_000, maximum: 10_000 },
          shadow: {
            type: "object",
            properties: {
              color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
              opacity: { type: "number", minimum: 0, maximum: 1 },
              blur: { type: "number", minimum: 0, maximum: 100 },
              offsetX: { type: "number", minimum: -500, maximum: 500 },
              offsetY: { type: "number", minimum: -500, maximum: 500 },
            },
            additionalProperties: false,
          },
          locked: { type: "boolean" },
          arrowStart: { type: "boolean" },
          arrowEnd: { type: "boolean" },
          text: { type: "string" },
          fontSize: { type: "number", minimum: 6, maximum: 96 },
          fontFamily: { enum: [...FONT_FAMILIES] },
          scaleMode: { enum: ["world", "screen"] },
          textAlign: { enum: ["left", "center", "right"] },
          verticalAlign: { enum: ["top", "middle", "bottom"] },
          lineHeight: { type: "number", minimum: 0.8, maximum: 3 },
          padding: { type: "number", minimum: 0, maximum: 120 },
          rotation: { type: "number", description: "Radians." },
          semantic: { type: "object" },
        },
      },
    },
  ),
  "objects.delete": targetCommandSchema(),
  "objects.transform": schema([], {
    targets: TARGET_SCHEMA,
    target: TARGET_SCHEMA,
    translate: pointSchema(),
    scale: pointSchema(),
    rotateDegrees: { type: "number" },
    flipHorizontal: { type: "boolean" },
    flipVertical: { type: "boolean" },
    mirrorText: { type: "boolean" },
  }),
  "objects.duplicate": schema([], {
    targets: TARGET_SCHEMA,
    target: TARGET_SCHEMA,
    offset: pointSchema(),
  }),
  "selection.set": schema([], {
    targets: TARGET_SCHEMA,
    target: TARGET_SCHEMA,
    allowEmpty: { type: "boolean" },
  }),
  "objects.group": targetCommandSchema(),
  "objects.ungroup": targetCommandSchema(),
  "curves.points.insert": schema(["points"], {
    targets: TARGET_SCHEMA,
    target: TARGET_SCHEMA,
    points: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: pointSchema(),
    },
  }),
  "curves.vertices.reinitialize": targetCommandSchema(),
  "vertices.create": targetCommandSchema(),
  "objects.connect": schema(["from", "to"], {
    from: REFERENCE_SCHEMA,
    to: REFERENCE_SCHEMA,
    connectorType: { enum: ["connector", "line"] },
    clientKey: { type: "string" },
    label: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    strokeWidth: { type: "number", minimum: 1, maximum: 24 },
    dashPattern: { enum: [...DASH_PATTERNS] },
    arrowStart: { type: "boolean" },
    arrowEnd: { type: "boolean" },
  }),
  "objects.disconnect": schema([], {
    from: REFERENCE_SCHEMA,
    to: REFERENCE_SCHEMA,
    targets: TARGET_SCHEMA,
  }),
  "objects.layout": schema(["layoutType"], {
    targets: TARGET_SCHEMA,
    target: TARGET_SCHEMA,
    layoutType: { enum: [...LAYOUT_TYPES] },
    gap: { type: "number", minimum: 0, maximum: 1_000 },
    columns: { type: "integer", minimum: 1 },
  }),
  "template.insert": schema(["template"], {
    template: { enum: ["basic-flow", "comparison", "timeline"] },
    placement: PLACEMENT_SCHEMA,
    direction: { enum: ["horizontal", "vertical"] },
    nodes: { type: "array" },
    edges: { type: "array" },
    columns: { type: "array" },
    events: { type: "array" },
    stylePreset: { enum: STYLE_PRESET_NAMES },
  }),
  "floor-plan.insert": schema(["kind"], {
    kind: { enum: [...FLOOR_PLAN_ELEMENTS, ...FLOOR_PLAN_TEMPLATES] },
    placement: PLACEMENT_SCHEMA,
    settings: {
      type: "object",
      properties: {
        units: { enum: ["ft", "m", "in", "cm"] },
        pixelsPerUnit: { type: "number", minimum: 4, maximum: 200 },
        wallThickness: { type: "number", minimum: 0.02, maximum: 10 },
        gridSize: { type: "number", minimum: 4, maximum: 200 },
        alignmentGuides: { type: "boolean" },
        dimensionsVisible: { type: "boolean" },
        labelsAlwaysVisible: { type: "boolean" },
      },
    },
  }),
  "floor-plan.elements.list": schema([], {}),
  "floor-plan.elements.create": schema(["elementId", "name", "targets"], {
    elementId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
    name: { type: "string", maxLength: 80 },
    description: { type: "string", maxLength: 240 },
    category: { enum: ["structures", "maintenance", "furniture", "tools"] },
    targets: TARGET_SCHEMA,
  }),
  "floor-plan.elements.update": schema(["elementId"], {
    elementId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
    name: { type: "string", maxLength: 80 },
    description: { type: "string", maxLength: 240 },
    category: { enum: ["structures", "maintenance", "furniture", "tools"] },
  }),
  "floor-plan.elements.replace": schema(["elementId", "targets"], {
    elementId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
    name: { type: "string", maxLength: 80 },
    description: { type: "string", maxLength: 240 },
    category: { enum: ["structures", "maintenance", "furniture", "tools"] },
    targets: TARGET_SCHEMA,
  }),
  "floor-plan.elements.remove": schema(["elementId", "password"], {
    elementId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
    password: { type: "string", maxLength: 120 },
  }),
  "floor-plan.elements.restore": schema(["elementId"], {
    elementId: { enum: [...FLOOR_PLAN_ELEMENTS] },
  }),
  "floor-plan.elements.insert": schema(["elementId"], {
    elementId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
    placement: PLACEMENT_SCHEMA,
  }),
  "floor-plan.templates.list": schema([], {}),
  "floor-plan.templates.create": schema(["templateId", "name", "targets"], {
    templateId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
    name: { type: "string", maxLength: 80 },
    description: { type: "string", maxLength: 240 },
    category: { enum: ["rooms"] },
    targets: TARGET_SCHEMA,
  }),
  "floor-plan.templates.update": schema(["templateId"], {
    templateId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
    name: { type: "string", maxLength: 80 },
    description: { type: "string", maxLength: 240 },
    category: { enum: ["rooms"] },
  }),
  "floor-plan.templates.replace": schema(["templateId", "targets"], {
    templateId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
    name: { type: "string", maxLength: 80 },
    description: { type: "string", maxLength: 240 },
    category: { enum: ["rooms"] },
    targets: TARGET_SCHEMA,
  }),
  "floor-plan.templates.remove": schema(["templateId", "password"], {
    templateId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
    password: { type: "string", maxLength: 120 },
  }),
  "floor-plan.templates.restore": schema(["templateId"], {
    templateId: { enum: [...FLOOR_PLAN_TEMPLATES] },
  }),
  "floor-plan.templates.insert": schema(["templateId"], {
    templateId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
    placement: PLACEMENT_SCHEMA,
  }),
  "floor-plan.layers.move": schema(["designatorId", "direction"], {
    designatorId: { type: "string", minLength: 1, maxLength: 128 },
    direction: { enum: ["up", "down"] },
  }),
  "floor-plan.layers.cycle": schema(["designatorId"], {
    designatorId: { type: "string", minLength: 1, maxLength: 128 },
    direction: { enum: ["next", "previous"] },
  }),
  "floor-plan.layers.add": schema(["designatorId"], {
    designatorId: { type: "string", minLength: 1, maxLength: 128 },
    level: { type: "integer", minimum: -99, maximum: 99 },
    name: {
      type: "string",
      minLength: 1,
      maxLength: 80,
      description: "Legacy level name; its integer is used when level is omitted.",
    },
  }),
  "floor-plan.layers.remove": schema(["designatorId", "password"], {
    designatorId: { type: "string", minLength: 1, maxLength: 128 },
    password: { type: "string", maxLength: 120 },
  }),
  "diagram.create": schema(["diagramType"], {
    diagramType: { enum: [...DIAGRAM_TYPES] },
    topic: { type: "string" },
    branches: { type: "array" },
    root: { type: "object" },
    events: { type: "array" },
    steps: { type: "array" },
    columns: { oneOf: [{ type: "array" }, { type: "integer", minimum: 1 }] },
    nodes: { type: "array" },
    edges: { type: "array" },
    placement: PLACEMENT_SCHEMA,
    stylePreset: { enum: STYLE_PRESET_NAMES },
    style: { type: "object" },
    direction: { enum: ["horizontal", "vertical"] },
  }),
  "viewport.focus": schema([], {
    targets: TARGET_SCHEMA,
    target: TARGET_SCHEMA,
    point: pointSchema(),
    zoom: { type: "number", minimum: 0.15, maximum: 4 },
  }),
  "board.settings.update": schema(["settings"], {
    settings: {
      type: "object",
      properties: {
        grid: { type: "boolean" },
        snap: { type: "boolean" },
        floorPlan: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            units: { enum: ["ft", "m", "in", "cm"] },
            pixelsPerUnit: { type: "number", minimum: 4, maximum: 200 },
            wallThickness: { type: "number", minimum: 0.02, maximum: 10 },
            gridSize: { type: "number", minimum: 4, maximum: 200 },
            alignmentGuides: { type: "boolean" },
            dimensionsVisible: { type: "boolean" },
            labelsAlwaysVisible: { type: "boolean" },
          },
        },
      },
    },
  }),
  "architecture.areas.create": schema(["areas"], {
    areas: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        required: ["vertices", "materialId"],
        properties: {
          vertices: { type: "array", minItems: 3, maxItems: 256, items: pointSchema() },
          materialId: { enum: [...ARCHITECTURE_MATERIAL_IDS] },
          ...ARCHITECTURE_ITEM_FIELDS,
        },
        additionalProperties: false,
      },
    },
  }),
  "architecture.paths.create": schema(["paths"], {
    paths: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        required: ["commands", "materialId"],
        properties: {
          commands: {
            type: "array",
            minItems: 2,
            maxItems: 256,
            items: ARCHITECTURE_PATH_COMMAND_SCHEMA,
          },
          materialId: { enum: [...ARCHITECTURE_MATERIAL_IDS] },
          curveSteps: { type: "integer", minimum: 4, maximum: 96 },
          ...ARCHITECTURE_ITEM_FIELDS,
        },
        additionalProperties: false,
      },
    },
  }),
  "architecture.walls.create": schema(["walls"], {
    walls: {
      type: "array",
      minItems: 1,
      maxItems: 250,
      items: {
        type: "object",
        required: ["start", "end", "thickness"],
        properties: {
          start: pointSchema(),
          end: pointSchema(),
          thickness: { type: "number", exclusiveMinimum: 0 },
          materialId: { enum: [...ARCHITECTURE_MATERIAL_IDS] },
          ...ARCHITECTURE_ITEM_FIELDS,
        },
        additionalProperties: false,
      },
    },
  }),
  "architecture.wallPaths.create": schema(["wallPaths"], {
    wallPaths: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        required: ["points", "thickness"],
        properties: {
          points: { type: "array", minItems: 2, maxItems: 256, items: pointSchema() },
          thickness: { type: "number", exclusiveMinimum: 0 },
          closed: { type: "boolean" },
          join: { enum: [...ARCHITECTURE_WALL_JOINS] },
          cap: { enum: [...ARCHITECTURE_WALL_CAPS] },
          materialId: { enum: [...ARCHITECTURE_MATERIAL_IDS] },
          openings: {
            type: "array",
            maxItems: 200,
            items: ARCHITECTURE_WALL_OPENING_SCHEMA,
          },
          ...ARCHITECTURE_ITEM_FIELDS,
        },
        additionalProperties: false,
      },
    },
  }),
  "architecture.openings.create": schema(["openings"], {
    openings: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: {
        type: "object",
        required: ["kind", "x", "y", "w", "h"],
        properties: {
          kind: { enum: [...OPENING_SYMBOL_IDS] },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number", exclusiveMinimum: 0 },
          h: { type: "number", exclusiveMinimum: 0 },
          rotation: { type: "number", description: "Radians." },
          fit: { enum: [...ARCHITECTURE_SYMBOL_FITS] },
          ...ARCHITECTURE_ITEM_FIELDS,
        },
        additionalProperties: false,
      },
    },
  }),
  "architecture.symbols.place": schema(["symbols"], {
    symbols: {
      type: "array",
      minItems: 1,
      maxItems: 250,
      items: {
        type: "object",
        required: ["symbolId", "x", "y", "w", "h"],
        properties: {
          symbolId: { enum: [...ARCHITECTURE_SYMBOL_IDS] },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number", exclusiveMinimum: 0 },
          h: { type: "number", exclusiveMinimum: 0 },
          rotation: { type: "number", description: "Radians." },
          fit: { enum: [...ARCHITECTURE_SYMBOL_FITS] },
          ...ARCHITECTURE_ITEM_FIELDS,
        },
        additionalProperties: false,
      },
    },
  }),
  "architecture.labels.create": schema(["labels"], {
    labels: {
      type: "array",
      minItems: 1,
      maxItems: 250,
      items: {
        type: "object",
        required: ["text", "x", "y", "w", "h"],
        properties: {
          text: { type: "string", maxLength: MAX_TEXT_LENGTH },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number", exclusiveMinimum: 0 },
          h: { type: "number", exclusiveMinimum: 0 },
          rotation: { type: "number", description: "Radians." },
          fontSize: { type: "number", minimum: 6, maximum: 96 },
          fontWeight: { type: "integer", minimum: 300, maximum: 800 },
          fontFamily: { enum: [...FONT_FAMILIES] },
          textStyle: { enum: [...ARCHITECTURE_TEXT_STYLES] },
          textAlign: { enum: ["left", "center", "right"] },
          verticalAlign: { enum: ["top", "middle", "bottom"] },
          lineHeight: { type: "number", minimum: 0.8, maximum: 3 },
          padding: { type: "number", minimum: 0, maximum: 120 },
          ...ARCHITECTURE_ITEM_FIELDS,
        },
        additionalProperties: false,
      },
    },
  }),
  "architecture.dimensions.create": schema(["dimensions"], {
    dimensions: {
      type: "array",
      minItems: 1,
      maxItems: 250,
      items: {
        type: "object",
        required: ["start", "end"],
        properties: {
          start: pointSchema(),
          end: pointSchema(),
          offset: { type: "number" },
          label: { type: "string", maxLength: 240 },
          fontSize: { type: "number", minimum: 6, maximum: 96 },
          ...ARCHITECTURE_ITEM_FIELDS,
        },
        additionalProperties: false,
      },
    },
  }),
  "architecture.materials.apply": schema(["materialId"], {
    targets: TARGET_SCHEMA,
    target: TARGET_SCHEMA,
    materialId: { enum: [...ARCHITECTURE_MATERIAL_IDS] },
    fillOpacity: { type: "number", minimum: 0, maximum: 1 },
  }),
  "architecture.style.set": schema(["preset"], {
    preset: { enum: [...ARCHITECTURE_STYLE_PRESET_IDS] },
    lineWeights: ARCHITECTURE_LINE_WEIGHTS_SCHEMA,
    typography: ARCHITECTURE_TYPOGRAPHY_SCHEMA,
    palette: ARCHITECTURE_PALETTE_SCHEMA,
  }),
  "architecture.layers.set": schema(["layers"], {
    layers: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: {
        type: "object",
        required: ["id", "name", "order"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          order: { type: "number" },
          visible: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  }),
  "architecture.references.configure": schema(["targets", "consent"], {
    targets: TARGET_SCHEMA,
    consent: { const: true },
    opacity: { type: "number", minimum: 0.05, maximum: 1 },
    locked: { type: "boolean" },
    hiddenInExport: { type: "boolean" },
    referenceName: { type: "string", maxLength: 120 },
  }),
  "architecture.inspect": schema([], {
    targets: TARGET_SCHEMA,
    target: TARGET_SCHEMA,
    includeIntersections: { type: "boolean" },
    includeWithinGroups: { type: "boolean" },
    clearance: { type: "number", minimum: 0, maximum: 100_000 },
    includeConnectivity: { type: "boolean" },
    endpointTolerance: { type: "number", minimum: 0.25, maximum: 1_000 },
    includeLabelCollisions: { type: "boolean" },
    includeRoomAccess: { type: "boolean" },
    minimumClearance: { type: "number", minimum: 0, maximum: 100_000 },
    aspectRatioTolerance: { type: "number", minimum: 0.05, maximum: 5 },
  }),
  "architecture.validate": schema([], {
    targets: TARGET_SCHEMA,
    target: TARGET_SCHEMA,
    endpointTolerance: { type: "number", minimum: 0.25, maximum: 1_000 },
    minimumClearance: { type: "number", minimum: 0, maximum: 100_000 },
    aspectRatioTolerance: { type: "number", minimum: 0.05, maximum: 5 },
  }),
});

const STYLE_PRESETS = Object.freeze({
  current: {},
  archival: {
    color: "#281d17",
    textColor: "#281d17",
    accentColors: ["#7d2c2c", "#2f5f55", "#9a6a1f", "#465f78"],
    dashPattern: "solid",
    fontFamily: "serif",
  },
  minimal: {
    color: "#1f2933",
    textColor: "#1f2933",
    accentColors: ["#1f2933"],
    dashPattern: "solid",
    fontFamily: "sans",
  },
  technical: {
    color: "#183b56",
    textColor: "#102a43",
    accentColors: ["#1f6f8b", "#486581", "#627d98"],
    dashPattern: "solid",
    fontFamily: "mono",
  },
  monochrome: {
    color: "#000000",
    textColor: "#000000",
    accentColors: ["#000000"],
    dashPattern: "solid",
    fontFamily: "serif",
  },
  "color-coded": {
    color: "#222222",
    textColor: "#111111",
    accentColors: ["#315b7d", "#8b3a3a", "#427354", "#9a6a1f", "#694c8c"],
    dashPattern: "solid",
    fontFamily: "sans",
  },
  presentation: {
    color: "#202124",
    textColor: "#202124",
    accentColors: ["#1a73e8", "#d93025", "#188038", "#f9ab00"],
    dashPattern: "solid",
    fontFamily: "sans",
  },
});

export function createVisualBoardAiAdapter(dependencies) {
  validateDependencies(dependencies);

  return {
    id: "visual-board",
    title: "Visual Board",
    getRevision: () => readState(dependencies).board.revision ?? 0,
    getCapabilities: () => getVisualBoardAiCapabilities(),
    getContext: (options) => serializeVisualBoardContext(readState(dependencies), options),
    preview: async (envelope) => {
      assertToolIsIdle(dependencies);
      const current = readState(dependencies);
      const execution = executeVisualBoardCommands(current, envelope, dependencies.createId);
      return {
        revision: current.board.revision ?? 0,
        ...execution.receipt,
        result: {
          summary: summarizeExecution(execution),
          affectedBounds: execution.affectedBounds,
          outputs: execution.outputs,
          context: serializeVisualBoardContext(execution.state, {
            scope: "selection",
            maximumObjects: 120,
          }),
        },
      };
    },
    apply: async (envelope) => {
      assertToolIsIdle(dependencies);
      const current = readState(dependencies);
      const execution = executeVisualBoardCommands(current, envelope, dependencies.createId);
      const revision = execution.mutated
        ? await dependencies.commit(execution.state, {
          requestId: envelope.requestId,
          summary: summarizeExecution(execution),
        })
        : current.board.revision ?? 0;
      return {
        revision,
        ...execution.receipt,
        undoGroupId: execution.mutated ? envelope.requestId : null,
        result: {
          summary: summarizeExecution(execution),
          affectedBounds: execution.affectedBounds,
          outputs: execution.outputs,
        },
      };
    },
    undo: dependencies.undo,
    redo: dependencies.redo,
    export: dependencies.exportBoard,
  };
}

function assertToolIsIdle(dependencies) {
  const busyReason = typeof dependencies.isBusy === "function"
    ? dependencies.isBusy()
    : null;
  if (busyReason) {
    throw new AiCommandError(`Finish ${busyReason} before applying AI commands.`, {
      code: "tool-busy",
      recoverable: true,
    });
  }
}

export function getVisualBoardAiCapabilities() {
  return {
    tool: "visual-board",
    version: 8,
    commands: COMMAND_DEFINITIONS.map((definition) => ({
      ...cloneJson(definition),
      schema: cloneJson(VISUAL_COMMAND_SCHEMAS[definition.type]),
    })),
    objectTypes: [...OBJECT_TYPES],
    shapeKinds: [...SHAPE_KINDS],
    diagramTypes: [...DIAGRAM_TYPES],
    layoutTypes: [...LAYOUT_TYPES],
    floorPlanElements: [...FLOOR_PLAN_ELEMENTS],
    floorPlanTemplates: [...FLOOR_PLAN_TEMPLATES],
    architectureObjectTypes: [...ARCHITECTURE_OBJECT_TYPES],
    architectureCatalog: cloneJson(ARCHITECTURE_CATALOG),
    stylePresets: [...STYLE_PRESET_NAMES],
    limits: {
      maximumCommands: 100,
      maximumObjectsPerRequest: MAX_OBJECTS_PER_REQUEST,
      maximumBoardObjects: MAX_BOARD_OBJECTS,
      maximumTextLength: MAX_TEXT_LENGTH,
      maximumNestingDepth: MAX_NESTING_DEPTH,
    },
    limitations: [
      "Image bytes, freehand point arrays, and trace paths are omitted from AI context.",
      "Commands cannot import local files or start animation rendering.",
      "Architectural commands render exact caller-supplied geometry and never choose or improve a layout.",
      "Custom floor-plan elements and templates preserve editable vector objects and relationships but reject image assets.",
      "Floor-plan catalog and layer removals require the configured removal password.",
      "Reference images require an existing local board image plus explicit consent; their bytes are never exposed to providers.",
      "Architecture validation reports deterministic geometry issues but does not redesign the caller's plan.",
      "Shared-vertex creation converts supported outlined shapes directly and preserves straight lines and curves.",
      "Curve reinitialization retains endpoints, meaningful extrema, and shared path joints while filtering minor noise.",
    ],
    examples: getVisualBoardAiExamples(),
  };
}

export function getVisualBoardAiExamples() {
  return [
    {
      name: "Add a complex curve point",
      command: {
        type: "curves.points.insert",
        targets: { ids: ["curve-id-from-context"] },
        points: [{ x: 420, y: 260 }],
      },
    },
    {
      name: "Join intersecting paths",
      command: {
        type: "vertices.create",
        targets: { ids: ["curve-id", "line-id"] },
      },
    },
    {
      name: "Reduce curve vertices",
      command: {
        type: "curves.vertices.reinitialize",
        targets: { ids: ["curve-id-from-context"] },
      },
    },
    {
      name: "Mind map",
      command: {
        type: "diagram.create",
        diagramType: "mind-map",
        topic: "Photosynthesis",
        branches: [
          {
            label: "Light-dependent reactions",
            children: ["Water splitting", "ATP", "NADPH"],
          },
          {
            label: "Calvin cycle",
            children: ["Carbon fixation", "G3P", "Glucose"],
          },
        ],
        placement: { type: "viewport-center" },
        stylePreset: "archival",
      },
    },
    {
      name: "Flowchart",
      command: {
        type: "diagram.create",
        diagramType: "flowchart",
        direction: "vertical",
        nodes: [
          { key: "start", label: "Start" },
          { key: "work", label: "Process information" },
          { key: "finish", label: "Finish" },
        ],
        edges: [
          { from: "start", to: "work" },
          { from: "work", to: "finish" },
        ],
        placement: { type: "viewport-center" },
      },
    },
    {
      name: "Bedroom floor plan",
      command: {
        type: "floor-plan.insert",
        kind: "bedroom",
        placement: { type: "viewport-center" },
        settings: {
          units: "ft",
          pixelsPerUnit: 28,
          wallThickness: 0.5,
          gridSize: 28,
          alignmentGuides: true,
        },
      },
    },
    {
      name: "Save selection as a floor-plan element",
      command: {
        type: "floor-plan.elements.create",
        elementId: "double-vanity",
        name: "Double vanity",
        description: "Editable bathroom vanity with two sinks.",
        category: "furniture",
        targets: { selection: true },
      },
    },
    {
      name: "Save selection as a floor-plan template",
      command: {
        type: "floor-plan.templates.create",
        templateId: "courtyard-bedroom",
        name: "Courtyard bedroom",
        description: "Bedroom block with ensuite and garden doors.",
        category: "rooms",
        targets: { selection: true },
      },
    },
    {
      name: "Add a basement level",
      command: {
        type: "floor-plan.layers.add",
        designatorId: "layer-designator-id-from-context",
        level: -1,
      },
    },
    {
      name: "Exact furnished room",
      command: {
        type: "architecture.symbols.place",
        symbols: [
          {
            clientKey: "bed",
            symbolId: "bed-queen",
            x: 120,
            y: 140,
            w: 150,
            h: 210,
            rotation: 0,
            layerId: "furniture",
            zIndex: 10,
            style: {
              color: "#3f342b",
              fillColor: "#eadfca",
              accentColor: "#8b3a3a",
            },
          },
          {
            clientKey: "desk",
            symbolId: "desk",
            x: 320,
            y: 150,
            w: 150,
            h: 75,
            rotation: 0,
            layerId: "furniture",
            zIndex: 10,
          },
        ],
      },
    },
    {
      name: "Connected wall path with real openings",
      command: {
        type: "architecture.wallPaths.create",
        wallPaths: [{
          clientKey: "living-shell",
          points: [
            { x: 100, y: 100 },
            { x: 700, y: 100 },
            { x: 700, y: 500 },
          ],
          thickness: 18,
          join: "miter",
          cap: "square",
          openings: [
            {
              segmentIndex: 0,
              offset: 260,
              width: 110,
              kind: "door-french",
            },
            {
              segmentIndex: 1,
              offset: 120,
              width: 150,
              kind: "window-fixed",
            },
          ],
          materialId: "plaster",
          style: { lineWeight: "exterior" },
        }],
      },
    },
    {
      name: "Curved landscaped area",
      command: {
        type: "architecture.paths.create",
        paths: [{
          clientKey: "garden-bed",
          commands: [
            { op: "M", x: 80, y: 640 },
            { op: "C", c1x: 240, c1y: 560, c2x: 520, c2y: 570, x: 700, y: 660 },
            { op: "L", x: 680, y: 780 },
            { op: "Q", cx: 340, cy: 700, x: 80, y: 640 },
            { op: "Z" },
          ],
          layerId: "landscape",
          materialId: "mulch",
          style: { lineWeight: "site" },
        }],
      },
    },
  ];
}

export function executeVisualBoardCommands(sourceState, envelope, createIdentifier) {
  const state = normalizeExecutionState(sourceState);
  const initialObjectIds = new Set(state.board.objects.map((object) => object.id));
  const runtime = {
    state,
    createId: createIdentifier,
    clientKeyMap: new Map(),
    createdIds: [],
    updatedIds: new Set(),
    deletedIds: new Set(),
    warnings: [],
    outputs: [],
    mutated: false,
  };

  envelope.commands.forEach((rawCommand, commandIndex) => {
    try {
      executeCommand(runtime, rawCommand, commandIndex);
    } catch (error) {
      if (error instanceof AiCommandError && error.commandIndex === null) {
        error.commandIndex = commandIndex;
        error.path ??= `$.commands[${commandIndex}]`;
      }
      throw error;
    }
    if (runtime.state.board.objects.length > MAX_BOARD_OBJECTS) {
      throw commandError(
        `The board cannot contain more than ${MAX_BOARD_OBJECTS} objects.`,
        "board-object-limit",
        commandIndex,
      );
    }
    if (runtime.createdIds.length > MAX_OBJECTS_PER_REQUEST) {
      throw commandError(
        `A request cannot create more than ${MAX_OBJECTS_PER_REQUEST} objects.`,
        "request-object-limit",
        commandIndex,
      );
    }
  });

  reconcileSemanticConnections(runtime);
  runtime.state.board.rig = filterRigForObjects(
    runtime.state.board.rig,
    runtime.state.board.objects,
  );
  runtime.state.selectedIds = runtime.state.selectedIds.filter((id) => (
    runtime.state.board.objects.some((object) => object.id === id)
  ));
  const affectedObjects = runtime.state.board.objects.filter((object) => (
    runtime.createdIds.includes(object.id) || runtime.updatedIds.has(object.id)
  ));
  const affectedBounds = getCombinedBounds(affectedObjects);

  return {
    state: runtime.state,
    affectedBounds,
    mutated: runtime.mutated,
    outputs: runtime.outputs,
    receipt: {
      createdIds: runtime.createdIds,
      updatedIds: [...runtime.updatedIds].filter((id) => initialObjectIds.has(id)),
      deletedIds: [...runtime.deletedIds],
      clientKeyMap: Object.fromEntries(runtime.clientKeyMap),
      warnings: runtime.warnings,
    },
  };
}

export function serializeVisualBoardContext(sourceState, options = {}) {
  const state = normalizeExecutionState(sourceState);
  const floorPlanSettings = normalizeFloorPlanSettings(
    state.board.settings.floorPlan,
  );
  const detail = options?.detail === "geometry" ? "geometry" : "summary";
  const scope = ["selection", "viewport", "all"].includes(options?.scope)
    ? options.scope
    : "all";
  const maximumObjects = clampInteger(options?.maximumObjects, 1, 1_000, 300);
  const selectedIds = new Set(state.selectedIds);
  const viewportBounds = getViewportBounds(state.viewport);
  let candidates = state.board.objects;
  if (scope === "selection") {
    candidates = candidates.filter((object) => selectedIds.has(object.id));
  } else if (scope === "viewport") {
    candidates = candidates.filter((object) => boundsIntersect(
      getObjectBounds(object),
      viewportBounds,
    ));
  }

  const omittedObjectCount = Math.max(0, candidates.length - maximumObjects);
  const objects = candidates.slice(0, maximumObjects).map((object) => {
    const summary = {
      id: object.id,
      type: object.type,
      bounds: roundBounds(getObjectBounds(object)),
      rotation: roundNumber(object.rotation ?? 0),
      selected: selectedIds.has(object.id),
      locked: Boolean(object.locked),
      groupId: object.groupId ?? null,
      vertexNetworkId: object.vertexNetworkId ?? null,
      layerId: object.layerId ?? "structure",
      zIndex: roundNumber(object.zIndex ?? 0),
      style: {
        color: object.color ?? "#000000",
        strokeWidth: roundNumber(object.strokeWidth ?? 1),
        dashPattern: object.dashPattern ?? "solid",
        fillColor: object.fillColor ?? null,
        fillOpacity: roundNumber(object.fillOpacity ?? 1),
        fillPattern: object.fillPattern ?? "solid",
        opacity: roundNumber(object.opacity ?? 1),
        materialId: object.materialId ?? null,
        accentColor: object.accentColor ?? null,
      },
      hiddenInExport: Boolean(object.hiddenInExport),
      semantic: sanitizeSemantic(object.semantic),
    };
    if (object.type === "textbox") summary.text = String(object.text ?? "").slice(0, 1_000);
    if (object.type === "shape") summary.shapeKind = object.shapeKind;
    if (["connector", "line", "arc", "dimension"].includes(object.type)) {
      summary.end = {
        x: roundNumber(object.endX),
        y: roundNumber(object.endY),
      };
    }
    if (object.type === "connector") {
      summary.arrowStart = Boolean(object.arrowStart);
      summary.arrowEnd = object.arrowEnd !== false;
    }
    if (object.type === "arc") {
      summary.curvePointCount = getCurveVertices(object).length;
      if (detail === "geometry") {
        summary.curvePoints = getCurveVertices(object).slice(0, 128).map((point) => ({
          x: roundNumber(point.x),
          y: roundNumber(point.y),
        }));
      }
    }
    if (object.semantic?.role === "floor-plan-layer-designator") {
      const layerState = normalizeFloorPlanRoomState(object);
      summary.floorPlanLayer = {
        levels: layerState.floorPlanRooms,
        activeLevelId: layerState.activeFloorPlanRoomId,
        rooms: layerState.floorPlanRooms,
        activeRoomId: layerState.activeFloorPlanRoomId,
      };
    }
    if (detail === "geometry") {
      if (["rectangle", "ellipse", "shape", "textbox", "image", "area", "wall", "symbol"].includes(object.type)) {
        summary.frame = {
          x: roundNumber(object.x),
          y: roundNumber(object.y),
          w: roundNumber(object.w),
          h: roundNumber(object.h),
          rotation: roundNumber(object.rotation ?? 0),
        };
      }
      if (object.type === "area") {
        summary.vertices = object.vertices.slice(0, 256).map((point) => ({
          x: roundNumber(object.x + point.x * object.w),
          y: roundNumber(object.y + point.y * object.h),
        }));
      }
      if (object.type === "symbol") summary.symbolId = object.symbolId;
      if (object.type === "symbol") summary.fit = object.fit ?? "contain";
      if (object.type === "wall") Object.assign(summary, serializeArchitectureObject(object));
      if (object.type === "dimension") Object.assign(summary, serializeArchitectureObject(object));
      if (object.type === "textbox") {
        summary.textStyle = {
          fontSize: roundNumber(object.fontSize),
          fontFamily: object.fontFamily,
          fontWeight: roundNumber(object.fontWeight ?? 400),
          scaleMode: object.scaleMode ?? "world",
          textAlign: object.textAlign ?? "left",
          verticalAlign: object.verticalAlign ?? "top",
          lineHeight: roundNumber(object.lineHeight ?? 1.25),
          padding: roundNumber(object.padding ?? 6),
        };
      }
      if (object.type === "image" && object.referenceImage === true) {
        summary.reference = {
          name: String(object.referenceName ?? "Reference").slice(0, 120),
          bytesIncluded: false,
        };
      }
    }
    return summary;
  });

  return {
    tool: "visual-board",
    revision: state.board.revision ?? 0,
    objectCount: state.board.objects.length,
    selectedIds: [...selectedIds],
    viewport: {
      ...roundBounds(viewportBounds),
      zoom: roundNumber(state.viewport.zoom),
    },
    settings: {
      ...cloneJson(state.board.settings),
      floorPlan: {
        enabled: floorPlanSettings.enabled,
        units: floorPlanSettings.units,
        pixelsPerUnit: floorPlanSettings.pixelsPerUnit,
        wallThickness: floorPlanSettings.wallThickness,
        gridSize: floorPlanSettings.gridSize,
        alignmentGuides: floorPlanSettings.alignmentGuides,
        dimensionsVisible: floorPlanSettings.dimensionsVisible,
        labelsAlwaysVisible: floorPlanSettings.labelsAlwaysVisible,
        elementLibrary: {
          version: floorPlanSettings.elementLibrary.version,
          savedElementCount: floorPlanSettings.elementLibrary.items.length,
          hiddenBuiltIns: [...floorPlanSettings.elementLibrary.hiddenBuiltIns],
        },
        templateLibrary: {
          version: floorPlanSettings.templateLibrary.version,
          savedTemplateCount: floorPlanSettings.templateLibrary.items.length,
          hiddenBuiltIns: [...floorPlanSettings.templateLibrary.hiddenBuiltIns],
        },
      },
    },
    objects,
    omittedObjectCount,
    assets: {
      count: Object.keys(state.board.assets ?? {}).length,
      bytesIncluded: false,
    },
    architecture: {
      detail,
      catalogAvailableInCapabilities: true,
    },
    floorPlanElements: getFloorPlanTemplateCatalog(
      floorPlanSettings.elementLibrary,
      FLOOR_PLAN_ELEMENTS,
    ),
    floorPlanTemplates: getFloorPlanTemplateCatalog(
      floorPlanSettings.templateLibrary,
      FLOOR_PLAN_TEMPLATES,
    ),
  };
}

function executeCommand(runtime, commandValue, commandIndex) {
  const command = cloneJson(commandValue);
  assertOnlyCommandFields(command, commandIndex);
  if (![
    "architecture.inspect",
    "architecture.validate",
    "floor-plan.elements.list",
    "floor-plan.templates.list",
  ].includes(command.type)) {
    runtime.mutated = true;
  }
  switch (command.type) {
    case "objects.create":
      createObjects(runtime, command, commandIndex);
      break;
    case "objects.update":
      updateObjects(runtime, command, commandIndex);
      break;
    case "objects.delete":
      deleteObjects(runtime, command, commandIndex);
      break;
    case "objects.transform":
      transformObjects(runtime, command, commandIndex);
      break;
    case "objects.duplicate":
      duplicateObjects(runtime, command, commandIndex);
      break;
    case "selection.set":
      setSelection(runtime, command, commandIndex);
      break;
    case "objects.group":
      groupObjects(runtime, command, commandIndex);
      break;
    case "objects.ungroup":
      ungroupObjects(runtime, command, commandIndex);
      break;
    case "curves.points.insert":
      insertCurvePoints(runtime, command, commandIndex);
      break;
    case "curves.vertices.reinitialize":
      reinitializeCurvePointSets(runtime, command, commandIndex);
      break;
    case "vertices.create":
      createSharedPathVertices(runtime, command, commandIndex);
      break;
    case "objects.connect":
      connectObjects(runtime, command, commandIndex);
      break;
    case "objects.disconnect":
      disconnectObjects(runtime, command, commandIndex);
      break;
    case "objects.layout":
      layoutObjects(runtime, command, commandIndex);
      break;
    case "template.insert":
      insertTemplate(runtime, command, commandIndex);
      break;
    case "floor-plan.insert":
      insertFloorPlan(runtime, command, commandIndex);
      break;
    case "floor-plan.elements.list":
      listSavedFloorPlanCatalog(runtime, "element");
      break;
    case "floor-plan.elements.create":
      createSavedFloorPlanCatalogItem(runtime, command, commandIndex, "element");
      break;
    case "floor-plan.elements.update":
      updateSavedFloorPlanCatalogItem(runtime, command, commandIndex, "element");
      break;
    case "floor-plan.elements.replace":
      replaceSavedFloorPlanCatalogItem(runtime, command, commandIndex, "element");
      break;
    case "floor-plan.elements.remove":
      removeSavedFloorPlanCatalogItem(runtime, command, commandIndex, "element");
      break;
    case "floor-plan.elements.restore":
      restoreSavedFloorPlanCatalogItem(runtime, command, commandIndex, "element");
      break;
    case "floor-plan.elements.insert":
      insertSavedFloorPlanCatalogItem(runtime, command, commandIndex, "element");
      break;
    case "floor-plan.templates.list":
      listSavedFloorPlanCatalog(runtime, "template");
      break;
    case "floor-plan.templates.create":
      createSavedFloorPlanCatalogItem(runtime, command, commandIndex, "template");
      break;
    case "floor-plan.templates.update":
      updateSavedFloorPlanCatalogItem(runtime, command, commandIndex, "template");
      break;
    case "floor-plan.templates.replace":
      replaceSavedFloorPlanCatalogItem(runtime, command, commandIndex, "template");
      break;
    case "floor-plan.templates.remove":
      removeSavedFloorPlanCatalogItem(runtime, command, commandIndex, "template");
      break;
    case "floor-plan.templates.restore":
      restoreSavedFloorPlanCatalogItem(runtime, command, commandIndex, "template");
      break;
    case "floor-plan.templates.insert":
      insertSavedFloorPlanCatalogItem(runtime, command, commandIndex, "template");
      break;
    case "floor-plan.layers.move":
      moveFloorPlanLayer(runtime, command, commandIndex);
      break;
    case "floor-plan.layers.cycle":
      moveFloorPlanLayer(runtime, {
        ...command,
        direction: command.direction === "previous" ? "down" : "up",
        outputType: "floor-plan.layers.cycle",
      }, commandIndex);
      break;
    case "floor-plan.layers.add":
      addFloorPlanLayer(runtime, command, commandIndex);
      break;
    case "floor-plan.layers.remove":
      removeFloorPlanLayer(runtime, command, commandIndex);
      break;
    case "diagram.create":
      createDiagram(runtime, command, commandIndex);
      break;
    case "viewport.focus":
      focusViewport(runtime, command, commandIndex);
      break;
    case "board.settings.update":
      updateBoardSettings(runtime, command, commandIndex);
      break;
    case "architecture.areas.create":
      createArchitectureAreas(runtime, command, commandIndex);
      break;
    case "architecture.paths.create":
      createArchitecturePaths(runtime, command, commandIndex);
      break;
    case "architecture.walls.create":
      createArchitectureWalls(runtime, command, commandIndex);
      break;
    case "architecture.wallPaths.create":
      createArchitectureWallPaths(runtime, command, commandIndex);
      break;
    case "architecture.openings.create":
      createArchitectureOpenings(runtime, command, commandIndex);
      break;
    case "architecture.symbols.place":
      placeArchitectureSymbols(runtime, command, commandIndex);
      break;
    case "architecture.labels.create":
      createArchitectureLabels(runtime, command, commandIndex);
      break;
    case "architecture.dimensions.create":
      createArchitectureDimensions(runtime, command, commandIndex);
      break;
    case "architecture.materials.apply":
      applyArchitectureMaterial(runtime, command, commandIndex);
      break;
    case "architecture.style.set":
      setArchitectureStyle(runtime, command, commandIndex);
      break;
    case "architecture.layers.set":
      setArchitectureLayers(runtime, command, commandIndex);
      break;
    case "architecture.references.configure":
      configureArchitectureReferences(runtime, command, commandIndex);
      break;
    case "architecture.inspect":
      inspectArchitecture(runtime, command, commandIndex);
      break;
    case "architecture.validate":
      validateArchitecture(runtime, command, commandIndex);
      break;
    default:
      throw commandError(`Unsupported Visual Board command: ${command.type}.`, "unsupported-command", commandIndex);
  }
}

function createObjects(runtime, command, commandIndex) {
  if (!Array.isArray(command.objects) || !command.objects.length) {
    throw commandError("objects.create requires a non-empty objects list.", "invalid-objects", commandIndex);
  }
  if (command.objects.length > MAX_OBJECTS_PER_REQUEST) {
    throw commandError("Too many objects were requested.", "request-object-limit", commandIndex);
  }

  const placement = resolvePlacement(runtime.state, command.placement);
  const created = [];
  command.objects.forEach((draft, index) => {
    const result = createObjectFromDraft(runtime, draft, {
      x: placement.x + (index % 5) * 230,
      y: placement.y + Math.floor(index / 5) * 130,
    }, commandIndex);
    created.push(...result.objects);
  });
  runtime.state.board.objects.push(...created);
  runtime.state.selectedIds = created.map((object) => object.id);
}

function createObjectFromDraft(runtime, draftValue, defaultPoint, commandIndex) {
  if (!isRecord(draftValue)) {
    throw commandError("Each object draft must be a JSON object.", "invalid-object", commandIndex);
  }
  const draft = cloneJson(draftValue);
  const objectType = String(draft.objectType ?? draft.type ?? "");
  if (!OBJECT_TYPES.has(objectType)) {
    throw commandError(`Unsupported object type: ${objectType || "(missing)"}.`, "invalid-object-type", commandIndex);
  }
  const clientKey = normalizeClientKey(draft.clientKey, runtime, commandIndex);
  const style = normalizeStyle(draft, commandIndex);
  const semantic = normalizeSemantic(draft.semantic, draft.text ?? draft.label);
  const x = finiteCoordinate(draft.x, defaultPoint.x, "x", commandIndex);
  const y = finiteCoordinate(draft.y, defaultPoint.y, "y", commandIndex);
  const id = runtime.createId();
  let object;

  if (objectType === "line" || objectType === "connector") {
    object = {
      id,
      type: objectType,
      x,
      y,
      endX: finiteCoordinate(draft.endX, x + 180, "endX", commandIndex),
      endY: finiteCoordinate(draft.endY, y, "endY", commandIndex),
      ...(objectType === "connector"
        ? {
          arrowStart: Boolean(draft.arrowStart),
          arrowEnd: draft.arrowEnd !== false,
        }
        : {}),
      ...style,
      semantic,
    };
  } else if (objectType === "arc") {
    const curvePoints = draft.curvePoints === undefined
      ? null
      : requireCurvePoints(draft.curvePoints, "curvePoints", commandIndex);
    object = normalizeCurveGeometry({
      id,
      type: "arc",
      x: curvePoints?.[0]?.x ?? x,
      y: curvePoints?.[0]?.y ?? y,
      midX: finiteCoordinate(draft.midX, x + 90, "midX", commandIndex),
      midY: finiteCoordinate(draft.midY, y - 55, "midY", commandIndex),
      endX: curvePoints?.at(-1)?.x
        ?? finiteCoordinate(draft.endX, x + 180, "endX", commandIndex),
      endY: curvePoints?.at(-1)?.y
        ?? finiteCoordinate(draft.endY, y, "endY", commandIndex),
      ...(curvePoints ? { curvePoints } : {}),
      ...style,
      semantic,
    });
  } else if (objectType === "textbox") {
    const text = normalizeText(draft.text ?? draft.label, commandIndex);
    object = {
      id,
      type: "textbox",
      x,
      y,
      w: finiteDimension(draft.w, 240, "w", commandIndex),
      h: finiteDimension(draft.h, 100, "h", commandIndex),
      rotation: finiteNumber(draft.rotation, 0),
      text,
      colorRanges: [],
      fontSize: clampNumber(draft.fontSize, 8, 96, 18),
      fontFamily: FONT_FAMILIES.has(draft.fontFamily) ? draft.fontFamily : "serif",
      ...style,
      semantic,
    };
  } else {
    if (objectType === "shape" && !SHAPE_KINDS.has(draft.shapeKind)) {
      throw commandError("A shape object requires a supported shapeKind.", "invalid-shape-kind", commandIndex);
    }
    object = {
      id,
      type: objectType,
      x,
      y,
      w: finiteDimension(draft.w, 180, "w", commandIndex),
      h: finiteDimension(draft.h, 100, "h", commandIndex),
      rotation: finiteNumber(draft.rotation, 0),
      ...(objectType === "shape" ? { shapeKind: draft.shapeKind } : {}),
      ...style,
      semantic,
    };
  }

  runtime.createdIds.push(id);
  if (clientKey) runtime.clientKeyMap.set(clientKey, id);

  const label = objectType !== "textbox"
    ? normalizeOptionalText(draft.text ?? draft.label, commandIndex)
    : "";
  if (!label || ["line", "connector", "arc"].includes(objectType)) {
    return { objects: [object], primaryId: id };
  }

  const groupId = runtime.createId();
  object.groupId = groupId;
  object.rigidGroup = true;
  const textId = runtime.createId();
  const textbox = createNodeTextbox(textId, label, object, style, semantic, groupId);
  runtime.createdIds.push(textId);
  return { objects: [object, textbox], primaryId: id };
}

function updateObjects(runtime, command, commandIndex) {
  const targets = resolveTargets(runtime, command.targets ?? command.target, commandIndex);
  const patch = command.patch;
  if (!isRecord(patch)) {
    throw commandError("objects.update requires a patch object.", "invalid-patch", commandIndex);
  }
  const allowedFields = new Set([
    "color",
    "fillColor",
    "accentColor",
    "fillOpacity",
    "opacity",
    "fillPattern",
    "materialId",
    "strokeWidth",
    "dashPattern",
    "layerId",
    "zIndex",
    "shadow",
    "locked",
    "arrowStart",
    "arrowEnd",
    "text",
    "fontSize",
    "fontFamily",
    "scaleMode",
    "textAlign",
    "verticalAlign",
    "lineHeight",
    "padding",
    "rotation",
    "semantic",
  ]);
  const unknown = Object.keys(patch).find((field) => !allowedFields.has(field));
  if (unknown) {
    throw commandError(`Unsupported update field: ${unknown}.`, "unsupported-patch-field", commandIndex);
  }

  expandRigidGroupTargets(runtime.state.board.objects, targets).forEach((object) => {
    if (object.locked && patch.locked !== false) {
      throw commandError(`Object ${object.id} is locked.`, "object-locked", commandIndex);
    }
    if (patch.color !== undefined) object.color = normalizeColor(patch.color, commandIndex);
    if (patch.materialId !== undefined) {
      if (!ARCHITECTURE_MATERIAL_IDS.has(patch.materialId)) {
        throw commandError("Unknown architectural material.", "invalid-material", commandIndex);
      }
      Object.assign(object, resolveMaterialStyle(patch.materialId), {
        materialId: patch.materialId,
      });
    }
    if (patch.fillColor !== undefined) {
      if (patch.fillColor === null) delete object.fillColor;
      else object.fillColor = normalizeColor(patch.fillColor, commandIndex);
    }
    if (patch.accentColor !== undefined) {
      object.accentColor = normalizeColor(patch.accentColor, commandIndex);
    }
    if (patch.fillOpacity !== undefined) {
      object.fillOpacity = clampNumber(patch.fillOpacity, 0, 1, object.fillOpacity ?? 1);
    }
    if (patch.opacity !== undefined) {
      object.opacity = clampNumber(patch.opacity, 0, 1, object.opacity ?? 1);
    }
    if (patch.fillPattern !== undefined) {
      if (!ARCHITECTURE_FILL_PATTERNS.includes(patch.fillPattern)) {
        throw commandError("Unsupported architecture fill pattern.", "invalid-fill-pattern", commandIndex);
      }
      object.fillPattern = patch.fillPattern;
    }
    if (patch.strokeWidth !== undefined) {
      const supportsArchitecturalStroke = ARCHITECTURE_OBJECT_TYPES.includes(object.type)
        || object.semantic?.role?.startsWith("architecture-")
        || object.semantic?.role === "floor-plan-wall";
      object.strokeWidth = clampNumber(
        patch.strokeWidth,
        supportsArchitecturalStroke ? 0.25 : 1,
        supportsArchitecturalStroke ? 240 : 24,
        object.strokeWidth,
      );
    }
    if (patch.dashPattern !== undefined) {
      if (!DASH_PATTERNS.has(patch.dashPattern)) {
        throw commandError("Unsupported dash pattern.", "invalid-dash-pattern", commandIndex);
      }
      object.dashPattern = patch.dashPattern;
    }
    if (patch.layerId !== undefined) {
      object.layerId = normalizeArchitecturePlacementMetadata(
        { layerId: patch.layerId },
        commandIndex,
      ).layerId;
    }
    if (patch.zIndex !== undefined) {
      object.zIndex = clampNumber(patch.zIndex, -10_000, 10_000, object.zIndex ?? 0);
    }
    if (patch.shadow !== undefined) {
      object.shadow = normalizeArchitectureShadow(patch.shadow, commandIndex);
    }
    if (patch.locked !== undefined) object.locked = Boolean(patch.locked);
    if (patch.arrowStart !== undefined && object.type === "connector") {
      object.arrowStart = Boolean(patch.arrowStart);
    }
    if (patch.arrowEnd !== undefined && object.type === "connector") {
      object.arrowEnd = Boolean(patch.arrowEnd);
    }
    if (patch.rotation !== undefined && "rotation" in object) {
      object.rotation = finiteNumber(patch.rotation, object.rotation ?? 0);
    }
    if (patch.text !== undefined && object.type === "textbox") {
      object.text = normalizeText(patch.text, commandIndex);
      object.colorRanges = [];
    }
    if (patch.fontSize !== undefined && object.type === "textbox") {
      object.fontSize = clampNumber(patch.fontSize, 6, 96, object.fontSize);
    }
    if (patch.fontFamily !== undefined && object.type === "textbox") {
      if (!FONT_FAMILIES.has(patch.fontFamily)) {
        throw commandError("Unsupported font family.", "invalid-font-family", commandIndex);
      }
      object.fontFamily = patch.fontFamily;
    }
    if (patch.scaleMode !== undefined && object.type === "textbox") {
      object.scaleMode = ["world", "screen"].includes(patch.scaleMode)
        ? patch.scaleMode
        : object.scaleMode;
    }
    if (patch.textAlign !== undefined && object.type === "textbox") {
      object.textAlign = ["left", "center", "right"].includes(patch.textAlign)
        ? patch.textAlign
        : object.textAlign;
    }
    if (patch.verticalAlign !== undefined && object.type === "textbox") {
      object.verticalAlign = ["top", "middle", "bottom"].includes(patch.verticalAlign)
        ? patch.verticalAlign
        : object.verticalAlign;
    }
    if (patch.lineHeight !== undefined && object.type === "textbox") {
      object.lineHeight = clampNumber(patch.lineHeight, 0.8, 3, object.lineHeight ?? 1.2);
    }
    if (patch.padding !== undefined && object.type === "textbox") {
      object.padding = clampNumber(patch.padding, 0, 120, object.padding ?? 6);
    }
    if (patch.semantic !== undefined) {
      object.semantic = normalizeSemantic(patch.semantic, object.semantic?.label);
    }
    runtime.updatedIds.add(object.id);
  });
}

function deleteObjects(runtime, command, commandIndex) {
  const targets = expandRigidGroupTargets(
    runtime.state.board.objects,
    resolveTargets(runtime, command.targets ?? command.target, commandIndex),
  );
  const targetIds = new Set(targets.map((object) => object.id));
  const locked = targets.find((object) => object.locked);
  if (locked) {
    throw commandError(`Object ${locked.id} is locked.`, "object-locked", commandIndex);
  }
  runtime.state.board.objects = runtime.state.board.objects.filter((object) => {
    if (!targetIds.has(object.id)) return true;
    runtime.deletedIds.add(object.id);
    return false;
  });
}

function transformObjects(runtime, command, commandIndex) {
  let targets = expandRigidGroupTargets(
    runtime.state.board.objects,
    resolveTargets(runtime, command.targets ?? command.target, commandIndex),
  );
  if (targets.some((object) => object.locked)) {
    throw commandError("Unlock target objects before transforming them.", "object-locked", commandIndex);
  }
  const bounds = getCombinedBounds(targets);
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const translation = {
    x: finiteNumber(command.translate?.x, 0),
    y: finiteNumber(command.translate?.y, 0),
  };
  const scale = {
    x: clampNumber(command.scale?.x, 0.05, 20, 1),
    y: clampNumber(command.scale?.y, 0.05, 20, 1),
  };
  const rotation = finiteNumber(command.rotateDegrees, 0) * Math.PI / 180;
  const flipHorizontal = Boolean(command.flipHorizontal);
  const flipVertical = Boolean(command.flipVertical);
  const hasGenericTransform = (
    translation.x !== 0
    || translation.y !== 0
    || scale.x !== 1
    || scale.y !== 1
    || rotation !== 0
  );

  if (hasGenericTransform) {
    assertTargetsAreNotRigged(runtime, targets, commandIndex, "transform");
  }

  const applyFlip = (axis) => {
    const result = flipBoardSelection(
      targets,
      runtime.state.board.rig,
      axis,
      { center, mirrorText: Boolean(command.mirrorText) },
    );
    const replacements = new Map(result.objects.map((object) => [object.id, object]));
    runtime.state.board.objects = runtime.state.board.objects.map((object) => (
      replacements.get(object.id) ?? object
    ));
    runtime.state.board.rig = result.rig;
    targets = result.objects;
  };

  if (flipHorizontal) applyFlip("horizontal");
  if (flipVertical) applyFlip("vertical");

  targets.forEach((object) => {
    if (hasGenericTransform) {
      transformObject(object, center, {
        translation,
        scale,
        rotation,
        flipHorizontal: false,
        flipVertical: false,
      });
    }
    runtime.updatedIds.add(object.id);
  });
}

function duplicateObjects(runtime, command, commandIndex) {
  const targets = expandRigidGroupTargets(
    runtime.state.board.objects,
    resolveTargets(runtime, command.targets ?? command.target, commandIndex),
  );
  assertTargetsAreNotRigged(runtime, targets, commandIndex, "duplication");
  const offset = {
    x: finiteNumber(command.offset?.x, 32),
    y: finiteNumber(command.offset?.y, 32),
  };
  const idMap = new Map();
  const groupMap = new Map();
  const networkMap = new Map();
  const vertexMap = new Map();
  const duplicates = targets.map((source) => {
    const duplicate = cloneJson(source);
    const identifier = runtime.createId();
    idMap.set(source.id, identifier);
    duplicate.id = identifier;
    duplicate.locked = false;
    if (source.groupId) {
      if (!groupMap.has(source.groupId)) groupMap.set(source.groupId, runtime.createId());
      duplicate.groupId = groupMap.get(source.groupId);
    }
    if (source.vertexNetworkId) {
      if (!networkMap.has(source.vertexNetworkId)) {
        networkMap.set(source.vertexNetworkId, runtime.createId());
      }
      duplicate.vertexNetworkId = networkMap.get(source.vertexNetworkId);
      ["startVertexId", "endVertexId"].forEach((field) => {
        if (!source[field]) return;
        if (!vertexMap.has(source[field])) vertexMap.set(source[field], runtime.createId());
        duplicate[field] = vertexMap.get(source[field]);
      });
      if (Array.isArray(source.curveVertexIds)) {
        duplicate.curveVertexIds = source.curveVertexIds.map((vertexId) => {
          if (!vertexMap.has(vertexId)) vertexMap.set(vertexId, runtime.createId());
          return vertexMap.get(vertexId);
        });
      }
    }
    translateObject(duplicate, offset.x, offset.y);
    runtime.createdIds.push(identifier);
    return duplicate;
  });
  duplicates.forEach((object) => {
    if (object.semantic?.sourceId && idMap.has(object.semantic.sourceId)) {
      object.semantic.sourceId = idMap.get(object.semantic.sourceId);
    }
    if (object.semantic?.targetId && idMap.has(object.semantic.targetId)) {
      object.semantic.targetId = idMap.get(object.semantic.targetId);
    }
  });
  runtime.state.board.objects.push(...duplicates);
  runtime.state.selectedIds = duplicates.map((object) => object.id);
}

function setSelection(runtime, command, commandIndex) {
  runtime.state.selectedIds = resolveTargets(
    runtime,
    command.targets ?? command.target,
    commandIndex,
    { allowEmpty: Boolean(command.allowEmpty) },
  ).map((object) => object.id);
}

function groupObjects(runtime, command, commandIndex) {
  const targets = resolveTargets(runtime, command.targets ?? command.target, commandIndex);
  if (targets.length < 2) {
    throw commandError("Select at least two objects to create a group.", "insufficient-targets", commandIndex);
  }
  if (targets.some((object) => object.locked)) {
    throw commandError("Unlock target objects before grouping them.", "object-locked", commandIndex);
  }
  const groupId = runtime.createId();
  targets.forEach((object) => {
    object.groupId = groupId;
    object.rigidGroup = true;
    runtime.updatedIds.add(object.id);
  });
  runtime.state.selectedIds = targets.map((object) => object.id);
}

function ungroupObjects(runtime, command, commandIndex) {
  const targets = resolveTargets(runtime, command.targets ?? command.target, commandIndex);
  if (targets.some((object) => object.locked)) {
    throw commandError("Unlock target objects before ungrouping them.", "object-locked", commandIndex);
  }
  const groupIds = new Set(targets.map((object) => object.groupId).filter(Boolean));
  if (!groupIds.size) {
    throw commandError("The target objects are not grouped.", "not-grouped", commandIndex);
  }
  runtime.state.board.objects.forEach((object) => {
    if (!groupIds.has(object.groupId)) return;
    delete object.groupId;
    delete object.rigidGroup;
    delete object.vertexNetworkId;
    delete object.startVertexId;
    delete object.endVertexId;
    delete object.curveVertexIds;
    delete object.dimensionsLocked;
    runtime.updatedIds.add(object.id);
  });
}

function insertCurvePoints(runtime, command, commandIndex) {
  const targets = resolveTargets(
    runtime,
    command.targets ?? command.target,
    commandIndex,
  );
  if (targets.length !== 1 || targets[0].type !== "arc") {
    throw commandError(
      "Curve point insertion requires exactly one arc target.",
      "invalid-curve-target",
      commandIndex,
    );
  }
  const target = targets[0];
  if (target.locked) {
    throw commandError("Unlock the curve before adding points.", "object-locked", commandIndex);
  }
  const points = requireInsertionPoints(command.points, "points", commandIndex);
  let curve = target;
  const inserted = [];
  points.forEach((point) => {
    const result = insertCurveVertex(curve, point);
    if (!result.inserted) {
      throw commandError(
        "A requested curve point could not be inserted.",
        "curve-point-insertion-failed",
        commandIndex,
      );
    }
    curve = result.curve;
    if (curve.vertexNetworkId && Array.isArray(curve.curveVertexIds)) {
      curve.curveVertexIds[result.vertexIndex] = runtime.createId();
    }
    inserted.push({
      index: result.vertexIndex,
      x: result.point.x,
      y: result.point.y,
    });
  });
  replaceObjectValue(target, curve);
  runtime.updatedIds.add(target.id);
  runtime.state.selectedIds = [target.id];
  runtime.outputs.push({
    type: "curves.points.insert",
    objectId: target.id,
    inserted,
    curvePointCount: getCurveVertices(target).length,
  });
}

function reinitializeCurvePointSets(runtime, command, commandIndex) {
  const targets = resolveTargets(
    runtime,
    command.targets ?? command.target,
    commandIndex,
  );
  if (targets.some((object) => object.type !== "arc")) {
    throw commandError(
      "Curve vertex reinitialization requires only arc targets.",
      "invalid-curve-target",
      commandIndex,
    );
  }
  if (targets.some((object) => object.locked)) {
    throw commandError(
      "Unlock curves before reinitializing their vertices.",
      "object-locked",
      commandIndex,
    );
  }

  const preserveVertexIds = findSharedPathVertexIds(runtime.state.board.objects);
  const curves = targets.map((target) => {
    const beforeCount = getCurveVertices(target).length;
    const curve = reinitializeCurveVertices(target, {
      createIdentifier: runtime.createId,
      preserveVertexIds,
    });
    replaceObjectValue(target, curve);
    runtime.updatedIds.add(target.id);
    return {
      objectId: target.id,
      beforeCount,
      vertexCount: getCurveVertices(target).length,
    };
  });
  runtime.state.selectedIds = targets.map((object) => object.id);
  runtime.outputs.push({
    type: "curves.vertices.reinitialize",
    curves,
    vertexCount: curves.reduce((total, curve) => total + curve.vertexCount, 0),
  });
}

function findSharedPathVertexIds(objects) {
  const counts = new Map();
  objects.forEach((object) => {
    const ids = object.type === "arc"
      ? object.curveVertexIds ?? []
      : [object.startVertexId, object.endVertexId];
    ids.forEach((id) => {
      if (typeof id !== "string" || !id) return;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    });
  });
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
}

function createSharedPathVertices(runtime, command, commandIndex) {
  const targets = resolveTargets(
    runtime,
    command.targets ?? command.target,
    commandIndex,
  );
  if (targets.some((object) => object.locked)) {
    throw commandError("Unlock paths before creating vertices.", "object-locked", commandIndex);
  }
  if (targets.some((object) => ![
    "line",
    "connector",
    "arc",
    "rectangle",
    "ellipse",
    "shape",
  ].includes(object.type))) {
    throw commandError(
      "Shared vertices can be created from lines, curves, and outlined shapes.",
      "invalid-vertex-path",
      commandIndex,
    );
  }
  if (targets.some((object) => object.rigidGroup)) {
    throw commandError(
      "Ungroup rigid groups before creating path vertices.",
      "rigid-group-not-supported",
      commandIndex,
    );
  }

  const sourcePaths = targets.flatMap((object) => {
    if (["line", "connector", "arc"].includes(object.type)) {
      return [cloneJson(object)];
    }
    return getObjectSegments(object).map(([start, end]) => ({
      id: runtime.createId(),
      type: "line",
      x: start.x,
      y: start.y,
      endX: end.x,
      endY: end.y,
      color: object.color,
      strokeWidth: object.strokeWidth,
      dashPattern: object.dashPattern ?? "solid",
      locked: false,
    }));
  });
  const network = createEditableVertexNetwork(
    sourcePaths,
    runtime.createId,
    0.01,
  );
  if (!network) {
    throw commandError(
      "The selected paths could not form a vertex network.",
      "vertex-network-failed",
      commandIndex,
    );
  }
  const targetIds = new Set(targets.map((object) => object.id));
  const initialIds = new Set(runtime.state.board.objects.map((object) => object.id));
  let inserted = false;
  runtime.state.board.objects = runtime.state.board.objects.flatMap((object) => {
    if (!targetIds.has(object.id)) return [object];
    if (inserted) return [];
    inserted = true;
    return network.objects;
  });
  const networkObjectIds = new Set(network.objects.map((object) => object.id));
  targets.forEach((object) => {
    if (!networkObjectIds.has(object.id)) runtime.deletedIds.add(object.id);
  });
  network.objects.forEach((object) => {
    if (initialIds.has(object.id)) runtime.updatedIds.add(object.id);
    else runtime.createdIds.push(object.id);
  });
  runtime.state.selectedIds = network.objects.map((object) => object.id);
  runtime.outputs.push({
    type: "vertices.create",
    networkId: network.networkId,
    objectIds: [...runtime.state.selectedIds],
    vertexCount: network.vertices.length,
  });
}

function connectObjects(runtime, command, commandIndex) {
  const source = resolveSingleReference(runtime, command.from, commandIndex, "from");
  const target = resolveSingleReference(runtime, command.to, commandIndex, "to");
  if (source.id === target.id) {
    throw commandError("A connection needs two different objects.", "self-connection", commandIndex);
  }
  const sourceBounds = getObjectBounds(source);
  const targetBounds = getObjectBounds(target);
  const identifier = runtime.createId();
  const connection = {
    id: identifier,
    type: command.connectorType === "line" ? "line" : "connector",
    x: sourceBounds.x + sourceBounds.width / 2,
    y: sourceBounds.y + sourceBounds.height / 2,
    endX: targetBounds.x + targetBounds.width / 2,
    endY: targetBounds.y + targetBounds.height / 2,
    ...(command.connectorType === "line"
      ? {}
      : {
        arrowStart: Boolean(command.arrowStart),
        arrowEnd: command.arrowEnd !== false,
      }),
    ...normalizeStyle(command, commandIndex),
    semantic: normalizeSemantic({
      label: command.label,
      role: "connection",
      sourceId: source.id,
      targetId: target.id,
      tags: command.tags,
    }),
  };
  runtime.state.board.objects.unshift(connection);
  runtime.createdIds.push(identifier);
  if (command.clientKey) {
    const clientKey = normalizeClientKey(command.clientKey, runtime, commandIndex);
    runtime.clientKeyMap.set(clientKey, identifier);
  }
}

function disconnectObjects(runtime, command, commandIndex) {
  const source = command.from
    ? resolveSingleReference(runtime, command.from, commandIndex, "from")
    : null;
  const target = command.to
    ? resolveSingleReference(runtime, command.to, commandIndex, "to")
    : null;
  if (!source && !target && !command.targets) {
    throw commandError("Specify a connection or its source/target.", "missing-target", commandIndex);
  }
  const explicitIds = command.targets
    ? new Set(resolveTargets(runtime, command.targets, commandIndex).map((object) => object.id))
    : null;
  runtime.state.board.objects = runtime.state.board.objects.filter((object) => {
    const matchesExplicit = explicitIds?.has(object.id);
    const matchesRelationship = ["connector", "line"].includes(object.type)
      && (!source || object.semantic?.sourceId === source.id)
      && (!target || object.semantic?.targetId === target.id);
    if (!matchesExplicit && !matchesRelationship) return true;
    if (object.locked) {
      throw commandError(`Connection ${object.id} is locked.`, "object-locked", commandIndex);
    }
    runtime.deletedIds.add(object.id);
    return false;
  });
}

function layoutObjects(runtime, command, commandIndex) {
  const targets = expandRigidGroupTargets(
    runtime.state.board.objects,
    resolveTargets(runtime, command.targets ?? command.target, commandIndex),
  );
  const layoutType = String(command.layoutType ?? "");
  if (!LAYOUT_TYPES.has(layoutType)) {
    throw commandError(`Unsupported layout: ${layoutType}.`, "invalid-layout", commandIndex);
  }
  if (targets.some((object) => object.locked)) {
    throw commandError("Unlock target objects before laying them out.", "object-locked", commandIndex);
  }
  assertTargetsAreNotRigged(runtime, targets, commandIndex, "layout");
  const units = createLayoutUnits(targets);
  applyDeterministicLayout(units, layoutType, command);
  targets.forEach((object) => runtime.updatedIds.add(object.id));
}

function insertTemplate(runtime, command, commandIndex) {
  const template = String(command.template ?? "");
  const placement = command.placement ?? { type: "viewport-center" };
  if (template === "basic-flow") {
    createDiagram(runtime, {
      type: "diagram.create",
      diagramType: "flowchart",
      direction: command.direction ?? "horizontal",
      nodes: command.nodes ?? [
        { key: "input", label: "Input" },
        { key: "process", label: "Process" },
        { key: "output", label: "Output" },
      ],
      edges: command.edges ?? [
        { from: "input", to: "process" },
        { from: "process", to: "output" },
      ],
      placement,
      stylePreset: command.stylePreset,
    }, commandIndex);
    return;
  }
  if (template === "comparison") {
    createDiagram(runtime, {
      type: "diagram.create",
      diagramType: "comparison-table",
      columns: command.columns ?? [
        { title: "Option A", items: ["Point one", "Point two"] },
        { title: "Option B", items: ["Point one", "Point two"] },
      ],
      placement,
      stylePreset: command.stylePreset,
    }, commandIndex);
    return;
  }
  if (template === "timeline") {
    createDiagram(runtime, {
      type: "diagram.create",
      diagramType: "timeline",
      events: command.events ?? [
        { label: "Beginning" },
        { label: "Middle" },
        { label: "End" },
      ],
      placement,
      stylePreset: command.stylePreset,
    }, commandIndex);
    return;
  }
  throw commandError(`Unsupported template: ${template || "(missing)"}.`, "invalid-template", commandIndex);
}

function insertFloorPlan(runtime, command, commandIndex) {
  const kind = String(command.kind ?? "");
  const isTemplate = FLOOR_PLAN_TEMPLATES.includes(kind);
  if (!isTemplate && !FLOOR_PLAN_ELEMENTS.includes(kind)) {
    throw commandError(
      `Unsupported floor-plan item: ${kind || "(missing)"}.`,
      "invalid-floor-plan-item",
      commandIndex,
    );
  }
  if (command.settings !== undefined && !isRecord(command.settings)) {
    throw commandError(
      "floor-plan.insert settings must be an object.",
      "invalid-floor-plan-settings",
      commandIndex,
    );
  }

  const origin = resolvePlacement(runtime.state, command.placement);
  const settings = normalizeFloorPlanSettings({
    ...runtime.state.board.settings.floorPlan,
    ...(command.settings ?? {}),
  });
  const catalogType = isTemplate ? "template" : "element";
  const catalogConfig = getFloorPlanCommandCatalogConfig(catalogType);
  const library = settings[catalogConfig.libraryKey];
  const catalogItem = getFloorPlanTemplateCatalog(library, catalogConfig.builtInIds)
    .find((item) => item.id === kind && item.visible);
  if (!catalogItem) {
    throw commandError(
      `The floor-plan ${catalogConfig.singular} is removed.`,
      `${catalogConfig.singular}-not-found`,
      commandIndex,
    );
  }
  const record = getFloorPlanTemplateRecord(library, kind, catalogConfig.builtInIds);
  const objects = record
    ? instantiateCharacter(record.character, runtime.createId, origin).objects
    : isTemplate
      ? createFloorPlanTemplate(kind, origin, settings, runtime.createId)
      : createFloorPlanElement(kind, origin, settings, runtime.createId);

  runtime.state.board.objects.push(...objects);
  runtime.state.selectedIds = objects.map((object) => object.id);
  runtime.createdIds.push(...runtime.state.selectedIds);
  runtime.state.board.settings.floorPlan = settings;
}

function listSavedFloorPlanCatalog(runtime, catalogType) {
  const config = getFloorPlanCommandCatalogConfig(catalogType);
  runtime.outputs.push({
    type: `${config.commandPrefix}.list`,
    [config.plural]: getFloorPlanTemplateCatalog(
      runtime.state.board.settings.floorPlan[config.libraryKey],
      config.builtInIds,
    ),
  });
}

function createSavedFloorPlanCatalogItem(runtime, command, commandIndex, catalogType) {
  const config = getFloorPlanCommandCatalogConfig(catalogType);
  const itemId = String(command[config.idField] ?? "");
  if (config.builtInIds.includes(itemId)) {
    throw commandError(
      `Use ${config.commandPrefix}.replace to customize a built-in ${config.singular}.`,
      `built-in-${config.singular}-id`,
      commandIndex,
    );
  }
  const character = createFloorPlanCatalogCharacter(
    runtime,
    command.targets,
    command.name,
    commandIndex,
    catalogType,
  );
  try {
    const record = createFloorPlanTemplateRecord(character, {
      id: itemId,
      name: command.name,
      description: command.description,
      category: command.category ?? (catalogType === "template" ? "rooms" : "structures"),
      createdAt: Date.now(),
    });
    const library = addFloorPlanTemplate(
      runtime.state.board.settings.floorPlan[config.libraryKey],
      record,
      config.builtInIds,
    );
    setFloorPlanCatalogLibrary(runtime, library, catalogType);
    runtime.outputs.push({
      type: `${config.commandPrefix}.create`,
      [config.singular]: getFloorPlanTemplateCatalog(library, config.builtInIds)
        .find((item) => item.id === itemId),
    });
  } catch (error) {
    throw commandError(
      error.message,
      `invalid-floor-plan-${config.singular}`,
      commandIndex,
    );
  }
}

function updateSavedFloorPlanCatalogItem(runtime, command, commandIndex, catalogType) {
  const config = getFloorPlanCommandCatalogConfig(catalogType);
  const itemId = command[config.idField];
  if (
    command.name === undefined
    && command.description === undefined
    && command.category === undefined
  ) {
    throw commandError(
      `${formatCommandCatalogName(config.singular)} updates need a name or description.`,
      `empty-${config.singular}-update`,
      commandIndex,
    );
  }
  try {
    const library = updateFloorPlanTemplate(
      runtime.state.board.settings.floorPlan[config.libraryKey],
      itemId,
      {
        name: command.name,
        description: command.description,
        category: command.category,
      },
      config.builtInIds,
    );
    setFloorPlanCatalogLibrary(runtime, library, catalogType);
    runtime.outputs.push({
      type: `${config.commandPrefix}.update`,
      [config.singular]: getFloorPlanTemplateCatalog(library, config.builtInIds)
        .find((item) => item.id === itemId),
    });
  } catch (error) {
    throw commandError(error.message, `${config.singular}-not-editable`, commandIndex);
  }
}

function replaceSavedFloorPlanCatalogItem(runtime, command, commandIndex, catalogType) {
  const config = getFloorPlanCommandCatalogConfig(catalogType);
  const itemId = command[config.idField];
  const character = createFloorPlanCatalogCharacter(
    runtime,
    command.targets,
    command.name || itemId,
    commandIndex,
    catalogType,
  );
  try {
    const library = replaceFloorPlanTemplate(
      runtime.state.board.settings.floorPlan[config.libraryKey],
      itemId,
      character,
      {
        id: runtime.createId(),
        name: command.name,
        description: command.description,
        category: command.category,
        updatedAt: Date.now(),
      },
      config.builtInIds,
    );
    setFloorPlanCatalogLibrary(runtime, library, catalogType);
    runtime.outputs.push({
      type: `${config.commandPrefix}.replace`,
      [config.singular]: getFloorPlanTemplateCatalog(library, config.builtInIds)
        .find((item) => item.id === itemId),
    });
  } catch (error) {
    throw commandError(error.message, `${config.singular}-not-found`, commandIndex);
  }
}

function removeSavedFloorPlanCatalogItem(runtime, command, commandIndex, catalogType) {
  const config = getFloorPlanCommandCatalogConfig(catalogType);
  const itemId = command[config.idField];
  if (!hasFloorPlanRemovalPassword(command.password)) {
    throw commandError(
      "The floor-plan removal password is incorrect.",
      "invalid-removal-password",
      commandIndex,
    );
  }
  const catalog = getFloorPlanTemplateCatalog(
    runtime.state.board.settings.floorPlan[config.libraryKey],
    config.builtInIds,
  );
  if (!catalog.some((item) => item.id === itemId)) {
    throw commandError(
      `The floor-plan ${config.singular} does not exist.`,
      `${config.singular}-not-found`,
      commandIndex,
    );
  }
  const library = removeFloorPlanTemplate(
    runtime.state.board.settings.floorPlan[config.libraryKey],
    itemId,
    config.builtInIds,
  );
  setFloorPlanCatalogLibrary(runtime, library, catalogType);
  runtime.outputs.push({
    type: `${config.commandPrefix}.remove`,
    [config.idField]: itemId,
  });
}

function restoreSavedFloorPlanCatalogItem(runtime, command, commandIndex, catalogType) {
  const config = getFloorPlanCommandCatalogConfig(catalogType);
  const itemId = command[config.idField];
  try {
    const library = restoreBuiltInFloorPlanTemplate(
      runtime.state.board.settings.floorPlan[config.libraryKey],
      itemId,
      config.builtInIds,
    );
    setFloorPlanCatalogLibrary(runtime, library, catalogType);
    runtime.outputs.push({
      type: `${config.commandPrefix}.restore`,
      [config.singular]: getFloorPlanTemplateCatalog(library, config.builtInIds)
        .find((item) => item.id === itemId),
    });
  } catch (error) {
    throw commandError(
      error.message,
      `invalid-built-in-${config.singular}`,
      commandIndex,
    );
  }
}

function insertSavedFloorPlanCatalogItem(runtime, command, commandIndex, catalogType) {
  const config = getFloorPlanCommandCatalogConfig(catalogType);
  const itemId = command[config.idField];
  const library = runtime.state.board.settings.floorPlan[config.libraryKey];
  const catalogItem = getFloorPlanTemplateCatalog(library, config.builtInIds)
    .find((item) => item.id === itemId && item.visible);
  if (!catalogItem) {
    throw commandError(
      `The floor-plan ${config.singular} does not exist or is removed.`,
      `${config.singular}-not-found`,
      commandIndex,
    );
  }

  const placement = resolvePlacement(runtime.state, command.placement);
  const record = getFloorPlanTemplateRecord(library, itemId, config.builtInIds);
  const objects = record
    ? instantiateCharacter(record.character, runtime.createId, placement).objects
    : catalogType === "element"
      ? createFloorPlanElement(
        itemId,
        placement,
        runtime.state.board.settings.floorPlan,
        runtime.createId,
      )
      : createFloorPlanTemplate(
        itemId,
        placement,
        runtime.state.board.settings.floorPlan,
        runtime.createId,
      );
  addArchitectureObjects(runtime, objects);
  runtime.outputs.push({
    type: `${config.commandPrefix}.insert`,
    [config.idField]: itemId,
    objectCount: objects.length,
  });
}

function getFloorPlanLayerDesignator(runtime, designatorId, commandIndex) {
  const object = runtime.state.board.objects.find((candidate) => (
    candidate.id === designatorId
    && candidate.semantic?.role === "floor-plan-layer-designator"
  ));
  if (!object) {
    throw commandError(
      "The layer designator does not exist.",
      "layer-designator-not-found",
      commandIndex,
    );
  }
  if (object.locked) {
    throw commandError(
      "The layer designator is locked.",
      "object-locked",
      commandIndex,
    );
  }
  return object;
}

function moveFloorPlanLayer(runtime, command, commandIndex) {
  const object = getFloorPlanLayerDesignator(
    runtime,
    command.designatorId,
    commandIndex,
  );
  const previousState = normalizeFloorPlanRoomState(object);
  const state = moveFloorPlanRoom(
    object,
    command.direction === "down" ? -1 : 1,
  );
  Object.assign(object, state);
  runtime.updatedIds.add(object.id);
  runtime.state.selectedIds = [object.id];
  runtime.outputs.push({
    type: command.outputType ?? "floor-plan.layers.move",
    designatorId: object.id,
    activeLevelId: state.activeFloorPlanRoomId,
    activeRoomId: state.activeFloorPlanRoomId,
    moved: state.activeFloorPlanRoomId !== previousState.activeFloorPlanRoomId,
  });
}

function addFloorPlanLayer(runtime, command, commandIndex) {
  const object = getFloorPlanLayerDesignator(
    runtime,
    command.designatorId,
    commandIndex,
  );
  try {
    const next = addFloorPlanRoom(
      object,
      command.level ?? command.name,
      runtime.createId,
    );
    const { room, ...state } = next;
    Object.assign(object, state);
    runtime.updatedIds.add(object.id);
    runtime.state.selectedIds = [object.id];
    runtime.outputs.push({
      type: "floor-plan.layers.add",
      designatorId: object.id,
      room,
    });
  } catch (error) {
    throw commandError(error.message, "invalid-floor-plan-layer", commandIndex);
  }
}

function removeFloorPlanLayer(runtime, command, commandIndex) {
  if (!hasFloorPlanRemovalPassword(command.password)) {
    throw commandError(
      "The floor-plan removal password is incorrect.",
      "invalid-removal-password",
      commandIndex,
    );
  }
  const object = getFloorPlanLayerDesignator(
    runtime,
    command.designatorId,
    commandIndex,
  );
  try {
    const next = removeActiveFloorPlanRoom(object);
    const { removedRoomId, ...state } = next;
    Object.assign(object, state);
    const deletedIds = new Set(
      runtime.state.board.objects
        .filter((candidate) => (
          candidate.semantic?.referenceId === object.id
          && candidate.semantic?.roomId === removedRoomId
        ))
        .map((candidate) => candidate.id),
    );
    runtime.state.board.objects = runtime.state.board.objects
      .filter((candidate) => !deletedIds.has(candidate.id));
    deletedIds.forEach((id) => runtime.deletedIds.add(id));
    runtime.updatedIds.add(object.id);
    runtime.state.selectedIds = [object.id];
    runtime.outputs.push({
      type: "floor-plan.layers.remove",
      designatorId: object.id,
      removedRoomId,
      deletedObjectCount: deletedIds.size,
    });
  } catch (error) {
    throw commandError(error.message, "invalid-floor-plan-layer", commandIndex);
  }
}

function createFloorPlanCatalogCharacter(
  runtime,
  targetsValue,
  name,
  commandIndex,
  catalogType,
) {
  const config = getFloorPlanCommandCatalogConfig(catalogType);
  const targets = resolveTargets(runtime, targetsValue, commandIndex);
  if (targets.some((object) => object.type === "image" || object.assetId)) {
    throw commandError(
      `Floor-plan ${config.plural} are vector-only; image-backed selections belong in the Board Library.`,
      `${config.singular}-image-not-allowed`,
      commandIndex,
    );
  }
  try {
    return createCharacterPackage(
      runtime.state.board.objects,
      {},
      runtime.state.board.rig,
      targets.map((object) => object.id),
      name,
    );
  } catch (error) {
    throw commandError(
      error.message,
      `invalid-${config.singular}-selection`,
      commandIndex,
    );
  }
}

function setFloorPlanCatalogLibrary(runtime, library, catalogType) {
  const config = getFloorPlanCommandCatalogConfig(catalogType);
  runtime.state.board.settings.floorPlan = normalizeFloorPlanSettings({
    ...runtime.state.board.settings.floorPlan,
    [config.libraryKey]: library,
  });
}

function getFloorPlanCommandCatalogConfig(catalogType) {
  if (catalogType === "element") {
    return {
      singular: "element",
      plural: "elements",
      libraryKey: "elementLibrary",
      builtInIds: FLOOR_PLAN_ELEMENTS,
      idField: "elementId",
      commandPrefix: "floor-plan.elements",
    };
  }
  return {
    singular: "template",
    plural: "templates",
    libraryKey: "templateLibrary",
    builtInIds: FLOOR_PLAN_TEMPLATES,
    idField: "templateId",
    commandPrefix: "floor-plan.templates",
  };
}

function formatCommandCatalogName(value) {
  return `${String(value).charAt(0).toUpperCase()}${String(value).slice(1)}`;
}

function createDiagram(runtime, command, commandIndex) {
  const diagramType = String(command.diagramType ?? "");
  if (!DIAGRAM_TYPES.has(diagramType)) {
    throw commandError(`Unsupported diagram type: ${diagramType || "(missing)"}.`, "invalid-diagram-type", commandIndex);
  }
  const graph = normalizeDiagramGraph(command, diagramType, commandIndex);
  if (!graph.nodes.length) {
    throw commandError("The diagram needs at least one node.", "empty-diagram", commandIndex);
  }
  if (graph.nodes.length > 150) {
    throw commandError("A diagram can contain at most 150 labeled nodes.", "diagram-too-large", commandIndex);
  }
  const placement = resolvePlacement(runtime.state, command.placement);
  const style = {
    ...STYLE_PRESETS.current,
    ...(STYLE_PRESETS[command.stylePreset] ?? STYLE_PRESETS.current),
    ...(isRecord(command.style) ? command.style : {}),
  };
  const layout = layoutDiagram(graph, diagramType, command, placement);
  const diagramId = runtime.createId();
  const nodeRecords = new Map();
  const objects = [];

  layout.nodes.forEach((node, index) => {
    const nodeStyle = {
      ...style,
      color: style.accentColors?.[index % style.accentColors.length]
        ?? style.color
        ?? "#000000",
    };
    const groupId = runtime.createId();
    const shapeId = runtime.createId();
    const textId = runtime.createId();
    const semantic = normalizeSemantic({
      label: node.label,
      role: node.role ?? "diagram-node",
      tags: node.tags,
      diagramId,
      clientRef: node.key,
      generatedBy: "ai-command",
    });
    const shape = {
      id: shapeId,
      type: node.objectType === "ellipse" ? "ellipse" : "rectangle",
      x: node.x,
      y: node.y,
      w: node.width,
      h: node.height,
      rotation: 0,
      color: normalizeColor(nodeStyle.color, commandIndex),
      strokeWidth: clampNumber(nodeStyle.strokeWidth, 1, 24, 3),
      dashPattern: DASH_PATTERNS.has(nodeStyle.dashPattern)
        ? nodeStyle.dashPattern
        : "solid",
      locked: false,
      groupId,
      rigidGroup: true,
      semantic,
    };
    const textbox = createNodeTextbox(
      textId,
      node.label,
      shape,
      nodeStyle,
      semantic,
      groupId,
    );
    objects.push(shape, textbox);
    nodeRecords.set(node.key, { node, shape, textbox });
    runtime.createdIds.push(shapeId, textId);
    if (node.clientKey) {
      const clientKey = normalizeClientKey(node.clientKey, runtime, commandIndex);
      runtime.clientKeyMap.set(clientKey, shapeId);
    }
  });

  const connections = layout.edges.map((edge) => {
    const source = nodeRecords.get(edge.from)?.shape;
    const target = nodeRecords.get(edge.to)?.shape;
    if (!source || !target) {
      throw commandError("A diagram edge references an unknown node.", "unknown-diagram-node", commandIndex);
    }
    const identifier = runtime.createId();
    runtime.createdIds.push(identifier);
    return {
      id: identifier,
      type: edge.arrow === false ? "line" : "connector",
      x: source.x + source.w / 2,
      y: source.y + source.h / 2,
      endX: target.x + target.w / 2,
      endY: target.y + target.h / 2,
      color: normalizeColor(style.color ?? "#000000", commandIndex),
      strokeWidth: clampNumber(style.strokeWidth, 1, 24, 3),
      dashPattern: DASH_PATTERNS.has(style.dashPattern) ? style.dashPattern : "solid",
      locked: false,
      semantic: normalizeSemantic({
        label: edge.label,
        role: "connection",
        diagramId,
        sourceId: source.id,
        targetId: target.id,
        generatedBy: "ai-command",
      }),
    };
  });

  runtime.state.board.objects.push(...connections, ...objects);
  runtime.state.selectedIds = [...connections, ...objects].map((object) => object.id);
}

function focusViewport(runtime, command, commandIndex) {
  let point;
  if (command.targets || command.target) {
    const targets = resolveTargets(runtime, command.targets ?? command.target, commandIndex);
    const bounds = getCombinedBounds(targets);
    point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  } else if (isRecord(command.point)) {
    point = {
      x: finiteCoordinate(command.point.x, runtime.state.viewport.x, "point.x", commandIndex),
      y: finiteCoordinate(command.point.y, runtime.state.viewport.y, "point.y", commandIndex),
    };
  } else {
    throw commandError("viewport.focus requires targets or a point.", "missing-target", commandIndex);
  }
  const zoom = command.zoom === undefined
    ? runtime.state.viewport.zoom
    : clampNumber(command.zoom, 0.15, 4, runtime.state.viewport.zoom);
  runtime.state.viewport.zoom = zoom;
  runtime.state.viewport.x = point.x - runtime.state.viewport.width / zoom / 2;
  runtime.state.viewport.y = point.y - runtime.state.viewport.height / zoom / 2;
}

function updateBoardSettings(runtime, command, commandIndex) {
  if (!isRecord(command.settings)) {
    throw commandError("board.settings.update requires settings.", "invalid-settings", commandIndex);
  }
  const unknown = Object.keys(command.settings).find((field) => (
    !["grid", "snap", "floorPlan"].includes(field)
  ));
  if (unknown) {
    throw commandError(`Unsupported board setting: ${unknown}.`, "unsupported-setting", commandIndex);
  }
  if (command.settings.grid !== undefined) {
    runtime.state.board.settings.grid = Boolean(command.settings.grid);
  }
  if (command.settings.snap !== undefined) {
    runtime.state.board.settings.snap = Boolean(command.settings.snap);
  }
  if (command.settings.floorPlan !== undefined) {
    if (!isRecord(command.settings.floorPlan)) {
      throw commandError(
        "floorPlan settings must be an object.",
        "invalid-floor-plan-settings",
        commandIndex,
      );
    }
    runtime.state.board.settings.floorPlan = normalizeFloorPlanSettings({
      ...runtime.state.board.settings.floorPlan,
      ...command.settings.floorPlan,
    });
  }
}

function createArchitectureAreas(runtime, command, commandIndex) {
  const items = requireArchitectureItems(command.areas, "areas", 100, commandIndex);
  const objects = items.map((item, itemIndex) => {
    assertArchitectureItemFields(
      item,
      ["vertices", "materialId", ...architectureCommonItemFields()],
      `areas[${itemIndex}]`,
      commandIndex,
    );
    const vertices = requireArchitecturePoints(
      item.vertices,
      `areas[${itemIndex}].vertices`,
      3,
      256,
      commandIndex,
    );
    if (!ARCHITECTURE_MATERIAL_IDS.has(String(item.materialId ?? ""))) {
      throw commandError("Architecture areas require a supported materialId.", "invalid-material", commandIndex);
    }
    const id = runtime.createId();
    const clientKey = registerArchitectureClientKey(runtime, item.clientKey, id, commandIndex);
    return createArchitectureAreaObject({
      id,
      item,
      vertices,
      clientKey,
      commandIndex,
      role: "architecture-area",
      architectureSettings: runtime.state.board.settings.architecture,
    });
  });
  addArchitectureObjects(runtime, objects);
}

function createArchitecturePaths(runtime, command, commandIndex) {
  const items = requireArchitectureItems(command.paths, "paths", 100, commandIndex);
  const objects = items.map((item, itemIndex) => {
    assertArchitectureItemFields(
      item,
      ["commands", "materialId", "curveSteps", ...architectureCommonItemFields()],
      `paths[${itemIndex}]`,
      commandIndex,
    );
    if (!ARCHITECTURE_MATERIAL_IDS.has(String(item.materialId ?? ""))) {
      throw commandError(
        "Architecture paths require a supported materialId.",
        "invalid-material",
        commandIndex,
      );
    }
    validateArchitecturePathCommands(
      item.commands,
      `paths[${itemIndex}].commands`,
      commandIndex,
    );
    let sampled;
    try {
      sampled = sampleArchitecturePath(item.commands, {
        curveSteps: clampNumber(item.curveSteps, 4, 96, 18),
      });
    } catch (error) {
      throw commandError(error.message, "invalid-architecture-path", commandIndex);
    }
    if (!sampled.closed || sampled.points.length < 3) {
      throw commandError(
        "Filled architecture paths must end with Z and contain at least three points.",
        "invalid-architecture-path",
        commandIndex,
      );
    }
    const id = runtime.createId();
    const clientKey = registerArchitectureClientKey(runtime, item.clientKey, id, commandIndex);
    return createArchitectureAreaObject({
      id,
      item,
      vertices: sampled.points,
      clientKey,
      commandIndex,
      role: "architecture-curved-area",
      architectureSettings: runtime.state.board.settings.architecture,
    });
  });
  addArchitectureObjects(runtime, objects);
}

function createArchitectureAreaObject({
  id,
  item,
  vertices,
  clientKey,
  commandIndex,
  role,
  semanticOverride = null,
  architectureSettings = null,
}) {
  const left = Math.min(...vertices.map((point) => point.x));
  const top = Math.min(...vertices.map((point) => point.y));
  const right = Math.max(...vertices.map((point) => point.x));
  const bottom = Math.max(...vertices.map((point) => point.y));
  if (right - left < 1 || bottom - top < 1) {
    throw commandError("Architecture areas need non-zero width and height.", "invalid-area", commandIndex);
  }
  return {
    id,
    type: "area",
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
    rotation: 0,
    vertices: vertices.map((point) => ({
      x: (point.x - left) / (right - left),
      y: (point.y - top) / (bottom - top),
    })),
    ...normalizeArchitecturePaint(
      item,
      commandIndex,
      item.materialId,
      architectureSettings,
    ),
    ...normalizeArchitecturePlacementMetadata(item, commandIndex),
    semantic: semanticOverride ?? normalizeArchitectureSemantic(
      item.semantic,
      role,
      clientKey,
      commandIndex,
    ),
  };
}

function createArchitectureWalls(runtime, command, commandIndex) {
  const items = requireArchitectureItems(command.walls, "walls", 250, commandIndex);
  const objects = items.map((item, itemIndex) => {
    assertArchitectureItemFields(
      item,
      ["start", "end", "thickness", "materialId", ...architectureCommonItemFields()],
      `walls[${itemIndex}]`,
      commandIndex,
    );
    const start = requireArchitecturePoint(item.start, `walls[${itemIndex}].start`, commandIndex);
    const end = requireArchitecturePoint(item.end, `walls[${itemIndex}].end`, commandIndex);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 1) {
      throw commandError("Wall endpoints must be different.", "invalid-wall", commandIndex);
    }
    const thickness = finiteDimension(item.thickness, 1, "thickness", commandIndex);
    const id = runtime.createId();
    const clientKey = registerArchitectureClientKey(runtime, item.clientKey, id, commandIndex);
    const paint = normalizeArchitecturePaint(
      item,
      commandIndex,
      item.materialId,
      runtime.state.board.settings.architecture,
    );
    return {
      id,
      type: "wall",
      x: (start.x + end.x) / 2 - length / 2,
      y: (start.y + end.y) / 2 - thickness / 2,
      w: length,
      h: thickness,
      rotation: Math.atan2(end.y - start.y, end.x - start.x),
      ...paint,
      fillColor: paint.fillColor ?? paint.color,
      ...normalizeArchitecturePlacementMetadata(item, commandIndex),
      semantic: normalizeArchitectureSemantic(
        item.semantic,
        "architecture-wall",
        clientKey,
        commandIndex,
      ),
    };
  });
  addArchitectureObjects(runtime, objects);
}

function createArchitectureWallPaths(runtime, command, commandIndex) {
  const items = requireArchitectureItems(command.wallPaths, "wallPaths", 100, commandIndex);
  const created = [];
  const pathOutputs = [];

  items.forEach((item, itemIndex) => {
    assertArchitectureItemFields(
      item,
      [
        "points", "thickness", "closed", "join", "cap", "openings", "materialId",
        ...architectureCommonItemFields(),
      ],
      `wallPaths[${itemIndex}]`,
      commandIndex,
    );
    const points = requireArchitecturePoints(
      item.points,
      `wallPaths[${itemIndex}].points`,
      2,
      256,
      commandIndex,
    );
    const openings = validateWallPathOpenings(
      item.openings,
      `wallPaths[${itemIndex}].openings`,
      commandIndex,
    );
    let geometry;
    try {
      geometry = buildWallPathGeometry({
        points,
        thickness: finiteDimension(item.thickness, 1, "thickness", commandIndex),
        closed: Boolean(item.closed),
        join: item.join,
        cap: item.cap,
        openings,
      });
    } catch (error) {
      throw commandError(error.message, "invalid-wall-path", commandIndex);
    }
    if (geometry.issues.length) {
      throw commandError(
        `Wall path has invalid openings: ${geometry.issues[0].code}.`,
        "invalid-wall-opening",
        commandIndex,
      );
    }

    const pathIdentifier = String(item.clientKey || runtime.createId());
    const paint = normalizeArchitecturePaint(
      item,
      commandIndex,
      item.materialId,
      runtime.state.board.settings.architecture,
    );
    const placement = normalizeArchitecturePlacementMetadata(item, commandIndex);
    const baseSemantic = normalizeArchitectureSemantic(
      {
        ...(item.semantic ?? {}),
        wallPathId: pathIdentifier,
      },
      "architecture-wall-path",
      "",
      commandIndex,
    );
    const pathObjects = [];

    geometry.wallRuns.forEach((run, runIndex) => {
      const id = runtime.createId();
      const wall = createWallObjectFromEndpoints({
        id,
        start: run.start,
        end: run.end,
        thickness: run.thickness,
        paint,
        placement,
        semantic: {
          ...baseSemantic,
          role: "architecture-wall-face",
          wallPathId: pathIdentifier,
          segmentIndex: run.segmentIndex,
          tags: mergeSemanticTags(baseSemantic.tags, ["wall-path", "wall-run"]),
        },
      });
      pathObjects.push(wall);
      if (runIndex === 0) {
        registerArchitectureClientKey(runtime, item.clientKey, id, commandIndex);
      }
    });

    geometry.joints.forEach((joint, jointIndex) => {
      const id = runtime.createId();
      pathObjects.push(createArchitectureAreaObject({
        id,
        item: {
          ...item,
          materialId: item.materialId ?? "plaster",
          style: {
            ...(item.style ?? {}),
            fillColor: paint.fillColor ?? paint.color,
            color: paint.color,
          },
        },
        vertices: joint.points,
        clientKey: "",
        commandIndex,
        role: "architecture-wall-joint",
        architectureSettings: runtime.state.board.settings.architecture,
        semanticOverride: {
          ...baseSemantic,
          role: "architecture-wall-joint",
          wallPathId: pathIdentifier,
          segmentIndex: joint.segmentIndex,
          tags: mergeSemanticTags(baseSemantic.tags, ["wall-path", "wall-joint"]),
          clientRef: `${pathIdentifier}:joint:${jointIndex}`,
        },
      }));
    });

    geometry.openings.forEach((opening) => {
      if (!OPENING_SYMBOL_IDS.has(opening.kind)) {
        throw commandError(
          `Unknown architectural opening: ${opening.kind}.`,
          "invalid-symbol",
          commandIndex,
        );
      }
      const id = runtime.createId();
      const openingClientKey = registerArchitectureClientKey(
        runtime,
        opening.clientKey,
        id,
        commandIndex,
      );
      const openingSemantic = normalizeArchitectureSemantic(
        {
          ...baseSemantic,
          ...(opening.semantic ?? {}),
          role: "architecture-opening-cut",
          wallPathId: pathIdentifier,
          segmentIndex: opening.segmentIndex,
          openingIndex: opening.openingIndex,
          tags: mergeSemanticTags(baseSemantic.tags, ["wall-path", "opening-cut"]),
        },
        "architecture-opening-cut",
        openingClientKey,
        commandIndex,
        opening.kind,
      );
      pathObjects.push({
        id,
        type: "symbol",
        symbolId: opening.kind,
        x: opening.x,
        y: opening.y,
        w: opening.w,
        h: opening.h,
        rotation: opening.rotation,
        fit: "contain",
        ...(opening.flipX ? { flipX: true } : {}),
        ...(opening.flipY ? { flipY: true } : {}),
        color: paint.color,
        strokeWidth: Math.max(0.6, Math.min(2, paint.strokeWidth)),
        dashPattern: "solid",
        fillColor: "#fbf8ef",
        accentColor: "#708e98",
        fillOpacity: 1,
        opacity: 1,
        fillPattern: "solid",
        layerId: "openings",
        zIndex: placement.zIndex + 10,
        semantic: openingSemantic,
      });
    });

    created.push(...pathObjects);
    pathOutputs.push({
      clientKey: item.clientKey ?? null,
      wallPathId: pathIdentifier,
      createdObjectCount: pathObjects.length,
      runCount: geometry.wallRuns.length,
      jointCount: geometry.joints.length,
      openingCount: geometry.openings.length,
    });
  });

  addArchitectureObjects(runtime, created);
  runtime.outputs.push({ type: "architecture.wallPaths.create", wallPaths: pathOutputs });
}

function createWallObjectFromEndpoints({
  id,
  start,
  end,
  thickness,
  paint,
  placement,
  semantic,
}) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  return {
    id,
    type: "wall",
    x: (start.x + end.x) / 2 - length / 2,
    y: (start.y + end.y) / 2 - thickness / 2,
    w: length,
    h: thickness,
    rotation: Math.atan2(end.y - start.y, end.x - start.x),
    ...paint,
    fillColor: paint.fillColor ?? paint.color,
    ...placement,
    semantic,
  };
}

function createArchitectureOpenings(runtime, command, commandIndex) {
  const items = requireArchitectureItems(command.openings, "openings", 200, commandIndex);
  placeArchitectureSymbolItems(runtime, items, commandIndex, {
    field: "openings",
    role: "architecture-opening",
    allowedSymbols: OPENING_SYMBOL_IDS,
    allowedFields: [
      "kind", "x", "y", "w", "h", "rotation", "fit",
      ...architectureCommonItemFields(),
    ],
  });
}

function placeArchitectureSymbols(runtime, command, commandIndex) {
  const items = requireArchitectureItems(command.symbols, "symbols", 250, commandIndex);
  placeArchitectureSymbolItems(runtime, items, commandIndex, {
    field: "symbols",
    role: "architecture-symbol",
    allowedSymbols: ARCHITECTURE_SYMBOL_IDS,
    allowedFields: [
      "symbolId", "x", "y", "w", "h", "rotation", "fit",
      ...architectureCommonItemFields(),
    ],
  });
}

function placeArchitectureSymbolItems(runtime, items, commandIndex, options) {
  const objects = items.map((item, itemIndex) => {
    assertArchitectureItemFields(
      item,
      options.allowedFields,
      `${options.field}[${itemIndex}]`,
      commandIndex,
    );
    const symbolId = String(item.symbolId ?? item.kind ?? "");
    if (!options.allowedSymbols.has(symbolId) || !getArchitectureSymbol(symbolId)) {
      throw commandError(`Unknown architectural symbol: ${symbolId || "(missing)"}.`, "invalid-symbol", commandIndex);
    }
    const id = runtime.createId();
    const clientKey = registerArchitectureClientKey(runtime, item.clientKey, id, commandIndex);
    return {
      id,
      type: "symbol",
      symbolId,
      x: finiteCoordinate(item.x, 0, "x", commandIndex),
      y: finiteCoordinate(item.y, 0, "y", commandIndex),
      w: finiteDimension(item.w, 100, "w", commandIndex),
      h: finiteDimension(item.h, 100, "h", commandIndex),
      rotation: finiteNumber(item.rotation, 0),
      fit: item.fit === "stretch" ? "stretch" : "contain",
      ...normalizeArchitecturePaint(
        item,
        commandIndex,
        null,
        runtime.state.board.settings.architecture,
      ),
      ...normalizeArchitecturePlacementMetadata(item, commandIndex),
      semantic: normalizeArchitectureSemantic(
        item.semantic,
        options.role,
        clientKey,
        commandIndex,
        symbolId,
      ),
    };
  });
  addArchitectureObjects(runtime, objects);
}

function createArchitectureLabels(runtime, command, commandIndex) {
  const items = requireArchitectureItems(command.labels, "labels", 250, commandIndex);
  const objects = items.map((item, itemIndex) => {
    assertArchitectureItemFields(
      item,
      [
        "text", "x", "y", "w", "h", "rotation", "fontSize", "fontWeight",
        "fontFamily", "textStyle",
        "textAlign", "verticalAlign", "lineHeight", "padding",
        ...architectureCommonItemFields(),
      ],
      `labels[${itemIndex}]`,
      commandIndex,
    );
    const typographyPreset = item.textStyle
      ? resolveArchitectureTypography(
        item.textStyle,
        runtime.state.board.settings.architecture,
      )
      : null;
    const id = runtime.createId();
    const clientKey = registerArchitectureClientKey(runtime, item.clientKey, id, commandIndex);
    return {
      id,
      type: "textbox",
      x: finiteCoordinate(item.x, 0, "x", commandIndex),
      y: finiteCoordinate(item.y, 0, "y", commandIndex),
      w: finiteDimension(item.w, 240, "w", commandIndex),
      h: finiteDimension(item.h, 80, "h", commandIndex),
      rotation: finiteNumber(item.rotation, 0),
      text: normalizeText(item.text, commandIndex),
      colorRanges: [],
      fontSize: clampNumber(item.fontSize, 6, 96, typographyPreset?.fontSize ?? 16),
      fontWeight: clampNumber(
        item.fontWeight,
        300,
        800,
        typographyPreset?.fontWeight ?? 400,
      ),
      fontFamily: FONT_FAMILIES.has(item.fontFamily)
        ? item.fontFamily
        : typographyPreset?.fontFamily ?? "sans",
      scaleMode: "world",
      textAlign: ["left", "center", "right"].includes(item.textAlign)
        ? item.textAlign
        : "left",
      verticalAlign: ["top", "middle", "bottom"].includes(item.verticalAlign)
        ? item.verticalAlign
        : "top",
      lineHeight: clampNumber(
        item.lineHeight,
        0.8,
        3,
        typographyPreset?.lineHeight ?? 1.2,
      ),
      padding: clampNumber(item.padding, 0, 120, 6),
      ...normalizeArchitecturePaint(
        item,
        commandIndex,
        null,
        runtime.state.board.settings.architecture,
      ),
      ...normalizeArchitecturePlacementMetadata(item, commandIndex, "labels"),
      semantic: normalizeArchitectureSemantic(
        item.semantic,
        "architecture-label",
        clientKey,
        commandIndex,
      ),
    };
  });
  addArchitectureObjects(runtime, objects);
}

function createArchitectureDimensions(runtime, command, commandIndex) {
  const items = requireArchitectureItems(command.dimensions, "dimensions", 250, commandIndex);
  const objects = items.map((item, itemIndex) => {
    assertArchitectureItemFields(
      item,
      ["start", "end", "offset", "label", "fontSize", ...architectureCommonItemFields()],
      `dimensions[${itemIndex}]`,
      commandIndex,
    );
    const start = requireArchitecturePoint(item.start, `dimensions[${itemIndex}].start`, commandIndex);
    const end = requireArchitecturePoint(item.end, `dimensions[${itemIndex}].end`, commandIndex);
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1) {
      throw commandError("Dimension endpoints must be different.", "invalid-dimension", commandIndex);
    }
    const id = runtime.createId();
    const clientKey = registerArchitectureClientKey(runtime, item.clientKey, id, commandIndex);
    return {
      id,
      type: "dimension",
      x: start.x,
      y: start.y,
      endX: end.x,
      endY: end.y,
      offset: finiteCoordinate(item.offset, 24, "offset", commandIndex),
      label: normalizeOptionalText(item.label, commandIndex),
      fontSize: clampNumber(item.fontSize, 6, 96, 12),
      ...normalizeArchitecturePaint(
        item,
        commandIndex,
        null,
        runtime.state.board.settings.architecture,
      ),
      ...normalizeArchitecturePlacementMetadata(item, commandIndex, "dimensions"),
      semantic: normalizeArchitectureSemantic(
        item.semantic,
        "architecture-dimension",
        clientKey,
        commandIndex,
      ),
    };
  });
  addArchitectureObjects(runtime, objects);
}

function applyArchitectureMaterial(runtime, command, commandIndex) {
  const materialId = String(command.materialId ?? "");
  if (!ARCHITECTURE_MATERIAL_IDS.has(materialId)) {
    throw commandError(`Unknown architectural material: ${materialId || "(missing)"}.`, "invalid-material", commandIndex);
  }
  const targets = expandRigidGroupTargets(
    runtime.state.board.objects,
    resolveTargets(runtime, command.targets ?? command.target, commandIndex),
  );
  targets.forEach((object) => {
    if (object.locked) {
      throw commandError(`Object ${object.id} is locked.`, "object-locked", commandIndex);
    }
    Object.assign(object, resolveMaterialStyle(materialId, {
      fillOpacity: command.fillOpacity,
    }));
    runtime.updatedIds.add(object.id);
  });
}

function setArchitectureStyle(runtime, command, commandIndex) {
  const presetId = String(command.preset ?? "");
  if (!ARCHITECTURE_STYLE_PRESET_IDS.has(presetId)) {
    throw commandError(
      `Unknown architecture style preset: ${presetId || "(missing)"}.`,
      "invalid-architecture-style-preset",
      commandIndex,
    );
  }
  const preset = getArchitectureStylePreset(presetId);
  validateArchitectureStyleSettings(command, preset, commandIndex);
  const current = runtime.state.board.settings.architecture ?? {};
  runtime.state.board.settings.architecture = normalizeArchitectureSettings({
    ...current,
    stylePreset: presetId,
    ...(command.lineWeights ? { lineWeights: command.lineWeights } : {}),
    ...(command.typography ? { typography: command.typography } : {}),
    ...(command.palette ? { palette: command.palette } : {}),
  });
}

function setArchitectureLayers(runtime, command, commandIndex) {
  const layers = requireArchitectureItems(command.layers, "layers", 64, commandIndex);
  const seen = new Set();
  layers.forEach((item, itemIndex) => {
    assertArchitectureItemFields(
      item,
      ["id", "name", "order", "visible"],
      `layers[${itemIndex}]`,
      commandIndex,
    );
    const id = String(item.id ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id) || seen.has(id)) {
      throw commandError("Architecture layer IDs must be unique stable identifiers.", "invalid-layer", commandIndex);
    }
    if (!String(item.name ?? "").trim()) {
      throw commandError("Architecture layers need names.", "invalid-layer", commandIndex);
    }
    seen.add(id);
  });
  runtime.state.board.settings.architecture = normalizeArchitectureSettings({
    ...runtime.state.board.settings.architecture,
    layers,
  });
}

function configureArchitectureReferences(runtime, command, commandIndex) {
  if (command.consent !== true) {
    throw commandError(
      "Reference-image configuration requires consent: true.",
      "reference-consent-required",
      commandIndex,
    );
  }
  const targets = resolveTargets(
    runtime,
    command.targets ?? command.target,
    commandIndex,
  );
  if (!targets.every((object) => object.type === "image")) {
    throw commandError(
      "Reference-image targets must all be existing board images.",
      "invalid-reference-target",
      commandIndex,
    );
  }
  const architecture = normalizeArchitectureSettings(
    runtime.state.board.settings.architecture,
  );
  if (!architecture.layers.some((layer) => layer.id === "reference")) {
    architecture.layers.push({
      id: "reference",
      name: "Reference",
      order: -100,
      visible: true,
    });
    runtime.state.board.settings.architecture = normalizeArchitectureSettings(architecture);
  }
  targets.forEach((object) => {
    if (object.locked && object.referenceImage !== true) {
      throw commandError(`Object ${object.id} is locked.`, "object-locked", commandIndex);
    }
    object.referenceImage = true;
    object.referenceName = String(
      command.referenceName ?? object.referenceName ?? object.name ?? "Reference",
    ).trim().slice(0, 120) || "Reference";
    object.opacity = clampNumber(command.opacity, 0.05, 1, object.opacity ?? 0.35);
    object.locked = command.locked !== false;
    object.hiddenInExport = command.hiddenInExport !== false;
    object.layerId = "reference";
    object.zIndex = -10_000;
    object.semantic = normalizeSemantic({
      ...(object.semantic ?? {}),
      role: "architecture-reference-image",
      label: object.referenceName,
      referenceId: object.semantic?.referenceId || object.id,
      tags: mergeSemanticTags(object.semantic?.tags, ["architecture-reference"]),
      generatedBy: "ai-command",
    });
    runtime.updatedIds.add(object.id);
  });
}

function inspectArchitecture(runtime, command, commandIndex) {
  const targets = command.targets || command.target
    ? resolveTargets(runtime, command.targets ?? command.target, commandIndex, { allowEmpty: true })
    : runtime.state.board.objects.filter((object) => (
      ARCHITECTURE_OBJECT_TYPES.includes(object.type)
      || object.semantic?.role?.startsWith("architecture-")
    ));
  runtime.outputs.push({
    type: "architecture.inspect",
    ...getArchitectureGeometryReport(targets, {
      includeIntersections: command.includeIntersections,
      includeWithinGroups: command.includeWithinGroups,
      clearance: clampNumber(command.clearance, 0, 100_000, 0),
      includeConnectivity: command.includeConnectivity,
      endpointTolerance: clampNumber(command.endpointTolerance, 0.25, 1_000, 2),
      includeLabelCollisions: command.includeLabelCollisions,
      includeRoomAccess: command.includeRoomAccess,
      minimumClearance: clampNumber(command.minimumClearance, 0, 100_000, 0),
      aspectRatioTolerance: clampNumber(command.aspectRatioTolerance, 0.05, 5, 0.2),
    }),
    objects: targets.slice(0, 500).map(serializeArchitectureObject),
    omittedObjectCount: Math.max(0, targets.length - 500),
  });
}

function validateArchitecture(runtime, command, commandIndex) {
  const targets = command.targets || command.target
    ? resolveTargets(runtime, command.targets ?? command.target, commandIndex, { allowEmpty: true })
    : runtime.state.board.objects.filter((object) => (
      ARCHITECTURE_OBJECT_TYPES.includes(object.type)
      || object.type === "textbox"
      || object.semantic?.role?.startsWith("architecture-")
    ));
  const report = getArchitectureGeometryReport(targets, {
    includeIntersections: false,
    includeConnectivity: true,
    endpointTolerance: clampNumber(command.endpointTolerance, 0.25, 1_000, 2),
    includeLabelCollisions: true,
    includeRoomAccess: true,
    minimumClearance: clampNumber(command.minimumClearance, 0, 100_000, 0),
    aspectRatioTolerance: clampNumber(command.aspectRatioTolerance, 0.05, 5, 0.2),
  });
  runtime.outputs.push({
    type: "architecture.validate",
    objectCount: report.objectCount,
    bounds: report.bounds,
    quality: report.quality,
  });
}

function addArchitectureObjects(runtime, objects) {
  runtime.state.board.objects.push(...objects);
  runtime.state.selectedIds = objects.map((object) => object.id);
  runtime.createdIds.push(...runtime.state.selectedIds);
}

function normalizeArchitecturePaint(
  item,
  commandIndex,
  materialId = null,
  architectureSettings = null,
) {
  const styleValue = item.style === undefined ? {} : item.style;
  if (!isRecord(styleValue)) {
    throw commandError("Architecture style must be an object.", "invalid-architecture-style", commandIndex);
  }
  assertArchitectureItemFields(
    styleValue,
    [
      "color", "fillColor", "accentColor", "fillOpacity", "opacity",
      "fillPattern", "strokeWidth", "lineWeight", "dashPattern", "shadow",
    ],
    "style",
    commandIndex,
  );
  const resolvedMaterialId = materialId;
  if (resolvedMaterialId && !ARCHITECTURE_MATERIAL_IDS.has(resolvedMaterialId)) {
    throw commandError(`Unknown architectural material: ${resolvedMaterialId}.`, "invalid-material", commandIndex);
  }
  const materialStyle = resolvedMaterialId
    ? resolveMaterialStyle(resolvedMaterialId, styleValue)
    : {};
  const palette = normalizeArchitectureSettings(architectureSettings ?? {}).palette;
  const shadow = normalizeArchitectureShadow(styleValue.shadow, commandIndex);
  const fillPattern = styleValue.fillPattern ?? materialStyle.fillPattern ?? "solid";
  if (!ARCHITECTURE_FILL_PATTERNS.includes(fillPattern)) {
    throw commandError("Unsupported architecture fill pattern.", "invalid-fill-pattern", commandIndex);
  }
  return {
    color: styleValue.color !== undefined
      ? normalizeColor(styleValue.color, commandIndex)
      : materialStyle.color ?? palette.ink,
    strokeWidth: styleValue.strokeWidth !== undefined
      ? clampNumber(styleValue.strokeWidth, 0.25, 240, 2)
      : resolveArchitectureLineWeight(
        styleValue.lineWeight ?? "detail",
        architectureSettings,
      ),
    dashPattern: DASH_PATTERNS.has(styleValue.dashPattern) ? styleValue.dashPattern : "solid",
    locked: false,
    ...(styleValue.fillColor !== undefined
      ? { fillColor: normalizeColor(styleValue.fillColor, commandIndex) }
      : materialStyle.fillColor
        ? { fillColor: materialStyle.fillColor }
        : {}),
    ...(styleValue.accentColor !== undefined
      ? { accentColor: normalizeColor(styleValue.accentColor, commandIndex) }
      : {}),
    fillOpacity: clampNumber(
      styleValue.fillOpacity,
      0,
      1,
      materialStyle.fillOpacity ?? 1,
    ),
    opacity: clampNumber(styleValue.opacity, 0, 1, 1),
    fillPattern,
    ...(resolvedMaterialId ? { materialId: resolvedMaterialId } : {}),
    ...(shadow ? { shadow } : {}),
  };
}

function normalizeArchitectureShadow(value, commandIndex) {
  if (value === undefined) return null;
  if (!isRecord(value)) {
    throw commandError("Architecture shadow must be an object.", "invalid-shadow", commandIndex);
  }
  assertArchitectureItemFields(
    value,
    ["color", "opacity", "blur", "offsetX", "offsetY"],
    "shadow",
    commandIndex,
  );
  return {
    color: value.color === undefined ? "#000000" : normalizeColor(value.color, commandIndex),
    opacity: clampNumber(value.opacity, 0, 1, 0.18),
    blur: clampNumber(value.blur, 0, 100, 0),
    offsetX: clampNumber(value.offsetX, -500, 500, 0),
    offsetY: clampNumber(value.offsetY, -500, 500, 0),
  };
}

function normalizeArchitecturePlacementMetadata(item, commandIndex, fallbackLayer = "structure") {
  const layerId = String(item.layerId ?? fallbackLayer).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(layerId)) {
    throw commandError("layerId must be a stable identifier.", "invalid-layer", commandIndex);
  }
  return {
    layerId,
    zIndex: clampNumber(item.zIndex, -10_000, 10_000, 0),
  };
}

function normalizeArchitectureSemantic(value, role, clientKey, commandIndex, label = "") {
  if (value !== undefined) {
    if (!isRecord(value)) {
      throw commandError("Architecture semantic metadata must be an object.", "invalid-semantic", commandIndex);
    }
    assertArchitectureItemFields(
      value,
      [
        "label", "role", "tags", "generatedBy", "diagramId", "clientRef",
        "sourceId", "targetId", "roomId", "wallPathId", "referenceId",
        "levelId", "segmentIndex", "openingIndex",
      ],
      "semantic",
      commandIndex,
    );
  }
  return normalizeSemantic({
    ...(value ?? {}),
    label: value?.label ?? label,
    role: value?.role ?? role,
    generatedBy: value?.generatedBy ?? "ai-command",
    ...(clientKey ? { clientRef: clientKey } : {}),
  }, label);
}

function registerArchitectureClientKey(runtime, value, identifier, commandIndex) {
  const clientKey = normalizeClientKey(value, runtime, commandIndex);
  if (clientKey) runtime.clientKeyMap.set(clientKey, identifier);
  return clientKey;
}

function requireArchitectureItems(value, field, maximum, commandIndex) {
  if (!Array.isArray(value) || !value.length || value.length > maximum) {
    throw commandError(
      `${field} must contain between 1 and ${maximum} items.`,
      "invalid-architecture-items",
      commandIndex,
    );
  }
  value.forEach((item) => {
    if (!isRecord(item)) {
      throw commandError(`${field} items must be objects.`, "invalid-architecture-item", commandIndex);
    }
  });
  return value;
}

function requireArchitecturePoints(value, field, minimum, maximum, commandIndex) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw commandError(
      `${field} must contain between ${minimum} and ${maximum} points.`,
      "invalid-architecture-points",
      commandIndex,
    );
  }
  return value.map((point, index) => (
    requireArchitecturePoint(point, `${field}[${index}]`, commandIndex)
  ));
}

function validateArchitecturePathCommands(value, field, commandIndex) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 256) {
    throw commandError(
      `${field} must contain between 2 and 256 commands.`,
      "invalid-architecture-path",
      commandIndex,
    );
  }
  const allowedByOperation = {
    M: ["op", "x", "y"],
    L: ["op", "x", "y"],
    Q: ["op", "x", "y", "cx", "cy", "steps"],
    C: ["op", "x", "y", "c1x", "c1y", "c2x", "c2y", "steps"],
    A: [
      "op", "cx", "cy", "rx", "ry", "startAngle", "endAngle",
      "clockwise", "steps",
    ],
    Z: ["op"],
  };
  value.forEach((item, itemIndex) => {
    if (!isRecord(item)) {
      throw commandError(
        `${field}[${itemIndex}] must be an object.`,
        "invalid-architecture-path",
        commandIndex,
      );
    }
    const operation = String(item.op ?? "").toUpperCase();
    if (!ARCHITECTURE_PATH_OPERATIONS.includes(operation)) {
      throw commandError(
        `Unsupported architecture path operation: ${operation || "(missing)"}.`,
        "invalid-architecture-path",
        commandIndex,
      );
    }
    assertArchitectureItemFields(
      item,
      allowedByOperation[operation],
      `${field}[${itemIndex}]`,
      commandIndex,
    );
  });
}

function validateWallPathOpenings(value, field, commandIndex) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) {
    throw commandError(
      `${field} must contain at most 200 openings.`,
      "invalid-wall-opening",
      commandIndex,
    );
  }
  return value.map((item, itemIndex) => {
    if (!isRecord(item)) {
      throw commandError(
        `${field}[${itemIndex}] must be an object.`,
        "invalid-wall-opening",
        commandIndex,
      );
    }
    assertArchitectureItemFields(
      item,
      [
        "segmentIndex", "offset", "width", "kind", "hinge", "side",
        "sillDepth", "clientKey", "semantic",
      ],
      `${field}[${itemIndex}]`,
      commandIndex,
    );
    const kind = String(item.kind ?? "");
    if (!OPENING_SYMBOL_IDS.has(kind)) {
      throw commandError(
        `Unknown architectural opening: ${kind || "(missing)"}.`,
        "invalid-symbol",
        commandIndex,
      );
    }
    const segmentIndex = Number(item.segmentIndex);
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
      throw commandError(
        `${field}[${itemIndex}].segmentIndex must be a non-negative integer.`,
        "invalid-wall-opening",
        commandIndex,
      );
    }
    if (item.semantic !== undefined) {
      normalizeArchitectureSemantic(
        item.semantic,
        "architecture-opening-cut",
        "",
        commandIndex,
        kind,
      );
    }
    return {
      segmentIndex,
      offset: finiteCoordinate(item.offset, 0, "offset", commandIndex),
      width: finiteDimension(item.width, 1, "width", commandIndex),
      kind,
      hinge: item.hinge === "right" ? "right" : "left",
      side: item.side === "outside" ? "outside" : "inside",
      sillDepth: item.sillDepth === undefined
        ? undefined
        : finiteDimension(item.sillDepth, 1, "sillDepth", commandIndex),
      clientKey: item.clientKey,
      semantic: item.semantic,
    };
  });
}

function validateArchitectureStyleSettings(command, preset, commandIndex) {
  if (command.lineWeights !== undefined) {
    if (!isRecord(command.lineWeights)) {
      throw commandError("lineWeights must be an object.", "invalid-architecture-style", commandIndex);
    }
    assertArchitectureItemFields(
      command.lineWeights,
      [...ARCHITECTURE_LINE_WEIGHT_ROLES],
      "lineWeights",
      commandIndex,
    );
    Object.entries(command.lineWeights).forEach(([role, width]) => {
      if (!Number.isFinite(Number(width)) || Number(width) < 0.25 || Number(width) > 240) {
        throw commandError(
          `lineWeights.${role} must be between 0.25 and 240.`,
          "invalid-architecture-style",
          commandIndex,
        );
      }
    });
  }
  if (command.typography !== undefined) {
    if (!isRecord(command.typography)) {
      throw commandError("typography must be an object.", "invalid-architecture-style", commandIndex);
    }
    assertArchitectureItemFields(
      command.typography,
      [...ARCHITECTURE_TEXT_STYLES],
      "typography",
      commandIndex,
    );
    Object.entries(command.typography).forEach(([role, typographyValue]) => {
      if (!isRecord(typographyValue)) {
        throw commandError(
          `typography.${role} must be an object.`,
          "invalid-architecture-style",
          commandIndex,
        );
      }
      assertArchitectureItemFields(
        typographyValue,
        ["fontFamily", "fontSize", "fontWeight", "lineHeight"],
        `typography.${role}`,
        commandIndex,
      );
      if (
        typographyValue.fontFamily !== undefined
        && !FONT_FAMILIES.has(typographyValue.fontFamily)
      ) {
        throw commandError(
          `typography.${role}.fontFamily is unsupported.`,
          "invalid-architecture-style",
          commandIndex,
        );
      }
      [
        ["fontSize", 6, 96],
        ["fontWeight", 300, 800],
        ["lineHeight", 0.8, 3],
      ].forEach(([field, minimum, maximum]) => {
        const fieldValue = typographyValue[field];
        if (
          fieldValue !== undefined
          && (
            !Number.isFinite(Number(fieldValue))
            || Number(fieldValue) < minimum
            || Number(fieldValue) > maximum
          )
        ) {
          throw commandError(
            `typography.${role}.${field} must be between ${minimum} and ${maximum}.`,
            "invalid-architecture-style",
            commandIndex,
          );
        }
      });
    });
  }
  if (command.palette !== undefined) {
    if (!isRecord(command.palette)) {
      throw commandError("palette must be an object.", "invalid-architecture-style", commandIndex);
    }
    assertArchitectureItemFields(
      command.palette,
      Object.keys(preset.palette),
      "palette",
      commandIndex,
    );
    Object.values(command.palette).forEach((color) => normalizeColor(color, commandIndex));
  }
}

function requireArchitecturePoint(value, field, commandIndex) {
  if (!isRecord(value)) {
    throw commandError(`${field} must be a point.`, "invalid-point", commandIndex);
  }
  assertArchitectureItemFields(value, ["x", "y"], field, commandIndex);
  if (!Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) {
    throw commandError(`${field} needs finite x and y values.`, "invalid-point", commandIndex);
  }
  return {
    x: finiteCoordinate(value.x, 0, `${field}.x`, commandIndex),
    y: finiteCoordinate(value.y, 0, `${field}.y`, commandIndex),
  };
}

function assertArchitectureItemFields(value, allowedFields, field, commandIndex) {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw commandError(
      `Unsupported ${field} field: ${unknown}.`,
      "unknown-command-field",
      commandIndex,
    );
  }
}

function architectureCommonItemFields() {
  return ["clientKey", "layerId", "zIndex", "semantic", "style"];
}

function mergeSemanticTags(currentTags, additions) {
  return normalizeTags([
    ...(Array.isArray(currentTags) ? currentTags : []),
    ...(Array.isArray(additions) ? additions : []),
  ]);
}

function serializeArchitectureObject(object) {
  const summary = {
    id: object.id,
    type: object.type,
    bounds: roundBounds(getObjectBounds(object)),
    layerId: object.layerId ?? "structure",
    zIndex: roundNumber(object.zIndex ?? 0),
    materialId: object.materialId ?? null,
    semantic: sanitizeSemantic(object.semantic),
  };
  if (object.type === "symbol") summary.symbolId = object.symbolId;
  if (object.type === "symbol") summary.fit = object.fit ?? "contain";
  if (object.type === "wall") {
    const center = { x: object.x + object.w / 2, y: object.y + object.h / 2 };
    const halfLength = object.w / 2;
    summary.start = {
      x: roundNumber(center.x - Math.cos(object.rotation ?? 0) * halfLength),
      y: roundNumber(center.y - Math.sin(object.rotation ?? 0) * halfLength),
    };
    summary.end = {
      x: roundNumber(center.x + Math.cos(object.rotation ?? 0) * halfLength),
      y: roundNumber(center.y + Math.sin(object.rotation ?? 0) * halfLength),
    };
    summary.thickness = roundNumber(object.h);
  }
  if (object.type === "dimension") {
    summary.start = { x: roundNumber(object.x), y: roundNumber(object.y) };
    summary.end = { x: roundNumber(object.endX), y: roundNumber(object.endY) };
    summary.offset = roundNumber(object.offset);
    summary.label = object.label;
  }
  return summary;
}

function normalizeDiagramGraph(command, diagramType, commandIndex) {
  if (diagramType === "mind-map" && command.topic) {
    return treeToGraph({
      label: command.topic,
      key: "topic",
      children: command.branches ?? [],
    }, commandIndex);
  }
  if (["hierarchy", "organization-chart"].includes(diagramType) && command.root) {
    return treeToGraph(command.root, commandIndex);
  }
  if (diagramType === "timeline") {
    const events = Array.isArray(command.events) ? command.events : [];
    const nodes = events.map((event, index) => ({
      key: String(event.key ?? `event-${index + 1}`),
      label: normalizeText(event.label ?? event.title, commandIndex),
      role: "timeline-event",
      tags: event.tags,
    }));
    return {
      nodes,
      edges: nodes.slice(1).map((node, index) => ({
        from: nodes[index].key,
        to: node.key,
        arrow: true,
      })),
    };
  }
  if (diagramType === "sequence") {
    const steps = Array.isArray(command.steps) ? command.steps : [];
    const nodes = steps.map((step, index) => ({
      key: String(step.key ?? `step-${index + 1}`),
      label: normalizeText(step.label ?? step, commandIndex),
      role: "sequence-step",
    }));
    return {
      nodes,
      edges: nodes.slice(1).map((node, index) => ({
        from: nodes[index].key,
        to: node.key,
      })),
    };
  }
  if (diagramType === "comparison-table") {
    const columns = Array.isArray(command.columns) ? command.columns : [];
    const nodes = [];
    columns.forEach((column, columnIndex) => {
      const headerKey = `column-${columnIndex + 1}`;
      nodes.push({
        key: headerKey,
        label: normalizeText(column.title ?? `Column ${columnIndex + 1}`, commandIndex),
        role: "comparison-header",
        column: columnIndex,
        row: 0,
      });
      (Array.isArray(column.items) ? column.items : []).forEach((item, rowIndex) => {
        nodes.push({
          key: `${headerKey}-row-${rowIndex + 1}`,
          label: normalizeText(item, commandIndex),
          role: "comparison-item",
          column: columnIndex,
          row: rowIndex + 1,
        });
      });
    });
    return { nodes, edges: [] };
  }

  const rawNodes = Array.isArray(command.nodes) ? command.nodes : [];
  const seenKeys = new Set();
  const nodes = rawNodes.map((nodeValue, index) => {
    const node = typeof nodeValue === "string" ? { label: nodeValue } : nodeValue;
    if (!isRecord(node)) {
      throw commandError("Every diagram node must be text or an object.", "invalid-diagram-node", commandIndex);
    }
    const key = String(node.key ?? node.clientKey ?? `node-${index + 1}`).trim();
    if (!key || seenKeys.has(key)) {
      throw commandError(`Duplicate or empty diagram node key: ${key}.`, "duplicate-diagram-key", commandIndex);
    }
    seenKeys.add(key);
    return {
      key,
      clientKey: node.clientKey,
      label: normalizeText(node.label ?? node.text ?? key, commandIndex),
      role: normalizeOptionalText(node.role, commandIndex) || "diagram-node",
      tags: normalizeTags(node.tags),
      objectType: node.objectType === "ellipse" ? "ellipse" : "rectangle",
      row: Number.isInteger(node.row) ? node.row : null,
      column: Number.isInteger(node.column) ? node.column : null,
    };
  });
  const edges = (Array.isArray(command.edges) ? command.edges : [])
    .map((edge) => {
      if (!isRecord(edge)) {
        throw commandError("Every diagram edge must be an object.", "invalid-diagram-edge", commandIndex);
      }
      const from = String(edge.from ?? "");
      const to = String(edge.to ?? "");
      if (!seenKeys.has(from) || !seenKeys.has(to)) {
        throw commandError(`Unknown diagram edge: ${from} → ${to}.`, "unknown-diagram-node", commandIndex);
      }
      return {
        from,
        to,
        label: normalizeOptionalText(edge.label, commandIndex),
        arrow: edge.arrow !== false,
      };
    });
  return { nodes, edges };
}

function treeToGraph(rootValue, commandIndex) {
  const nodes = [];
  const edges = [];
  let generatedKey = 0;

  function visit(value, parentKey = null, depth = 0) {
    if (depth > MAX_NESTING_DEPTH) {
      throw commandError("The diagram tree is nested too deeply.", "diagram-depth-limit", commandIndex);
    }
    const node = typeof value === "string" ? { label: value } : value;
    if (!isRecord(node)) {
      throw commandError("Tree nodes must be text or objects.", "invalid-diagram-node", commandIndex);
    }
    generatedKey += 1;
    const key = String(node.key ?? `tree-${generatedKey}`);
    nodes.push({
      key,
      clientKey: node.clientKey,
      label: normalizeText(node.label ?? node.title ?? key, commandIndex),
      role: parentKey ? "branch" : "root",
      tags: normalizeTags(node.tags),
      depth,
    });
    if (parentKey) edges.push({ from: parentKey, to: key, arrow: true });
    (Array.isArray(node.children) ? node.children : []).forEach((child) => visit(child, key, depth + 1));
    return key;
  }

  visit(rootValue);
  return { nodes, edges };
}

function layoutDiagram(graph, diagramType, command, placement) {
  const nodes = graph.nodes.map((node) => {
    const size = estimateNodeSize(node.label);
    return { ...node, width: size.width, height: size.height, x: 0, y: 0 };
  });

  if (diagramType === "mind-map") {
    layoutMindMap(nodes, graph.edges, placement);
  } else if (["hierarchy", "organization-chart"].includes(diagramType)) {
    layoutHierarchy(nodes, graph.edges, placement);
  } else if (diagramType === "comparison-table") {
    layoutComparison(nodes, placement);
  } else if (diagramType === "grid") {
    layoutGrid(nodes, placement, command.columns);
  } else {
    const direction = command.direction === "vertical" ? "vertical" : "horizontal";
    layoutSequence(nodes, placement, direction);
  }
  return { nodes, edges: graph.edges };
}

function layoutSequence(nodes, placement, direction) {
  const totalWidth = direction === "horizontal"
    ? nodes.reduce((total, node) => total + node.width, 0)
      + Math.max(0, nodes.length - 1) * DEFAULT_HORIZONTAL_GAP
    : Math.max(...nodes.map((node) => node.width), DEFAULT_NODE_WIDTH);
  const totalHeight = direction === "vertical"
    ? nodes.reduce((total, node) => total + node.height, 0)
      + Math.max(0, nodes.length - 1) * DEFAULT_VERTICAL_GAP
    : Math.max(...nodes.map((node) => node.height), DEFAULT_NODE_HEIGHT);
  let cursorX = placement.x - totalWidth / 2;
  let cursorY = placement.y - totalHeight / 2;
  nodes.forEach((node) => {
    node.x = direction === "horizontal" ? cursorX : placement.x - node.width / 2;
    node.y = direction === "vertical" ? cursorY : placement.y - node.height / 2;
    cursorX += direction === "horizontal" ? node.width + DEFAULT_HORIZONTAL_GAP : 0;
    cursorY += direction === "vertical" ? node.height + DEFAULT_VERTICAL_GAP : 0;
  });
}

function layoutHierarchy(nodes, edges, placement) {
  const depths = calculateGraphDepths(nodes, edges);
  const levels = groupBy(nodes, (node) => depths.get(node.key) ?? 0);
  const levelKeys = [...levels.keys()].sort((a, b) => a - b);
  levelKeys.forEach((depth) => {
    const level = levels.get(depth);
    const levelWidth = level.reduce((total, node) => total + node.width, 0)
      + Math.max(0, level.length - 1) * DEFAULT_HORIZONTAL_GAP;
    let x = placement.x - levelWidth / 2;
    level.forEach((node) => {
      node.x = x;
      node.y = placement.y - (levelKeys.length * 150) / 2 + depth * 150;
      x += node.width + DEFAULT_HORIZONTAL_GAP;
    });
  });
}

function layoutMindMap(nodes, edges, placement) {
  const root = nodes[0];
  root.x = placement.x - root.width / 2;
  root.y = placement.y - root.height / 2;
  const adjacency = new Map(nodes.map((node) => [node.key, []]));
  edges.forEach((edge) => adjacency.get(edge.from)?.push(edge.to));
  const queue = [{ key: root.key, depth: 0, angle: 0 }];
  const visited = new Set([root.key]);
  while (queue.length) {
    const current = queue.shift();
    const children = adjacency.get(current.key) ?? [];
    children.forEach((childKey, index) => {
      if (visited.has(childKey)) return;
      visited.add(childKey);
      const child = nodes.find((node) => node.key === childKey);
      const angle = current.depth === 0
        ? (Math.PI * 2 * index) / Math.max(1, children.length)
        : current.angle + (index - (children.length - 1) / 2) * 0.55;
      const radius = 270 + current.depth * 210;
      child.x = placement.x + Math.cos(angle) * radius - child.width / 2;
      child.y = placement.y + Math.sin(angle) * radius - child.height / 2;
      queue.push({ key: childKey, depth: current.depth + 1, angle });
    });
  }
}

function layoutComparison(nodes, placement) {
  const maximumColumn = Math.max(...nodes.map((node) => node.column ?? 0), 0);
  const maximumRow = Math.max(...nodes.map((node) => node.row ?? 0), 0);
  const columnWidth = 260;
  const rowHeight = 128;
  const totalWidth = (maximumColumn + 1) * columnWidth;
  const totalHeight = (maximumRow + 1) * rowHeight;
  nodes.forEach((node) => {
    node.width = 230;
    node.height = 96;
    node.x = placement.x - totalWidth / 2 + (node.column ?? 0) * columnWidth + 15;
    node.y = placement.y - totalHeight / 2 + (node.row ?? 0) * rowHeight + 16;
  });
}

function layoutGrid(nodes, placement, requestedColumns) {
  const columns = clampInteger(
    requestedColumns,
    1,
    Math.max(1, nodes.length),
    Math.ceil(Math.sqrt(nodes.length)),
  );
  const rows = Math.ceil(nodes.length / columns);
  const cellWidth = 250;
  const cellHeight = 140;
  nodes.forEach((node, index) => {
    node.x = placement.x - (columns * cellWidth) / 2 + (index % columns) * cellWidth + 20;
    node.y = placement.y - (rows * cellHeight) / 2 + Math.floor(index / columns) * cellHeight + 20;
  });
}

function applyDeterministicLayout(units, layoutType, command) {
  const bounds = getCombinedUnitBounds(units);
  const gap = clampNumber(command.gap, 0, 1_000, 48);
  const ordered = [...units].sort((first, second) => first.id.localeCompare(second.id));

  if (layoutType === "grid") {
    const columns = clampInteger(command.columns, 1, ordered.length, Math.ceil(Math.sqrt(ordered.length)));
    const cellWidth = Math.max(...ordered.map((unit) => unit.bounds.width), 1) + gap;
    const cellHeight = Math.max(...ordered.map((unit) => unit.bounds.height), 1) + gap;
    ordered.forEach((unit, index) => {
      translateLayoutUnit(
        unit,
        bounds.x + (index % columns) * cellWidth - unit.bounds.x,
        bounds.y + Math.floor(index / columns) * cellHeight - unit.bounds.y,
      );
    });
    return;
  }

  if (layoutType.startsWith("align-")) {
    ordered.forEach((unit) => {
      const unitBounds = unit.bounds;
      const deltas = {
        "align-left": { x: bounds.x - unitBounds.x, y: 0 },
        "align-right": { x: bounds.x + bounds.width - unitBounds.width - unitBounds.x, y: 0 },
        "align-top": { x: 0, y: bounds.y - unitBounds.y },
        "align-bottom": { x: 0, y: bounds.y + bounds.height - unitBounds.height - unitBounds.y },
      }[layoutType];
      translateLayoutUnit(unit, deltas.x, deltas.y);
    });
    return;
  }

  const vertical = layoutType === "vertical" || layoutType === "distribute-vertical";
  let cursor = vertical ? bounds.y : bounds.x;
  ordered.forEach((unit) => {
    const unitBounds = unit.bounds;
    translateLayoutUnit(
      unit,
      vertical ? bounds.x - unitBounds.x : cursor - unitBounds.x,
      vertical ? cursor - unitBounds.y : bounds.y - unitBounds.y,
    );
    cursor += (vertical ? unitBounds.height : unitBounds.width) + gap;
  });
}

function resolveTargets(runtime, targetValue, commandIndex, options = {}) {
  const target = isRecord(targetValue) ? targetValue : {};
  const allowedTargetFields = new Set([
    "ids",
    "clientKeys",
    "selection",
    "semanticRef",
    "diagramId",
    "wallPathId",
    "roomId",
    "levelId",
    "referenceId",
    "role",
    "tag",
  ]);
  const unknownTargetField = Object.keys(target).find((field) => !allowedTargetFields.has(field));
  if (unknownTargetField) {
    throw commandError(
      `Unsupported target field: ${unknownTargetField}.`,
      "unknown-command-field",
      commandIndex,
    );
  }
  const identifiers = new Set();
  (Array.isArray(target.ids) ? target.ids : []).forEach((id) => identifiers.add(String(id)));
  (Array.isArray(target.clientKeys) ? target.clientKeys : []).forEach((key) => {
    const identifier = runtime.clientKeyMap.get(String(key));
    if (!identifier) {
      throw commandError(`Unknown client key: ${key}.`, "unknown-client-key", commandIndex);
    }
    identifiers.add(identifier);
  });
  if (target.selection === true) {
    runtime.state.selectedIds.forEach((id) => identifiers.add(id));
  }
  if (target.semanticRef) {
    runtime.state.board.objects
      .filter((object) => (
        object.semantic?.clientRef === target.semanticRef
        || object.semantic?.diagramId === target.semanticRef
        || object.semantic?.wallPathId === target.semanticRef
        || object.semantic?.roomId === target.semanticRef
        || object.semantic?.levelId === target.semanticRef
        || object.semantic?.referenceId === target.semanticRef
      ))
      .forEach((object) => identifiers.add(object.id));
  }
  if (target.diagramId) {
    runtime.state.board.objects
      .filter((object) => object.semantic?.diagramId === target.diagramId)
      .forEach((object) => identifiers.add(object.id));
  }
  ["wallPathId", "roomId", "levelId", "referenceId"].forEach((field) => {
    if (!target[field]) return;
    runtime.state.board.objects
      .filter((object) => object.semantic?.[field] === target[field])
      .forEach((object) => identifiers.add(object.id));
  });
  if (target.role) {
    runtime.state.board.objects
      .filter((object) => object.semantic?.role === target.role)
      .forEach((object) => identifiers.add(object.id));
  }
  if (target.tag) {
    runtime.state.board.objects
      .filter((object) => object.semantic?.tags?.includes(target.tag))
      .forEach((object) => identifiers.add(object.id));
  }
  const objects = runtime.state.board.objects.filter((object) => identifiers.has(object.id));
  if (!objects.length && !options.allowEmpty) {
    throw commandError("No board objects matched the target.", "target-not-found", commandIndex);
  }
  if (objects.length !== identifiers.size) {
    const found = new Set(objects.map((object) => object.id));
    const missing = [...identifiers].filter((id) => !found.has(id));
    throw commandError(`Unknown object ID: ${missing[0]}.`, "target-not-found", commandIndex);
  }
  return objects;
}

function resolveSingleReference(runtime, reference, commandIndex, field) {
  const normalized = typeof reference === "string"
    ? { ids: [reference] }
    : reference?.clientKey
      ? { clientKeys: [reference.clientKey] }
      : reference?.id
        ? { ids: [reference.id] }
        : reference;
  const targets = resolveTargets(runtime, normalized, commandIndex);
  if (targets.length !== 1) {
    throw commandError(`${field} must resolve to exactly one object.`, "ambiguous-target", commandIndex);
  }
  return targets[0];
}

function expandRigidGroupTargets(objects, targets) {
  const targetIds = new Set(targets.map((object) => object.id));
  const groupIds = new Set(targets.map((object) => object.groupId).filter(Boolean));
  return objects.filter((object) => (
    targetIds.has(object.id) || (object.groupId && groupIds.has(object.groupId))
  ));
}

function assertTargetsAreNotRigged(runtime, targets, commandIndex, operation) {
  const targetIds = new Set(targets.map((object) => object.id));
  const targetGroupIds = new Set(targets.map((object) => object.groupId).filter(Boolean));
  const riggedBody = (runtime.state.board.rig?.bodies ?? []).find((body) => (
    targetGroupIds.has(body.id)
    || (body.objectIds ?? []).some((identifier) => targetIds.has(identifier))
  ));
  if (riggedBody) {
    throw commandError(
      `Generic object ${operation} is unavailable for rigged characters.`,
      "rigged-operation-not-supported",
      commandIndex,
    );
  }
}

function createLayoutUnits(objects) {
  const units = new Map();
  objects.forEach((object) => {
    const key = object.groupId ? `group:${object.groupId}` : `object:${object.id}`;
    if (!units.has(key)) {
      units.set(key, {
        id: key,
        objects: [],
        bounds: null,
      });
    }
    units.get(key).objects.push(object);
  });
  return [...units.values()].map((unit) => ({
    ...unit,
    bounds: getCombinedBounds(unit.objects),
  }));
}

function translateLayoutUnit(unit, deltaX, deltaY) {
  unit.objects.forEach((object) => translateObject(object, deltaX, deltaY));
  unit.bounds = {
    ...unit.bounds,
    x: unit.bounds.x + deltaX,
    y: unit.bounds.y + deltaY,
  };
}

function getCombinedUnitBounds(units) {
  if (!units.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...units.map((unit) => unit.bounds.x));
  const top = Math.min(...units.map((unit) => unit.bounds.y));
  const right = Math.max(...units.map((unit) => unit.bounds.x + unit.bounds.width));
  const bottom = Math.max(...units.map((unit) => unit.bounds.y + unit.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function transformObject(object, center, transform) {
  if (object.type === "arc") {
    replaceObjectValue(
      object,
      transformCurveGeometry(
        object,
        (point) => transformPoint(point, center, transform),
      ),
    );
    return;
  }
  if (["line", "connector", "dimension"].includes(object.type)) {
    const start = transformPoint({ x: object.x, y: object.y }, center, transform);
    const end = transformPoint({ x: object.endX, y: object.endY }, center, transform);
    object.x = start.x;
    object.y = start.y;
    object.endX = end.x;
    object.endY = end.y;
    return;
  }

  if (object.type === "pen" && Array.isArray(object.points)) {
    object.points = object.points.map((point) => transformPoint(point, center, transform));
    return;
  }
  if (object.type === "trace" && Array.isArray(object.paths)) {
    object.paths = object.paths.map((path) => path.map((point) => transformPoint(point, center, transform)));
    return;
  }

  const objectCenter = {
    x: object.x + object.w / 2,
    y: object.y + object.h / 2,
  };
  const nextCenter = transformPoint(objectCenter, center, transform);
  object.w = Math.max(1, object.w * transform.scale.x);
  object.h = Math.max(1, object.h * transform.scale.y);
  object.x = nextCenter.x - object.w / 2;
  object.y = nextCenter.y - object.h / 2;
  if ("rotation" in object) {
    const flipSign = transform.flipHorizontal !== transform.flipVertical ? -1 : 1;
    object.rotation = (object.rotation ?? 0) * flipSign + transform.rotation;
  }
}

function transformPoint(point, center, transform) {
  let x = (point.x - center.x) * transform.scale.x;
  let y = (point.y - center.y) * transform.scale.y;
  if (transform.flipHorizontal) x *= -1;
  if (transform.flipVertical) y *= -1;
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return {
    x: center.x + x * cosine - y * sine + transform.translation.x,
    y: center.y + x * sine + y * cosine + transform.translation.y,
  };
}

function translateObject(object, deltaX, deltaY) {
  if (object.type === "pen" && Array.isArray(object.points)) {
    object.points.forEach((point) => {
      point.x += deltaX;
      point.y += deltaY;
    });
    return;
  }
  if (object.type === "trace" && Array.isArray(object.paths)) {
    object.paths.flat().forEach((point) => {
      point.x += deltaX;
      point.y += deltaY;
    });
    return;
  }
  if (object.type === "arc") {
    replaceObjectValue(
      object,
      transformCurveGeometry(object, (point) => ({
        x: point.x + deltaX,
        y: point.y + deltaY,
      })),
    );
    return;
  }
  ["x", "endX", "midX"].forEach((field) => {
    if (Number.isFinite(object[field])) object[field] += deltaX;
  });
  ["y", "endY", "midY"].forEach((field) => {
    if (Number.isFinite(object[field])) object[field] += deltaY;
  });
}

function reconcileSemanticConnections(runtime) {
  const objectsById = new Map(
    runtime.state.board.objects.map((object) => [object.id, object]),
  );
  runtime.state.board.objects = runtime.state.board.objects.filter((object) => {
    if (!["connector", "line"].includes(object.type)) return true;
    const sourceId = object.semantic?.sourceId;
    const targetId = object.semantic?.targetId;
    if (!sourceId && !targetId) return true;
    const source = objectsById.get(sourceId);
    const target = objectsById.get(targetId);
    if (!source || !target) {
      runtime.deletedIds.add(object.id);
      return false;
    }
    const sourceBounds = getObjectBounds(source);
    const targetBounds = getObjectBounds(target);
    const next = {
      x: sourceBounds.x + sourceBounds.width / 2,
      y: sourceBounds.y + sourceBounds.height / 2,
      endX: targetBounds.x + targetBounds.width / 2,
      endY: targetBounds.y + targetBounds.height / 2,
    };
    if (
      object.x !== next.x
      || object.y !== next.y
      || object.endX !== next.endX
      || object.endY !== next.endY
    ) {
      Object.assign(object, next);
      if (!runtime.createdIds.includes(object.id)) runtime.updatedIds.add(object.id);
    }
    return true;
  });
}

function createNodeTextbox(identifier, label, shape, style, semantic, groupId) {
  return {
    id: identifier,
    type: "textbox",
    x: shape.x + 12,
    y: shape.y + 10,
    w: Math.max(24, shape.w - 24),
    h: Math.max(24, shape.h - 20),
    rotation: shape.rotation ?? 0,
    text: label,
    colorRanges: [],
    fontSize: clampNumber(style.fontSize, 8, 96, 18),
    fontFamily: FONT_FAMILIES.has(style.fontFamily) ? style.fontFamily : "serif",
    color: normalizeColor(style.textColor ?? style.color ?? "#000000"),
    strokeWidth: 1,
    dashPattern: "solid",
    locked: false,
    groupId,
    rigidGroup: true,
    semantic: { ...semantic, role: "label" },
  };
}

function normalizeExecutionState(source) {
  const state = cloneJson(source);
  if (!isRecord(state?.board) || !Array.isArray(state.board.objects)) {
    throw new TypeError("Visual Board AI requires a complete board state.");
  }
  state.board.assets = isRecord(state.board.assets) ? state.board.assets : {};
  state.board.rig = isRecord(state.board.rig) ? state.board.rig : { bodies: [], joints: [] };
  state.board.settings = isRecord(state.board.settings)
    ? state.board.settings
    : { grid: true, snap: false };
  state.board.settings.floorPlan = normalizeFloorPlanSettings(
    state.board.settings.floorPlan,
  );
  state.board.settings.architecture = normalizeArchitectureSettings(
    state.board.settings.architecture,
  );
  state.selectedIds = Array.isArray(state.selectedIds)
    ? state.selectedIds.filter((id) => typeof id === "string")
    : [];
  state.viewport = {
    x: finiteNumber(state.viewport?.x, 0),
    y: finiteNumber(state.viewport?.y, 0),
    zoom: clampNumber(state.viewport?.zoom, 0.15, 4, 1),
    width: Math.max(1, finiteNumber(state.viewport?.width, 1200)),
    height: Math.max(1, finiteNumber(state.viewport?.height, 800)),
  };
  return state;
}

function readState(dependencies) {
  return normalizeExecutionState(dependencies.getState());
}

function validateDependencies(dependencies) {
  if (
    !dependencies
    || typeof dependencies.getState !== "function"
    || typeof dependencies.commit !== "function"
    || typeof dependencies.createId !== "function"
  ) {
    throw new TypeError("Visual Board AI needs getState, commit, and createId dependencies.");
  }
}

function resolvePlacement(state, placementValue) {
  const placement = isRecord(placementValue) ? placementValue : { type: "viewport-center" };
  if (placement.type === "point") {
    return {
      x: finiteNumber(placement.x, state.viewport.x),
      y: finiteNumber(placement.y, state.viewport.y),
    };
  }
  if (placement.type === "selection" && state.selectedIds.length) {
    const selected = state.board.objects.filter((object) => state.selectedIds.includes(object.id));
    const bounds = getCombinedBounds(selected);
    return { x: bounds.x + bounds.width + 220, y: bounds.y + bounds.height / 2 };
  }
  if (placement.type === "available-space") {
    const bounds = getCombinedBounds(state.board.objects);
    return state.board.objects.length
      ? { x: bounds.x + bounds.width + 320, y: bounds.y + 200 }
      : getViewportCenter(state.viewport);
  }
  return getViewportCenter(state.viewport);
}

function getViewportCenter(viewport) {
  return {
    x: viewport.x + viewport.width / (2 * viewport.zoom),
    y: viewport.y + viewport.height / (2 * viewport.zoom),
  };
}

function getViewportBounds(viewport) {
  return {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width / viewport.zoom,
    height: viewport.height / viewport.zoom,
  };
}

function normalizeStyle(value, commandIndex = null) {
  if (value.dashPattern !== undefined && !DASH_PATTERNS.has(value.dashPattern)) {
    if (commandIndex !== null) {
      throw commandError("Unsupported dash pattern.", "invalid-dash-pattern", commandIndex);
    }
  }
  return {
    color: normalizeColor(value.color ?? "#000000", commandIndex),
    strokeWidth: clampNumber(value.strokeWidth, 1, 24, 3),
    dashPattern: DASH_PATTERNS.has(value.dashPattern) ? value.dashPattern : "solid",
    locked: Boolean(value.locked),
  };
}

function normalizeSemantic(value, fallbackLabel = "") {
  const semantic = isRecord(value) ? value : {};
  const normalized = {
    label: String(semantic.label ?? fallbackLabel ?? "").trim().slice(0, 240),
    role: String(semantic.role ?? "").trim().slice(0, 80),
    tags: normalizeTags(semantic.tags),
    generatedBy: String(semantic.generatedBy ?? "").trim().slice(0, 80),
    diagramId: String(semantic.diagramId ?? "").trim().slice(0, 128),
    clientRef: String(semantic.clientRef ?? "").trim().slice(0, 128),
    sourceId: String(semantic.sourceId ?? "").trim().slice(0, 128),
    targetId: String(semantic.targetId ?? "").trim().slice(0, 128),
    roomId: String(semantic.roomId ?? "").trim().slice(0, 128),
    wallPathId: String(semantic.wallPathId ?? "").trim().slice(0, 128),
    referenceId: String(semantic.referenceId ?? "").trim().slice(0, 128),
    levelId: String(semantic.levelId ?? "").trim().slice(0, 128),
    segmentIndex: Number.isInteger(Number(semantic.segmentIndex))
      ? Number(semantic.segmentIndex)
      : null,
    openingIndex: Number.isInteger(Number(semantic.openingIndex))
      ? Number(semantic.openingIndex)
      : null,
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, item]) => (
    Array.isArray(item) ? item.length : item !== "" && item !== null
  )));
}

function sanitizeSemantic(value) {
  return normalizeSemantic(value);
}

function normalizeTags(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((tag) => String(tag).trim().slice(0, MAX_TAG_LENGTH))
    .filter(Boolean))]
    .slice(0, MAX_TAGS);
}

function normalizeClientKey(value, runtime, commandIndex) {
  if (value === undefined || value === null || value === "") return null;
  const key = String(value).trim();
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(key)) {
    throw commandError("clientKey contains unsupported characters.", "invalid-client-key", commandIndex);
  }
  if (runtime.clientKeyMap.has(key)) {
    throw commandError(`Duplicate client key: ${key}.`, "duplicate-client-key", commandIndex);
  }
  return key;
}

function normalizeText(value, commandIndex) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw commandError("Text cannot be empty.", "empty-text", commandIndex);
  if (text.length > MAX_TEXT_LENGTH) {
    throw commandError(`Text cannot exceed ${MAX_TEXT_LENGTH} characters.`, "text-too-long", commandIndex);
  }
  return text;
}

function normalizeOptionalText(value, commandIndex) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  return normalizeText(value, commandIndex);
}

function normalizeColor(value, commandIndex = null) {
  const color = String(value ?? "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    if (commandIndex === null) return "#000000";
    throw commandError("Colors must use six-digit hexadecimal notation.", "invalid-color", commandIndex);
  }
  return color.toLowerCase();
}

function finiteCoordinate(value, fallback, field, commandIndex) {
  const number = finiteNumber(value, fallback);
  if (Math.abs(number) > COORDINATE_LIMIT) {
    throw commandError(`${field} is outside the supported board range.`, "coordinate-out-of-range", commandIndex);
  }
  return number;
}

function requireCurvePoints(value, field, commandIndex) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 128) {
    throw commandError(
      `${field} must contain between 3 and 128 points.`,
      "invalid-curve-points",
      commandIndex,
    );
  }
  return value.map((point, index) => {
    if (!isRecord(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw commandError(
        `${field}[${index}] must contain finite x and y coordinates.`,
        "invalid-curve-point",
        commandIndex,
      );
    }
    return {
      x: finiteCoordinate(point.x, 0, `${field}[${index}].x`, commandIndex),
      y: finiteCoordinate(point.y, 0, `${field}[${index}].y`, commandIndex),
    };
  });
}

function requireInsertionPoints(value, field, commandIndex) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw commandError(
      `${field} must contain between 1 and 64 points.`,
      "invalid-curve-points",
      commandIndex,
    );
  }
  return value.map((point, index) => {
    if (!isRecord(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw commandError(
        `${field}[${index}] must contain finite x and y coordinates.`,
        "invalid-curve-point",
        commandIndex,
      );
    }
    return {
      x: finiteCoordinate(point.x, 0, `${field}[${index}].x`, commandIndex),
      y: finiteCoordinate(point.y, 0, `${field}[${index}].y`, commandIndex),
    };
  });
}

function replaceObjectValue(target, source) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, source);
}

function finiteDimension(value, fallback, field, commandIndex) {
  const number = finiteNumber(value, fallback);
  if (!(number > 0) || number > DIMENSION_LIMIT) {
    throw commandError(`${field} must be between 0 and ${DIMENSION_LIMIT}.`, "dimension-out-of-range", commandIndex);
  }
  return number;
}

function estimateNodeSize(label) {
  const lineCount = Math.max(1, Math.ceil(label.length / 26));
  return {
    width: Math.min(340, Math.max(DEFAULT_NODE_WIDTH, 100 + Math.min(label.length, 40) * 4)),
    height: Math.min(220, Math.max(DEFAULT_NODE_HEIGHT, 54 + lineCount * 24)),
  };
}

function calculateGraphDepths(nodes, edges) {
  const incoming = new Map(nodes.map((node) => [node.key, 0]));
  const adjacency = new Map(nodes.map((node) => [node.key, []]));
  edges.forEach((edge) => {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    adjacency.get(edge.from)?.push(edge.to);
  });
  const queue = nodes.filter((node) => incoming.get(node.key) === 0).map((node) => node.key);
  const depths = new Map(queue.map((key) => [key, 0]));
  while (queue.length) {
    const key = queue.shift();
    (adjacency.get(key) ?? []).forEach((child) => {
      depths.set(child, Math.max(depths.get(child) ?? 0, (depths.get(key) ?? 0) + 1));
      incoming.set(child, incoming.get(child) - 1);
      if (incoming.get(child) === 0) queue.push(child);
    });
  }
  nodes.forEach((node, index) => {
    if (!depths.has(node.key)) depths.set(node.key, index);
  });
  return depths;
}

function getCombinedBounds(objects) {
  if (!objects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const bounds = objects.map((object) => getObjectBounds(object));
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function filterRigForObjects(rigValue, objects) {
  const rig = isRecord(rigValue) ? cloneJson(rigValue) : { bodies: [], joints: [] };
  const objectIds = new Set(objects.map((object) => object.id));
  const groupIds = new Set(objects.map((object) => object.groupId).filter(Boolean));
  const bodies = (Array.isArray(rig.bodies) ? rig.bodies : [])
    .filter((body) => groupIds.has(body.id))
    .map((body) => ({
      ...body,
      objectIds: (body.objectIds ?? []).filter((id) => objectIds.has(id)),
    }));
  const bodyIds = new Set(bodies.map((body) => body.id));
  const joints = (Array.isArray(rig.joints) ? rig.joints : [])
    .filter((joint) => (joint.bodyIds ?? []).every((id) => bodyIds.has(id)));
  const jointIds = new Set(joints.map((joint) => joint.id));
  bodies.forEach((body) => {
    body.jointIds = (body.jointIds ?? []).filter((id) => jointIds.has(id));
  });
  return { bodies, joints };
}

function summarizeExecution(execution) {
  const { receipt } = execution;
  return [
    receipt.createdIds.length ? `${receipt.createdIds.length} created` : "",
    receipt.updatedIds.length ? `${receipt.updatedIds.length} updated` : "",
    receipt.deletedIds.length ? `${receipt.deletedIds.length} deleted` : "",
  ].filter(Boolean).join(", ") || "No visible changes";
}

function schema(required, properties) {
  return Object.freeze({
    type: "object",
    required: ["type", ...required],
    properties: {
      type: { type: "string" },
      ...properties,
    },
    additionalProperties: false,
  });
}

function targetCommandSchema() {
  return schema([], {
    targets: TARGET_SCHEMA,
    target: TARGET_SCHEMA,
  });
}

function pointSchema() {
  return {
    type: "object",
    properties: {
      x: { type: "number" },
      y: { type: "number" },
    },
  };
}

function assertOnlyCommandFields(commandValue, commandIndex) {
  const commandSchema = VISUAL_COMMAND_SCHEMAS[commandValue.type];
  if (!commandSchema) return;
  const allowedFields = new Set(Object.keys(commandSchema.properties));
  const unknownField = Object.keys(commandValue).find((field) => !allowedFields.has(field));
  if (unknownField) {
    throw commandError(
      `Unsupported ${commandValue.type} field: ${unknownField}.`,
      "unknown-command-field",
      commandIndex,
    );
  }
}

function command(type, permissions, description) {
  return Object.freeze({ type, permissions, description });
}

function commandError(message, code, commandIndex) {
  return new AiCommandError(message, {
    code,
    commandIndex,
    path: `$.commands[${commandIndex}]`,
  });
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = finiteNumber(value, fallback);
  return Math.min(maximum, Math.max(minimum, number));
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Math.round(finiteNumber(value, fallback));
  return Math.min(maximum, Math.max(minimum, number));
}

function roundNumber(value) {
  return Math.round(finiteNumber(value, 0) * 100) / 100;
}

function roundBounds(bounds) {
  return {
    x: roundNumber(bounds.x),
    y: roundNumber(bounds.y),
    width: roundNumber(bounds.width),
    height: roundNumber(bounds.height),
  };
}

function boundsIntersect(first, second) {
  return first.x <= second.x + second.width
    && first.x + first.width >= second.x
    && first.y <= second.y + second.height
    && first.y + first.height >= second.y;
}

function groupBy(items, keyForItem) {
  const grouped = new Map();
  items.forEach((item) => {
    const key = keyForItem(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  });
  return grouped;
}
