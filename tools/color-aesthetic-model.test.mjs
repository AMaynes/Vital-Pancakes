import assert from "node:assert/strict";
import test from "node:test";

import {
  assignSemanticRoles,
  clusterRgbSamples,
  contrastRatio,
  generateHarmony,
  hexToRgb,
  migratePaletteProject,
  oklchToRgb,
  rgbToHex,
  rgbToOklch,
} from "./color-aesthetic-model.mjs";

test("hex, RGB, and OKLCH conversions round-trip within display precision", () => {
  const rgb = hexToRgb("#7B211A");
  assert.equal(rgbToHex(rgb), "#7B211A");
  assert.equal(rgbToHex(oklchToRgb(rgbToOklch(rgb))), "#7B211A");
  assert.throws(() => hexToRgb("#nope"), /Invalid/);
});

test("harmony generation is deterministic for a seed", () => {
  const first = generateHarmony("#336699", "triadic", "vibrant", 6, "abc");
  const second = generateHarmony("#336699", "triadic", "vibrant", 6, "abc");
  assert.deepEqual(first, second);
  assert.equal(first.length, 6);
});

test("roles and contrast calculations are usable", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
  const assigned = assignSemanticRoles(generateHarmony("#7B211A", "analogous", "archival", 7, "roles"));
  assert.ok(assigned.some((color) => color.role === "background"));
  assert.ok(assigned.some((color) => color.role === "text"));
});

test("sample clustering is deterministic", () => {
  const samples = [[255, 0, 0], [254, 2, 1], [0, 0, 255], [1, 2, 254]];
  assert.deepEqual(clusterRgbSamples(samples, 2), clusterRgbSamples(samples, 2));
  assert.equal(clusterRgbSamples(samples, 2).length, 2);
});

test("palette migration validates colors and version", () => {
  const project = {
    format: "vital-pancakes-palette",
    version: 1,
    colors: [{ id: "a", hex: "#000000" }, { id: "b", hex: "#FFFFFF" }],
  };
  assert.equal(migratePaletteProject(project).history.length, 0);
  assert.throws(() => migratePaletteProject({ ...project, version: 3 }), /Unsupported/);
});
