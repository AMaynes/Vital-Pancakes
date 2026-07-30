import assert from "node:assert/strict";
import test from "node:test";

import {
  getArchitectureCatalog,
  getArchitectureGeometryReport,
  getArchitectureMaterial,
  getArchitectureSymbol,
  normalizeArchitectureSettings,
  resolveMaterialStyle,
  sortArchitectureObjects,
} from "./visual-board-architecture.mjs";

test("bundled architectural catalogs expose stable vector assets and materials", () => {
  const catalog = getArchitectureCatalog();
  assert.ok(catalog.symbols.length >= 30);
  assert.ok(catalog.materials.length >= 12);
  assert.equal(getArchitectureSymbol("bed-queen").category, "bedroom");
  assert.equal(getArchitectureMaterial("lawn").fillPattern, "grass");
  assert.equal(getArchitectureSymbol("missing"), null);
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
