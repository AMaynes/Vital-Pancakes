import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTextSynchronizationIndex,
  findTranscriptMatch,
  isDistinctivePhrase,
  normalizeTranscriptText,
  transcriptSimilarity,
} from "./caption-text-sync.mjs";

const cues = [
  {
    id: "cue-1",
    startMs: 0,
    endMs: 4_000,
    sourceText: "At dawn the silver train crosses northern valley",
  },
  {
    id: "cue-2",
    startMs: 60_000,
    endMs: 64_000,
    sourceText: "Bring the ancient map before the storm arrives",
  },
  {
    id: "cue-3",
    startMs: 120_000,
    endMs: 124_000,
    sourceText: "The lighthouse keeper waits beyond Blackwater Bay",
  },
  {
    id: "cue-4",
    startMs: 180_000,
    endMs: 184_000,
    sourceText: "Our hidden garden opens only under moonlight",
  },
];

test("transcript normalization is Unicode-aware, punctuation-free, and whitespace-stable", () => {
  assert.equal(
    normalizeTranscriptText("  Café—DON’T \n stop...  "),
    "cafe dont stop",
  );
  assert.equal(normalizeTranscriptText(null), "");
});

test("text synchronization index retains cue identity, time, and normalized source", () => {
  const index = buildTextSynchronizationIndex([
    ...cues,
    { id: "empty", startMs: 200_000, endMs: 201_000, sourceText: "   " },
  ]);

  assert.equal(index.length, cues.length);
  assert.deepEqual(index[1], {
    cueIndex: 1,
    cueId: "cue-2",
    startMs: 60_000,
    endMs: 64_000,
    normalizedText: "bring the ancient map before the storm arrives",
  });
});

test("fuzzy transcript similarity tolerates a small recognition insertion", () => {
  const confidence = transcriptSimilarity(
    "bring the ancient map before the storm arrives tonight",
    "Bring the ancient map before the storm arrives",
  );

  assert.ok(confidence > 0.85, `expected strong fuzzy match, received ${confidence}`);
  assert.equal(transcriptSimilarity("", "anything"), 0);
});

test("matching searches near the predicted timestamp before searching globally", () => {
  const index = buildTextSynchronizationIndex(cues);
  const nearby = findTranscriptMatch(
    "bring the ancient map before the storm arrives",
    index,
    { predictedMs: 62_000, nearbyRadiusMs: 10_000 },
  );
  const global = findTranscriptMatch(
    "the lighthouse keeper waits beyond blackwater bay",
    index,
    { predictedMs: 0, nearbyRadiusMs: 10_000 },
  );

  assert.equal(nearby.scope, "nearby");
  assert.equal(nearby.match.cueId, "cue-2");
  assert.equal(nearby.confidence, 1);
  assert.equal(global.scope, "global");
  assert.equal(global.match.cueId, "cue-3");
  assert.equal(global.confidence, 1);
});

test("common, short, ambiguous, and unrelated phrases are rejected", () => {
  const index = buildTextSynchronizationIndex(cues);
  const common = findTranscriptMatch("thank you", index);
  const unrelated = findTranscriptMatch(
    "Bright coral spacecraft circles a distant desert planet",
    index,
  );
  const duplicateIndex = buildTextSynchronizationIndex([
    {
      id: "duplicate-1",
      startMs: 10_000,
      endMs: 12_000,
      sourceText: "Follow the blue lantern through the eastern tunnel",
    },
    {
      id: "duplicate-2",
      startMs: 90_000,
      endMs: 92_000,
      sourceText: "Follow the blue lantern through the eastern tunnel",
    },
  ]);
  const ambiguous = findTranscriptMatch(
    "Follow the blue lantern through the eastern tunnel",
    duplicateIndex,
  );

  assert.equal(isDistinctivePhrase("okay"), false);
  assert.equal(isDistinctivePhrase("silver train"), false);
  assert.equal(isDistinctivePhrase(cues[0].sourceText), true);
  assert.deepEqual(common, {
    match: null,
    scope: "none",
    confidence: 0,
    rejected: "common-or-short",
  });
  assert.equal(unrelated.match, null);
  assert.equal(ambiguous.match, null);
});

test("rolling recognition can match a phrase spanning adjacent cues", () => {
  const adjacent = buildTextSynchronizationIndex([
    {
      id: "first",
      startMs: 10_000,
      endMs: 12_000,
      sourceText: "Meet me by the old station",
    },
    {
      id: "second",
      startMs: 12_250,
      endMs: 14_000,
      sourceText: "before the midnight train arrives",
    },
  ]);
  const result = findTranscriptMatch(
    "meet me by the old station before the midnight train arrives",
    adjacent,
  );
  assert.equal(result.match.cueId, "first");
  assert.deepEqual(result.match.cueIds, ["first", "second"]);
  assert.equal(result.match.startMs, 10_000);
});
