/**
 * Overview & Purpose
 * Implements a combined diagramming and freehand drawing canvas with local
 * persistence, selection, undo/redo, zoom, and PNG export.
 *
 * Architectural Relationships
 * Called by: visual-board.html.
 * Calls: Canvas 2D, pointer events, localStorage, and download APIs.
 *
 * External Resources
 * None.
 *
 * Notes
 * Board coordinates are stored independently of device pixel ratio and zoom.
 * Pointer capture keeps drag gestures stable on touch and pen input.
 */

import { createId, isDeletePasswordValid } from "../app/store.js";

const BOARD_KEY = "artificially-neuroscience-visual-board-v1";
const canvas = document.querySelector("#visual-board");
const context = canvas.getContext("2d");
const canvasFrame = canvas.parentElement;
const colorInput = document.querySelector("#stroke-color");
const widthInput = document.querySelector("#stroke-width");
const drawingTools = document.querySelector("#drawing-tools");

let board = loadBoard();
let history = [];
let future = [];
let activeTool = "select";
let zoom = 1;
let pointerStart = null;
let workingObject = null;
let selectedObject = null;
let dragOffset = null;

/**
 * Reads a saved board and falls back to a clean model.
 *
 * @returns {{objects: Array<object>}} Current board.
 */
function loadBoard() {
  try {
    const savedBoard = JSON.parse(localStorage.getItem(BOARD_KEY));
    return Array.isArray(savedBoard?.objects) ? savedBoard : { objects: [] };
  } catch (error) {
    console.error("Unable to load the saved visual board.", error);
    return { objects: [] };
  }
}

/**
 * Saves the current board and updates the visible persistence status.
 */
function saveBoard() {
  localStorage.setItem(BOARD_KEY, JSON.stringify(board));
  const status = document.querySelector("#save-status");
  status.textContent = "Saved locally";
}

/**
 * Captures the pre-mutation state for deterministic undo.
 */
function checkpoint() {
  history.push(JSON.stringify(board));
  if (history.length > 60) history.shift();
  future = [];
  updateHistoryControls();
}

/**
 * Resizes the backing canvas for crisp output while preserving CSS coordinates.
 */
function resizeCanvas() {
  const bounds = canvasFrame.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
  canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;
  drawBoard();
}

/**
 * Converts a pointer event into zoom-independent board coordinates.
 *
 * @param {PointerEvent} event Pointer event.
 * @returns {{x: number, y: number}} Board point.
 */
function getBoardPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) / zoom,
    y: (event.clientY - bounds.top) / zoom,
  };
}

/**
 * Draws every persisted object and the in-progress gesture.
 */
function drawBoard() {
  const pixelRatio = window.devicePixelRatio || 1;
  context.setTransform(pixelRatio * zoom, 0, 0, pixelRatio * zoom, 0, 0);
  context.clearRect(0, 0, canvas.width / pixelRatio / zoom, canvas.height / pixelRatio / zoom);
  board.objects.forEach((object) => drawObject(object, object === selectedObject));
  if (workingObject && !board.objects.includes(workingObject)) {
    drawObject(workingObject, false);
  }
}

/**
 * Renders one board object according to its semantic type.
 *
 * @param {object} object Board object.
 * @param {boolean} isSelected Whether to draw a selection boundary.
 */
function drawObject(object, isSelected) {
  context.save();
  context.strokeStyle = object.color;
  context.fillStyle = object.color;
  context.lineWidth = object.width;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (object.type === "pen") {
    drawPenStroke(object.points);
  } else if (object.type === "rectangle") {
    context.strokeRect(object.x, object.y, object.endX - object.x, object.endY - object.y);
  } else if (object.type === "ellipse") {
    const centerX = (object.x + object.endX) / 2;
    const centerY = (object.y + object.endY) / 2;
    context.beginPath();
    context.ellipse(
      centerX,
      centerY,
      Math.abs(object.endX - object.x) / 2,
      Math.abs(object.endY - object.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
  } else if (object.type === "connector") {
    drawConnector(object);
  } else if (object.type === "note") {
    drawNote(object);
  }

  if (isSelected) {
    const bounds = getObjectBounds(object);
    context.setLineDash([5, 4]);
    context.lineWidth = 1 / zoom;
    context.strokeStyle = "#7a6d56";
    context.strokeRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12);
  }
  context.restore();
}

/**
 * Draws a freehand path from recorded points.
 *
 * @param {Array<{x: number, y: number}>} points Path points.
 */
function drawPenStroke(points) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.stroke();
}

