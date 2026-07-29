import assert from "node:assert/strict";
import test from "node:test";

import { validateCaptionCuesPreserved } from "./caption-package.mjs";
import {
  BoundedTranscriptionQueue,
  appendTranscriptionResult,
  isLikelySilenceHallucination,
  mergeOverlappingText,
  resultToCues,
} from "./caption-transcript.mjs";
import {
  applyGlossary,
  countTranslationProgress,
  findLikelyProperNames,
  regenerateCaptionCue,
  requireNonEmptyTranslationResult,
  searchAndReplaceTranslations,
  translateCaptionCues,
  translateTextWithGlossarySegments,
} from "./caption-translation.mjs";

const sourceCues = [
  {
    id: "cue-000001",
    startMs: 1_001,
    endMs: 2_345,
    sourceText: "ALICE: Meet me at River Gate.",
    translations: {},
    confidence: 0.94,
  },
  {
    id: "cue-000002",
    startMs: 4_000,
    endMs: 5_250,
    sourceText: "— We leave now!",
    translations: {},
    confidence: 0.82,
  },
];

test("overlap deduplication ignores case and punctuation at chunk boundaries", () => {
  assert.equal(
    mergeOverlappingText("We must leave now.", "LEAVE now, before sunrise"),
    "We must leave now. before sunrise",
  );
  assert.equal(mergeOverlappingText("", "  New dialogue  "), "New dialogue");
  assert.equal(mergeOverlappingText("Existing dialogue", ""), "Existing dialogue");
});

test("transcription results preserve accelerated-capture timing and confidence", () => {
  const cues = resultToCues({
    chunks: [{
      text: "Timed dialogue",
      timestamp: [10, 12.25],
      confidence: 1.4,
    }],
  }, {
    capturedChunkStartMs: 1_000,
    capturePlaybackRate: 1.5,
  });

  assert.deepEqual(cues, [{
    id: "cue-000001",
    startMs: 16_500,
    endMs: 19_875,
    sourceText: "Timed dialogue",
    translations: {},
    confidence: 1,
  }]);
});

test("chunk overlap is removed without deleting new dialogue", () => {
  const existing = [{
    id: "cue-000001",
    startMs: 0,
    endMs: 4_000,
    sourceText: "The gates are open",
    translations: {},
    confidence: 0.9,
  }];
  const cues = appendTranscriptionResult(existing, {
    chunks: [{
      text: "are open before sunrise",
      timestamp: [3.5, 5],
      confidence: 0.8,
    }],
  });

  assert.equal(cues.length, 2);
  assert.equal(cues[1].id, "cue-000002");
  assert.equal(cues[1].sourceText, "before sunrise");
  assert.deepEqual(existing[0].sourceText, "The gates are open");
});

test("word timestamps are grouped into readable phrases without dropping real isolated words", () => {
  const cues = resultToCues({
    chunks: [
      { text: "You", timestamp: [0, 0.4] },
      { text: "must", timestamp: [0.42, 0.8] },
      { text: "leave", timestamp: [0.82, 1.2] },
      { text: "before", timestamp: [1.22, 1.65] },
      { text: "sunrise.", timestamp: [1.67, 2.1] },
      { text: "You?", timestamp: [4, 4.5] },
    ],
  });

  assert.equal(cues.length, 2);
  assert.equal(cues[0].sourceText, "You must leave before sunrise.");
  assert.equal(cues[1].sourceText, "You?");
});

test("silence-like model outputs are discarded and plain fallback text is marked incomplete", () => {
  assert.equal(isLikelySilenceHallucination("Thanks for watching!"), true);
  assert.equal(isLikelySilenceHallucination("The train is arriving"), false);
  assert.deepEqual(
    appendTranscriptionResult([], {
      chunks: [{ text: "Thank you", timestamp: [0, 1], confidence: 0.2 }],
    }),
    [],
  );

  const fallback = resultToCues({ text: "A partial sentence" }, {
    capturedChunkStartMs: 2_000,
    capturePlaybackRate: 2,
  });
  assert.equal(fallback[0].startMs, 4_000);
  assert.equal(fallback[0].endMs, 14_000);
  assert.equal(fallback[0].incomplete, true);
});

test("bounded transcription queue rejects overflow and accounts for active work", () => {
  const queue = new BoundedTranscriptionQueue(2);

  assert.equal(queue.enqueue("first"), true);
  assert.equal(queue.take(), "first");
  assert.equal(queue.enqueue("second"), true);
  assert.equal(queue.enqueue("overflow"), false);
  assert.equal(queue.size, 2);
  assert.equal(queue.rejected, 1);
  assert.equal(queue.take(), null);
  assert.equal(queue.complete(), "first");
  assert.equal(queue.take(), "second");
  assert.equal(queue.clear(), 1);
  assert.equal(queue.size, 0);
  assert.throws(() => new BoundedTranscriptionQueue(0), /positive integer/);
});

