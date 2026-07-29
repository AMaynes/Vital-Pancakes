import assert from "node:assert/strict";
import test from "node:test";

import {
  createAudioFingerprints,
  fingerprintSimilarity,
  matchAudioFingerprints,
} from "./caption-fingerprint.mjs";

const reference = [
  { timeMs: 10_000, hash: "00000000" },
  { timeMs: 10_500, hash: "ffffffff" },
  { timeMs: 20_000, hash: "aaaaaaaa" },
  { timeMs: 20_500, hash: "55555555" },
];
const query = [
  { timeMs: 0, hash: "00000000" },
  { timeMs: 500, hash: "ffffffff" },
];
const FIXTURE_SAMPLE_RATE = 16_000;

function generatedDialogueFixture(durationSeconds = 14) {
  const samples = new Float32Array(FIXTURE_SAMPLE_RATE * durationSeconds);
  let noiseState = 123_456;
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / FIXTURE_SAMPLE_RATE;
    const segment = Math.floor(time / 0.75);
    const fundamental = 180 + ((segment * 137) % 1_100);
    const envelope = 0.15
      + (0.08 * Math.sin(2 * Math.PI * 0.43 * time))
      + (0.04 * Math.sin(2 * Math.PI * 0.17 * time));
    noiseState = (Math.imul(noiseState, 1_664_525) + 1_013_904_223) >>> 0;
    const noise = (((noiseState / 2 ** 32) * 2) - 1) * 0.002;
    samples[index] = envelope * (
      (0.65 * Math.sin(2 * Math.PI * fundamental * time))
      + (0.25 * Math.sin(2 * Math.PI * fundamental * 2.03 * time))
    ) + noise;
  }
  return samples;
}

function generatedCarrierFixture(frequency, durationSeconds = 20) {
  const samples = new Float32Array(FIXTURE_SAMPLE_RATE * durationSeconds);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / FIXTURE_SAMPLE_RATE;
    const envelope = 0.05
      + (0.03 * Math.sin(2 * Math.PI * 0.37 * time))
      + (0.02 * Math.sin(2 * Math.PI * 0.11 * time));
    samples[index] = envelope * Math.sin(2 * Math.PI * frequency * time);
  }
  return samples;
}

function generatedNoiseFixture(seed, durationSeconds = 10) {
  const samples = new Float32Array(FIXTURE_SAMPLE_RATE * durationSeconds);
  let state = seed >>> 0;
  for (let index = 0; index < samples.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    samples[index] = (((state / 2 ** 32) * 2) - 1) * 0.12;
  }
  return samples;
}

test("fingerprints are deterministic, compact, and timestamped without retaining samples", () => {
  const samples = new Float32Array([
    0.1, -0.2, 0.3, -0.4,
    0.5, -0.6, 0.7, -0.8,
    0.8, -0.7, 0.6, -0.5,
    0.4, -0.3, 0.2, -0.1,
  ]);
  const options = {
    sampleRate: 8,
    startTimeMs: 5_000,
    windowMs: 1_000,
    stepMs: 500,
  };

  const first = createAudioFingerprints(samples, options);
  const second = createAudioFingerprints(samples, options);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((entry) => entry.timeMs), [5_000, 5_500, 6_000]);
  assert.equal(first.every((entry) => /^[0-9a-f]{16}$/.test(entry.hash)), true);
  assert.equal(first.every((entry) => !("samples" in entry)), true);
});

test("fingerprint generation validates sample type and handles short windows", () => {
  assert.throws(() => createAudioFingerprints([0, 1]), /Float32Array/);
  assert.throws(
    () => createAudioFingerprints(new Float32Array(8), { sampleRate: 0 }),
    /Sample rate must be positive/,
  );
  assert.deepEqual(
    createAudioFingerprints(new Float32Array(3), {
      sampleRate: 8,
      windowMs: 1_000,
    }),
    [],
  );
});

