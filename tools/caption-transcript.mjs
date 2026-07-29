/**
 * Transcript overlap handling and cue construction. Chunk-boundary text is
 * deduplicated before captions are persisted.
 */

import { capturedToOriginalTimeMs } from "./caption-timing.mjs";

const DEFAULT_MAX_QUEUE_SIZE = 12;

export function mergeOverlappingText(previousText, nextText, maximumWords = 16) {
  const previous = splitWords(previousText);
  const next = splitWords(nextText);
  if (!previous.length) return String(nextText ?? "").trim();
  if (!next.length) return String(previousText ?? "").trim();
  const maximum = Math.min(maximumWords, previous.length, next.length);
  let overlap = 0;
  for (let size = maximum; size >= 1; size -= 1) {
    const left = previous.slice(-size).map(normalizeWord);
    const right = next.slice(0, size).map(normalizeWord);
    if (left.every((word, index) => word && word === right[index])) {
      overlap = size;
      break;
    }
  }
  const suffix = next.slice(overlap).join(" ");
  return [String(previousText ?? "").trim(), suffix].filter(Boolean).join(" ");
}

export function appendTranscriptionResult(existingCues, result, {
  capturedChunkStartMs = 0,
  capturePlaybackRate = 1,
  incomplete = false,
} = {}) {
  const cues = Array.isArray(existingCues) ? existingCues.map((cue) => ({ ...cue })) : [];
  const generated = resultToCues(result, {
    capturedChunkStartMs,
    capturePlaybackRate,
    incomplete,
    nextIndex: cues.length,
  });
  for (const cue of generated) {
    const previous = cues.at(-1);
    if (previous && cue.startMs <= previous.endMs + 2_500) {
      const merged = mergeOverlappingText(previous.sourceText, cue.sourceText);
      if (merged === previous.sourceText) continue;
      const previousWords = splitWords(previous.sourceText).length;
      const mergedWords = splitWords(merged);
      cue.sourceText = mergedWords.slice(previousWords).join(" ").trim() || cue.sourceText;
    }
    const lowConfidenceSilenceOutput = cue.confidence !== null
      && cue.confidence < 0.35
      && isLikelySilenceHallucination(cue.sourceText);
    if (!cue.sourceText || lowConfidenceSilenceOutput
      || (cue.incomplete && isLikelySilenceHallucination(cue.sourceText))) continue;
    cue.id = `cue-${String(cues.length + 1).padStart(6, "0")}`;
    cues.push(cue);
  }
  return cues;
}

export function resultToCues(result, {
  capturedChunkStartMs = 0,
  capturePlaybackRate = 1,
  incomplete = false,
  nextIndex = 0,
} = {}) {
  const chunks = Array.isArray(result?.chunks) ? result.chunks : [];
  const normalizedChunks = chunks
    .map((chunk) => normalizeResultChunk(chunk, capturedChunkStartMs, capturePlaybackRate))
    .filter(Boolean);
  const usableChunks = groupTimestampChunks(normalizedChunks);
  if (!usableChunks.length && String(result?.text ?? "").trim()) {
    const startMs = capturedToOriginalTimeMs(capturedChunkStartMs, capturePlaybackRate);
    usableChunks.push({
      startMs,
      endMs: startMs + capturedToOriginalTimeMs(5_000, capturePlaybackRate),
      text: String(result.text).trim(),
      confidence: null,
    });
    incomplete = true;
  }
  return usableChunks.map((chunk, index) => ({
    id: `cue-${String(nextIndex + index + 1).padStart(6, "0")}`,
    startMs: chunk.startMs,
    endMs: Math.max(chunk.startMs + 250, chunk.endMs),
    sourceText: chunk.text,
    translations: {},
    confidence: chunk.confidence,
    ...(incomplete ? { incomplete: true } : {}),
  }));
}

export function isLikelySilenceHallucination(text) {
  const normalized = String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!normalized) return true;
  const knownSilenceOutputs = new Set([
    "thank you",
    "thanks for watching",
    "you",
    "bye",
    "the end",
  ]);
  return knownSilenceOutputs.has(normalized);
}

export class BoundedTranscriptionQueue {
  constructor(maximumSize = DEFAULT_MAX_QUEUE_SIZE) {
    if (!Number.isInteger(maximumSize) || maximumSize < 1) {
      throw new RangeError("Queue size must be a positive integer.");
    }
    this.maximumSize = maximumSize;
    this.pending = [];
    this.active = null;
    this.rejected = 0;
  }

  enqueue(item) {
    if (this.size >= this.maximumSize) {
      this.rejected += 1;
      return false;
    }
    this.pending.push(item);
    return true;
  }

  take() {
    if (this.active || !this.pending.length) return null;
    this.active = this.pending.shift();
    return this.active;
  }

  complete() {
    const completed = this.active;
    this.active = null;
    return completed;
  }

  clear() {
    const discarded = this.pending.length + (this.active ? 1 : 0);
    this.pending.length = 0;
    this.active = null;
    return discarded;
  }

  get size() {
    return this.pending.length + (this.active ? 1 : 0);
  }
}

function normalizeResultChunk(chunk, chunkStartMs, playbackRate) {
  const text = String(chunk?.text ?? "").trim();
  const timestamp = chunk?.timestamp;
  if (!text || !Array.isArray(timestamp) || !Number.isFinite(timestamp[0])) return null;
  const startCapturedMs = chunkStartMs + Math.round(timestamp[0] * 1000);
  const endSeconds = Number.isFinite(timestamp[1]) ? timestamp[1] : timestamp[0] + 2;
  const endCapturedMs = chunkStartMs + Math.round(endSeconds * 1000);
  return {
    startMs: capturedToOriginalTimeMs(startCapturedMs, playbackRate),
    endMs: capturedToOriginalTimeMs(endCapturedMs, playbackRate),
    text,
    confidence: Number.isFinite(chunk.confidence) ? clamp(chunk.confidence, 0, 1) : null,
  };
}

function groupTimestampChunks(chunks) {
  const groups = [];
  let active = null;
  for (const chunk of chunks) {
    if (!active) {
      active = { ...chunk, confidenceValues: finiteConfidence(chunk) };
      continue;
    }
    const gapMs = chunk.startMs - active.endMs;
    const combinedText = joinCaptionText(active.text, chunk.text);
    const combinedDurationMs = chunk.endMs - active.startMs;
    const priorEndsSentence = /[.!?…]["')\]]?\s*$/.test(active.text);
    const shouldBreak = gapMs > 1_200
      || combinedDurationMs > 6_500
      || combinedText.length > 84
      || (priorEndsSentence && active.text.length >= 18);
    if (shouldBreak) {
      groups.push(finalizeGroup(active));
      active = { ...chunk, confidenceValues: finiteConfidence(chunk) };
      continue;
    }
    active.text = combinedText;
    active.endMs = chunk.endMs;
    active.confidenceValues.push(...finiteConfidence(chunk));
  }
  if (active) groups.push(finalizeGroup(active));
  return groups;
}

function finalizeGroup(group) {
  const { confidenceValues, ...cue } = group;
  return {
    ...cue,
    confidence: confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : null,
  };
}

function finiteConfidence(chunk) {
  return Number.isFinite(chunk.confidence) ? [chunk.confidence] : [];
}

function joinCaptionText(left, right) {
  return `${String(left).trim()} ${String(right).trim()}`
    .replace(/\s+([,.;:!?…])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function splitWords(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean);
}

function normalizeWord(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
