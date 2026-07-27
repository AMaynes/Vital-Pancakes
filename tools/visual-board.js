/**
 * Infinite, local-first visual workspace for drawing, diagramming, text, and
 * dropped images. Every board item remains an editable vector-style object.
 */

import { createId, isDeletePasswordValid } from "../app/store.js";
import {
  LINE_TYPES,
  SHAPE_TYPES,
  clamp,
  distanceBetween,
  getObjectBounds,
  getObjectSegments,
  getShapeCenter,
  getShapeCorners,
  isExplodableObject,
  normalizeShape,
  objectIntersectsRectangle,
  pointHitsObject,
  resizeShapeFromCorner,
  snapValue,
} from "./visual-board-geometry.mjs";

const BOARD_KEY = "artificially-neuroscience-visual-board-v1";
const BOARD_VERSION = 4;
const HISTORY_LIMIT = 300;
const GRID_SIZE = 32;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const MIN_SHAPE_SIZE = 16;
const HANDLE_SIZE = 6;
const ROTATION_HANDLE_OFFSET = 28;
const DEFAULT_TEXTBOX_WIDTH = 210;
const DEFAULT_TEXTBOX_HEIGHT = 72;
const MAX_IMAGE_DIMENSION = 1800;
const DASH_PATTERNS = new Set(["solid", "dashed", "dotted", "dash-dot", "long-dash"]);
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
const widthInput = document.querySelector("#stroke-width");
const widthValue = document.querySelector("#stroke-width-value");
const patternInput = document.querySelector("#stroke-pattern");
const shape2dInput = document.querySelector("#shape-2d");
const shape3dInput = document.querySelector("#shape-3d");
const drawingTools = document.querySelector("#drawing-tools");
const selectionActions = document.querySelector("#selection-actions");
const selectionCount = document.querySelector("#selection-count");
const lockSelectionButton = document.querySelector("#lock-selection");
const groupSelectionButton = document.querySelector("#group-selection");
const ungroupSelectionButton = document.querySelector("#ungroup-selection");
const explodeSelectionButton = document.querySelector("#explode-selection");
const reassembleSelectionButton = document.querySelector("#reassemble-selection");
const deleteSelectionButton = document.querySelector("#delete-selection");
const gridToggle = document.querySelector("#toggle-grid");
const snapToggle = document.querySelector("#toggle-snap");
const saveStatus = document.querySelector("#save-status");

let board = loadBoard();
let viewport = { ...board.view };
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

const imageCache = new Map();

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
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
    return {
      version: BOARD_VERSION,
      objects: rawObjects
        .map((object) => normalizeObject(object, { snapToGrid }))
        .filter(Boolean),
      assets: savedBoard?.assets && typeof savedBoard.assets === "object"
        ? savedBoard.assets
        : {},
      settings: {
        grid: savedBoard?.settings?.grid ?? true,
        snap: savedBoard?.settings?.snap ?? false,
      },
      view: {
        x: finiteNumber(savedBoard?.view?.x, 0),
        y: finiteNumber(savedBoard?.view?.y, 0),
        zoom: clamp(finiteNumber(savedBoard?.view?.zoom, 1), MIN_ZOOM, MAX_ZOOM),
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
    objects: [],
    assets: {},
    settings: { grid: true, snap: false },
    view: { x: 0, y: 0, zoom: 1 },
  };
}