test("fingerprint similarity uses normalized Hamming distance", () => {
  assert.equal(fingerprintSimilarity("00000000", "00000000"), 1);
  assert.equal(fingerprintSimilarity("00000000", "ffffffff"), 0);
  assert.equal(fingerprintSimilarity("00000000", "00000001"), 31 / 32);
});

test("fingerprint matching searches nearby first and then globally", () => {
  const nearby = matchAudioFingerprints(query, reference, {
    predictedMs: 10_000,
    nearbyRadiusMs: 2_000,
  });
  const global = matchAudioFingerprints(query, reference, {
    predictedMs: 100_000,
    nearbyRadiusMs: 1_000,
  });

  assert.equal(nearby.scope, "nearby");
  assert.deepEqual(nearby.match, { timeMs: 10_000, offsetMs: 10_000 });
  assert.equal(nearby.confidence, 1);
  assert.equal(global.scope, "global");
  assert.deepEqual(global.match, { timeMs: 10_000, offsetMs: 10_000 });
  assert.equal(global.confidence, 1);
});

test("fingerprint matching rejects short and unrelated audio queries", () => {
  assert.deepEqual(matchAudioFingerprints([query[0]], reference), {
    match: null,
    confidence: 0,
    scope: "none",
  });
  const unrelated = matchAudioFingerprints([
    { timeMs: 0, hash: "33333333" },
    { timeMs: 500, hash: "cccccccc" },
  ], reference, { threshold: 0.9 });
  assert.equal(unrelated.match, null);
  assert.equal(unrelated.confidence, 0);
});

test("silence and low-entropy fingerprints cannot identify a video", () => {
  const silence = createAudioFingerprints(new Float32Array(16_000 * 4), {
    sampleRate: 16_000,
  });
  assert.deepEqual(silence, []);
  assert.deepEqual(matchAudioFingerprints([
    { timeMs: 0, hash: "00000000" },
    { timeMs: 500, hash: "00000000" },
  ], reference), {
    match: null,
    confidence: 0,
    scope: "none",
  });
});

test("spectral fingerprints identify a transformed excerpt at its reference time", () => {
  const referenceAudio = generatedDialogueFixture();
  const queryAudio = referenceAudio.slice(
    FIXTURE_SAMPLE_RATE * 4,
    FIXTURE_SAMPLE_RATE * 12,
  );
  for (let index = 0; index < queryAudio.length; index += 1) {
    queryAudio[index] = (queryAudio[index] * 0.72)
      + (Math.sin(index * 12.9898) * 0.0005);
  }
  const referenceFingerprints = createAudioFingerprints(referenceAudio, {
    sampleRate: FIXTURE_SAMPLE_RATE,
  });
  const queryFingerprints = createAudioFingerprints(queryAudio, {
    sampleRate: FIXTURE_SAMPLE_RATE,
  });
  const result = matchAudioFingerprints(queryFingerprints, referenceFingerprints);

  assert.deepEqual(result.match, { timeMs: 4_000, offsetMs: 4_000 });
  assert.ok(result.confidence > 0.9, `expected a strong match, received ${result.confidence}`);
});

test("equal-envelope unrelated carriers and unrelated noise are rejected", () => {
  const lowCarrier = createAudioFingerprints(generatedCarrierFixture(224), {
    sampleRate: FIXTURE_SAMPLE_RATE,
  });
  const highCarrier = createAudioFingerprints(generatedCarrierFixture(896), {
    sampleRate: FIXTURE_SAMPLE_RATE,
  });
  const firstNoise = createAudioFingerprints(generatedNoiseFixture(1), {
    sampleRate: FIXTURE_SAMPLE_RATE,
  });
  const secondNoise = createAudioFingerprints(generatedNoiseFixture(2), {
    sampleRate: FIXTURE_SAMPLE_RATE,
  });

  assert.notEqual(lowCarrier[0].hash, highCarrier[0].hash);
  assert.equal(matchAudioFingerprints(highCarrier, lowCarrier).match, null);
  assert.equal(matchAudioFingerprints(secondNoise, firstNoise).match, null);
});
