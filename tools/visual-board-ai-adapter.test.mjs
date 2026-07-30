import assert from "node:assert/strict";
import test from "node:test";

import {
  createVisualBoardAiAdapter,
  executeVisualBoardCommands,
  getVisualBoardAiCapabilities,
  serializeVisualBoardContext,
} from "./visual-board-ai-adapter.mjs";

function createState(objects = []) {
  return {
    board: {
      version: 13,
      revision: 7,
      objects,
      assets: {
        image1: { name: "Private scan", dataUrl: "data:image/png;base64,secret" },
      },
      rig: { bodies: [], joints: [] },
      settings: {
        grid: true,
        snap: false,
        floorPlan: {
          enabled: false,
          units: "ft",
          pixelsPerUnit: 32,
          wallThickness: 0.5,
          gridSize: 32,
          alignmentGuides: true,
        },
      },
    },
    selectedIds: [],
    viewport: { x: 0, y: 0, zoom: 1, width: 1_000, height: 800 },
  };
}

function rectangle(id, x, y, options = {}) {
  return {
    id,
    type: "rectangle",
    x,
    y,
    w: options.w ?? 100,
    h: options.h ?? 60,
    rotation: 0,
    color: "#000000",
    strokeWidth: 3,
    dashPattern: "solid",
    locked: Boolean(options.locked),
    ...(options.groupId ? { groupId: options.groupId, rigidGroup: true } : {}),
    ...(options.semantic ? { semantic: options.semantic } : {}),
  };
}

function textbox(id, x, y, groupId) {
  return {
    id,
    type: "textbox",
    x,
    y,
    w: 76,
    h: 38,
    rotation: 0,
    text: id,
    colorRanges: [],
    fontSize: 18,
    fontFamily: "serif",
    color: "#000000",
    strokeWidth: 1,
    dashPattern: "solid",
    locked: false,
    groupId,
    rigidGroup: true,
  };
}

function execute(state, commands, createId = idFactory()) {
  return executeVisualBoardCommands(state, {
    commands,
    requestId: "visual-test",
  }, createId);
}

function idFactory() {
  let value = 0;
  return () => `generated-${++value}`;
}

test("multi-command failures leave the supplied board untouched", () => {
  const state = createState([rectangle("existing", 10, 20)]);
  const before = structuredClone(state);

  assert.throws(() => execute(state, [
    {
      type: "objects.create",
      objects: [{ objectType: "rectangle", label: "Temporary" }],
    },
    {
      type: "objects.transform",
      targets: { ids: ["missing"] },
      translate: { x: 20, y: 20 },
    },
  ]), (error) => error.code === "target-not-found" && error.commandIndex === 1);

  assert.deepEqual(state, before);
});

test("layouts translate complete rigid groups as single units", () => {
  const state = createState([
    rectangle("shape-a", 300, 100, { groupId: "group-a" }),
    textbox("text-a", 312, 110, "group-a"),
    rectangle("shape-b", 40, 280, { groupId: "group-b" }),
    textbox("text-b", 52, 290, "group-b"),
  ]);
  const beforeOffset = {
    x: state.board.objects[1].x - state.board.objects[0].x,
    y: state.board.objects[1].y - state.board.objects[0].y,
  };

  const result = execute(state, [{
    type: "objects.layout",
    targets: { ids: ["shape-a", "shape-b"] },
    layoutType: "horizontal",
    gap: 40,
  }]);
  const shapeA = result.state.board.objects.find((object) => object.id === "shape-a");
  const textA = result.state.board.objects.find((object) => object.id === "text-a");
  const shapeB = result.state.board.objects.find((object) => object.id === "shape-b");

  assert.equal(textA.x - shapeA.x, beforeOffset.x);
  assert.equal(textA.y - shapeA.y, beforeOffset.y);
  assert.ok(Math.abs(shapeA.x - shapeB.x) >= 140);
  assert.deepEqual(
    new Set(result.receipt.updatedIds),
    new Set(["shape-a", "text-a", "shape-b", "text-b"]),
  );
});

