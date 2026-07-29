import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTION_PACKAGE_KIND,
  createCaptionPackage,
  parseCaptionPackage,
  serializeCaptionPackage,
  validateCaptionPackage,
} from "./caption-package.mjs";
import {
  CAPTION_RELAY_DATABASE,
  CAPTION_RELAY_DATABASE_VERSION,
  CAPTION_RELAY_STORES,
  recoverInterruptedProject,
  validateProjectRecord,
} from "./caption-storage.mjs";

function makePackage(overrides = {}) {
  return createCaptionPackage({
    title: "Freely licensed fixture",
    originalDurationMs: 90_001,
    capturePlaybackRate: 1,
    sourceLanguage: "en",
    createdAt: "2026-07-29T00:00:00.000Z",
    transcriptionModel: {
      id: "onnx-community/whisper-tiny.en",
      runtime: "@huggingface/transformers@3.7.2",
      revision: "fixture",
      license: "MIT",
    },
    cues: [{
      id: "cue-000001",
      startMs: 1,
      endMs: 2_003,
      sourceText: "<img src=x onerror=alert(1)> Plain imported text",
      translations: { vi: "Văn bản thuần" },
      confidence: 0.9,
    }],
    sync: {
      mode: "fingerprint",
      fingerprints: [{ timeMs: 0, hash: "00ff00ff" }],
      textIndexVersion: 1,
    },
    glossary: [{ source: "River Gate", target: "Cổng Sông", category: "place" }],
    settings: { bilingual: true },
    ...overrides,
  });
}

function makeProject(overrides = {}) {
  return {
    id: "caption_fixture",
    name: "Fixture project",
    status: "ready",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:01:00.000Z",
    package: makePackage(),
    ...overrides,
  };
}

test("package validation clones valid data while preserving safe future-compatible fields", () => {
  const source = makePackage({
    futureMetadata: {
      harmless: "preserved",
      audioCodec: "opus",
      audioMetadata: { codec: "opus" },
      mediaType: "audio/webm",
      media: { codec: "opus", sampleRateHz: 16_000 },
      pcmFormat: "float32",
      sampleBufferSize: 16_000,
      waveformSampleCount: 80,
    },
  });
  const validated = validateCaptionPackage(source);

  assert.equal(validated.kind, CAPTION_PACKAGE_KIND);
  assert.deepEqual(validated.futureMetadata, {
    harmless: "preserved",
    audioCodec: "opus",
    audioMetadata: { codec: "opus" },
    mediaType: "audio/webm",
    media: { codec: "opus", sampleRateHz: 16_000 },
    pcmFormat: "float32",
    sampleBufferSize: 16_000,
    waveformSampleCount: 80,
  });
  assert.equal(validated.cues[0].sourceText, "<img src=x onerror=alert(1)> Plain imported text");
  assert.notEqual(validated, source);
  assert.notEqual(validated.cues, source.cues);
});

test("serialized packages round-trip with millisecond timestamps and unknown fields", () => {
  const source = makePackage({ futureMetadata: { version: 2 } });
  const serialized = serializeCaptionPackage(source);
  const parsed = parseCaptionPackage(serialized);

  assert.equal(serialized.endsWith("\n"), true);
  assert.equal(parsed.cues[0].startMs, 1);
  assert.equal(parsed.cues[0].endMs, 2_003);
  assert.deepEqual(parsed.futureMetadata, { version: 2 });
});

test("schema-zero packages migrate cue fields and select text sync for accelerated capture", () => {
  const migrated = parseCaptionPackage(JSON.stringify({
    schemaVersion: 0,
    kind: CAPTION_PACKAGE_KIND,
    title: "Legacy accelerated project",
    originalDurationMs: 120_000,
    capturePlaybackRate: 1.5,
    createdAt: "2026-01-01T00:00:00.000Z",
    transcriptionModel: { id: "legacy", runtime: "legacy" },
    cues: [{
      start: 1_234,
      end: 5_678,
      text: "Legacy source",
      vi: "Nguồn cũ",
      legacyCueField: "intentionally omitted by migration",
    }],
    glossary: [],
    settings: {},
  }));

  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.sync.mode, "text");
  assert.deepEqual(migrated.cues[0], {
    id: "cue-000001",
    startMs: 1_234,
    endMs: 5_678,
    sourceText: "Legacy source",
    translations: { vi: "Nguồn cũ" },
    confidence: null,
  });
});

test("malformed, incompatible, duplicate, unsorted, and raw-media packages are rejected", () => {
  assert.throws(() => parseCaptionPackage("{not-json"), /not valid JSON/);
  assert.throws(
    () => parseCaptionPackage(JSON.stringify({ schemaVersion: 999 })),
    /newer than this tool supports/,
  );
  assert.throws(
    () => validateCaptionPackage({ ...makePackage(), kind: "other-tool" }),
    /not a Caption Relay package/,
  );
  assert.throws(
    () => makePackage({
      cues: [
        { id: "same", startMs: 0, endMs: 1, sourceText: "A", translations: {}, confidence: null },
        { id: "same", startMs: 2, endMs: 3, sourceText: "B", translations: {}, confidence: null },
      ],
    }),
    /duplicate ID/,
  );
  assert.throws(
    () => makePackage({
      cues: [
        { id: "later", startMs: 20, endMs: 30, sourceText: "A", translations: {}, confidence: null },
        { id: "earlier", startMs: 10, endMs: 15, sourceText: "B", translations: {}, confidence: null },
      ],
    }),
    /sorted by start time/,
  );
  assert.throws(
    () => validateCaptionPackage({ ...makePackage(), rawAudio: "forbidden" }),
    /cannot contain raw movie audio or video/,
  );
  assert.throws(
    () => makePackage({
      capturePlaybackRate: 1.5,
      sync: { mode: "fingerprint", fingerprints: [], textIndexVersion: 1 },
    }),
    /Accelerated captures must use text synchronization/,
  );
});

