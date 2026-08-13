/**
 * Overview & Purpose
 * Provides pure placement-list operations for the PDF Tool.
 *
 * Architectural Relationships
 * Called by: pdf-signer.js and its adjacent test suite.
 * Calls: No browser or external APIs.
 *
 * Notes
 * Operations return new arrays so interaction and AI command code can stage
 * changes without mutating the live list.
 */

export const PDF_PLACEMENT_KINDS = Object.freeze([
  "signature",
  "date",
  "text-field",
  "checkmark",
  "circle",
  "x-mark",
]);

const PLACEMENT_DEFAULTS = Object.freeze({
  signature: Object.freeze({
    text: "Signature",
    font: "signature-font-1",
    xRatio: 0.36,
    yRatio: 0.72,
    widthRatio: 0.28,
    heightRatio: 0.08,
    fontSizeRatio: 0.045,
  }),
  date: Object.freeze({
    text: "Date",
    font: "date-font",
    xRatio: 0.68,
    yRatio: 0.78,
    widthRatio: 0.18,
    heightRatio: 0.055,
    fontSizeRatio: 0.026,
  }),
  "text-field": Object.freeze({
    text: "",
    font: "form-font",
    xRatio: 0.3,
    yRatio: 0.42,
    widthRatio: 0.4,
    heightRatio: 0.075,
    fontSizeRatio: 0.022,
  }),
  checkmark: Object.freeze({
    text: "✓",
    font: "mark-font",
    xRatio: 0.38,
    yRatio: 0.5,
    widthRatio: 0.07,
    heightRatio: 0.07,
    fontSizeRatio: 0.05,
  }),
  circle: Object.freeze({
    text: "○",
    font: "mark-font",
    xRatio: 0.46,
    yRatio: 0.5,
    widthRatio: 0.07,
    heightRatio: 0.07,
    fontSizeRatio: 0.05,
  }),
  "x-mark": Object.freeze({
    text: "×",
    font: "mark-font",
    xRatio: 0.54,
    yRatio: 0.5,
    widthRatio: 0.07,
    heightRatio: 0.07,
    fontSizeRatio: 0.05,
  }),
});

const EDITABLE_PLACEMENT_FIELDS = new Set([
  "text",
  "xRatio",
  "yRatio",
  "widthRatio",
  "heightRatio",
  "fontSizeRatio",
]);

/**
 * Creates one validated placement with normalized page geometry.
 *
 * @param {object} input Placement values and optional geometry overrides.
 * @returns {object} Complete placement record.
 */
export function createPdfPlacement(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("A placement object is required.");
  }
  const id = String(input.id ?? "").trim();
  const kind = String(input.kind ?? "").trim();
  const pageNumber = Number(input.pageNumber);
  const defaults = PLACEMENT_DEFAULTS[kind];
  if (!id) throw new TypeError("A placement ID is required.");
  if (!defaults) throw new TypeError(`Unsupported PDF placement kind: ${kind}.`);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new TypeError("pageNumber must be a positive integer.");
  }

  const placement = {
    id,
    kind,
    pageNumber,
    text: normalizePlacementText(kind, input.text ?? defaults.text),
    font: normalizePlacementFont(kind, input.font ?? defaults.font),
    xRatio: normalizeRatio(input.xRatio, defaults.xRatio, 0, 0.98, "xRatio"),
    yRatio: normalizeRatio(input.yRatio, defaults.yRatio, 0, 0.98, "yRatio"),
    widthRatio: normalizeRatio(input.widthRatio, defaults.widthRatio, 0.02, 1, "widthRatio"),
    heightRatio: normalizeRatio(input.heightRatio, defaults.heightRatio, 0.02, 1, "heightRatio"),
    fontSizeRatio: normalizeRatio(
      input.fontSizeRatio,
      defaults.fontSizeRatio,
      0.008,
      0.2,
      "fontSizeRatio",
    ),
  };
  placement.widthRatio = Math.min(placement.widthRatio, 1 - placement.xRatio);
  placement.heightRatio = Math.min(placement.heightRatio, 1 - placement.yRatio);
  return placement;
}

/**
 * Removes one signature, date, or future placed field by identifier.
 *
 * @param {Array<object>} placements Current PDF field placements.
 * @param {string | null | undefined} placementId Identifier to remove.
 * @returns {{placements: Array<object>, removed: object | null}} Updated list
 * and the removed field when one was found.
 */
export function removePlacementById(placements, placementId) {
  const removed = placements.find((placement) => placement.id === placementId) ?? null;
  if (!removed) {
    return {
      placements: [...placements],
      removed: null,
    };
  }
  return {
    placements: placements.filter((placement) => placement.id !== placementId),
    removed,
  };
}

/**
 * Replaces editable values on one placement without mutating the source list.
 *
 * @param {Array<object>} placements Current placements.
 * @param {string} placementId Placement to update.
 * @param {object} changes Text or normalized geometry changes.
 * @returns {{placements: Array<object>, updated: object | null}} Update result.
 */
export function updatePlacementById(placements, placementId, changes) {
  const current = placements.find((placement) => placement.id === placementId) ?? null;
  if (!current) return { placements: [...placements], updated: null };
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new TypeError("Placement changes must be an object.");
  }
  const unknownField = Object.keys(changes).find((field) => !EDITABLE_PLACEMENT_FIELDS.has(field));
  if (unknownField) throw new TypeError(`Unsupported placement field: ${unknownField}.`);

  const updated = createPdfPlacement({ ...current, ...changes });
  return {
    placements: placements.map((placement) => placement.id === placementId ? updated : placement),
    updated,
  };
}

function normalizePlacementText(kind, value) {
  if (kind === "checkmark") return "✓";
  if (kind === "circle") return "○";
  if (kind === "x-mark") return "×";
  const text = String(value ?? "");
  if (text.length > 500) throw new TypeError("Placement text cannot exceed 500 characters.");
  if ((kind === "signature" || kind === "date") && !text.trim()) {
    throw new TypeError(`${kind} text cannot be empty.`);
  }
  return kind === "text-field" ? text : text.trim();
}

function normalizePlacementFont(kind, value) {
  const font = String(value ?? "");
  if (kind === "signature" && ![
    "signature-font-1",
    "signature-font-2",
    "signature-font-3",
  ].includes(font)) {
    throw new TypeError(`Unsupported signature font: ${font}.`);
  }
  if (kind === "date") return "date-font";
  if (kind === "text-field") return "form-font";
  if (["checkmark", "circle", "x-mark"].includes(kind)) return "mark-font";
  return font;
}

function normalizeRatio(value, fallback, minimum, maximum, field) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new TypeError(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}