test("semantic connectors follow transformed nodes and disappear with deleted endpoints", () => {
  const connection = {
    id: "edge",
    type: "connector",
    x: 50,
    y: 30,
    endX: 250,
    endY: 30,
    color: "#000000",
    strokeWidth: 3,
    dashPattern: "solid",
    locked: false,
    semantic: { sourceId: "source", targetId: "target", role: "connection" },
  };
  const state = createState([
    connection,
    rectangle("source", 0, 0),
    rectangle("target", 200, 0),
  ]);

  const moved = execute(state, [{
    type: "objects.transform",
    targets: { ids: ["source"] },
    translate: { x: 80, y: 40 },
  }]);
  const movedConnection = moved.state.board.objects.find((object) => object.id === "edge");
  assert.deepEqual(
    [movedConnection.x, movedConnection.y, movedConnection.endX, movedConnection.endY],
    [130, 70, 250, 30],
  );

  const deleted = execute(state, [{
    type: "objects.delete",
    targets: { ids: ["source"] },
  }]);
  assert.equal(deleted.state.board.objects.some((object) => object.id === "edge"), false);
  assert.deepEqual(new Set(deleted.receipt.deletedIds), new Set(["source", "edge"]));
});

test("AI flips preserve complete rig topology and mirror joint positions", () => {
  const state = createState([
    rectangle("left", 0, 0, { w: 10, h: 10, groupId: "body-left" }),
    rectangle("right", 30, 0, { w: 10, h: 10, groupId: "body-right" }),
  ]);
  state.board.rig = {
    bodies: [
      { id: "body-left", objectIds: ["left"], jointIds: ["elbow"] },
      { id: "body-right", objectIds: ["right"], jointIds: ["elbow"] },
    ],
    joints: [{
      id: "elbow",
      x: 10,
      y: 5,
      bodyIds: ["body-left", "body-right"],
    }],
  };

  const result = execute(state, [{
    type: "objects.transform",
    targets: { ids: ["left", "right"] },
    flipHorizontal: true,
  }]);

  assert.equal(result.state.board.objects.find((object) => object.id === "left").x, 30);
  assert.equal(result.state.board.objects.find((object) => object.id === "right").x, 0);
  assert.equal(result.state.board.rig.joints[0].x, 30);
  assert.deepEqual(result.state.board.rig.joints[0].bodyIds, ["body-left", "body-right"]);
});

test("floor-plan commands insert ordinary editable objects with normalized settings", () => {
  const result = execute(createState(), [{
    type: "floor-plan.insert",
    kind: "bedroom",
    placement: { type: "point", x: 100, y: 200 },
    settings: {
      units: "m",
      pixelsPerUnit: 20,
      wallThickness: 0.2,
      gridSize: 20,
      alignmentGuides: false,
    },
  }]);

  assert.ok(result.state.board.objects.length > 5);
  assert.equal(result.receipt.createdIds.length, result.state.board.objects.length);
  assert.ok(result.state.board.objects.every((object) => object.semantic?.tags?.includes("floor-plan")));
  assert.ok(result.state.board.objects.every((object) => object.groupId));
  assert.equal(result.state.board.settings.floorPlan.units, "m");
  assert.equal(result.state.board.settings.floorPlan.gridSize, 20);
  assert.equal(result.state.board.settings.floorPlan.alignmentGuides, false);
});

test("preview is side-effect free and apply crosses one commit boundary", async () => {
  const state = createState();
  let commits = 0;
  const adapter = createVisualBoardAiAdapter({
    getState: () => state,
    createId: idFactory(),
    commit: async (nextState) => {
      commits += 1;
      state.board = nextState.board;
      state.selectedIds = nextState.selectedIds;
      state.viewport = nextState.viewport;
      state.board.revision += 1;
      return state.board.revision;
    },
  });
  const envelope = {
    requestId: "diagram-request",
    commands: [{
      type: "diagram.create",
      diagramType: "flowchart",
      nodes: ["Start", "Finish"],
      edges: [{ from: "node-1", to: "node-2" }],
    }],
  };

  const preview = await adapter.preview(envelope);
  assert.equal(commits, 0);
  assert.equal(state.board.objects.length, 0);
  assert.equal(preview.createdIds.length, 5);

  const applied = await adapter.apply(envelope);
  assert.equal(commits, 1);
  assert.equal(state.board.objects.length, 5);
  assert.equal(applied.createdIds.length, 5);
});

test("context is bounded and never includes image bytes or drawing paths", () => {
  const state = createState([{
    id: "pen-1",
    type: "pen",
    points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    color: "#000000",
    strokeWidth: 3,
    dashPattern: "solid",
    locked: false,
  }]);

  const context = serializeVisualBoardContext(state);
  assert.equal(context.assets.bytesIncluded, false);
  assert.equal("dataUrl" in context.assets, false);
  assert.equal("points" in context.objects[0], false);
});