test("package validation rejects invalid timestamps, confidence, hashes, and languages", () => {
  const cue = makePackage().cues[0];
  assert.throws(
    () => makePackage({ cues: [{ ...cue, startMs: 1.5 }] }),
    /must be an integer/,
  );
  assert.throws(
    () => makePackage({ cues: [{ ...cue, confidence: 1.01 }] }),
    /between 0 and 1/,
  );
  assert.throws(
    () => makePackage({
      sync: { mode: "fingerprint", fingerprints: [{ timeMs: 0, hash: "not-a-hash" }] },
    }),
    /Fingerprint hash is invalid/,
  );
  assert.throws(
    () => makePackage({ sourceLanguage: "vi" }),
    /requires English source captions/,
  );
});

test("storage uses an isolated versioned namespace and excludes model data stores", () => {
  assert.equal(CAPTION_RELAY_DATABASE, "vital-pancakes-caption-relay");
  assert.equal(CAPTION_RELAY_DATABASE_VERSION, 1);
  assert.deepEqual(CAPTION_RELAY_STORES, [
    "projects",
    "checkpoints",
    "syncIndexes",
    "glossaries",
    "settings",
  ]);
  assert.equal(CAPTION_RELAY_STORES.includes("audio"), false);
  assert.equal(CAPTION_RELAY_STORES.includes("models"), false);
});

test("project validation clones valid records and rejects unsafe storage values", () => {
  const project = makeProject();
  const validated = validateProjectRecord(project);

  assert.deepEqual(validated, project);
  assert.notEqual(validated, project);
  assert.notEqual(validated.package, project.package);
  assert.throws(
    () => validateProjectRecord({ ...project, id: "../bad" }),
    /Project ID is invalid/,
  );
  assert.throws(
    () => validateProjectRecord({ ...project, status: "uploading" }),
    /Project status is invalid/,
  );
  assert.throws(
    () => validateProjectRecord({ ...project, audioSamples: new Float32Array([0.1]) }),
    /cannot retain raw movie audio or video/,
  );
});

test("interrupted capture recovery keeps partial package data and marks active work recoverable", () => {
  const recoveredAt = "2026-07-29T00:05:00.000Z";
  for (const status of ["capturing", "transcribing"]) {
    const project = makeProject({ status });
    const recovered = recoverInterruptedProject(project, recoveredAt);

    assert.equal(recovered.status, "interrupted");
    assert.equal(recovered.interruptedAt, recoveredAt);
    assert.equal(recovered.updatedAt, recoveredAt);
    assert.match(recovered.recoveryMessage, /unprocessed audio was discarded/);
    assert.deepEqual(recovered.package.cues, project.package.cues);
    assert.equal(project.status, status);
  }

  const ready = makeProject({ status: "ready" });
  assert.deepEqual(recoverInterruptedProject(ready, recoveredAt), ready);
});

test("deeply nested raw-media keys are rejected instead of bypassing validation", () => {
  const nested = {};
  let cursor = nested;
  for (let index = 0; index < 9; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  cursor.RAW_AUDIO = "movie bytes";
  assert.throws(
    () => validateCaptionPackage(makePackage({ settings: nested })),
    /nesting is too deep|raw movie audio/i,
  );
});

test("raw-media aliases and encoded payloads cannot bypass package or storage validation", () => {
  const unsafeValues = [
    { audioChunks: ["AAAA"] },
    { capturedAudioChunks: ["AAAA"] },
    { pcm: [0.1, 0.2] },
    { sourcePcmFrames: [0.1, 0.2] },
    { settings: { waveformSamples: [0.1, -0.2] } },
    { settings: { waveform: [0.1, -0.2] } },
    { samples: [0.1, -0.2] },
    { sampleBuffer: [0.1, -0.2] },
    { media: { base64: "AAAA" } },
    { capturedMedia: { chunks: ["AAAA"] } },
    { encodedMediaBase64: "AAAA" },
    { "media/base64": "AAAA" },
    { futurePayload: "data:audio/webm;base64,AAAA" },
    { encodedVideo: "data:video/mp4;base64,AAAA" },
  ];

  for (const unsafeValue of unsafeValues) {
    assert.throws(
      () => validateCaptionPackage({
        ...makePackage(),
        futureMetadata: unsafeValue,
      }),
      /cannot contain raw movie audio or video/,
    );
    assert.throws(
      () => validateProjectRecord({
        ...makeProject(),
        futureMetadata: unsafeValue,
      }),
      /cannot retain raw movie audio or video/,
    );
  }

  const safeProject = validateProjectRecord({
    ...makeProject(),
    futureMetadata: {
      audioCodec: "opus",
      audioMetadata: { codec: "opus" },
      mediaType: "audio/webm",
      media: { codec: "opus", channels: 2 },
      pcmFormat: "float32",
      sampleBufferSize: 16_000,
      waveformSampleCount: 80,
    },
  });
  assert.deepEqual(safeProject.futureMetadata, {
    audioCodec: "opus",
    audioMetadata: { codec: "opus" },
    mediaType: "audio/webm",
    media: { codec: "opus", channels: 2 },
    pcmFormat: "float32",
    sampleBufferSize: 16_000,
    waveformSampleCount: 80,
  });
});
