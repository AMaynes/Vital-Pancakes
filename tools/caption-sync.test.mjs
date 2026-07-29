import assert from "node:assert/strict";
import test from "node:test";

import {
  CaptionSynchronizationEngine,
  SYNCHRONIZATION_STATES,
  findActiveCues,
} from "./caption-sync.mjs";

function lockEngine(options = {}) {
  const engine = new CaptionSynchronizationEngine(options);
  engine.start(0);
  engine.ingestMatch({
    movieTimeMs: 10_000,
    confidence: 0.9,
    observedAtMs: 0,
  });
  const locked = engine.ingestMatch({
    movieTimeMs: 11_000,
    confidence: 0.88,
    observedAtMs: 1_000,
  });
  return { engine, locked };
}

test("synchronization exposes every required state", () => {
  assert.deepEqual(SYNCHRONIZATION_STATES, [
    "idle",
    "listening",
    "acquiring",
    "locked",
    "uncertain",
    "resynchronizing",
    "paused",
    "ended",
    "error",
  ]);
});

test("two consecutive compatible high-confidence matches are required to lock", () => {
  const engine = new CaptionSynchronizationEngine();
  engine.start(0);

  const first = engine.ingestMatch({
    movieTimeMs: 10_000,
    confidence: 0.9,
    observedAtMs: 0,
  });
  const second = engine.ingestMatch({
    movieTimeMs: 11_000,
    confidence: 0.88,
    observedAtMs: 1_000,
  });

  assert.equal(first.state, "acquiring");
  assert.equal(first.showCaptions, false);
  assert.equal(second.state, "locked");
  assert.equal(second.showCaptions, true);
  assert.equal(second.movieTimeMs, 11_000);
});

test("the locked movie clock advances using elapsed real time and playback rate", () => {
  const { engine } = lockEngine();
  engine.ingestMatch({
    movieTimeMs: 12_250,
    confidence: 0.9,
    observedAtMs: 2_000,
    playbackRate: 1.25,
  });

  assert.equal(engine.tick(3_000).movieTimeMs, 13_500);
});

test("small drift corrections are smoothed to avoid visible caption jumps", () => {
  const { engine } = lockEngine({ smoothingFactor: 0.24 });
  const corrected = engine.ingestMatch({
    movieTimeMs: 12_500,
    confidence: 0.91,
    observedAtMs: 2_000,
  });

  assert.equal(corrected.correctionMs, 500);
  assert.equal(corrected.isSeek, false);
  assert.equal(corrected.movieTimeMs, 12_120);
  assert.equal(corrected.state, "locked");
});

test("large discontinuities are treated as seeks and applied immediately", () => {
  const { engine } = lockEngine({ seekThresholdMs: 12_000 });
  const sought = engine.ingestMatch({
    movieTimeMs: 80_000,
    confidence: 0.95,
    observedAtMs: 2_000,
  });

  assert.equal(sought.isSeek, true);
  assert.equal(sought.movieTimeMs, 80_000);
  assert.equal(sought.state, "resynchronizing");
  assert.equal(sought.showCaptions, false);

  const reacquired = engine.ingestMatch({
    movieTimeMs: 81_000,
    confidence: 0.93,
    observedAtMs: 3_000,
  });
  assert.equal(reacquired.state, "locked");
  assert.equal(reacquired.showCaptions, true);
});

test("empty, low-confidence, and common-phrase observations preserve a fresh lock", () => {
  const lowConfidence = lockEngine().engine;
  const low = lowConfidence.ingestMatch({
    movieTimeMs: 12_000,
    confidence: 0.2,
    observedAtMs: 2_000,
  });

  assert.equal(low.state, "locked");
  assert.equal(low.showCaptions, true);
  assert.equal(low.confidence, 0.88);

  const commonPhrase = lowConfidence.ingestMatch({
    movieTimeMs: 900_000,
    confidence: 0.99,
    observedAtMs: 3_000,
    isCommonPhrase: true,
  });
  const empty = lowConfidence.observeNoMatch(4_000);

  assert.equal(commonPhrase.state, "locked");
  assert.equal(commonPhrase.showCaptions, true);
  assert.equal(empty.state, "locked");
  assert.equal(empty.showCaptions, true);
  assert.equal(lowConfidence.tick(15_999).state, "locked");
  assert.equal(lowConfidence.tick(16_001).state, "uncertain");
  assert.equal(lowConfidence.tick(16_001).showCaptions, false);
  assert.equal(lowConfidence.tick(16_001).confidence, 0);
});

