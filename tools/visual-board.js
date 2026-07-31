/**
 * Infinite, local-first visual workspace for drawing, diagramming, text, and
 * dropped images. Every board item remains an editable vector-style object.
 */

import { createId } from "../app/store.js";
import { duplicateBoardObjects } from "./visual-board-clipboard.mjs?v=4";
import {
  CharacterFileError,
  createCharacterFilename,
  createCharacterPackage,
  instantiateCharacter,
} from "./visual-board-character.mjs?v=3";
import {
  addVisualBoardLibraryItem,
  createEmptyVisualBoardLibrary,
  createVisualBoardLibraryItem,
  filterVisualBoardLibraryItems,
  getVisualBoardLibraryItemSummary,
  normalizeVisualBoardLibrary,
  removeVisualBoardLibraryItem,
} from "./visual-board-library.mjs?v=2";
import {
  getShapeToolFamily,
  retainShapeToolChoice,
} from "./visual-board-shape-tools.mjs?v=1";
import {
  applyTextColorRange,
  getTextColorSegments,
  sanitizeTextColorRanges,
  updateTextColorRangesForEdit,
} from "./visual-board-rich-text.mjs?v=1";
import {
  createBoardHistoryEntry,
  restoreBoardHistoryEntry,
} from "./visual-board-history.mjs?v=2";
import {
  getDefaultTextboxSize,
  getTextWorldFontSize,
} from "./visual-board-text.mjs?v=2";
import {
  createEditableVertexNetwork,
  getVertexNetworkVertices,
  insertLineVertex,
  mergeVertexNetworkVertexAtNearest,
  setVertexNetworkPosition,
} from "./visual-board-vertices.mjs?v=7";
import {
  getCurveBezierSegments,
  getCurvePathPoints,
  getCurveVertices,
  insertCurveVertex,
  normalizeCurveGeometry,
  setCurveVertexPosition,
  transformCurveGeometry,
} from "./visual-board-curves.mjs?v=6";
import { traceBlackAndWhiteImage } from "./visual-board-tracing.mjs?v=1";
import { getStrokeDashArray } from "./visual-board-strokes.mjs?v=1";
import {
  MAX_ANIMATION_FRAMES,
  createAnimationFrame,
  getPlayableFrames,
  normalizeAnimation,
  normalizeFrameDuration,
  replaceAnimationFrame,
} from "./visual-board-animation.mjs?v=1";
import {
  FrameInterpolationError,
  insertIntermediateFrames,
  normalizeIntermediateFrameCount,
} from "./visual-board-interpolation.mjs?v=1";
import {
  AnimationExportError,
  createAnimationExportFilename,
  recordAnimationVideo,
} from "./visual-board-export.mjs?v=2";
import {
  getObjectGroupFields,
  getSelectionBounds,
  getSelectionUnits,
  mapPaddedResizePointer,
  padSelectionBounds,
  popObjectGroupLevel,
  pushObjectGroupLevel,
  resizeSelectionObjects,
  rotateSelectionObjects,
} from "./visual-board-groups.mjs?v=5";
import {
  createEmptyRig,
  dragRigJoint,
  getConnectedRigBodyIds,
  getRigJointsForBodyIds,
  normalizeRig,
  removeRigBodies,
  resolveConstrainedPoint,
  setRigBodyDimensionLock,
} from "./visual-board-rigging.mjs?v=2";
import {
  CURVE_TYPES,
  LINE_TYPES,
  SHAPE_TYPES,
  VISUAL_BOARD_MAX_ZOOM,
  VISUAL_BOARD_MIN_STROKE_WIDTH,
  VISUAL_BOARD_MIN_ZOOM,
  clamp,
  distanceBetween,
  explodeObjectIntoLines,
  getLineSelectionCorners,
  getMarqueeSelectionCandidates,
  getObjectBounds,
  getObjectSegments,
  getShapeCenter,
  getShapeCorners,
  normalizeShape,
  pointHitsObject,
  resizeShapeFromCorner,
  rotatePoint,
  snapValue,
  isExplodableObject,
} from "./visual-board-geometry.mjs?v=13";
import {
  cropToAspect,
  fillCropToFrame,
  fitFrameToCrop,
  getImageDrawArguments,
  mapCropToReplacement,
  normalizeImageCrop,
  resetImageCrop,
} from "./visual-board-image.mjs?v=1";
import {
  flipBoardSelection,
  getMoveAlignmentSnap,
} from "./visual-board-transform.mjs?v=4";
import { eraseObjectNear } from "./visual-board-eraser.mjs?v=1";
import {
  canReceiveBucketFill,
  createBucketFillArea,
  findBucketFillTarget,
  findEnclosedVectorRegion,
} from "./visual-board-fill.mjs?v=2";
import {
  FLOOR_PLAN_ELEMENTS,
  FLOOR_PLAN_TEMPLATES,
  addFloorPlanRoom,
  createFloorPlanElement,
  createFloorPlanTemplate,
  formatFloorPlanDimension,
  getFloorPlanElementDefinition,
  getFloorPlanTemplateDefinition,
  hasFloorPlanRemovalPassword,
  isFloorPlanObjectVisible,
  moveFloorPlanRoom,
  normalizeFloorPlanSettings,
  normalizeFloorPlanRoomState,
  removeActiveFloorPlanRoom,
} from "./visual-board-floor-plan.mjs?v=7";
import {
  addFloorPlanTemplate,
  createFloorPlanTemplateRecord,
  getFloorPlanTemplateCatalog,
  getFloorPlanTemplateRecord,
  removeFloorPlanTemplate,
  replaceFloorPlanTemplate,
  restoreBuiltInFloorPlanTemplate,
  updateFloorPlanTemplate,
} from "./visual-board-floor-plan-templates.mjs?v=4";
import {
  ARCHITECTURE_FILL_PATTERNS,
  fitArchitectureSymbolFrame,
  getArchitectureMaterial,
  getArchitectureSymbol,
  normalizeArchitectureSettings,
  sortArchitectureObjects,
} from "./visual-board-architecture.mjs?v=2";
import {
  exportVisualBoardToSvg,
  getVisualBoardExportBounds,
} from "./visual-board-static-export.mjs?v=7";
import { installAiPageHost } from "../app/ai-page-host.mjs";
import { AI_PERMISSION_LEVELS } from "../app/ai-command-protocol.mjs";
import {
  createVisualBoardAiAdapter,
  getVisualBoardAiCapabilities,
  getVisualBoardAiExamples,
} from "./visual-board-ai-adapter.mjs?v=18";

const BOARD_KEY = "artificially-neuroscience-visual-board-v1";
const BOARD_LIBRARY_KEY = "artificially-neuroscience-visual-board-library-v1";
const BOARD_VERSION = 20;
const HISTORY_LIMIT = 300;
const GRID_SIZE = 32;
const MIN_SHAPE_SIZE = 16;
const HANDLE_SIZE = 6;
const ROTATION_HANDLE_OFFSET = 28;
const GROUP_SELECTION_PADDING = 24;
const MARQUEE_DRAG_THRESHOLD = 3;
const MAX_IMAGE_DIMENSION = 1800;
const MAX_TRACE_DIMENSION = 800;
const MAX_STATIC_EXPORT_DIMENSION = 4096;
const MAX_PDF_PAGE_DIMENSION = 1440;
const VERTEX_TOUCH_TOLERANCE = 0.01;
const VERTEX_DROP_MERGE_RADIUS = 10;
const INSERTABLE_LINE_TYPES = new Set(["line", "connector"]);
const ANIMATION_PANEL_WIDTH_KEY = "visual-board-animation-panel-width";
const ANIMATION_PREVIEW_HEIGHT_KEY = "visual-board-animation-preview-height";
const MIN_ANIMATION_PANEL_WIDTH = 300;
const MIN_ANIMATION_PREVIEW_HEIGHT = 120;
const DASH_PATTERNS = new Set(["solid", "dashed", "dotted", "dash-dot", "long-dash"]);
const ARCHITECTURE_PATTERNS = new Set(ARCHITECTURE_FILL_PATTERNS);
const TEXT_FONT_FAMILIES = Object.freeze({
  serif: 'Georgia, "Times New Roman", serif',
  sans: "Arial, Helvetica, sans-serif",
  mono: '"Courier New", Courier, monospace',
  typewriter: '"American Typewriter", "Courier New", serif',
  handwriting: '"Bradley Hand", "Segoe Print", cursive',
});
const SHAPE_KINDS = new Set([
  "triangle",
  "diamond",
  "hexagon",
  "cube",
  "cuboid",
  "pyramid",
  "triangular-prism",
  "cylinder",
  "cone",
]);

const canvas = document.querySelector("#visual-board");
const context = canvas.getContext("2d");
const canvasFrame = canvas.parentElement;
const colorInput = document.querySelector("#stroke-color");
const fillColorInput = document.querySelector("#fill-color");
const bucketFillTool = document.querySelector("#bucket-fill-tool");
const clearFillButton = document.querySelector("#clear-fill");
const widthInput = document.querySelector("#stroke-width");
const widthValue = document.querySelector("#stroke-width-value");
const patternInput = document.querySelector("#stroke-pattern");
const textStyleControls = document.querySelector("#text-style-controls");
const textFontInput = document.querySelector("#text-font");
const textSizeInput = document.querySelector("#text-font-size");
const textColorInput = document.querySelector("#text-color");
const shape2dControl = document.querySelector("#shape-2d-control");
const shape3dControl = document.querySelector("#shape-3d-control");
const lineControl = document.querySelector("#line-control");
const drawingTools = document.querySelector("#drawing-tools");
const selectionActions = document.querySelector("#selection-actions");
const selectionCount = document.querySelector("#selection-count");
const lockSelectionButton = document.querySelector("#lock-selection");
const lockDimensionsButton = document.querySelector("#lock-dimensions");
const groupSelectionButton = document.querySelector("#group-selection");
const traceImageButton = document.querySelector("#trace-image");
const mergeVerticesButton = document.querySelector("#merge-vertices");
const addCurveVertexButton = document.querySelector("#add-curve-vertex");
const ungroupSelectionButton = document.querySelector("#ungroup-selection");
const deleteSelectionButton = document.querySelector("#delete-selection");
const copySelectionButton = document.querySelector("#copy-selection");
const pasteSelectionButton = document.querySelector("#paste-selection");
const saveToLibraryButton = document.querySelector("#save-to-library");
const exportCharacterButton = document.querySelector("#export-character");
const boardExportFormat = document.querySelector("#board-export-format");
const boardExportButton = document.querySelector("#export-board-artwork");
const gridToggle = document.querySelector("#toggle-grid");
const snapToggle = document.querySelector("#toggle-snap");
const saveStatus = document.querySelector("#save-status");
const toolWorkspace = document.querySelector("#tool-main");
const animationToggleButton = document.querySelector("#toggle-animation");
const boardLibraryToggleButton = document.querySelector("#toggle-board-library");
const boardLibraryPanel = document.querySelector("#board-library-panel");
const boardLibraryCloseButton = document.querySelector("#close-board-library");
const boardLibraryTotal = document.querySelector("#board-library-total");
const boardLibrarySaveSelectionButton = document.querySelector("#library-save-selection");
const boardLibrarySearch = document.querySelector("#board-library-search");
const boardLibraryEmpty = document.querySelector("#board-library-empty");
const boardLibraryList = document.querySelector("#board-library-list");
const boardLibrarySaveDialog = document.querySelector("#board-library-save-dialog");
const boardLibrarySaveForm = document.querySelector("#board-library-save-form");
const boardLibraryNameInput = document.querySelector("#board-library-name");
const boardLibrarySaveError = document.querySelector("#board-library-save-error");
const boardLibrarySaveCancelButton = document.querySelector("#cancel-board-library-save");
const boardLibrarySaveCloseButton = document.querySelector("#close-board-library-save");
const animationPanel = document.querySelector("#animation-panel");
const animationPanelResizeHandle = document.querySelector("#animation-panel-resize");
const animationPreview = document.querySelector("#animation-preview");
const animationPreviewImage = document.querySelector("#animation-preview-image");
const animationPreviewEmpty = document.querySelector("#animation-preview-empty");
const animationPreviewCount = document.querySelector("#animation-preview-count");
const animationPreviewPlayButton = document.querySelector("#animation-preview-play");
const animationPreviewFullscreenButton = document.querySelector("#animation-preview-fullscreen");
const animationPreviewResizeHandle = document.querySelector("#animation-preview-resize");
const animationFrameTotal = document.querySelector("#animation-frame-total");
const animationFrameList = document.querySelector("#animation-frame-list");
const animationPlayButton = document.querySelector("#animation-play");
const animationDurationInput = document.querySelector("#animation-frame-duration");
const animationFpsOutput = document.querySelector("#animation-fps");
const duplicateAnimationFrameButton = document.querySelector("#duplicate-animation-frame");
const deleteAnimationFrameButton = document.querySelector("#delete-animation-frame");
const animationExportFormat = document.querySelector("#animation-export-format");
const animationExportButton = document.querySelector("#export-animation");
const animationExportProgress = document.querySelector("#animation-export-progress");
const animationExportProgressLabel = document.querySelector("#animation-export-progress-label");
const animationExportProgressValue = document.querySelector("#animation-export-progress-value");
const animationExportProgressBar = document.querySelector("#animation-export-progress-bar");
const animationExportCancelButton = document.querySelector("#cancel-animation-export");
const animationExportError = document.querySelector("#animation-export-error");
const interpolationDialog = document.querySelector("#interpolation-dialog");
const interpolationForm = document.querySelector("#interpolation-form");
const interpolationPairLabel = document.querySelector("#interpolation-pair-label");
const interpolationCountInput = document.querySelector("#interpolation-frame-count");
const interpolationProgress = document.querySelector("#interpolation-progress");
const interpolationProgressLabel = document.querySelector("#interpolation-progress-label");
const interpolationProgressValue = document.querySelector("#interpolation-progress-value");
const interpolationProgressBar = document.querySelector("#interpolation-progress-bar");
const interpolationError = document.querySelector("#interpolation-error");
const confirmInterpolationButton = document.querySelector("#confirm-interpolation");
const cancelInterpolationButton = document.querySelector("#cancel-interpolation");
const aiCommandsButton = document.querySelector("#open-ai-commands");
const aiCommandsDialog = document.querySelector("#ai-commands-dialog");
const aiCommandsEditor = document.querySelector("#ai-commands-editor");
const aiCommandsStatus = document.querySelector("#ai-commands-status");
const aiCommandsResult = document.querySelector("#ai-commands-result");
const aiCommandsExample = document.querySelector("#ai-commands-example");
const flipHorizontalButton = document.querySelector("#flip-horizontal");
const flipVerticalButton = document.querySelector("#flip-vertical");
const toggleArrowStartButton = document.querySelector("#toggle-arrow-start");
const mirrorTextToggle = document.querySelector("#mirror-text-toggle");
const editImageButton = document.querySelector("#edit-image");
const floorPlanToggleButton = document.querySelector("#toggle-floor-plan");
const floorPlanPanel = document.querySelector("#floor-plan-panel");
const floorPlanUnits = document.querySelector("#floor-plan-units");
const floorPlanScale = document.querySelector("#floor-plan-scale");
const floorPlanWallThickness = document.querySelector("#floor-plan-wall-thickness");
const floorPlanGridSize = document.querySelector("#floor-plan-grid-size");
const floorPlanGuides = document.querySelector("#floor-plan-guides");
const floorPlanDimensionsVisible = document.querySelector("#floor-plan-dimensions-visible");
const floorPlanLabelsVisible = document.querySelector("#floor-plan-labels-visible");
const floorPlanTabs = [...document.querySelectorAll("[data-floor-plan-tab]")];
const floorPlanToolsList = document.querySelector("#floor-plan-tools");
const floorPlanRestorableTools = document.querySelector("#floor-plan-restorable-tools");
const floorPlanElementsSection = document.querySelector("#floor-plan-elements-section");
const floorPlanTemplatesSection = document.querySelector("#floor-plan-templates-section");
const floorPlanElementsTitle = document.querySelector("#floor-plan-elements-title");
const floorPlanSaveElementButton = document.querySelector("#floor-plan-save-element");
const floorPlanElementList = document.querySelector("#floor-plan-elements");
const floorPlanRestorableElements = document.querySelector("#floor-plan-restorable-elements");
const floorPlanSaveTemplateButton = document.querySelector("#floor-plan-save-template");
const floorPlanTemplateList = document.querySelector("#floor-plan-templates");
const floorPlanRestorableTemplates = document.querySelector("#floor-plan-restorable-templates");
const floorPlanTemplateDialog = document.querySelector("#floor-plan-template-dialog");
const floorPlanTemplateForm = document.querySelector("#floor-plan-template-form");
const floorPlanTemplateDialogTitle = document.querySelector("#floor-plan-template-dialog-title");
const floorPlanTemplateDialogCopy = document.querySelector("#floor-plan-template-dialog-copy");
const floorPlanTemplateName = document.querySelector("#floor-plan-template-name");
const floorPlanTemplateDescription = document.querySelector("#floor-plan-template-description");
const floorPlanTemplateError = document.querySelector("#floor-plan-template-error");
const floorPlanTemplateConfirm = document.querySelector("#confirm-floor-plan-template");
const imageEditDialog = document.querySelector("#image-edit-dialog");
const imageEditForm = document.querySelector("#image-edit-form");
const imageCropStage = document.querySelector("#image-crop-stage");
const imageCropPreview = document.querySelector("#image-crop-preview");
const imageCropBox = document.querySelector("#image-crop-box");
const imageCropAspect = document.querySelector("#image-crop-aspect");
const imageWidthInput = document.querySelector("#image-frame-width");
const imageHeightInput = document.querySelector("#image-frame-height");
const imageDimensionsLock = document.querySelector("#image-dimensions-lock");
const imageRotationInput = document.querySelector("#image-rotation");
const imageReplaceInput = document.querySelector("#image-replace-file");
const imageEditError = document.querySelector("#image-edit-error");

let board = loadBoard();
fillColorInput.value = board.settings.fillColor;
let boardLibrary = loadVisualBoardLibrary();
let viewport = { ...board.view };
let lastSavedBoardContentSignature = getBoardContentSignature(board);
let history = [];
let future = [];
let activeTool = "select";
let selectedObjects = [];
let workingObject = null;
let interaction = null;
let hoverPoint = null;
let textEditorSession = null;
let viewSaveTimer = null;
let spaceHeld = false;
let widthChangeActive = false;
let colorChangeActive = false;
let fillChangeActive = false;
let textColorChangeActive = false;
let traceInProgress = false;
let objectClipboard = [];
let pasteGeneration = 0;
let animationPanelOpen = false;
let boardLibraryPanelOpen = false;
let boardLibraryDialogReturnFocus = null;
let selectedAnimationFrameId = board.animation.frames[0]?.id ?? null;
let animationPlaybackTimer = null;
let animationPlaybackIndex = 0;
let animationExportAbortController = null;
let animationExportInProgress = false;
let interpolationRequest = null;
let interpolationAbortController = null;
let interpolationInProgress = false;
let interpolationReturnFocus = null;
let floorPlanPanelOpen = Boolean(board.settings.floorPlan?.enabled);
let activeFloorPlanTab = "structures";
let floorPlanTemplateDialogState = null;
let floorPlanTemplateReturnFocus = null;
let imageEditSession = null;
let alignmentGuides = [];
let mirrorTextOnFlip = false;
let curveVertexInsertionActive = false;
let shapeToolChoices = {
  "2d": shape2dControl.querySelector("[data-shape-primary]").dataset.shapeTool,
  "3d": shape3dControl.querySelector("[data-shape-primary]").dataset.shapeTool,
};
let lineToolChoice = lineControl.querySelector("[data-line-primary]").dataset.lineTool;

const imageCache = new Map();
const architecturePatternCache = new Map();

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeHexColor(value, fallback = null) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? ""))
    ? String(value).toLowerCase()
    : fallback;
}

function normalizeLayerId(value) {
  const identifier = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(identifier) ? identifier : "structure";
}

function normalizeObjectShadow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const color = normalizeHexColor(value.color, "#000000");
  const opacity = clamp(finiteNumber(value.opacity, 0.18), 0, 1);
  const blur = clamp(finiteNumber(value.blur, 0), 0, 100);
  const offsetX = clamp(finiteNumber(value.offsetX, 0), -500, 500);
  const offsetY = clamp(finiteNumber(value.offsetY, 0), -500, 500);
  return blur || offsetX || offsetY ? { color, opacity, blur, offsetX, offsetY } : null;
}

function normalizeBoardSettings(value = {}) {
  return {
    grid: value.grid ?? true,
    snap: value.snap ?? false,
    fillColor: normalizeHexColor(value.fillColor, "#f7f4ec"),
    floorPlan: normalizeFloorPlanSettings(value.floorPlan),
    architecture: normalizeArchitectureSettings(value.architecture),
  };
}

function normalizeObjectSemantic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tags = [...new Set((Array.isArray(value.tags) ? value.tags : [])
    .map((tag) => String(tag).trim().slice(0, 48))
    .filter(Boolean))]
    .slice(0, 20);
  const semantic = {
    label: String(value.label ?? "").trim().slice(0, 240),
    role: String(value.role ?? "").trim().slice(0, 80),
    tags,
    generatedBy: String(value.generatedBy ?? "").trim().slice(0, 80),
    diagramId: String(value.diagramId ?? "").trim().slice(0, 128),
    clientRef: String(value.clientRef ?? "").trim().slice(0, 128),
    sourceId: String(value.sourceId ?? "").trim().slice(0, 128),
    targetId: String(value.targetId ?? "").trim().slice(0, 128),
    roomId: String(value.roomId ?? "").trim().slice(0, 128),
    wallPathId: String(value.wallPathId ?? "").trim().slice(0, 128),
    referenceId: String(value.referenceId ?? "").trim().slice(0, 128),
    levelId: String(value.levelId ?? "").trim().slice(0, 128),
    segmentIndex: Number.isInteger(value.segmentIndex) ? value.segmentIndex : null,
    openingIndex: Number.isInteger(value.openingIndex) ? value.openingIndex : null,
  };
  const compact = Object.fromEntries(Object.entries(semantic).filter(([, item]) => (
    Array.isArray(item) ? item.length : item !== null && item !== ""
  )));
  return Object.keys(compact).length ? compact : null;
}

function getBoardContentSignature(candidate) {
  return JSON.stringify({
    objects: candidate.objects,
    assets: candidate.assets,
    rig: candidate.rig,
    animation: candidate.animation,
    settings: candidate.settings,
  });
}

function getAiContextRevision() {
  const context = JSON.stringify({
    contentRevision: board.revision ?? 0,
    selectedIds: selectedObjects.map((object) => object.id).sort(),
    viewport: [
      Math.round(viewport.x * 100),
      Math.round(viewport.y * 100),
      Math.round(viewport.zoom * 10_000),
    ],
    libraryIds: boardLibrary.items.map((item) => item.id).sort(),
  });
  let hash = 2_166_136_261;
  for (let index = 0; index < context.length; index += 1) {
    hash ^= context.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * Loads saved content and migrates legacy notes and shape geometry without
 * changing the established localStorage namespace.
 */
function loadBoard() {
  try {
    const savedBoard = JSON.parse(localStorage.getItem(BOARD_KEY));
    const rawObjects = Array.isArray(savedBoard?.objects) ? savedBoard.objects : [];
    const snapToGrid = savedBoard?.settings?.snap ?? false;
    const savedFloorPlan = normalizeFloorPlanSettings(savedBoard?.settings?.floorPlan);
    const savedZoom = clamp(
      finiteNumber(savedBoard?.view?.zoom, 1),
      VISUAL_BOARD_MIN_ZOOM,
      VISUAL_BOARD_MAX_ZOOM,
    );
    const objects = rawObjects
      .map((object) => normalizeObject(object, {
        snapToGrid,
        textZoom: savedZoom,
        gridSize: savedFloorPlan.gridSize,
      }))
      .filter(Boolean);
    return {
      version: BOARD_VERSION,
      revision: Math.max(0, Math.floor(finiteNumber(savedBoard?.revision, 0))),
      objects,
      assets: savedBoard?.assets && typeof savedBoard.assets === "object"
        ? savedBoard.assets
        : {},
      rig: normalizeRig(savedBoard?.rig, objects),
      animation: normalizeAnimation(savedBoard?.animation),
      settings: normalizeBoardSettings(savedBoard?.settings),
      view: {
        x: finiteNumber(savedBoard?.view?.x, 0),
        y: finiteNumber(savedBoard?.view?.y, 0),
        zoom: savedZoom,
      },
    };
  } catch (error) {
    console.error("Unable to load the saved visual board.", error);
    return createEmptyBoard();
  }
}

function createEmptyBoard() {
  return {
    version: BOARD_VERSION,
    revision: 0,
    objects: [],
    assets: {},
    rig: createEmptyRig(),
    animation: normalizeAnimation(),
    settings: {
      grid: true,
      snap: false,
      fillColor: "#f7f4ec",
      floorPlan: normalizeFloorPlanSettings(),
      architecture: normalizeArchitectureSettings(),
    },
    view: { x: 0, y: 0, zoom: 1 },
  };
}

function loadVisualBoardLibrary() {
  try {
    return normalizeVisualBoardLibrary(
      JSON.parse(localStorage.getItem(BOARD_LIBRARY_KEY)),
    );
  } catch (error) {
    console.error("Unable to load the Visual Board library.", error);
    return createEmptyVisualBoardLibrary();
  }
}

function saveVisualBoardLibrary() {
  try {
    localStorage.setItem(BOARD_LIBRARY_KEY, JSON.stringify(boardLibrary));
    return true;
  } catch (error) {
    console.error("Unable to save the Visual Board library.", error);
    return false;
  }
}

function normalizeObject(rawObject, options = {}) {
  if (!rawObject || typeof rawObject !== "object") return null;

  const type = rawObject.type === "note" ? "textbox" : rawObject.type;
  const normalizedShadow = normalizeObjectShadow(rawObject.shadow);
  const isLayerDesignator = rawObject.semantic?.role === "floor-plan-layer-designator";
  const supportsArchitecturalStroke = rawObject.semantic?.role === "floor-plan-wall"
    || rawObject.semantic?.role?.startsWith("architecture-")
    || ["area", "wall", "symbol", "dimension"].includes(type);
  const strokeWidth = clamp(
    finiteNumber(rawObject.strokeWidth ?? rawObject.width, 3),
    VISUAL_BOARD_MIN_STROKE_WIDTH,
    supportsArchitecturalStroke ? 240 : 24,
  );
  const common = {
    id: rawObject.id || createId(),
    type,
    color: normalizeHexColor(rawObject.color, "#000000"),
    strokeWidth,
    dashPattern: DASH_PATTERNS.has(rawObject.dashPattern) ? rawObject.dashPattern : "solid",
    ...(normalizeHexColor(rawObject.fillColor)
      ? { fillColor: normalizeHexColor(rawObject.fillColor) }
      : {}),
    ...(normalizeHexColor(rawObject.accentColor)
      ? { accentColor: normalizeHexColor(rawObject.accentColor) }
      : {}),
    fillOpacity: clamp(finiteNumber(rawObject.fillOpacity, 1), 0, 1),
    opacity: clamp(finiteNumber(rawObject.opacity, 1), 0, 1),
    fillPattern: ARCHITECTURE_PATTERNS.has(rawObject.fillPattern)
      ? rawObject.fillPattern
      : "solid",
    ...(typeof rawObject.materialId === "string" && getArchitectureMaterial(rawObject.materialId)
      ? { materialId: rawObject.materialId }
      : {}),
    layerId: normalizeLayerId(rawObject.layerId),
    zIndex: clamp(finiteNumber(rawObject.zIndex, 0), -10_000, 10_000),
    ...(normalizedShadow
      ? { shadow: normalizedShadow }
      : {}),
    ...(rawObject.flipX ? { flipX: true } : {}),
    ...(rawObject.flipY ? { flipY: true } : {}),
    ...(rawObject.hiddenInExport ? { hiddenInExport: true } : {}),
    locked: Boolean(rawObject.locked),
    dimensionsLocked: Boolean(rawObject.dimensionsLocked),
    ...(normalizeObjectSemantic(rawObject.semantic)
      ? { semantic: normalizeObjectSemantic(rawObject.semantic) }
      : {}),
    ...getObjectGroupFields({
      ...rawObject,
      rigidGroup: rawObject.rigidGroup === true
        || Boolean(rawObject.groupId && !rawObject.vertexNetworkId),
    }),
    ...(isLayerDesignator ? normalizeFloorPlanRoomState(rawObject) : {}),
  };

  if (type === "pen") {
    const points = Array.isArray(rawObject.points)
      ? rawObject.points
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
        .map((point) => ({ x: point.x, y: point.y }))
      : [];
    return points.length ? { ...common, points } : null;
  }

  if (CURVE_TYPES.has(type)) {
    const startX = finiteNumber(rawObject.x, 0);
    const startY = finiteNumber(rawObject.y, 0);
    const endX = finiteNumber(rawObject.endX, startX);
    const endY = finiteNumber(rawObject.endY, startY);
    const curve = normalizeCurveGeometry({
      ...common,
      x: startX,
      y: startY,
      midX: finiteNumber(rawObject.midX, (startX + endX) / 2),
      midY: finiteNumber(rawObject.midY, (startY + endY) / 2),
      endX,
      endY,
      curvePoints: rawObject.curvePoints,
      curveHandles: rawObject.curveHandles,
      curveVertexIds: rawObject.curveVertexIds,
    });
    const hasVertexNetwork = typeof rawObject.vertexNetworkId === "string"
      && rawObject.vertexNetworkId
      && Array.isArray(curve.curvePoints)
      && Array.isArray(curve.curveVertexIds)
      && curve.curveVertexIds.length === curve.curvePoints.length
      && curve.curveVertexIds.every((vertexId) => (
        typeof vertexId === "string" && vertexId
      ));
    if (hasVertexNetwork) curve.vertexNetworkId = rawObject.vertexNetworkId;
    else delete curve.curveVertexIds;
    return curve;
  }

  if (type === "trace") {
    const paths = Array.isArray(rawObject.paths)
      ? rawObject.paths
        .map((path) => (
          Array.isArray(path)
            ? path
              .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
              .map((point) => ({ x: point.x, y: point.y }))
            : []
        ))
        .filter((path) => path.length >= 3)
      : [];
    return paths.length
      ? {
        ...common,
        paths,
        name: typeof rawObject.name === "string" ? rawObject.name : "Traced image",
      }
      : null;
  }

  if (LINE_TYPES.has(type)) {
    const hasVertexNetwork = [
      rawObject.vertexNetworkId,
      rawObject.startVertexId,
      rawObject.endVertexId,
    ].every((value) => typeof value === "string" && value);
    return {
      ...common,
      x: finiteNumber(rawObject.x, 0),
      y: finiteNumber(rawObject.y, 0),
      endX: finiteNumber(rawObject.endX, finiteNumber(rawObject.x, 0)),
      endY: finiteNumber(rawObject.endY, finiteNumber(rawObject.y, 0)),
      ...(type === "connector"
        ? {
          arrowStart: Boolean(rawObject.arrowStart),
          arrowEnd: rawObject.arrowEnd !== false,
        }
        : {}),
      ...(type === "dimension"
        ? {
          label: String(rawObject.label ?? "").slice(0, 240),
          offset: clamp(finiteNumber(rawObject.offset, 24), -10_000, 10_000),
          fontSize: clamp(finiteNumber(rawObject.fontSize, 12), 6, 96),
        }
        : {}),
      ...(hasVertexNetwork
        ? {
          vertexNetworkId: rawObject.vertexNetworkId,
          startVertexId: rawObject.startVertexId,
          endVertexId: rawObject.endVertexId,
        }
        : {}),
      ...(typeof rawObject.assemblyId === "string" && rawObject.assemblyId
        ? {
          assemblyId: rawObject.assemblyId,
          assemblyIndex: Math.max(0, Math.floor(finiteNumber(rawObject.assemblyIndex, 0))),
          assemblyCount: Math.max(1, Math.floor(finiteNumber(rawObject.assemblyCount, 1))),
          assemblySource: rawObject.assemblySource && typeof rawObject.assemblySource === "object"
            ? cloneValue(rawObject.assemblySource)
            : null,
        }
        : {}),
    };
  }

  if (type === "area") {
    const vertices = (Array.isArray(rawObject.vertices) ? rawObject.vertices : [])
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: point.x, y: point.y }))
      .slice(0, 256);
    if (vertices.length < 3) return null;
    return normalizeShape({
      ...common,
      x: finiteNumber(rawObject.x, 0),
      y: finiteNumber(rawObject.y, 0),
      w: Math.max(1, finiteNumber(rawObject.w, 100)),
      h: Math.max(1, finiteNumber(rawObject.h, 100)),
      rotation: finiteNumber(rawObject.rotation, 0),
      vertices,
    });
  }

  if (type === "wall") {
    return normalizeShape({
      ...common,
      x: finiteNumber(rawObject.x, 0),
      y: finiteNumber(rawObject.y, 0),
      w: Math.max(1, finiteNumber(rawObject.w, 100)),
      h: Math.max(1, finiteNumber(rawObject.h, strokeWidth)),
      rotation: finiteNumber(rawObject.rotation, 0),
      fillColor: normalizeHexColor(rawObject.fillColor, rawObject.color ?? "#24231f"),
    });
  }

  if (type === "symbol") {
    const symbolId = String(rawObject.symbolId ?? "");
    if (!getArchitectureSymbol(symbolId)) return null;
    return normalizeShape({
      ...common,
      x: finiteNumber(rawObject.x, 0),
      y: finiteNumber(rawObject.y, 0),
      w: Math.max(1, finiteNumber(rawObject.w, 100)),
      h: Math.max(1, finiteNumber(rawObject.h, 100)),
      rotation: finiteNumber(rawObject.rotation, 0),
      symbolId,
      fit: rawObject.fit === "stretch" ? "stretch" : "contain",
    });
  }

  if (type === "rectangle" || type === "ellipse" || type === "shape") {
    if (type === "shape" && !SHAPE_KINDS.has(rawObject.shapeKind)) return null;
    const startX = finiteNumber(rawObject.x, 0);
    const startY = finiteNumber(rawObject.y, 0);
    const legacyEndX = finiteNumber(rawObject.endX, startX + 120);
    const legacyEndY = finiteNumber(rawObject.endY, startY + 80);
    const normalized = normalizeShape({
      ...common,
      x: startX,
      y: startY,
      w: finiteNumber(rawObject.w, legacyEndX - startX),
      h: finiteNumber(rawObject.h, legacyEndY - startY),
      rotation: finiteNumber(rawObject.rotation, 0),
      ...(type === "shape" ? { shapeKind: rawObject.shapeKind } : {}),
    });
    if (normalized.shapeKind === "cube") {
      const defaultDepth = getCubeDepth(
        normalized,
        options.snapToGrid,
        options.gridSize,
      );
      normalized.shapeDepthX = finiteNumber(rawObject.shapeDepthX, defaultDepth);
      normalized.shapeDepthY = finiteNumber(rawObject.shapeDepthY, defaultDepth);
    }
    return normalized;
  }

  if (type === "textbox") {
    const fontFamily = Object.hasOwn(TEXT_FONT_FAMILIES, rawObject.fontFamily)
      ? rawObject.fontFamily
      : "serif";
    const fontSize = clamp(finiteNumber(rawObject.fontSize, 18), 6, 96);
    const scaleMode = rawObject.scaleMode === "screen" ? "screen" : "world";
    const defaultSize = getDefaultTextboxSize(fontSize, options.textZoom, scaleMode);
    const text = typeof rawObject.text === "string" ? rawObject.text : "";
    return normalizeShape({
      ...common,
      x: finiteNumber(rawObject.x, 0),
      y: finiteNumber(rawObject.y, 0),
      w: finiteNumber(rawObject.w ?? rawObject.noteWidth, defaultSize.width),
      h: finiteNumber(rawObject.h ?? rawObject.noteHeight, defaultSize.height),
      rotation: finiteNumber(rawObject.rotation, 0),
      text,
      colorRanges: sanitizeTextColorRanges(rawObject.colorRanges, text.length),
      fontSize,
      fontFamily,
      fontWeight: clamp(
        Math.round(finiteNumber(rawObject.fontWeight, 400) / 100) * 100,
        300,
        800,
      ),
      scaleMode,
      textAlign: ["left", "center", "right"].includes(rawObject.textAlign)
        ? rawObject.textAlign
        : "left",
      verticalAlign: ["top", "middle", "bottom"].includes(rawObject.verticalAlign)
        ? rawObject.verticalAlign
        : "top",
      lineHeight: clamp(finiteNumber(rawObject.lineHeight, 1.25), 0.8, 3),
      padding: clamp(finiteNumber(rawObject.padding, 6), 0, 120),
    });
  }

  if (type === "image" && rawObject.assetId) {
    const sourceWidth = Math.max(0, finiteNumber(rawObject.sourceWidth, 0));
    const sourceHeight = Math.max(0, finiteNumber(rawObject.sourceHeight, 0));
    return normalizeShape({
      ...common,
      x: finiteNumber(rawObject.x, 0),
      y: finiteNumber(rawObject.y, 0),
      w: finiteNumber(rawObject.w, 480),
      h: finiteNumber(rawObject.h, 320),
      rotation: finiteNumber(rawObject.rotation, 0),
      assetId: rawObject.assetId,
      name: typeof rawObject.name === "string" ? rawObject.name : "Dropped image",
      ...(sourceWidth && sourceHeight
        ? {
          sourceWidth,
          sourceHeight,
          crop: rawObject.crop
            ? normalizeImageCrop(rawObject.crop, sourceWidth, sourceHeight)
            : resetImageCrop(sourceWidth, sourceHeight),
        }
        : {}),
      flipX: Boolean(rawObject.flipX),
      flipY: Boolean(rawObject.flipY),
      ...(rawObject.referenceImage
        ? {
          referenceImage: true,
          referenceName: String(rawObject.referenceName ?? rawObject.name ?? "Reference")
            .trim()
            .slice(0, 120),
        }
        : {}),
    });
  }

  return null;
}