test("busy boards reject both preview and apply", async () => {
  const adapter = createVisualBoardAiAdapter({
    getState: () => createState(),
    createId: idFactory(),
    commit: async () => 8,
    isBusy: () => "editing text",
  });
  const envelope = {
    requestId: "busy-request",
    commands: [{
      type: "objects.create",
      objects: [{ objectType: "rectangle" }],
    }],
  };

  await assert.rejects(() => adapter.preview(envelope), (error) => error.code === "tool-busy");
  await assert.rejects(() => adapter.apply(envelope), (error) => error.code === "tool-busy");
});

test("every advertised command has a field schema and unknown fields fail", () => {
  const capabilities = getVisualBoardAiCapabilities();
  assert.equal(capabilities.version, 2);
  assert.equal(capabilities.commands.length, 25);
  capabilities.commands.forEach((command) => {
    assert.equal(command.schema.type, "object", command.type);
    assert.equal(command.schema.additionalProperties, false, command.type);
    assert.ok(command.schema.properties.type, command.type);
  });

  assert.throws(() => execute(createState(), [{
    type: "objects.create",
    objects: [{ objectType: "rectangle" }],
    typoPlacement: "center",
  }]), (error) => error.code === "unknown-command-field");
});

test("architectural commands preserve exact caller geometry and compact symbol references", () => {
  const result = execute(createState(), [
    {
      type: "architecture.areas.create",
      areas: [{
        clientKey: "lawn",
        vertices: [
          { x: 10, y: 20 },
          { x: 310, y: 30 },
          { x: 280, y: 220 },
          { x: 20, y: 200 },
        ],
        materialId: "lawn",
        layerId: "site",
        zIndex: -20,
      }],
    },
    {
      type: "architecture.walls.create",
      walls: [{
        clientKey: "north-wall",
        start: { x: 50, y: 60 },
        end: { x: 250, y: 60 },
        thickness: 12,
        layerId: "structure",
        style: { fillColor: "#332c27", strokeWidth: 1 },
      }],
    },
    {
      type: "architecture.symbols.place",
      symbols: [{
        clientKey: "primary-bed",
        symbolId: "bed-queen",
        x: 80,
        y: 90,
        w: 70,
        h: 98,
        rotation: 0.25,
        layerId: "furniture",
      }],
    },
  ]);

  const area = result.state.board.objects.find((object) => object.type === "area");
  const wall = result.state.board.objects.find((object) => object.type === "wall");
  const symbol = result.state.board.objects.find((object) => object.type === "symbol");
  assert.equal(area.materialId, "lawn");
  assert.equal(area.layerId, "site");
  assert.equal(wall.w, 200);
  assert.equal(wall.h, 12);
  assert.equal(wall.rotation, 0);
  assert.equal(symbol.symbolId, "bed-queen");
  assert.deepEqual([symbol.x, symbol.y, symbol.w, symbol.h, symbol.rotation], [
    80, 90, 70, 98, 0.25,
  ]);
  assert.equal(symbol.semantic.clientRef, "primary-bed");
  assert.equal(result.receipt.clientKeyMap["primary-bed"], symbol.id);
});

test("architecture labels remain world-scaled and clipped to exact boxes", () => {
  const result = execute(createState(), [{
    type: "architecture.labels.create",
    labels: [{
      text: "PRIMARY SUITE\n18 × 16",
      x: 40,
      y: 50,
      w: 120,
      h: 56,
      fontSize: 14,
      textAlign: "center",
      verticalAlign: "middle",
      padding: 4,
      layerId: "labels",
    }],
  }]);
  const label = result.state.board.objects[0];

  assert.equal(label.scaleMode, "world");
  assert.deepEqual([label.x, label.y, label.w, label.h], [40, 50, 120, 56]);
  assert.equal(label.textAlign, "center");
  assert.equal(label.verticalAlign, "middle");
});

