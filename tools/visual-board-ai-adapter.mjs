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
  createFloorPlanElement,
  createFloorPlanTemplate,
  normalizeFloorPlanSettings,
} from "./visual-board-floor-plan.mjs";
import { getObjectBounds } from "./visual-board-geometry.mjs";
import { flipBoardSelection } from "./visual-board-transform.mjs";

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

const COMMAND_DEFINITIONS = Object.freeze([
  command("objects.create", ["create"], "Create one or more editable board objects."),
  command("objects.update", ["update"], "Update allowlisted properties on target objects."),
  command("objects.delete", ["delete"], "Delete explicit unlocked objects."),
  command("objects.transform", ["update"], "Move, resize, rotate, or flip target objects."),
  command("objects.duplicate", ["create"], "Duplicate target objects with an offset."),
  command("selection.set", ["update"], "Set the current selection using stable references."),
  command("objects.group", ["update"], "Group target objects into one rigid selection unit."),
  command("objects.ungroup", ["update"], "Release target objects from their rigid groups."),
  command("objects.connect", ["create"], "Connect two objects with an arrow or line."),
  command("objects.disconnect", ["delete"], "Remove semantic connections between targets."),
  command("objects.layout", ["update"], "Arrange target objects with a deterministic layout."),
  command("template.insert", ["create"], "Insert a high-level reusable board template."),
  command("floor-plan.insert", ["create"], "Insert an editable floor-plan element or room template."),
  command("diagram.create", ["create"], "Create a complete semantic diagram in one command."),
  command("viewport.focus", ["update"], "Focus the board viewport on targets or a point."),
  command("board.settings.update", ["update"], "Update grid, snapping, and floor-plan settings."),
]);

const TARGET_SCHEMA = Object.freeze({
  type: "object",
  description: "One or more existing objects. IDs come from getContext; clientKeys come from earlier commands in the same envelope.",
  properties: {
    ids: { type: "array", items: { type: "string" } },
    clientKeys: { type: "array", items: { type: "string" } },
    selection: { type: "boolean" },
    semanticRef: { type: "string" },
  },
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
            midX: { type: "number" },
            midY: { type: "number" },
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
          strokeWidth: { type: "number", minimum: 1, maximum: 24 },
          dashPattern: { enum: [...DASH_PATTERNS] },
          locked: { type: "boolean" },
          text: { type: "string" },
          fontSize: { type: "number", minimum: 8, maximum: 96 },
          fontFamily: { enum: [...FONT_FAMILIES] },
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
      },
    },
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
          },
        },
      },
    },
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
      const revision = await dependencies.commit(execution.state, {
        requestId: envelope.requestId,
        summary: summarizeExecution(execution),
      });
      return {
        revision,
        ...execution.receipt,
        undoGroupId: envelope.requestId,
        result: {
          summary: summarizeExecution(execution),
          affectedBounds: execution.affectedBounds,
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
    version: 1,
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
      "Rigged characters can be mirrored, but generic duplication, resize, rotation, and layout remain unavailable.",
      "Commands cannot import local files or start animation rendering.",
    ],
    examples: getVisualBoardAiExamples(),
  };
}

export function getVisualBoardAiExamples() {
  return [
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
      semantic: sanitizeSemantic(object.semantic),
    };
    if (object.type === "textbox") summary.text = String(object.text ?? "").slice(0, 1_000);
    if (object.type === "shape") summary.shapeKind = object.shapeKind;
    if (object.type === "connector" || object.type === "line") {
      summary.end = {
        x: roundNumber(object.endX),
        y: roundNumber(object.endY),
      };
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
    settings: cloneJson(state.board.settings),
    objects,
    omittedObjectCount,
    assets: {
      count: Object.keys(state.board.assets ?? {}).length,
      bytesIncluded: false,
    },
  };
}

function executeCommand(runtime, commandValue, commandIndex) {
  const command = cloneJson(commandValue);
  assertOnlyCommandFields(command, commandIndex);
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
    case "diagram.create":
      createDiagram(runtime, command, commandIndex);
      break;
    case "viewport.focus":
      focusViewport(runtime, command, commandIndex);
      break;
    case "board.settings.update":
      updateBoardSettings(runtime, command, commandIndex);
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
      ...style,
      semantic,
    };
  } else if (objectType === "arc") {
    object = {
      id,
      type: "arc",
      x,
      y,
      midX: finiteCoordinate(draft.midX, x + 90, "midX", commandIndex),
      midY: finiteCoordinate(draft.midY, y - 55, "midY", commandIndex),
      endX: finiteCoordinate(draft.endX, x + 180, "endX", commandIndex),
      endY: finiteCoordinate(draft.endY, y, "endY", commandIndex),
      ...style,
      semantic,
    };
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
    "strokeWidth",
    "dashPattern",
    "locked",
    "text",
    "fontSize",
    "fontFamily",
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
    if (patch.strokeWidth !== undefined) object.strokeWidth = clampNumber(patch.strokeWidth, 1, 24, object.strokeWidth);
    if (patch.dashPattern !== undefined) {
      if (!DASH_PATTERNS.has(patch.dashPattern)) {
        throw commandError("Unsupported dash pattern.", "invalid-dash-pattern", commandIndex);
      }
      object.dashPattern = patch.dashPattern;
    }
    if (patch.locked !== undefined) object.locked = Boolean(patch.locked);
    if (patch.rotation !== undefined && "rotation" in object) {
      object.rotation = finiteNumber(patch.rotation, object.rotation ?? 0);
    }
    if (patch.text !== undefined && object.type === "textbox") {
      object.text = normalizeText(patch.text, commandIndex);
      object.colorRanges = [];
    }
    if (patch.fontSize !== undefined && object.type === "textbox") {
      object.fontSize = clampNumber(patch.fontSize, 8, 96, object.fontSize);
    }
    if (patch.fontFamily !== undefined && object.type === "textbox") {
      if (!FONT_FAMILIES.has(patch.fontFamily)) {
        throw commandError("Unsupported font family.", "invalid-font-family", commandIndex);
      }
      object.fontFamily = patch.fontFamily;
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
    runtime.updatedIds.add(object.id);
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
  const objects = isTemplate
    ? createFloorPlanTemplate(kind, origin, settings, runtime.createId)
    : createFloorPlanElement(kind, origin, settings, runtime.createId);

  runtime.state.board.objects.push(...objects);
  runtime.state.selectedIds = objects.map((object) => object.id);
  runtime.createdIds.push(...runtime.state.selectedIds);
  runtime.state.board.settings.floorPlan = settings;
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
  const viewportBounds = getViewportBounds(runtime.state.viewport);
  runtime.state.viewport.x = point.x - viewportBounds.width / 2;
  runtime.state.viewport.y = point.y - viewportBounds.height / 2;
  if (command.zoom !== undefined) {
    runtime.state.viewport.zoom = clampNumber(command.zoom, 0.15, 4, runtime.state.viewport.zoom);
  }
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
      .filter((object) => object.semantic?.clientRef === target.semanticRef)
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
  if (["line", "connector", "arc"].includes(object.type)) {
    const start = transformPoint({ x: object.x, y: object.y }, center, transform);
    const end = transformPoint({ x: object.endX, y: object.endY }, center, transform);
    object.x = start.x;
    object.y = start.y;
    object.endX = end.x;
    object.endY = end.y;
    if (object.type === "arc") {
      const mid = transformPoint({ x: object.midX, y: object.midY }, center, transform);
      object.midX = mid.x;
      object.midY = mid.y;
    }
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
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, item]) => (
    Array.isArray(item) ? item.length : item !== ""
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