function saveBoard() {
  board.view = { ...viewport };
  const previousRevision = board.revision ?? 0;
  const nextContentSignature = getBoardContentSignature(board);
  if (nextContentSignature !== lastSavedBoardContentSignature) {
    board.revision = previousRevision + 1;
  }
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(board));
    lastSavedBoardContentSignature = nextContentSignature;
    saveStatus.textContent = "Saved locally";
    saveStatus.classList.remove("has-error");
    return true;
  } catch (error) {
    board.revision = previousRevision;
    console.error("Unable to save the visual board.", error);
    saveStatus.textContent = "Storage is full";
    saveStatus.classList.add("has-error");
    return false;
  }
}

function scheduleViewSave() {
  window.clearTimeout(viewSaveTimer);
  viewSaveTimer = window.setTimeout(saveBoard, 180);
}

function announceStatus(message) {
  saveStatus.textContent = message;
  window.clearTimeout(announceStatus.timeout);
  announceStatus.timeout = window.setTimeout(() => {
    saveStatus.textContent = "Saved locally";
  }, 1800);
}

function checkpoint() {
  history.push(createBoardHistoryEntry(
    board.objects,
    selectedObjects,
    board.rig,
    { settings: board.settings, view: viewport },
  ));
  if (history.length > HISTORY_LIMIT) history.shift();
  future = [];
  updateHistoryControls();
}

function resizeCanvas() {
  const bounds = canvasFrame.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
  canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;
  drawBoard();
}

function getCanvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function screenToWorld(screenPoint) {
  return {
    x: viewport.x + screenPoint.x / viewport.zoom,
    y: viewport.y + screenPoint.y / viewport.zoom,
  };
}

function worldToScreen(worldPoint) {
  return {
    x: (worldPoint.x - viewport.x) * viewport.zoom,
    y: (worldPoint.y - viewport.y) * viewport.zoom,
  };
}

function getSnappedPoint(point) {
  if (!board.settings.snap) return point;
  const gridSize = getGridSize();
  return {
    x: snapValue(point.x, gridSize),
    y: snapValue(point.y, gridSize),
  };
}

function getGridSize() {
  return board.settings.floorPlan?.enabled
    ? normalizeFloorPlanSettings(board.settings.floorPlan).gridSize
    : GRID_SIZE;
}

function getCubeDepth(object, snapToGrid = false, gridSizeOverride = null) {
  const minimumDimension = Math.min(Math.abs(object.w), Math.abs(object.h));
  if (!snapToGrid) return Math.max(1, minimumDimension * 0.22);
  const gridSize = Number.isFinite(Number(gridSizeOverride))
    ? Math.max(1, Number(gridSizeOverride))
    : getGridSize();
  const gridSizedDimension = Math.max(gridSize * 2, minimumDimension);
  const desiredDepth = snapValue(gridSizedDimension * 0.22, gridSize);
  return clamp(desiredDepth, gridSize, gridSizedDimension - gridSize);
}

function alignCubeToGrid(object) {
  if (object.shapeKind !== "cube" || !board.settings.snap) return object;
  const gridSize = getGridSize();
  object.w = Math.max(gridSize * 2, object.w);
  object.h = Math.max(gridSize * 2, object.h);
  const depth = getCubeDepth(object, true);
  object.shapeDepthX = depth;
  object.shapeDepthY = depth;
  return object;
}

function drawBoard(includeInteractionUi = true) {
  const pixelRatio = window.devicePixelRatio || 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (board.settings.grid) drawGrid(pixelRatio);

  context.setTransform(
    pixelRatio * viewport.zoom,
    0,
    0,
    pixelRatio * viewport.zoom,
    -viewport.x * pixelRatio * viewport.zoom,
    -viewport.y * pixelRatio * viewport.zoom,
  );

  getVisibleBoardObjects().forEach(drawObject);
  if (workingObject) drawObject(workingObject);
  drawAlignmentGuides();

  if (includeInteractionUi) {
    drawMarquee();
    drawSelection();
    drawEraserCursor();
  }

  if (textEditorSession) positionTextEditor();
}

function getVisibleBoardObjects() {
  const pixelRatio = window.devicePixelRatio || 1;
  const visibleLabelIds = getVisibleFloorPlanLabelIds();
  const margin = 180 / viewport.zoom;
  const viewportBounds = {
    x: viewport.x - margin,
    y: viewport.y - margin,
    width: canvas.width / pixelRatio / viewport.zoom + margin * 2,
    height: canvas.height / pixelRatio / viewport.zoom + margin * 2,
  };
  return sortArchitectureObjects(
    board.objects,
    board.settings.architecture,
  ).filter((object) => {
    if (!isFloorPlanObjectVisible(
      object,
      board.objects,
      board.settings.floorPlan,
      { visibleLabelIds },
    )) return false;
    const bounds = getObjectBounds(object);
    return bounds.x <= viewportBounds.x + viewportBounds.width
      && bounds.x + bounds.width >= viewportBounds.x
      && bounds.y <= viewportBounds.y + viewportBounds.height
      && bounds.y + bounds.height >= viewportBounds.y;
  });
}

function getVisibleFloorPlanLabelIds() {
  const visibleIds = new Set(
    selectedObjects
      .filter((object) => object.semantic?.role?.startsWith("floor-plan-labeler"))
      .map((object) => object.semantic?.diagramId ?? object.id),
  );
  if (!hoverPoint) return visibleIds;
  board.objects.forEach((object) => {
    if (
      object.semantic?.role !== "floor-plan-labeler"
      && object.semantic?.role !== "floor-plan-labeler-detection"
    ) return;
    const bounds = getObjectBounds(object);
    if (
      hoverPoint.x >= bounds.x
      && hoverPoint.x <= bounds.x + bounds.width
      && hoverPoint.y >= bounds.y
      && hoverPoint.y <= bounds.y + bounds.height
    ) visibleIds.add(object.semantic?.diagramId ?? object.id);
  });
  return visibleIds;
}

function drawGrid(pixelRatio) {
  const gridSize = getGridSize();
  const cssWidth = canvas.width / pixelRatio;
  const cssHeight = canvas.height / pixelRatio;
  const worldRight = viewport.x + cssWidth / viewport.zoom;
  const worldBottom = viewport.y + cssHeight / viewport.zoom;
  const firstX = Math.floor(viewport.x / gridSize) * gridSize;
  const firstY = Math.floor(viewport.y / gridSize) * gridSize;

  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.lineWidth = 0.7;

  const drawGridTier = (major) => {
    context.beginPath();
    for (let worldX = firstX; worldX <= worldRight; worldX += gridSize) {
      const isMajor = Math.round(worldX / gridSize) % 5 === 0;
      if (isMajor !== major) continue;
      const screenX = (worldX - viewport.x) * viewport.zoom;
      context.moveTo(screenX, 0);
      context.lineTo(screenX, cssHeight);
    }
    for (let worldY = firstY; worldY <= worldBottom; worldY += gridSize) {
      const isMajor = Math.round(worldY / gridSize) % 5 === 0;
      if (isMajor !== major) continue;
      const screenY = (worldY - viewport.y) * viewport.zoom;
      context.moveTo(0, screenY);
      context.lineTo(cssWidth, screenY);
    }
    context.strokeStyle = major ? "rgb(24 23 20 / 12%)" : "rgb(24 23 20 / 5%)";
    context.stroke();
  };

  if (gridSize * viewport.zoom >= 9) drawGridTier(false);
  drawGridTier(true);
  context.restore();
}

function drawObject(object) {
  context.save();
  context.strokeStyle = object.color;
  context.fillStyle = object.color;
  context.lineWidth = object.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalAlpha = object.opacity ?? 1;
  context.setLineDash(getStrokeDashArray(object.dashPattern, object.strokeWidth));
  applyObjectShadow(object);

  if (object.type === "pen") {
    drawPenStroke(object.points);
  } else if (object.type === "trace") {
    drawTracedImage(object);
  } else if (object.type === "line") {
    drawLine(object);
  } else if (object.type === "arc") {
    drawArc(object);
  } else if (object.type === "dimension") {
    drawArchitectureDimension(object);
  } else if (LINE_TYPES.has(object.type)) {
    drawConnector(object);
  } else if (object.type === "shape") {
    drawSegments(getObjectSegments(object));
  } else if (SHAPE_TYPES.has(object.type)) {
    withShapeTransform(object, () => {
      if (object.type === "rectangle") {
        fillRectangleObject(object);
        context.strokeRect(object.x, object.y, object.w, object.h);
      } else if (object.type === "ellipse") {
        context.beginPath();
        context.ellipse(
          object.x + object.w / 2,
          object.y + object.h / 2,
          object.w / 2,
          object.h / 2,
          0,
          0,
          Math.PI * 2,
        );
        fillObjectPath(object);
        context.stroke();
      } else if (object.type === "area") {
        drawArchitectureArea(object);
      } else if (object.type === "wall") {
        fillRectangleObject(object, object.fillColor ?? object.color);
        context.strokeRect(object.x, object.y, object.w, object.h);
      } else if (object.type === "symbol") {
        drawArchitectureSymbol(object);
      } else if (object.type === "textbox") {
        drawTextbox(object);
      } else if (object.type === "image") {
        drawImageObject(object);
      }
    });
  }
  if (
    object.semantic?.role === "floor-plan-dimension"
    && object.type !== "dimension"
  ) {
    drawFloorPlanDimensionLabel(object);
  }
  if (object.semantic?.role === "floor-plan-layer-designator") {
    drawLayerDesignatorControls(object);
  }
  context.restore();
}

function getLayerDesignatorControls(object) {
  const bounds = getObjectBounds(object);
  const height = 24 / viewport.zoom;
  const gap = 3 / viewport.zoom;
  const actionWidth = 24 / viewport.zoom;
  const labelWidth = 78 / viewport.zoom;
  const right = bounds.x + bounds.width;
  const y = bounds.y - height - gap;
  const left = right - labelWidth - actionWidth * 4;
  return [
    {
      action: "up",
      x: left,
      y,
      width: actionWidth,
      height,
    },
    {
      action: "label",
      x: left + actionWidth,
      y,
      width: labelWidth,
      height,
    },
    {
      action: "down",
      x: left + actionWidth + labelWidth,
      y,
      width: actionWidth,
      height,
    },
    {
      action: "add",
      x: right - actionWidth * 2,
      y,
      width: actionWidth,
      height,
    },
    {
      action: "remove",
      x: right - actionWidth,
      y,
      width: actionWidth,
      height,
    },
  ];
}

function drawLayerDesignatorControls(object) {
  const state = normalizeFloorPlanRoomState(object);
  const activeRoom = state.floorPlanRooms.find((room) => (
    room.id === state.activeFloorPlanRoomId
  ));
  const labels = {
    up: "↑",
    label: activeRoom?.name ?? "Level 1",
    down: "↓",
    add: "+",
    remove: "−",
  };
  context.save();
  context.setLineDash([]);
  context.lineWidth = 1 / viewport.zoom;
  context.font = `700 ${10 / viewport.zoom}px Arial, Helvetica, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  getLayerDesignatorControls(object).forEach((control) => {
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#7a7469";
    context.fillRect(control.x, control.y, control.width, control.height);
    context.strokeRect(control.x, control.y, control.width, control.height);
    context.fillStyle = control.action === "remove" ? "#8a2e24" : "#24231f";
    context.fillText(
      labels[control.action],
      control.x + control.width / 2,
      control.y + control.height / 2,
      control.width - 6 / viewport.zoom,
    );
  });
  context.restore();
}

function findLayerDesignatorControlAt(point) {
  return board.objects
    .filter((object) => object.semantic?.role === "floor-plan-layer-designator")
    .reverse()
    .flatMap((object) => getLayerDesignatorControls(object).map((control) => ({
      object,
      ...control,
    })))
    .find((control) => (
      point.x >= control.x
      && point.x <= control.x + control.width
      && point.y >= control.y
      && point.y <= control.y + control.height
    )) ?? null;
}

function applyObjectShadow(object) {
  if (!object.shadow) return;
  context.shadowColor = colorWithOpacity(object.shadow.color, object.shadow.opacity);
  context.shadowBlur = object.shadow.blur;
  context.shadowOffsetX = object.shadow.offsetX;
  context.shadowOffsetY = object.shadow.offsetY;
}

function fillRectangleObject(object, fallbackColor = null) {
  if (!object.fillColor && !fallbackColor) return;
  context.save();
  context.globalAlpha *= object.fillOpacity ?? 1;
  context.fillStyle = getObjectFillStyle(object, fallbackColor);
  context.fillRect(object.x, object.y, object.w, object.h);
  context.restore();
}

function fillObjectPath(object, fallbackColor = null) {
  if (!object.fillColor && !fallbackColor) return;
  context.save();
  context.globalAlpha *= object.fillOpacity ?? 1;
  context.fillStyle = getObjectFillStyle(object, fallbackColor);
  context.fill();
  context.restore();
}

function getObjectFillStyle(object, fallbackColor = null) {
  const fillColor = object.fillColor ?? fallbackColor ?? object.color;
  if (!object.fillPattern || object.fillPattern === "solid") return fillColor;
  return getArchitecturePattern(object.fillPattern, fillColor, object.color) ?? fillColor;
}

function getArchitecturePattern(patternId, fillColor, strokeColor) {
  const key = `${patternId}:${fillColor}:${strokeColor}`;
  if (architecturePatternCache.has(key)) return architecturePatternCache.get(key);
  const tile = document.createElement("canvas");
  tile.width = 24;
  tile.height = 24;
  const tileContext = tile.getContext("2d");
  tileContext.fillStyle = fillColor;
  tileContext.fillRect(0, 0, tile.width, tile.height);
  tileContext.strokeStyle = colorWithOpacity(strokeColor, 0.32);
  tileContext.fillStyle = colorWithOpacity(strokeColor, 0.34);
  tileContext.lineWidth = 1;

  if ([
    "hatch", "crosshatch", "wood", "grass", "water", "stone", "pavers", "tile",
    "brick", "shingle", "marble", "slate", "mulch", "hedge",
  ].includes(patternId)) {
    tileContext.beginPath();
  }
  if (["hatch", "crosshatch"].includes(patternId)) {
    tileContext.moveTo(-6, 24);
    tileContext.lineTo(24, -6);
    tileContext.moveTo(6, 30);
    tileContext.lineTo(30, 6);
    if (patternId === "crosshatch") {
      tileContext.moveTo(-6, 0);
      tileContext.lineTo(24, 30);
      tileContext.moveTo(6, -6);
      tileContext.lineTo(30, 18);
    }
  } else if (patternId === "tile") {
    tileContext.rect(0.5, 0.5, 23, 23);
    tileContext.moveTo(12, 0);
    tileContext.lineTo(12, 24);
    tileContext.moveTo(0, 12);
    tileContext.lineTo(24, 12);
  } else if (patternId === "wood") {
    [5, 12, 19].forEach((y, index) => {
      tileContext.moveTo(0, y);
      tileContext.bezierCurveTo(6, y - 2, 15, y + 2, 24, y);
      if (index === 1) {
        tileContext.ellipse(17, y - 2, 3, 1.5, 0, 0, Math.PI * 2);
      }
    });
  } else if (patternId === "grass") {
    [[4, 20], [10, 13], [17, 22], [21, 9]].forEach(([x, y]) => {
      tileContext.moveTo(x, y);
      tileContext.lineTo(x - 2, y - 5);
      tileContext.moveTo(x, y);
      tileContext.lineTo(x + 2, y - 6);
    });
  } else if (patternId === "water") {
    [6, 14, 22].forEach((y) => {
      tileContext.moveTo(0, y);
      tileContext.bezierCurveTo(5, y - 3, 7, y + 3, 12, y);
      tileContext.bezierCurveTo(17, y - 3, 19, y + 3, 24, y);
    });
  } else if (patternId === "stone") {
    tileContext.moveTo(0, 8);
    tileContext.lineTo(8, 5);
    tileContext.lineTo(15, 9);
    tileContext.lineTo(24, 6);
    tileContext.moveTo(0, 18);
    tileContext.lineTo(6, 14);
    tileContext.lineTo(14, 18);
    tileContext.lineTo(24, 15);
    tileContext.moveTo(8, 5);
    tileContext.lineTo(6, 14);
    tileContext.moveTo(15, 9);
    tileContext.lineTo(14, 18);
  } else if (patternId === "pavers") {
    tileContext.rect(0.5, 0.5, 11, 7);
    tileContext.rect(12.5, 0.5, 11, 7);
    tileContext.rect(-5.5, 8.5, 11, 7);
    tileContext.rect(6.5, 8.5, 11, 7);
    tileContext.rect(18.5, 8.5, 11, 7);
    tileContext.rect(0.5, 16.5, 11, 7);
    tileContext.rect(12.5, 16.5, 11, 7);
  } else if (patternId === "brick") {
    [0.5, 8.5, 16.5].forEach((y, row) => {
      tileContext.moveTo(0, y);
      tileContext.lineTo(24, y);
      const offset = row % 2 ? 0 : 6;
      [offset, offset + 12, offset + 24].forEach((x) => {
        tileContext.moveTo(x, y);
        tileContext.lineTo(x, y + 8);
      });
    });
  } else if (patternId === "shingle") {
    [4, 12, 20].forEach((y, row) => {
      const offset = row % 2 ? 4 : 0;
      for (let x = offset; x < 28; x += 8) {
        tileContext.moveTo(x - 4, y);
        tileContext.quadraticCurveTo(x, y + 5, x + 4, y);
      }
    });
  } else if (patternId === "marble") {
    tileContext.moveTo(-2, 5);
    tileContext.bezierCurveTo(5, 0, 8, 13, 15, 7);
    tileContext.bezierCurveTo(20, 3, 22, 15, 28, 11);
    tileContext.moveTo(3, 24);
    tileContext.bezierCurveTo(8, 17, 14, 23, 22, 16);
  } else if (patternId === "slate") {
    tileContext.rect(0.5, 0.5, 11, 11);
    tileContext.rect(12.5, 0.5, 11, 11);
    tileContext.rect(0.5, 12.5, 11, 11);
    tileContext.rect(12.5, 12.5, 11, 11);
    tileContext.moveTo(0, 12);
    tileContext.lineTo(12, 0);
    tileContext.moveTo(12, 24);
    tileContext.lineTo(24, 12);
  } else if (patternId === "mulch") {
    [[2, 6, 8, 3], [11, 5, 17, 9], [4, 17, 11, 13], [15, 20, 23, 15]]
      .forEach(([x1, y1, x2, y2]) => {
        tileContext.moveTo(x1, y1);
        tileContext.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + 2, x2, y2);
      });
  } else if (patternId === "hedge") {
    [[4, 18], [10, 10], [16, 20], [22, 9]].forEach(([x, y]) => {
      tileContext.moveTo(x, y);
      tileContext.quadraticCurveTo(x - 5, y - 6, x, y - 10);
      tileContext.quadraticCurveTo(x + 5, y - 6, x, y);
    });
  }
  if ([
    "hatch", "crosshatch", "wood", "grass", "water", "stone", "pavers", "tile",
    "brick", "shingle", "marble", "slate", "mulch", "hedge",
  ].includes(patternId)) {
    tileContext.stroke();
  }
  if (["dots", "sand", "asphalt"].includes(patternId)) {
    [[5, 5], [18, 9], [10, 19], [22, 22]].forEach(([x, y]) => {
      tileContext.beginPath();
      tileContext.arc(x, y, patternId === "sand" ? 0.7 : 1.1, 0, Math.PI * 2);
      tileContext.fill();
    });
    if (patternId === "asphalt") {
      tileContext.beginPath();
      tileContext.moveTo(2, 14);
      tileContext.lineTo(7, 12);
      tileContext.moveTo(14, 3);
      tileContext.lineTo(19, 5);
      tileContext.moveTo(15, 19);
      tileContext.lineTo(21, 17);
      tileContext.stroke();
    }
  }
  const pattern = context.createPattern(tile, "repeat");
  architecturePatternCache.set(key, pattern);
  return pattern;
}

function colorWithOpacity(color, opacity) {
  const normalized = normalizeHexColor(color, "#000000");
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgb(${red} ${green} ${blue} / ${clamp(finiteNumber(opacity, 1), 0, 1)})`;
}

function withShapeTransform(object, callback) {
  const center = getShapeCenter(object);
  context.save();
  context.translate(center.x, center.y);
  context.rotate(object.rotation ?? 0);
  context.translate(-center.x, -center.y);
  callback();
  context.restore();
}

function drawArchitectureArea(object) {
  const vertices = object.vertices.map((point) => ({
    x: object.x + point.x * object.w,
    y: object.y + point.y * object.h,
  }));
  if (vertices.length < 3) return;
  context.beginPath();
  context.moveTo(vertices[0].x, vertices[0].y);
  vertices.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  fillObjectPath(object, object.fillColor ?? object.color);
  context.stroke();
}