/**
 * Draws a line with a proportional arrowhead.
 *
 * @param {object} object Connector object.
 */
function drawConnector(object) {
  const angle = Math.atan2(object.endY - object.y, object.endX - object.x);
  const arrowSize = Math.max(9, object.width * 3);
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

/**
 * Draws a subtle note card with wrapped text.
 *
 * @param {object} object Note object.
 */
function drawNote(object) {
  const width = 190;
  const lines = wrapText(object.text, width - 24);
  const height = Math.max(70, lines.length * 20 + 28);
  context.save();
  context.fillStyle = "#fffaf0";
  context.strokeStyle = object.color;
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(object.x, object.y, width, height, 10);
  context.fill();
  context.stroke();
  context.fillStyle = "#26332f";
  context.font = "12px 'Avenir Next', sans-serif";
  lines.forEach((line, index) => context.fillText(line, object.x + 12, object.y + 24 + index * 20));
  context.restore();
  object.noteWidth = width;
  object.noteHeight = height;
}

/**
 * Wraps note text to the visual card width.
 *
 * @param {string} text Note text.
 * @param {number} maxWidth Maximum line width in board units.
 * @returns {Array<string>} Wrapped lines.
 */
function wrapText(text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = "";
  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  });
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Starts a draw, select, move, or erase gesture.
 *
 * @param {PointerEvent} event Pointer-down event.
 */
function handlePointerDown(event) {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  pointerStart = getBoardPoint(event);
  const hitObject = findObjectAt(pointerStart);

  if (activeTool === "select") {
    selectedObject = hitObject;
    if (selectedObject) {
      checkpoint();
      const bounds = getObjectBounds(selectedObject);
      dragOffset = { x: pointerStart.x - bounds.x, y: pointerStart.y - bounds.y };
    }
    drawBoard();
    return;
  }

  if (activeTool === "eraser") {
    if (hitObject) {
      checkpoint();
      board.objects = board.objects.filter((object) => object !== hitObject);
      selectedObject = null;
      saveBoard();
      drawBoard();
    }
    return;
  }

  if (activeTool === "note") {
    const noteText = window.prompt("What should this note say?");
    if (noteText?.trim()) {
      checkpoint();
      board.objects.push({
        id: createId(),
        type: "note",
        x: pointerStart.x,
        y: pointerStart.y,
        color: colorInput.value,
        width: Number(widthInput.value),
        text: noteText.trim(),
      });
      saveBoard();
      drawBoard();
    }
    return;
  }

  checkpoint();
  workingObject = {
    id: createId(),
    type: activeTool,
    x: pointerStart.x,
    y: pointerStart.y,
    endX: pointerStart.x,
    endY: pointerStart.y,
    color: colorInput.value,
    width: Number(widthInput.value),
    points: activeTool === "pen" ? [pointerStart] : undefined,
  };
}

/**
 * Updates the current draw or move gesture.
 *
 * @param {PointerEvent} event Pointer-move event.
 */
function handlePointerMove(event) {
  if (!pointerStart) return;
  const point = getBoardPoint(event);

  if (activeTool === "select" && selectedObject && dragOffset) {
    const bounds = getObjectBounds(selectedObject);
    moveObject(selectedObject, point.x - dragOffset.x - bounds.x, point.y - dragOffset.y - bounds.y);
  } else if (workingObject?.type === "pen") {
    workingObject.points.push(point);
  } else if (workingObject) {
    workingObject.endX = point.x;
    workingObject.endY = point.y;
  }
  drawBoard();
}

/**
 * Commits the current gesture and persists the board.
 *
 * @param {PointerEvent} event Pointer-up event.
 */
function handlePointerUp(event) {
  if (!pointerStart) return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (workingObject) {
    const bounds = getObjectBounds(workingObject);
    if (workingObject.type === "pen" || bounds.width > 3 || bounds.height > 3) {
      board.objects.push(workingObject);
      selectedObject = workingObject;
    }
  }
  if (workingObject || selectedObject) saveBoard();
  workingObject = null;
  pointerStart = null;
  dragOffset = null;
  drawBoard();
}

/**
 * Returns the topmost board object at a coordinate.
 *
 * @param {{x: number, y: number}} point Board coordinate.
 * @returns {object|null} Hit object.
 */
