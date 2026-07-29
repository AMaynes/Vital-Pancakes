/**
 * Strict, size-bounded SRT and WebVTT parsing plus millisecond-accurate export.
 */

import { formatClockMs } from "./caption-timing.mjs";

export const MAX_CAPTION_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CAPTION_CUES = 100_000;

export function parseSrt(text) {
  const normalized = normalizeImportedText(text);
  const blocks = normalized.split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (!lines.some((line) => line.trim())) continue;
    let identifier = "";
    let timingLine = lines.shift()?.trim() ?? "";
    if (!timingLine.includes("-->")) {
      identifier = timingLine;
      timingLine = lines.shift()?.trim() ?? "";
    }
    const timing = parseTimingLine(timingLine, ",");
    if (!timing) throw new TypeError(`Malformed SRT cue timing near "${timingLine.slice(0, 80)}".`);
    cues.push(createImportedCue(identifier, timing, lines.join("\n").trim(), cues.length));
    assertCueCount(cues);
  }
  if (!cues.length && normalized.trim()) throw new TypeError("No valid SRT cues were found.");
  return cues;
}

export function exportSrt(cues, {
  language = "source",
  bilingual = false,
} = {}) {
  return validateExportCues(cues).map((cue, index) => {
    const text = selectCueText(cue, language, bilingual);
    return [
      String(index + 1),
      `${formatClockMs(cue.startMs, { separator: "," })} --> ${formatClockMs(cue.endMs, { separator: "," })}`,
      text,
    ].join("\n");
  }).join("\n\n") + (cues.length ? "\n" : "");
}

export function parseVtt(text) {
  const normalized = normalizeImportedText(text);
  const withoutHeader = normalized
    .replace(/^\uFEFF?WEBVTT(?:[^\n]*)\n?/i, "")
    .replace(/^\n+/, "");
  const blocks = withoutHeader.split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const first = lines[0]?.trim() ?? "";
    if (!first || /^(NOTE|STYLE|REGION)(?:\s|$)/i.test(first)) continue;
    let identifier = "";
    let timingLine = lines.shift()?.trim() ?? "";
    if (!timingLine.includes("-->")) {
      identifier = timingLine;
      timingLine = lines.shift()?.trim() ?? "";
    }
    const timing = parseTimingLine(timingLine, ".");
    if (!timing) throw new TypeError(`Malformed WebVTT cue timing near "${timingLine.slice(0, 80)}".`);
    cues.push(createImportedCue(identifier, timing, lines.join("\n").trim(), cues.length));
    assertCueCount(cues);
  }
  if (!cues.length && withoutHeader.trim()) throw new TypeError("No valid WebVTT cues were found.");
  return cues;
}

export function exportVtt(cues, {
  language = "source",
  bilingual = false,
} = {}) {
  const body = validateExportCues(cues).map((cue) => [
    cue.id,
    `${formatClockMs(cue.startMs)} --> ${formatClockMs(cue.endMs)}`,
    selectCueText(cue, language, bilingual),
  ].join("\n")).join("\n\n");
  return `WEBVTT\n\n${body}${body ? "\n" : ""}`;
}

export function detectCaptionFileFormat(filename, text = "") {
  const lowerName = String(filename ?? "").toLowerCase();
  if (lowerName.endsWith(".srt")) return "srt";
  if (lowerName.endsWith(".vtt")) return "vtt";
  if (lowerName.endsWith(".vpcaptions.json") || lowerName.endsWith(".json")) return "package";
  if (/^\s*WEBVTT\b/i.test(String(text))) return "vtt";
  if (/^\s*(?:\d+\s*)?\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/m.test(String(text))) return "srt";
  return "package";
}

function normalizeImportedText(value) {
  const text = String(value ?? "");
  if (new TextEncoder().encode(text).byteLength > MAX_CAPTION_FILE_BYTES) {
    throw new RangeError("Caption file exceeds the 25 MB import limit.");
  }
  return text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
}

function parseTimingLine(line, preferredSeparator) {
  const match = String(line).match(
    /^(\d{1,3}:\d{2}:\d{2}[,.]\d{3}|\d{1,3}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{3}|\d{1,3}:\d{2}[,.]\d{3})(?:\s+.*)?$/,
  );
  if (!match) return null;
  return {
    startMs: parseTimestamp(match[1], preferredSeparator),
    endMs: parseTimestamp(match[2], preferredSeparator),
  };
}

function parseTimestamp(value, preferredSeparator) {
  const normalized = value.replace(",", ".");
  const parts = normalized.split(":");
  const secondsWithMs = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  return Math.round(((hours * 3600) + (minutes * 60) + secondsWithMs) * 1000);
}

function createImportedCue(identifier, timing, sourceText, index) {
  if (timing.endMs < timing.startMs) {
    throw new RangeError("Caption end time cannot precede its start time.");
  }
  return {
    id: normalizeCueId(identifier, index),
    startMs: timing.startMs,
    endMs: timing.endMs,
    sourceText,
    translations: {},
    confidence: null,
  };
}

function normalizeCueId(identifier, index) {
  const safe = String(identifier ?? "").trim().replace(/[^\w.-]+/g, "-").slice(0, 80);
  return safe || `cue-${String(index + 1).padStart(6, "0")}`;
}

function validateExportCues(cues) {
  if (!Array.isArray(cues)) throw new TypeError("Caption cues must be an array.");
  assertCueCount(cues);
  return cues.map((cue) => {
    if (!Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs) || cue.endMs < cue.startMs) {
      throw new TypeError("Every cue must have valid integer millisecond timestamps.");
    }
    return cue;
  });
}

function selectCueText(cue, language, bilingual) {
  const source = String(cue.sourceText ?? "");
  const target = language === "source" ? source : String(cue.translations?.[language] ?? "");
  if (!bilingual) return target;
  return [source, target].filter(Boolean).join("\n");
}

function assertCueCount(cues) {
  if (cues.length > MAX_CAPTION_CUES) {
    throw new RangeError(`Caption files may contain at most ${MAX_CAPTION_CUES.toLocaleString()} cues.`);
  }
}
