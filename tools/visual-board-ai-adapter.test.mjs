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
      version: 14,
      revision: 7,
      objects,
      assets: {
        image1: { name: "Private scan", dataUrl: "data:image/png;base64,secret" },
      },
      rig: { bodies: [], joints: [] },
      settings: {
        grid: true,
        snap: false,
        fillColor: "#f7f4ec",
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

test("group and ungroup commands use one reversible grouping model", () => {
  const grouped = execute(createState([
    rectangle("first", 20, 30),
    rectangle("second", 180, 30),
  ]), [{
    type: "objects.group",
    targets: { ids: ["first", "second"] },
  }]);
  const groupIds = new Set(grouped.state.board.objects.map((object) => object.groupId));

  assert.equal(groupIds.size, 1);
  assert.ok([...groupIds][0]);
  assert.ok(grouped.state.board.objects.every((object) => object.rigidGroup));

  const ungrouped = execute(grouped.state, [{
    type: "objects.ungroup",
    targets: { ids: ["first"] },
  }]);
  assert.ok(ungrouped.state.board.objects.every((object) => !object.groupId));
  assert.ok(ungrouped.state.board.objects.every((object) => !object.rigidGroup));
});

test("ungroup splits an ungrouped square into four selected line parts", () => {
  const result = execute(createState([
    rectangle("square", 20, 30, { w: 80, h: 80 }),
  ]), [{
    type: "objects.ungroup",
    targets: { ids: ["square"] },
  }]);

  assert.equal(result.state.board.objects.length, 4);
  assert.ok(result.state.board.objects.every((object) => object.type === "line"));
  assert.deepEqual(result.state.selectedIds, result.state.board.objects.map((object) => object.id));
  assert.deepEqual(result.receipt.deletedIds, ["square"]);
  assert.equal(result.receipt.createdIds.length, 4);
  assert.equal(new Set(result.state.board.objects.map((object) => object.assemblyId)).size, 1);
});

test("AI grouping nests existing groups and ungroup restores one level", () => {
  const state = createState([
    rectangle("arm-a", 0, 0, { groupId: "arm" }),
    rectangle("arm-b", 30, 0, { groupId: "arm" }),
    rectangle("hand-a", 70, 0, { groupId: "hand" }),
    rectangle("hand-b", 100, 0, { groupId: "hand" }),
  ]);
  const nested = execute(state, [{
    type: "objects.group",
    targets: { ids: ["arm-a", "hand-a"] },
  }]);
  const outerGroupId = nested.state.board.objects[0].groupId;

  assert.ok(outerGroupId);
  assert.ok(nested.state.board.objects.every((object) => object.groupId === outerGroupId));
  assert.deepEqual(
    nested.state.board.objects.map((object) => object.groupHistory.at(-1)?.id),
    ["arm", "arm", "hand", "hand"],
  );

  const restored = execute(nested.state, [{
    type: "objects.ungroup",
    targets: { ids: ["arm-a"] },
  }]);
  assert.deepEqual(
    restored.state.board.objects.map((object) => object.groupId),
    ["arm", "arm", "hand", "hand"],
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

test("AI inserts Floor Plan-only polygon wall primitives with exact side counts", () => {
  const result = execute(createState(), [{
    type: "floor-plan.insert",
    kind: "outside-fence",
    placement: { type: "point", x: 100, y: 200 },
    settings: {
      wallSides: 9,
      pixelsPerUnit: 20,
      wallThickness: 0.5,
    },
  }]);

  assert.equal(result.state.board.objects.length, 9);
  assert.equal(result.state.board.settings.floorPlan.wallSides, 9);
  assert.ok(result.state.board.objects.every((object) => (
    object.semantic.role === "floor-plan-outside-fence"
    && object.semantic.tags.includes("wall-shape")
  )));
  assert.throws(() => execute(result.state, [{
    type: "lines.points.insert",
    targets: { ids: [result.state.board.objects[0].id] },
    points: [{ x: 100, y: 100 }],
  }]), (error) => error.code === "floor-plan-wall-face-limit");
});

test("AI inserts authored floor-plan defaults as single editable units", () => {
  const result = execute(createState(), [{
    type: "floor-plan.insert",
    kind: "sectional-sofa",
    placement: { type: "point", x: 100, y: 200 },
  }]);

  assert.equal(result.state.board.objects.length, 25);
  assert.equal(
    new Set(result.state.board.objects.map((object) => object.groupId)).size,
    1,
  );
  assert.ok(result.state.board.objects.every((object) => (
    object.layerId === "furniture"
    && object.semantic?.generatedBy === "floor-plan-authored-default"
  )));
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
  assert.equal(capabilities.version, 16);
  assert.equal(capabilities.commands.length, 54);
  const createSchema = capabilities.commands
    .find((command) => command.type === "objects.create").schema;
  const viewportSchema = capabilities.commands
    .find((command) => command.type === "viewport.focus").schema;
  const floorPlanSchema = capabilities.commands
    .find((command) => command.type === "floor-plan.insert").schema;
  assert.equal(createSchema.properties.objects.items.properties.strokeWidth.minimum, 0.05);
  assert.equal(viewportSchema.properties.zoom.minimum, 0.02);
  assert.equal(viewportSchema.properties.zoom.maximum, 32);
  assert.ok(floorPlanSchema.properties.kind.enum.includes("sectional-sofa"));
  assert.ok(floorPlanSchema.properties.kind.enum.includes("pool-hot-tub"));
  assert.ok(floorPlanSchema.properties.kind.enum.includes("outer-building-wall"));
  assert.equal(floorPlanSchema.properties.settings.properties.wallSides.maximum, 9);
  assert.ok(capabilities.architectureCatalog.symbols.length >= 100);
  assert.ok(capabilities.architectureCatalog.materials.length >= 20);
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

test("AI commands create complex curves and insert exact editable points", () => {
  const created = execute(createState(), [{
    type: "objects.create",
    objects: [{
      objectType: "arc",
      clientKey: "motion-path",
      curvePoints: [
        { x: 0, y: 40 },
        { x: 40, y: 0 },
        { x: 80, y: 70 },
        { x: 120, y: 20 },
      ],
    }],
  }]);
  const curve = created.state.board.objects[0];
  assert.equal(curve.curvePoints.length, 4);
  assert.equal(curve.curveHandles.length, 3);

  const inserted = execute(created.state, [{
    type: "curves.points.insert",
    targets: { ids: [curve.id] },
    points: [{ x: 95, y: 45 }],
  }]);
  assert.equal(inserted.state.board.objects[0].curvePoints.length, 5);
  assert.equal(inserted.outputs[0].type, "curves.points.insert");
  assert.equal(inserted.outputs[0].curvePointCount, 5);

  const context = serializeVisualBoardContext(inserted.state, { detail: "geometry" });
  assert.equal(context.objects[0].curvePointCount, 5);
  assert.equal(context.objects[0].curvePoints.length, 5);
});

test("AI inserts movable vertices into lines without losing arrow endpoints", () => {
  const state = createState([{
    id: "arrow",
    type: "connector",
    x: 0,
    y: 0,
    endX: 100,
    endY: 0,
    arrowStart: true,
    arrowEnd: true,
    color: "#000000",
    strokeWidth: 2,
    dashPattern: "solid",
    locked: false,
  }]);
  const result = execute(state, [{
    type: "lines.points.insert",
    targets: { ids: ["arrow"] },
    points: [{ x: 40, y: 5 }],
  }]);

  assert.equal(result.state.board.objects.length, 2);
  assert.equal(result.outputs[0].type, "lines.points.insert");
  assert.equal(result.outputs[0].segmentCount, 2);
  assert.equal(result.state.board.objects[0].arrowStart, true);
  assert.equal(result.state.board.objects[0].arrowEnd, false);
  assert.equal(result.state.board.objects[1].arrowStart, false);
  assert.equal(result.state.board.objects[1].arrowEnd, true);
  assert.equal(
    result.state.board.objects[0].endVertexId,
    result.state.board.objects[1].startVertexId,
  );
});

test("AI reinitializes dense curves to endpoints and meaningful extrema", () => {
  const state = createState([{
    id: "curve",
    type: "arc",
    x: 0,
    y: 0,
    midX: 50,
    midY: -50,
    endX: 100,
    endY: 0,
    color: "#000000",
    strokeWidth: 3,
    dashPattern: "solid",
    locked: false,
  }]);
  const inserted = execute(state, [{
    type: "curves.points.insert",
    targets: { ids: ["curve"] },
    points: [
      { x: 25, y: -35 },
      { x: 75, y: -35 },
    ],
  }]);
  const result = execute(inserted.state, [{
    type: "curves.vertices.reinitialize",
    targets: { ids: ["curve"] },
  }]);

  assert.equal(inserted.state.board.objects[0].curvePoints.length, 5);
  assert.equal(result.state.board.objects[0].curvePoints.length, 3);
  assert.equal(result.outputs[0].type, "curves.vertices.reinitialize");
  assert.equal(result.outputs[0].curves[0].beforeCount, 5);
  assert.equal(result.outputs[0].curves[0].vertexCount, 3);
});

test("AI can create, edit, insert, remove, and list custom floor-plan elements", () => {
  const state = createState([rectangle("custom-fixture", 40, 60)]);
  const result = execute(state, [
    {
      type: "floor-plan.elements.create",
      elementId: "reading-chair",
      name: "Reading chair",
      description: "Custom chair symbol",
      category: "maintenance",
      targets: { ids: ["custom-fixture"] },
    },
    {
      type: "floor-plan.elements.update",
      elementId: "reading-chair",
      name: "Library chair",
    },
    {
      type: "floor-plan.elements.insert",
      elementId: "reading-chair",
      placement: { type: "point", x: 400, y: 300 },
    },
    {
      type: "floor-plan.elements.list",
    },
  ]);

  const library = result.state.board.settings.floorPlan.elementLibrary;
  const saved = library.items.find((item) => item.id === "reading-chair");
  const listOutput = result.outputs.find(
    (output) => output.type === "floor-plan.elements.list",
  );
  assert.equal(saved.name, "Library chair");
  assert.equal(saved.category, "maintenance");
  assert.equal(saved.character.objects.length, 1);
  assert.equal(result.state.board.objects.length, 2);
  assert.equal(
    listOutput.elements.find((item) => item.id === "reading-chair").source,
    "custom",
  );

  const removed = execute(result.state, [{
    type: "floor-plan.elements.remove",
    elementId: "reading-chair",
    password: "password",
  }]);
  assert.equal(removed.state.board.settings.floorPlan.elementLibrary.items.length, 0);
});

test("AI can replace, hide, and restore built-in floor-plan elements", () => {
  const state = createState([rectangle("replacement-element", 10, 20)]);
  const customized = execute(state, [{
    type: "floor-plan.elements.replace",
    elementId: "bed",
    name: "My bed",
    targets: { ids: ["replacement-element"] },
  }]);
  const customizedContext = serializeVisualBoardContext(customized.state);
  const bed = customizedContext.floorPlanElements.find((item) => item.id === "bed");

  assert.equal(bed.source, "override");
  assert.equal(bed.objectCount, 1);
  assert.equal(JSON.stringify(customizedContext.settings).includes("\"objects\""), false);

  const insertedOverride = execute(customized.state, [{
    type: "floor-plan.insert",
    kind: "bed",
    placement: { type: "point", x: 300, y: 220 },
  }]);
  assert.equal(insertedOverride.state.board.objects.length, 2);

  const hidden = execute(customized.state, [{
    type: "floor-plan.elements.remove",
    elementId: "bed",
    password: "password",
  }]);
  assert.equal(
    hidden.state.board.settings.floorPlan.elementLibrary.hiddenBuiltIns.includes("bed"),
    true,
  );
  assert.throws(() => execute(hidden.state, [{
    type: "floor-plan.insert",
    kind: "bed",
  }]), (error) => error.code === "element-not-found");

  const restored = execute(hidden.state, [{
    type: "floor-plan.elements.restore",
    elementId: "bed",
  }]);
  const restoredBed = serializeVisualBoardContext(restored.state)
    .floorPlanElements.find((item) => item.id === "bed");
  assert.equal(restoredBed.visible, true);
  assert.equal(restoredBed.source, "built-in");
});

test("AI shared-vertex creation joins mixed line and curve intersections", () => {
  const state = createState([
    {
      id: "curve",
      type: "arc",
      x: 0,
      y: 50,
      midX: 50,
      midY: 0,
      endX: 100,
      endY: 50,
      color: "#000000",
      strokeWidth: 3,
      dashPattern: "solid",
      locked: false,
    },
    {
      id: "line",
      type: "line",
      x: 0,
      y: 25,
      endX: 100,
      endY: 25,
      color: "#000000",
      strokeWidth: 3,
      dashPattern: "solid",
      locked: false,
    },
  ]);
  const result = execute(state, [{
    type: "vertices.create",
    targets: { ids: ["curve", "line"] },
  }]);
  const curve = result.state.board.objects.find((object) => object.type === "arc");
  const lines = result.state.board.objects.filter((object) => object.type === "line");

  assert.equal(lines.length, 3);
  assert.equal(curve.curvePoints.length, 5);
  assert.ok(curve.vertexNetworkId);
  assert.ok(lines.every((line) => line.vertexNetworkId === curve.vertexNetworkId));
  assert.equal(result.outputs[0].type, "vertices.create");
});

test("AI shared-vertex creation converts outlined shapes without a divide step", () => {
  const result = execute(createState([
    rectangle("box", 20, 30, { w: 120, h: 80 }),
  ]), [{
    type: "vertices.create",
    targets: { ids: ["box"] },
  }]);
  const lines = result.state.board.objects.filter((object) => object.type === "line");

  assert.equal(result.state.board.objects.some((object) => object.id === "box"), false);
  assert.equal(lines.length, 4);
  assert.ok(lines.every((line) => line.vertexNetworkId));
  assert.ok(result.receipt.deletedIds.includes("box"));
});

test("AI shared-vertex creation expands groups and preserves them beneath the network", () => {
  const result = execute(createState([
    {
      id: "first",
      type: "line",
      x: 0,
      y: 0,
      endX: 50,
      endY: 50,
      color: "#000000",
      strokeWidth: 3,
      dashPattern: "solid",
      locked: false,
      groupId: "limb",
      rigidGroup: true,
    },
    {
      id: "second",
      type: "line",
      x: 0,
      y: 50,
      endX: 50,
      endY: 0,
      color: "#000000",
      strokeWidth: 3,
      dashPattern: "solid",
      locked: false,
      groupId: "limb",
      rigidGroup: true,
    },
  ]), [{
    type: "vertices.create",
    targets: { ids: ["first"] },
  }]);

  assert.equal(result.state.board.objects.length, 4);
  assert.ok(result.state.board.objects.every((object) => (
    object.vertexNetworkId
    && object.groupHistory.at(-1)?.id === "limb"
    && object.groupHistory.at(-1)?.rigidGroup
  )));
});

test("AI merges two existing grouped network vertices by stable ID", () => {
  const state = createState([
    {
      id: "first",
      type: "line",
      x: 0,
      y: 0,
      endX: 50,
      endY: 0,
      color: "#000000",
      strokeWidth: 3,
      dashPattern: "solid",
      locked: false,
      groupId: "network-group",
      vertexNetworkId: "network",
      startVertexId: "left",
      endVertexId: "source",
    },
    {
      id: "second",
      type: "line",
      x: 100,
      y: 0,
      endX: 150,
      endY: 0,
      color: "#000000",
      strokeWidth: 3,
      dashPattern: "solid",
      locked: false,
      groupId: "network-group",
      vertexNetworkId: "network",
      startVertexId: "target",
      endVertexId: "right",
    },
  ]);
  const result = execute(state, [{
    type: "vertices.merge",
    sourceVertexId: "source",
    targetVertexId: "target",
  }]);

  assert.equal(result.state.board.objects[0].endVertexId, "target");
  assert.deepEqual(
    [result.state.board.objects[0].endX, result.state.board.objects[0].endY],
    [100, 0],
  );
  assert.equal(result.outputs[0].type, "vertices.merge");
  assert.deepEqual(
    serializeVisualBoardContext(result.state, { detail: "geometry" })
      .objects.map((object) => object.vertexIds),
    [
      { start: "left", end: "target" },
      { start: "target", end: "right" },
    ],
  );
});

test("AI can create, edit, insert, remove, and list custom floor-plan templates", () => {
  const state = createState([rectangle("room-block", 40, 60)]);
  const result = execute(state, [
    {
      type: "floor-plan.templates.create",
      templateId: "garden-suite",
      name: "Garden suite",
      description: "Bedroom and patio block",
      category: "rooms",
      targets: { ids: ["room-block"] },
    },
    {
      type: "floor-plan.templates.update",
      templateId: "garden-suite",
      name: "Garden guest suite",
    },
    {
      type: "floor-plan.templates.insert",
      templateId: "garden-suite",
      placement: { type: "point", x: 400, y: 300 },
    },
    {
      type: "floor-plan.templates.list",
    },
  ]);

  const library = result.state.board.settings.floorPlan.templateLibrary;
  const saved = library.items.find((item) => item.id === "garden-suite");
  const listOutput = result.outputs.find(
    (output) => output.type === "floor-plan.templates.list",
  );
  assert.equal(saved.name, "Garden guest suite");
  assert.equal(saved.character.objects.length, 1);
  assert.equal(result.state.board.objects.length, 2);
  assert.equal(listOutput.templates.find((item) => item.id === "garden-suite").source, "custom");

  const removed = execute(result.state, [{
    type: "floor-plan.templates.remove",
    templateId: "garden-suite",
    password: "password",
  }]);
  assert.equal(removed.state.board.settings.floorPlan.templateLibrary.items.length, 0);
});

test("AI can replace, hide, and restore built-in floor-plan templates", () => {
  const state = createState([rectangle("replacement", 10, 20)]);
  const customized = execute(state, [{
    type: "floor-plan.templates.replace",
    templateId: "bedroom",
    name: "My bedroom",
    targets: { ids: ["replacement"] },
  }]);
  const customizedContext = serializeVisualBoardContext(customized.state);
  const bedroom = customizedContext.floorPlanTemplates.find(
    (item) => item.id === "bedroom",
  );

  assert.equal(bedroom.source, "override");
  assert.equal(bedroom.objectCount, 1);
  assert.equal(JSON.stringify(customizedContext.settings).includes("\"objects\""), false);

  const hidden = execute(customized.state, [{
    type: "floor-plan.templates.remove",
    templateId: "bedroom",
    password: "password",
  }]);
  assert.equal(
    hidden.state.board.settings.floorPlan.templateLibrary.hiddenBuiltIns.includes("bedroom"),
    true,
  );

  const restored = execute(hidden.state, [{
    type: "floor-plan.templates.restore",
    templateId: "bedroom",
  }]);
  const restoredBedroom = serializeVisualBoardContext(restored.state)
    .floorPlanTemplates.find((item) => item.id === "bedroom");
  assert.equal(restoredBedroom.visible, true);
  assert.equal(restoredBedroom.source, "built-in");
});

test("AI layer commands support signed levels, bounded movement, and protected removal", () => {
  const createId = idFactory();
  const inserted = execute(createState(), [{
    type: "floor-plan.insert",
    kind: "layer-designator",
    placement: { type: "point", x: 100, y: 100 },
  }], createId);
  const designator = inserted.state.board.objects[0];
  const added = execute(inserted.state, [{
    type: "floor-plan.layers.add",
    designatorId: designator.id,
    level: -1,
  }], createId);
  const basementId = added.state.board.objects[0].activeFloorPlanRoomId;
  assert.equal(added.state.board.objects[0].floorPlanRooms[0].name, "Level -1");

  const bounded = execute(added.state, [{
    type: "floor-plan.layers.move",
    designatorId: designator.id,
    direction: "down",
  }], createId);
  assert.equal(bounded.outputs[0].moved, false);
  assert.equal(bounded.state.board.objects[0].activeFloorPlanRoomId, basementId);

  const returnedToOne = execute(bounded.state, [{
    type: "floor-plan.layers.move",
    designatorId: designator.id,
    direction: "up",
  }], createId);
  const floorTwo = execute(returnedToOne.state, [{
    type: "floor-plan.layers.add",
    designatorId: designator.id,
    level: 2,
  }], createId);
  const floorTwoId = floorTwo.state.board.objects[0].activeFloorPlanRoomId;
  floorTwo.state.board.objects.push(rectangle("floor-two-bed", 120, 140, {
    semantic: {
      referenceId: designator.id,
      roomId: floorTwoId,
    },
  }));

  const cycled = execute(floorTwo.state, [{
    type: "floor-plan.layers.cycle",
    designatorId: designator.id,
    direction: "previous",
  }], createId);
  assert.notEqual(cycled.state.board.objects[0].activeFloorPlanRoomId, floorTwoId);

  assert.throws(() => execute(cycled.state, [{
    type: "floor-plan.layers.remove",
    designatorId: designator.id,
    password: "wrong",
  }], createId), (error) => error.code === "invalid-removal-password");

  const returned = execute(cycled.state, [{
    type: "floor-plan.layers.move",
    designatorId: designator.id,
    direction: "up",
  }], createId);
  const removed = execute(returned.state, [{
    type: "floor-plan.layers.remove",
    designatorId: designator.id,
    password: "password",
  }], createId);
  assert.equal(removed.state.board.objects.length, 1);
  assert.equal(removed.outputs[0].deletedObjectCount, 1);
});

test("AI creates and updates double-sided arrows truthfully", () => {
  const created = execute(createState(), [{
    type: "objects.create",
    objects: [{
      objectType: "connector",
      x: 0,
      y: 0,
      endX: 100,
      endY: 0,
      arrowStart: true,
      arrowEnd: true,
    }],
  }]);
  assert.equal(created.state.board.objects[0].arrowStart, true);

  const updated = execute(created.state, [{
    type: "objects.update",
    targets: { ids: [created.state.board.objects[0].id] },
    patch: { arrowStart: false },
  }]);
  assert.equal(updated.state.board.objects[0].arrowStart, false);
  assert.equal(
    serializeVisualBoardContext(updated.state).objects[0].arrowEnd,
    true,
  );
});

test("AI fill updates can paint and clear closed object fills", () => {
  const state = createState([rectangle("paintable", 0, 0)]);
  const painted = execute(state, [{
    type: "objects.update",
    targets: { ids: ["paintable"] },
    patch: { fillColor: "#336699" },
  }]);
  assert.equal(painted.state.board.objects[0].fillColor, "#336699");

  const cleared = execute(painted.state, [{
    type: "objects.update",
    targets: { ids: ["paintable"] },
    patch: { fillColor: null },
  }]);
  assert.equal("fillColor" in cleared.state.board.objects[0], false);
});

test("floor-plan catalog removals reject an incorrect password", () => {
  assert.throws(() => execute(createState(), [{
    type: "floor-plan.elements.remove",
    elementId: "bed",
    password: "wrong",
  }]), (error) => error.code === "invalid-removal-password");
});

test("floor-plan templates reject image-backed targets", () => {
  const image = {
    id: "image-template",
    type: "image",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    assetId: "image1",
    color: "#000000",
    strokeWidth: 1,
    dashPattern: "solid",
    locked: false,
  };
  assert.throws(() => execute(createState([image]), [{
    type: "floor-plan.templates.create",
    templateId: "image-room",
    name: "Image room",
    targets: { ids: ["image-template"] },
  }]), (error) => error.code === "template-image-not-allowed");
  assert.throws(() => execute(createState([image]), [{
    type: "floor-plan.elements.create",
    elementId: "image-fixture",
    name: "Image fixture",
    targets: { ids: ["image-template"] },
  }]), (error) => error.code === "element-image-not-allowed");
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

test("wall paths compile real gaps, connected joins, and semantic opening records", () => {
  const result = execute(createState(), [{
    type: "architecture.wallPaths.create",
    wallPaths: [{
      clientKey: "shell",
      points: [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 220 },
      ],
      thickness: 16,
      join: "miter",
      cap: "square",
      materialId: "plaster",
      openings: [
        {
          clientKey: "front-door",
          segmentIndex: 0,
          offset: 110,
          width: 80,
          kind: "door-single",
        },
        {
          segmentIndex: 1,
          offset: 50,
          width: 100,
          kind: "window-fixed",
        },
      ],
      style: { lineWeight: "exterior" },
    }],
  }]);

  const walls = result.state.board.objects.filter((object) => object.type === "wall");
  const openings = result.state.board.objects.filter((object) => object.type === "symbol");
  assert.equal(walls.length, 3);
  assert.equal(openings.length, 2);
  assert.ok(result.state.board.objects.some((object) => object.type === "area"));
  assert.equal(openings[0].semantic.wallPathId, "shell");
  assert.equal(openings[0].semantic.openingIndex, 0);
  assert.equal(result.receipt.clientKeyMap.shell, walls[0].id);
  assert.equal(result.receipt.clientKeyMap["front-door"], openings[0].id);
  assert.equal(result.outputs[0].openingCount, undefined);
  assert.equal(result.outputs[0].wallPaths[0].openingCount, 2);
});

test("curved paths and architecture style presets remain deterministic", () => {
  const result = execute(createState(), [
    {
      type: "architecture.style.set",
      preset: "presentation-soft",
      lineWeights: { site: 5 },
      typography: {
        room: { fontFamily: "sans", fontSize: 13, fontWeight: 600, lineHeight: 1 },
      },
    },
    {
      type: "architecture.paths.create",
      paths: [{
        commands: [
          { op: "M", x: 0, y: 0 },
          { op: "C", c1x: 40, c1y: -20, c2x: 80, c2y: 20, x: 120, y: 0 },
          { op: "L", x: 120, y: 80 },
          { op: "Q", cx: 60, cy: 50, x: 0, y: 0 },
          { op: "Z" },
        ],
        materialId: "mulch",
        style: { lineWeight: "site" },
      }],
    },
    {
      type: "architecture.labels.create",
      labels: [{
        text: "GARDEN",
        x: 20,
        y: 20,
        w: 80,
        h: 30,
        textStyle: "room",
      }],
    },
  ]);

  const area = result.state.board.objects.find((object) => object.type === "area");
  const label = result.state.board.objects.find((object) => object.type === "textbox");
  assert.equal(result.state.board.settings.architecture.stylePreset, "presentation-soft");
  assert.equal(area.materialId, "mulch");
  assert.equal(area.strokeWidth, 5);
  assert.ok(area.vertices.length > 10);
  assert.equal(label.fontSize, 13);
  assert.equal(label.fontWeight, 600);
});

test("reference overlays require consent and never expose image bytes", () => {
  const image = {
    id: "reference-image",
    type: "image",
    x: 10,
    y: 20,
    w: 640,
    h: 480,
    rotation: 0,
    assetId: "asset-secret",
    name: "Reference.png",
    color: "#000000",
    strokeWidth: 1,
    dashPattern: "solid",
    locked: false,
  };
  const state = createState([image]);
  state.board.assets["asset-secret"] = {
    dataUrl: "data:image/png;base64,PRIVATE-BYTES",
  };

  assert.throws(() => execute(state, [{
    type: "architecture.references.configure",
    targets: { ids: ["reference-image"] },
  }]), (error) => error.code === "reference-consent-required");

  const result = execute(state, [{
    type: "architecture.references.configure",
    targets: { ids: ["reference-image"] },
    consent: true,
    referenceName: "Estate inspiration",
    opacity: 0.25,
  }]);
  const configured = result.state.board.objects[0];
  const context = serializeVisualBoardContext(result.state, { detail: "geometry" });

  assert.equal(configured.referenceImage, true);
  assert.equal(configured.locked, true);
  assert.equal(configured.hiddenInExport, true);
  assert.equal(configured.semantic.referenceId, "reference-image");
  assert.equal(context.objects[0].reference.bytesIncluded, false);
  assert.equal(JSON.stringify(context).includes("PRIVATE-BYTES"), false);
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
        wallPathId: "primary-shell",
      },
    }),
  ]);
  const result = execute(state, [{
    type: "objects.update",
    targets: { diagramId: "estate-v2", tag: "estate" },
    patch: { opacity: 0.85 },
  }]);

  assert.deepEqual(result.state.board.objects.map((object) => object.opacity), [0.85, 0.85]);
  const wallPathResult = execute(state, [{
    type: "objects.update",
    targets: { wallPathId: "primary-shell" },
    patch: { opacity: 0.7 },
  }]);
  assert.deepEqual(
    wallPathResult.state.board.objects.map((object) => object.opacity ?? 1),
    [1, 0.7],
  );
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

test("fine stroke widths survive command normalization", () => {
  const result = execute(createState(), [{
    type: "objects.create",
    objects: [{
      objectType: "line",
      x: 10,
      y: 20,
      endX: 110,
      endY: 120,
      strokeWidth: 0.05,
    }],
  }]);
  assert.equal(result.state.board.objects[0].strokeWidth, 0.05);
});

test("bucket commands fill connected regions underneath their boundaries", () => {
  const state = createState([
    { id: "top", type: "line", x: 0, y: 0, endX: 100, endY: 0, strokeWidth: 2 },
    { id: "right", type: "line", x: 100, y: 0, endX: 100, endY: 100, strokeWidth: 2 },
    { id: "bottom", type: "line", x: 100, y: 100, endX: 0, endY: 100, strokeWidth: 2 },
    { id: "left", type: "line", x: 0, y: 100, endX: 0, endY: 0, strokeWidth: 2 },
  ]);
  state.selectedIds = ["top"];
  const result = execute(state, [{
    type: "fills.paint",
    point: { x: 50, y: 50 },
    color: "#336699",
  }]);

  assert.equal(result.state.board.objects[0].semantic.role, "bucket-fill-region");
  assert.equal(result.state.board.objects[0].fillColor, "#336699");
  assert.deepEqual(result.state.board.objects.slice(1).map((object) => object.id), [
    "top",
    "right",
    "bottom",
    "left",
  ]);
  assert.deepEqual(result.state.selectedIds, []);
  assert.equal(result.state.board.settings.fillColor, "#336699");
  assert.equal(result.outputs[0].mode, "region");
});

test("fill swatch color can be updated as a persistent board setting", () => {
  const result = execute(createState(), [{
    type: "board.settings.update",
    settings: { fillColor: "#5588aa" },
  }]);
  assert.equal(result.state.board.settings.fillColor, "#5588aa");
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