function findObjectAt(point) {
  return board.objects.slice().reverse().find((object) => {
    const bounds = getObjectBounds(object);
    const padding = Math.max(8, object.width + 4);
    return point.x >= bounds.x - padding
      && point.x <= bounds.x + bounds.width + padding
      && point.y >= bounds.y - padding
      && point.y <= bounds.y + bounds.height + padding;
  }) ?? null;
}

/**
 * Computes a positive bounding rectangle for all object types.
 *
 * @param {object} object Board object.
 * @returns {{x: number, y: number, width: number, height: number}} Bounds.
 */
function getObjectBounds(object) {
  if (object.type === "pen") {
    const xValues = object.points.map((point) => point.x);
    const yValues = object.points.map((point) => point.y);
    const minX = Math.min(...xValues);
    const minY = Math.min(...yValues);
    return { x: minX, y: minY, width: Math.max(1, Math.max(...xValues) - minX), height: Math.max(1, Math.max(...yValues) - minY) };
  }
  if (object.type === "note") {
    return { x: object.x, y: object.y, width: object.noteWidth ?? 190, height: object.noteHeight ?? 70 };
  }
  const minX = Math.min(object.x, object.endX);
  const minY = Math.min(object.y, object.endY);
  return { x: minX, y: minY, width: Math.abs(object.endX - object.x), height: Math.abs(object.endY - object.y) };
}

/**
 * Translates an object, including each recorded freehand point.
 *
 * @param {object} object Board object.
 * @param {number} deltaX Horizontal board units.
 * @param {number} deltaY Vertical board units.
 */
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
  if (Number.isFinite(object.endX)) object.endX += deltaX;
  if (Number.isFinite(object.endY)) object.endY += deltaY;
}

/**
 * Restores the previous board snapshot.
 */
function undo() {
  const snapshot = history.pop();
  if (!snapshot) return;
  future.push(JSON.stringify(board));
  board = JSON.parse(snapshot);
  selectedObject = null;
  saveBoard();
  updateHistoryControls();
  drawBoard();
}

/**
 * Reapplies the most recently undone board snapshot.
 */
function redo() {
  const snapshot = future.pop();
  if (!snapshot) return;
  history.push(JSON.stringify(board));
  board = JSON.parse(snapshot);
  selectedObject = null;
  saveBoard();
  updateHistoryControls();
  drawBoard();
}

/**
 * Enables history buttons only when a corresponding snapshot exists.
 */
function updateHistoryControls() {
  document.querySelector("#undo-board").disabled = history.length === 0;
  document.querySelector("#redo-board").disabled = future.length === 0;
}

/**
 * Applies a bounded zoom and repaints the board.
 *
 * @param {number} nextZoom Desired scale.
 */
function setZoom(nextZoom) {
  zoom = Math.min(2, Math.max(0.5, nextZoom));
  document.querySelector("#zoom-value").textContent = `${Math.round(zoom * 100)}%`;
  drawBoard();
}

/**
 * Downloads the currently visible board as a PNG.
 */
function exportBoard() {
  const link = document.createElement("a");
  link.download = `visual-board-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

drawingTools.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");
  if (!button) return;
  activeTool = button.dataset.tool;
  drawingTools.querySelectorAll("[data-tool]").forEach((candidate) => {
    candidate.classList.toggle("is-active", candidate === button);
  });
  canvas.style.cursor = activeTool === "select" ? "default" : activeTool === "eraser" ? "not-allowed" : "crosshair";
});

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", handlePointerUp);
document.querySelector("#undo-board").addEventListener("click", undo);
document.querySelector("#redo-board").addEventListener("click", redo);
document.querySelector("#zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
document.querySelector("#zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
document.querySelector("#export-board").addEventListener("click", exportBoard);
document.querySelector("#clear-board").addEventListener("click", () => {
  const password = window.prompt("Enter the delete password to clear this board.");
  if (password === null) return;
  if (!isDeletePasswordValid(password)) {
    window.alert("That password is not correct.");
    return;
  }
  checkpoint();
  board = { objects: [] };
  selectedObject = null;
  saveBoard();
  drawBoard();
});

window.addEventListener("resize", resizeCanvas);
new ResizeObserver(resizeCanvas).observe(canvasFrame);
updateHistoryControls();
resizeCanvas();