function drawArchitectureDimension(object) {
  const deltaX = object.endX - object.x;
  const deltaY = object.endY - object.y;
  const length = Math.max(0.001, Math.hypot(deltaX, deltaY));
  const normal = { x: -deltaY / length, y: deltaX / length };
  const offset = object.offset ?? 24;
  const start = {
    x: object.x + normal.x * offset,
    y: object.y + normal.y * offset,
  };
  const end = {
    x: object.endX + normal.x * offset,
    y: object.endY + normal.y * offset,
  };
  const tickSize = Math.max(6, (object.fontSize ?? 12) * 0.55);
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(object.x, object.y);
  context.lineTo(start.x, start.y);
  context.moveTo(object.endX, object.endY);
  context.lineTo(end.x, end.y);
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.moveTo(start.x - normal.x * tickSize, start.y - normal.y * tickSize);
  context.lineTo(start.x + normal.x * tickSize, start.y + normal.y * tickSize);
  context.moveTo(end.x - normal.x * tickSize, end.y - normal.y * tickSize);
  context.lineTo(end.x + normal.x * tickSize, end.y + normal.y * tickSize);
  context.stroke();

  const label = object.label || formatFloorPlanDimension(
    { x: object.x, y: object.y },
    { x: object.endX, y: object.endY },
    board.settings.floorPlan,
  );
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  context.save();
  context.shadowColor = "transparent";
  context.font = `${object.fontSize ?? 12}px Arial, Helvetica, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = context.measureText(label).width + 8;
  context.fillStyle = "#ffffff";
  context.fillRect(center.x - width / 2, center.y - (object.fontSize ?? 12) * 0.7, width, (object.fontSize ?? 12) * 1.4);
  context.fillStyle = object.color;
  context.fillText(label, center.x, center.y);
  context.restore();
}

function drawArchitectureSymbol(object) {
  const definition = getArchitectureSymbol(object.symbolId);
  if (!definition) return;
  const frame = fitArchitectureSymbolFrame(object, definition);
  withObjectFlip(object, () => {
    definition.parts.forEach((part) => drawArchitectureSymbolPart(object, frame, part));
  });
}

function drawArchitectureSymbolPart(object, frame, part) {
  context.save();
  context.setLineDash([]);
  context.lineWidth = Math.max(0.7, (object.strokeWidth ?? 2) * (part.width ?? 1));
  context.strokeStyle = resolveSymbolPaint(part.stroke, object, true);
  context.fillStyle = resolveSymbolPaint(part.fill, object, false);

  if (part.type === "rect" || part.type === "rounded-rect") {
    const x = frame.x + part.x * frame.w;
    const y = frame.y + part.y * frame.h;
    const width = part.w * frame.w;
    const height = part.h * frame.h;
    context.beginPath();
    if (part.type === "rounded-rect") {
      addRoundedRectanglePath(
        x,
        y,
        width,
        height,
        Math.min(width, height) * part.radius,
      );
    } else {
      context.rect(x, y, width, height);
    }
    if (part.fill) context.fill();
    if (part.stroke) context.stroke();
  } else if (part.type === "ellipse") {
    context.beginPath();
    context.ellipse(
      frame.x + (part.x + part.w / 2) * frame.w,
      frame.y + (part.y + part.h / 2) * frame.h,
      part.w * frame.w / 2,
      part.h * frame.h / 2,
      0,
      0,
      Math.PI * 2,
    );
    if (part.fill) context.fill();
    if (part.stroke) context.stroke();
  } else if (part.type === "line") {
    context.beginPath();
    context.moveTo(frame.x + part.x1 * frame.w, frame.y + part.y1 * frame.h);
    context.lineTo(frame.x + part.x2 * frame.w, frame.y + part.y2 * frame.h);
    context.stroke();
  } else if (part.type === "arc") {
    context.beginPath();
    context.arc(
      frame.x + part.cx * frame.w,
      frame.y + part.cy * frame.h,
      part.radius * Math.min(frame.w, frame.h),
      part.startAngle,
      part.endAngle,
    );
    context.stroke();
  } else if (part.type === "polygon") {
    const points = part.points.map(([x, y]) => ({
      x: frame.x + x * frame.w,
      y: frame.y + y * frame.h,
    }));
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.closePath();
    if (part.fill) context.fill();
    if (part.stroke) context.stroke();
  }
  context.restore();
}

function resolveSymbolPaint(token, object, isStroke) {
  if (!token) return "transparent";
  if (token === "primary") {
    return isStroke ? object.color : object.fillColor ?? object.color;
  }
  if (token === "secondary") {
    return isStroke ? object.color : object.fillColor ?? "#eadfca";
  }
  if (token === "accent") return object.accentColor ?? "#9a6a1f";
  const materialValue = getArchitectureMaterial(token);
  if (materialValue) {
    return isStroke ? materialValue.strokeColor : materialValue.fillColor;
  }
  return isStroke ? object.color : object.fillColor ?? "#f7f4ec";
}

function addRoundedRectanglePath(x, y, width, height, radius) {
  const resolvedRadius = clamp(radius, 0, Math.min(width, height) / 2);
  context.moveTo(x + resolvedRadius, y);
  context.lineTo(x + width - resolvedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + resolvedRadius);
  context.lineTo(x + width, y + height - resolvedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - resolvedRadius, y + height);
  context.lineTo(x + resolvedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - resolvedRadius);
  context.lineTo(x, y + resolvedRadius);
  context.quadraticCurveTo(x, y, x + resolvedRadius, y);
  context.closePath();
}

function drawPenStroke(points) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  if (points.length === 1) context.lineTo(points[0].x + 0.01, points[0].y + 0.01);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.stroke();
}

function drawLine(object) {
  context.beginPath();
  context.moveTo(object.x, object.y);
  context.lineTo(object.endX, object.endY);
  context.stroke();
}

function drawArc(object) {
  const segments = getCurveBezierSegments(object);
  if (!segments.length) return;
  context.beginPath();
  context.moveTo(segments[0].start.x, segments[0].start.y);
  segments.forEach((segment) => {
    context.bezierCurveTo(
      segment.control1.x,
      segment.control1.y,
      segment.control2.x,
      segment.control2.y,
      segment.end.x,
      segment.end.y,
    );
  });
  context.stroke();
}

function drawTracedImage(object) {
  context.beginPath();
  object.paths.forEach((path) => {
    context.moveTo(path[0].x, path[0].y);
    path.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.closePath();
  });
  context.fill("evenodd");
}

function drawSegments(segments) {
  context.beginPath();
  segments.forEach(([start, end]) => {
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  });
  context.stroke();
}

function drawConnector(object) {
  const angle = Math.atan2(object.endY - object.y, object.endX - object.x);
  const arrowSize = Math.max(14, object.strokeWidth * 4);
  context.beginPath();
  context.moveTo(object.x, object.y);
  context.lineTo(object.endX, object.endY);
  context.stroke();
  if (object.arrowStart) {
    drawArrowHead(object.x, object.y, angle + Math.PI, arrowSize);
  }
  if (object.arrowEnd !== false) {
    drawArrowHead(object.endX, object.endY, angle, arrowSize);
  }
}

function drawArrowHead(x, y, angle, arrowSize) {
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(
    x - arrowSize * Math.cos(angle - Math.PI / 6),
    y - arrowSize * Math.sin(angle - Math.PI / 6),
  );
  context.lineTo(
    x - arrowSize * Math.cos(angle + Math.PI / 6),
    y - arrowSize * Math.sin(angle + Math.PI / 6),
  );
  context.closePath();
  context.fill();
}

function drawTextbox(object) {
  withObjectFlip(object, () => drawTextboxContent(object));
}

function drawTextboxContent(object) {
  const text = object.text.trim() ? object.text : "blank textbox";
  const isPlaceholder = !object.text.trim();
  const padding = object.padding ?? 6;
  const worldFontSize = getTextWorldFontSize(
    object.fontSize,
    viewport.zoom,
    object.scaleMode,
  );
  context.save();
  if (object.fillColor) {
    context.globalAlpha *= object.fillOpacity ?? 1;
    context.fillStyle = getObjectFillStyle(object);
    context.fillRect(object.x, object.y, object.w, object.h);
    context.globalAlpha = object.opacity ?? 1;
  }
  if (object.semantic?.role === "floor-plan-labeler-text") {
    context.save();
    context.setLineDash([]);
    context.strokeStyle = object.color;
    context.lineWidth = Math.max(1, object.strokeWidth);
    context.strokeRect(object.x, object.y, object.w, object.h);
    context.restore();
  }
  context.beginPath();
  context.rect(object.x, object.y, object.w, object.h);
  context.clip();
  context.font = `${object.fontWeight ?? 400} ${worldFontSize}px ${getTextFontCss(object.fontFamily)}`;
  context.textBaseline = "top";
  const lines = wrapTextTokens(text, Math.max(20, object.w - padding * 2));
  const lineHeight = worldFontSize * (object.lineHeight ?? 1.25);
  const totalHeight = lines.length * lineHeight;
  const contentTop = object.verticalAlign === "middle"
    ? object.y + Math.max(padding, (object.h - totalHeight) / 2)
    : object.verticalAlign === "bottom"
      ? object.y + Math.max(padding, object.h - padding - totalHeight)
      : object.y + padding;
  lines.forEach((line, index) => {
    const lineText = line.tokens.map((token) => token.text).join(" ");
    const lineWidth = context.measureText(lineText).width;
    let cursorX = object.textAlign === "center"
      ? object.x + (object.w - lineWidth) / 2
      : object.textAlign === "right"
        ? object.x + object.w - padding - lineWidth
        : object.x + padding;
    line.tokens.forEach((token, tokenIndex) => {
      if (tokenIndex > 0) {
        cursorX = drawColoredText(
          " ",
          token.start - 1,
          cursorX,
          contentTop + index * lineHeight,
          object,
          isPlaceholder,
        );
      }
      cursorX = drawColoredText(
        token.text,
        token.start,
        cursorX,
        contentTop + index * lineHeight,
        object,
        isPlaceholder,
      );
    });
  });
  context.restore();
}

function getTextFontCss(fontFamily) {
  return TEXT_FONT_FAMILIES[fontFamily] ?? TEXT_FONT_FAMILIES.serif;
}

function wrapTextTokens(text, maximumWidth) {
  const paragraphs = text.split(/\n/);
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
      if (context.measureText(candidate).width > maximumWidth && currentLine.length) {
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

function drawColoredText(text, textStart, x, y, object, isPlaceholder) {
  const segments = isPlaceholder
    ? [{ text, color: "#a7a7a7" }]
    : getTextColorSegments(text, textStart, object.colorRanges, object.color);
  let cursorX = x;
  segments.forEach((segment) => {
    context.fillStyle = segment.color;
    context.fillText(segment.text, cursorX, y);
    cursorX += context.measureText(segment.text).width;
  });
  return cursorX;
}

function drawImageObject(object) {
  const image = getCachedImage(object);
  if (image?.complete && image.naturalWidth) {
    withObjectFlip(object, () => {
      context.drawImage(
        image,
        ...getImageDrawArguments(
          object,
          object.sourceWidth || image.naturalWidth,
          object.sourceHeight || image.naturalHeight,
        ),
      );
    });
    return;
  }

  context.save();
  context.strokeStyle = "#8d8d8d";
  context.lineWidth = 1 / viewport.zoom;
  context.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);
  context.strokeRect(object.x, object.y, object.w, object.h);
  context.fillStyle = "#8d8d8d";
  context.font = `${12 / viewport.zoom}px sans-serif`;
  context.fillText("Loading image…", object.x + 10 / viewport.zoom, object.y + 18 / viewport.zoom);
  context.restore();
}

function withObjectFlip(object, callback) {
  if (!object.flipX && !object.flipY) {
    callback();
    return;
  }
  const center = getShapeCenter(object);
  context.save();
  context.translate(center.x, center.y);
  context.scale(object.flipX ? -1 : 1, object.flipY ? -1 : 1);
  context.translate(-center.x, -center.y);
  callback();
  context.restore();
}

function drawFloorPlanDimensionLabel(object) {
  const center = {
    x: (object.x + object.endX) / 2,
    y: (object.y + object.endY) / 2,
  };
  const label = formatFloorPlanDimension(
    { x: object.x, y: object.y },
    { x: object.endX, y: object.endY },
    board.settings.floorPlan,
  );
  context.save();
  context.setLineDash([]);
  context.font = "12px Arial, Helvetica, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "bottom";
  const width = context.measureText(label).width + 8;
  context.fillStyle = "#ffffff";
  context.fillRect(
    center.x - width / 2,
    center.y - 18,
    width,
    16,
  );
  context.fillStyle = "#24231f";
  context.fillText(label, center.x, center.y - 4);
  context.restore();
}

function drawAlignmentGuides() {
  if (!alignmentGuides.length) return;
  const bounds = canvas.getBoundingClientRect();
  const worldRight = viewport.x + bounds.width / viewport.zoom;
  const worldBottom = viewport.y + bounds.height / viewport.zoom;
  context.save();
  context.strokeStyle = "#23766f";
  context.lineWidth = 1 / viewport.zoom;
  context.setLineDash([5 / viewport.zoom, 4 / viewport.zoom]);
  alignmentGuides.forEach((guide) => {
    context.beginPath();
    if (guide.axis === "vertical") {
      context.moveTo(guide.value, viewport.y);
      context.lineTo(guide.value, worldBottom);
    } else {
      context.moveTo(viewport.x, guide.value);
      context.lineTo(worldRight, guide.value);
    }
    context.stroke();
  });
  context.restore();
}

function getCachedImage(object) {
  const asset = board.assets[object.assetId];
  if (!asset?.dataUrl) return null;
  const existing = imageCache.get(object.assetId);
  if (existing?.source === asset.dataUrl) return existing.image;

  const image = new Image();
  image.addEventListener("load", drawBoard, { once: true });
  image.src = asset.dataUrl;
  imageCache.set(object.assetId, { image, source: asset.dataUrl });
  return image;
}

function drawMarquee() {
  if (interaction?.kind !== "marquee") return;
  if (interaction.lockedClickSelection && !interaction.dragging) return;
  const rectangle = getRectangleFromPoints(interaction.startWorld, interaction.currentWorld);
  context.save();
  context.fillStyle = "rgb(123 33 26 / 8%)";
  context.strokeStyle = "#7b211a";
  context.lineWidth = 1 / viewport.zoom;
  context.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);
  context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  context.restore();
}

function drawSelection() {
  if (!selectedObjects.length) return;

  const vertexNetwork = getSelectedVertexNetwork();
  const selectionUnits = getSelectionUnits(selectedObjects);
  context.save();
  context.strokeStyle = selectedObjects.every((object) => object.locked) ? "#777777" : "#7b211a";
  context.fillStyle = "#ffffff";
  context.lineWidth = 1 / viewport.zoom;
  context.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);

  const showObjectHandles = selectionUnits.length === 1
    && selectionUnits[0].length === 1
    && !vertexNetwork;
  selectionUnits.forEach((unit) => {
    if (unit.length === 1) {
      drawObjectSelection(unit[0], showObjectHandles);
    } else {
      drawGroupSelection(unit, selectionUnits.length === 1);
    }
  });
  const rigJoints = getSelectedRigJoints();
  if (rigJoints.length && !selectedObjects.some((object) => object.locked)) {
    context.setLineDash([]);
    rigJoints.forEach(drawRigJointHandle);
  }
  if (vertexNetwork && !vertexNetwork.objects.some((object) => object.locked)) {
    context.setLineDash([]);
    vertexNetwork.vertices.forEach((vertex) => drawHandle(vertex));
  }
  context.restore();
}

function drawGroupSelection(objects, showHandles) {
  const { frame } = getGroupSelectionGeometry(objects);
  const corners = getShapeCorners(frame);
  strokeSelectionPolygon(Object.values(corners));
  if (!showHandles || objects.some((object) => object.locked)) return;

  const dimensionsLocked = isGroupDimensionsLocked(objects[0].groupId);
  context.setLineDash([]);
  if (!dimensionsLocked) Object.values(corners).forEach((point) => drawHandle(point));
  const rotationHandle = getRotationHandlePoint(frame);
  context.beginPath();
  context.moveTo(corners.ne.x, corners.ne.y);
  context.lineTo(rotationHandle.x, rotationHandle.y);
  context.strokeStyle = "#7b211a";
  context.stroke();
  drawHandle(rotationHandle, true);
}

function getGroupSelectionGeometry(objects) {
  const bounds = getSelectionBounds(objects);
  const displayBounds = padSelectionBounds(
    bounds,
    GROUP_SELECTION_PADDING / viewport.zoom,
  );
  return {
    bounds,
    frame: selectionFrameFromBounds(displayBounds),
  };
}

function selectionFrameFromBounds(bounds) {
  return {
    x: bounds.x,
    y: bounds.y,
    w: bounds.width,
    h: bounds.height,
    rotation: 0,
  };
}

function drawRigJointHandle(point) {
  const radius = (HANDLE_SIZE + 2) / viewport.zoom;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  context.strokeStyle = "#7b211a";
  context.lineWidth = 2 / viewport.zoom;
  context.stroke();
  context.beginPath();
  context.arc(point.x, point.y, 2 / viewport.zoom, 0, Math.PI * 2);
  context.fillStyle = "#7b211a";
  context.fill();
}

function drawObjectSelection(object, showHandles) {
  if (SHAPE_TYPES.has(object.type)) {
    const corners = getShapeCorners(object);
    strokeSelectionPolygon(Object.values(corners));

    if (showHandles && !object.locked) {
      context.setLineDash([]);
      if (!object.dimensionsLocked) {
        Object.values(corners).forEach((point) => drawHandle(point));
      }
      const rotationHandle = getRotationHandlePoint(object);
      context.beginPath();
      context.moveTo(corners.ne.x, corners.ne.y);
      context.lineTo(rotationHandle.x, rotationHandle.y);
      context.strokeStyle = "#7b211a";
      context.stroke();
      drawHandle(rotationHandle, true);
    }
  } else if (CURVE_TYPES.has(object.type)) {
    const bounds = getObjectBounds(object);
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    if (showHandles && !object.locked && !object.dimensionsLocked) {
      context.setLineDash([]);
      getCurveVertices(object).forEach((point) => drawHandle(point));
    }
  } else if (LINE_TYPES.has(object.type)) {
    const padding = Math.max(8 / viewport.zoom, object.strokeWidth / 2 + 4 / viewport.zoom);
    strokeSelectionPolygon(getLineSelectionCorners(object, padding));
    if (showHandles && !object.locked) {
      context.setLineDash([]);
      drawHandle({ x: object.x, y: object.y });
      drawHandle({ x: object.endX, y: object.endY });
    }
  } else {
    const bounds = getObjectBounds(object);
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  if (object.locked) drawLockBadge(getObjectBounds(object));
}

function strokeSelectionPolygon(points) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  context.stroke();
}

function drawHandle(point, isRotationHandle = false) {
  const radius = HANDLE_SIZE / viewport.zoom;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = isRotationHandle ? "#7b211a" : "#ffffff";
  context.fill();
  context.strokeStyle = "#1d1c19";
  context.lineWidth = 1.25 / viewport.zoom;
  context.stroke();
}

function drawLockBadge(bounds) {
  const size = 16 / viewport.zoom;
  const x = bounds.x + bounds.width - size;
  const y = bounds.y - size - 5 / viewport.zoom;
  context.save();
  context.setLineDash([]);
  context.strokeStyle = "#5f5f5f";
  context.fillStyle = "#ffffff";
  context.lineWidth = 1.3 / viewport.zoom;
  context.fillRect(x, y + size * 0.38, size, size * 0.62);
  context.strokeRect(x, y + size * 0.38, size, size * 0.62);
  context.beginPath();
  context.arc(x + size / 2, y + size * 0.42, size * 0.28, Math.PI, 0);
  context.stroke();
  context.restore();
}

function drawEraserCursor() {
  if (activeTool !== "eraser" || !hoverPoint) return;
  const radius = getEraserRadius();
  context.save();
  context.beginPath();
  context.arc(hoverPoint.x, hoverPoint.y, radius, 0, Math.PI * 2);
  context.fillStyle = "rgb(255 255 255 / 65%)";
  context.strokeStyle = "#1d1c19";
  context.lineWidth = 1 / viewport.zoom;
  context.setLineDash([4 / viewport.zoom, 3 / viewport.zoom]);
  context.fill();
  context.stroke();
  context.restore();
}

function getRotationHandlePoint(object) {
  const center = getShapeCenter(object);
  const corner = getShapeCorners(object).ne;
  const deltaX = corner.x - center.x;
  const deltaY = corner.y - center.y;
  const length = Math.max(1, Math.hypot(deltaX, deltaY));
  const offset = ROTATION_HANDLE_OFFSET / viewport.zoom;
  return {
    x: corner.x + deltaX / length * offset,
    y: corner.y + deltaY / length * offset,
  };
}

function getRectangleFromPoints(first, second) {
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

function findObjectAt(point) {
  const padding = 8 / viewport.zoom;
  const visibleLabelIds = getVisibleFloorPlanLabelIds();
  return sortArchitectureObjects(board.objects, board.settings.architecture)
    .reverse()
    .filter((object) => isFloorPlanObjectVisible(
      object,
      board.objects,
      board.settings.floorPlan,
      { visibleLabelIds },
    ))
    .find((object) => pointHitsObject(object, point, padding)) ?? null;
}

function getSelectionUnit(object) {
  if (!object?.groupId) return object ? [object] : [];
  return board.objects.filter((candidate) => candidate.groupId === object.groupId);
}

function expandGroupedObjects(objects) {
  const expanded = new Set(objects);
  const groupIds = new Set(objects.map((object) => object.groupId).filter(Boolean));
  if (groupIds.size) {
    board.objects.forEach((object) => {
      if (groupIds.has(object.groupId)) expanded.add(object);
    });
  }
  return [...expanded];
}

function getSelectedVertexNetwork() {
  if (selectedObjects.some((object) => object.rigidGroup)) return null;
  const networkIds = new Set(
    selectedObjects.map((object) => object.vertexNetworkId).filter(Boolean),
  );
  if (networkIds.size !== 1) return null;
  const networkId = [...networkIds][0];
  if (selectedObjects.some((object) => object.vertexNetworkId !== networkId)) return null;
  const objects = board.objects.filter((object) => object.vertexNetworkId === networkId);
  if (!objects.length) return null;
  return {
    id: networkId,
    objects,
    vertices: getVertexNetworkVertices(objects),
  };
}

function getConstrainedNetworkVertexPoint(objects, vertexId, target) {
  if (!objects.some((object) => object.dimensionsLocked)) return target;
  const original = getVertexNetworkVertices(objects)
    .find((vertex) => vertex.id === vertexId);
  if (!original) return target;
  const constraints = objects.flatMap((object) => {
    if (object.type === "arc") {
      const points = getCurveVertices(object);
      return (object.curveVertexIds ?? []).flatMap((candidateId, index) => {
        if (candidateId !== vertexId) return [];
        return [points[index - 1], points[index + 1]]
          .filter(Boolean)
          .map((neighbor) => ({
            x: neighbor.x,
            y: neighbor.y,
            radius: distanceBetween(original, neighbor),
          }));
      });
    }
    if (object.startVertexId === vertexId) {
      return [{
        x: object.endX,
        y: object.endY,
        radius: distanceBetween(original, { x: object.endX, y: object.endY }),
      }];
    }
    if (object.endVertexId === vertexId) {
      return [{
        x: object.x,
        y: object.y,
        radius: distanceBetween(original, { x: object.x, y: object.y }),
      }];
    }
    return [];
  });
  return resolveConstrainedPoint(target, original, constraints);
}

function getSelectedRigidBodyIds(objects = selectedObjects) {
  return new Set(
    objects
      .filter((object) => object.rigidGroup && object.groupId)
      .map((object) => object.groupId),
  );
}

function getSelectedRigJoints(objects = selectedObjects) {
  return getRigJointsForBodyIds(board.rig, getSelectedRigidBodyIds(objects));
}

function getConnectedRigObjects(objects) {
  const selectedBodyIds = getSelectedRigidBodyIds(objects);
  if (!selectedBodyIds.size) return objects;
  const connectedBodyIds = getConnectedRigBodyIds(board.rig, selectedBodyIds);
  const connectedObjects = board.objects.filter((object) => (
    object.groupId && connectedBodyIds.has(object.groupId)
  ));
  const ungroupedObjects = objects.filter((object) => !object.groupId);
  return [...new Set([...connectedObjects, ...ungroupedObjects])];
}

function isGroupDimensionsLocked(groupId) {
  if (!groupId) return false;
  const rigBody = board.rig.bodies.find((body) => body.id === groupId);
  if (rigBody) return Boolean(rigBody.dimensionsLocked);
  const groupObjects = board.objects.filter((object) => object.groupId === groupId);
  return groupObjects.length > 0
    && groupObjects.every((object) => object.dimensionsLocked);
}

function findSelectionHandle(point) {
  const hitRadius = 11 / viewport.zoom;
  const rigJoint = getSelectedRigJoints().find((joint) => (
    distanceBetween(point, joint) <= hitRadius
  ));
  if (rigJoint && !selectedObjects.some((object) => object.locked)) {
    return { kind: "rig-joint", jointId: rigJoint.id };
  }

  const selectionUnits = getSelectionUnits(selectedObjects);
  const selectedUnit = selectionUnits.length === 1 ? selectionUnits[0] : null;
  if (
    selectedUnit?.length > 1
    && !selectedUnit.some((object) => object.locked)
  ) {
    const { bounds, frame } = getGroupSelectionGeometry(selectedUnit);
    const rotationHandle = getRotationHandlePoint(frame);
    if (distanceBetween(point, rotationHandle) <= hitRadius) {
      return { kind: "group-rotate", objects: selectedUnit, bounds };
    }
    const corner = isGroupDimensionsLocked(selectedUnit[0].groupId)
      ? null
      : Object.entries(getShapeCorners(frame)).find(([, handle]) => (
        distanceBetween(point, handle) <= hitRadius
      ));
    if (corner) {
      const resizeStart = getShapeCorners(selectionFrameFromBounds(bounds))[corner[0]];
      return {
        kind: "group-resize",
        objects: selectedUnit,
        bounds,
        corner: corner[0],
        handleStart: corner[1],
        resizeStart,
      };
    }
  }

  const vertexNetwork = getSelectedVertexNetwork();
  if (vertexNetwork && !vertexNetwork.objects.some((object) => object.locked)) {
    const vertex = vertexNetwork.vertices.find((candidate) => (
      distanceBetween(point, candidate) <= hitRadius
    ));
    if (vertex) {
      return {
        kind: "network-vertex",
        vertexId: vertex.id,
        objects: vertexNetwork.objects,
      };
    }
  }

  if (selectedObjects.length !== 1 || selectedObjects[0].locked) return null;
  const object = selectedObjects[0];

  if (SHAPE_TYPES.has(object.type)) {
    const rotationHandle = getRotationHandlePoint(object);
    if (distanceBetween(point, rotationHandle) <= hitRadius) {
      return { kind: "rotate", object };
    }
    const corners = getShapeCorners(object);
    const corner = object.dimensionsLocked
      ? null
      : Object.entries(corners).find(([, handle]) => (
        distanceBetween(point, handle) <= hitRadius
      ));
    if (corner) return { kind: "resize", object, corner: corner[0] };
  }

  if (CURVE_TYPES.has(object.type) && !object.dimensionsLocked) {
    const vertexIndex = getCurveVertices(object).findIndex((vertex) => (
      distanceBetween(point, vertex) <= hitRadius
    ));
    if (vertexIndex >= 0) return { kind: "curve-vertex", object, vertexIndex };
  }

  if (LINE_TYPES.has(object.type)) {
    if (distanceBetween(point, { x: object.x, y: object.y }) <= hitRadius) {
      return { kind: "endpoint", object, endpoint: "start" };
    }
    if (distanceBetween(point, { x: object.endX, y: object.endY }) <= hitRadius) {
      return { kind: "endpoint", object, endpoint: "end" };
    }
  }

  return null;
}

function handlePointerDown(event) {
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault();
  closeTextEditor();
  canvas.focus({ preventScroll: true });

  const screenPoint = getCanvasPoint(event);
  const worldPoint = screenToWorld(screenPoint);
  hoverPoint = worldPoint;
  const layerControl = activeTool === "select"
    ? findLayerDesignatorControlAt(worldPoint)
    : null;
  if (layerControl && event.button === 0) {
    handleLayerDesignatorAction(layerControl.object, layerControl.action);
    return;
  }
  if (
    curveVertexInsertionActive
    && activeTool === "select"
    && event.button === 0
  ) {
    insertSelectedPathVertexAt(worldPoint);
    return;
  }
  if (activeTool === "bucket" && event.button === 0) {
    paintBucketAt(worldPoint);
    return;
  }
  canvas.setPointerCapture(event.pointerId);

  if (activeTool === "pan" || event.button === 1 || spaceHeld) {
    interaction = {
      kind: "pan",
      pointerId: event.pointerId,
      startScreen: screenPoint,
      startView: { ...viewport },
    };
    updateCanvasCursor();
    return;
  }

  if (activeTool === "select") {
    startSelectionInteraction(event, screenPoint, worldPoint);
    return;
  }

  if (activeTool === "eraser") {
    checkpoint();
    interaction = {
      kind: "erase",
      pointerId: event.pointerId,
      lastWorld: worldPoint,
      changed: eraseBetween(worldPoint, worldPoint),
      historyLength: history.length,
    };
    drawBoard();
    return;
  }

  const drawingPoint = activeTool === "pen" ? worldPoint : getSnappedPoint(worldPoint);
  workingObject = createWorkingObject(activeTool, drawingPoint);
  if (!workingObject) return;
  interaction = {
    kind: "draw",
    pointerId: event.pointerId,
    startWorld: drawingPoint,
  };
  drawBoard();
}

function startSelectionInteraction(event, screenPoint, worldPoint) {
  const handle = findSelectionHandle(worldPoint);
  if (handle) {
    if (handle.kind === "rig-joint") {
      interaction = {
        ...handle,
        pointerId: event.pointerId,
        startWorld: worldPoint,
        initialObjects: cloneValue(board.objects),
        initialRig: cloneValue(board.rig),
        checkpointed: false,
        changed: false,
      };
      return;
    }
    if (["group-resize", "group-rotate"].includes(handle.kind)) {
      const center = {
        x: handle.bounds.x + handle.bounds.width / 2,
        y: handle.bounds.y + handle.bounds.height / 2,
      };
      interaction = {
        ...handle,
        pointerId: event.pointerId,
        startWorld: worldPoint,
        initialBounds: { ...handle.bounds },
        center,
        initialAngle: Math.atan2(
          worldPoint.y - center.y,
          worldPoint.x - center.x,
        ),
        originals: new Map(handle.objects.map((object) => [object.id, cloneValue(object)])),
        checkpointed: false,
        changed: false,
      };
      return;
    }
    if (handle.kind === "network-vertex") {
      interaction = {
        ...handle,
        pointerId: event.pointerId,
        startWorld: worldPoint,
        originals: new Map(handle.objects.map((object) => [object.id, cloneValue(object)])),
        checkpointed: false,
        changed: false,
      };
      return;
    }
    interaction = {
      ...handle,
      pointerId: event.pointerId,
      startWorld: worldPoint,
      initialObject: cloneValue(handle.object),
      initialRotation: handle.object.rotation ?? 0,
      initialAngle: Math.atan2(
        worldPoint.y - getShapeCenter(handle.object).y,
        worldPoint.x - getShapeCenter(handle.object).x,
      ),
      checkpointed: false,
      changed: false,
    };
    return;
  }

  const hitObject = findObjectAt(worldPoint);
  if (hitObject) {
    const selectionUnit = getSelectionUnit(hitObject);
    if (hitObject.locked) {
      interaction = {
        kind: "marquee",
        pointerId: event.pointerId,
        startScreen: screenPoint,
        startWorld: worldPoint,
        currentWorld: worldPoint,
        baseSelection: event.shiftKey ? [...selectedObjects] : [],
        lockedClickSelection: selectionUnit,
        extendSelection: event.shiftKey,
        dragging: false,
      };
      return;
    }

    applySelectionUnit(selectionUnit, event.shiftKey);
    const movableObjects = getConnectedRigObjects(selectedObjects)
      .filter((object) => !object.locked);
    updateSelectionControls();
    drawBoard();
    if (!movableObjects.length) return;

    interaction = {
      kind: "move",
      pointerId: event.pointerId,
      startScreen: screenPoint,
      startWorld: worldPoint,
      initialBounds: getSelectionBounds(movableObjects),
      objects: movableObjects,
      originals: new Map(movableObjects.map((object) => [object.id, cloneValue(object)])),
      initialRig: cloneValue(board.rig),
      movingBodyIds: getConnectedRigBodyIds(
        board.rig,
        getSelectedRigidBodyIds(selectedObjects),
      ),
      checkpointed: false,
      changed: false,
    };
    return;
  }

  const baseSelection = event.shiftKey ? [...selectedObjects] : [];
  if (!event.shiftKey) selectedObjects = [];
  interaction = {
    kind: "marquee",
    pointerId: event.pointerId,
    startScreen: screenPoint,
    startWorld: worldPoint,
    currentWorld: worldPoint,
    baseSelection,
    dragging: true,
  };
  updateSelectionControls();
  drawBoard();
}

function applySelectionUnit(selectionUnit, extendSelection) {
  const unitIsSelected = selectionUnit.every((object) => selectedObjects.includes(object));
  if (!extendSelection) {
    if (!unitIsSelected) selectedObjects = selectionUnit;
    return;
  }
  if (unitIsSelected) {
    const unitIds = new Set(selectionUnit.map((object) => object.id));
    selectedObjects = selectedObjects.filter((object) => !unitIds.has(object.id));
    return;
  }
  selectedObjects = [...new Set([...selectedObjects, ...selectionUnit])];
}

function createWorkingObject(type, startPoint) {
  const common = {
    id: createId(),
    type,
    color: colorInput.value,
    strokeWidth: Number(widthInput.value),
    dashPattern: patternInput.value,
    locked: false,
  };
  if (type === "pen") return { ...common, points: [startPoint] };
  if (type === "arc") {
    return {
      ...common,
      x: startPoint.x,
      y: startPoint.y,
      midX: startPoint.x,
      midY: startPoint.y,
      endX: startPoint.x,
      endY: startPoint.y,
    };
  }
  if (type === "line" || type === "connector") {
    return {
      ...common,
      x: startPoint.x,
      y: startPoint.y,
      endX: startPoint.x,
      endY: startPoint.y,
      ...(type === "connector" ? { arrowStart: false, arrowEnd: true } : {}),
    };
  }
  if (type === "rectangle" || type === "ellipse" || type.startsWith("shape:")) {
    return {
      ...common,
      type: type.startsWith("shape:") ? "shape" : type,
      x: startPoint.x,
      y: startPoint.y,
      w: 0,
      h: 0,
      rotation: 0,
      ...(type.startsWith("shape:") ? { shapeKind: type.slice("shape:".length) } : {}),
    };
  }
  if (type === "textbox") {
    return {
      ...common,
      color: textColorInput.value,
      x: startPoint.x,
      y: startPoint.y,
      w: 0,
      h: 0,
      rotation: 0,
      text: "",
      fontSize: clamp(Number(textSizeInput.value), 8, 96),
      fontFamily: textFontInput.value,
    };
  }
  return null;
}

function handlePointerMove(event) {
  const screenPoint = getCanvasPoint(event);
  const worldPoint = screenToWorld(screenPoint);
  hoverPoint = worldPoint;

  if (!interaction || interaction.pointerId !== event.pointerId) {
    updateCanvasCursor(worldPoint);
    if (
      activeTool === "eraser"
      || board.objects.some((object) => object.semantic?.role?.startsWith("floor-plan-labeler"))
    ) drawBoard();
    return;
  }

  event.preventDefault();
  if (interaction.kind === "pan") {
    const deltaX = screenPoint.x - interaction.startScreen.x;
    const deltaY = screenPoint.y - interaction.startScreen.y;
    viewport.x = interaction.startView.x - deltaX / viewport.zoom;
    viewport.y = interaction.startView.y - deltaY / viewport.zoom;
    scheduleViewSave();
  } else if (interaction.kind === "draw") {
    updateWorkingObject(worldPoint);
  } else if (interaction.kind === "move") {
    updateMoveInteraction(screenPoint, worldPoint);
  } else if (interaction.kind === "resize") {
    ensureInteractionCheckpoint();
    const resized = alignCubeToGrid(resizeShapeFromCorner(
      interaction.initialObject,
      interaction.corner,
      getSnappedPoint(worldPoint),
      MIN_SHAPE_SIZE,
    ));
    replaceObjectProperties(interaction.object, resized);
    interaction.changed = true;
  } else if (interaction.kind === "rotate") {
    ensureInteractionCheckpoint();
    const center = getShapeCenter(interaction.initialObject);
    const currentAngle = Math.atan2(worldPoint.y - center.y, worldPoint.x - center.x);
    interaction.object.rotation = interaction.initialRotation + currentAngle - interaction.initialAngle;
    interaction.changed = true;
  } else if (interaction.kind === "group-resize") {
    ensureInteractionCheckpoint();
    const resizePoint = mapPaddedResizePointer(
      worldPoint,
      interaction.handleStart,
      interaction.resizeStart,
    );
    const resized = resizeSelectionObjects(
      [...interaction.originals.values()],
      interaction.initialBounds,
      interaction.corner,
      getSnappedPoint(resizePoint),
      MIN_SHAPE_SIZE,
    );
    replaceInteractionObjects(resized.objects);
    interaction.changed = true;
  } else if (interaction.kind === "group-rotate") {
    ensureInteractionCheckpoint();
    const currentAngle = Math.atan2(
      worldPoint.y - interaction.center.y,
      worldPoint.x - interaction.center.x,
    );
    const rotated = rotateSelectionObjects(
      [...interaction.originals.values()],
      interaction.center,
      currentAngle - interaction.initialAngle,
    );
    replaceInteractionObjects(rotated);
    interaction.changed = true;
  } else if (interaction.kind === "endpoint") {
    ensureInteractionCheckpoint();
    const target = getSnappedPoint(worldPoint);
    const point = interaction.initialObject.dimensionsLocked
      ? getLengthLockedEndpointPoint(interaction, target)
      : target;
    if (interaction.endpoint === "start") {
      interaction.object.x = point.x;
      interaction.object.y = point.y;
    } else {
      interaction.object.endX = point.x;
      interaction.object.endY = point.y;
    }
    interaction.changed = true;
  } else if (interaction.kind === "curve-vertex") {
    ensureInteractionCheckpoint();
    const point = getSnappedPoint(worldPoint);
    setCurveVertexPosition(interaction.object, interaction.vertexIndex, point);
    interaction.changed = true;
  } else if (interaction.kind === "network-vertex") {
    ensureInteractionCheckpoint();
    restoreInteractionOriginals();
    const target = getSnappedPoint(worldPoint);
    setVertexNetworkPosition(
      interaction.objects,
      interaction.vertexId,
      getConstrainedNetworkVertexPoint(
        interaction.objects,
        interaction.vertexId,
        target,
      ),
    );
    interaction.changed = true;
  } else if (interaction.kind === "rig-joint") {
    ensureInteractionCheckpoint();
    const result = dragRigJoint(
      interaction.initialObjects,
      interaction.initialRig,
      interaction.jointId,
      getSnappedPoint(worldPoint),
    );
    replaceInteractionObjects(result.objects);
    board.rig = result.rig;
    interaction.changed = true;
  } else if (interaction.kind === "erase") {
    interaction.changed = eraseBetween(interaction.lastWorld, worldPoint) || interaction.changed;
    interaction.lastWorld = worldPoint;
  } else if (interaction.kind === "marquee") {
    if (
      interaction.lockedClickSelection
      && distanceBetween(interaction.startScreen, screenPoint) < MARQUEE_DRAG_THRESHOLD
    ) {
      return;
    }
    interaction.dragging = true;
    interaction.currentWorld = worldPoint;
    const rectangle = getRectangleFromPoints(interaction.startWorld, interaction.currentWorld);
    const enclosed = getMarqueeSelectionCandidates(
      board.objects,
      rectangle,
      { includeLocked: !interaction.lockedClickSelection },
    );
    selectedObjects = expandGroupedObjects([...new Set([...interaction.baseSelection, ...enclosed])]);
    updateSelectionControls();
  }

  updateCanvasCursor(worldPoint);
  drawBoard();
}

function getLengthLockedEndpointPoint(endpointInteraction, target) {
  const source = endpointInteraction.initialObject;
  const movingStart = endpointInteraction.endpoint === "start";
  const original = movingStart
    ? { x: source.x, y: source.y }
    : { x: source.endX, y: source.endY };
  const anchor = movingStart
    ? { x: source.endX, y: source.endY }
    : { x: source.x, y: source.y };
  return resolveConstrainedPoint(target, original, [{
    ...anchor,
    radius: distanceBetween(original, anchor),
  }]);
}

function updateWorkingObject(worldPoint) {
  if (!workingObject) return;
  if (workingObject.type === "pen") {
    const previousPoint = workingObject.points.at(-1);
    if (distanceBetween(previousPoint, worldPoint) >= 0.8 / viewport.zoom) {
      workingObject.points.push(worldPoint);
    }
    return;
  }

  const point = getSnappedPoint(worldPoint);
  if (CURVE_TYPES.has(workingObject.type)) {
    workingObject.endX = point.x;
    workingObject.endY = point.y;
    const deltaX = point.x - interaction.startWorld.x;
    const deltaY = point.y - interaction.startWorld.y;
    const length = Math.hypot(deltaX, deltaY);
    workingObject.midX = interaction.startWorld.x + deltaX / 2
      + (length ? deltaY / length : 0) * length * 0.24;
    workingObject.midY = interaction.startWorld.y + deltaY / 2
      - (length ? deltaX / length : 0) * length * 0.24;
  } else if (LINE_TYPES.has(workingObject.type)) {
    workingObject.endX = point.x;
    workingObject.endY = point.y;
  } else {
    workingObject.w = point.x - interaction.startWorld.x;
    workingObject.h = point.y - interaction.startWorld.y;
  }
}

function updateMoveInteraction(screenPoint, worldPoint) {
  const screenDistance = distanceBetween(interaction.startScreen, screenPoint);
  if (screenDistance < 2 && !interaction.changed) return;
  ensureInteractionCheckpoint();
  restoreInteractionOriginals();
  board.rig = cloneValue(interaction.initialRig);

  let deltaX = worldPoint.x - interaction.startWorld.x;
  let deltaY = worldPoint.y - interaction.startWorld.y;
  if (board.settings.snap) {
    const gridSize = getGridSize();
    deltaX = snapValue(interaction.initialBounds.x + deltaX, gridSize) - interaction.initialBounds.x;
    deltaY = snapValue(interaction.initialBounds.y + deltaY, gridSize) - interaction.initialBounds.y;
  }
  const movingIds = new Set(interaction.objects.map((object) => object.id));
  const candidateBounds = {
    ...interaction.initialBounds,
    x: interaction.initialBounds.x + deltaX,
    y: interaction.initialBounds.y + deltaY,
  };
  const alignment = getMoveAlignmentSnap(
    candidateBounds,
    board.objects
      .filter((object) => !movingIds.has(object.id))
      .map(getObjectBounds),
    8 / viewport.zoom,
    board.settings,
  );
  deltaX += alignment.deltaX;
  deltaY += alignment.deltaY;
  alignmentGuides = alignment.guides;

  interaction.objects.filter((object) => !object.locked).forEach((object) => {
    moveObject(object, deltaX, deltaY);
  });
  board.rig.joints.forEach((joint) => {
    if (!joint.bodyIds.some((bodyId) => interaction.movingBodyIds.has(bodyId))) return;
    joint.x += deltaX;
    joint.y += deltaY;
  });
  interaction.changed = true;
}

function ensureInteractionCheckpoint() {
  if (interaction.checkpointed) return;
  checkpoint();
  interaction.checkpointed = true;
}

function restoreInteractionOriginals() {
  interaction.originals.forEach((snapshot, id) => {
    const object = board.objects.find((candidate) => candidate.id === id);
    if (object) replaceObjectProperties(object, cloneValue(snapshot));
  });
}

function replaceInteractionObjects(objects) {
  objects.forEach((source) => {
    const target = board.objects.find((object) => object.id === source.id);
    if (target) replaceObjectProperties(target, source);
  });
}

function replaceObjectProperties(target, source) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, source);
}

function moveObject(object, deltaX, deltaY) {
  if (object.type === "pen") {
    object.points.forEach((point) => {
      point.x += deltaX;
      point.y += deltaY;
    });
    return;
  }
  if (object.type === "trace") {
    object.paths.flat().forEach((point) => {
      point.x += deltaX;
      point.y += deltaY;
    });
    return;
  }
  if (CURVE_TYPES.has(object.type)) {
    replaceObjectProperties(
      object,
      transformCurveGeometry(object, (point) => ({
        x: point.x + deltaX,
        y: point.y + deltaY,
      })),
    );
    return;
  }
  object.x += deltaX;
  object.y += deltaY;
  if (LINE_TYPES.has(object.type)) {
    object.endX += deltaX;
    object.endY += deltaY;
  }
}

function handlePointerUp(event) {
  finishPointerInteraction(event, false);
}

function handlePointerCancel(event) {
  finishPointerInteraction(event, true);
}

function finishPointerInteraction(event, cancelled) {
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!interaction || interaction.pointerId !== event.pointerId) return;

  const finishedInteraction = interaction;
  interaction = null;
  alignmentGuides = [];

  if (finishedInteraction.kind === "draw") {
    if (!cancelled) commitWorkingObject();
    workingObject = null;
  } else if (finishedInteraction.kind === "erase") {
    if (finishedInteraction.changed) {
      selectedObjects = selectedObjects.filter((object) => board.objects.includes(object));
      saveBoard();
      updateSelectionControls();
    } else {
      history.pop();
      updateHistoryControls();
    }
  } else if ([
    "move",
    "resize",
    "rotate",
    "group-resize",
    "group-rotate",
    "endpoint",
    "curve-vertex",
    "network-vertex",
    "rig-joint",
  ].includes(finishedInteraction.kind)) {
    if (
      finishedInteraction.kind === "network-vertex"
      && finishedInteraction.changed
      && !cancelled
    ) {
      const mergeDistance = finishedInteraction.objects.some((object) => (
        object.dimensionsLocked
      ))
        ? VERTEX_TOUCH_TOLERANCE
        : VERTEX_DROP_MERGE_RADIUS / viewport.zoom;
      const merged = mergeVertexNetworkVertexAtNearest(
        finishedInteraction.objects,
        finishedInteraction.vertexId,
        mergeDistance,
      );
      if (merged) announceStatus("Overlapping vertices merged");
    }
    if (finishedInteraction.changed) saveBoard();
  } else if (
    finishedInteraction.kind === "marquee"
    && !cancelled
    && finishedInteraction.lockedClickSelection
    && !finishedInteraction.dragging
  ) {
    applySelectionUnit(
      finishedInteraction.lockedClickSelection,
      finishedInteraction.extendSelection,
    );
  } else if (finishedInteraction.kind === "pan") {
    saveBoard();
  }

  updateSelectionControls();
  updateCanvasCursor();
  drawBoard();
}

function commitWorkingObject() {
  if (!workingObject) return;
  let object = workingObject;

  if (SHAPE_TYPES.has(object.type)) object = alignCubeToGrid(normalizeShape(object));
  if (object.type === "textbox" && (object.w < 8 || object.h < 8)) {
    const defaultSize = getDefaultTextboxSize(
      object.fontSize,
      viewport.zoom,
      object.scaleMode,
    );
    object.w = defaultSize.width;
    object.h = defaultSize.height;
  }

  const bounds = getObjectBounds(object);
  const isValid = object.type === "pen"
    || object.type === "textbox"
    || bounds.width > 3
    || bounds.height > 3;
  if (!isValid) return;

  checkpoint();
  assignFloorPlanRoomToObjects([object], {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
  board.objects.push(object);
  selectedObjects = [object];
  saveBoard();
  updateSelectionControls();
  const keepsCreationToolActive = object.type === "pen"
    || LINE_TYPES.has(object.type)
    || CURVE_TYPES.has(object.type)
    || ["rectangle", "ellipse", "shape"].includes(object.type);
  if (!keepsCreationToolActive) setActiveTool("select");

  if (object.type === "textbox") {
    window.setTimeout(() => openTextEditor(object, false), 0);
  }
}

function getEraserRadius() {
  return Math.max(10, Number(widthInput.value) * 2.5);
}

function eraseBetween(start, end) {
  const radius = getEraserRadius();
  const distance = distanceBetween(start, end);
  const steps = Math.max(1, Math.ceil(distance / Math.max(2, radius * 0.45)));
  let changed = false;
  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    changed = eraseAt({
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    }, radius) || changed;
  }
  return changed;
}

function eraseAt(point, radius) {
  let changed = false;
  const nextObjects = [];

  board.objects.forEach((object) => {
    const fragments = eraseObjectNear(object, point, radius, createId);
    if (fragments.length !== 1 || fragments[0] !== object) changed = true;
    nextObjects.push(...fragments);
  });

  if (changed) {
    board.objects = nextObjects;
    board.rig = normalizeRig(board.rig, board.objects);
  }
  return changed;
}

function undo() {
  closeTextEditor();
  const snapshot = history.pop();
  if (!snapshot) return;
  future.push(createBoardHistoryEntry(
    board.objects,
    selectedObjects,
    board.rig,
    { settings: board.settings, view: viewport },
  ));
  const restored = restoreBoardHistoryEntry(snapshot, normalizeObject);
  board.objects = restored.objects;
  board.rig = normalizeRig(restored.rig, board.objects);
  if (restored.settings) board.settings = normalizeBoardSettings(restored.settings);
  if (restored.view) viewport = { ...restored.view };
  selectedObjects = restored.selectedObjects;
  resetPendingStyleChanges();
  saveBoard();
  updateHistoryControls();
  updateSelectionControls();
  updateViewControls();
  drawBoard();
}

function redo() {
  closeTextEditor();
  const snapshot = future.pop();
  if (!snapshot) return;
  history.push(createBoardHistoryEntry(
    board.objects,
    selectedObjects,
    board.rig,
    { settings: board.settings, view: viewport },
  ));
  const restored = restoreBoardHistoryEntry(snapshot, normalizeObject);
  board.objects = restored.objects;
  board.rig = normalizeRig(restored.rig, board.objects);
  if (restored.settings) board.settings = normalizeBoardSettings(restored.settings);
  if (restored.view) viewport = { ...restored.view };
  selectedObjects = restored.selectedObjects;
  resetPendingStyleChanges();
  saveBoard();
  updateHistoryControls();
  updateSelectionControls();
  updateViewControls();
  drawBoard();
}

function updateHistoryControls() {
  const undoButton = document.querySelector("#undo-board");
  const redoButton = document.querySelector("#redo-board");
  undoButton.disabled = history.length === 0;
  redoButton.disabled = future.length === 0;
  undoButton.title = history.length ? `Undo · ${history.length} stored actions` : "Nothing to undo";
  redoButton.title = future.length ? `Redo · ${future.length} stored actions` : "Nothing to redo";
}

function resetPendingStyleChanges() {
  colorChangeActive = false;
  fillChangeActive = false;
  widthChangeActive = false;
  textColorChangeActive = false;
}

function setZoom(nextZoom, anchorScreenPoint = null) {
  const bounds = canvas.getBoundingClientRect();
  const anchor = anchorScreenPoint ?? { x: bounds.width / 2, y: bounds.height / 2 };
  const worldAtAnchor = screenToWorld(anchor);
  viewport.zoom = clamp(nextZoom, VISUAL_BOARD_MIN_ZOOM, VISUAL_BOARD_MAX_ZOOM);
  viewport.x = worldAtAnchor.x - anchor.x / viewport.zoom;
  viewport.y = worldAtAnchor.y - anchor.y / viewport.zoom;
  document.querySelector("#zoom-value").textContent = `${Math.round(viewport.zoom * 100)}%`;
  scheduleViewSave();
  drawBoard();
}

function handleWheel(event) {
  event.preventDefault();
  const anchor = getCanvasPoint(event);
  if (event.ctrlKey || event.metaKey) {
    const zoomFactor = Math.exp(-event.deltaY * 0.01);
    setZoom(viewport.zoom * zoomFactor, anchor);
    return;
  }
  viewport.x += event.deltaX / viewport.zoom;
  viewport.y += event.deltaY / viewport.zoom;
  scheduleViewSave();
  drawBoard();
}

function toggleAnimationPanel(forceOpen = !animationPanelOpen) {
  animationPanelOpen = Boolean(forceOpen);
  if (animationPanelOpen && boardLibraryPanelOpen) toggleBoardLibraryPanel(false);
  if (animationPanelOpen && floorPlanPanelOpen) toggleFloorPlanPanel(false);
  if (!animationPanelOpen) {
    stopAnimationPlayback();
    exitAnimationPreviewFullscreen();
  }
  toolWorkspace.classList.toggle("is-animation-open", animationPanelOpen);
  animationPanel.classList.toggle("is-open", animationPanelOpen);
  animationPanel.setAttribute("aria-hidden", String(!animationPanelOpen));
  animationPanel.inert = !animationPanelOpen;
  animationToggleButton.setAttribute("aria-expanded", String(animationPanelOpen));
  animationToggleButton.classList.toggle("is-active", animationPanelOpen);
  if (animationPanelOpen) {
    ensureSelectedAnimationFrame();
    renderAnimationPanel();
    animationPreview.focus({ preventScroll: true });
  }
}

function toggleBoardLibraryPanel(forceOpen = !boardLibraryPanelOpen) {
  boardLibraryPanelOpen = Boolean(forceOpen);
  if (boardLibraryPanelOpen && animationPanelOpen) toggleAnimationPanel(false);
  if (boardLibraryPanelOpen && floorPlanPanelOpen) toggleFloorPlanPanel(false);
  toolWorkspace.classList.toggle("is-library-open", boardLibraryPanelOpen);
  boardLibraryPanel.setAttribute("aria-hidden", String(!boardLibraryPanelOpen));
  boardLibraryPanel.inert = !boardLibraryPanelOpen;
  boardLibraryToggleButton.setAttribute("aria-expanded", String(boardLibraryPanelOpen));
  boardLibraryToggleButton.classList.toggle("is-active", boardLibraryPanelOpen);
  if (!boardLibraryPanelOpen) return;

  renderBoardLibrary();
  const focusTarget = selectedObjects.length
    ? boardLibrarySaveSelectionButton
    : boardLibrarySearch;
  focusTarget.focus({ preventScroll: true });
}

function assignFloorPlanRoomToObjects(objects, point) {
  const designator = [...board.objects].reverse().find((object) => {
    if (object.semantic?.role !== "floor-plan-layer-designator") return false;
    const bounds = getObjectBounds(object);
    return point.x >= bounds.x
      && point.x <= bounds.x + bounds.width
      && point.y >= bounds.y
      && point.y <= bounds.y + bounds.height;
  });
  if (!designator) return;
  const state = normalizeFloorPlanRoomState(designator);
  objects.forEach((object) => {
    if (object.semantic?.role === "floor-plan-layer-designator") return;
    object.semantic = {
      ...(object.semantic ?? {}),
      referenceId: designator.id,
      roomId: state.activeFloorPlanRoomId,
    };
  });
}

function requestFloorPlanRemovalPassword(itemName) {
  const entered = window.prompt(`Enter the removal password for "${itemName}".`);
  if (entered === null) return false;
  if (!hasFloorPlanRemovalPassword(entered)) {
    announceStatus("Incorrect removal password");
    return false;
  }
  return true;
}

function handleLayerDesignatorAction(object, action) {
  if (object.locked) {
    announceStatus("Unlock the layer designator first");
    return;
  }
  if (action === "up" || action === "down") {
    const currentState = normalizeFloorPlanRoomState(object);
    const nextState = moveFloorPlanRoom(object, action === "up" ? 1 : -1);
    if (nextState.activeFloorPlanRoomId === currentState.activeFloorPlanRoomId) {
      announceStatus(action === "up" ? "Already at the highest level" : "Already at the lowest level");
      return;
    }
    checkpoint();
    Object.assign(object, nextState);
    saveBoard();
    drawBoard();
    return;
  }
  if (action === "add") {
    const state = normalizeFloorPlanRoomState(object);
    const usedLevels = new Set(state.floorPlanRooms.map((room) => room.level));
    let suggestedLevel = 1;
    while (usedLevels.has(suggestedLevel)) suggestedLevel += 1;
    const enteredLevel = window.prompt(
      "Level number (negative values are allowed)",
      String(suggestedLevel),
    );
    if (enteredLevel === null) return;
    const trimmedLevel = enteredLevel.trim();
    if (!/^-?\d+$/.test(trimmedLevel)) {
      announceStatus("Enter a whole level number from -99 to 99");
      return;
    }
    try {
      const next = addFloorPlanRoom(object, Number(trimmedLevel), createId);
      const { room, ...layerState } = next;
      checkpoint();
      Object.assign(object, layerState);
      selectedObjects = [object];
      saveBoard();
      updateSelectionControls();
      drawBoard();
      announceStatus(`${room.name} added`);
    } catch (error) {
      announceStatus(error.message || "The level could not be added");
    }
    return;
  }
  if (action !== "remove") return;
  const state = normalizeFloorPlanRoomState(object);
  const activeRoom = state.floorPlanRooms.find((room) => (
    room.id === state.activeFloorPlanRoomId
  ));
  if (!requestFloorPlanRemovalPassword(activeRoom?.name ?? "current floor")) return;
  try {
    const next = removeActiveFloorPlanRoom(object);
    const { removedRoomId, ...layerState } = next;
    checkpoint();
    Object.assign(object, layerState);
    const deletedIds = new Set(
      board.objects
        .filter((candidate) => (
          candidate.semantic?.referenceId === object.id
          && candidate.semantic?.roomId === removedRoomId
        ))
        .map((candidate) => candidate.id),
    );
    board.objects = board.objects.filter((candidate) => !deletedIds.has(candidate.id));
    board.rig = normalizeRig(board.rig, board.objects);
    selectedObjects = [object];
    saveBoard();
    updateSelectionControls();
    drawBoard();
    announceStatus(`${activeRoom?.name ?? "Level"} removed`);
  } catch (error) {
    announceStatus(error.message || "The level could not be removed");
  }
}

function toggleFloorPlanPanel(forceOpen = !floorPlanPanelOpen) {
  floorPlanPanelOpen = Boolean(forceOpen);
  if (floorPlanPanelOpen && animationPanelOpen) toggleAnimationPanel(false);
  if (floorPlanPanelOpen && boardLibraryPanelOpen) toggleBoardLibraryPanel(false);
  board.settings.floorPlan = normalizeFloorPlanSettings({
    ...board.settings.floorPlan,
    enabled: floorPlanPanelOpen,
  });
  toolWorkspace.classList.toggle("is-floor-plan-open", floorPlanPanelOpen);
  floorPlanPanel.setAttribute("aria-hidden", String(!floorPlanPanelOpen));
  floorPlanPanel.inert = !floorPlanPanelOpen;
  floorPlanToggleButton.setAttribute("aria-expanded", String(floorPlanPanelOpen));
  floorPlanToggleButton.classList.toggle("is-active", floorPlanPanelOpen);
  syncFloorPlanControls();
  renderFloorPlanCatalog();
  saveBoard();
  drawBoard();
  if (floorPlanPanelOpen) {
    floorPlanPanel.querySelector("button, input, select")?.focus({ preventScroll: true });
  }
}

function renderFloorPlanCatalog() {
  floorPlanTabs.forEach((button) => {
    const selected = button.dataset.floorPlanTab === activeFloorPlanTab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  const roomsActive = activeFloorPlanTab === "rooms";
  floorPlanElementsSection.hidden = roomsActive;
  floorPlanTemplatesSection.hidden = !roomsActive;
  floorPlanElementsSection.setAttribute(
    "aria-labelledby",
    `floor-plan-tab-${activeFloorPlanTab}`,
  );
  floorPlanElementsTitle.textContent = {
    structures: "Structures",
    maintenance: "Maintenance",
    furniture: "Furniture",
  }[activeFloorPlanTab] ?? "Structures";

  renderFloorPlanCatalogSection(
    "element",
    "tools",
    floorPlanToolsList,
    floorPlanRestorableTools,
  );
  if (!roomsActive) {
    renderFloorPlanCatalogSection(
      "element",
      activeFloorPlanTab,
      floorPlanElementList,
      floorPlanRestorableElements,
    );
  }
  renderFloorPlanCatalogSection(
    "template",
    "rooms",
    floorPlanTemplateList,
    floorPlanRestorableTemplates,
  );
  floorPlanSaveElementButton.disabled = selectedObjects.length === 0;
  floorPlanSaveTemplateButton.disabled = selectedObjects.length === 0;
  clearFillButton.disabled = !selectedObjects.some((object) => (
    !object.locked && canReceiveFill(object) && object.fillColor
  ));
}

function setActiveFloorPlanTab(tab, focus = false) {
  if (!["structures", "maintenance", "furniture", "rooms"].includes(tab)) return;
  activeFloorPlanTab = tab;
  renderFloorPlanCatalog();
  if (focus) {
    floorPlanTabs.find((button) => button.dataset.floorPlanTab === tab)
      ?.focus({ preventScroll: true });
  }
}

function renderFloorPlanCatalogSection(catalogType, group, list, restorableList) {
  const config = getFloorPlanCatalogConfig(catalogType);
  const catalog = getFloorPlanTemplateCatalog(
    board.settings.floorPlan?.[config.settingKey],
    config.builtInIds,
  ).map((item) => getFloorPlanDisplayCatalogItem(item, catalogType));
  list.replaceChildren(
    ...catalog
      .filter((item) => item.visible && item.group === group)
      .map((item) => createFloorPlanCatalogCard(item, catalogType)),
  );
  restorableList.replaceChildren(
    ...catalog
      .filter((item) => !item.visible && item.group === group)
      .map((item) => createRestorableFloorPlanCatalogItem(item, catalogType)),
  );
}

function getFloorPlanDisplayCatalogItem(item, catalogType) {
  const definitionValue = catalogType === "element"
    ? getFloorPlanElementDefinition(item.id)
    : getFloorPlanTemplateDefinition(item.id);
  return {
    ...item,
    name: item.source === "built-in" && definitionValue
      ? definitionValue.name
      : item.name,
    group: item.category
      || definitionValue?.group
      || (catalogType === "template" ? "rooms" : "structures"),
  };
}

function createFloorPlanCatalogCard(item, catalogType) {
  const config = getFloorPlanCatalogConfig(catalogType);
  const card = document.createElement("div");
  card.className = "floor-plan-template-card";
  card.dataset[config.datasetId] = item.id;

  const copy = document.createElement("div");
  copy.className = "floor-plan-template-card-copy";
  const name = document.createElement("strong");
  name.textContent = item.name;
  const metadata = document.createElement("span");
  metadata.textContent = item.source === "built-in"
    ? "Built in"
    : `${item.source === "override" ? "Customized default" : `My ${config.singular}`} · ${item.objectCount} objects`;
  copy.append(name, metadata);

  const actions = document.createElement("div");
  actions.className = "floor-plan-template-card-actions";
  actions.append(
    createFloorPlanCatalogAction("insert", item.id, "Insert", catalogType),
    ...(item.editable
      ? [createFloorPlanCatalogAction("edit", item.id, "Edit", catalogType)]
      : []),
    createFloorPlanCatalogAction("replace", item.id, "Replace", catalogType),
    ...(item.source === "override"
      ? [createFloorPlanCatalogAction("restore", item.id, "Restore", catalogType)]
      : []),
    createFloorPlanCatalogAction("remove", item.id, "Remove", catalogType),
  );
  card.append(copy, actions);
  return card;
}

function createRestorableFloorPlanCatalogItem(item, catalogType) {
  const row = document.createElement("div");
  row.className = "floor-plan-restorable-item";
  const name = document.createElement("span");
  name.textContent = `${item.name} removed`;
  row.append(name, createFloorPlanCatalogAction("restore", item.id, "Restore", catalogType));
  return row;
}

function createFloorPlanCatalogAction(action, itemId, label, catalogType) {
  const config = getFloorPlanCatalogConfig(catalogType);
  const button = document.createElement("button");
  button.type = "button";
  button.dataset[config.datasetAction] = action;
  button.dataset[config.datasetId] = itemId;
  button.textContent = label;
  button.title = `${label} ${formatCatalogName(itemId)}`;
  return button;
}

function getFloorPlanCatalogConfig(catalogType) {
  if (catalogType === "element") {
    return {
      singular: "element",
      plural: "elements",
      settingKey: "elementLibrary",
      builtInIds: FLOOR_PLAN_ELEMENTS,
      list: floorPlanElementList,
      restorableList: floorPlanRestorableElements,
      saveButton: floorPlanSaveElementButton,
      datasetAction: "floorElementAction",
      datasetId: "floorElementId",
    };
  }
  return {
    singular: "template",
    plural: "templates",
    settingKey: "templateLibrary",
    builtInIds: FLOOR_PLAN_TEMPLATES,
    list: floorPlanTemplateList,
    restorableList: floorPlanRestorableTemplates,
    saveButton: floorPlanSaveTemplateButton,
    datasetAction: "floorTemplateAction",
    datasetId: "floorTemplateId",
  };
}

function formatCatalogName(value) {
  return String(value)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function syncFloorPlanControls() {
  const settings = normalizeFloorPlanSettings(board.settings.floorPlan);
  floorPlanUnits.value = settings.units;
  floorPlanScale.value = String(settings.pixelsPerUnit);
  floorPlanWallThickness.value = String(settings.wallThickness);
  floorPlanGridSize.value = String(settings.gridSize);
  floorPlanGuides.checked = settings.alignmentGuides;
  floorPlanDimensionsVisible.checked = settings.dimensionsVisible;
  floorPlanLabelsVisible.checked = settings.labelsAlwaysVisible;
}

function updateFloorPlanSettings() {
  board.settings.floorPlan = normalizeFloorPlanSettings({
    ...board.settings.floorPlan,
    enabled: floorPlanPanelOpen,
    units: floorPlanUnits.value,
    pixelsPerUnit: floorPlanScale.value,
    wallThickness: floorPlanWallThickness.value,
    gridSize: floorPlanGridSize.value,
    alignmentGuides: floorPlanGuides.checked,
    dimensionsVisible: floorPlanDimensionsVisible.checked,
    labelsAlwaysVisible: floorPlanLabelsVisible.checked,
  });
  syncFloorPlanControls();
  if (!board.settings.floorPlan.dimensionsVisible) {
    selectedObjects = selectedObjects.filter((object) => (
      object.type !== "dimension"
      && object.semantic?.role !== "floor-plan-dimension"
    ));
    updateSelectionControls();
  }
  saveBoard();
  drawBoard();
}

function insertSavedFloorPlanCatalogItem(catalogType, itemId) {
  const config = getFloorPlanCatalogConfig(catalogType);
  const library = board.settings.floorPlan?.[config.settingKey];
  const catalogItem = getFloorPlanTemplateCatalog(
    library,
    config.builtInIds,
  )
    .map((item) => getFloorPlanDisplayCatalogItem(item, catalogType))
    .find((item) => item.id === itemId && item.visible);
  if (!catalogItem) return;

  const origin = getCanvasCenterWorldPoint();
  const record = getFloorPlanTemplateRecord(
    library,
    itemId,
    config.builtInIds,
  );
  try {
    const created = record
      ? instantiateCharacter(record.character, createId, origin).objects
      : catalogType === "element"
        ? createFloorPlanElement(
          itemId,
          origin,
          normalizeFloorPlanSettings(board.settings.floorPlan),
          createId,
        )
        : createFloorPlanTemplate(
          itemId,
          origin,
          normalizeFloorPlanSettings(board.settings.floorPlan),
          createId,
        );
    const objects = created.map((object) => normalizeObject(object)).filter(Boolean);
    if (!objects.length) {
      throw new CharacterFileError(`This ${config.singular} has no usable objects.`);
    }
    assignFloorPlanRoomToObjects(objects, origin);
    checkpoint();
    board.objects.push(...objects);
    selectedObjects = objects;
    saveBoard();
    updateSelectionControls();
    drawBoard();
    announceStatus(`${catalogItem.name} inserted`);
  } catch (error) {
    console.error(`Unable to insert floor-plan ${config.singular} ${itemId}.`, error);
    announceStatus(`The floor-plan ${config.singular} could not be inserted`);
  }
}

function openFloorPlanBuildingBlockDialog(
  catalogType,
  mode,
  itemId = null,
  returnFocus = null,
) {
  const config = getFloorPlanCatalogConfig(catalogType);
  if (mode === "create" && !selectedObjects.length) return;
  const record = itemId
    ? getFloorPlanTemplateRecord(
      board.settings.floorPlan?.[config.settingKey],
      itemId,
      config.builtInIds,
    )
    : null;
  if (mode === "edit" && !record) return;

  floorPlanTemplateDialogState = {
    catalogType,
    mode,
    itemId,
    category: catalogType === "template"
      ? "rooms"
      : record?.category || activeFloorPlanTab,
  };
  floorPlanTemplateReturnFocus = returnFocus || document.activeElement;
  floorPlanTemplateError.hidden = true;
  floorPlanTemplateError.textContent = "";
  floorPlanTemplateDialogTitle.textContent = mode === "edit"
    ? `Edit floor-plan ${config.singular}`
    : `Save floor-plan ${config.singular}`;
  floorPlanTemplateDialogCopy.textContent = mode === "edit"
    ? `Change how this reusable building block appears in your ${config.singular} list.`
    : `The selected editable objects will become a reusable floor-plan ${config.singular}.`;
  floorPlanTemplateConfirm.textContent = mode === "edit"
    ? "Save changes"
    : `Save ${config.singular}`;
  floorPlanTemplateName.value = record?.name || `Custom ${config.singular} ${
    board.settings.floorPlan[config.settingKey].items
      .filter((item) => !item.replacesBuiltIn).length + 1
  }`;
  floorPlanTemplateDescription.value = record?.description || "";
  floorPlanTemplateDialog.showModal();
  floorPlanTemplateName.focus();
  floorPlanTemplateName.select();
}

function closeFloorPlanTemplateDialog() {
  floorPlanTemplateDialog.close("cancelled");
}

function restoreFloorPlanTemplateDialogFocus() {
  const returnFocus = floorPlanTemplateReturnFocus;
  floorPlanTemplateDialogState = null;
  floorPlanTemplateReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

function createFloorPlanCharacterFromSelection(name, catalogType) {
  const config = getFloorPlanCatalogConfig(catalogType);
  if (!selectedObjects.length) {
    throw new CharacterFileError("Select editable floor-plan objects first.");
  }
  if (selectedObjects.some((object) => object.type === "image" || object.assetId)) {
    throw new CharacterFileError(
      `Floor-plan ${config.plural} are vector-only. Save image-backed selections to the Board Library.`,
    );
  }
  return createCharacterPackage(
    board.objects,
    board.assets,
    board.rig,
    selectedObjects.map((object) => object.id),
    name,
  );
}

function saveFloorPlanBuildingBlockDialog(event) {
  event.preventDefault();
  if (!floorPlanTemplateDialogState) return;
  const config = getFloorPlanCatalogConfig(floorPlanTemplateDialogState.catalogType);
  const name = floorPlanTemplateName.value.trim();
  if (!name) {
    floorPlanTemplateName.focus();
    return;
  }
  const description = floorPlanTemplateDescription.value.trim();
  try {
    const currentLibrary = board.settings.floorPlan[config.settingKey];
    const nextLibrary = floorPlanTemplateDialogState.mode === "edit"
      ? updateFloorPlanTemplate(
        currentLibrary,
        floorPlanTemplateDialogState.itemId,
        {
          name,
          description,
          category: floorPlanTemplateDialogState.category,
        },
        config.builtInIds,
      )
      : addFloorPlanTemplate(
        currentLibrary,
        createFloorPlanTemplateRecord(
          createFloorPlanCharacterFromSelection(
            name,
            floorPlanTemplateDialogState.catalogType,
          ),
          {
            id: createId(),
            name,
            description,
            category: floorPlanTemplateDialogState.category,
            createdAt: Date.now(),
          },
        ),
        config.builtInIds,
      );
    checkpoint();
    board.settings.floorPlan = normalizeFloorPlanSettings({
      ...board.settings.floorPlan,
      [config.settingKey]: nextLibrary,
    });
    if (!saveBoard()) {
      throw new CharacterFileError(`The ${config.singular} could not be saved locally.`);
    }
    floorPlanTemplateDialog.close("saved");
    renderFloorPlanCatalog();
    announceStatus(`${name} saved as a floor-plan ${config.singular}`);
  } catch (error) {
    console.error(`Unable to save floor-plan ${config.singular}.`, error);
    floorPlanTemplateError.textContent = error instanceof CharacterFileError
      || error instanceof TypeError
      ? error.message
      : `The floor-plan ${config.singular} could not be saved.`;
    floorPlanTemplateError.hidden = false;
  }
}

function replaceSavedFloorPlanCatalogItem(catalogType, itemId) {
  const config = getFloorPlanCatalogConfig(catalogType);
  if (!selectedObjects.length) {
    announceStatus("Select the replacement floor-plan objects first");
    return;
  }
  const item = getFloorPlanTemplateCatalog(
    board.settings.floorPlan?.[config.settingKey],
    config.builtInIds,
  )
    .map((candidate) => getFloorPlanDisplayCatalogItem(candidate, catalogType))
    .find((candidate) => candidate.id === itemId);
  if (!item || !window.confirm(`Replace "${item.name}" with the current selection?`)) return;
  try {
    const nextLibrary = replaceFloorPlanTemplate(
      board.settings.floorPlan[config.settingKey],
      itemId,
      createFloorPlanCharacterFromSelection(item.name, catalogType),
      {
        id: createId(),
        name: item.name,
        category: item.group,
        updatedAt: Date.now(),
      },
      config.builtInIds,
    );
    checkpoint();
    board.settings.floorPlan = normalizeFloorPlanSettings({
      ...board.settings.floorPlan,
      [config.settingKey]: nextLibrary,
    });
    saveBoard();
    renderFloorPlanCatalog();
    announceStatus(`${item.name} replaced from the current selection`);
  } catch (error) {
    console.error(`Unable to replace floor-plan ${config.singular} ${itemId}.`, error);
    announceStatus(error.message || `The floor-plan ${config.singular} could not be replaced`);
  }
}

function removeSavedFloorPlanCatalogItem(catalogType, itemId) {
  const config = getFloorPlanCatalogConfig(catalogType);
  const item = getFloorPlanTemplateCatalog(
    board.settings.floorPlan?.[config.settingKey],
    config.builtInIds,
  )
    .map((candidate) => getFloorPlanDisplayCatalogItem(candidate, catalogType))
    .find((candidate) => candidate.id === itemId);
  if (!item || !requestFloorPlanRemovalPassword(item.name)) {
    return;
  }
  checkpoint();
  const nextLibrary = removeFloorPlanTemplate(
    board.settings.floorPlan[config.settingKey],
    itemId,
    config.builtInIds,
  );
  board.settings.floorPlan = normalizeFloorPlanSettings({
    ...board.settings.floorPlan,
    [config.settingKey]: nextLibrary,
  });
  saveBoard();
  renderFloorPlanCatalog();
  announceStatus(`${item.name} removed`);
}

function restoreSavedFloorPlanCatalogItem(catalogType, itemId) {
  const config = getFloorPlanCatalogConfig(catalogType);
  checkpoint();
  const nextLibrary = restoreBuiltInFloorPlanTemplate(
    board.settings.floorPlan[config.settingKey],
    itemId,
    config.builtInIds,
  );
  board.settings.floorPlan = normalizeFloorPlanSettings({
    ...board.settings.floorPlan,
    [config.settingKey]: nextLibrary,
  });
  saveBoard();
  renderFloorPlanCatalog();
  announceStatus(`${formatCatalogName(itemId)} restored to its default`);
}

function handleFloorPlanCatalogAction(button, catalogType) {
  const config = getFloorPlanCatalogConfig(catalogType);
  const action = button.dataset[config.datasetAction];
  const itemId = button.dataset[config.datasetId];
  if (action === "insert") insertSavedFloorPlanCatalogItem(catalogType, itemId);
  else if (action === "edit") {
    openFloorPlanBuildingBlockDialog(catalogType, "edit", itemId, button);
  } else if (action === "replace") {
    replaceSavedFloorPlanCatalogItem(catalogType, itemId);
  } else if (action === "remove") {
    removeSavedFloorPlanCatalogItem(catalogType, itemId);
  } else if (action === "restore") {
    restoreSavedFloorPlanCatalogItem(catalogType, itemId);
  }
}

function flipSelection(axis) {
  const targets = getConnectedRigObjects(selectedObjects);
  if (!targets.length || targets.some((object) => object.locked)) {
    announceStatus("Unlock the complete connected selection before flipping");
    return;
  }
  checkpoint();
  const result = flipBoardSelection(targets, board.rig, axis, {
    mirrorText: mirrorTextOnFlip,
  });
  result.objects.forEach((source) => {
    const target = board.objects.find((object) => object.id === source.id);
    if (target) replaceObjectProperties(target, source);
  });
  board.rig = normalizeRig(result.rig, board.objects);
  selectedObjects = result.objects
    .map((object) => board.objects.find((candidate) => candidate.id === object.id))
    .filter(Boolean);
  saveBoard();
  updateSelectionControls();
  drawBoard();
  announceStatus(axis === "horizontal" ? "Selection flipped horizontally" : "Selection flipped vertically");
}

function toggleSelectedArrowStart() {
  const connectors = selectedObjects.filter((object) => (
    object.type === "connector" && !object.locked
  ));
  if (connectors.length !== selectedObjects.length || !connectors.length) return;
  const nextArrowStart = !connectors.every((object) => object.arrowStart);
  checkpoint();
  connectors.forEach((object) => {
    object.arrowStart = nextArrowStart;
    object.arrowEnd = object.arrowEnd !== false;
  });
  saveBoard();
  updateSelectionControls();
  drawBoard();
  announceStatus(nextArrowStart ? "Double-sided arrow enabled" : "Start arrowhead removed");
}

async function openImageEditDialog() {
  const object = selectedObjects.length === 1 && selectedObjects[0].type === "image"
    ? selectedObjects[0]
    : null;
  if (!object || object.locked) return;
  const asset = board.assets[object.assetId];
  if (!asset?.dataUrl) {
    announceStatus("The selected image data is unavailable");
    return;
  }
  let sourceWidth = object.sourceWidth || asset.width;
  let sourceHeight = object.sourceHeight || asset.height;
  if (!sourceWidth || !sourceHeight) {
    try {
      const image = await loadImageSource(asset.dataUrl);
      sourceWidth = image.naturalWidth;
      sourceHeight = image.naturalHeight;
    } catch {
      sourceWidth = object.w;
      sourceHeight = object.h;
    }
  }
  sourceWidth = Math.max(1, sourceWidth);
  sourceHeight = Math.max(1, sourceHeight);
  imageEditSession = {
    objectId: object.id,
    object: cloneValue(object),
    assetId: object.assetId,
    sourceWidth,
    sourceHeight,
    crop: normalizeImageCrop(object.crop, sourceWidth, sourceHeight),
    dataUrl: asset.dataUrl,
    name: asset.name || object.name,
    replacement: null,
  };
  imageCropAspect.value = "free";
  imageWidthInput.value = String(Math.round(Math.abs(object.w)));
  imageHeightInput.value = String(Math.round(Math.abs(object.h)));
  imageRotationInput.value = String(Math.round((object.rotation || 0) * 180 / Math.PI * 100) / 100);
  imageDimensionsLock.checked = true;
  imageReplaceInput.value = "";
  imageEditError.hidden = true;
  imageCropPreview.src = asset.dataUrl;
  imageEditDialog.showModal();
  window.requestAnimationFrame(updateImageCropBox);
}

function closeImageEditDialog() {
  imageEditSession = null;
  if (imageEditDialog.open) imageEditDialog.close();
  editImageButton.focus({ preventScroll: true });
}

function updateImageCropBox() {
  if (!imageEditSession || !imageCropPreview.complete) return;
  const stageBounds = imageCropStage.getBoundingClientRect();
  const imageBounds = imageCropPreview.getBoundingClientRect();
  const crop = normalizeImageCrop(
    imageEditSession.crop,
    imageEditSession.sourceWidth,
    imageEditSession.sourceHeight,
  );
  const left = imageBounds.left - stageBounds.left
    + crop.x / imageEditSession.sourceWidth * imageBounds.width;
  const top = imageBounds.top - stageBounds.top
    + crop.y / imageEditSession.sourceHeight * imageBounds.height;
  imageCropBox.style.left = `${left}px`;
  imageCropBox.style.top = `${top}px`;
  imageCropBox.style.width = `${crop.width / imageEditSession.sourceWidth * imageBounds.width}px`;
  imageCropBox.style.height = `${crop.height / imageEditSession.sourceHeight * imageBounds.height}px`;
}

function updateCropAspect() {
  if (!imageEditSession || imageCropAspect.value === "free") return;
  imageEditSession.crop = cropToAspect(
    imageEditSession.crop,
    Number(imageCropAspect.value),
    imageEditSession.sourceWidth,
    imageEditSession.sourceHeight,
  );
  updateImageCropBox();
}

function beginCropPointerInteraction(event) {
  if (!imageEditSession || event.button !== 0) return;
  event.preventDefault();
  const resizing = event.target instanceof Element
    && Boolean(event.target.closest(".image-crop-handle"));
  const imageBounds = imageCropPreview.getBoundingClientRect();
  const original = cloneValue(imageEditSession.crop);
  imageCropBox.setPointerCapture?.(event.pointerId);

  const move = (moveEvent) => {
    const deltaX = (moveEvent.clientX - event.clientX) / imageBounds.width
      * imageEditSession.sourceWidth;
    const deltaY = (moveEvent.clientY - event.clientY) / imageBounds.height
      * imageEditSession.sourceHeight;
    if (resizing) {
      let width = Math.max(1, original.width + deltaX);
      let height = Math.max(1, original.height + deltaY);
      const aspect = Number(imageCropAspect.value);
      if (Number.isFinite(aspect) && aspect > 0) height = width / aspect;
      imageEditSession.crop = normalizeImageCrop(
        { ...original, width, height },
        imageEditSession.sourceWidth,
        imageEditSession.sourceHeight,
      );
    } else {
      imageEditSession.crop = normalizeImageCrop({
        ...original,
        x: Math.max(0, Math.min(
          imageEditSession.sourceWidth - original.width,
          original.x + deltaX,
        )),
        y: Math.max(0, Math.min(
          imageEditSession.sourceHeight - original.height,
          original.y + deltaY,
        )),
      }, imageEditSession.sourceWidth, imageEditSession.sourceHeight);
    }
    updateImageCropBox();
  };
  const finish = (upEvent) => {
    imageCropBox.removeEventListener("pointermove", move);
    imageCropBox.removeEventListener("pointerup", finish);
    imageCropBox.removeEventListener("pointercancel", finish);
    if (imageCropBox.hasPointerCapture?.(upEvent.pointerId)) {
      imageCropBox.releasePointerCapture(upEvent.pointerId);
    }
  };
  imageCropBox.addEventListener("pointermove", move);
  imageCropBox.addEventListener("pointerup", finish);
  imageCropBox.addEventListener("pointercancel", finish);
}

function moveCropWithKeyboard(event) {
  if (!imageEditSession || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
  const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
  const crop = imageEditSession.crop;
  imageEditSession.crop = normalizeImageCrop({
    ...crop,
    x: Math.max(0, Math.min(imageEditSession.sourceWidth - crop.width, crop.x + deltaX)),
    y: Math.max(0, Math.min(imageEditSession.sourceHeight - crop.height, crop.y + deltaY)),
  }, imageEditSession.sourceWidth, imageEditSession.sourceHeight);
  updateImageCropBox();
}

function updateImageFrameDimension(changedDimension) {
  if (!imageEditSession) return;
  const width = Math.max(1, Number(imageWidthInput.value) || 1);
  const height = Math.max(1, Number(imageHeightInput.value) || 1);
  const previousRatio = Math.abs(imageEditSession.object.w / imageEditSession.object.h) || 1;
  if (imageDimensionsLock.checked) {
    if (changedDimension === "width") imageHeightInput.value = String(Math.round(width / previousRatio));
    else imageWidthInput.value = String(Math.round(height * previousRatio));
  }
  imageEditSession.object.w = Math.max(1, Number(imageWidthInput.value) || 1);
  imageEditSession.object.h = Math.max(1, Number(imageHeightInput.value) || 1);
}

function handleImageEditAction(action) {
  if (!imageEditSession) return;
  if (action === "reset-crop") {
    imageEditSession.crop = resetImageCrop(
      imageEditSession.sourceWidth,
      imageEditSession.sourceHeight,
    );
    imageCropAspect.value = "free";
  } else if (action === "fit") {
    imageEditSession.object = fitFrameToCrop(imageEditSession.object, imageEditSession.crop);
  } else if (action === "fill") {
    imageEditSession.crop = fillCropToFrame(
      imageEditSession.crop,
      imageEditSession.object,
      imageEditSession.sourceWidth,
      imageEditSession.sourceHeight,
    );
  } else if (action === "original") {
    imageEditSession.object.w = imageEditSession.crop.width;
    imageEditSession.object.h = imageEditSession.crop.height;
  } else if (action === "rotate-left" || action === "rotate-right") {
    const direction = action === "rotate-left" ? -1 : 1;
    imageEditSession.object.rotation += direction * Math.PI / 2;
  }
  imageWidthInput.value = String(Math.round(Math.abs(imageEditSession.object.w)));
  imageHeightInput.value = String(Math.round(Math.abs(imageEditSession.object.h)));
  imageRotationInput.value = String(
    Math.round(imageEditSession.object.rotation * 180 / Math.PI * 100) / 100,
  );
  updateImageCropBox();
}

async function replaceEditedImage(file) {
  if (!imageEditSession || !file?.type.startsWith("image/")) return;
  imageEditError.hidden = true;
  try {
    const prepared = await prepareImage(file);
    imageEditSession.crop = mapCropToReplacement(
      imageEditSession.crop,
      imageEditSession.sourceWidth,
      imageEditSession.sourceHeight,
      prepared.width,
      prepared.height,
    );
    imageEditSession.sourceWidth = prepared.width;
    imageEditSession.sourceHeight = prepared.height;
    imageEditSession.dataUrl = prepared.dataUrl;
    imageEditSession.name = prepared.name;
    imageEditSession.replacement = prepared;
    imageCropPreview.src = prepared.dataUrl;
  } catch (error) {
    console.error("Unable to replace the selected image.", error);
    imageEditError.textContent = "That image could not be read.";
    imageEditError.hidden = false;
  }
}

function applyImageEdits(event) {
  event.preventDefault();
  if (!imageEditSession) return;
  const target = board.objects.find((object) => object.id === imageEditSession.objectId);
  if (!target || target.locked) {
    closeImageEditDialog();
    return;
  }
  checkpoint();
  target.x = imageEditSession.object.x;
  target.y = imageEditSession.object.y;
  target.w = Math.max(1, Number(imageWidthInput.value) || imageEditSession.object.w);
  target.h = Math.max(1, Number(imageHeightInput.value) || imageEditSession.object.h);
  target.rotation = Number(imageRotationInput.value || 0) * Math.PI / 180;
  target.sourceWidth = imageEditSession.sourceWidth;
  target.sourceHeight = imageEditSession.sourceHeight;
  target.crop = normalizeImageCrop(
    imageEditSession.crop,
    imageEditSession.sourceWidth,
    imageEditSession.sourceHeight,
  );
  if (imageEditSession.replacement) {
    target.name = imageEditSession.name;
    board.assets[target.assetId] = {
      dataUrl: imageEditSession.dataUrl,
      name: imageEditSession.name,
      width: imageEditSession.sourceWidth,
      height: imageEditSession.sourceHeight,
    };
    imageCache.delete(target.assetId);
  }
  saveBoard();
  updateSelectionControls();
  drawBoard();
  imageEditSession = null;
  imageEditDialog.close();
  editImageButton.focus({ preventScroll: true });
  announceStatus("Image controls applied");
}

function renderBoardLibrary() {
  const total = boardLibrary.items.length;
  boardLibraryTotal.textContent = total === 1 ? "1 saved asset" : `${total} saved assets`;
  boardLibrarySaveSelectionButton.disabled = selectedObjects.length === 0;
  const visibleItems = filterVisualBoardLibraryItems(
    boardLibrary.items,
    boardLibrarySearch.value,
  );
  boardLibraryList.replaceChildren(...visibleItems.map(createBoardLibraryItemElement));
  boardLibraryEmpty.hidden = visibleItems.length > 0;
  boardLibraryEmpty.textContent = total && !visibleItems.length
    ? "No saved artwork matches this search."
    : "Save selected artwork to reuse it with the same groups, vertices, joints, and locks.";
}

function createBoardLibraryItemElement(item) {
  const listItem = document.createElement("li");
  listItem.className = "board-library-item";
  listItem.dataset.libraryItemId = item.id;

  const preview = document.createElement("canvas");
  preview.className = "board-library-preview";
  preview.width = 192;
  preview.height = 156;
  preview.setAttribute("aria-label", `${item.name} preview`);
  drawBoardLibraryPreview(preview, item.character.objects);

  const body = document.createElement("div");
  body.className = "board-library-item-body";
  const name = document.createElement("strong");
  name.className = "board-library-item-name";
  name.textContent = item.name;

  const summary = getVisualBoardLibraryItemSummary(item);
  const metadata = document.createElement("span");
  metadata.className = "board-library-item-meta";
  metadata.textContent = [
    formatLibraryCount(summary.objectCount, "object"),
    formatLibraryCount(summary.groupCount, "group"),
    formatLibraryCount(summary.jointCount, "joint"),
    formatLibraryCount(summary.lockCount, "lock"),
  ].join(" · ");

  const actions = document.createElement("div");
  actions.className = "board-library-item-actions";
  actions.append(
    createBoardLibraryAction("insert", item.id, "Insert", `Insert ${item.name}`),
    createBoardLibraryAction("download", item.id, "↓", `Download ${item.name}`),
    createBoardLibraryAction("delete", item.id, "⌫", `Delete ${item.name}`),
  );
  actions.lastElementChild.classList.add("board-library-delete");
  body.append(name, metadata, actions);
  listItem.append(preview, body);
  return listItem;
}

function createBoardLibraryAction(action, itemId, label, accessibleLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.libraryAction = action;
  button.dataset.libraryItemId = itemId;
  button.textContent = label;
  button.title = accessibleLabel;
  button.setAttribute("aria-label", accessibleLabel);
  return button;
}

function formatLibraryCount(count, singular) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function drawBoardLibraryPreview(preview, objects) {
  const previewContext = preview.getContext("2d");
  const width = preview.width / 2;
  const height = preview.height / 2;
  previewContext.setTransform(2, 0, 0, 2, 0, 0);
  previewContext.fillStyle = "#ffffff";
  previewContext.fillRect(0, 0, width, height);
  if (!objects.length) return;

  const bounds = getSelectionBounds(objects);
  const scale = Math.min(
    (width - 16) / Math.max(1, bounds.width),
    (height - 16) / Math.max(1, bounds.height),
  );
  const offsetX = (width - bounds.width * scale) / 2 - bounds.x * scale;
  const offsetY = (height - bounds.height * scale) / 2 - bounds.y * scale;
  previewContext.save();
  previewContext.translate(offsetX, offsetY);
  previewContext.scale(scale, scale);
  previewContext.lineCap = "round";
  previewContext.lineJoin = "round";

  objects.forEach((object) => {
    previewContext.strokeStyle = object.color || "#171613";
    previewContext.fillStyle = object.color || "#171613";
    previewContext.lineWidth = Math.max(
      0.8 / Math.max(scale, 0.01),
      Math.min(object.strokeWidth || 2, 2.5 / Math.max(scale, 0.01)),
    );
    const segments = getObjectSegments(object);
    if (segments.length) {
      previewContext.beginPath();
      segments.forEach(([start, end]) => {
        previewContext.moveTo(start.x, start.y);
        previewContext.lineTo(end.x, end.y);
      });
      previewContext.stroke();
      return;
    }
    if (object.type === "pen" && object.points?.length) {
      previewContext.beginPath();
      previewContext.moveTo(object.points[0].x, object.points[0].y);
      object.points.slice(1).forEach((point) => previewContext.lineTo(point.x, point.y));
      previewContext.stroke();
      return;
    }

    const objectBounds = getObjectBounds(object);
    previewContext.strokeRect(
      objectBounds.x,
      objectBounds.y,
      objectBounds.width,
      objectBounds.height,
    );
    if (object.type === "image") {
      previewContext.beginPath();
      previewContext.moveTo(objectBounds.x, objectBounds.y);
      previewContext.lineTo(
        objectBounds.x + objectBounds.width,
        objectBounds.y + objectBounds.height,
      );
      previewContext.stroke();
    }
  });
  previewContext.restore();
}

function getSuggestedBoardLibraryName() {
  const namedObject = selectedObjects.find((object) => object.name)?.name
    ?.replace(/\s+trace$/i, "");
  if (namedObject) return namedObject;
  const selectionUnitCount = getSelectionUnits(selectedObjects).length;
  if (selectionUnitCount > 1) return `Board collection ${boardLibrary.items.length + 1}`;
  const selectedObject = selectedObjects[0];
  if (selectedObject?.shapeKind) {
    return `${selectedObject.shapeKind.replaceAll("-", " ")} ${boardLibrary.items.length + 1}`;
  }
  if (selectedObject?.type) {
    return `${selectedObject.type.replaceAll("-", " ")} ${boardLibrary.items.length + 1}`;
  }
  return `Board asset ${boardLibrary.items.length + 1}`;
}

function openBoardLibrarySaveDialog() {
  if (!selectedObjects.length) return;
  boardLibraryDialogReturnFocus = document.activeElement;
  boardLibrarySaveError.hidden = true;
  boardLibrarySaveError.textContent = "";
  boardLibraryNameInput.value = getSuggestedBoardLibraryName();
  boardLibrarySaveDialog.showModal();
  boardLibraryNameInput.focus();
  boardLibraryNameInput.select();
}

function closeBoardLibrarySaveDialog() {
  boardLibrarySaveDialog.close("cancelled");
}

function restoreBoardLibraryDialogFocus() {
  const returnFocus = boardLibraryDialogReturnFocus;
  boardLibraryDialogReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

function saveSelectionToBoardLibrary(event) {
  event.preventDefault();
  if (!selectedObjects.length) {
    boardLibrarySaveError.textContent = "Select artwork before saving it.";
    boardLibrarySaveError.hidden = false;
    return;
  }

  const name = boardLibraryNameInput.value.trim();
  if (!name) {
    boardLibraryNameInput.focus();
    return;
  }

  try {
    const character = createCharacterPackage(
      board.objects,
      board.assets,
      board.rig,
      selectedObjects.map((object) => object.id),
      name,
    );
    const item = createVisualBoardLibraryItem(character, {
      id: createId(),
      name,
      createdAt: Date.now(),
    });
    const previousLibrary = boardLibrary;
    boardLibrary = addVisualBoardLibraryItem(boardLibrary, item);
    if (!saveVisualBoardLibrary()) {
      boardLibrary = previousLibrary;
      throw new CharacterFileError("The library is full. Download or remove saved assets first.");
    }

    boardLibrarySaveDialog.close("saved");
    toggleBoardLibraryPanel(true);
    renderBoardLibrary();
    boardLibraryList
      .querySelector(`[data-library-item-id="${CSS.escape(item.id)}"] [data-library-action="insert"]`)
      ?.focus({ preventScroll: true });
    announceStatus(`${item.name} saved to Board library`);
  } catch (error) {
    console.error("Unable to save selection to the Visual Board library.", error);
    boardLibrarySaveError.textContent = error instanceof CharacterFileError
      ? error.message
      : "This selection could not be saved to the library.";
    boardLibrarySaveError.hidden = false;
  }
}

function insertBoardLibraryItem(itemId) {
  const item = boardLibrary.items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  try {
    const imported = instantiateCharacter(
      item.character,
      createId,
      getCanvasCenterWorldPoint(),
    );
    const importedObjects = imported.objects.map(normalizeObject).filter(Boolean);
    if (!importedObjects.length) {
      throw new CharacterFileError("The saved asset does not contain usable artwork.");
    }
    checkpoint();
    Object.assign(board.assets, imported.assets);
    board.objects.push(...importedObjects);
    board.rig = normalizeRig({
      bodies: [...board.rig.bodies, ...imported.rig.bodies],
      joints: [...board.rig.joints, ...imported.rig.joints],
    }, board.objects);
    selectedObjects = importedObjects;
    saveBoard();
    updateSelectionControls();
    drawBoard();
    announceStatus(`${item.name} inserted with its groups, vertices, and locks`);
    if (window.matchMedia("(max-width: 760px)").matches) toggleBoardLibraryPanel(false);
  } catch (error) {
    console.error(`Unable to insert ${item.name} from the Visual Board library.`, error);
    announceStatus(
      error instanceof CharacterFileError
        ? error.message
        : "The saved asset could not be inserted",
    );
  }
}

function downloadBoardLibraryItem(itemId) {
  const item = boardLibrary.items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  downloadAnimationBlob(
    new Blob([JSON.stringify(item.character, null, 2)], { type: "application/json" }),
    createCharacterFilename(item.name),
  );
  announceStatus(`${item.name} downloaded`);
}

function deleteBoardLibraryItem(itemId) {
  const item = boardLibrary.items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  if (!window.confirm(`Remove "${item.name}" from the Board library?`)) return;

  const previousLibrary = boardLibrary;
  boardLibrary = removeVisualBoardLibraryItem(boardLibrary, itemId);
  if (!saveVisualBoardLibrary()) {
    boardLibrary = previousLibrary;
    announceStatus("The library change could not be saved");
    return;
  }
  renderBoardLibrary();
  announceStatus(`${item.name} removed from Board library`);
}

function handleBoardLibraryAction(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-library-action]");
  if (!button) return;
  const { libraryAction, libraryItemId } = button.dataset;
  if (libraryAction === "insert") insertBoardLibraryItem(libraryItemId);
  else if (libraryAction === "download") downloadBoardLibraryItem(libraryItemId);
  else if (libraryAction === "delete") deleteBoardLibraryItem(libraryItemId);
}

function restoreAnimationLayout() {
  applyAnimationPanelWidth(readLayoutPreference(ANIMATION_PANEL_WIDTH_KEY, 360));
  applyAnimationPreviewHeight(readLayoutPreference(ANIMATION_PREVIEW_HEIGHT_KEY, 210));
}

function readLayoutPreference(key, fallback) {
  try {
    const savedValue = localStorage.getItem(key);
    return savedValue === null || savedValue === ""
      ? fallback
      : finiteNumber(savedValue, fallback);
  } catch {
    return fallback;
  }
}

function saveLayoutPreference(key, value) {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // The board remains usable when private browsing blocks local preferences.
  }
}

function applyAnimationPanelWidth(value, persist = false) {
  const maximum = Math.max(1, Math.floor(toolWorkspace.getBoundingClientRect().width));
  const minimum = Math.min(MIN_ANIMATION_PANEL_WIDTH, maximum);
  const width = clamp(finiteNumber(value, 360), minimum, maximum);
  toolWorkspace.style.setProperty("--animation-panel-width", `${Math.round(width)}px`);
  animationPanelResizeHandle.setAttribute("aria-valuemax", String(maximum));
  animationPanelResizeHandle.setAttribute("aria-valuenow", String(Math.round(width)));
  if (persist) saveLayoutPreference(ANIMATION_PANEL_WIDTH_KEY, width);
  return width;
}

function applyAnimationPreviewHeight(value, persist = false) {
  const panelHeight = Math.floor(animationPanel.getBoundingClientRect().height);
  const maximum = Math.max(
    MIN_ANIMATION_PREVIEW_HEIGHT,
    panelHeight > 0 ? panelHeight - 210 : 420,
  );
  const height = clamp(
    finiteNumber(value, 210),
    MIN_ANIMATION_PREVIEW_HEIGHT,
    maximum,
  );
  animationPanel.style.setProperty("--animation-preview-height", `${Math.round(height)}px`);
  animationPreviewResizeHandle.setAttribute("aria-valuemax", String(maximum));
  animationPreviewResizeHandle.setAttribute("aria-valuenow", String(Math.round(height)));
  if (persist) saveLayoutPreference(ANIMATION_PREVIEW_HEIGHT_KEY, height);
  return height;
}

function getCurrentAnimationPanelWidth() {
  return animationPanel.getBoundingClientRect().width
    || finiteNumber(animationPanelResizeHandle.getAttribute("aria-valuenow"), 360);
}

function getCurrentAnimationPreviewHeight() {
  return animationPreview.getBoundingClientRect().height
    || finiteNumber(animationPreviewResizeHandle.getAttribute("aria-valuenow"), 210);
}

function beginAnimationPanelResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = getCurrentAnimationPanelWidth();
  toolWorkspace.classList.add("is-resizing-animation-panel");
  animationPanelResizeHandle.classList.add("is-resizing");
  animationPanelResizeHandle.setPointerCapture?.(event.pointerId);

  const resize = (moveEvent) => {
    applyAnimationPanelWidth(startWidth + startX - moveEvent.clientX);
  };
  const finish = (upEvent) => {
    const finalWidth = finiteNumber(
      animationPanelResizeHandle.getAttribute("aria-valuenow"),
      startWidth,
    );
    saveLayoutPreference(ANIMATION_PANEL_WIDTH_KEY, finalWidth);
    toolWorkspace.classList.remove("is-resizing-animation-panel");
    animationPanelResizeHandle.classList.remove("is-resizing");
    window.removeEventListener("pointermove", resize);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    window.removeEventListener("mouseup", finish);
    if (
      Number.isInteger(upEvent.pointerId)
      && animationPanelResizeHandle.hasPointerCapture?.(upEvent.pointerId)
    ) {
      animationPanelResizeHandle.releasePointerCapture(upEvent.pointerId);
    }
  };
  window.addEventListener("pointermove", resize);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  window.addEventListener("mouseup", finish);
}

function beginAnimationPreviewResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  const startY = event.clientY;
  const startHeight = getCurrentAnimationPreviewHeight();
  animationPreviewResizeHandle.classList.add("is-resizing");
  animationPreviewResizeHandle.setPointerCapture?.(event.pointerId);

  const resize = (moveEvent) => {
    applyAnimationPreviewHeight(startHeight + moveEvent.clientY - startY);
  };
  const finish = (upEvent) => {
    animationPreviewResizeHandle.classList.remove("is-resizing");
    window.removeEventListener("pointermove", resize);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    window.removeEventListener("mouseup", finish);
    if (
      Number.isInteger(upEvent.pointerId)
      && animationPreviewResizeHandle.hasPointerCapture?.(upEvent.pointerId)
    ) {
      animationPreviewResizeHandle.releasePointerCapture(upEvent.pointerId);
    }
    applyAnimationPreviewHeight(getCurrentAnimationPreviewHeight(), true);
  };
  window.addEventListener("pointermove", resize);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  window.addEventListener("mouseup", finish);
}

function resizeAnimationPanelWithKeyboard(event) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === "ArrowLeft" ? 1 : -1;
  applyAnimationPanelWidth(getCurrentAnimationPanelWidth() + direction * 24, true);
}

function resizeAnimationPreviewWithKeyboard(event) {
  if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === "ArrowDown" ? 1 : -1;
  applyAnimationPreviewHeight(getCurrentAnimationPreviewHeight() + direction * 20, true);
}

async function toggleAnimationPreviewFullscreen() {
  if (
    document.fullscreenElement === animationPreview
    || animationPreview.classList.contains("is-preview-maximized")
  ) {
    exitAnimationPreviewFullscreen();
    return;
  }

  try {
    if (typeof animationPreview.requestFullscreen === "function") {
      await animationPreview.requestFullscreen();
    } else {
      animationPreview.classList.add("is-preview-maximized");
      updateAnimationFullscreenButton();
    }
  } catch {
    animationPreview.classList.add("is-preview-maximized");
    updateAnimationFullscreenButton();
  }
}

function exitAnimationPreviewFullscreen() {
  animationPreview.classList.remove("is-preview-maximized");
  if (document.fullscreenElement === animationPreview) {
    document.exitFullscreen?.()?.catch?.(() => {});
  }
  updateAnimationFullscreenButton();
}

function updateAnimationFullscreenButton() {
  const isFullscreen = document.fullscreenElement === animationPreview
    || animationPreview.classList.contains("is-preview-maximized");
  animationPreviewFullscreenButton.textContent = isFullscreen ? "×" : "⛶";
  animationPreviewFullscreenButton.setAttribute(
    "aria-label",
    isFullscreen ? "Exit fullscreen preview" : "View preview fullscreen",
  );
  animationPreviewFullscreenButton.title = isFullscreen
    ? "Exit fullscreen preview"
    : "View preview fullscreen";
}

function ensureSelectedAnimationFrame() {
  if (board.animation.frames.some((frame) => frame.id === selectedAnimationFrameId)) return;
  selectedAnimationFrameId = board.animation.frames[0]?.id ?? null;
}

function getSelectedAnimationFrame() {
  return board.animation.frames.find((frame) => frame.id === selectedAnimationFrameId) ?? null;
}

function renderAnimationPanel() {
  ensureSelectedAnimationFrame();
  renderAnimationTimeline();
  showAnimationPreview(getSelectedAnimationFrame());

  const frameCount = board.animation.frames.length;
  const playableFrames = getPlayableFrames(board.animation.frames);
  animationFrameTotal.textContent = `${frameCount} frame${frameCount === 1 ? "" : "s"}`;
  animationDurationInput.value = String(board.animation.frameDurationMs);
  animationFpsOutput.textContent = `${formatFramesPerSecond(board.animation.frameDurationMs)} FPS`;
  animationPlayButton.disabled = playableFrames.length < 2;
  animationPreviewPlayButton.disabled = playableFrames.length < 2;
  animationExportButton.disabled = animationExportInProgress || playableFrames.length < 2;
  duplicateAnimationFrameButton.disabled = !getSelectedAnimationFrame()
    || frameCount >= MAX_ANIMATION_FRAMES;
  deleteAnimationFrameButton.disabled = !getSelectedAnimationFrame();
}

function renderAnimationTimeline() {
  animationFrameList.replaceChildren();
  board.animation.frames.forEach((frame, index) => {
    const item = document.createElement("li");
    item.className = "animation-frame-item";
    item.dataset.frameId = frame.id;
    item.classList.toggle("is-selected", frame.id === selectedAnimationFrameId);

    const button = document.createElement("button");
    button.className = "animation-frame-select";
    button.type = "button";
    button.dataset.frameId = frame.id;
    button.setAttribute("aria-label", `Select frame ${index + 1}: ${frame.name}`);
    if (frame.id === selectedAnimationFrameId) button.setAttribute("aria-current", "true");

    const number = document.createElement("span");
    number.className = "animation-frame-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const thumbnail = document.createElement("span");
    thumbnail.className = "animation-frame-thumbnail";
    if (frame.dataUrl) {
      const image = document.createElement("img");
      image.src = frame.dataUrl;
      image.alt = "";
      thumbnail.append(image);
    } else {
      const empty = document.createElement("span");
      empty.textContent = "EMPTY";
      thumbnail.append(empty);
    }

    const name = document.createElement("span");
    name.className = "animation-frame-name";
    name.textContent = frame.name;
    button.append(number, thumbnail, name);
    item.append(button);
    animationFrameList.append(item);

    const nextFrame = board.animation.frames[index + 1];
    if (nextFrame) {
      animationFrameList.append(createInterpolationGap(frame, nextFrame, index));
    }
  });
}

function createInterpolationGap(startFrame, endFrame, startIndex) {
  const gap = document.createElement("li");
  gap.className = "animation-frame-gap";

  const button = document.createElement("button");
  button.className = "animation-chain-button";
  button.type = "button";
  button.textContent = "⛓";
  button.dataset.interpolationStart = startFrame.id;
  button.dataset.interpolationEnd = endFrame.id;
  button.setAttribute(
    "aria-label",
    `Generate in-between frames between frame ${startIndex + 1} and ${startIndex + 2}`,
  );

  const framesAvailable = MAX_ANIMATION_FRAMES - board.animation.frames.length;
  const sourcesReady = Boolean(startFrame.dataUrl && endFrame.dataUrl);
  button.disabled = interpolationInProgress || !sourcesReady || framesAvailable < 1;
  if (!sourcesReady) {
    button.title = "Both adjacent frames need images";
  } else if (framesAvailable < 1) {
    button.title = "Animation frame limit reached";
  } else {
    button.title = "Generate in-between frames";
  }
  gap.append(button);
  return gap;
}

function showAnimationPreview(frame) {
  const frameIndex = frame
    ? board.animation.frames.findIndex((candidate) => candidate.id === frame.id)
    : -1;
  if (frame?.dataUrl) {
    animationPreviewImage.src = frame.dataUrl;
    animationPreviewImage.alt = frame.name;
    animationPreviewImage.hidden = false;
    animationPreviewEmpty.hidden = true;
  } else {
    animationPreviewImage.removeAttribute("src");
    animationPreviewImage.alt = "Selected animation frame";
    animationPreviewImage.hidden = true;
    animationPreviewEmpty.hidden = false;
    animationPreviewEmpty.textContent = frame ? "Empty frame" : "No frames";
  }
  animationPreview.dataset.frameId = frame?.id ?? "";
  animationPreviewCount.textContent = frameIndex >= 0
    ? `${frameIndex + 1} / ${board.animation.frames.length}`
    : `0 / ${board.animation.frames.length}`;
}

function formatFramesPerSecond(frameDurationMs) {
  const framesPerSecond = 1000 / frameDurationMs;
  return framesPerSecond >= 10
    ? String(Math.round(framesPerSecond))
    : framesPerSecond.toFixed(1);
}

function addBlankAnimationFrame() {
  if (board.animation.frames.length >= MAX_ANIMATION_FRAMES) {
    announceStatus(`Animation is limited to ${MAX_ANIMATION_FRAMES} frames`);
    return;
  }
  stopAnimationPlayback();
  const frame = createAnimationFrame(
    createId(),
    board.animation.frames.length,
  );
  board.animation.frames.push(frame);
  selectedAnimationFrameId = frame.id;
  saveBoard();
  renderAnimationPanel();
}

function duplicateSelectedAnimationFrame() {
  const selectedFrame = getSelectedAnimationFrame();
  if (!selectedFrame || board.animation.frames.length >= MAX_ANIMATION_FRAMES) return;
  stopAnimationPlayback();
  const selectedIndex = board.animation.frames.indexOf(selectedFrame);
  const duplicate = {
    ...selectedFrame,
    id: createId(),
    name: `${selectedFrame.name} copy`,
  };
  board.animation.frames.splice(selectedIndex + 1, 0, duplicate);
  selectedAnimationFrameId = duplicate.id;
  saveBoard();
  renderAnimationPanel();
}

function deleteSelectedAnimationFrame() {
  const selectedIndex = board.animation.frames.findIndex(
    (frame) => frame.id === selectedAnimationFrameId,
  );
  if (selectedIndex < 0) return;
  stopAnimationPlayback();
  board.animation.frames.splice(selectedIndex, 1);
  selectedAnimationFrameId = board.animation.frames[
    Math.min(selectedIndex, board.animation.frames.length - 1)
  ]?.id ?? null;
  saveBoard();
  renderAnimationPanel();
}

function selectAnimationFrame(frameId) {
  if (!board.animation.frames.some((frame) => frame.id === frameId)) return;
  stopAnimationPlayback();
  selectedAnimationFrameId = frameId;
  renderAnimationPanel();
}

function toggleAnimationPlayback() {
  if (animationPlaybackTimer !== null) {
    stopAnimationPlayback();
    return;
  }
  const playableFrames = getPlayableFrames(board.animation.frames);
  if (playableFrames.length < 2) return;
  const selectedIndex = playableFrames.findIndex(
    (frame) => frame.id === selectedAnimationFrameId,
  );
  animationPlaybackIndex = selectedIndex >= 0 ? selectedIndex : 0;
  setAnimationPlaybackButtonState(true);
  showAnimationPreview(playableFrames[animationPlaybackIndex]);
  scheduleAnimationPlayback();
}

function scheduleAnimationPlayback() {
  window.clearTimeout(animationPlaybackTimer);
  animationPlaybackTimer = window.setTimeout(() => {
    const playableFrames = getPlayableFrames(board.animation.frames);
    if (playableFrames.length < 2) {
      stopAnimationPlayback();
      return;
    }
    animationPlaybackIndex = (animationPlaybackIndex + 1) % playableFrames.length;
    showAnimationPreview(playableFrames[animationPlaybackIndex]);
    scheduleAnimationPlayback();
  }, board.animation.frameDurationMs);
}

function stopAnimationPlayback() {
  window.clearTimeout(animationPlaybackTimer);
  animationPlaybackTimer = null;
  setAnimationPlaybackButtonState(false);
  showAnimationPreview(getSelectedAnimationFrame());
}

function setAnimationPlaybackButtonState(isPlaying) {
  for (const button of [animationPlayButton, animationPreviewPlayButton]) {
    button.textContent = isPlaying ? "■" : "▶";
    button.setAttribute("aria-label", isPlaying ? "Stop animation" : "Play animation");
    button.title = isPlaying ? "Stop animation" : "Play animation";
    button.setAttribute("aria-pressed", String(isPlaying));
  }
}

function setAnimationFrameDuration(value) {
  board.animation.frameDurationMs = normalizeFrameDuration(value);
  animationDurationInput.value = String(board.animation.frameDurationMs);
  animationFpsOutput.textContent = `${formatFramesPerSecond(board.animation.frameDurationMs)} FPS`;
  saveBoard();
  if (animationPlaybackTimer !== null) scheduleAnimationPlayback();
}

async function exportAnimation() {
  if (animationExportInProgress) return;
  const playableFrames = getPlayableFrames(board.animation.frames);
  if (playableFrames.length < 2) {
    showAnimationExportError("Add at least two image frames before saving an animation.");
    return;
  }

  stopAnimationPlayback();
  animationExportInProgress = true;
  animationExportAbortController = new AbortController();
  animationExportError.hidden = true;
  animationExportProgress.hidden = false;
  animationExportProgressLabel.textContent = "Preparing frames";
  animationExportProgressValue.textContent = "";
  animationExportProgressBar.removeAttribute("value");
  setAnimationExportBusy(true);
  renderAnimationPanel();

  try {
    const result = await recordAnimationVideo({
      frames: playableFrames,
      frameDurationMs: board.animation.frameDurationMs,
      format: animationExportFormat.value,
      signal: animationExportAbortController.signal,
      onProgress: updateAnimationExportProgress,
    });
    downloadAnimationBlob(
      result.blob,
      createAnimationExportFilename(result.extension),
    );
    animationExportProgress.hidden = true;
    announceStatus(`${result.extension.toUpperCase()} animation saved`);
  } catch (error) {
    if (error instanceof AnimationExportError && error.code === "CANCELLED") {
      animationExportProgress.hidden = true;
      announceStatus("Animation export cancelled");
    } else {
      console.error("Unable to export animation.", error);
      animationExportProgress.hidden = true;
      showAnimationExportError(
        error instanceof AnimationExportError
          ? error.message
          : "The animation could not be saved. Try WebM or reduce the frame size.",
      );
    }
  } finally {
    animationExportInProgress = false;
    animationExportAbortController = null;
    setAnimationExportBusy(false);
    renderAnimationPanel();
  }
}

function updateAnimationExportProgress(progress) {
  animationExportProgress.hidden = false;
  animationExportProgressLabel.textContent = progress.phase === "loading"
    ? "Preparing frames"
    : "Rendering video";
  animationExportProgressBar.max = progress.total;
  animationExportProgressBar.value = progress.completed;
  animationExportProgressValue.textContent = `${progress.completed} / ${progress.total}`;
}

function setAnimationExportBusy(isBusy) {
  animationExportFormat.disabled = isBusy;
  animationExportButton.textContent = isBusy ? "Saving…" : "Save animation";
  animationExportCancelButton.disabled = !isBusy;
}

function cancelAnimationExport() {
  if (!animationExportInProgress) return;
  animationExportProgressLabel.textContent = "Cancelling";
  animationExportProgressValue.textContent = "";
  animationExportProgressBar.removeAttribute("value");
  animationExportCancelButton.disabled = true;
  animationExportAbortController?.abort();
}

function showAnimationExportError(message) {
  animationExportError.textContent = message;
  animationExportError.hidden = false;
}

function downloadAnimationBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBoardArtwork() {
  if (!board.objects.length) {
    announceStatus("Add something to the board before exporting");
    return;
  }
  const format = ["svg", "png", "pdf"].includes(boardExportFormat.value)
    ? boardExportFormat.value
    : "svg";
  const originalLabel = boardExportButton.innerHTML;
  boardExportButton.disabled = true;
  boardExportFormat.disabled = true;
  boardExportButton.textContent = "Saving…";

  try {
    const viewBounds = getVisualBoardExportBounds(board, { padding: 32 });
    const title = "Vital Pancakes Visual Board";
    let blob;
    if (format === "svg") {
      blob = new Blob([
        exportVisualBoardToSvg(board, {
          viewBounds,
          width: viewBounds.width,
          height: viewBounds.height,
          backgroundColor: "#ffffff",
          title,
        }),
      ], { type: "image/svg+xml;charset=utf-8" });
    } else {
      const pngBlob = await createBoardPngBlob(viewBounds, title);
      blob = format === "pdf"
        ? await createBoardPdfBlob(pngBlob, viewBounds)
        : pngBlob;
    }
    downloadAnimationBlob(blob, createBoardArtworkFilename(format));
    announceStatus(`${format.toUpperCase()} saved`);
  } catch (error) {
    console.error("Unable to export the Visual Board.", error);
    announceStatus("Board artwork could not be saved");
  } finally {
    boardExportButton.disabled = false;
    boardExportFormat.disabled = false;
    boardExportButton.innerHTML = originalLabel;
  }
}

async function createBoardPngBlob(viewBounds, title) {
  const exportScale = Math.min(
    2,
    MAX_STATIC_EXPORT_DIMENSION / Math.max(viewBounds.width, viewBounds.height),
  );
  const width = Math.max(1, Math.round(viewBounds.width * exportScale));
  const height = Math.max(1, Math.round(viewBounds.height * exportScale));
  const svg = exportVisualBoardToSvg(board, {
    viewBounds,
    width,
    height,
    backgroundColor: "#ffffff",
    title,
  });
  const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await loadImageSource(source);
    const stagingCanvas = document.createElement("canvas");
    stagingCanvas.width = width;
    stagingCanvas.height = height;
    const stagingContext = stagingCanvas.getContext("2d");
    stagingContext.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve, reject) => {
      stagingCanvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed."))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

async function createBoardPdfBlob(pngBlob, viewBounds) {
  const pdfLibrary = await loadPdfLibrary();
  const pdfDocument = await pdfLibrary.PDFDocument.create();
  const embeddedImage = await pdfDocument.embedPng(await pngBlob.arrayBuffer());
  const largestPageDimension = clamp(
    Math.max(viewBounds.width, viewBounds.height),
    144,
    MAX_PDF_PAGE_DIMENSION,
  );
  const pageScale = largestPageDimension / Math.max(viewBounds.width, viewBounds.height);
  const pageWidth = Math.max(1, viewBounds.width * pageScale);
  const pageHeight = Math.max(1, viewBounds.height * pageScale);
  const page = pdfDocument.addPage([pageWidth, pageHeight]);
  page.drawImage(embeddedImage, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });
  return new Blob([await pdfDocument.save()], { type: "application/pdf" });
}

function loadPdfLibrary() {
  if (globalThis.PDFLib?.PDFDocument) return Promise.resolve(globalThis.PDFLib);
  if (loadPdfLibrary.pending) return loadPdfLibrary.pending;
  loadPdfLibrary.pending = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "../vendor/pdf-lib.min.js";
    script.addEventListener("load", () => {
      if (globalThis.PDFLib?.PDFDocument) resolve(globalThis.PDFLib);
      else reject(new Error("The local PDF library did not initialize."));
    }, { once: true });
    script.addEventListener("error", () => {
      reject(new Error("The local PDF library could not be loaded."));
    }, { once: true });
    document.head.append(script);
  }).finally(() => {
    loadPdfLibrary.pending = null;
  });
  return loadPdfLibrary.pending;
}

function createBoardArtworkFilename(extension) {
  const date = new Date().toISOString().slice(0, 10);
  return `vital-pancakes-visual-board-${date}.${extension}`;
}

function exportSelectedCharacter() {
  if (!selectedObjects.length) return;
  const characterName = selectedObjects.find((object) => object.name)?.name
    ?.replace(/\s+trace$/i, "")
    || "Visual Board character";
  try {
    const character = createCharacterPackage(
      board.objects,
      board.assets,
      board.rig,
      selectedObjects.map((object) => object.id),
      characterName,
    );
    downloadAnimationBlob(
      new Blob([JSON.stringify(character, null, 2)], { type: "application/json" }),
      createCharacterFilename(character.name),
    );
    announceStatus("Character saved with groups, joints, and locks");
  } catch (error) {
    console.error("Unable to save the selected character.", error);
    announceStatus(
      error instanceof CharacterFileError ? error.message : "Character could not be saved",
    );
  }
}

async function addAnimationImageFiles(files, targetFrameId = selectedAnimationFrameId) {
  const imageFiles = files.filter((file) => file?.type?.startsWith("image/"));
  if (!imageFiles.length) return;
  const availableSlots = MAX_ANIMATION_FRAMES - board.animation.frames.length;
  const canReplace = board.animation.frames.some((frame) => frame.id === targetFrameId);
  const maximumImages = Math.max(0, availableSlots + (canReplace ? 1 : 0));
  if (!maximumImages) {
    announceStatus(`Animation is limited to ${MAX_ANIMATION_FRAMES} frames`);
    return;
  }

  const preparedImages = [];
  for (const file of imageFiles.slice(0, maximumImages)) {
    try {
      preparedImages.push(await prepareImage(file));
    } catch (error) {
      console.error(`Unable to read ${file.name}.`, error);
    }
  }
  if (!preparedImages.length) {
    announceStatus("Animation frame could not be read");
    return;
  }

  stopAnimationPlayback();
  const previousFrames = cloneValue(board.animation.frames);
  let addedFrameCount = 0;
  let insertionIndex = board.animation.frames.findIndex((frame) => frame.id === targetFrameId);
  if (insertionIndex >= 0) {
    board.animation.frames = replaceAnimationFrame(
      board.animation.frames,
      targetFrameId,
      preparedImages.shift(),
    );
    selectedAnimationFrameId = targetFrameId;
    insertionIndex += 1;
    addedFrameCount += 1;
  } else {
    insertionIndex = board.animation.frames.length;
  }

  const newFrames = preparedImages.map((image, offset) => createAnimationFrame(
    createId(),
    insertionIndex + offset,
    image,
  ));
  board.animation.frames.splice(insertionIndex, 0, ...newFrames);
  addedFrameCount += newFrames.length;
  if (newFrames.length) selectedAnimationFrameId = newFrames.at(-1).id;

  if (!saveBoard()) {
    board.animation.frames = previousFrames;
    ensureSelectedAnimationFrame();
  } else {
    announceStatus(`${addedFrameCount} animation frame${addedFrameCount === 1 ? "" : "s"} added`);
  }
  renderAnimationPanel();
}

async function handleAnimationDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  animationPanel.classList.remove("is-drop-target");
  const files = [...(event.dataTransfer?.files ?? [])];
  const target = event.target instanceof Element
    ? event.target.closest("[data-frame-id]")
    : null;
  await addAnimationImageFiles(files, target?.dataset.frameId || selectedAnimationFrameId);
}

function openInterpolationDialog(startFrameId, endFrameId, returnFocus) {
  if (interpolationInProgress) return;
  const startIndex = board.animation.frames.findIndex(
    (frame) => frame.id === startFrameId,
  );
  const startFrame = board.animation.frames[startIndex];
  const endFrame = board.animation.frames[startIndex + 1];
  if (
    startIndex < 0
    || endFrame?.id !== endFrameId
    || !startFrame.dataUrl
    || !endFrame.dataUrl
  ) {
    announceStatus("Both adjacent frames need images");
    return;
  }

  const framesAvailable = MAX_ANIMATION_FRAMES - board.animation.frames.length;
  if (framesAvailable < 1) {
    announceStatus("Animation frame limit reached");
    return;
  }

  stopAnimationPlayback();
  interpolationRequest = { startFrameId, endFrameId };
  interpolationReturnFocus = returnFocus;
  interpolationPairLabel.textContent = `Between frame ${startIndex + 1} and ${startIndex + 2}`;
  interpolationCountInput.max = String(framesAvailable);
  interpolationCountInput.value = String(Math.min(3, framesAvailable));
  interpolationCountInput.disabled = false;
  confirmInterpolationButton.disabled = false;
  cancelInterpolationButton.disabled = false;
  interpolationProgress.hidden = true;
  interpolationError.hidden = true;
  interpolationError.textContent = "";
  interpolationDialog.showModal();
  requestAnimationFrame(() => {
    interpolationCountInput.focus();
    interpolationCountInput.select();
  });
}

async function generateRequestedIntermediateFrames() {
  if (!interpolationRequest || interpolationInProgress) return;
  interpolationError.hidden = true;
  const startIndex = board.animation.frames.findIndex(
    (frame) => frame.id === interpolationRequest.startFrameId,
  );
  const startFrame = board.animation.frames[startIndex];
  const endFrame = board.animation.frames[startIndex + 1];
  const framesAvailable = MAX_ANIMATION_FRAMES - board.animation.frames.length;

  let count;
  try {
    if (
      startIndex < 0
      || endFrame?.id !== interpolationRequest.endFrameId
      || !startFrame.dataUrl
      || !endFrame.dataUrl
    ) {
      throw new FrameInterpolationError(
        "FRAME_PAIR_CHANGED",
        "Those source frames are no longer available. Choose the pair again.",
      );
    }
    count = normalizeIntermediateFrameCount(
      interpolationCountInput.value,
      framesAvailable,
    );
  } catch (error) {
    showInterpolationError(error);
    return;
  }

  interpolationInProgress = true;
  interpolationAbortController = new AbortController();
  setInterpolationBusy(true);
  renderAnimationTimeline();

  try {
    const { interpolateRifeFrames } = await import("./visual-board-rife.mjs?v=1");
    const images = await interpolateRifeFrames({
      startFrame,
      endFrame,
      count,
      signal: interpolationAbortController.signal,
      onProgress: updateInterpolationProgress,
    });
    if (images.length !== count) {
      throw new FrameInterpolationError(
        "INVALID_GENERATED_FRAME",
        `RIFE returned ${images.length} of ${count} requested frames.`,
      );
    }

    const intermediateFrames = images.map((image, index) => createAnimationFrame(
      createId(),
      startIndex + index + 1,
      image,
    ));
    const previousFrames = board.animation.frames;
    board.animation.frames = insertIntermediateFrames(
      previousFrames,
      interpolationRequest.startFrameId,
      interpolationRequest.endFrameId,
      intermediateFrames,
    );
    selectedAnimationFrameId = intermediateFrames.at(-1).id;
    if (!saveBoard()) {
      board.animation.frames = previousFrames;
      selectedAnimationFrameId = startFrame.id;
      throw new FrameInterpolationError(
        "STORAGE_FULL",
        "The frames were generated, but browser storage is full. No frames were inserted.",
      );
    }

    renderAnimationPanel();
    announceStatus(`${count} in-between frame${count === 1 ? "" : "s"} generated`);
    interpolationDialog.close("generated");
  } catch (error) {
    if (error?.code === "CANCELLED") {
      announceStatus("Frame generation cancelled");
      interpolationDialog.close("cancelled");
    } else {
      console.error("Unable to generate intermediate frames.", error);
      showInterpolationError(error);
    }
  } finally {
    interpolationInProgress = false;
    interpolationAbortController = null;
    if (interpolationDialog.open) setInterpolationBusy(false);
    renderAnimationPanel();
  }
}

function updateInterpolationProgress(progress) {
  interpolationProgress.hidden = false;
  interpolationProgressLabel.textContent = progress.message
    || "Generating intermediate frames";

  if (progress.phase === "model-download") {
    if (progress.total > 0) {
      const percent = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
      interpolationProgressBar.max = progress.total;
      interpolationProgressBar.value = progress.loaded;
      interpolationProgressValue.textContent = `${percent}%`;
    } else {
      interpolationProgressBar.removeAttribute("value");
      interpolationProgressValue.textContent = progress.loaded > 0
        ? `${(progress.loaded / (1024 * 1024)).toFixed(1)} MB`
        : "";
    }
    return;
  }
  if (progress.phase === "model-ready") {
    interpolationProgressBar.max = 1;
    interpolationProgressBar.value = 1;
    interpolationProgressValue.textContent = "Ready";
    return;
  }
  if (progress.phase === "interpolation") {
    interpolationProgressLabel.textContent = "Generating intermediate frames";
    interpolationProgressBar.max = progress.total;
    interpolationProgressBar.value = progress.completed;
    interpolationProgressValue.textContent = `${progress.completed} / ${progress.total}`;
    return;
  }

  interpolationProgressBar.removeAttribute("value");
  interpolationProgressValue.textContent = "";
}

function setInterpolationBusy(isBusy) {
  interpolationCountInput.disabled = isBusy;
  confirmInterpolationButton.disabled = isBusy;
  cancelInterpolationButton.disabled = false;
  cancelInterpolationButton.textContent = "Cancel";
}

function cancelFrameInterpolation() {
  if (!interpolationInProgress) {
    interpolationDialog.close("cancelled");
    return;
  }
  interpolationAbortController?.abort();
  interpolationProgress.hidden = false;
  interpolationProgressLabel.textContent = "Cancelling after current frame";
  interpolationProgressValue.textContent = "";
  interpolationProgressBar.removeAttribute("value");
  cancelInterpolationButton.disabled = true;
}

function showInterpolationError(error) {
  interpolationProgress.hidden = true;
  interpolationError.textContent = error instanceof FrameInterpolationError
    ? error.message
    : "The interpolation tools could not be loaded. Check your connection and try again.";
  interpolationError.hidden = false;
}

function restoreInterpolationFocus() {
  const returnFocus = interpolationReturnFocus;
  interpolationRequest = null;
  interpolationReturnFocus = null;
  if (returnFocus?.isConnected) {
    returnFocus.focus({ preventScroll: true });
  } else if (animationPanelOpen) {
    animationPreview.focus({ preventScroll: true });
  }
}

function updateSelectionControls() {
  const selectionUnitCount = getSelectionUnits(selectedObjects).length;
  selectionActions.hidden = selectedObjects.length === 0;
  copySelectionButton.disabled = selectedObjects.length === 0;
  pasteSelectionButton.disabled = objectClipboard.length === 0;
  saveToLibraryButton.disabled = selectedObjects.length === 0;
  exportCharacterButton.disabled = selectedObjects.length === 0;
  boardLibrarySaveSelectionButton.disabled = selectedObjects.length === 0;
  floorPlanSaveElementButton.disabled = selectedObjects.length === 0;
  floorPlanSaveTemplateButton.disabled = selectedObjects.length === 0;
  const singleImageSelected = selectedObjects.length === 1
    && selectedObjects[0].type === "image";
  const hasLockedSelection = selectedObjects.some((object) => object.locked);
  traceImageButton.hidden = !isImageSelection(selectedObjects) || hasLockedSelection;
  traceImageButton.disabled = traceInProgress || !canTraceSelection(selectedObjects);
  editImageButton.hidden = !singleImageSelected || hasLockedSelection;
  editImageButton.disabled = !singleImageSelected || hasLockedSelection;
  flipHorizontalButton.hidden = hasLockedSelection;
  flipVerticalButton.hidden = hasLockedSelection;
  flipHorizontalButton.disabled = hasLockedSelection;
  flipVerticalButton.disabled = hasLockedSelection;
  const connectorSelection = selectedObjects.length > 0
    && !hasLockedSelection
    && selectedObjects.every((object) => object.type === "connector");
  const allConnectorsDoubleSided = connectorSelection
    && selectedObjects.every((object) => object.arrowStart);
  toggleArrowStartButton.hidden = !connectorSelection;
  toggleArrowStartButton.disabled = !connectorSelection;
  toggleArrowStartButton.classList.toggle("is-active", allConnectorsDoubleSided);
  toggleArrowStartButton.setAttribute("aria-pressed", String(allConnectorsDoubleSided));
  mirrorTextToggle.hidden = !selectedObjects.some((object) => object.type === "textbox");
  mirrorTextToggle.classList.toggle("is-active", mirrorTextOnFlip);
  mirrorTextToggle.setAttribute("aria-pressed", String(mirrorTextOnFlip));
  selectionCount.textContent = selectionUnitCount === 1
    ? "1 selected"
    : `${selectionUnitCount} selected`;
  const canAddVertex = canAddPathVertex();
  addCurveVertexButton.hidden = false;
  addCurveVertexButton.disabled = !canAddVertex;
  if (!canAddVertex) curveVertexInsertionActive = false;
  addCurveVertexButton.classList.toggle("is-active", curveVertexInsertionActive);
  addCurveVertexButton.setAttribute("aria-pressed", String(curveVertexInsertionActive));

  updateTextStyleControls();
  if (!selectedObjects.length) return;
  const allLocked = selectedObjects.every((object) => object.locked);
  const anyLocked = selectedObjects.some((object) => object.locked);
  lockSelectionButton.classList.toggle("is-active", anyLocked);
  lockSelectionButton.setAttribute("aria-pressed", String(anyLocked));
  lockSelectionButton.title = allLocked ? "Unlock selection" : "Lock selection";
  lockSelectionButton.querySelector(".tool-button-label").textContent = allLocked ? "Unlock" : "Lock";
  const dimensionState = getSelectedDimensionLockState();
  lockDimensionsButton.disabled = dimensionState.targets.length === 0 || anyLocked;
  lockDimensionsButton.classList.toggle("is-active", dimensionState.anyLocked);
  lockDimensionsButton.setAttribute("aria-pressed", String(dimensionState.anyLocked));
  lockDimensionsButton.title = dimensionState.allLocked
    ? "Allow joint distances and group dimensions to change"
    : "Keep joint distances and group dimensions fixed";
  lockDimensionsButton.querySelector(".tool-button-label").textContent = dimensionState.allLocked
    ? "Unlock size"
    : "Lock size";
  lockDimensionsButton.hidden = false;
  deleteSelectionButton.disabled = allLocked;
  deleteSelectionButton.hidden = allLocked;
  const canUngroup = !anyLocked && selectedObjects.some((object) => (
    Boolean(object.groupId)
    || Boolean(object.vertexNetworkId)
    || (object.type !== "line" && isExplodableObject(object))
  ));
  ungroupSelectionButton.hidden = false;
  ungroupSelectionButton.disabled = !canUngroup;
  const canGroup = canGroupSelection(selectedObjects);
  groupSelectionButton.hidden = !canGroup;
  groupSelectionButton.disabled = !canGroup;
  const canCreateVertices = canCreateVertexNetwork(selectedObjects);
  mergeVerticesButton.hidden = false;
  mergeVerticesButton.disabled = !canCreateVertices;
  exportCharacterButton.hidden = false;

  const styleObject = selectedObjects.find((object) => (
    object.type !== "image" && object.type !== "textbox"
  )) ?? selectedObjects.find((object) => object.type !== "image");
  if (styleObject) {
    colorInput.value = styleObject.color;
    if (styleObject.fillColor) fillColorInput.value = styleObject.fillColor;
    widthInput.value = styleObject.strokeWidth;
    widthValue.textContent = styleObject.strokeWidth;
    patternInput.value = styleObject.dashPattern ?? "solid";
  }
}

function canAddPathVertex() {
  const singleObject = selectedObjects.length === 1 ? selectedObjects[0] : null;
  if (
    singleObject
    && CURVE_TYPES.has(singleObject.type)
    && !singleObject.locked
    && !singleObject.dimensionsLocked
  ) {
    return true;
  }
  return getSelectedInsertableLines().length > 0;
}

function getSelectedInsertableLines() {
  const singleObject = selectedObjects.length === 1 ? selectedObjects[0] : null;
  if (
    singleObject
    && INSERTABLE_LINE_TYPES.has(singleObject.type)
    && !singleObject.locked
    && !singleObject.dimensionsLocked
  ) {
    return [singleObject];
  }
  const network = getSelectedVertexNetwork();
  if (
    !network
    || network.objects.some((object) => (
      object.locked
      || object.dimensionsLocked
      || !INSERTABLE_LINE_TYPES.has(object.type)
    ))
  ) {
    return [];
  }
  return network.objects;
}

function updateTextStyleControls() {
  const selectedTextboxes = selectedObjects.filter((object) => object.type === "textbox");
  textStyleControls.hidden = activeTool !== "textbox" && selectedTextboxes.length === 0;
  const source = selectedTextboxes[0];
  if (!source) return;
  textFontInput.value = source.fontFamily ?? "serif";
  textSizeInput.value = String(source.fontSize);
  textColorInput.value = source.color;
}

function canGroupSelection(objects) {
  return getSelectionUnits(objects).length >= 2
    && objects.every((object) => !object.locked);
}

function groupSelection() {
  if (!canGroupSelection(selectedObjects)) return;
  checkpoint();
  const unitCount = getSelectionUnits(selectedObjects).length;
  const groupId = createId();
  selectedObjects.forEach((object) => {
    pushObjectGroupLevel(object, groupId, true);
  });
  saveBoard();
  updateSelectionControls();
  drawBoard();
  groupSelectionButton.blur();
  announceStatus(`${unitCount} units grouped at a new level`);
}

function canTraceSelection(objects) {
  return isImageSelection(objects) && objects.every((object) => !object.locked);
}

function isImageSelection(objects) {
  return objects.length > 0 && objects.every((object) => object.type === "image");
}

async function traceSelectedImages() {
  if (!canTraceSelection(selectedObjects) || traceInProgress) return;
  const sourceImages = [...selectedObjects];
  traceInProgress = true;
  updateSelectionControls();
  announceStatus("Tracing image into black-and-white paths...");
  await new Promise((resolve) => window.requestAnimationFrame(resolve));

  try {
    const replacements = new Map();
    for (const imageObject of sourceImages) {
      const tracedObject = await createTracedImageObject(imageObject);
      if (tracedObject) replacements.set(imageObject, tracedObject);
    }
    if (!replacements.size) {
      announceStatus("No dark outlines were detected");
      return;
    }

    checkpoint();
    board.objects = board.objects.flatMap((object) => (
      replacements.has(object) ? [replacements.get(object)] : [object]
    ));
    selectedObjects = [...replacements.values()];
    saveBoard();
    drawBoard();
    const pathCount = selectedObjects.reduce(
      (total, object) => total + object.paths.length,
      0,
    );
    announceStatus(
      `${pathCount} traced path${pathCount === 1 ? "" : "s"} ready for Create vertices`,
    );
  } catch (error) {
    console.error("Unable to trace the selected image.", error);
    announceStatus("Image tracing failed");
  } finally {
    traceInProgress = false;
    updateSelectionControls();
  }
}

async function createTracedImageObject(imageObject) {
  const asset = board.assets[imageObject.assetId];
  if (!asset?.dataUrl) return null;
  const image = await loadImageSource(asset.dataUrl);
  const sourceWidth = imageObject.sourceWidth || image.naturalWidth;
  const sourceHeight = imageObject.sourceHeight || image.naturalHeight;
  const crop = normalizeImageCrop(imageObject.crop, sourceWidth, sourceHeight);
  const scale = Math.min(
    1,
    MAX_TRACE_DIMENSION / Math.max(crop.width, crop.height),
  );
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const stagingCanvas = document.createElement("canvas");
  stagingCanvas.width = width;
  stagingCanvas.height = height;
  const stagingContext = stagingCanvas.getContext("2d", { willReadFrequently: true });
  stagingContext.fillStyle = "#ffffff";
  stagingContext.fillRect(0, 0, width, height);
  stagingContext.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    width,
    height,
  );
  const traced = traceBlackAndWhiteImage(
    stagingContext.getImageData(0, 0, width, height),
  );
  if (!traced.paths.length) return null;

  const center = getShapeCenter(imageObject);
  const paths = traced.paths.map((path) => path.map((point) => {
    const xProgress = imageObject.flipX ? 1 - point.x / width : point.x / width;
    const yProgress = imageObject.flipY ? 1 - point.y / height : point.y / height;
    return rotatePoint({
      x: imageObject.x + xProgress * imageObject.w,
      y: imageObject.y + yProgress * imageObject.h,
    }, center, imageObject.rotation ?? 0);
  }));
  return {
    id: createId(),
    type: "trace",
    paths,
    name: `${imageObject.name || asset.name || "Image"} trace`,
    color: "#000000",
    strokeWidth: 1,
    dashPattern: "solid",
    locked: false,
  };
}

function loadImageSource(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
    image.src = source;
  });
}

function canCreateLineVertexNetwork(objects) {
  return objects.length > 0
    && objects.every((object) => (
      !object.locked
      && (
        LINE_TYPES.has(object.type)
        || CURVE_TYPES.has(object.type)
        || ["rectangle", "ellipse", "shape", "pen", "trace"].includes(object.type)
      )
    ));
}

function canCreateVertexNetwork(objects) {
  return canCreateLineVertexNetwork(objects)
    && objects.some((object) => !LINE_TYPES.has(object.type));
}

function mergeSelectionVertices() {
  if (!canCreateVertexNetwork(selectedObjects)) return;

  const targets = new Set(selectedObjects);
  const sourcePaths = selectedObjects.flatMap(createVertexCandidateLines);
  const network = createEditableVertexNetwork(
    sourcePaths,
    createId,
    VERTEX_TOUCH_TOLERANCE,
  );
  if (!network) return;

  checkpoint();
  let insertedNetwork = false;
  board.objects = board.objects.flatMap((object) => {
    if (!targets.has(object)) return [object];
    if (insertedNetwork) return [];
    insertedNetwork = true;
    return network.objects;
  });
  selectedObjects = network.objects;
  saveBoard();
  updateSelectionControls();
  drawBoard();
  announceStatus(
    `Editable shape created with ${network.vertices.length} shared vertices`,
  );
}

function createVertexCandidateLines(object) {
  if (LINE_TYPES.has(object.type)) return [cloneValue(object)];
  if (CURVE_TYPES.has(object.type)) return [cloneValue(object)];
  if (object.type === "pen") {
    return createLinesFromPaths([object.points], object, false);
  }
  if (object.type === "trace") {
    return createLinesFromPaths(object.paths, object, true);
  }
  return getObjectSegments(object).map(([start, end]) => ({
    id: createId(),
    type: "line",
    x: start.x,
    y: start.y,
    endX: end.x,
    endY: end.y,
    color: object.color,
    strokeWidth: object.strokeWidth,
    dashPattern: object.dashPattern ?? "solid",
    locked: false,
    ...getObjectGroupFields(object),
  }));
}

function createLinesFromPaths(paths, source, closed) {
  return paths.flatMap((path) => {
    const lines = path.slice(1).map((end, index) => (
      createStyledLine(path[index], end, source)
    ));
    if (closed && path.length > 2) {
      lines.push(createStyledLine(path.at(-1), path[0], source));
    }
    return lines;
  });
}

function createStyledLine(start, end, source) {
  return {
    id: createId(),
    type: "line",
    x: start.x,
    y: start.y,
    endX: end.x,
    endY: end.y,
    color: source.color,
    strokeWidth: source.strokeWidth,
    dashPattern: source.dashPattern ?? "solid",
    locked: false,
    ...getObjectGroupFields(source),
  };
}

function toggleCurveVertexInsertion() {
  if (!canAddPathVertex()) return;
  if (activeTool !== "select") setActiveTool("select");
  curveVertexInsertionActive = !curveVertexInsertionActive;
  updateSelectionControls();
  updateCanvasCursor();
  if (curveVertexInsertionActive) {
    canvas.focus({ preventScroll: true });
    announceStatus("Click the selected line or curve to add a movable point");
  } else {
    announceStatus("Point insertion cancelled");
  }
}

function insertSelectedPathVertexAt(target) {
  const curve = selectedObjects.length === 1 ? selectedObjects[0] : null;
  if (
    curve
    && CURVE_TYPES.has(curve.type)
    && !curve.locked
    && !curve.dimensionsLocked
  ) {
    insertSelectedCurvePoint(curve, target);
    return;
  }

  const lines = getSelectedInsertableLines();
  const result = insertLineVertex(
    lines,
    target,
    createId,
    12 / viewport.zoom,
  );
  curveVertexInsertionActive = false;
  if (!result) {
    updateSelectionControls();
    updateCanvasCursor();
    announceStatus("Click directly on a selected line to add a point");
    return;
  }

  checkpoint();
  board.objects = board.objects.flatMap((object) => (
    object.id === result.sourceObjectId ? result.objects : [object]
  ));
  selectedObjects = board.objects.filter((object) => (
    object.vertexNetworkId === result.networkId
  ));
  saveBoard();
  updateSelectionControls();
  updateCanvasCursor();
  drawBoard();
  announceStatus(
    `${getVertexNetworkVertices(selectedObjects).length} editable line points`,
  );
}

function insertSelectedCurvePoint(object, target) {
  if (!object || !CURVE_TYPES.has(object.type) || object.locked) {
    curveVertexInsertionActive = false;
    updateSelectionControls();
    return;
  }
  const result = insertCurveVertex(object, target);
  curveVertexInsertionActive = false;
  if (!result.inserted) {
    updateSelectionControls();
    announceStatus("A curve point could not be added there");
    return;
  }

  checkpoint();
  if (result.curve.vertexNetworkId && Array.isArray(result.curve.curveVertexIds)) {
    result.curve.curveVertexIds[result.vertexIndex] = createId();
  }
  replaceObjectProperties(object, result.curve);
  saveBoard();
  updateSelectionControls();
  updateCanvasCursor();
  drawBoard();
  announceStatus(`${getCurveVertices(object).length} editable curve points`);
}

function ungroupSelection() {
  const groupIds = new Set(selectedObjects.map((object) => object.groupId).filter(Boolean));
  const vertexNetworkIds = new Set(
    selectedObjects.map((object) => object.vertexNetworkId).filter(Boolean),
  );
  if (selectedObjects.some((object) => object.locked)) return;
  if (!groupIds.size && !vertexNetworkIds.size) {
    const targets = new Set(selectedObjects.filter((object) => (
      object.type !== "line" && isExplodableObject(object)
    )));
    if (!targets.size) return;
    checkpoint();
    const lineParts = [];
    board.objects = board.objects.flatMap((object) => {
      if (!targets.has(object)) return [object];
      const parts = explodeObjectIntoLines(object, createId);
      if (!parts.length) return [object];
      lineParts.push(...parts);
      return parts;
    });
    selectedObjects = lineParts;
    saveBoard();
    updateSelectionControls();
    drawBoard();
    announceStatus(
      `${targets.size} outline${targets.size === 1 ? "" : "s"} ungrouped into editable lines`,
    );
    return;
  }
  checkpoint();
  const releasedRigidGroupIds = new Set();
  board.objects.forEach((object) => {
    if (groupIds.has(object.groupId)) {
      const released = popObjectGroupLevel(object);
      if (released?.rigidGroup) {
        releasedRigidGroupIds.add(released.id);
        return;
      }
    } else if (!vertexNetworkIds.has(object.vertexNetworkId)) {
      return;
    }
    if (vertexNetworkIds.has(object.vertexNetworkId)) {
      delete object.vertexNetworkId;
      delete object.startVertexId;
      delete object.endVertexId;
      delete object.curveVertexIds;
      delete object.dimensionsLocked;
    }
  });
  board.rig = removeRigBodies(board.rig, releasedRigidGroupIds);
  saveBoard();
  updateSelectionControls();
  drawBoard();
  announceStatus("One group level removed");
}

function deleteSelection() {
  const deletableObjects = selectedObjects.filter((object) => !object.locked);
  if (!deletableObjects.length) {
    announceStatus("Unlock before deleting");
    return;
  }
  checkpoint();
  const deletedIds = new Set(deletableObjects.map((object) => object.id));
  board.objects = board.objects.filter((object) => !deletedIds.has(object.id));
  board.rig = normalizeRig(board.rig, board.objects);
  selectedObjects = selectedObjects.filter((object) => !deletedIds.has(object.id));
  closeTextEditor();
  saveBoard();
  updateSelectionControls();
  drawBoard();
}

function copySelection() {
  if (!selectedObjects.length) return;
  objectClipboard = cloneValue(selectedObjects);
  pasteGeneration = 0;
  updateSelectionControls();
  announceStatus(`${objectClipboard.length} object${objectClipboard.length === 1 ? "" : "s"} copied`);
}

function pasteSelection() {
  if (!objectClipboard.length) return;
  pasteGeneration += 1;
  const offset = getGridSize() * pasteGeneration;
  const pastedObjects = duplicateBoardObjects(
    objectClipboard,
    createId,
    { x: offset, y: offset },
  ).map(normalizeObject).filter(Boolean);
  if (!pastedObjects.length) return;

  checkpoint();
  board.objects.push(...pastedObjects);
  selectedObjects = pastedObjects;
  closeTextEditor();
  saveBoard();
  updateSelectionControls();
  drawBoard();
  announceStatus(`${pastedObjects.length} object${pastedObjects.length === 1 ? "" : "s"} pasted`);
}

function toggleSelectionLock() {
  if (!selectedObjects.length) return;
  const shouldLock = selectedObjects.some((object) => !object.locked);
  checkpoint();
  selectedObjects.forEach((object) => {
    object.locked = shouldLock;
  });
  if (shouldLock) closeTextEditor();
  saveBoard();
  updateSelectionControls();
  drawBoard();
}

function getSelectedDimensionLockState() {
  const vertexNetwork = getSelectedVertexNetwork();
  const selectedBodyIds = getSelectedRigidBodyIds();
  const rigBodies = board.rig.bodies.filter((body) => selectedBodyIds.has(body.id));
  const coveredObjectIds = new Set(vertexNetwork?.objects.map((object) => object.id) ?? []);
  rigBodies.forEach((body) => {
    (body.objectIds ?? []).forEach((objectId) => coveredObjectIds.add(objectId));
  });
  const ordinaryObjects = selectedObjects.filter((object) => (
    !coveredObjectIds.has(object.id)
  ));
  const targets = [
    ...(vertexNetwork ? [{ kind: "network", objects: vertexNetwork.objects }] : []),
    ...rigBodies.map((body) => ({ kind: "body", body })),
    ...(ordinaryObjects.length
      ? [{ kind: "objects", objects: ordinaryObjects }]
      : []),
  ];
  const lockStates = targets.map((target) => (
    ["network", "objects"].includes(target.kind)
      ? target.objects.every((object) => object.dimensionsLocked)
      : target.body.dimensionsLocked
  ));
  return {
    targets,
    anyLocked: lockStates.some(Boolean),
    allLocked: lockStates.length > 0 && lockStates.every(Boolean),
  };
}

function toggleSelectionDimensionLock() {
  const state = getSelectedDimensionLockState();
  if (!state.targets.length || selectedObjects.some((object) => object.locked)) return;
  const shouldLock = !state.allLocked;
  checkpoint();
  state.targets.forEach((target) => {
    if (target.kind === "network") {
      target.objects.forEach((object) => {
        object.dimensionsLocked = shouldLock;
      });
    } else if (target.kind === "objects") {
      target.objects.forEach((object) => {
        object.dimensionsLocked = shouldLock;
      });
    }
  });
  board.rig = setRigBodyDimensionLock(
    board.rig,
    getSelectedRigidBodyIds(),
    shouldLock,
  );
  saveBoard();
  updateSelectionControls();
  drawBoard();
  announceStatus(shouldLock ? "Dimensions locked" : "Dimensions unlocked");
}

function applySelectedColor() {
  const targets = selectedObjects.filter((object) => !object.locked && object.type !== "image");
  if (!targets.length) return;
  if (!colorChangeActive) {
    checkpoint();
    colorChangeActive = true;
  }
  targets.forEach((object) => {
    object.color = colorInput.value;
  });
  const selectedTextbox = targets.find((object) => object.type === "textbox");
  if (selectedTextbox) textColorInput.value = selectedTextbox.color;
  drawBoard();
}

function canReceiveFill(object) {
  return canReceiveBucketFill(object);
}

function applySelectedFillColor() {
  const nextColor = normalizeHexColor(fillColorInput.value, "#f7f4ec");
  if (!fillChangeActive && board.settings.fillColor !== nextColor) {
    checkpoint();
    fillChangeActive = true;
  }
  board.settings.fillColor = nextColor;
  if (activeTool === "bucket") return;
  const targets = selectedObjects.filter((object) => (
    !object.locked && canReceiveFill(object)
  ));
  if (!targets.length) return;
  if (!fillChangeActive) {
    checkpoint();
    fillChangeActive = true;
  }
  targets.forEach((object) => {
    object.fillColor = nextColor;
    if (!Number.isFinite(object.fillOpacity)) object.fillOpacity = 1;
  });
  drawBoard();
}

function finishFillChange() {
  if (!fillChangeActive) return;
  fillChangeActive = false;
  saveBoard();
}

function clearSelectedFill() {
  const targets = selectedObjects.filter((object) => (
    !object.locked && canReceiveFill(object) && object.fillColor
  ));
  if (!targets.length) return;
  checkpoint();
  targets.forEach((object) => {
    delete object.fillColor;
    object.fillOpacity = 1;
  });
  saveBoard();
  drawBoard();
  announceStatus("Fill removed");
}

function paintBucketAt(point) {
  board.settings.fillColor = normalizeHexColor(fillColorInput.value, "#f7f4ec");
  const visibleLabelIds = getVisibleFloorPlanLabelIds();
  const visibleObjects = sortArchitectureObjects(
    board.objects,
    board.settings.architecture,
  ).filter((object) => isFloorPlanObjectVisible(
    object,
    board.objects,
    board.settings.floorPlan,
    { visibleLabelIds },
  ));
  const target = findBucketFillTarget(visibleObjects, point);
  if (target) {
    if (target.locked) {
      announceStatus("Unlock before painting");
      return;
    }
    checkpoint();
    target.fillColor = board.settings.fillColor;
    target.fillOpacity = 1;
    saveBoard();
    drawBoard();
    announceStatus("Area filled");
    return;
  }

  const polygon = findEnclosedVectorRegion(visibleObjects, point);
  const area = createBucketFillArea(polygon, board.settings.fillColor, createId);
  if (!area) {
    announceStatus("No closed area at that point");
    return;
  }
  checkpoint();
  board.objects.unshift(area);
  saveBoard();
  drawBoard();
  announceStatus("Enclosed area filled");
}

function getEditableSelectedTextboxes() {
  return selectedObjects.filter((object) => object.type === "textbox" && !object.locked);
}

function applySelectedTextFont() {
  const targets = getEditableSelectedTextboxes();
  if (!targets.length) return;
  checkpoint();
  targets.forEach((object) => {
    object.fontFamily = textFontInput.value;
  });
  saveBoard();
  drawBoard();
}

function applySelectedTextSize() {
  const fontSize = clamp(Number(textSizeInput.value), 8, 96);
  textSizeInput.value = String(fontSize);
  const targets = getEditableSelectedTextboxes();
  if (!targets.length) return;
  checkpoint();
  targets.forEach((object) => {
    object.fontSize = fontSize;
  });
  saveBoard();
  drawBoard();
}

function applySelectedTextColor() {
  const targets = getEditableSelectedTextboxes();
  colorInput.value = textColorInput.value;
  if (!targets.length) return;
  const editorRange = textEditorSession?.pendingColorRange;
  if (!textColorChangeActive) {
    if (!textEditorSession) checkpoint();
    textColorChangeActive = true;
  }
  if (textEditorSession && editorRange?.end > editorRange?.start) {
    textEditorSession.object.colorRanges = applyTextColorRange(
      textEditorSession.object.colorRanges,
      textEditorSession.object.text.length,
      editorRange.start,
      editorRange.end,
      textColorInput.value,
    );
    drawBoard();
    return;
  }
  targets.forEach((object) => {
    object.color = textColorInput.value;
  });
  drawBoard();
}

function finishTextColorChange() {
  const pendingEditorRange = textEditorSession?.pendingColorRange;
  if (!textColorChangeActive && !pendingEditorRange) return;
  const changed = textColorChangeActive;
  textColorChangeActive = false;
  if (changed) saveBoard();
  if (pendingEditorRange) {
    textEditorSession.pendingColorRange = null;
    closeTextEditor();
  }
}

function applySelectedStrokeWidth() {
  widthValue.textContent = widthInput.value;
  const targets = selectedObjects.filter((object) => (
    !object.locked && object.type !== "textbox" && object.type !== "image"
  ));
  if (!targets.length) return;
  if (!widthChangeActive) {
    checkpoint();
    widthChangeActive = true;
  }
  targets.forEach((object) => {
    object.strokeWidth = Number(widthInput.value);
  });
  drawBoard();
}

function applySelectedStrokePattern() {
  const targets = selectedObjects.filter((object) => (
    !object.locked && object.type !== "textbox" && object.type !== "image"
  ));
  if (!targets.length) return;
  checkpoint();
  targets.forEach((object) => {
    object.dashPattern = patternInput.value;
  });
  saveBoard();
  updateSelectionControls();
  drawBoard();
}

function finishColorChange() {
  if (!colorChangeActive) return;
  colorChangeActive = false;
  saveBoard();
}

function finishWidthChange() {
  if (!widthChangeActive) return;
  widthChangeActive = false;
  saveBoard();
}

function updateViewControls() {
  if (activeTool === "bucket" || !selectedObjects.length) {
    fillColorInput.value = board.settings.fillColor;
  }
  gridToggle.classList.toggle("is-active", board.settings.grid);
  snapToggle.classList.toggle("is-active", board.settings.snap);
  gridToggle.setAttribute("aria-pressed", String(board.settings.grid));
  snapToggle.setAttribute("aria-pressed", String(board.settings.snap));
  floorPlanPanelOpen = Boolean(board.settings.floorPlan?.enabled);
  toolWorkspace.classList.toggle("is-floor-plan-open", floorPlanPanelOpen);
  floorPlanPanel.setAttribute("aria-hidden", String(!floorPlanPanelOpen));
  floorPlanPanel.inert = !floorPlanPanelOpen;
  floorPlanToggleButton.setAttribute("aria-expanded", String(floorPlanPanelOpen));
  floorPlanToggleButton.classList.toggle("is-active", floorPlanPanelOpen);
  syncFloorPlanControls();
  renderFloorPlanCatalog();
}

/**
 * Synchronizes one split button with its retained shape choice.
 *
 * @param {"2d"|"3d"} family Shape family.
 * @param {string} tool Shape tool identifier.
 */
function updateShapePickerChoice(family, tool) {
  const control = family === "2d" ? shape2dControl : shape3dControl;
  const primary = control.querySelector("[data-shape-primary]");
  const option = document.querySelector(
    `#shape-${family}-menu [data-shape-option="${CSS.escape(tool)}"]`,
  );
  if (!option) return;

  const label = option.textContent.trim();
  primary.dataset.shapeTool = tool;
  primary.querySelector("[data-shape-label]").textContent = label;
  primary.title = `Use ${label}`;
  document.querySelectorAll(`#shape-${family}-menu [data-shape-option]`).forEach((candidate) => {
    candidate.setAttribute("aria-checked", String(candidate === option));
  });
}

