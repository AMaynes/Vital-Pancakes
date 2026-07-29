import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CAPTION_FILE_BYTES,
  detectCaptionFileFormat,
  exportSrt,
  exportVtt,
  parseSrt,
  parseVtt,
} from "./caption-formats.mjs";
import {
  CAPTURE_PLAYBACK_RATES,
  applyTimelineCorrection,
  applyTimelineCorrectionToCues,
  applyTimelineCorrectionToFingerprints,
  calculateCaptureDurationMs,
  capturedToOriginalTimeMs,
  formatClockMs,
  parseClockValue,
} from "./caption-timing.mjs";

const formatCues = [
  {
    id: "cue-000001",
    startMs: 7,
    endMs: 1_234,
    sourceText: "First line\nSecond line",
    translations: { vi: "Dòng một\nDòng hai" },
    confidence: 0.9,
  },
  {
    id: "cue-000002",
    startMs: 3_723_456,
    endMs: 3_725_009,
    sourceText: "Keep every millisecond.",
    translations: { vi: "Giữ nguyên từng mili giây." },
    confidence: null,
  },
];

test("SRT parsing accepts identifiers, multiline text, CRLF, and cue settings", () => {
  const cues = parseSrt([
    "1",
    "00:00:00,007 --> 00:00:01,234 X1:0 X2:0",
    "First line",
    "Second line",
    "",
    "named-cue",
    "01:02:03,456 --> 01:02:05,009",
    "Keep every millisecond.",
    "",
  ].join("\r\n"));

  assert.deepEqual(cues, [
    {
      id: "1",
      startMs: 7,
      endMs: 1_234,
      sourceText: "First line\nSecond line",
      translations: {},
      confidence: null,
    },
    {
      id: "named-cue",
      startMs: 3_723_456,
      endMs: 3_725_009,
      sourceText: "Keep every millisecond.",
      translations: {},
      confidence: null,
    },
  ]);
});

test("SRT export preserves source, translated, and bilingual cue text", () => {
  const source = exportSrt(formatCues);
  const translated = exportSrt(formatCues, { language: "vi" });
  const bilingual = exportSrt(formatCues, { language: "vi", bilingual: true });

  assert.match(source, /00:00:00,007 --> 00:00:01,234\nFirst line\nSecond line/);
  assert.match(translated, /Dòng một\nDòng hai/);
  assert.match(bilingual, /First line\nSecond line\nDòng một\nDòng hai/);
  assert.equal(source.endsWith("\n"), true);
});

test("WebVTT parsing ignores metadata blocks and preserves cue IDs and milliseconds", () => {
  const cues = parseVtt([
    "\uFEFFWEBVTT - Caption Relay",
    "",
    "NOTE generated locally",
    "This block is ignored.",
    "",
    "intro",
    "00:00:00.007 --> 00:00:01.234 line:90% align:center",
    "First line",
    "Second line",
    "",
    "01:02:03.456 --> 01:02:05.009",
    "Keep every millisecond.",
    "",
  ].join("\n"));

  assert.equal(cues[0].id, "intro");
  assert.deepEqual(
    cues.map(({ startMs, endMs, sourceText }) => ({ startMs, endMs, sourceText })),
    formatCues.map(({ startMs, endMs, sourceText }) => ({ startMs, endMs, sourceText })),
  );
  assert.equal(cues[1].id, "cue-000002");
});

test("WebVTT export emits valid header, stable IDs, and bilingual text", () => {
  const output = exportVtt(formatCues, { language: "vi", bilingual: true });

  assert.equal(output.startsWith("WEBVTT\n\n"), true);
  assert.match(output, /cue-000001\n00:00:00\.007 --> 00:00:01\.234/);
  assert.match(output, /First line\nSecond line\nDòng một\nDòng hai/);
  assert.equal(output.endsWith("\n"), true);
});

test("SRT and WebVTT repeated conversions preserve integer millisecond timestamps", () => {
  let cues = formatCues;
  for (let index = 0; index < 4; index += 1) {
    cues = parseSrt(exportSrt(cues));
    cues = parseVtt(exportVtt(cues));
  }

  assert.deepEqual(
    cues.map(({ startMs, endMs }) => ({ startMs, endMs })),
    formatCues.map(({ startMs, endMs }) => ({ startMs, endMs })),
  );
});

