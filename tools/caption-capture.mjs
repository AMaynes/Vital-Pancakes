/**
 * Shared-tab capture lifecycle. Audio sample counts, not background timers,
 * drive duration and progress. Audio chunks leave the worklet by transfer and
 * are never written to persistent storage.
 */

export class CaptionCaptureError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "CaptionCaptureError";
    this.code = code;
  }
}

export class CaptionCaptureSession {
  constructor({
    workletUrl = new URL("./caption-audio-worklet.js?v=2", import.meta.url),
    targetSampleRate = 16_000,
    chunkSeconds = 20,
    overlapSeconds = 2,
    onChunk = () => {},
    onProgress = () => {},
    onStatus = () => {},
  } = {}) {
    this.workletUrl = workletUrl;
    this.targetSampleRate = targetSampleRate;
    this.chunkSeconds = chunkSeconds;
    this.overlapSeconds = overlapSeconds;
    this.onChunk = onChunk;
    this.onProgress = onProgress;
    this.onStatus = onStatus;
    this.state = "idle";
    this.processedSamples = 0;
    this.endedByLimit = false;
  }

  async start({ captureDurationMs = Infinity, includeVideo = false, providedStream = null } = {}) {
    if (this.state !== "idle") throw new CaptionCaptureError("ALREADY_ACTIVE", "A capture is already active.");
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new CaptionCaptureError("UNSUPPORTED", "This browser cannot capture shared tab audio.");
    }
    this.state = "requesting";
    this.onStatus({ state: this.state, message: "Choose the movie tab and enable tab audio sharing." });
    if (providedStream) {
      this.stream = providedStream;
    } else {
      try {
        this.stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          preferCurrentTab: false,
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
          systemAudio: "include",
        });
      } catch (error) {
        this.state = "error";
        if (error?.name === "NotAllowedError") {
          throw new CaptionCaptureError("PERMISSION_DENIED", "Tab capture permission was denied.", error);
        }
        throw new CaptionCaptureError("CAPTURE_FAILED", "The selected tab could not be captured.", error);
      }
    }

    if (!this.stream.getAudioTracks().length) {
      this.stopTracks();
      this.state = "error";
      throw new CaptionCaptureError(
        "MISSING_AUDIO",
        "No tab audio was shared. Select a browser tab and enable its audio-sharing checkbox.",
      );
    }

    try {
      this.audioContext = new AudioContext({ latencyHint: "playback" });
      await this.audioContext.audioWorklet.addModule(this.workletUrl);
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.audioContext, "caption-relay-audio", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          targetSampleRate: this.targetSampleRate,
          chunkSeconds: this.chunkSeconds,
          overlapSeconds: this.overlapSeconds,
          startOnAudio: true,
          audioStartThreshold: 0.003,
          maxSamples: Number.isFinite(captureDurationMs)
            ? Math.round(captureDurationMs * this.targetSampleRate / 1000)
            : Infinity,
        },
      });
      this.mutedGain = this.audioContext.createGain();
      this.mutedGain.gain.value = 0;
      this.worklet.port.onmessage = ({ data }) => this.handleWorkletMessage(data);
      this.source.connect(this.worklet).connect(this.mutedGain).connect(this.audioContext.destination);
      if (this.audioContext.state === "suspended") await this.audioContext.resume();
      this.stream.getTracks().forEach((track) => {
        track.addEventListener("ended", () => this.handleTrackEnded(track), { once: true });
      });
      if (!includeVideo) {
        this.stream.getVideoTracks().forEach((track) => {
          track.enabled = false;
        });
      }
      await this.requestWakeLock();
      this.state = "capturing";
      this.onStatus({
        state: this.state,
        armed: false,
        message: "Armed. Timed capture begins with the first audible shared-tab audio.",
      });
      return this.stream;
    } catch (error) {
      await this.stop({ reason: "error" });
      throw new CaptionCaptureError("AUDIO_SETUP_FAILED", "Tab audio processing could not start.", error);
    }
  }

  async stop({ reason = "manual" } = {}) {
    if (["idle", "stopped"].includes(this.state)) return;
    this.state = "stopping";
    if (this.worklet && reason !== "limit") await this.flushWorklet();
    this.source?.disconnect();
    this.worklet?.disconnect();
    this.mutedGain?.disconnect();
    this.stopTracks();
    await this.audioContext?.close?.().catch(() => {});
    await this.releaseWakeLock();
    this.state = "stopped";
    this.onStatus({ state: this.state, reason, message: describeStopReason(reason) });
  }

  async requestWakeLock() {
    if (!navigator.wakeLock?.request) return;
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      this.onStatus({
        state: this.state,
        message: "Capture is running without a screen wake lock. Keep the device awake.",
        warning: true,
      });
    }
  }

  async releaseWakeLock() {
    await this.wakeLock?.release?.().catch(() => {});
    this.wakeLock = null;
  }

  handleWorkletMessage(message) {
    if (message?.type === "flush-complete") {
      this.flushResolver?.();
      this.flushResolver = null;
      return;
    }
    if (message?.type === "audio-progress") {
      this.processedSamples = message.processedSamples;
      this.onProgress({
        processedSamples: this.processedSamples,
        elapsedMs: Math.round(this.processedSamples * 1000 / this.targetSampleRate),
        level: message.level,
        waitingForAudio: message.waitingForAudio === true,
        waitingMs: Number(message.waitingMs) || 0,
      });
      return;
    }
    if (message?.type === "capture-armed") {
      this.onStatus({
        state: this.state,
        armed: true,
        waitingMs: Number(message.waitingMs) || 0,
        message: "Movie audio detected. Timed capture is running.",
      });
      return;
    }
    if (message?.type === "audio-chunk") {
      this.onChunk({
        ...message,
        startMs: Math.round(message.startSample * 1000 / message.sampleRate),
        endMs: Math.round(message.endSample * 1000 / message.sampleRate),
      });
      return;
    }
    if (message?.type === "capture-limit") {
      this.processedSamples = Number(message.processedSamples) || this.processedSamples;
      this.onProgress({
        processedSamples: this.processedSamples,
        elapsedMs: Math.round(this.processedSamples * 1000 / this.targetSampleRate),
        level: 0,
      });
      this.endedByLimit = true;
      this.stop({ reason: "limit" });
    }
  }

  handleTrackEnded(track) {
    if (this.state !== "capturing" || this.endedByLimit) return;
    const reason = track.kind === "audio" ? "audio-ended" : "tab-closed";
    this.stop({ reason });
  }

  stopTracks() {
    this.stream?.getTracks().forEach((track) => track.stop());
  }

  async flushWorklet() {
    await Promise.race([
      new Promise((resolve) => {
        this.flushResolver = resolve;
        this.worklet.port.postMessage({ type: "flush" });
      }),
      new Promise((resolve) => setTimeout(resolve, 750)),
    ]);
    this.flushResolver = null;
  }
}

function describeStopReason(reason) {
  return {
    limit: "Capture duration reached. Finishing queued transcription.",
    manual: "Capture stopped early. Saved progress can be recovered.",
    "audio-ended": "Shared tab audio ended before the capture timer.",
    "tab-closed": "The shared browser tab was closed or capture was stopped.",
    error: "Capture stopped because audio processing failed.",
  }[reason] ?? "Capture stopped.";
}