test("glossary replacement handles repeated, mixed-case, and regex-like terms", () => {
  const glossary = [
    { source: "River Gate", target: "Cổng Sông" },
    { source: "Dr. Vale", target: "Bác sĩ Vale" },
  ];

  assert.equal(
    applyGlossary("RIVER GATE, River Gate, and Dr. Vale", glossary),
    "Cổng Sông, Cổng Sông, and Bác sĩ Vale",
  );
  assert.equal(
    applyGlossary("Cổng Sông", glossary, { direction: "target-to-source" }),
    "River Gate",
  );
});

test("glossary matching uses Unicode phrase boundaries and longest-match precedence", () => {
  const glossary = [
    { source: "An", target: "An-target" },
    { source: "Ann", target: "Ân" },
    { source: "Anna", target: "Anna-VI" },
    { source: "New York", target: "NY" },
    { source: "New York City", target: "NYC" },
  ];

  assert.equal(
    applyGlossary(
      "Anna met Ann in New York City, then New York. Hội An, not Ananda.",
      glossary,
    ),
    "Anna-VI met Ân in NYC, then NY. Hội An-target, not Ananda.",
  );
});

test("blank glossary targets are ignored instead of deleting source phrases", async () => {
  const incompleteGlossary = [
    { source: "Ann", target: "" },
    { source: "River Gate", target: "   " },
  ];
  const source = "Meet Ann at River Gate.";

  assert.equal(applyGlossary(source, incompleteGlossary), source);

  const translatedSegments = [];
  const result = await translateTextWithGlossarySegments(
    source,
    incompleteGlossary,
    async (segment) => {
      translatedSegments.push(segment.trim());
      return segment.replace("Meet", "Gặp").replace("at", "tại");
    },
  );
  assert.equal(result, "Gặp Ann tại River Gate.");
  assert.equal(translatedSegments.some((segment) => segment.includes("Ann")), false);
  assert.equal(translatedSegments.some((segment) => segment.includes("River Gate")), false);
});

test("glossary segments bypass the model and retain preferred phrasing", async () => {
  const translatedSegments = [];
  const result = await translateTextWithGlossarySegments(
    "Meet me at River Gate before dawn",
    [{ source: "River Gate", target: "Cổng Sông" }],
    async (segment) => {
      translatedSegments.push(segment.trim());
      return segment.includes("Meet") ? "Gặp tôi ở" : "trước bình minh";
    },
  );

  assert.equal(result, "Gặp tôi ở Cổng Sông trước bình minh");
  assert.deepEqual(translatedSegments, ["Meet me at", "before dawn"]);
});

test("segmented glossary and proper-name matching does not match inside longer names", async () => {
  const translatedSegments = [];
  const result = await translateTextWithGlossarySegments(
    "Ann met Anna.",
    [{ source: "Ann", target: "An" }],
    async (segment) => {
      translatedSegments.push(segment.trim());
      return segment.replace("met", "gặp");
    },
  );

  assert.equal(result, "An gặp Anna.");
  assert.deepEqual(translatedSegments, ["met"]);
});

test("likely English proper names remain unchanged unless the glossary overrides them", async () => {
  assert.deepEqual(
    findLikelyProperNames("Meet Alice in New York. Tell Alice now."),
    ["Alice", "New York"],
  );
  const calls = [];
  const preserved = await translateTextWithGlossarySegments(
    "Meet Alice in New York tonight.",
    [],
    async (segment) => {
      calls.push(segment);
      return `[vi:${segment.trim()}]`;
    },
  );
  assert.match(preserved, /\bAlice\b/);
  assert.match(preserved, /\bNew York\b/);
  assert.equal(calls.some((segment) => segment.includes("Alice")), false);
  assert.equal(calls.some((segment) => segment.includes("New York")), false);

  const greetingCalls = [];
  const greeting = await translateTextWithGlossarySegments(
    "Hello, Alice.",
    [],
    async (segment) => {
      greetingCalls.push(segment);
      return segment.replace("Hello", "Xin chào");
    },
  );
  assert.equal(greeting, "Xin chào, Alice.");
  assert.equal(greetingCalls.some((segment) => segment.includes("Hello")), true);
  assert.equal(greetingCalls.some((segment) => segment.includes("Alice")), false);

  const overridden = await translateTextWithGlossarySegments(
    "Meet Alice tonight.",
    [{ source: "Alice", target: "A-lít" }],
    async (segment) => `[vi:${segment.trim()}]`,
  );
  assert.match(overridden, /\bA-lít\b/);
  assert.doesNotMatch(overridden, /\bAlice\b/);

  assert.deepEqual(
    findLikelyProperNames("Meet Élodie in Đà Nẵng. Tell Élodie now."),
    ["Élodie", "Đà Nẵng"],
  );
});

