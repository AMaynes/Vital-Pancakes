import assert from "node:assert/strict";
import test from "node:test";

import {
  getArchitectureCatalog,
  getArchitectureGeometryReport,
  getArchitectureMaterial,
  getArchitectureSymbol,
  normalizeArchitectureSettings,
  resolveArchitectureLineWeight,
  resolveArchitectureTypography,
  resolveMaterialStyle,
  sortArchitectureObjects,
} from "./visual-board-architecture.mjs";

test("bundled architectural catalogs expose stable vector assets and materials", () => {
  const catalog = getArchitectureCatalog();
  assert.ok(catalog.symbols.length >= 100);
  assert.ok(catalog.materials.length >= 20);
  assert.ok(catalog.fillPatterns.length >= 18);
  assert.equal(catalog.stylePresets.length, 3);
  assert.equal(getArchitectureSymbol("bed-queen").category, "bedroom");
  assert.equal(getArchitectureSymbol("tree-deciduous").preserveAspectRatio, true);
  assert.equal(getArchitectureMaterial("lawn").fillPattern, "grass");
  assert.equal(getArchitectureSymbol("missing"), null);
});

test("architecture style presets normalize coherent line weights and typography", () => {
  const settings = normalizeArchitectureSettings({
    stylePreset: "presentation-soft",
    lineWeights: { exterior: 12 },
    typography: {
      room: { fontFamily: "sans", fontSize: 13, fontWeight: 600, lineHeight: 1 },
    },
  });

  assert.equal(settings.stylePreset, "presentation-soft");
  assert.equal(resolveArchitectureLineWeight("exterior", settings), 12);
  assert.deepEqual(resolveArchitectureTypography("room", settings), {
    role: "room",
    fontFamily: "sans",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1,
  });
});

test("architecture layers deterministically control visibility and stacking", () => {
  const settings = normalizeArchitectureSettings({
    layers: [
      { id: "labels", name: "Labels", order: 20, visible: true },
      { id: "site", name: "Site", order: -10, visible: true },
      { id: "hidden", name: "Hidden", order: 0, visible: false },
    ],
  });
  const sorted = sortArchitectureObjects([
    { id: "label", layerId: "labels", zIndex: 0 },
    { id: "site-high", layerId: "site", zIndex: 5 },
    { id: "hidden", layerId: "hidden", zIndex: 0 },
    { id: "site-low", layerId: "site", zIndex: 1 },
  ], settings);

  assert.deepEqual(sorted.map((object) => object.id), [
    "site-low",
    "site-high",
    "label",
  ]);
});

test("materials resolve to exact vector-safe paint without layout decisions", () => {
  assert.deepEqual(resolveMaterialStyle("water", {
    fillOpacity: 0.5,
    color: "#112233",
  }), {
    materialId: "water",
    fillColor: "#80cbe3",
    fillPattern: "water",
    fillOpacity: 0.5,
    color: "#112233",
  });
});

test("geometry reports bounds and bounded intersections without mutation", () => {
  const objects = [
    { id: "a", type: "rectangle", x: 0, y: 0, w: 100, h: 80 },
    { id: "b", type: "rectangle", x: 70, y: 60, w: 60, h: 60 },
    { id: "c", type: "rectangle", x: 300, y: 300, w: 20, h: 20 },
  ];
  const before = structuredClone(objects);
  const report = getArchitectureGeometryReport(objects);

  assert.deepEqual(report.bounds, { x: 0, y: 0, width: 320, height: 320 });
  assert.deepEqual(report.intersections, [{
    firstId: "a",
    secondId: "b",
    overlap: { x: 70, y: 60, width: 30, height: 20 },
  }]);
  assert.deepEqual(objects, before);
});

test("geometry reports account for rotated architectural frames", () => {
  const report = getArchitectureGeometryReport([{
    id: "wall",
    type: "wall",
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    rotation: Math.PI / 2,
  }]);

  assert.ok(Math.abs(report.bounds.x - 40) < 1e-9);
  assert.ok(Math.abs(report.bounds.y + 40) < 1e-9);
  assert.ok(Math.abs(report.bounds.width - 20) < 1e-9);
  assert.ok(Math.abs(report.bounds.height - 100) < 1e-9);
});

test("geometry quality checks distinguish real openings from disconnected walls", () => {
  const report = getArchitectureGeometryReport([
    {
      id: "wall-left",
      type: "wall",
      x: 0,
      y: -5,
      w: 40,
      h: 10,
      rotation: 0,
      semantic: { wallPathId: "shell", segmentIndex: 0 },
    },
    {
      id: "wall-right",
      type: "wall",
      x: 60,
      y: -5,
      w: 40,
      h: 10,
      rotation: 0,
      semantic: { wallPathId: "shell", segmentIndex: 0 },
    },
    {
      id: "door",
      type: "symbol",
      symbolId: "door-single",
      x: 40,
      y: -10,
      w: 20,
      h: 20,
      rotation: 0,
      semantic: {
        role: "architecture-opening-cut",
        wallPathId: "shell",
        segmentIndex: 0,
      },
    },
    {
      id: "room-area",
      type: "area",
      x: 0,
      y: 20,
      w: 100,
      h: 80,
      rotation: 0,
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      semantic: { roomId: "living" },
    },
  ], {
    includeConnectivity: true,
    includeRoomAccess: true,
  });

  assert.deepEqual(
    report.quality.disconnectedWallEndpoints.map((issue) => issue.endpoint),
    ["start", "end"],
  );
  assert.deepEqual(report.quality.roomAccessIssues, [{
    roomId: "living",
    areaId: "room-area",
  }]);
});
