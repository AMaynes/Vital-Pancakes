import test from "node:test";
import assert from "node:assert/strict";

import {
  AnimationExportError,
  createAnimationExportFilename,
  createAnimationFrameSchedule,
  recordAnimationVideo,
  selectAnimationExportFormat,
} from "./visual-board-export.mjs";

const PNG_DATA_URL = "data:image/png;base64,AAAA";

test("export format selection maps containers to compatible codecs", () => {
  assert.deepEqual(
    selectAnimationExportFormat("mp4"),
    {
      codecs: ["avc"],
      extension: "mp4",
      format: "mp4",
      mimeType: "video/mp4",
    },
  );
  assert.deepEqual(selectAnimationExportFormat("webm").codecs, ["vp9", "vp8", "av1"]);
});

test("export format selection rejects unknown containers", () => {
  assert.throws(
    () => selectAnimationExportFormat("mov"),
    (error) => (
      error instanceof AnimationExportError
      && error.code === "UNSUPPORTED_FORMAT"
    ),
  );
});

test("frame schedule preserves playable order and exact timing", () => {
  const schedule = createAnimationFrameSchedule([
    { id: "one", name: "One", dataUrl: PNG_DATA_URL },
    { id: "blank", name: "Blank", dataUrl: "" },
    { id: "three", name: "Three", dataUrl: PNG_DATA_URL },
  ], 25);

  assert.deepEqual(
    schedule.map(({ id, startsAtMs }) => ({ id, startsAtMs })),
    [
      { id: "one", startsAtMs: 0 },
      { id: "three", startsAtMs: 25 },
    ],
  );
});

test("export cancellation stops before browser encoding begins", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    recordAnimationVideo({
      frames: [],
      frameDurationMs: 100,
      format: "mp4",
      signal: controller.signal,
    }),
    (error) => error instanceof AnimationExportError && error.code === "CANCELLED",
  );
});

test("export filenames include a stable timestamp and extension", () => {
  assert.equal(
    createAnimationExportFilename(
      "webm",
      new Date("2026-07-29T04:37:21.000Z"),
    ),
    "vital-pancakes-animation-2026-07-29T04-37-21.webm",
  );
});
