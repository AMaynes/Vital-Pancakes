/**
 * Ordinary Visual Board object factories for floor-plan symbols, utilities,
 * layer designators, and starter room templates.
 */

import {
  normalizeFloorPlanTemplateLibrary,
} from "./visual-board-floor-plan-templates.mjs";

export const FLOOR_PLAN_REMOVAL_PASSWORD = "password";

export const FLOOR_PLAN_ELEMENT_DEFINITIONS = Object.freeze({
  wall: definition("Wall", "legacy"),
  door: definition("Door", "structures"),
  "double-door": definition("Double Door", "structures"),
  "sliding-door": definition("Sliding Door", "structures"),
  "garage-door": definition("Garage Door", "structures"),
  window: definition("Window", "structures"),
  stairs: definition("Stairs", "structures"),
  "electrical-route": definition("Electrical Route", "structures"),
  "electric-meter": definition("Electric Meter", "structures"),
  "electrical-breaker-box": definition("Electrical Breaker-box", "structures"),
  "plumbing-route": definition("Plumbing Route", "structures"),
  "plumbing-meter": definition("Plumbing Meter", "structures"),
  "plumbing-valve": definition("Plumbing Valve", "structures"),
  dimension: definition("Dimension", "structures"),

  bed: definition("Bed", "furniture"),
  sofa: definition("Sofa", "furniture"),
  toilet: definition("Toilet", "furniture"),
  shower: definition("Shower", "furniture"),
  bathtub: definition("Bathtub", "furniture"),
  "bathtub-shower": definition("Bathtub w/ Shower", "furniture"),
  stove: definition("Stove", "furniture"),
  "stove-vent": definition("Stove w/ Vent", "furniture"),
  microwave: definition("Microwave", "furniture"),
  "wall-oven": definition("Wall Oven", "furniture"),
  fridge: definition("Fridge", "furniture"),
  cabinet: definition("Cabinet", "furniture"),
  "cabinet-overhead": definition("Cabinet w/ Overhead Cabinet", "furniture"),
  "overhead-cabinet": definition("Overhead Cabinet", "furniture"),
  washer: definition("Washer", "furniture"),
  dryer: definition("Dryer", "furniture"),
  "stacked-washer-dryer": definition("Stacked Washer/Dryer", "furniture"),
  "washer-dryer-combo": definition("Washer/Dryer in 1", "furniture"),

  labeler: definition("Labeler", "tools"),
  "layer-designator": definition("Layer Designator", "tools"),

  // Retained IDs keep older boards and AI commands compatible.
  "room-label": definition("Room Label", "legacy"),
  desk: definition("Desk", "legacy"),
  table: definition("Table", "legacy"),
  sink: definition("Sink", "legacy"),
  tub: definition("Tub", "legacy"),
  electrical: definition("Electrical Marker", "legacy"),
  plumbing: definition("Plumbing Marker", "legacy"),
});

export const FLOOR_PLAN_TEMPLATE_DEFINITIONS = Object.freeze({
  bedroom: definition("Bedroom", "rooms"),
  bathroom: definition("Bathroom", "rooms"),
  kitchen: definition("Kitchen", "rooms"),
  "living-room": definition("Livingroom", "rooms"),
  office: definition("Office", "rooms"),
  garage: definition("Garage", "rooms"),
  "blank-house-shell": definition("House Shell", "rooms"),
});

export const FLOOR_PLAN_ELEMENTS = Object.freeze(
  Object.keys(FLOOR_PLAN_ELEMENT_DEFINITIONS),
);

export const FLOOR_PLAN_TEMPLATES = Object.freeze(
  Object.keys(FLOOR_PLAN_TEMPLATE_DEFINITIONS),
);

export function getFloorPlanElementDefinition(kind) {
  return FLOOR_PLAN_ELEMENT_DEFINITIONS[kind]
    ? { id: kind, ...FLOOR_PLAN_ELEMENT_DEFINITIONS[kind] }
    : null;
}

