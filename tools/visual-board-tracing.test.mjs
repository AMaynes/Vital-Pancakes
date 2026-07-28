import test from "node:test";
import assert from "node:assert/strict";

import {
  traceBlackAndWhiteImage,
  traceInkMask,
} from "./visual-board-tracing.mjs";

function createImage(width, height, inkPixels) {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  inkPixels.forEach(([x, y]) => {
    const index = (y * width + x) * 4;
    data[index] = 0;
    data[index + 1] = 0;
    data[index + 2] = 0;
  });
  return { width, height, data };
}

test("a black pixel block becomes one simplified closed path", () => {
  const traced = traceBlackAndWhiteImage(createImage(5, 5, [
    [1, 1], [2, 1],
    [1, 2], [2, 2],
  ]));

  assert.equal(traced.paths.length, 1);
  assert.equal(traced.paths[0].length, 4);
  assert.deepEqual(traced.paths[0], [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 3 },
    { x: 1, y: 3 },
  ]);
});

test("diagonally touching pixels remain separate contours", () => {
  const mask = new Uint8Array([
    1, 0,
    0, 1,
  ]);

  assert.equal(traceInkMask(mask, 2, 2).length, 2);
});

test("transparent pixels are treated as white", () => {
  const image = createImage(2, 2, []);
  image.data[3] = 0;
  image.data[0] = 0;
  image.data[1] = 0;
  image.data[2] = 0;

  assert.equal(traceBlackAndWhiteImage(image).paths.length, 0);
});