function updateLinePickerChoice(tool) {
  if (!["line", "connector"].includes(tool)) return;
  const primary = lineControl.querySelector("[data-line-primary]");
  const option = document.querySelector(
    `#line-menu [data-line-option="${CSS.escape(tool)}"]`,
  );
  if (!option) return;
  const isArrow = tool === "connector";
  lineToolChoice = tool;
  primary.dataset.lineTool = tool;
  primary.querySelector("[data-line-icon]").textContent = isArrow ? "↗" : "╱";
  primary.querySelector("[data-line-label]").textContent = isArrow ? "Arrow" : "Line";
  primary.title = `Use ${isArrow ? "Arrow" : "Line"}`;
  document.querySelectorAll("#line-menu [data-line-option]").forEach((candidate) => {
    candidate.setAttribute("aria-checked", String(candidate === option));
  });
}

/**
 * Places a top-layer shape menu directly beneath its split button.
 *
 * @param {HTMLElement} control Split-button control.
 * @param {HTMLElement} menu Popover menu.
 */
function positionShapePickerMenu(control, menu) {
  const bounds = control.getBoundingClientRect();
  menu.style.minWidth = `${Math.max(132, bounds.width)}px`;
  menu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - 180))}px`;
  menu.style.top = `${bounds.bottom + 4}px`;
}

function closeShapePickerMenu(menu) {
  if (typeof menu.hidePopover === "function") {
    if (menu.matches(":popover-open")) menu.hidePopover();
    return;
  }
  menu.hidden = true;
}

function toggleShapePickerMenu(control, menu) {
  positionShapePickerMenu(control, menu);
  const isPopover = typeof menu.showPopover === "function";
  const isOpen = isPopover ? menu.matches(":popover-open") : !menu.hidden;
  document.querySelectorAll(".shape-picker-menu").forEach((candidate) => {
    if (candidate !== menu) closeShapePickerMenu(candidate);
  });
  if (isOpen) {
    closeShapePickerMenu(menu);
    return;
  }

  if (isPopover) menu.showPopover();
  else menu.hidden = false;
  menu.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
}

/**
 * Connects each split button so its primary side reuses the retained shape and
 * only its arrow opens the option menu.
 */
function initializeShapePickers() {
  document.querySelectorAll("[data-shape-picker]").forEach((control) => {
    const family = control.dataset.shapePicker;
    const primary = control.querySelector("[data-shape-primary]");
    const toggle = control.querySelector("[data-shape-toggle]");
    const menu = document.querySelector(`#shape-${family}-menu`);
    if (typeof menu.showPopover !== "function") menu.hidden = true;

    primary.addEventListener("click", () => setActiveTool(primary.dataset.shapeTool));
    toggle.addEventListener("click", () => toggleShapePickerMenu(control, menu));
    menu.addEventListener("toggle", () => {
      toggle.setAttribute("aria-expanded", String(menu.matches(":popover-open")));
    });
    menu.querySelectorAll("[data-shape-option]").forEach((option) => {
      option.addEventListener("click", () => {
        const tool = option.dataset.shapeOption;
        shapeToolChoices = retainShapeToolChoice(shapeToolChoices, tool);
        updateShapePickerChoice(family, tool);
        setActiveTool(tool);
        closeShapePickerMenu(menu);
        primary.focus({ preventScroll: true });
      });
    });
  });
}

