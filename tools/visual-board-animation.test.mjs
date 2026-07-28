import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ANIMATION_FRAMES,
  createAnimationFrame,
  getPlayableFrames,
  normalizeAnimation,
  normalizeFrameDuration,
  replaceAnimationFrame,
} from "./visual-board-animation.mjs";

const PNG_DATA_URL = "data:image/png;base64,AAAA";

test("animation state normalizes frame timing and rejects unsafe frame data", () => {
  const animation = normalizeAnimation({
    frameDurationMs: 1,
    frames: [
      { id: "valid", name: "  Pose 1  ", dataUrl: PNG_DATA_URL },
      { id: "blank", name: "", dataUrl: "https://example.com/frame.png" },
      { name: "Missing id", dataUrl: PNG_DATA_URL },
    ],
  });

  assert.equal(animation.frameDurationMs, 25);
  assert.deepEqual(animation.frames, [
    { id: "valid", name: "Pose 1", dataUrl: PNG_DATA_URL },
    { id: "blank", name: "Frame", dataUrl: "" },
  ]);
});

test("frame duration and frame count remain bounded", () => {
  assert.equal(normalizeFrameDuration(6000), 5000);
  assert.equal(normalizeFrameDuration("250"), 250);
  assert.equal(
    normalizeAnimation({
      frames: Array.from({ length: MAX_ANIMATION_FRAMES + 4 }, (_, index) => ({
        id: `frame-${index}`,
        name: `Frame ${index}`,
      })),
    }).frames.length,
    MAX_ANIMATION_FRAMES,
  );
});

test("frames can be created, replaced, and filtered for playback", () => {
  const blankFrame = createAnimationFrame("frame-1", 0);
  const filledFrames = replaceAnimationFrame(
    [blankFrame, createAnimationFrame("frame-2", 1)],
    "frame-1",
    { name: "Bench press down", dataUrl: PNG_DATA_URL },
  );

  assert.equal(filledFrames[0].name, "Bench press down");
  assert.equal(filledFrames[0].dataUrl, PNG_DATA_URL);
  assert.deepEqual(getPlayableFrames(filledFrames), [filledFrames[0]]);
});
