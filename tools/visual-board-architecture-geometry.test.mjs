import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWallPathGeometry,
  fitArchitectureSymbolFrame,
  polygonsIntersect,
  sampleArchitecturePath,
} from "./visual-board-architecture-geometry.mjs";

test("wall paths remove exact opening intervals and preserve connected joins", () => {
  const geometry = buildWallPathGeometry({
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }],
    thickness: 10,
    join: "miter",
    openings: [{
      segmentIndex: 0,
      offset: 50,
      width: 30,
      kind: "door-single",
    }],
  });

  assert.equal(geometry.wallRuns.length, 3);
  assert.deepEqual(
    geometry.wallRuns.slice(0, 2).map((run) => [run.start.x, run.end.x]),
    [[0, 35], [65, 100]],
  );
  assert.equal(geometry.joints.length, 1);
  assert.equal(geometry.openings[0].w, 30);
  assert.equal(geometry.openings[0].wallCenter.x, 50);
  assert.deepEqual(geometry.issues, []);
});

test("wall paths report invalid and overlapping openings without corrupting runs", () => {
  const geometry = buildWallPathGeometry({
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    thickness: 8,
    openings: [
      { segmentIndex: 0, offset: 35, width: 40, kind: "window" },
      { segmentIndex: 0, offset: 55, width: 30, kind: "window-fixed" },
      { segmentIndex: 0, offset: 95, width: 20, kind: "door-single" },
    ],
  });

  assert.ok(geometry.issues.some((issue) => issue.code === "openings-overlap"));
  assert.ok(geometry.issues.some((issue) => issue.code === "opening-outside-wall"));
  assert.equal(geometry.openings.length, 2);
});

test("architectural paths sample quadratic, cubic, and arc commands deterministically", () => {
  const sampled = sampleArchitecturePath([
    { op: "M", x: 0, y: 0 },
    { op: "Q", cx: 25, cy: 50, x: 50, y: 0, steps: 4 },
    { op: "C", c1x: 60, c1y: -20, c2x: 90, c2y: -20, x: 100, y: 0, steps: 4 },
    {
      op: "A",
      cx: 100,
      cy: 20,
      rx: 20,
      ry: 20,
      startAngle: -Math.PI / 2,
      endAngle: 0,
      steps: 4,
    },
    { op: "L", x: 0, y: 40 },
    { op: "Z" },
  ]);

  assert.equal(sampled.closed, true);
  assert.ok(sampled.points.length >= 14);
  assert.deepEqual(sampled.points[0], { x: 0, y: 0 });
  assert.deepEqual(sampled.points.at(-1), { x: 0, y: 40 });
});

test("symbol frames preserve catalog proportions unless stretching is explicit", () => {
  const definition = { nominalWidth: 4, nominalHeight: 2 };
  assert.deepEqual(
    fitArchitectureSymbolFrame({ x: 0, y: 0, w: 100, h: 100, fit: "contain" }, definition),
    { x: 0, y: 25, w: 100, h: 50 },
  );
  assert.deepEqual(
    fitArchitectureSymbolFrame({ x: 0, y: 0, w: 100, h: 100, fit: "stretch" }, definition),
    { x: 0, y: 0, w: 100, h: 100 },
  );
});

test("polygon intersection rejects overlapping bounds without shared geometry", () => {
  const triangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  const separateTriangle = [{ x: 10, y: 10 }, { x: 10, y: 4 }, { x: 4, y: 10 }];
  const crossingTriangle = [{ x: 2, y: 2 }, { x: 12, y: 2 }, { x: 2, y: 12 }];

  assert.equal(polygonsIntersect(triangle, separateTriangle), false);
  assert.equal(polygonsIntersect(triangle, crossingTriangle), true);
});
