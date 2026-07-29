import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateRecords,
  applyTransformations,
  coerceDataset,
  createGraphProject,
  detectSchema,
  histogramBins,
  migrateGraphProject,
  parseDelimited,
  parseJsonDataset,
  validateChartSpec,
} from "./graphing-model.mjs";

test("CSV parser handles quoted delimiters, duplicate headers, and invalid rows", () => {
  const result = parseDelimited('name,value,value\n"A, B",2,3\nC,4\n');
  assert.deepEqual(result.headers, ["name", "value", "value (2)"]);
  assert.equal(result.records[0].name, "A, B");
  assert.deepEqual(result.invalidRows, [{ row: 3, expected: 3, actual: 2 }]);
});

test("JSON parsing, type detection, and coercion preserve missing values", () => {
  const dataset = parseJsonDataset('[{"date":"2026-01-01","value":"2","group":"A"},{"date":"2026-01-02","value":"","group":"B"}]');
  const schema = detectSchema(dataset);
  assert.equal(schema.date, "date");
  assert.equal(schema.value, "number");
  const coerced = coerceDataset(dataset, schema);
  assert.equal(coerced.records[0].value, 2);
  assert.equal(coerced.records[1].value, null);
});

test("filtering does not modify the original dataset", () => {
  const source = [{ category: "A", value: 1 }, { category: "B", value: 2 }];
  const result = applyTransformations(source, [{ type: "filter", column: "value", operator: "greater", value: 1 }]);
  assert.deepEqual(result, [{ category: "B", value: 2 }]);
  assert.equal(source.length, 2);
});

test("aggregation and histogram bins are deterministic", () => {
  assert.deepEqual(aggregateRecords(
    [{ group: "A", value: 1 }, { group: "A", value: 3 }, { group: "B", value: 4 }],
    "group", "value", "mean",
  ), [
    { group: "A", value: 2, __count: 2 },
    { group: "B", value: 4, __count: 1 },
  ]);
  assert.deepEqual(histogramBins([0, 1, 2, 3], 2).map((bin) => bin.count), [2, 2]);
});

test("chart validation catches logarithmic and type-specific errors", () => {
  const invalid = validateChartSpec(
    { type: "bubble", x: "x", y: "y", size: "", scaleX: "linear", scaleY: "log" },
    [{ x: 1, y: 0 }],
  );
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /Logarithmic Y/);
  assert.match(invalid.errors.join(" "), /size column/);
});

test("graph projects validate and migrate", () => {
  const dataset = parseDelimited("x,y\n1,2");
  const project = createGraphProject(dataset);
  assert.equal(migrateGraphProject(project).version, 1);
  assert.throws(() => migrateGraphProject({ ...project, version: 9 }), /Unsupported/);
});
