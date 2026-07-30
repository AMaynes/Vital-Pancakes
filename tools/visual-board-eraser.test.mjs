import assert from "node:assert/strict";
import test from "node:test";

import {
  eraseObjectNear,
  getOutsideSegmentIntervals,
} from "./visual-board-eraser.mjs";

let identifier = 0;
const id = () => `new-${identifier += 1}`;

test("line erasing removes only the brush-local interval", () => {
  const line = {
    id: "line-1",
    type: "line",
    x: 0,
    y: 0,
    endX: 100,
    endY: 0,
    strokeWidth: 2,
    groupId: "group-1",
  };
  const fragments = eraseObjectNear(line, { x: 50, y: 0 }, 9, id);

  assert.equal(fragments.length, 2);
  assert.equal(fragments[0].id, "line-1");
  assert.equal(fragments[0].groupId, "group-1");
  assert.ok(fragments[0].endX < 50);
  assert.ok(fragments[1].x > 50);
});

test("locked objects cannot be erased", () => {
  const locked = {
    id: "locked",
    type: "line",
    x: 0,
    y: 0,
    endX: 100,
    endY: 0,
    strokeWidth: 2,
    locked: true,
  };
  assert.deepEqual(
    eraseObjectNear(locked, { x: 50, y: 0 }, 20, id),
    [locked],
  );
});

test("connector fragments preserve arrowheads only at original surviving ends", () => {
  const connector = {
    id: "arrow",
    type: "connector",
    x: 0,
    y: 0,
    endX: 100,
    endY: 0,
    strokeWidth: 2,
    arrowStart: true,
    arrowEnd: true,
  };
  const fragments = eraseObjectNear(connector, { x: 50, y: 0 }, 9, id);

  assert.equal(fragments[0].type, "connector");
  assert.equal(fragments[0].arrowStart, true);
  assert.equal(fragments[0].arrowEnd, false);
  assert.equal(fragments[1].type, "connector");
  assert.equal(fragments[1].arrowStart, false);
  assert.equal(fragments[1].arrowEnd, true);
});

test("pen erasing detects crossings even without a sampled point inside the brush", () => {
  const pen = {
    id: "pen",
    type: "pen",
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    strokeWidth: 2,
  };
  const fragments = eraseObjectNear(pen, { x: 50, y: 0 }, 9, id);
  assert.equal(fragments.length, 2);
});

test("trace erasing preserves untouched filled paths and creates safe interior holes", () => {
  const trace = {
    id: "trace",
    type: "trace",
    paths: [
      [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }],
      [{ x: 100, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 40 }, { x: 100, y: 40 }],
    ],
    strokeWidth: 1,
  };
  const withHole = eraseObjectNear(trace, { x: 20, y: 20 }, 5, id);
  assert.equal(withHole.length, 1);
  assert.equal(withHole[0].type, "trace");
  assert.equal(withHole[0].paths.length, 3);

  const boundaryErase = eraseObjectNear(trace, { x: 0, y: 20 }, 5, id);
  assert.equal(boundaryErase[0].type, "trace");
  assert.deepEqual(boundaryErase[0].paths, [trace.paths[1]]);
  assert.ok(boundaryErase.some((object) => object.type === "pen"));
});

test("segment clipping returns the two exact outside ranges", () => {
  const intervals = getOutsideSegmentIntervals(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 0 },
    10,
  );
  assert.deepEqual(intervals, [[0, 0.4], [0.6, 1]]);
});