function normalizeObject(rawObject, options = {}) {
  if (!rawObject || typeof rawObject !== "object") return null;

  const type = rawObject.type === "note" ? "textbox" : rawObject.type;
  const strokeWidth = clamp(
    finiteNumber(rawObject.strokeWidth ?? rawObject.width, 3),
    1,
    24,
  );
  const common = {
    id: rawObject.id || createId(),
    type,
    color: typeof rawObject.color === "string" ? rawObject.color : "#000000",
    strokeWidth,
    dashPattern: DASH_PATTERNS.has(rawObject.dashPattern) ? rawObject.dashPattern : "solid",
    locked: Boolean(rawObject.locked),
    ...(typeof rawObject.groupId === "string" && rawObject.groupId
      ? { groupId: rawObject.groupId }
      : {}),
  };

  if (type === "pen") {
    const points = Array.isArray(rawObject.points)
      ? rawObject.points
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
        .map((point) => ({ x: point.x, y: point.y }))
      : [];
    return points.length ? { ...common, points } : null;
  }

  if (LINE_TYPES.has(type)) {
    return {
      ...common,
      x: finiteNumber(rawObject.x, 0),
      y: finiteNumber(rawObject.y, 0),
      endX: finiteNumber(rawObject.endX, finiteNumber(rawObject.x, 0)),
      endY: finiteNumber(rawObject.endY, finiteNumber(rawObject.y, 0)),
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
      const defaultDepth = getCubeDepth(normalized, options.snapToGrid);
      normalized.shapeDepthX = finiteNumber(rawObject.shapeDepthX, defaultDepth);
      normalized.shapeDepthY = finiteNumber(rawObject.shapeDepthY, defaultDepth);
    }
    return normalized;
  }

  if (type === "textbox") {
    return normalizeShape({
      ...common,
      x: finiteNumber(rawObject.x, 0),
      y: finiteNumber(rawObject.y, 0),
      w: finiteNumber(rawObject.w ?? rawObject.noteWidth, DEFAULT_TEXTBOX_WIDTH),
      h: finiteNumber(rawObject.h ?? rawObject.noteHeight, DEFAULT_TEXTBOX_HEIGHT),
      rotation: finiteNumber(rawObject.rotation, 0),
      text: typeof rawObject.text === "string" ? rawObject.text : "",
      fontSize: clamp(finiteNumber(rawObject.fontSize, 18), 8, 96),
    });
  }

  if (type === "image" && rawObject.assetId) {
    return normalizeShape({
      ...common,
      x: finiteNumber(rawObject.x, 0),
      y: finiteNumber(rawObject.y, 0),
      w: finiteNumber(rawObject.w, 480),
      h: finiteNumber(rawObject.h, 320),
      rotation: finiteNumber(rawObject.rotation, 0),
      assetId: rawObject.assetId,
      name: typeof rawObject.name === "string" ? rawObject.name : "Dropped image",
    });
  }

  return null;
}

function saveBoard() {
  board.view = { ...viewport };
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(board));
    saveStatus.textContent = "Saved locally";
    saveStatus.classList.remove("has-error");
    return true;
  } catch (error) {
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
  history.push(cloneValue(board.objects));
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
  return {
    x: snapValue(point.x, GRID_SIZE),
    y: snapValue(point.y, GRID_SIZE),
  };
}

function getCubeDepth(object, snapToGrid = false) {
  const minimumDimension = Math.min(Math.abs(object.w), Math.abs(object.h));
  if (!snapToGrid) return Math.max(1, minimumDimension * 0.22);
  const gridSizedDimension = Math.max(GRID_SIZE * 2, minimumDimension);
  const desiredDepth = snapValue(gridSizedDimension * 0.22, GRID_SIZE);
  return clamp(desiredDepth, GRID_SIZE, gridSizedDimension - GRID_SIZE);
}

function alignCubeToGrid(object) {
  if (object.shapeKind !== "cube" || !board.settings.snap) return object;
  object.w = Math.max(GRID_SIZE * 2, object.w);
  object.h = Math.max(GRID_SIZE * 2, object.h);
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

  board.objects.forEach(drawObject);
  if (workingObject) drawObject(workingObject);

  if (includeInteractionUi) {
    drawMarquee();
    drawSelection();
    drawEraserCursor();
  }

  if (textEditorSession) positionTextEditor();
}

