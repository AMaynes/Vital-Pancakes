/**
 * Pure caption timing rules. Capture timestamps are measured from processed
 * audio samples and converted back to the movie's original timeline.
 */

export const CAPTURE_PLAYBACK_RATES = Object.freeze([1, 1.25, 1.5, 2]);

export function assertCapturePlaybackRate(value) {
  const playbackRate = Number(value);
  if (!CAPTURE_PLAYBACK_RATES.includes(playbackRate)) {
    throw new RangeError("Capture speed must be 1×, 1.25×, 1.5×, or 2×.");
  }
  return playbackRate;
}

export function calculateCaptureDurationMs(originalDurationMs, playbackRate) {
  const durationMs = requireNonNegativeMilliseconds(originalDurationMs, "Movie duration");
  return Math.round(durationMs / assertCapturePlaybackRate(playbackRate));
}

export function capturedToOriginalTimeMs(capturedAudioTimeMs, playbackRate) {
  const capturedMs = requireNonNegativeMilliseconds(capturedAudioTimeMs, "Captured audio time");
  return Math.round(capturedMs * assertCapturePlaybackRate(playbackRate));
}

export function applyTimelineCorrection(cue, {
  offsetMs = 0,
  scale = 1,
  anchorMs = 0,
} = {}) {
  const numericOffset = requireFiniteNumber(offsetMs, "Global offset");
  const numericScale = requirePositiveNumber(scale, "Timeline scale");
  const numericAnchor = requireNonNegativeMilliseconds(anchorMs, "Scale anchor");
  const startMs = correctTimestamp(cue.startMs, numericOffset, numericScale, numericAnchor);
  const endMs = Math.max(
    startMs,
    correctTimestamp(cue.endMs, numericOffset, numericScale, numericAnchor),
  );
  return { ...cue, startMs, endMs };
}

export function applyTimelineCorrectionToCues(cues, correction) {
  if (!Array.isArray(cues)) throw new TypeError("Caption cues must be an array.");
  return cues.map((cue) => applyTimelineCorrection(cue, correction));
}

export function applyTimelineCorrectionToFingerprints(fingerprints, correction) {
  if (!Array.isArray(fingerprints)) {
    throw new TypeError("Audio fingerprints must be an array.");
  }
  const {
    offsetMs = 0,
    scale = 1,
    anchorMs = 0,
  } = correction ?? {};
  const numericOffset = requireFiniteNumber(offsetMs, "Global offset");
  const numericScale = requirePositiveNumber(scale, "Timeline scale");
  const numericAnchor = requireNonNegativeMilliseconds(anchorMs, "Scale anchor");
  return fingerprints.map((fingerprint) => ({
    ...fingerprint,
    timeMs: correctTimestamp(
      fingerprint.timeMs,
      numericOffset,
      numericScale,
      numericAnchor,
    ),
  }));
}

export function parseClockValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const parts = text.replace(",", ".").split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => part === "")) {
    throw new TypeError("Use HH:MM:SS, MM:SS, or seconds.");
  }
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new TypeError("Duration must contain non-negative numbers.");
  }
  const seconds = parts.length === 3
    ? (numbers[0] * 3600) + (numbers[1] * 60) + numbers[2]
    : parts.length === 2
      ? (numbers[0] * 60) + numbers[1]
      : numbers[0];
  if ((parts.length >= 2 && numbers.at(-1) >= 60)
    || (parts.length === 3 && numbers[1] >= 60)) {
    throw new RangeError("Minutes and seconds must be below 60.");
  }
  return Math.round(seconds * 1000);
}

export function formatClockMs(value, { separator = ".", includeHours = true } = {}) {
  const totalMs = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  const clock = [
    includeHours || hours > 0 ? String(hours).padStart(2, "0") : null,
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
  ].filter((part) => part !== null).join(":");
  return `${clock}${separator}${String(milliseconds).padStart(3, "0")}`;
}

function correctTimestamp(value, offsetMs, scale, anchorMs) {
  const timestampMs = requireNonNegativeMilliseconds(value, "Cue timestamp");
  return Math.max(0, Math.round(anchorMs + ((timestampMs - anchorMs) * scale) + offsetMs));
}

function requireNonNegativeMilliseconds(value, label) {
  const milliseconds = requireFiniteNumber(value, label);
  if (milliseconds < 0) throw new RangeError(`${label} cannot be negative.`);
  return milliseconds;
}

function requirePositiveNumber(value, label) {
  const number = requireFiniteNumber(value, label);
  if (number <= 0) throw new RangeError(`${label} must be greater than zero.`);
  return number;
}

function requireFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
}