test("translation retains every cue, source timestamp, speaker marker, and punctuation", async () => {
  const progress = [];
  const translated = await translateCaptionCues(sourceCues, async (text, cue) => {
    if (cue.id === "cue-000002") throw new Error("model unavailable");
    assert.equal(text.trim(), "Meet me at");
    return "Gặp tôi ở";
  }, {
    glossary: [{ source: "River Gate", target: "Cổng Sông" }],
    onProgress: (event) => progress.push(event),
  });

  assert.equal(translated.length, sourceCues.length);
  assert.equal(translated[0].translations.vi, "ALICE: Gặp tôi ở Cổng Sông.");
  assert.equal(translated[0].translationStatus, "translated");
  assert.equal(translated[1].translations.vi, "");
  assert.equal(translated[1].translationStatus, "failed");
  assert.match(translated[1].translationError, /model unavailable/);
  assert.deepEqual(
    translated.map(({ id, startMs, endMs, sourceText }) => ({ id, startMs, endMs, sourceText })),
    sourceCues.map(({ id, startMs, endMs, sourceText }) => ({ id, startMs, endMs, sourceText })),
  );
  assert.equal(progress.length, 2);
  assert.equal(validateCaptionCuesPreserved(sourceCues, translated), true);
  assert.deepEqual(countTranslationProgress(translated), {
    total: 2,
    completed: 1,
    failed: 1,
    pending: 0,
  });
});

test("failed translations can be retried without regenerating successful cues", async () => {
  const firstPass = await translateCaptionCues(sourceCues, async (_text, cue) => {
    if (cue.id === "cue-000002") throw new Error("temporary failure");
    return "Hẹn gặp";
  });
  let calls = 0;
  const recovered = await translateCaptionCues(sourceCues, async () => {
    calls += 1;
    return "Chúng ta đi ngay";
  }, {
    previousCues: firstPass,
    retryFailedOnly: true,
  });

  assert.equal(calls, 1);
  assert.equal(recovered[0].translations.vi, firstPass[0].translations.vi);
  assert.equal(recovered[1].translations.vi, "— Chúng ta đi ngay!");
  assert.equal(recovered[1].translationStatus, "translated");
  assert.equal(validateCaptionCuesPreserved(sourceCues, recovered), true);
});

test("individual regeneration uses bulk cue rules for speaker markers and punctuation", async () => {
  const regenerated = await regenerateCaptionCue(
    sourceCues[0],
    async (text) => {
      assert.equal(text.trim(), "Meet me at");
      return "Gặp tôi ở";
    },
    {
      glossary: [{ source: "River Gate", target: "Cổng Sông" }],
    },
  );

  assert.equal(regenerated.translations.vi, "ALICE: Gặp tôi ở Cổng Sông.");
  assert.equal(regenerated.translationStatus, "translated");
  assert.equal(regenerated.id, sourceCues[0].id);
  assert.equal(regenerated.startMs, sourceCues[0].startMs);
  assert.equal(regenerated.endMs, sourceCues[0].endMs);
  assert.equal(regenerated.sourceText, sourceCues[0].sourceText);
});

test("empty adapter output fails non-empty cues and can be retried", async () => {
  const failed = await translateCaptionCues([sourceCues[1]], async () => "   ");

  assert.equal(failed[0].translations.vi, "");
  assert.equal(failed[0].translationStatus, "failed");
  assert.match(failed[0].translationError, /returned no text/);
  assert.throws(
    () => requireNonEmptyTranslationResult("Non-empty cue", ""),
    /returned no text/,
  );
  assert.equal(requireNonEmptyTranslationResult("   ", ""), "");
  await assert.rejects(
    () => translateTextWithGlossarySegments(
      "Meet Alice tonight.",
      [],
      async () => "",
    ),
    /returned no text/,
  );

  const recovered = await translateCaptionCues([sourceCues[1]], async () => "Chúng ta đi ngay", {
    previousCues: failed,
    retryFailedOnly: true,
  });
  assert.equal(recovered[0].translations.vi, "— Chúng ta đi ngay!");
  assert.equal(recovered[0].translationStatus, "translated");
});

test("translation cancellation stops before another cue is changed", async () => {
  let translatedCount = 0;
  await assert.rejects(
    () => translateCaptionCues(sourceCues, async () => {
      translatedCount += 1;
      return "Bản dịch";
    }, {
      shouldAbort: () => translatedCount >= 1,
    }),
    (error) => error.name === "AbortError",
  );
  assert.equal(translatedCount, 1);
});

test("translation preservation validation rejects lost, reordered, or retimed cues", () => {
  const translated = sourceCues.map((cue) => ({
    ...cue,
    translations: { vi: "Bản dịch" },
  }));
  assert.throws(
    () => validateCaptionCuesPreserved(sourceCues, translated.slice(1)),
    /exactly one cue/,
  );
  assert.throws(
    () => validateCaptionCuesPreserved(sourceCues, [
      { ...translated[0], startMs: translated[0].startMs + 1 },
      translated[1],
    ]),
    /changed source cue/,
  );
});

test("search and replace updates only target text and keeps cue identity and timing", () => {
  const cues = sourceCues.map((cue) => ({
    ...cue,
    translations: { vi: "Từ cũ và TỪ CŨ" },
  }));
  const replaced = searchAndReplaceTranslations(cues, "từ cũ", "từ mới");

  assert.equal(replaced[0].translations.vi, "từ mới và từ mới");
  assert.equal(replaced[0].sourceText, cues[0].sourceText);
  assert.equal(replaced[0].startMs, cues[0].startMs);
  assert.equal(cues[0].translations.vi, "Từ cũ và TỪ CŨ");
});