test("credible contradictory observations reject a lock immediately", () => {
  const wrongVideo = lockEngine().engine;
  const rejected = wrongVideo.ingestMatch({
    movieTimeMs: Number.NaN,
    confidence: 0.99,
    observedAtMs: 2_000,
    contradictory: true,
  });

  assert.equal(rejected.state, "uncertain");
  assert.equal(rejected.showCaptions, false);
  assert.equal(rejected.confidence, 0);

  const weakContradiction = lockEngine().engine.ingestMatch({
    movieTimeMs: Number.NaN,
    confidence: 0.2,
    observedAtMs: 2_000,
    contradictory: true,
  });
  assert.equal(weakContradiction.state, "locked");
  assert.equal(weakContradiction.showCaptions, true);
});

test("lack of fresh matches moves a lock to uncertain without guessing a pause", () => {
  const { engine } = lockEngine({ uncertaintyTimeoutMs: 5_000 });

  assert.equal(engine.tick(6_001).state, "uncertain");
  assert.equal(engine.tick(6_001).showCaptions, false);
  assert.notEqual(engine.state, "paused");
});

test("manual pause, resume, adjustment, resynchronization, and reset are deterministic", () => {
  const { engine } = lockEngine();
  const paused = engine.pause(2_000);
  assert.equal(paused.state, "paused");
  assert.equal(paused.movieTimeMs, 12_000);
  assert.equal(engine.tick(20_000).movieTimeMs, 12_000);

  const resumed = engine.resume(20_000);
  assert.equal(resumed.state, "locked");
  const resumedTick = engine.tick(21_000);
  assert.equal(resumedTick.state, "locked");
  assert.equal(resumedTick.movieTimeMs, 13_000);
  assert.equal(resumedTick.showCaptions, true);

  const adjusted = engine.adjust(-250, 21_000);
  assert.equal(adjusted.movieTimeMs, 12_750);
  assert.equal(adjusted.showCaptions, true);

  engine.resynchronize();
  assert.equal(engine.snapshot(21_000).state, "resynchronizing");
  assert.equal(engine.snapshot(21_000).showCaptions, false);

  engine.reset();
  assert.equal(engine.snapshot(21_000).state, "idle");
  assert.equal(engine.snapshot(21_000).movieTimeMs, 0);
});

test("setting movie time manually starts a fresh lock instead of expiring immediately", () => {
  const engine = new CaptionSynchronizationEngine();
  const manual = engine.setCurrentMovieTime(2_000, 60_000);

  assert.equal(manual.state, "locked");
  assert.equal(manual.showCaptions, true);
  assert.equal(engine.tick(60_100).state, "locked");
  assert.equal(engine.tick(60_100).movieTimeMs, 2_100);
});

test("playback-rate changes reanchor without retroactive clock jumps and pause keeps captions visible", () => {
  const engine = new CaptionSynchronizationEngine();
  engine.start(0);
  engine.ingestMatch({ movieTimeMs: 10_000, confidence: 0.9, observedAtMs: 1_000 });
  engine.ingestMatch({ movieTimeMs: 11_000, confidence: 0.9, observedAtMs: 2_000 });
  const before = engine.estimatedMovieTimeMs(62_000);
  engine.setPlaybackRate(2, 62_000);
  assert.equal(engine.estimatedMovieTimeMs(62_000), before);
  engine.pause(63_000);
  assert.equal(engine.shouldShowCaptions(), true);
  assert.equal(engine.estimatedMovieTimeMs(70_000), engine.pausedMovieTimeMs);
});

test("active cue lookup includes exact boundaries and rejects invalid input", () => {
  const cues = [
    { id: "a", startMs: 1_000, endMs: 2_000 },
    { id: "b", startMs: 2_000, endMs: 3_000 },
    { id: "c", startMs: 4_000, endMs: 5_000 },
  ];

  assert.deepEqual(findActiveCues(cues, 2_000).map((cue) => cue.id), ["a", "b"]);
  assert.deepEqual(findActiveCues(cues, 3_500), []);
  assert.deepEqual(findActiveCues(null, 2_000), []);
});
