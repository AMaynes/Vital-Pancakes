/**
 * Hybrid synchronization state machine. It owns confidence gating, lock
 * acquisition, drift correction, seek detection, and the caption clock.
 */

export const SYNCHRONIZATION_STATES = Object.freeze([
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

const DEFAULT_OPTIONS = Object.freeze({
  acquireThreshold: 0.68,
  lockedThreshold: 0.58,
  compatibleWindowMs: 8_000,
  seekThresholdMs: 12_000,
  uncertaintyTimeoutMs: 15_000,
  smoothingFactor: 0.24,
});

export class CaptionSynchronizationEngine {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.reset();
  }

  start(observedAtMs = 0) {
    this.state = "listening";
    this.lastObservationAtMs = observedAtMs;
    this.transition("acquiring");
  }

  ingestMatch({
    movieTimeMs,
    confidence,
    observedAtMs,
    playbackRate = 1,
    isCommonPhrase = false,
    contradictory = false,
  }) {
    if (contradictory) {
      const threshold = this.state === "locked"
        ? this.options.lockedThreshold
        : this.options.acquireThreshold;
      return Number.isFinite(confidence) && confidence >= threshold
        ? this.rejectMatch(observedAtMs)
        : this.observeNoMatch(observedAtMs);
    }
    if (!Number.isFinite(movieTimeMs) || !Number.isFinite(observedAtMs)
      || !Number.isFinite(confidence) || isCommonPhrase) {
      return this.observeNoMatch(observedAtMs);
    }
    this.playbackRate = playbackRate > 0 ? playbackRate : 1;
    const threshold = this.state === "locked"
      ? this.options.lockedThreshold
      : this.options.acquireThreshold;
    if (confidence < threshold) return this.observeNoMatch(observedAtMs);

    const predictedMs = this.estimatedMovieTimeMs(observedAtMs);
    const errorMs = this.hasAnchor ? movieTimeMs - predictedMs : 0;
    const isSeek = this.hasAnchor && Math.abs(errorMs) >= this.options.seekThresholdMs;
    if (isSeek) {
      this.setAnchor(movieTimeMs, observedAtMs);
      this.compatibleMatches = 1;
      this.confidence = confidence;
      this.transition("resynchronizing");
      return this.snapshot(observedAtMs, { isSeek: true, correctionMs: errorMs });
    }

    if (["acquiring", "listening", "uncertain", "resynchronizing"].includes(this.state)) {
      const compatible = !this.hasAnchor
        || Math.abs(errorMs) <= this.options.compatibleWindowMs;
      if (!compatible) {
        this.compatibleMatches = 1;
        this.setAnchor(movieTimeMs, observedAtMs);
        this.transition("acquiring");
      } else {
        this.compatibleMatches += 1;
        this.setAnchor(movieTimeMs, observedAtMs);
        if (this.compatibleMatches >= 2) this.transition("locked");
      }
    } else if (this.state === "locked") {
      const smoothedMovieTimeMs = predictedMs + (errorMs * this.options.smoothingFactor);
      this.setAnchor(smoothedMovieTimeMs, observedAtMs);
    }
    this.confidence = confidence;
    this.lastObservationAtMs = observedAtMs;
    return this.snapshot(observedAtMs, { isSeek: false, correctionMs: errorMs });
  }

  tick(observedAtMs) {
    if (this.state === "locked"
      && observedAtMs - this.lastObservationAtMs > this.options.uncertaintyTimeoutMs) {
      this.compatibleMatches = 0;
      this.confidence = 0;
      this.transition("uncertain");
    }
    return this.snapshot(observedAtMs);
  }

  pause(observedAtMs) {
    this.pausedMovieTimeMs = this.estimatedMovieTimeMs(observedAtMs);
    this.transition("paused");
    return this.snapshot(observedAtMs);
  }

  resume(observedAtMs) {
    if (this.state !== "paused") return this.snapshot(observedAtMs);
    this.setAnchor(this.pausedMovieTimeMs, observedAtMs);
    this.lastObservationAtMs = observedAtMs;
    this.transition(this.hasAnchor ? "locked" : "acquiring");
    return this.snapshot(observedAtMs);
  }

  setCurrentMovieTime(movieTimeMs, observedAtMs) {
    this.setAnchor(Math.max(0, Number(movieTimeMs) || 0), observedAtMs);
    this.compatibleMatches = 2;
    this.confidence = 1;
    this.lastObservationAtMs = observedAtMs;
    this.transition("locked");
    return this.snapshot(observedAtMs);
  }

  adjust(deltaMs, observedAtMs) {
    return this.setCurrentMovieTime(this.estimatedMovieTimeMs(observedAtMs) + Number(deltaMs), observedAtMs);
  }

  setPlaybackRate(playbackRate, observedAtMs) {
    const numericRate = Number(playbackRate);
    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      throw new RangeError("Playback rate must be greater than zero.");
    }
    const movieTimeMs = this.estimatedMovieTimeMs(observedAtMs);
    this.playbackRate = numericRate;
    if (this.hasAnchor) this.setAnchor(movieTimeMs, observedAtMs);
    return this.snapshot(observedAtMs);
  }

  resynchronize() {
    this.compatibleMatches = 0;
    this.confidence = 0;
    this.transition("resynchronizing");
  }

  end(observedAtMs) {
    this.pausedMovieTimeMs = this.estimatedMovieTimeMs(observedAtMs);
    this.transition("ended");
  }

  fail(message) {
    this.error = String(message ?? "Synchronization failed.");
    this.transition("error");
  }

  reset() {
    this.state = "idle";
    this.anchorMovieTimeMs = 0;
    this.anchorObservedAtMs = 0;
    this.lastObservationAtMs = 0;
    this.pausedMovieTimeMs = 0;
    this.playbackRate = 1;
    this.compatibleMatches = 0;
    this.confidence = 0;
    this.hasAnchor = false;
    this.error = "";
  }

  estimatedMovieTimeMs(observedAtMs) {
    if (!this.hasAnchor) return 0;
    if (this.state === "paused" || this.state === "ended") return this.pausedMovieTimeMs;
    const elapsedMs = Math.max(0, Number(observedAtMs) - this.anchorObservedAtMs);
    return Math.max(0, Math.round(this.anchorMovieTimeMs + (elapsedMs * this.playbackRate)));
  }

  shouldShowCaptions() {
    return ["locked", "paused"].includes(this.state)
      && this.confidence >= this.options.lockedThreshold;
  }

  snapshot(observedAtMs, extra = {}) {
    return {
      state: this.state,
      confidence: this.confidence,
      movieTimeMs: this.estimatedMovieTimeMs(observedAtMs),
      showCaptions: this.shouldShowCaptions(),
      error: this.error,
      ...extra,
    };
  }

  observeNoMatch(observedAtMs) {
    const snapshotAtMs = Number.isFinite(observedAtMs)
      ? observedAtMs
      : this.lastObservationAtMs;
    if (this.state === "locked" || ["paused", "ended", "error"].includes(this.state)) {
      return this.snapshot(snapshotAtMs);
    }
    this.compatibleMatches = 0;
    this.confidence = 0;
    this.transition("acquiring");
    return this.snapshot(snapshotAtMs);
  }

  rejectMatch(observedAtMs) {
    const snapshotAtMs = Number.isFinite(observedAtMs)
      ? observedAtMs
      : this.lastObservationAtMs;
    this.compatibleMatches = 0;
    this.confidence = 0;
    if (this.state === "locked") this.transition("uncertain");
    else if (!["paused", "ended", "error"].includes(this.state)) this.transition("acquiring");
    return this.snapshot(snapshotAtMs);
  }

  setAnchor(movieTimeMs, observedAtMs) {
    this.anchorMovieTimeMs = Math.max(0, Math.round(movieTimeMs));
    this.anchorObservedAtMs = observedAtMs;
    this.hasAnchor = true;
  }

  transition(nextState) {
    if (!SYNCHRONIZATION_STATES.includes(nextState)) {
      throw new RangeError(`Unknown synchronization state: ${nextState}`);
    }
    this.state = nextState;
  }
}

export function findActiveCues(cues, movieTimeMs) {
  if (!Array.isArray(cues) || !Number.isFinite(movieTimeMs)) return [];
  return cues.filter((cue) => cue.startMs <= movieTimeMs && cue.endMs >= movieTimeMs);
}