function drawGrid(pixelRatio) {
  const cssWidth = canvas.width / pixelRatio;
  const cssHeight = canvas.height / pixelRatio;
  const worldRight = viewport.x + cssWidth / viewport.zoom;
  const worldBottom = viewport.y + cssHeight / viewport.zoom;
  const firstX = Math.floor(viewport.x / GRID_SIZE) * GRID_SIZE;
  const firstY = Math.floor(viewport.y / GRID_SIZE) * GRID_SIZE;

  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.lineWidth = 0.7;

  const drawGridTier = (major) => {
    context.beginPath();
    for (let worldX = firstX; worldX <= worldRight; worldX += GRID_SIZE) {
      const isMajor = Math.round(worldX / GRID_SIZE) % 5 === 0;
      if (isMajor !== major) continue;
      const screenX = (worldX - viewport.x) * viewport.zoom;
      context.moveTo(screenX, 0);
      context.lineTo(screenX, cssHeight);
    }
    for (let worldY = firstY; worldY <= worldBottom; worldY += GRID_SIZE) {
      const isMajor = Math.round(worldY / GRID_SIZE) % 5 === 0;
      if (isMajor !== major) continue;
      const screenY = (worldY - viewport.y) * viewport.zoom;
      context.moveTo(0, screenY);
      context.lineTo(cssWidth, screenY);
    }
    context.strokeStyle = major ? "rgb(24 23 20 / 12%)" : "rgb(24 23 20 / 5%)";
    context.stroke();
  };

  if (GRID_SIZE * viewport.zoom >= 9) drawGridTier(false);
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
  context.setLineDash(getDashArray(object.dashPattern, object.strokeWidth));

  if (object.type === "pen") {
    drawPenStroke(object.points);
  } else if (object.type === "line") {
    drawLine(object);
  } else if (LINE_TYPES.has(object.type)) {
    drawConnector(object);
  } else if (object.type === "shape") {
    drawSegments(getObjectSegments(object));
  } else if (SHAPE_TYPES.has(object.type)) {
    withShapeTransform(object, () => {
      if (object.type === "rectangle") {
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
        context.stroke();
      } else if (object.type === "textbox") {
        drawTextbox(object);
      } else if (object.type === "image") {
        drawImageObject(object);
      }
    });
  }
  context.restore();
}

function getDashArray(pattern = "solid", strokeWidth = 1) {
  const unit = Math.max(1, strokeWidth);
  if (pattern === "dashed") return [unit * 5, unit * 3.2];
  if (pattern === "dotted") return [0.01, unit * 2.8];
  if (pattern === "dash-dot") return [unit * 6, unit * 2.6, 0.01, unit * 2.6];
  if (pattern === "long-dash") return [unit * 9, unit * 3.5];
  return [];
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
  context.beginPath();
  context.moveTo(object.endX, object.endY);
  context.lineTo(
    object.endX - arrowSize * Math.cos(angle - Math.PI / 6),
    object.endY - arrowSize * Math.sin(angle - Math.PI / 6),
  );
  context.lineTo(
    object.endX - arrowSize * Math.cos(angle + Math.PI / 6),
    object.endY - arrowSize * Math.sin(angle + Math.PI / 6),
  );
  context.closePath();
  context.fill();
}

function drawTextbox(object) {
  const text = object.text.trim() ? object.text : "blank textbox";
  const isPlaceholder = !object.text.trim();
  const padding = 6;
  context.save();
  context.beginPath();
  context.rect(object.x, object.y, object.w, object.h);
  context.clip();
  context.fillStyle = isPlaceholder ? "#a7a7a7" : object.color;
  context.font = `${object.fontSize}px Georgia, "Times New Roman", serif`;
  context.textBaseline = "top";
  const lines = wrapText(text, Math.max(20, object.w - padding * 2));
  const lineHeight = object.fontSize * 1.25;
  lines.forEach((line, index) => {
    context.fillText(line, object.x + padding, object.y + padding + index * lineHeight);
  });
  context.restore();
}

function wrapText(text, maximumWidth) {
  const paragraphs = text.split(/\n/);
  const lines = [];
  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      return;
    }
    let currentLine = "";
    words.forEach((word) => {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (context.measureText(candidate).width > maximumWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    });
    lines.push(currentLine);
  });
  return lines;
}

