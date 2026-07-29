import assert from "node:assert/strict";
import test from "node:test";

import {
  cropToAspect,
  fillCropToFrame,
  fitFrameToCrop,
  getCropWorldCorners,
  getImageDrawArguments,
  mapCropToReplacement,
  normalizeImageCrop,
} from "./visual-board-image.mjs";

test("crop bounds clamp to original image coordinates", () => {
  assert.deepEqual(normalizeImageCrop({ x: -2, y: 20, width: 500, height: 500 }, 100, 80), {
    x: 0, y: 20, width: 100, height: 60,
  });
});

test("aspect presets, fit, and fill retain center and avoid recompression", () => {
  const crop = cropToAspect({ x: 0, y: 0, width: 400, height: 300 }, 1, 400, 300);
  assert.deepEqual(crop, { x: 50, y: 0, width: 300, height: 300 });
  const fitted = fitFrameToCrop({ x: 0, y: 0, w: 200, h: 100 }, crop);
  assert.equal(fitted.w, fitted.h);
  assert.equal(fillCropToFrame(crop, { w: 160, h: 90 }, 400, 300).width / fillCropToFrame(crop, { w: 160, h: 90 }, 400, 300).height, 16 / 9);
});

test("replacement images preserve normalized crop placement", () => {
  assert.deepEqual(mapCropToReplacement({ x: 100, y: 50, width: 200, height: 100 }, 400, 200, 800, 400), {
    x: 200, y: 100, width: 400, height: 200,
  });
});

test("draw arguments use original crop coordinates and rotated corners remain stable", () => {
  const object = { x: 10, y: 20, w: 200, h: 100, rotation: Math.PI / 2, crop: { x: 5, y: 6, width: 70, height: 40 } };
  assert.deepEqual(getImageDrawArguments(object, 100, 80), [5, 6, 70, 40, 10, 20, 200, 100]);
  const corners = getCropWorldCorners(object);
  assert.equal(Math.round(corners[0].x), 160);
  assert.equal(Math.round(corners[0].y), -30);
});
