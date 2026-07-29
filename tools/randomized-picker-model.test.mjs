import assert from "node:assert/strict";
import test from "node:test";

import {
  createPickerProject,
  createSeededRandom,
  divideIntoGroups,
  migratePickerProject,
  normalizedProbabilities,
  parsePickerCsv,
  parsePickerInput,
  weightedSample,
} from "./randomized-picker-model.mjs";

test("parsing preserves Unicode and duplicate display names as separate ids", () => {
  const items = parsePickerInput("Ångström\nSame\nSame");
  assert.equal(items[0].name, "Ångström");
  assert.notEqual(items[1].id, items[2].id);
  assert.equal(parsePickerCsv("name,weight,enabled\nA,0.5,true\nB,2,false")[0].weight, "0.5");
});

test("probabilities support fractional and huge weight differences", () => {
  const probabilities = normalizedProbabilities([
    { id: "a", name: "A", weight: 0.5, enabled: true },
    { id: "b", name: "B", weight: 999_999.5, enabled: true },
  ]);
  assert.equal(probabilities.reduce((sum, item) => sum + item.probability, 0), 1);
  assert.ok(probabilities[1].probability > 0.999);
});

test("zero, negative, empty, and all-disabled inputs fail clearly", () => {
  assert.throws(() => normalizedProbabilities([]), /at least one/);
  assert.throws(() => normalizedProbabilities([{ id: "a", name: "A", weight: -1, enabled: true }]), /negative/);
  assert.throws(() => normalizedProbabilities([{ id: "a", name: "A", weight: 0, enabled: true }]), /all be zero/);
  assert.throws(() => normalizedProbabilities([{ id: "a", name: "A", weight: 1, enabled: false }]), /Enable/);
});

test("weighted without-replacement sampling uses injected random values without duplicates", () => {
  const values = [0.2, 0.8, 0.5];
  const items = ["A", "B", "C"].map((name, index) => ({ id: name, name, weight: index + 1, enabled: true }));
  const result = weightedSample(items, 3, { random: () => values.shift(), withReplacement: false });
  assert.equal(new Set(result.map((item) => item.id)).size, 3);
  assert.throws(() => weightedSample(items, 4, { random: () => 0.5 }), /more unique/);
});

test("seeded sessions and grouping are reproducible", () => {
  const items = ["A", "B", "C", "D"].map((name) => ({ id: name, name, weight: 1, enabled: true }));
  const first = divideIntoGroups(items, 2, createSeededRandom("same"));
  const second = divideIntoGroups(items, 2, createSeededRandom("same"));
  assert.deepEqual(first, second);
});

test("picker project imports validate settings and items", () => {
  const project = createPickerProject([{ id: "a", name: "A", weight: 1, enabled: true }]);
  assert.equal(migratePickerProject(project).settings.mode, "one");
  assert.throws(() => migratePickerProject({ ...project, version: 9 }), /Unsupported/);
});