test("format detection uses extensions first and content as a safe fallback", () => {
  assert.equal(detectCaptionFileFormat("movie.SRT", "WEBVTT"), "srt");
  assert.equal(detectCaptionFileFormat("captions", " WEBVTT\n\n"), "vtt");
  assert.equal(detectCaptionFileFormat("captions", "1\n00:00:01,000 --> 00:00:02,000"), "srt");
  assert.equal(detectCaptionFileFormat("movie.vpcaptions.json", ""), "package");
});

test("malformed SRT and WebVTT inputs fail without producing partial cues", () => {
  assert.throws(
    () => parseSrt("1\nnot a timestamp\nUnsafe text"),
    /Malformed SRT cue timing/,
  );
  assert.throws(
    () => parseVtt("WEBVTT\n\n00:00:02.000 --> 00:00:01.999\nBackwards"),
    /cannot precede/,
  );
  assert.throws(
    () => exportSrt([{ ...formatCues[0], startMs: 1.5 }]),
    /integer millisecond/,
  );
  assert.throws(
    () => parseSrt("x".repeat(MAX_CAPTION_FILE_BYTES + 1)),
    /exceeds the 25 MB import limit/,
  );
});

test("all supported capture rates map processed audio time to the original timeline", () => {
  const expected = new Map([
    [1, { captureDurationMs: 120_000, originalTimeMs: 8_000 }],
    [1.25, { captureDurationMs: 96_000, originalTimeMs: 10_000 }],
    [1.5, { captureDurationMs: 80_000, originalTimeMs: 12_000 }],
    [2, { captureDurationMs: 60_000, originalTimeMs: 16_000 }],
  ]);

  assert.deepEqual(CAPTURE_PLAYBACK_RATES, [...expected.keys()]);
  for (const rate of CAPTURE_PLAYBACK_RATES) {
    assert.equal(calculateCaptureDurationMs(120_000, rate), expected.get(rate).captureDurationMs);
    assert.equal(capturedToOriginalTimeMs(8_000, rate), expected.get(rate).originalTimeMs);
  }
  assert.throws(() => capturedToOriginalTimeMs(1_000, 1.75), /Capture speed/);
});

test("global offset and timeline scaling corrections retain cue data and clamp at zero", () => {
  const cue = {
    id: "cue-1",
    startMs: 10_000,
    endMs: 12_000,
    sourceText: "Unchanged",
    translations: { vi: "Không đổi" },
  };

  assert.deepEqual(applyTimelineCorrection(cue, { offsetMs: 750 }), {
    ...cue,
    startMs: 10_750,
    endMs: 12_750,
  });
  assert.deepEqual(applyTimelineCorrection(cue, {
    scale: 1.1,
    anchorMs: 5_000,
    offsetMs: -250,
  }), {
    ...cue,
    startMs: 10_250,
    endMs: 12_450,
  });
  assert.deepEqual(
    applyTimelineCorrectionToCues([{ ...cue, startMs: 100, endMs: 200 }], { offsetMs: -500 }),
    [{ ...cue, startMs: 0, endMs: 0 }],
  );
});

test("timeline correction keeps one-times fingerprints aligned with corrected cues", () => {
  const correction = { offsetMs: 250, scale: 1.01, anchorMs: 1_000 };
  const [correctedCue] = applyTimelineCorrectionToCues([
    { id: "cue-1", startMs: 10_000, endMs: 12_000, sourceText: "Aligned" },
  ], correction);
  const [correctedFingerprint] = applyTimelineCorrectionToFingerprints([
    { timeMs: 10_000, hash: "abcd" },
  ], correction);

  assert.equal(correctedFingerprint.timeMs, correctedCue.startMs);
  assert.equal(correctedFingerprint.hash, "abcd");
});

test("clock parsing and formatting are millisecond precise and reject invalid clocks", () => {
  assert.equal(parseClockValue("01:02:03.456"), 3_723_456);
  assert.equal(parseClockValue("02:03,007"), 123_007);
  assert.equal(formatClockMs(3_723_456), "01:02:03.456");
  assert.equal(formatClockMs(123_007, { separator: ",", includeHours: false }), "02:03,007");
  assert.throws(() => parseClockValue("00:60.000"), /below 60/);
});