function initializeLinePicker() {
  const primary = lineControl.querySelector("[data-line-primary]");
  const toggle = lineControl.querySelector("[data-line-toggle]");
  const menu = document.querySelector("#line-menu");
  if (typeof menu.showPopover !== "function") menu.hidden = true;

  primary.addEventListener("click", () => setActiveTool(lineToolChoice));
  toggle.addEventListener("click", () => toggleShapePickerMenu(lineControl, menu));
  menu.addEventListener("toggle", () => {
    toggle.setAttribute("aria-expanded", String(menu.matches(":popover-open")));
  });
  menu.querySelectorAll("[data-line-option]").forEach((option) => {
    option.addEventListener("click", () => {
      updateLinePickerChoice(option.dataset.lineOption);
      setActiveTool(lineToolChoice);
      closeShapePickerMenu(menu);
      primary.focus({ preventScroll: true });
    });
  });
}

function setActiveTool(nextTool) {
  if (nextTool !== "select") curveVertexInsertionActive = false;
  activeTool = nextTool;
  if (activeTool === "bucket") {
    selectedObjects = [];
    fillColorInput.value = board.settings.fillColor;
    updateSelectionControls();
  }
  shapeToolChoices = retainShapeToolChoice(shapeToolChoices, activeTool);
  const shapeFamily = getShapeToolFamily(activeTool);
  if (shapeFamily) updateShapePickerChoice(shapeFamily, activeTool);
  if (["line", "connector"].includes(activeTool)) updateLinePickerChoice(activeTool);
  drawingTools.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === activeTool);
  });
  bucketFillTool.classList.toggle("is-active", activeTool === "bucket");
  bucketFillTool.setAttribute("aria-pressed", String(activeTool === "bucket"));
  shape2dControl.classList.toggle("is-active", shapeFamily === "2d");
  shape3dControl.classList.toggle("is-active", shapeFamily === "3d");
  lineControl.classList.toggle("is-active", ["line", "connector"].includes(activeTool));
  closeTextEditor();
  updateTextStyleControls();
  updateCanvasCursor();
  drawBoard();
}