export function getFloorPlanTemplateDefinition(kind) {
  return FLOOR_PLAN_TEMPLATE_DEFINITIONS[kind]
    ? { id: kind, ...FLOOR_PLAN_TEMPLATE_DEFINITIONS[kind] }
    : null;
}

export function normalizeFloorPlanSettings(value = {}) {
  const units = ["ft", "m", "in", "cm"].includes(value.units) ? value.units : "ft";
  return {
    enabled: Boolean(value.enabled),
    units,
    pixelsPerUnit: clamp(Number(value.pixelsPerUnit) || 32, 4, 200),
    wallThickness: clamp(
      Number(value.wallThickness) || (units === "ft" ? 0.5 : 0.15),
      0.02,
      10,
    ),
    gridSize: clamp(Number(value.gridSize) || 32, 4, 200),
    alignmentGuides: value.alignmentGuides !== false,
    dimensionsVisible: value.dimensionsVisible !== false,
    labelsAlwaysVisible: Boolean(value.labelsAlwaysVisible),
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
  if (!FLOOR_PLAN_ELEMENTS.includes(kind)) {
    throw new TypeError(`Unsupported floor-plan element: ${kind}.`);
  }
  const config = normalizeFloorPlanSettings(settings);
  const id = createIdentifier;
  const scale = config.pixelsPerUnit;
  const groupId = id();
  const definitionValue = FLOOR_PLAN_ELEMENT_DEFINITIONS[kind];
  const defaultLayer = getDefaultLayer(definitionValue.group, kind);
  const common = (role) => ({
    id: id(),
    color: "#24231f",
    strokeWidth: 2,
    dashPattern: "solid",
    fillOpacity: 1,
    opacity: 1,
    locked: false,
    layerId: defaultLayer,
    groupId,
    rigidGroup: true,
    semantic: {
      role: `floor-plan-${role}`,
      tags: ["floor-plan", definitionValue.group, kind],
      generatedBy: "floor-plan-mode",
    },
  });
  const line = (x1, y1, x2, y2, role = kind) => ({
    ...common(role),
    type: "line",
    x: origin.x + x1 * scale,
    y: origin.y + y1 * scale,
    endX: origin.x + x2 * scale,
    endY: origin.y + y2 * scale,
  });
  const editableLine = (x1, y1, x2, y2, role = kind) => {
    const object = line(x1, y1, x2, y2, role);
    delete object.groupId;
    delete object.rigidGroup;
    object.vertexNetworkId = id();
    object.startVertexId = id();
    object.endVertexId = id();
    return object;
  };
  const shape = (type, x, y, width, height, role = kind, fillColor = null) => ({
    ...common(role),
    type,
    x: origin.x + x * scale,
    y: origin.y + y * scale,
    w: width * scale,
    h: height * scale,
    rotation: 0,
    ...(fillColor ? { fillColor } : {}),
  });
  const label = (text, x, y, width = 5, height = 1, role = "room-label") => ({
    ...shape("textbox", x, y, width, height, role),
    text,
    fontSize: 16,
    fontFamily: "sans",
    textAlign: "center",
    verticalAlign: "middle",
    colorRanges: [],
  });
  const symbol = (
    symbolId,
    width,
    height,
    role = kind,
    fillColor = "#f7f4ec",
  ) => ({
    ...shape("symbol", 0, 0, width, height, role, fillColor),
    symbolId,
    fit: "contain",
  });

  if (kind === "wall") {
    const wall = line(0, 0, 10, 0, "wall");
    wall.strokeWidth = config.wallThickness * scale;
    return [wall];
  }
  if (kind === "door") {
    return [
      line(0, 0, 0, 3, "door-leaf"),
      {
        ...common("door-swing"),
        type: "arc",
        x: origin.x,
        y: origin.y,
        midX: origin.x + 2.1 * scale,
        midY: origin.y + 0.9 * scale,
        endX: origin.x + 3 * scale,
        endY: origin.y + 3 * scale,
      },
    ];
  }
  if (kind === "double-door") return [symbol("door-double", 6, 3)];
  if (kind === "sliding-door") return [symbol("door-sliding", 6, 1.2)];
  if (kind === "garage-door") {
    return [
      shape("rectangle", 0, 0, 10, 1.2),
      ...Array.from({ length: 5 }, (_, index) => (
        line(index * 2, 0, index * 2, 1.2, "garage-door-panel")
      )),
    ];
  }
  if (kind === "window") {
    return [
      line(0, 0, 4, 0),
      line(0, 0.18, 4, 0.18),
      line(0, -0.18, 4, -0.18),
    ];
  }
  if (kind === "stairs") return [symbol("stairs-straight", 4, 9)];
  if (kind === "electrical-route") {
    const route = editableLine(0, 0, 8, 0);
    route.color = "#a04134";
    route.dashPattern = "dashed";
    return [route];
  }
  if (kind === "plumbing-route") {
    const route = editableLine(0, 0, 8, 0);
    route.color = "#23766f";
    route.dashPattern = "dash-dot";
    return [route];
  }
  if (kind === "electric-meter") {
    return [
      shape("ellipse", 0, 0, 1.6, 1.6, kind, "#ffffff"),
      label("M", 0.25, 0.35, 1.1, 0.8, "electric-meter-label"),
    ];
  }
  if (kind === "electrical-breaker-box") {
    return [
      shape("rectangle", 0, 0, 2.5, 3.5, kind, "#ffffff"),
      ...Array.from({ length: 4 }, (_, index) => (
        line(0.4, 0.7 + index * 0.65, 2.1, 0.7 + index * 0.65, "breaker-row")
      )),
    ];
  }
  if (kind === "plumbing-meter") {
    return [
      shape("ellipse", 0, 0, 1.6, 1.6, kind, "#ffffff"),
      label("P", 0.25, 0.35, 1.1, 0.8, "plumbing-meter-label"),
    ];
  }
  if (kind === "plumbing-valve") {
    return [
      line(0, 0.8, 2.4, 0.8),
      shape("ellipse", 0.7, 0, 1, 1, "plumbing-valve-wheel", "#ffffff"),
      line(1.2, 0.5, 1.2, 1.25, "plumbing-valve-stem"),
    ];
  }
  if (kind === "dimension") {
    const dimension = editableLine(0, 0, 8, 0, "dimension");
    dimension.type = "dimension";
    dimension.layerId = "dimensions";
    dimension.offset = 24;
    dimension.fontSize = 12;
    dimension.label = "";
    return [dimension];
  }

  if (kind === "bed") return [symbol("bed-queen", 5, 7)];
  if (kind === "sofa") return [symbol("sofa", 7, 3)];
  if (kind === "toilet") return [symbol("toilet", 2.5, 4)];
  if (kind === "shower") return [symbol("shower", 4, 4)];
  if (kind === "bathtub" || kind === "tub") return [symbol("bathtub", 6, 3)];
  if (kind === "bathtub-shower") {
    return [
      symbol("bathtub", 6, 3),
      shape("ellipse", 5.1, 0.15, 0.45, 0.45, "shower-head", "#ffffff"),
      line(5.32, 0.6, 5.32, 1.2, "shower-pipe"),
    ];
  }
  if (kind === "stove") return [symbol("range", 3, 3)];
  if (kind === "stove-vent") {
    return [
      symbol("range", 3, 3),
      shape("rectangle", 0.35, -0.55, 2.3, 0.35, "vent", "#ffffff"),
    ];
  }
  if (kind === "microwave") return [symbol("microwave", 2.5, 2)];
  if (kind === "wall-oven") return [symbol("oven-wall", 3, 2)];
  if (kind === "fridge") return [symbol("refrigerator", 3, 3.5)];
  if (kind === "cabinet") return [symbol("cabinet-base", 4, 2)];
  if (kind === "cabinet-overhead") {
    return [
      symbol("cabinet-base", 4, 2),
      shape("rectangle", 0.15, 0.15, 3.7, 1.7, "overhead-cabinet", "#ffffff"),
    ];
  }
  if (kind === "overhead-cabinet") {
    const cabinet = shape("rectangle", 0, 0, 4, 2, kind, "#ffffff");
    cabinet.dashPattern = "dashed";
    return [cabinet, line(2, 0, 2, 2, "cabinet-door")];
  }
  if (kind === "washer") return [symbol("washer", 3, 3)];
  if (kind === "dryer") return [symbol("dryer", 3, 3)];
  if (kind === "stacked-washer-dryer") {
    return [
      shape("rectangle", 0, 0, 3, 4.5, kind, "#ffffff"),
      shape("ellipse", 0.65, 0.35, 1.7, 1.7, "dryer-drum", "#ffffff"),
      shape("ellipse", 0.65, 2.45, 1.7, 1.7, "washer-drum", "#ffffff"),
    ];
  }
  if (kind === "washer-dryer-combo") {
    return [
      shape("rectangle", 0, 0, 3, 3, kind, "#ffffff"),
      shape("ellipse", 0.55, 0.55, 1.9, 1.9, "washer-dryer-drum", "#ffffff"),
      label("W/D", 0.85, 2.35, 1.3, 0.45, "washer-dryer-label"),
    ];
  }

  if (kind === "labeler" || kind === "room-label") {
    const object = label("Label", 0, 0, 5, 1.2, "labeler");
    object.layerId = "labels";
    object.semantic.label = "Hover label";
    return [object];
  }
  if (kind === "layer-designator") {
    const object = shape(
      "rectangle",
      0,
      0,
      12,
      10,
      "layer-designator",
      "#f7f4ec",
    );
    object.fillOpacity = 0.14;
    object.dashPattern = "dashed";
    object.floorPlanRooms = [{ id: id(), name: "Floor 1" }];
    object.activeFloorPlanRoomId = object.floorPlanRooms[0].id;
    return [object];
  }

  // Older catalog entries remain usable.
  if (kind === "desk") {
    return [
      shape("rectangle", 0, 0, 5, 2.5),
      shape("rectangle", 1.7, 2.8, 1.6, 1.6, "chair"),
    ];
  }
  if (kind === "table") return [shape("ellipse", 0, 0, 5, 3)];
  if (kind === "sink") return [symbol("sink", 3, 2)];
  if (kind === "electrical") {
    return [
      shape("ellipse", 0, 0, 1, 1),
      line(0.5, 0.12, 0.5, 0.88),
      line(0.12, 0.5, 0.88, 0.5),
    ];
  }
  if (kind === "plumbing") {
    return [
      shape("ellipse", 0, 0, 1, 1),
      line(0.2, 0.2, 0.8, 0.8),
      line(0.8, 0.2, 0.2, 0.8),
    ];
  }
  return [];
}

export function createFloorPlanTemplate(kind, origin, settings, createIdentifier) {
  if (!FLOOR_PLAN_TEMPLATES.includes(kind)) {
    throw new TypeError(`Unsupported floor-plan template: ${kind}.`);
  }
  const config = normalizeFloorPlanSettings(settings);
  const scale = config.pixelsPerUnit;
  const objects = [];
  const add = (elementKind, x, y) => {
    objects.push(...createFloorPlanElement(
      elementKind,
      { x: origin.x + x * scale, y: origin.y + y * scale },
      config,
      createIdentifier,
    ));
  };
  const shell = (width, height, labelText) => {
    const groupId = createIdentifier();
    const wallWidth = config.wallThickness * scale;
    const wall = (x1, y1, x2, y2) => ({
      id: createIdentifier(),
      type: "line",
      x: origin.x + x1 * scale,
      y: origin.y + y1 * scale,
      endX: origin.x + x2 * scale,
      endY: origin.y + y2 * scale,
      color: "#24231f",
      strokeWidth: wallWidth,
      dashPattern: "solid",
      fillOpacity: 1,
      opacity: 1,
      layerId: "structure",
      locked: false,
      groupId,
      rigidGroup: true,
      semantic: {
        role: "floor-plan-wall",
        tags: ["floor-plan", "rooms", kind],
        generatedBy: "floor-plan-mode",
      },
    });
    objects.push(
      wall(0, 0, width, 0),
      wall(width, 0, width, height),
      wall(width, height, 0, height),
      wall(0, height, 0, 0),
    );
    objects.push({
      id: createIdentifier(),
      type: "textbox",
      x: origin.x + 1 * scale,
      y: origin.y + 1 * scale,
      w: Math.max(4, width - 2) * scale,
      h: 1.2 * scale,
      rotation: 0,
      text: labelText,
      color: "#24231f",
      colorRanges: [],
      strokeWidth: 1,
      dashPattern: "solid",
      fillOpacity: 1,
      opacity: 1,
      layerId: "labels",
      locked: false,
      fontSize: 18,
      fontFamily: "sans",
      textAlign: "center",
      verticalAlign: "middle",
      groupId,
      rigidGroup: true,
      semantic: {
        role: "floor-plan-room-label",
        tags: ["floor-plan", "rooms", kind],
        generatedBy: "floor-plan-mode",
      },
    });
  };

  if (kind === "blank-house-shell") shell(30, 22, "House");
  if (kind === "bedroom") {
    shell(12, 12, "Bedroom");
    add("bed", 3.5, 3);
    add("window", 4, 0);
    add("door", 0, 8);
  }
  if (kind === "bathroom") {
    shell(9, 8, "Bathroom");
    add("toilet", 1, 3.5);
    add("cabinet", 4.5, 1);
    add("shower", 4.5, 3.5);
    add("door", 0, 4.5);
  }
  if (kind === "kitchen") {
    shell(14, 10, "Kitchen");
    add("fridge", 1, 1);
    add("stove-vent", 5, 1);
    add("cabinet-overhead", 9, 1);
  }
  if (kind === "living-room") {
    shell(16, 12, "Livingroom");
    add("sofa", 4.5, 2);
    add("window", 6, 0);
  }
  if (kind === "office") {
    shell(10, 9, "Office");
    add("desk", 2.5, 2.5);
    add("window", 3, 0);
    add("door", 0, 5);
  }
  if (kind === "garage") {
    shell(20, 14, "Garage");
    add("garage-door", 5, 14);
    add("washer", 1, 1);
    add("dryer", 4.5, 1);
    add("dimension", 6, 13);
  }
  return objects;
}

export function normalizeFloorPlanRoomState(object) {
  const rooms = [];
  const seen = new Set();
  (Array.isArray(object?.floorPlanRooms) ? object.floorPlanRooms : [])
    .forEach((room) => {
      const id = normalizeIdentifier(room?.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      rooms.push({
        id,
        name: normalizeRoomName(room?.name, rooms.length + 1),
      });
    });
  if (!rooms.length) rooms.push({ id: "floor-1", name: "Floor 1" });
  const activeFloorPlanRoomId = rooms.some((room) => (
    room.id === object?.activeFloorPlanRoomId
  ))
    ? object.activeFloorPlanRoomId
    : rooms[0].id;
  return { floorPlanRooms: rooms.slice(0, 50), activeFloorPlanRoomId };
}

export function cycleFloorPlanRoom(object, direction = 1) {
  const state = normalizeFloorPlanRoomState(object);
  const currentIndex = state.floorPlanRooms.findIndex((room) => (
    room.id === state.activeFloorPlanRoomId
  ));
  const nextIndex = (
    currentIndex + (Number(direction) < 0 ? -1 : 1) + state.floorPlanRooms.length
  ) % state.floorPlanRooms.length;
  return {
    ...state,
    activeFloorPlanRoomId: state.floorPlanRooms[nextIndex].id,
  };
}

export function addFloorPlanRoom(object, name, createIdentifier) {
  const state = normalizeFloorPlanRoomState(object);
  if (state.floorPlanRooms.length >= 50) {
    throw new TypeError("A layer designator can contain at most 50 rooms or floors.");
  }
  const room = {
    id: normalizeIdentifier(createIdentifier()) || `floor-${state.floorPlanRooms.length + 1}`,
    name: normalizeRoomName(name, state.floorPlanRooms.length + 1),
  };
  return {
    floorPlanRooms: [...state.floorPlanRooms, room],
    activeFloorPlanRoomId: room.id,
    room,
  };
}

export function removeActiveFloorPlanRoom(object) {
  const state = normalizeFloorPlanRoomState(object);
  if (state.floorPlanRooms.length === 1) {
    throw new TypeError("A layer designator must keep at least one room or floor.");
  }
  const removedRoomId = state.activeFloorPlanRoomId;
  const currentIndex = state.floorPlanRooms.findIndex((room) => room.id === removedRoomId);
  const floorPlanRooms = state.floorPlanRooms.filter((room) => room.id !== removedRoomId);
  return {
    floorPlanRooms,
    activeFloorPlanRoomId: floorPlanRooms[Math.min(currentIndex, floorPlanRooms.length - 1)].id,
    removedRoomId,
  };
}

export function isFloorPlanObjectVisible(object, allObjects, settings, options = {}) {
  const config = normalizeFloorPlanSettings(settings);
  const role = String(object?.semantic?.role ?? "");
  if (!config.dimensionsVisible && (
    object?.type === "dimension"
    || role === "floor-plan-dimension"
    || role === "floor-plan-dimension-tick"
  )) return false;
  if (
    role === "floor-plan-labeler"
    && !config.labelsAlwaysVisible
    && options.showHoverLabels !== true
    && !options.visibleLabelIds?.has(object.id)
  ) return false;

  const designatorId = object?.semantic?.referenceId;
  const roomId = object?.semantic?.roomId;
  if (!designatorId || !roomId) return true;
  const designator = (Array.isArray(allObjects) ? allObjects : [])
    .find((candidate) => candidate.id === designatorId);
  if (!designator) return true;
  return normalizeFloorPlanRoomState(designator).activeFloorPlanRoomId === roomId;
}

export function formatFloorPlanDimension(start, end, settings) {
  const config = normalizeFloorPlanSettings(settings);
  const distancePixels = Math.hypot(end.x - start.x, end.y - start.y);
  const distance = distancePixels / config.pixelsPerUnit;
  const precision = distance >= 100 ? 0 : distance >= 10 ? 1 : 2;
  return `${distance.toFixed(precision)} ${config.units}`;
}

export function hasFloorPlanRemovalPassword(value) {
  return value === FLOOR_PLAN_REMOVAL_PASSWORD;
}

function definition(name, group) {
  return Object.freeze({ name, group });
}

function getDefaultLayer(group, kind) {
  if (group === "furniture") return "furniture";
  if (group === "tools") return "labels";
  if (kind === "dimension") return "dimensions";
  if (["door", "double-door", "sliding-door", "garage-door", "window"].includes(kind)) {
    return "openings";
  }
  if (
    kind.includes("meter")
    || kind.includes("breaker")
    || kind.includes("valve")
    || kind === "electrical"
    || kind === "plumbing"
  ) return "fixtures";
  return "structure";
}

function normalizeIdentifier(value) {
  const identifier = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(identifier)
    ? identifier
    : "";
}

function normalizeRoomName(value, index) {
  const name = String(value ?? "").trim();
  return name ? name.slice(0, 80) : `Floor ${index}`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