test("generic updates can refine architectural paint, layers, and label typography", () => {
  const state = createState([{
    id: "room-label",
    type: "textbox",
    x: 20,
    y: 30,
    w: 160,
    h: 60,
    rotation: 0,
    text: "ROOM",
    colorRanges: [],
    fontSize: 14,
    fontFamily: "sans",
    scaleMode: "world",
    color: "#000000",
    strokeWidth: 1,
    dashPattern: "solid",
    locked: false,
  }]);
  const result = execute(state, [{
    type: "objects.update",
    targets: { ids: ["room-label"] },
    patch: {
      materialId: "hardwood",
      fillOpacity: 0.7,
      opacity: 0.9,
      layerId: "labels",
      zIndex: 12,
      shadow: { opacity: 0.15, blur: 4, offsetX: 2, offsetY: 3 },
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.1,
      padding: 8,
    },
  }]);
  const object = result.state.board.objects[0];

  assert.equal(object.materialId, "hardwood");
  assert.equal(object.fillPattern, "wood");
  assert.equal(object.fillOpacity, 0.7);
  assert.equal(object.opacity, 0.9);
  assert.equal(object.layerId, "labels");
  assert.equal(object.zIndex, 12);
  assert.deepEqual(object.shadow, {
    color: "#000000",
    opacity: 0.15,
    blur: 4,
    offsetX: 2,
    offsetY: 3,
  });
  assert.equal(object.textAlign, "center");
  assert.equal(object.verticalAlign, "middle");
  assert.equal(object.lineHeight, 1.1);
  assert.equal(object.padding, 8);
});

test("semantic targets support exact diagram, role, and tag selectors", () => {
  const state = createState([
    rectangle("site", 0, 0, {
      semantic: {
        diagramId: "estate-v2",
        role: "site-area",
        tags: ["estate", "site"],
      },
    }),
    rectangle("room", 200, 0, {
      semantic: {
        diagramId: "estate-v2",
        role: "room",
        tags: ["estate", "floor-plan"],
      },
    }),
  ]);
  const result = execute(state, [{
    type: "objects.update",
    targets: { diagramId: "estate-v2", tag: "estate" },
    patch: { opacity: 0.85 },
  }]);

  assert.deepEqual(result.state.board.objects.map((object) => object.opacity), [0.85, 0.85]);
  assert.throws(() => execute(state, [{
    type: "objects.delete",
    targets: { typoSelector: "estate-v2" },
  }]), (error) => error.code === "unknown-command-field");
});

test("query-only architecture inspection does not cross a commit boundary", async () => {
  const state = createState([rectangle("room-a", 0, 0), rectangle("room-b", 50, 30)]);
  let commits = 0;
  const adapter = createVisualBoardAiAdapter({
    getState: () => state,
    createId: idFactory(),
    commit: async () => {
      commits += 1;
      return 8;
    },
  });
  const envelope = {
    requestId: "inspect-only",
    commands: [{
      type: "architecture.inspect",
      targets: { ids: ["room-a", "room-b"] },
      includeIntersections: true,
    }],
  };

  const preview = await adapter.preview(envelope);
  const applied = await adapter.apply(envelope);
  assert.equal(commits, 0);
  assert.equal(preview.result.outputs[0].intersections.length, 1);
  assert.equal(applied.undoGroupId, null);
});

test("architecture validation rejects unknown nested fields atomically", () => {
  const state = createState();
  assert.throws(() => execute(state, [{
    type: "architecture.walls.create",
    walls: [{
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0, typo: true },
      thickness: 8,
    }],
  }]), (error) => error.code === "unknown-command-field");
  assert.equal(state.board.objects.length, 0);
});

test("viewport focus centers using the requested zoom rather than the old zoom", () => {
  const state = createState();
  state.viewport = { x: 0, y: 0, zoom: 1, width: 1_000, height: 800 };
  const result = execute(state, [{
    type: "viewport.focus",
    point: { x: 2_000, y: 1_000 },
    zoom: 0.5,
  }]);

  assert.deepEqual(result.state.viewport, {
    x: 1_000,
    y: 200,
    zoom: 0.5,
    width: 1_000,
    height: 800,
  });
});

test("geometry context exposes exact architecture frames and styles on request", () => {
  const state = createState([{
    id: "symbol-1",
    type: "symbol",
    symbolId: "sofa",
    x: 10,
    y: 20,
    w: 140,
    h: 60,
    rotation: 0.2,
    color: "#332211",
    fillColor: "#d8c7ba",
    fillOpacity: 0.8,
    fillPattern: "solid",
    opacity: 1,
    strokeWidth: 2,
    dashPattern: "solid",
    layerId: "furniture",
    zIndex: 5,
    locked: false,
  }]);
  const context = serializeVisualBoardContext(state, { detail: "geometry" });

  assert.equal(context.objects[0].symbolId, "sofa");
  assert.deepEqual(context.objects[0].frame, {
    x: 10,
    y: 20,
    w: 140,
    h: 60,
    rotation: 0.2,
  });
  assert.equal(context.objects[0].style.fillColor, "#d8c7ba");
  assert.equal(context.objects[0].layerId, "furniture");
});