function drawImageObject(object) {
  const image = getCachedImage(object);
  if (image?.complete && image.naturalWidth) {
    context.drawImage(image, object.x, object.y, object.w, object.h);
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

  context.save();
  context.strokeStyle = selectedObjects.every((object) => object.locked) ? "#777777" : "#7b211a";
  context.fillStyle = "#ffffff";
  context.lineWidth = 1 / viewport.zoom;
  context.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);

  if (selectedObjects.length > 1) {
    const bounds = getSelectionBounds(selectedObjects);
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    if (selectedObjects.some((object) => object.locked)) drawLockBadge(bounds);
    context.restore();
    return;
  }

  const object = selectedObjects[0];
  if (SHAPE_TYPES.has(object.type)) {
    const corners = getShapeCorners(object);
    context.beginPath();
    context.moveTo(corners.nw.x, corners.nw.y);
    context.lineTo(corners.ne.x, corners.ne.y);
    context.lineTo(corners.se.x, corners.se.y);
    context.lineTo(corners.sw.x, corners.sw.y);
    context.closePath();
    context.stroke();

    if (!object.locked) {
      context.setLineDash([]);
      Object.values(corners).forEach((point) => drawHandle(point));
      const rotationHandle = getRotationHandlePoint(object);
      context.beginPath();
      context.moveTo(corners.ne.x, corners.ne.y);
      context.lineTo(rotationHandle.x, rotationHandle.y);
      context.strokeStyle = "#7b211a";
      context.stroke();
      drawHandle(rotationHandle, true);
    }
  } else if (LINE_TYPES.has(object.type)) {
    context.beginPath();
    context.moveTo(object.x, object.y);
    context.lineTo(object.endX, object.endY);
    context.stroke();
    if (!object.locked) {
      context.setLineDash([]);
      drawHandle({ x: object.x, y: object.y });
      drawHandle({ x: object.endX, y: object.endY });
    }
  } else {
    const bounds = getObjectBounds(object);
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  if (object.locked) drawLockBadge(getObjectBounds(object));
  context.restore();
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

function getSelectionBounds(objects) {
  const bounds = objects.map(getObjectBounds);
  const minimumX = Math.min(...bounds.map((item) => item.x));
  const minimumY = Math.min(...bounds.map((item) => item.y));
  const maximumX = Math.max(...bounds.map((item) => item.x + item.width));
  const maximumY = Math.max(...bounds.map((item) => item.y + item.height));
  return {
    x: minimumX,
    y: minimumY,
    width: Math.max(1, maximumX - minimumX),
    height: Math.max(1, maximumY - minimumY),
  };
}

function findObjectAt(point) {
  const padding = 8 / viewport.zoom;
  return board.objects.slice().reverse().find((object) => pointHitsObject(object, point, padding)) ?? null;
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

function findSelectionHandle(point) {
  if (selectedObjects.length !== 1 || selectedObjects[0].locked) return null;
  const object = selectedObjects[0];
  const hitRadius = 11 / viewport.zoom;

  if (SHAPE_TYPES.has(object.type)) {
    const rotationHandle = getRotationHandlePoint(object);
    if (distanceBetween(point, rotationHandle) <= hitRadius) {
      return { kind: "rotate", object };
    }
    const corners = getShapeCorners(object);
    const corner = Object.entries(corners).find(([, handle]) => (
      distanceBetween(point, handle) <= hitRadius
    ));
    if (corner) return { kind: "resize", object, corner: corner[0] };
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

  const screenPoint = getCanvasPoint(event);
  const worldPoint = screenToWorld(screenPoint);
  hoverPoint = worldPoint;
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
    if (event.shiftKey) {
      const unitIsSelected = selectionUnit.every((object) => selectedObjects.includes(object));
      if (unitIsSelected) {
        const unitIds = new Set(selectionUnit.map((object) => object.id));
        selectedObjects = selectedObjects.filter((object) => !unitIds.has(object.id));
        updateSelectionControls();
        drawBoard();
        return;
      }
      selectedObjects = [...new Set([...selectedObjects, ...selectionUnit])];
    } else if (!selectionUnit.every((object) => selectedObjects.includes(object))) {
      selectedObjects = selectionUnit;
    }

    const movableObjects = selectedObjects.filter((object) => !object.locked);
    updateSelectionControls();
    drawBoard();
    if (!movableObjects.length) return;

    interaction = {
      kind: "move",
      pointerId: event.pointerId,
      startScreen: screenPoint,
      startWorld: worldPoint,
      initialBounds: getSelectionBounds(movableObjects),
      originals: new Map(movableObjects.map((object) => [object.id, cloneValue(object)])),
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
    startWorld: worldPoint,
    currentWorld: worldPoint,
    baseSelection,
  };
  updateSelectionControls();
  drawBoard();
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
  if (type === "line" || type === "connector") {
    return { ...common, x: startPoint.x, y: startPoint.y, endX: startPoint.x, endY: startPoint.y };
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
      x: startPoint.x,
      y: startPoint.y,
      w: 0,
      h: 0,
      rotation: 0,
      text: "",
      fontSize: 18,
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
    if (activeTool === "eraser") drawBoard();
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
  } else if (interaction.kind === "endpoint") {
    ensureInteractionCheckpoint();
    const point = getSnappedPoint(worldPoint);
    if (interaction.endpoint === "start") {
      interaction.object.x = point.x;
      interaction.object.y = point.y;
    } else {
      interaction.object.endX = point.x;
      interaction.object.endY = point.y;
    }
    interaction.changed = true;
  } else if (interaction.kind === "erase") {
    interaction.changed = eraseBetween(interaction.lastWorld, worldPoint) || interaction.changed;
    interaction.lastWorld = worldPoint;
  } else if (interaction.kind === "marquee") {
    interaction.currentWorld = worldPoint;
    const rectangle = getRectangleFromPoints(interaction.startWorld, interaction.currentWorld);
    const enclosed = board.objects.filter((object) => objectIntersectsRectangle(object, rectangle));
    selectedObjects = expandGroupedObjects([...new Set([...interaction.baseSelection, ...enclosed])]);
    updateSelectionControls();
  }

  updateCanvasCursor(worldPoint);
  drawBoard();
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
  if (LINE_TYPES.has(workingObject.type)) {
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

  let deltaX = worldPoint.x - interaction.startWorld.x;
  let deltaY = worldPoint.y - interaction.startWorld.y;
  if (board.settings.snap) {
    deltaX = snapValue(interaction.initialBounds.x + deltaX, GRID_SIZE) - interaction.initialBounds.x;
    deltaY = snapValue(interaction.initialBounds.y + deltaY, GRID_SIZE) - interaction.initialBounds.y;
  }

  selectedObjects.filter((object) => !object.locked).forEach((object) => {
    moveObject(object, deltaX, deltaY);
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

  if (finishedInteraction.kind === "draw") {
    if (!cancelled) commitWorkingObject();
    workingObject = null;
  } else if (finishedInteraction.kind === "erase") {
    if (finishedInteraction.changed) {
      selectedObjects = selectedObjects.filter((object) => board.objects.includes(object));
      saveBoard();
    } else {
      history.pop();
      updateHistoryControls();
    }
  } else if (["move", "resize", "rotate", "endpoint"].includes(finishedInteraction.kind)) {
    if (finishedInteraction.changed) saveBoard();
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
    object.w = DEFAULT_TEXTBOX_WIDTH;
    object.h = DEFAULT_TEXTBOX_HEIGHT;
  }

  const bounds = getObjectBounds(object);
  const isValid = object.type === "pen"
    || object.type === "textbox"
    || bounds.width > 3
    || bounds.height > 3;
  if (!isValid) return;

  checkpoint();
  board.objects.push(object);
  selectedObjects = [object];
  saveBoard();
  updateSelectionControls();
  if (object.type !== "pen") setActiveTool("select");

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
    if (object.locked || object.type === "image") {
      nextObjects.push(object);
      return;
    }
    if (object.type === "pen") {
      const fragments = splitPenStroke(object, point, radius);
      if (fragments.length !== 1 || fragments[0] !== object) changed = true;
      nextObjects.push(...fragments);
      return;
    }
    if (pointHitsObject(object, point, radius)) {
      changed = true;
      return;
    }
    nextObjects.push(object);
  });

  if (changed) board.objects = nextObjects;
  return changed;
}

function splitPenStroke(object, eraserPoint, radius) {
  const effectiveRadius = radius + object.strokeWidth / 2;
  const runs = [];
  let currentRun = [];
  let removedPoint = false;

  object.points.forEach((point) => {
    if (distanceBetween(point, eraserPoint) <= effectiveRadius) {
      removedPoint = true;
      if (currentRun.length) runs.push(currentRun);
      currentRun = [];
    } else {
      currentRun.push(point);
    }
  });
  if (currentRun.length) runs.push(currentRun);
  if (!removedPoint) return [object];

  return runs
    .filter((run) => run.length >= 2)
    .map((points, index) => ({
      ...object,
      id: index === 0 ? object.id : createId(),
      points,
    }));
}

function undo() {
  closeTextEditor();
  const snapshot = history.pop();
  if (!snapshot) return;
  future.push(cloneValue(board.objects));
  board.objects = cloneValue(snapshot).map(normalizeObject).filter(Boolean);
  selectedObjects = [];
  saveBoard();
  updateHistoryControls();
  updateSelectionControls();
  drawBoard();
}

function redo() {
  closeTextEditor();
  const snapshot = future.pop();
  if (!snapshot) return;
  history.push(cloneValue(board.objects));
  board.objects = cloneValue(snapshot).map(normalizeObject).filter(Boolean);
  selectedObjects = [];
  saveBoard();
  updateHistoryControls();
  updateSelectionControls();
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

function setZoom(nextZoom, anchorScreenPoint = null) {
  const bounds = canvas.getBoundingClientRect();
  const anchor = anchorScreenPoint ?? { x: bounds.width / 2, y: bounds.height / 2 };
  const worldAtAnchor = screenToWorld(anchor);
  viewport.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
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

function exportBoard() {
  drawBoard(false);
  const link = document.createElement("a");
  link.download = `visual-board-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  drawBoard();
}

function updateSelectionControls() {
  selectionActions.hidden = selectedObjects.length === 0;
  selectionCount.textContent = selectedObjects.length === 1
    ? "1 selected"
    : `${selectedObjects.length} selected`;

  if (!selectedObjects.length) return;
  const allLocked = selectedObjects.every((object) => object.locked);
  const anyLocked = selectedObjects.some((object) => object.locked);
  lockSelectionButton.classList.toggle("is-active", anyLocked);
  lockSelectionButton.setAttribute("aria-pressed", String(anyLocked));
  lockSelectionButton.title = allLocked ? "Unlock selection" : "Lock selection";
  lockSelectionButton.querySelector(".tool-button-label").textContent = allLocked ? "Unlock" : "Lock";
  deleteSelectionButton.disabled = allLocked;
  groupSelectionButton.disabled = selectedObjects.length < 2 || anyLocked;
  ungroupSelectionButton.disabled = anyLocked
    || !selectedObjects.some((object) => Boolean(object.groupId));
  explodeSelectionButton.disabled = anyLocked
    || !selectedObjects.some((object) => object.type !== "line" && isExplodableObject(object));
  reassembleSelectionButton.disabled = !getSelectedCompleteAssemblies().length;

  const styleObject = selectedObjects.find((object) => (
    object.type !== "image" && object.type !== "textbox"
  )) ?? selectedObjects.find((object) => object.type !== "image");
  if (styleObject) {
    colorInput.value = styleObject.color;
    widthInput.value = styleObject.strokeWidth;
    widthValue.textContent = styleObject.strokeWidth;
    patternInput.value = styleObject.dashPattern ?? "solid";
  }
}

function assembleSelection() {
  if (selectedObjects.length < 2 || selectedObjects.some((object) => object.locked)) return;
  checkpoint();
  const groupId = createId();
  selectedObjects.forEach((object) => {
    object.groupId = groupId;
  });
  saveBoard();
  updateSelectionControls();
  drawBoard();
  announceStatus(`${selectedObjects.length} objects assembled`);
}

function releaseSelection() {
  const groupIds = new Set(selectedObjects.map((object) => object.groupId).filter(Boolean));
  if (!groupIds.size || selectedObjects.some((object) => object.locked)) return;
  checkpoint();
  board.objects.forEach((object) => {
    if (groupIds.has(object.groupId)) delete object.groupId;
  });
  saveBoard();
  updateSelectionControls();
  drawBoard();
  announceStatus("Assembly released");
}

function divideSelection() {
  const targets = new Set(selectedObjects.filter((object) => (
    !object.locked && object.type !== "line" && isExplodableObject(object)
  )));
  if (!targets.size) return;

  checkpoint();
  const dividedLines = [];
  board.objects = board.objects.flatMap((object) => {
    if (!targets.has(object)) return [object];
    const segments = getObjectSegments(object);
    if (!segments.length) return [object];
    const assemblyId = createId();
    const assemblySource = cloneValue(object);
    const lines = segments.map(([start, end], index) => ({
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
      assemblyId,
      assemblyIndex: index,
      assemblyCount: segments.length,
      assemblySource,
    }));
    dividedLines.push(...lines);
    return lines;
  });
  selectedObjects = dividedLines;
  saveBoard();
  updateSelectionControls();
  drawBoard();
  announceStatus(`${targets.size} shape${targets.size === 1 ? "" : "s"} divided into lines`);
}

function getCompleteAssembly(assemblyId) {
  const members = board.objects
    .filter((object) => object.assemblyId === assemblyId)
    .sort((first, second) => first.assemblyIndex - second.assemblyIndex);
  if (!members.length || !members[0].assemblySource) return null;
  const expectedCount = members[0].assemblyCount;
  const indices = new Set(members.map((object) => object.assemblyIndex));
  if (members.length !== expectedCount || indices.size !== expectedCount) return null;
  return members;
}

function getSelectedCompleteAssemblies() {
  const assemblyIds = new Set(
    selectedObjects.map((object) => object.assemblyId).filter(Boolean),
  );
  return [...assemblyIds]
    .map((assemblyId) => ({ assemblyId, members: getCompleteAssembly(assemblyId) }))
    .filter((assembly) => assembly.members);
}

function reassembleSelection() {
  const assemblies = getSelectedCompleteAssemblies();
  if (!assemblies.length) {
    announceStatus("Select all remaining parts of a divided shape");
    return;
  }

  checkpoint();
  const assemblyIds = new Set(assemblies.map((assembly) => assembly.assemblyId));
  const restoredByAssemblyId = new Map();
  assemblies.forEach(({ assemblyId, members }) => {
    const source = cloneValue(members[0].assemblySource);
    const colors = new Set(members.map((object) => object.color));
    const widths = new Set(members.map((object) => object.strokeWidth));
    const patterns = new Set(members.map((object) => object.dashPattern));
    if (colors.size === 1) source.color = members[0].color;
    if (widths.size === 1) source.strokeWidth = members[0].strokeWidth;
    if (patterns.size === 1) source.dashPattern = members[0].dashPattern;
    restoredByAssemblyId.set(assemblyId, normalizeObject(source));
  });

  const insertedAssemblyIds = new Set();
  board.objects = board.objects.flatMap((object) => {
    if (!assemblyIds.has(object.assemblyId)) return [object];
    if (insertedAssemblyIds.has(object.assemblyId)) return [];
    insertedAssemblyIds.add(object.assemblyId);
    const restored = restoredByAssemblyId.get(object.assemblyId);
    return restored ? [restored] : [];
  });
  selectedObjects = [...restoredByAssemblyId.values()].filter(Boolean);
  saveBoard();
  updateSelectionControls();
  drawBoard();
  announceStatus(`${selectedObjects.length} shape${selectedObjects.length === 1 ? "" : "s"} reassembled`);
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
  selectedObjects = selectedObjects.filter((object) => !deletedIds.has(object.id));
  closeTextEditor();
  saveBoard();
  updateSelectionControls();
  drawBoard();
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
  drawBoard();
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
  gridToggle.classList.toggle("is-active", board.settings.grid);
  snapToggle.classList.toggle("is-active", board.settings.snap);
  gridToggle.setAttribute("aria-pressed", String(board.settings.grid));
  snapToggle.setAttribute("aria-pressed", String(board.settings.snap));
}

function setActiveTool(nextTool) {
  activeTool = nextTool;
  drawingTools.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === activeTool);
  });
  const is2dShape = ["rectangle", "ellipse", "shape:triangle", "shape:diamond", "shape:hexagon"]
    .includes(activeTool);
  const is3dShape = activeTool.startsWith("shape:") && !is2dShape;
  document.querySelector("#shape-2d-control").classList.toggle("is-active", is2dShape);
  document.querySelector("#shape-3d-control").classList.toggle("is-active", is3dShape);
  if (!is2dShape) shape2dInput.value = "";
  if (!is3dShape) shape3dInput.value = "";
  closeTextEditor();
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
  if (activeTool !== "select") {
    canvas.style.cursor = "crosshair";
    return;
  }

  const handle = worldPoint ? findSelectionHandle(worldPoint) : null;
  if (handle?.kind === "rotate") canvas.style.cursor = "crosshair";
  else if (handle?.kind === "endpoint") canvas.style.cursor = "move";
  else if (handle?.kind === "resize") {
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
  canvasFrame.append(editor);

  const historyLength = history.length;
  if (checkpointBeforeEdit) checkpoint();
  textEditorSession = {
    editor,
    object,
    originalText: object.text,
    historyLength,
    checkpointBeforeEdit,
  };

  editor.addEventListener("input", () => {
    object.text = editor.value;
    drawBoard();
  });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeTextEditor(true);
    } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      closeTextEditor();
    }
  });
  editor.addEventListener("blur", () => closeTextEditor(), { once: true });
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
  editor.style.fontSize = `${Math.max(8, object.fontSize * viewport.zoom)}px`;
  editor.style.color = object.color;
  editor.style.transform = `rotate(${object.rotation ?? 0}rad)`;
}

function closeTextEditor(cancel = false) {
  if (!textEditorSession) return;
  const session = textEditorSession;
  textEditorSession = null;

  if (cancel) session.object.text = session.originalText;
  const changed = session.object.text !== session.originalText;
  if (session.checkpointBeforeEdit && (!changed || cancel)) {
    history.splice(session.historyLength);
    updateHistoryControls();
  }
  session.editor.remove();
  if (changed && !cancel) saveBoard();
  drawBoard();
}

function handleDoubleClick(event) {
  const object = findObjectAt(screenToWorld(getCanvasPoint(event)));
  if (object?.type !== "textbox" || object.locked) return;
  selectedObjects = [object];
  updateSelectionControls();
  drawBoard();
  openTextEditor(object);
}

function handleKeyDown(event) {
  if (textEditorSession) return;
  const commandKey = event.metaKey || event.ctrlKey;

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
  if (commandKey && ["+", "=", "-", "_", "0"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "0") setZoom(1);
    else setZoom(viewport.zoom + (["+", "="].includes(event.key) ? 0.1 : -0.1));
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (!selectedObjects.length) return;
    event.preventDefault();
    deleteSelection();
  } else if (event.key === "Escape") {
    selectedObjects = [];
    updateSelectionControls();
    drawBoard();
  } else if (event.code === "Space") {
    event.preventDefault();
    spaceHeld = true;
    updateCanvasCursor();
  }
}

function handleKeyUp(event) {
  if (event.code !== "Space") return;
  spaceHeld = false;
  updateCanvasCursor();
}

async function handleImageDrop(event) {
  event.preventDefault();
  canvasFrame.classList.remove("is-drop-target");
  const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;

  const dropPoint = screenToWorld(getCanvasPoint(event));
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
    };
    const displayScale = Math.min(1, 720 / prepared.width, 520 / prepared.height);
    const object = {
      id: createId(),
      type: "image",
      x: dropPoint.x + index * 24 / viewport.zoom,
      y: dropPoint.y + index * 24 / viewport.zoom,
      w: prepared.width * displayScale,
      h: prepared.height * displayScale,
      rotation: 0,
      assetId,
      name: prepared.name,
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

drawingTools.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");
  if (button) setActiveTool(button.dataset.tool);
});
shape2dInput.addEventListener("change", () => {
  if (shape2dInput.value) setActiveTool(shape2dInput.value);
});
shape3dInput.addEventListener("change", () => {
  if (shape3dInput.value) setActiveTool(shape3dInput.value);
});

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", handlePointerCancel);
canvas.addEventListener("pointerleave", () => {
  if (interaction) return;
  hoverPoint = null;
  if (activeTool === "eraser") drawBoard();
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
document.querySelector("#zoom-in").addEventListener("click", () => setZoom(viewport.zoom + 0.1));
document.querySelector("#zoom-out").addEventListener("click", () => setZoom(viewport.zoom - 0.1));
document.querySelector("#export-board").addEventListener("click", exportBoard);
deleteSelectionButton.addEventListener("click", deleteSelection);
lockSelectionButton.addEventListener("click", toggleSelectionLock);
groupSelectionButton.addEventListener("click", assembleSelection);
ungroupSelectionButton.addEventListener("click", releaseSelection);
explodeSelectionButton.addEventListener("click", divideSelection);
reassembleSelectionButton.addEventListener("click", reassembleSelection);
colorInput.addEventListener("input", applySelectedColor);
colorInput.addEventListener("change", finishColorChange);
colorInput.addEventListener("blur", finishColorChange);
widthInput.addEventListener("input", applySelectedStrokeWidth);
widthInput.addEventListener("change", finishWidthChange);
widthInput.addEventListener("blur", finishWidthChange);
patternInput.addEventListener("change", applySelectedStrokePattern);
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

document.querySelector("#clear-board").addEventListener("click", () => {
  const password = window.prompt("Enter the delete password to clear this board.");
  if (password === null) return;
  if (!isDeletePasswordValid(password)) {
    window.alert("That password is not correct.");
    return;
  }
  checkpoint();
  board.objects = [];
  selectedObjects = [];
  closeTextEditor();
  saveBoard();
  updateSelectionControls();
  drawBoard();
});

document.addEventListener("keydown", handleKeyDown);
document.addEventListener("keyup", handleKeyUp);
window.addEventListener("resize", resizeCanvas);
new ResizeObserver(resizeCanvas).observe(canvasFrame);

updateHistoryControls();
updateSelectionControls();
updateViewControls();
updateCanvasCursor();
document.querySelector("#zoom-value").textContent = `${Math.round(viewport.zoom * 100)}%`;
resizeCanvas();