function updateCanvasCursor(worldPoint = hoverPoint) {
  if (interaction?.kind === "pan") {
    canvas.style.cursor = "grabbing";
    return;
  }
  if (activeTool === "pan" || spaceHeld) {
    canvas.style.cursor = "grab";
    return;
  }
  if (activeTool === "eraser") {
    canvas.style.cursor = "none";
    return;
  }
  if (curveVertexInsertionActive) {
    canvas.style.cursor = "crosshair";
    return;
  }
  if (activeTool !== "select") {
    canvas.style.cursor = "crosshair";
    return;
  }

  const handle = worldPoint ? findSelectionHandle(worldPoint) : null;
  if (["rotate", "group-rotate"].includes(handle?.kind)) canvas.style.cursor = "crosshair";
  else if (["endpoint", "curve-vertex", "network-vertex", "rig-joint"].includes(handle?.kind)) {
    canvas.style.cursor = "move";
  }
  else if (["resize", "group-resize"].includes(handle?.kind)) {
    canvas.style.cursor = ["nw", "se"].includes(handle.corner) ? "nwse-resize" : "nesw-resize";
  } else if (worldPoint && selectedObjects.includes(findObjectAt(worldPoint))) {
    canvas.style.cursor = "move";
  } else {
    canvas.style.cursor = "default";
  }
}

