/**
 * Ordinary Visual Board object factories for floor-plan symbols and starter
 * room templates.
 */

import {
  normalizeFloorPlanTemplateLibrary,
} from "./visual-board-floor-plan-templates.mjs";

export const FLOOR_PLAN_ELEMENTS = Object.freeze([
  "wall", "door", "window", "stairs", "room-label", "dimension",
  "bed", "sofa", "desk", "table", "toilet", "sink", "shower", "tub",
  "stove", "fridge", "washer", "electrical", "plumbing",
]);

export const FLOOR_PLAN_TEMPLATES = Object.freeze([
  "bedroom", "bathroom", "kitchen", "living-room", "office", "garage", "blank-house-shell",
]);

export function normalizeFloorPlanSettings(value = {}) {
  const units = ["ft", "m", "in", "cm"].includes(value.units) ? value.units : "ft";
  return {
    enabled: Boolean(value.enabled),
    units,
    pixelsPerUnit: clamp(Number(value.pixelsPerUnit) || 32, 4, 200),
    wallThickness: clamp(Number(value.wallThickness) || (units === "ft" ? 0.5 : 0.15), 0.02, 10),
    gridSize: clamp(Number(value.gridSize) || 32, 4, 200),
    alignmentGuides: value.alignmentGuides !== false,
    elementLibrary: normalizeFloorPlanTemplateLibrary(
      value.elementLibrary,
      FLOOR_PLAN_ELEMENTS,
    ),
    templateLibrary: normalizeFloorPlanTemplateLibrary(
      value.templateLibrary,
      FLOOR_PLAN_TEMPLATES,
    ),
  };
}

export function createFloorPlanElement(kind, origin, settings, createIdentifier) {
  if (!FLOOR_PLAN_ELEMENTS.includes(kind)) throw new TypeError(`Unsupported floor-plan element: ${kind}.`);
  const config = normalizeFloorPlanSettings(settings);
  const id = createIdentifier;
  const scale = config.pixelsPerUnit;
  const groupId = id();
  const common = (role) => ({
    id: id(),
    color: "#24231f",
    strokeWidth: 2,
    dashPattern: "solid",
    locked: false,
    groupId,
    rigidGroup: true,
    semantic: { role: `floor-plan-${role}`, tags: ["floor-plan", kind], generatedBy: "floor-plan-mode" },
  });
  const line = (x1, y1, x2, y2, role = kind) => ({ ...common(role), type: "line", x: origin.x + x1 * scale, y: origin.y + y1 * scale, endX: origin.x + x2 * scale, endY: origin.y + y2 * scale });
  const shape = (type, x, y, width, height, role = kind) => ({ ...common(role), type, x: origin.x + x * scale, y: origin.y + y * scale, w: width * scale, h: height * scale, rotation: 0 });
  const label = (text, x, y, width = 5, height = 1) => ({ ...shape("textbox", x, y, width, height, "room-label"), text, fontSize: 16, fontFamily: "sans", colorRanges: [] });

  if (kind === "wall") {
    const wall = line(0, 0, 10, 0, "wall");
    wall.strokeWidth = config.wallThickness * scale;
    return [wall];
  }
  if (kind === "door") {
    return [
      line(0, 0, 0, 3, "door-leaf"),
      { ...common("door-swing"), type: "arc", x: origin.x, y: origin.y, midX: origin.x + 2.1 * scale, midY: origin.y + 0.9 * scale, endX: origin.x + 3 * scale, endY: origin.y + 3 * scale },
    ];
  }
  if (kind === "window") return [line(0, 0, 4, 0), line(0, 0.18, 4, 0.18), line(0, -0.18, 4, -0.18)];
  if (kind === "stairs") {
    return [shape("rectangle", 0, 0, 4, 8), ...Array.from({ length: 8 }, (_, index) => line(0, index + 1, 4, index + 1, "stair-step"))];
  }
  if (kind === "room-label") return [label("Room", 0, 0, 6, 1.2)];
  if (kind === "dimension") {
    const dimension = line(0, 0, 8, 0, "dimension");
    return [dimension, line(0, -0.25, 0, 0.25, "dimension-tick"), line(8, -0.25, 8, 0.25, "dimension-tick")];
  }
  if (kind === "bed") return [shape("rectangle", 0, 0, 5, 7), line(0, 1.3, 5, 1.3, "pillow-line")];
  if (kind === "sofa") return [shape("rectangle", 0, 0, 7, 3), line(1.2, 0, 1.2, 3, "cushion"), line(5.8, 0, 5.8, 3, "cushion")];
  if (kind === "desk") return [shape("rectangle", 0, 0, 5, 2.5), shape("rectangle", 1.7, 2.8, 1.6, 1.6, "chair")];
  if (kind === "table") return [shape("ellipse", 0, 0, 5, 3)];
  if (kind === "toilet") return [shape("rectangle", 0.4, 0, 1.7, 0.8), shape("ellipse", 0, 0.7, 2.5, 3)];
  if (kind === "sink") return [shape("ellipse", 0, 0, 2.5, 1.8), line(1.25, -0.4, 1.25, 0.3, "faucet")];
  if (kind === "shower") return [shape("rectangle", 0, 0, 3, 3), line(0, 0, 3, 3, "shower"), line(3, 0, 0, 3, "shower")];
  if (kind === "tub") return [shape("rectangle", 0, 0, 6, 2.8), shape("ellipse", 0.3, 0.3, 5.4, 2.2, "tub-basin")];
  if (kind === "stove") return [shape("rectangle", 0, 0, 3, 3), ...[[0.8, 0.8], [2.2, 0.8], [0.8, 2.2], [2.2, 2.2]].map(([x, y]) => shape("ellipse", x - 0.35, y - 0.35, 0.7, 0.7, "burner"))];
  if (kind === "fridge") return [shape("rectangle", 0, 0, 3, 3.5), line(0, 1.3, 3, 1.3, "fridge-door")];
  if (kind === "washer") return [shape("rectangle", 0, 0, 3, 3), shape("ellipse", 0.55, 0.55, 1.9, 1.9, "washer-drum")];
  if (kind === "electrical") return [shape("ellipse", 0, 0, 1, 1), line(0.5, 0.12, 0.5, 0.88, "electrical"), line(0.12, 0.5, 0.88, 0.5, "electrical")];
  if (kind === "plumbing") return [shape("ellipse", 0, 0, 1, 1), line(0.2, 0.2, 0.8, 0.8, "plumbing"), line(0.8, 0.2, 0.2, 0.8, "plumbing")];
  return [];
}

