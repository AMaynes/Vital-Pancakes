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
      version: 12,
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
  assert.equal(capabilities.commands.length, 16);
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