function openTextEditor(object, checkpointBeforeEdit = true) {
  if (object.type !== "textbox" || object.locked) return;
  closeTextEditor();

  const editor = document.createElement("textarea");
  editor.className = "board-text-editor";
  editor.value = object.text;
  editor.placeholder = "blank textbox";
  editor.setAttribute("aria-label", "Textbox content");
  editor.style.fontFamily = getTextFontCss(object.fontFamily);
  editor.style.fontWeight = String(object.fontWeight ?? 400);
  canvasFrame.append(editor);

  const historyLength = history.length;
  if (checkpointBeforeEdit) checkpoint();
  textEditorSession = {
    editor,
    object,
    originalText: object.text,
    originalColor: object.color,
    originalColorRanges: cloneValue(object.colorRanges ?? []),
    historyLength,
    checkpointBeforeEdit,
    pendingColorRange: null,
  };

  editor.addEventListener("input", () => {
    const nextText = editor.value;
    object.colorRanges = updateTextColorRangesForEdit(
      object.colorRanges,
      object.text,
      nextText,
    );
    object.text = nextText;
    textEditorSession.pendingColorRange = null;
    drawBoard();
  });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeTextEditor(true);
      returnToSelectionMode();
    } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      closeTextEditor();
    }
  });
  editor.addEventListener("blur", (event) => {
    if (textEditorSession?.editor !== editor) return;
    if (
      textEditorSession.pendingColorRange
      || event.relatedTarget === textColorInput
    ) {
      return;
    }
    closeTextEditor();
  });
  positionTextEditor();
  editor.focus();
  editor.select();
}