export function createFloorPlanTemplate(kind, origin, settings, createIdentifier) {
  if (!FLOOR_PLAN_TEMPLATES.includes(kind)) throw new TypeError(`Unsupported floor-plan template: ${kind}.`);
  const config = normalizeFloorPlanSettings(settings);
  const scale = config.pixelsPerUnit;
  const objects = [];
  const add = (elementKind, x, y) => {
    objects.push(...createFloorPlanElement(elementKind, { x: origin.x + x * scale, y: origin.y + y * scale }, config, createIdentifier));
  };
  const shell = (width, height, labelText) => {
    const groupId = createIdentifier();
    const wallWidth = config.wallThickness * scale;
    const wall = (x1, y1, x2, y2) => ({
      id: createIdentifier(), type: "line", x: origin.x + x1 * scale, y: origin.y + y1 * scale,
      endX: origin.x + x2 * scale, endY: origin.y + y2 * scale, color: "#24231f",
      strokeWidth: wallWidth, dashPattern: "solid", locked: false, groupId, rigidGroup: true,
      semantic: { role: "floor-plan-wall", tags: ["floor-plan", kind], generatedBy: "floor-plan-mode" },
    });
    objects.push(wall(0, 0, width, 0), wall(width, 0, width, height), wall(width, height, 0, height), wall(0, height, 0, 0));
    objects.push({
      id: createIdentifier(), type: "textbox", x: origin.x + 1 * scale, y: origin.y + 1 * scale,
      w: Math.max(4, width - 2) * scale, h: 1.2 * scale, rotation: 0, text: labelText,
      color: "#24231f", colorRanges: [], strokeWidth: 1, dashPattern: "solid", locked: false,
      fontSize: 18, fontFamily: "sans", groupId, rigidGroup: true,
      semantic: { role: "floor-plan-room-label", tags: ["floor-plan", kind], generatedBy: "floor-plan-mode" },
    });
  };

  if (kind === "blank-house-shell") shell(30, 22, "House");
  if (kind === "bedroom") { shell(12, 12, "Bedroom"); add("bed", 3.5, 3); add("window", 4, 0); add("door", 0, 8); }
  if (kind === "bathroom") { shell(9, 8, "Bathroom"); add("toilet", 1, 4); add("sink", 5.5, 1); add("shower", 5, 4); add("door", 0, 4.5); }
  if (kind === "kitchen") { shell(14, 10, "Kitchen"); add("fridge", 1, 1); add("stove", 5, 1); add("sink", 10, 1); add("table", 4.5, 5.5); }
  if (kind === "living-room") { shell(16, 12, "Living Room"); add("sofa", 4.5, 2); add("table", 5.5, 7); add("window", 6, 0); }
  if (kind === "office") { shell(10, 9, "Office"); add("desk", 2.5, 2.5); add("window", 3, 0); add("door", 0, 5); }
  if (kind === "garage") { shell(20, 14, "Garage"); add("washer", 1, 1); add("dimension", 6, 13); }
  return objects;
}

export function formatFloorPlanDimension(start, end, settings) {
  const config = normalizeFloorPlanSettings(settings);
  const distancePixels = Math.hypot(end.x - start.x, end.y - start.y);
  const distance = distancePixels / config.pixelsPerUnit;
  const precision = distance >= 100 ? 0 : distance >= 10 ? 1 : 2;
  return `${distance.toFixed(precision)} ${config.units}`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
