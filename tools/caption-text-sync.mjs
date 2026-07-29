/**
 * Normalized transcript indexing and fuzzy matching for accelerated captures.
 * Common or very short phrases are rejected as synchronization anchors.
 */

const DEFAULT_NEARBY_RADIUS_MS = 90_000;
const DEFAULT_THRESHOLD = 0.68;
const COMMON_PHRASES = new Set([
  "thank you",
  "yes",
  "no",
  "okay",
  "ok",
  "hello",
  "goodbye",
  "come on",
  "i know",
  "what",
]);

export function normalizeTranscriptText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function buildTextSynchronizationIndex(cues) {
  if (!Array.isArray(cues)) throw new TypeError("Caption cues must be an array.");
  const index = cues.map((cue, cueIndex) => ({
    cueIndex,
    cueId: cue.id,
    startMs: cue.startMs,
    endMs: cue.endMs,
    normalizedText: normalizeTranscriptText(cue.sourceText),
  })).filter((entry) => entry.normalizedText);
  const windows = [];
  for (let start = 0; start < index.length; start += 1) {
    let text = index[start].normalizedText;
    for (let end = start + 1; end < Math.min(index.length, start + 3); end += 1) {
      const prior = index[end - 1];
      const next = index[end];
      if (next.startMs - prior.endMs > 5_000 || next.endMs - index[start].startMs > 18_000) break;
      text = `${text} ${next.normalizedText}`;
      windows.push({
        cueIndex: index[start].cueIndex,
        cueId: index[start].cueId,
        cueIds: index.slice(start, end + 1).map((entry) => entry.cueId),
        startMs: index[start].startMs,
        endMs: next.endMs,
        normalizedText: text,
      });
    }
  }
  Object.defineProperty(index, "windows", {
    value: windows,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return index;
}

export function findTranscriptMatch(query, index, {
  predictedMs = null,
  nearbyRadiusMs = DEFAULT_NEARBY_RADIUS_MS,
  threshold = DEFAULT_THRESHOLD,
  requireDistinctive = true,
} = {}) {
  const normalizedQuery = normalizeTranscriptText(query);
  if (!normalizedQuery || (requireDistinctive && !isDistinctivePhrase(normalizedQuery))) {
    return { match: null, scope: "none", confidence: 0, rejected: "common-or-short" };
  }
  const entries = Array.isArray(index)
    ? [...index, ...(Array.isArray(index.windows) ? index.windows : [])]
    : [];
  const nearby = Number.isFinite(predictedMs)
    ? entries.filter((entry) => Math.abs(entry.startMs - predictedMs) <= nearbyRadiusMs)
    : [];
  const nearbyMatch = findBestMatch(normalizedQuery, nearby, threshold);
  if (nearbyMatch) return { ...nearbyMatch, scope: "nearby" };
  const globalMatch = findBestMatch(normalizedQuery, entries, threshold);
  if (globalMatch) return { ...globalMatch, scope: "global" };
  return { match: null, scope: nearby.length ? "global" : "none", confidence: 0 };
}

export function transcriptSimilarity(left, right) {
  const leftWords = normalizeTranscriptText(left).split(" ").filter(Boolean);
  const rightWords = normalizeTranscriptText(right).split(" ").filter(Boolean);
  if (!leftWords.length || !rightWords.length) return 0;
  const leftBigrams = makeNgrams(leftWords, Math.min(2, leftWords.length));
  const rightBigrams = makeNgrams(rightWords, Math.min(2, rightWords.length));
  const overlap = multisetIntersectionSize(leftBigrams, rightBigrams);
  const dice = (2 * overlap) / (leftBigrams.length + rightBigrams.length);
  const lengthBalance = Math.min(leftWords.length, rightWords.length)
    / Math.max(leftWords.length, rightWords.length);
  return clamp((dice * 0.82) + (lengthBalance * 0.18), 0, 1);
}

export function isDistinctivePhrase(value) {
  const normalized = normalizeTranscriptText(value);
  const words = normalized.split(" ").filter(Boolean);
  if (COMMON_PHRASES.has(normalized)) return false;
  if (words.length < 3) return false;
  const unique = new Set(words);
  return unique.size >= 3 || words.length >= 5;
}

function findBestMatch(query, entries, threshold) {
  let best = null;
  let secondBestConfidence = 0;
  for (const entry of entries) {
    const confidence = windowedSimilarity(query, entry.normalizedText);
    if (!best || confidence > best.confidence) {
      secondBestConfidence = best?.confidence ?? secondBestConfidence;
      best = { match: entry, confidence };
    } else if (confidence > secondBestConfidence) {
      secondBestConfidence = confidence;
    }
  }
  if (!best || best.confidence < threshold) return null;
  if (best.confidence - secondBestConfidence < 0.06 && secondBestConfidence >= threshold) return null;
  return best;
}

function windowedSimilarity(query, candidate) {
  const queryWords = query.split(" ");
  const candidateWords = candidate.split(" ");
  if (candidateWords.length <= queryWords.length + 4) {
    return transcriptSimilarity(query, candidate);
  }
  let best = 0;
  const windowSize = Math.min(candidateWords.length, Math.max(3, queryWords.length + 2));
  for (let index = 0; index <= candidateWords.length - windowSize; index += 1) {
    best = Math.max(
      best,
      transcriptSimilarity(query, candidateWords.slice(index, index + windowSize).join(" ")),
    );
  }
  return best;
}

function makeNgrams(words, size) {
  const ngrams = [];
  for (let index = 0; index <= words.length - size; index += 1) {
    ngrams.push(words.slice(index, index + size).join(" "));
  }
  return ngrams;
}

function multisetIntersectionSize(left, right) {
  const remaining = new Map();
  right.forEach((value) => remaining.set(value, (remaining.get(value) ?? 0) + 1));
  let count = 0;
  left.forEach((value) => {
    const available = remaining.get(value) ?? 0;
    if (available <= 0) return;
    count += 1;
    remaining.set(value, available - 1);
  });
  return count;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