function positionTextEditor() {
  if (!textEditorSession) return;
  const { editor, object } = textEditorSession;
  const screenPosition = worldToScreen({ x: object.x, y: object.y });
  editor.style.left = `${screenPosition.x}px`;
  editor.style.top = `${screenPosition.y}px`;
  editor.style.width = `${Math.max(40, object.w * viewport.zoom)}px`;
  editor.style.height = `${Math.max(28, object.h * viewport.zoom)}px`;
  editor.style.fontSize = `${Math.max(
    1,
    getTextWorldFontSize(object.fontSize, viewport.zoom, object.scaleMode) * viewport.zoom,
  )}px`;
  editor.style.fontFamily = getTextFontCss(object.fontFamily);
  editor.style.fontWeight = String(object.fontWeight ?? 400);
  editor.style.color = object.color;
  editor.style.lineHeight = String(object.lineHeight ?? 1.25);
  editor.style.padding = `${Math.max(0, (object.padding ?? 6) * viewport.zoom)}px`;
  editor.style.textAlign = object.textAlign ?? "left";
  editor.style.boxSizing = "border-box";
  editor.style.background = object.fillColor
    ? colorWithOpacity(object.fillColor, (object.fillOpacity ?? 1) * (object.opacity ?? 1))
    : "#ffffff";
  editor.style.transform = `rotate(${object.rotation ?? 0}rad)`;
}

function closeTextEditor(cancel = false) {
  if (!textEditorSession) return;
  const session = textEditorSession;
  textEditorSession = null;

  if (cancel) {
    session.object.text = session.originalText;
    session.object.color = session.originalColor;
    session.object.colorRanges = cloneValue(session.originalColorRanges);
  }
  const changed = session.object.text !== session.originalText
    || session.object.color !== session.originalColor
    || JSON.stringify(session.object.colorRanges ?? [])
      !== JSON.stringify(session.originalColorRanges);
  if (session.checkpointBeforeEdit && (!changed || cancel)) {
    history.splice(session.historyLength);
    updateHistoryControls();
  }
  session.editor.remove();
  if (changed && !cancel) saveBoard();
  drawBoard();
}

function captureActiveTextColorSelection() {
  if (!textEditorSession) return;
  const { selectionStart, selectionEnd } = textEditorSession.editor;
  if (selectionEnd <= selectionStart) return;
  textEditorSession.pendingColorRange = {
    start: selectionStart,
    end: selectionEnd,
  };
}

function handleDoubleClick(event) {
  const object = findObjectAt(screenToWorld(getCanvasPoint(event)));
  if (object?.type === "dimension" && !object.locked) {
    const label = window.prompt(
      "Dimension label (leave blank for automatic measurement)",
      object.label ?? "",
    );
    if (label === null || label === object.label) return;
    checkpoint();
    object.label = label.slice(0, 240);
    selectedObjects = [object];
    saveBoard();
    updateSelectionControls();
    drawBoard();
    return;
  }
  if (object?.type !== "textbox" || object.locked) return;
  selectedObjects = [object];
  updateSelectionControls();
  drawBoard();
  openTextEditor(object);
}

function isEditingControl(target) {
  return target instanceof HTMLElement
    && target.matches("input, textarea, select, [contenteditable='true']");
}

function handleKeyDown(event) {
  if (textEditorSession) return;
  if (interpolationDialog.open) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelFrameInterpolation();
    }
    return;
  }
  if (boardLibrarySaveDialog.open) return;
  if (event.key === "Escape" && animationPreview.classList.contains("is-preview-maximized")) {
    event.preventDefault();
    exitAnimationPreviewFullscreen();
    animationPreview.focus({ preventScroll: true });
    return;
  }
  if (event.key === "Escape" && animationExportInProgress) {
    event.preventDefault();
    cancelAnimationExport();
    return;
  }
  const commandKey = event.metaKey || event.ctrlKey;
  if (event.key === "Escape") {
    event.preventDefault();
    if (curveVertexInsertionActive) {
      curveVertexInsertionActive = false;
      updateSelectionControls();
      updateCanvasCursor();
      addCurveVertexButton.focus({ preventScroll: true });
      announceStatus("Point insertion cancelled");
      return;
    }
    if (animationPanelOpen) {
      toggleAnimationPanel(false);
      animationToggleButton.focus({ preventScroll: true });
      return;
    }
    if (boardLibraryPanelOpen) {
      toggleBoardLibraryPanel(false);
      boardLibraryToggleButton.focus({ preventScroll: true });
      return;
    }
    returnToSelectionMode();
    return;
  }
  if (commandKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (commandKey && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (event.target instanceof HTMLButtonElement && event.code === "Space") return;
  if (isEditingControl(event.target)) return;

  if (commandKey && event.key.toLowerCase() === "c") {
    if (!selectedObjects.length) return;
    event.preventDefault();
    copySelection();
    return;
  }
  if (commandKey && ["+", "=", "-", "_", "0"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "0") setZoom(1);
    else setZoom(viewport.zoom * (["+", "="].includes(event.key) ? 1.25 : 0.8));
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (!selectedObjects.length) return;
    event.preventDefault();
    deleteSelection();
  } else if (event.code === "Space") {
    event.preventDefault();
    spaceHeld = true;
    updateCanvasCursor();
  }
}

function returnToSelectionMode() {
  if (interaction?.kind === "draw") {
    if (canvas.hasPointerCapture(interaction.pointerId)) {
      canvas.releasePointerCapture(interaction.pointerId);
    }
    interaction = null;
    workingObject = null;
  }
  selectedObjects = [];
  setActiveTool("select");
  drawingTools.querySelector('[data-tool="select"]').focus({ preventScroll: true });
  updateSelectionControls();
  drawBoard();
}

function handleKeyUp(event) {
  if (event.code !== "Space") return;
  spaceHeld = false;
  updateCanvasCursor();
}

async function handleImageDrop(event) {
  event.preventDefault();
  canvasFrame.classList.remove("is-drop-target");
  const files = [...(event.dataTransfer?.files ?? [])];
  const characterFiles = files.filter(isCharacterFile);
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  const dropPoint = screenToWorld(getCanvasPoint(event));
  for (let index = 0; index < characterFiles.length; index += 1) {
    await importCharacterFile(characterFiles[index], {
      x: dropPoint.x + index * 24 / viewport.zoom,
      y: dropPoint.y + index * 24 / viewport.zoom,
    });
  }
  if (imageFiles.length) await addImageFiles(imageFiles, dropPoint);
}

function isCharacterFile(file) {
  return typeof file?.name === "string"
    && file.name.toLowerCase().endsWith(".vp-character.json");
}

async function importCharacterFile(file, placementPoint) {
  try {
    const rawCharacter = JSON.parse(await file.text());
    const imported = instantiateCharacter(rawCharacter, createId, placementPoint);
    const importedObjects = imported.objects.map(normalizeObject).filter(Boolean);
    if (!importedObjects.length) {
      throw new CharacterFileError("The character does not contain usable artwork.");
    }
    checkpoint();
    Object.assign(board.assets, imported.assets);
    board.objects.push(...importedObjects);
    board.rig = normalizeRig({
      bodies: [...board.rig.bodies, ...imported.rig.bodies],
      joints: [...board.rig.joints, ...imported.rig.joints],
    }, board.objects);
    selectedObjects = importedObjects;
    saveBoard();
    updateSelectionControls();
    drawBoard();
    announceStatus(`${imported.name} added with its joints and locks`);
  } catch (error) {
    console.error(`Unable to import ${file.name}.`, error);
    announceStatus(
      error instanceof CharacterFileError
        ? error.message
        : "Character file could not be read",
    );
  }
}

async function handleClipboardPaste(event) {
  if (textEditorSession || isEditingControl(event.target)) return;
  const imageFiles = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (imageFiles.length) {
    event.preventDefault();
    if (animationPanelOpen) {
      await addAnimationImageFiles(imageFiles);
    } else {
      await addImageFiles(imageFiles, getCanvasCenterWorldPoint());
    }
    return;
  }
  if (animationPanelOpen) return;
  if (objectClipboard.length) {
    event.preventDefault();
    pasteSelection();
  }
}

function getCanvasCenterWorldPoint() {
  const bounds = canvas.getBoundingClientRect();
  return screenToWorld({
    x: bounds.width / 2,
    y: bounds.height / 2,
  });
}

async function addImageFiles(files, placementPoint) {
  const preparedImages = [];
  for (const file of files) {
    try {
      preparedImages.push(await prepareImage(file));
    } catch (error) {
      console.error(`Unable to read ${file.name}.`, error);
    }
  }
  if (!preparedImages.length) {
    announceStatus("Image could not be read");
    return;
  }

  checkpoint();
  const addedObjects = preparedImages.map((prepared, index) => {
    const assetId = createId();
    board.assets[assetId] = {
      dataUrl: prepared.dataUrl,
      name: prepared.name,
      width: prepared.width,
      height: prepared.height,
    };
    const displayScale = Math.min(1, 720 / prepared.width, 520 / prepared.height);
    const object = {
      id: createId(),
      type: "image",
      x: placementPoint.x + index * 24 / viewport.zoom,
      y: placementPoint.y + index * 24 / viewport.zoom,
      w: prepared.width * displayScale,
      h: prepared.height * displayScale,
      rotation: 0,
      assetId,
      name: prepared.name,
      sourceWidth: prepared.width,
      sourceHeight: prepared.height,
      crop: resetImageCrop(prepared.width, prepared.height),
      flipX: false,
      flipY: false,
      color: "#000000",
      strokeWidth: 1,
      dashPattern: "solid",
      locked: false,
    };
    board.objects.push(object);
    return object;
  });

  selectedObjects = addedObjects;
  const saved = saveBoard();
  updateSelectionControls();
  drawBoard();
  if (saved) {
    announceStatus(`${addedObjects.length} image${addedObjects.length === 1 ? "" : "s"} added locally`);
  }
}

async function prepareImage(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const candidate = new Image();
      candidate.addEventListener("load", () => resolve(candidate), { once: true });
      candidate.addEventListener("error", reject, { once: true });
      candidate.src = objectUrl;
    });
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const stagingCanvas = document.createElement("canvas");
    stagingCanvas.width = width;
    stagingCanvas.height = height;
    const stagingContext = stagingCanvas.getContext("2d");
    stagingContext.drawImage(image, 0, 0, width, height);
    return {
      name: file.name || "Dropped image",
      width,
      height,
      dataUrl: stagingCanvas.toDataURL("image/webp", 0.9),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getVisualBoardAiState() {
  return {
    board: {
      version: BOARD_VERSION,
      revision: getAiContextRevision(),
      objects: cloneValue(board.objects),
      assets: Object.fromEntries(
        Object.entries(board.assets).map(([assetId, asset]) => [
          assetId,
          { name: asset?.name ?? "Local image", bytesIncluded: false },
        ]),
      ),
      rig: cloneValue(board.rig),
      settings: cloneValue(board.settings),
    },
    selectedIds: selectedObjects.map((object) => object.id),
    viewport: {
      ...viewport,
      width: Math.max(1, canvasFrame.clientWidth),
      height: Math.max(1, canvasFrame.clientHeight),
    },
  };
}

function getVisualBoardAiBusyReason() {
  if (interaction || workingObject) return "the active drawing or pointer action";
  if (textEditorSession) return "editing the current textbox";
  if (traceInProgress) return "the current image trace";
  if (interpolationInProgress) return "the current frame interpolation";
  if (animationExportInProgress) return "the current animation export";
  if (colorChangeActive || fillChangeActive || widthChangeActive || textColorChangeActive) {
    return "the active style adjustment";
  }
  return null;
}

function commitVisualBoardAiState(nextState, details = {}) {
  const busyReason = getVisualBoardAiBusyReason();
  if (busyReason) throw new Error(`Finish ${busyReason} before applying AI commands.`);

  const objects = nextState.board.objects
    .map((object) => normalizeObject(object))
    .filter(Boolean);
  if (objects.length !== nextState.board.objects.length) {
    throw new Error("The generated board contained an unsupported object.");
  }
  const objectIds = new Set(objects.map((object) => object.id));
  if (objectIds.size !== objects.length) {
    throw new Error("The generated board contained duplicate object identifiers.");
  }

  const candidateViewport = {
    x: finiteNumber(nextState.viewport?.x, viewport.x),
    y: finiteNumber(nextState.viewport?.y, viewport.y),
    zoom: clamp(
      finiteNumber(nextState.viewport?.zoom, viewport.zoom),
      VISUAL_BOARD_MIN_ZOOM,
      VISUAL_BOARD_MAX_ZOOM,
    ),
  };
  const candidate = {
    ...board,
    version: BOARD_VERSION,
    objects,
    rig: normalizeRig(nextState.board.rig, objects),
    settings: normalizeBoardSettings({
      ...board.settings,
      ...nextState.board.settings,
    }),
    view: candidateViewport,
  };
  const candidateContentSignature = getBoardContentSignature(candidate);
  candidate.revision = (board.revision ?? 0)
    + (candidateContentSignature === lastSavedBoardContentSignature ? 0 : 1);

  // Persist the complete candidate before replacing live references. A quota
  // failure therefore leaves the visible board and history untouched.
  localStorage.setItem(BOARD_KEY, JSON.stringify(candidate));

  checkpoint();
  board = candidate;
  viewport = candidateViewport;
  lastSavedBoardContentSignature = candidateContentSignature;
  const objectsById = new Map(board.objects.map((object) => [object.id, object]));
  selectedObjects = (nextState.selectedIds ?? [])
    .map((identifier) => objectsById.get(identifier))
    .filter(Boolean);
  closeTextEditor();
  updateHistoryControls();
  updateSelectionControls();
  updateViewControls();
  drawBoard();
  announceStatus(details.summary || "AI command applied");
  return getAiContextRevision();
}

function exportVisualBoardForAi(options = {}) {
  const includeAssets = Boolean(options.includeAssets);
  return {
    format: "vital-pancakes-visual-board",
    version: BOARD_VERSION,
    exportedAt: new Date().toISOString(),
    board: {
      ...cloneValue(board),
      assets: includeAssets
        ? cloneValue(board.assets)
        : Object.fromEntries(Object.entries(board.assets).map(([assetId, asset]) => [
          assetId,
          { name: asset?.name ?? "Local image", omitted: true },
        ])),
      view: { ...viewport },
    },
  };
}

const visualBoardAiApi = installAiPageHost(createVisualBoardAiAdapter({
  getState: getVisualBoardAiState,
  getRevision: getAiContextRevision,
  isBusy: getVisualBoardAiBusyReason,
  commit: commitVisualBoardAiState,
  createId,
  undo: () => {
    const before = history.length;
    undo();
    return { changed: history.length !== before, revision: getAiContextRevision() };
  },
  redo: () => {
    const before = future.length;
    redo();
    return { changed: future.length !== before, revision: getAiContextRevision() };
  },
  exportBoard: exportVisualBoardForAi,
}));

function createAiCommandExampleEnvelope(command = getVisualBoardAiExamples()[0].command) {
  return {
    protocolVersion: 1,
    requestId: `visual-board-${Date.now().toString(36)}`,
    tool: "visual-board",
    mode: "preview",
    expectedRevision: getAiContextRevision(),
    commands: [command],
  };
}

function openAiCommandsDialog() {
  if (!aiCommandsEditor.value.trim()) {
    aiCommandsEditor.value = JSON.stringify(createAiCommandExampleEnvelope(), null, 2);
  }
  aiCommandsStatus.textContent = "Commands are validated before they can change the board.";
  aiCommandsResult.textContent = "";
  aiCommandsDialog.showModal();
  aiCommandsEditor.focus();
}

function parseAiCommandEditor() {
  try {
    return JSON.parse(aiCommandsEditor.value);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }
}

async function runAiCommandEditor(mode) {
  try {
    const envelope = parseAiCommandEditor();
    envelope.mode = mode;
    if (mode === "apply" && envelope.commands.some((command) => (
      ["objects.delete", "objects.disconnect"].includes(command.type)
    ))) {
      const confirmed = window.confirm("Apply this destructive AI command?");
      if (!confirmed) return;
    }
    aiCommandsStatus.textContent = mode === "preview" ? "Preparing preview…" : "Applying…";
    const receipt = await visualBoardAiApi.dispatch(envelope, {
      grantedPermissions: AI_PERMISSION_LEVELS,
    });
    aiCommandsResult.textContent = JSON.stringify(receipt, null, 2);
    aiCommandsStatus.textContent = receipt.ok
      ? mode === "preview"
        ? `Preview ready · ${receipt.result?.summary ?? "valid command"}`
        : `Applied · ${receipt.result?.summary ?? "board updated"}`
      : `${receipt.error.code}: ${receipt.error.message}`;
  } catch (error) {
    aiCommandsStatus.textContent = error.message || "Unable to read this command.";
    aiCommandsResult.textContent = "";
  }
}

function loadSelectedAiExample() {
  const examples = getVisualBoardAiExamples();
  const example = examples[Number(aiCommandsExample.value)] ?? examples[0];
  aiCommandsEditor.value = JSON.stringify(
    createAiCommandExampleEnvelope(example.command),
    null,
    2,
  );
  aiCommandsStatus.textContent = `${example.name} example loaded.`;
}

drawingTools.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");
  if (button) setActiveTool(button.dataset.tool);
});
canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", handlePointerCancel);
canvas.addEventListener("pointerleave", () => {
  if (interaction) return;
  hoverPoint = null;
  if (
    activeTool === "eraser"
    || board.objects.some((object) => object.semantic?.role?.startsWith("floor-plan-labeler"))
  ) drawBoard();
});
canvas.addEventListener("dblclick", handleDoubleClick);
canvas.addEventListener("wheel", handleWheel, { passive: false });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvasFrame.addEventListener("dragenter", (event) => {
  if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) {
    event.preventDefault();
    canvasFrame.classList.add("is-drop-target");
  }
});
canvasFrame.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  canvasFrame.classList.add("is-drop-target");
});
canvasFrame.addEventListener("dragleave", (event) => {
  if (!canvasFrame.contains(event.relatedTarget)) canvasFrame.classList.remove("is-drop-target");
});
canvasFrame.addEventListener("drop", handleImageDrop);

canvasFrame.addEventListener("gesturestart", (event) => {
  event.preventDefault();
  interaction = {
    kind: "trackpad-zoom",
    startZoom: viewport.zoom,
    anchor: getCanvasPoint(event),
  };
});
canvasFrame.addEventListener("gesturechange", (event) => {
  event.preventDefault();
  if (interaction?.kind === "trackpad-zoom") {
    setZoom(interaction.startZoom * event.scale, interaction.anchor);
  }
});
canvasFrame.addEventListener("gestureend", (event) => {
  event.preventDefault();
  if (interaction?.kind === "trackpad-zoom") interaction = null;
});

document.querySelector("#undo-board").addEventListener("click", undo);
document.querySelector("#redo-board").addEventListener("click", redo);
document.querySelector("#zoom-in").addEventListener("click", () => setZoom(viewport.zoom * 1.25));
document.querySelector("#zoom-out").addEventListener("click", () => setZoom(viewport.zoom * 0.8));
animationToggleButton.addEventListener("click", () => toggleAnimationPanel());
document.querySelector("#close-animation").addEventListener("click", () => {
  toggleAnimationPanel(false);
  animationToggleButton.focus({ preventScroll: true });
});
boardLibraryToggleButton.addEventListener("click", () => toggleBoardLibraryPanel());
boardLibraryCloseButton.addEventListener("click", () => {
  toggleBoardLibraryPanel(false);
  boardLibraryToggleButton.focus({ preventScroll: true });
});
floorPlanToggleButton.addEventListener("click", () => toggleFloorPlanPanel());
document.querySelector("#close-floor-plan").addEventListener("click", () => {
  toggleFloorPlanPanel(false);
  floorPlanToggleButton.focus({ preventScroll: true });
});
floorPlanPanel.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const tabButton = target?.closest("[data-floor-plan-tab]");
  if (tabButton) {
    setActiveFloorPlanTab(tabButton.dataset.floorPlanTab);
    return;
  }
  const elementButton = target?.closest("[data-floor-element-action]");
  if (elementButton) {
    handleFloorPlanCatalogAction(elementButton, "element");
    return;
  }
  const templateButton = target?.closest("[data-floor-template-action]");
  if (templateButton) handleFloorPlanCatalogAction(templateButton, "template");
});
floorPlanPanel.addEventListener("keydown", (event) => {
  const tab = event.target instanceof Element
    ? event.target.closest("[data-floor-plan-tab]")
    : null;
  if (!tab || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const index = floorPlanTabs.indexOf(tab);
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const next = floorPlanTabs[
    (index + direction + floorPlanTabs.length) % floorPlanTabs.length
  ];
  setActiveFloorPlanTab(next.dataset.floorPlanTab, true);
});
floorPlanSaveElementButton.addEventListener("click", () => {
  openFloorPlanBuildingBlockDialog(
    "element",
    "create",
    null,
    floorPlanSaveElementButton,
  );
});
floorPlanSaveTemplateButton.addEventListener("click", () => {
  openFloorPlanBuildingBlockDialog(
    "template",
    "create",
    null,
    floorPlanSaveTemplateButton,
  );
});
floorPlanTemplateForm.addEventListener("submit", saveFloorPlanBuildingBlockDialog);
document.querySelector("#cancel-floor-plan-template").addEventListener(
  "click",
  closeFloorPlanTemplateDialog,
);
document.querySelector("#close-floor-plan-template-dialog").addEventListener(
  "click",
  closeFloorPlanTemplateDialog,
);
floorPlanTemplateDialog.addEventListener("close", restoreFloorPlanTemplateDialogFocus);
[floorPlanUnits, floorPlanScale, floorPlanWallThickness, floorPlanGridSize,
  floorPlanGuides, floorPlanDimensionsVisible, floorPlanLabelsVisible]
  .forEach((control) => control.addEventListener("change", updateFloorPlanSettings));
boardLibrarySearch.addEventListener("input", renderBoardLibrary);
boardLibraryList.addEventListener("click", handleBoardLibraryAction);
boardLibrarySaveSelectionButton.addEventListener("click", openBoardLibrarySaveDialog);
saveToLibraryButton.addEventListener("click", openBoardLibrarySaveDialog);
boardLibrarySaveForm.addEventListener("submit", saveSelectionToBoardLibrary);
boardLibrarySaveCancelButton.addEventListener("click", closeBoardLibrarySaveDialog);
boardLibrarySaveCloseButton.addEventListener("click", closeBoardLibrarySaveDialog);
boardLibrarySaveDialog.addEventListener("close", restoreBoardLibraryDialogFocus);
document.querySelector("#add-animation-frame").addEventListener("click", addBlankAnimationFrame);
duplicateAnimationFrameButton.addEventListener("click", duplicateSelectedAnimationFrame);
deleteAnimationFrameButton.addEventListener("click", deleteSelectedAnimationFrame);
animationPlayButton.addEventListener("click", toggleAnimationPlayback);
animationPreviewPlayButton.addEventListener("click", toggleAnimationPlayback);
animationPreviewFullscreenButton.addEventListener("click", toggleAnimationPreviewFullscreen);
animationPanelResizeHandle.addEventListener("pointerdown", beginAnimationPanelResize);
animationPanelResizeHandle.addEventListener("keydown", resizeAnimationPanelWithKeyboard);
animationPreviewResizeHandle.addEventListener("pointerdown", beginAnimationPreviewResize);
animationPreviewResizeHandle.addEventListener("keydown", resizeAnimationPreviewWithKeyboard);
animationExportButton.addEventListener("click", exportAnimation);
animationExportCancelButton.addEventListener("click", cancelAnimationExport);
animationDurationInput.addEventListener("change", () => {
  setAnimationFrameDuration(animationDurationInput.value);
});
document.querySelector("#animation-slower").addEventListener("click", () => {
  setAnimationFrameDuration(board.animation.frameDurationMs + 25);
});
document.querySelector("#animation-faster").addEventListener("click", () => {
  setAnimationFrameDuration(board.animation.frameDurationMs - 25);
});
animationFrameList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const interpolationButton = target?.closest("[data-interpolation-start]");
  if (interpolationButton) {
    openInterpolationDialog(
      interpolationButton.dataset.interpolationStart,
      interpolationButton.dataset.interpolationEnd,
      interpolationButton,
    );
    return;
  }
  const button = target
    ? target.closest("[data-frame-id]")
    : null;
  if (button) selectAnimationFrame(button.dataset.frameId);
});
interpolationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  generateRequestedIntermediateFrames();
});
cancelInterpolationButton.addEventListener("click", cancelFrameInterpolation);
document.querySelector("#close-interpolation-dialog").addEventListener(
  "click",
  cancelFrameInterpolation,
);
interpolationDialog.addEventListener("cancel", (event) => {
  if (!interpolationInProgress) return;
  event.preventDefault();
  cancelFrameInterpolation();
});
interpolationDialog.addEventListener("close", restoreInterpolationFocus);
animationPreview.addEventListener("keydown", (event) => {
  if (event.target !== animationPreview || event.code !== "Space") return;
  event.preventDefault();
  event.stopPropagation();
  toggleAnimationPlayback();
});
document.addEventListener("fullscreenchange", updateAnimationFullscreenButton);
animationPanel.addEventListener("dragenter", (event) => {
  if ([...(event.dataTransfer?.items ?? [])].some((item) => item.type.startsWith("image/"))) {
    event.preventDefault();
    animationPanel.classList.add("is-drop-target");
  }
});
animationPanel.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  animationPanel.classList.add("is-drop-target");
});
animationPanel.addEventListener("dragleave", (event) => {
  if (!animationPanel.contains(event.relatedTarget)) {
    animationPanel.classList.remove("is-drop-target");
  }
});
animationPanel.addEventListener("drop", handleAnimationDrop);
copySelectionButton.addEventListener("click", copySelection);
pasteSelectionButton.addEventListener("click", pasteSelection);
deleteSelectionButton.addEventListener("click", deleteSelection);
lockSelectionButton.addEventListener("click", toggleSelectionLock);
lockDimensionsButton.addEventListener("click", toggleSelectionDimensionLock);
groupSelectionButton.addEventListener("click", groupSelection);
traceImageButton.addEventListener("click", traceSelectedImages);
editImageButton.addEventListener("click", openImageEditDialog);
flipHorizontalButton.addEventListener("click", () => flipSelection("horizontal"));
flipVerticalButton.addEventListener("click", () => flipSelection("vertical"));
toggleArrowStartButton.addEventListener("click", toggleSelectedArrowStart);
mirrorTextToggle.addEventListener("click", () => {
  mirrorTextOnFlip = !mirrorTextOnFlip;
  updateSelectionControls();
});
mergeVerticesButton.addEventListener("click", mergeSelectionVertices);
addCurveVertexButton.addEventListener("click", toggleCurveVertexInsertion);
ungroupSelectionButton.addEventListener("click", ungroupSelection);
exportCharacterButton.addEventListener("click", exportSelectedCharacter);
boardExportButton.addEventListener("click", exportBoardArtwork);
colorInput.addEventListener("input", applySelectedColor);
colorInput.addEventListener("change", finishColorChange);
colorInput.addEventListener("blur", finishColorChange);
fillColorInput.addEventListener("input", applySelectedFillColor);
fillColorInput.addEventListener("change", finishFillChange);
fillColorInput.addEventListener("blur", finishFillChange);
bucketFillTool.addEventListener("click", () => {
  setActiveTool(activeTool === "bucket" ? "select" : "bucket");
});
clearFillButton.addEventListener("click", clearSelectedFill);
widthInput.addEventListener("input", applySelectedStrokeWidth);
widthInput.addEventListener("change", finishWidthChange);
widthInput.addEventListener("blur", finishWidthChange);
patternInput.addEventListener("change", applySelectedStrokePattern);
textFontInput.addEventListener("change", applySelectedTextFont);
textSizeInput.addEventListener("change", applySelectedTextSize);
textColorInput.addEventListener("pointerdown", captureActiveTextColorSelection);
textColorInput.addEventListener("focus", captureActiveTextColorSelection);
textColorInput.addEventListener("input", applySelectedTextColor);
textColorInput.addEventListener("change", finishTextColorChange);
textColorInput.addEventListener("blur", finishTextColorChange);
gridToggle.addEventListener("click", () => {
  board.settings.grid = !board.settings.grid;
  updateViewControls();
  saveBoard();
  drawBoard();
});
snapToggle.addEventListener("click", () => {
  board.settings.snap = !board.settings.snap;
  updateViewControls();
  saveBoard();
  drawBoard();
});
aiCommandsButton.addEventListener("click", openAiCommandsDialog);
imageEditForm.addEventListener("submit", applyImageEdits);
document.querySelector("#cancel-image-edit").addEventListener("click", closeImageEditDialog);
document.querySelector("#close-image-edit").addEventListener("click", closeImageEditDialog);
imageEditDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeImageEditDialog();
});
imageCropPreview.addEventListener("load", updateImageCropBox);
imageCropBox.addEventListener("pointerdown", beginCropPointerInteraction);
imageCropBox.addEventListener("keydown", moveCropWithKeyboard);
imageCropAspect.addEventListener("change", updateCropAspect);
imageWidthInput.addEventListener("change", () => updateImageFrameDimension("width"));
imageHeightInput.addEventListener("change", () => updateImageFrameDimension("height"));
imageRotationInput.addEventListener("change", () => {
  if (imageEditSession) {
    imageEditSession.object.rotation = Number(imageRotationInput.value || 0) * Math.PI / 180;
  }
});
imageReplaceInput.addEventListener("change", () => {
  replaceEditedImage(imageReplaceInput.files?.[0]);
});
imageEditDialog.addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-image-action]")
    : null;
  if (button) handleImageEditAction(button.dataset.imageAction);
});
document.querySelector("#load-ai-command-example").addEventListener(
  "click",
  loadSelectedAiExample,
);
document.querySelector("#copy-ai-command-schema").addEventListener("click", async () => {
  const capabilities = getVisualBoardAiCapabilities();
  try {
    await navigator.clipboard.writeText(JSON.stringify(capabilities, null, 2));
    aiCommandsStatus.textContent = "Capabilities copied.";
  } catch {
    aiCommandsResult.textContent = JSON.stringify(capabilities, null, 2);
    aiCommandsStatus.textContent = "Clipboard access was unavailable; capabilities are shown below.";
  }
});
document.querySelector("#format-ai-commands").addEventListener("click", () => {
  try {
    aiCommandsEditor.value = JSON.stringify(parseAiCommandEditor(), null, 2);
    aiCommandsStatus.textContent = "Command JSON formatted.";
  } catch (error) {
    aiCommandsStatus.textContent = error.message;
  }
});
document.querySelector("#clear-ai-commands").addEventListener("click", () => {
  aiCommandsEditor.value = "";
  aiCommandsResult.textContent = "";
  aiCommandsStatus.textContent = "Command editor cleared.";
});
document.querySelector("#preview-ai-commands").addEventListener(
  "click",
  () => runAiCommandEditor("preview"),
);
document.querySelector("#apply-ai-commands").addEventListener(
  "click",
  () => runAiCommandEditor("apply"),
);

document.querySelector("#clear-board").addEventListener("click", () => {
  const confirmed = window.confirm("Clear the entire board? This cannot be undone.");
  if (!confirmed) return;

  checkpoint();
  board.objects = [];
  board.rig = createEmptyRig();
  board.animation = normalizeAnimation();
  selectedAnimationFrameId = null;
  selectedObjects = [];
  stopAnimationPlayback();
  closeTextEditor();
  saveBoard();
  renderAnimationPanel();
  updateSelectionControls();
  drawBoard();
});

document.addEventListener("keydown", handleKeyDown);
document.addEventListener("keyup", handleKeyUp);
document.addEventListener("paste", handleClipboardPaste);
window.addEventListener("resize", () => {
  applyAnimationPanelWidth(getCurrentAnimationPanelWidth());
  applyAnimationPreviewHeight(getCurrentAnimationPreviewHeight());
  updateImageCropBox();
  resizeCanvas();
});
new ResizeObserver(resizeCanvas).observe(canvasFrame);

initializeLinePicker();
initializeShapePickers();
renderFloorPlanCatalog();
syncFloorPlanControls();
toolWorkspace.classList.toggle("is-floor-plan-open", floorPlanPanelOpen);
floorPlanPanel.setAttribute("aria-hidden", String(!floorPlanPanelOpen));
floorPlanPanel.inert = !floorPlanPanelOpen;
floorPlanToggleButton.setAttribute("aria-expanded", String(floorPlanPanelOpen));
floorPlanToggleButton.classList.toggle("is-active", floorPlanPanelOpen);
restoreAnimationLayout();
animationPanel.inert = true;
boardLibraryPanel.inert = true;
setAnimationExportBusy(false);
updateAnimationFullscreenButton();
renderAnimationPanel();
renderBoardLibrary();
updateHistoryControls();
updateSelectionControls();
updateViewControls();
updateCanvasCursor();
document.querySelector("#zoom-value").textContent = `${Math.round(viewport.zoom * 100)}%`;
resizeCanvas();
