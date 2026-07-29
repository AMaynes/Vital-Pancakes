import assert from "node:assert/strict";
import test from "node:test";

import { CaptionCaptureSession } from "./caption-capture.mjs";

test("capture-limit reports the exact final processed-sample duration", async () => {
  const progress = [];
  const session = new CaptionCaptureSession({
    targetSampleRate: 16_000,
    onProgress: (value) => progress.push(value),
  });
  let stopReason = "";
  session.stop = async ({ reason }) => {
    stopReason = reason;
  };

  session.handleWorkletMessage({
    type: "capture-limit",
    processedSamples: 24_000,
  });
  await Promise.resolve();

  assert.equal(session.processedSamples, 24_000);
  assert.deepEqual(progress.at(-1), {
    processedSamples: 24_000,
    elapsedMs: 1_500,
    level: 0,
  });
  assert.equal(session.endedByLimit, true);
  assert.equal(stopReason, "limit");
});

test("capture stays at zero while armed and announces the first audible audio", () => {
  const progress = [];
  const statuses = [];
  const session = new CaptionCaptureSession({
    targetSampleRate: 16_000,
    onProgress: (value) => progress.push(value),
    onStatus: (value) => statuses.push(value),
  });
  session.state = "capturing";

  session.handleWorkletMessage({
    type: "audio-progress",
    processedSamples: 0,
    waitingForAudio: true,
    waitingMs: 2_500,
    level: 0,
  });
  session.handleWorkletMessage({
    type: "capture-armed",
    waitingMs: 2_500,
  });

  assert.deepEqual(progress.at(-1), {
    processedSamples: 0,
    elapsedMs: 0,
    level: 0,
    waitingForAudio: true,
    waitingMs: 2_500,
  });
  assert.equal(statuses.at(-1).armed, true);
  assert.match(statuses.at(-1).message, /timed capture is running/i);
});
