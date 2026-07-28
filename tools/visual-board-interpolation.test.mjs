import test from "node:test";
import assert from "node:assert/strict";

import {
  FrameInterpolationError,
  assertWebGpuSupported,
  generateIntermediateFrameImages,
  getIntermediateTimesteps,
  insertIntermediateFrames,
} from "./visual-board-interpolation.mjs";

const PNG_DATA_URL = "data:image/png;base64,AAAA";

test("requested frame count produces evenly spaced timesteps", () => {
  assert.deepEqual(getIntermediateTimesteps(3), [0.25, 0.5, 0.75]);
  assert.equal(getIntermediateTimesteps(7).length, 7);
});

test("generated frames are inserted in order without modifying originals", () => {
  const originals = [
    { id: "start", name: "Start" },
    { id: "end", name: "End" },
    { id: "later", name: "Later" },
  ];
  const generated = [
    { id: "between-1", name: "Between 1", dataUrl: PNG_DATA_URL },
    { id: "between-2", name: "Between 2", dataUrl: PNG_DATA_URL },
  ];

  const result = insertIntermediateFrames(originals, "start", "end", generated);

  assert.deepEqual(
    result.map((frame) => frame.id),
    ["start", "between-1", "between-2", "end", "later"],
  );
  assert.strictEqual(result[0], originals[0]);
  assert.strictEqual(result[3], originals[1]);
  assert.deepEqual(originals.map((frame) => frame.id), ["start", "end", "later"]);
});

test("generation stops after cancellation and returns no partial result", async () => {
  const controller = new AbortController();
  let calls = 0;

  await assert.rejects(
    generateIntermediateFrameImages({
      count: 4,
      signal: controller.signal,
      interpolateAt: async () => {
        calls += 1;
        controller.abort();
        return { dataUrl: PNG_DATA_URL };
      },
    }),
    (error) => error instanceof FrameInterpolationError
      && error.code === "CANCELLED",
  );
  assert.equal(calls, 1);
});

test("WebGPU preflight rejects browsers without a compatible adapter", async () => {
  await assert.rejects(
    assertWebGpuSupported({ navigatorRef: {} }),
    (error) => error instanceof FrameInterpolationError
      && error.code === "WEBGPU_UNSUPPORTED",
  );
  await assert.rejects(
    assertWebGpuSupported({
      navigatorRef: { gpu: { requestAdapter: async () => null } },
    }),
    (error) => error instanceof FrameInterpolationError
      && error.code === "WEBGPU_UNSUPPORTED",
  );
});
