/**
 * Caption Relay page orchestration. Domain rules, storage, media capture,
 * workers, synchronization, and overlays remain behind focused modules.
 */

import { CaptionCaptureSession } from "./caption-capture.mjs";
import {
  detectCaptionFileFormat,
  exportSrt,
  exportVtt,
  parseSrt,
  parseVtt,
} from "./caption-formats.mjs";
import { CaptionMirror } from "./caption-mirror.mjs";
import {
  CaptionDisplayClock,
  CaptionOverlay,
  CaptionOverlaySupersededError,
} from "./caption-overlay.mjs";
import {
  createCaptionPackage,
  parseCaptionPackage,
  serializeCaptionPackage,
  validateCaptionPackage,
} from "./caption-package.mjs";
import {
  clearDownloadedCaptionModels,
  createProjectId,
  deleteCaptionProject,
  duplicateCaptionProject,
  estimateCaptionStorage,
  getCaptionProject,
  getCaptionRelaySettings,
  listCaptionProjects,
  recoverInterruptedProject,
  renameCaptionProject,
  saveCaptionProject,
  saveCaptionRelaySettings,
  saveCaptureCheckpoint,
} from "./caption-storage.mjs";
import {
  CaptionSynchronizationEngine,
  findActiveCues,
} from "./caption-sync.mjs";
import {
  buildTextSynchronizationIndex,
  findTranscriptMatch,
  isDistinctivePhrase,
} from "./caption-text-sync.mjs";
import {
  applyTimelineCorrectionToCues,
  applyTimelineCorrectionToFingerprints,
  calculateCaptureDurationMs,
  capturedToOriginalTimeMs,
  formatClockMs,
  parseClockValue,
} from "./caption-timing.mjs";
import {
  appendTranscriptionResult,
  BoundedTranscriptionQueue,
} from "./caption-transcript.mjs";
import {
  countTranslationProgress,
  regenerateCaptionCue,
  searchAndReplaceTranslations,
  translateCaptionCues,
} from "./caption-translation.mjs";
import { AiCommandError } from "../app/ai-command-protocol.mjs";
import { installAiPageHost } from "../app/ai-page-host.mjs";
import { createCaptionRelayAiAdapter } from "./caption-relay-ai-adapter.mjs";

const PAGE_SIZE = 100;
const SAVE_DELAY_MS = 450;
const CONTRADICTORY_OBSERVATIONS_REQUIRED = 2;
const DEFAULT_OVERLAY_SETTINGS = Object.freeze({
  fontFamily: "Georgia, serif",
  fontSizePx: 34,
  color: "#ffffff",
  background: "#171613d6",
  verticalPlacement: "bottom",
  bilingual: false,
});

const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element]),
);

const state = {
  stage: "capture",
  captionPackage: null,
  project: null,
  projects: [],
  cuePage: 0,
  saveTimer: null,
  captureDurationMs: 0,
  captureEnded: false,
  captureStopReason: "",
  captureLastElapsedMs: 0,
  captureSilentElapsedMs: 0,
  captureAudioDetected: false,
  captureSession: null,
  captureQueue: new BoundedTranscriptionQueue(12),
  droppedCaptureChunks: 0,
  pendingFingerprintJobs: 0,
  transcriptionWorker: null,
  transcriptionModelReady: false,
  transcriptionModelMeta: null,
  speechJobs: new Map(),
  fingerprintWorker: null,
  fingerprintJobs: new Map(),
  translationWorker: null,
  translationWorkerReady: false,
  translationAdapter: null,
  translationAdapterName: "",
  translationJobs: new Map(),
  translationPaused: false,
  translationRunning: false,
  translationResumeWaiters: [],
  overlay: new CaptionOverlay({ onClose: handleOverlayClosed }),
  overlaySettings: { ...DEFAULT_OVERLAY_SETTINGS },
  mirror: null,
  displayCapture: null,
  displayTextIndex: [],
  displaySyncJobPending: false,
  displayContradictoryObservations: 0,
  syncEngine: new CaptionSynchronizationEngine(),
  displayClock: new CaptionDisplayClock({ tick: updateDisplayedCaption }),
  announcementTimer: 0,
};

const transcriptionModelWaiters = new Set();
const translationModelWaiters = new Set();
let captionAiRevision = 0;
let captionAiStateSignature = "";
let captionAiApplyChain = Promise.resolve();
let captionAiMutationSerial = 0;

const initializationPromise = initialize();

async function initialize() {
  window.addEventListener("pagehide", stopDisplayClock, { once: true });
  state.mirror = new CaptionMirror(
    elements["relay-mirror"],
    elements["relay-mirror-video"],
    elements["relay-mirror-caption"],
  );
  initializeWorkers();
  bindStageNavigation();
  bindCaptureControls();
  bindTranslationControls();
  bindDisplayControls();
  bindProjectControls();
  await Promise.all([
    refreshCapabilities(),
    restoreSettings(),
    refreshProjects(),
  ]);
  updateCaptureCalculation();
  renderAllCaptionViews();
}

function initializeWorkers() {
  if (!globalThis.Worker) return;
  state.transcriptionWorker = new Worker("./caption-transcription-worker.js", { type: "module" });
  state.transcriptionWorker.addEventListener("message", handleTranscriptionWorkerMessage);
  state.transcriptionWorker.addEventListener("error", () => {
    reportModelFailure("Speech worker failed to start.");
  });

  state.translationWorker = new Worker("./caption-translation-worker.js", { type: "module" });
  state.translationWorker.addEventListener("message", handleTranslationWorkerMessage);

  state.fingerprintWorker = new Worker("./caption-fingerprint-worker.js", { type: "module" });
  state.fingerprintWorker.addEventListener("message", handleFingerprintWorkerMessage);
}

function bindStageNavigation() {
  document.querySelectorAll("[data-relay-stage]").forEach((button) => {
    button.addEventListener("click", () => showStage(button.dataset.relayStage));
  });
}

function showStage(stage) {
  state.stage = stage;
  document.querySelectorAll("[data-relay-stage]").forEach((button) => {
    const active = button.dataset.relayStage === stage;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-stage-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.stagePanel !== stage;
  });
  state.cuePage = 0;
  renderAllCaptionViews();
}

function bindCaptureControls() {
  elements["capture-duration"].addEventListener("input", updateCaptureCalculation);
  elements["capture-rate"].addEventListener("change", updateCaptureCalculation);
  elements["prepare-transcription-model"].addEventListener("click", prepareTranscriptionModel);
  elements["start-capture"].addEventListener("click", startCapture);
  elements["stop-capture"].addEventListener("click", () => state.captureSession?.stop({ reason: "manual" }));
  elements["download-capture-package"].addEventListener("click", () => downloadPackage());
  elements["apply-timeline-correction"].addEventListener("click", applyTimelineCorrection);
  elements["cue-page-previous"].addEventListener("click", () => changeCuePage(-1));
  elements["cue-page-next"].addEventListener("click", () => changeCuePage(1));
  elements["english-caption-rows"].addEventListener("input", handleCaptionEdit);
}

function bindTranslationControls() {
  elements["translation-import"].addEventListener("change", (event) => importCaptionFile(event.target.files?.[0], "translate"));
  elements["prepare-translation-model"].addEventListener("click", prepareTranslationAdapter);
  elements["translate-all"].addEventListener("click", () => runTranslation(false));
  elements["pause-translation"].addEventListener("click", toggleTranslationPause);
  elements["retry-failed-translations"].addEventListener("click", () => runTranslation(true));
  elements["replace-translations"].addEventListener("click", replaceTranslations);
  elements["add-glossary-entry"].addEventListener("click", addGlossaryEntry);
  elements["glossary-rows"].addEventListener("input", updateGlossaryEntry);
  elements["glossary-rows"].addEventListener("click", removeGlossaryEntry);
  elements["translation-caption-rows"].addEventListener("input", handleCaptionEdit);
  elements["translation-caption-rows"].addEventListener("click", handleTranslationRetry);
  elements["translation-cue-page-previous"].addEventListener("click", () => changeCuePage(-1));
  elements["translation-cue-page-next"].addEventListener("click", () => changeCuePage(1));
  elements["translation-mode"].addEventListener("change", persistProjectPreferences);
  elements["pronoun-preference"].addEventListener("input", persistProjectPreferences);
  elements["download-vietnamese-vtt"].addEventListener("click", () => downloadText(
    exportVtt(requirePackage().cues, { language: "vi" }),
    `${packageFilenameBase()}-vi.vtt`,
    "text/vtt",
  ));
  elements["download-vietnamese-srt"].addEventListener("click", () => downloadText(
    exportSrt(requirePackage().cues, { language: "vi" }),
    `${packageFilenameBase()}-vi.srt`,
    "application/x-subrip",
  ));
  elements["download-bilingual-vtt"].addEventListener("click", () => downloadText(
    exportVtt(requirePackage().cues, { language: "vi", bilingual: true }),
    `${packageFilenameBase()}-bilingual.vtt`,
    "text/vtt",
  ));
  elements["download-updated-package"].addEventListener("click", () => downloadPackage());
}

function bindDisplayControls() {
  elements["display-import"].addEventListener("change", (event) => importCaptionFile(event.target.files?.[0], "display"));
  elements["open-caption-overlay"].addEventListener("click", openCaptionOverlay);
  elements["connect-movie-audio"].addEventListener("click", connectMovieAudio);
  elements["resynchronize-captions"].addEventListener("click", resynchronize);
  document.querySelectorAll("[data-sync-adjust]").forEach((button) => {
    button.addEventListener("click", () => {
      state.syncEngine.adjust(Number(button.dataset.syncAdjust), performance.now());
      updateDisplayedCaption(performance.now());
    });
  });
  elements["set-manual-movie-time"].addEventListener("click", setManualMovieTime);
  elements["pause-caption-clock"].addEventListener("click", toggleCaptionClock);
  elements["reset-synchronization"].addEventListener("click", resetSynchronization);
  elements["display-playback-rate"].addEventListener("change", () => {
    state.syncEngine.setPlaybackRate(
      Number(elements["display-playback-rate"].value),
      performance.now(),
    );
  });
  [
    "overlay-font",
    "overlay-size",
    "overlay-color",
    "overlay-background",
    "overlay-placement",
    "overlay-bilingual",
  ].forEach((id) => elements[id].addEventListener("input", applyOverlaySettingsFromForm));
  elements["start-mirror-mode"].addEventListener("click", startMirrorMode);
  elements["fullscreen-mirror"].addEventListener("click", () => state.mirror.enterFullscreen().catch(reportError));
  elements["mirror-unmute"].addEventListener("change", () => {
    state.mirror.setMuted(!elements["mirror-unmute"].checked);
  });
}

function bindProjectControls() {
  elements["refresh-capabilities"].addEventListener("click", refreshCapabilities);
  elements["clear-caption-models"].addEventListener("click", clearCaptionModels);
  elements["open-project-drawer"].addEventListener("click", () => setProjectDrawerOpen(true));
  elements["close-project-drawer"].addEventListener("click", () => setProjectDrawerOpen(false));
  elements["resume-project"].addEventListener("click", resumeSelectedProject);
  elements["duplicate-project"].addEventListener("click", duplicateSelectedProject);
  elements["rename-project"].addEventListener("click", renameSelectedProject);
  elements["export-project"].addEventListener("click", exportSelectedProject);
  elements["delete-project"].addEventListener("click", deleteSelectedProject);
}

async function refreshCapabilities() {
  setCapability("capability-webgpu", navigator.gpu ? "Available" : "WASM fallback", navigator.gpu ? "good" : "warning");
  setCapability(
    "capability-tab-audio",
    navigator.mediaDevices?.getDisplayMedia && globalThis.AudioWorkletNode
      ? "Capture API · tab audio picker-dependent"
      : "Unavailable",
    navigator.mediaDevices?.getDisplayMedia && globalThis.AudioWorkletNode ? "good" : "warning",
  );
  setCapability(
    "capability-translator",
    "Translator" in globalThis ? "Chrome local API" : "OPUS-MT fallback",
    "Translator" in globalThis ? "good" : "warning",
  );
  setCapability(
    "capability-pip",
    globalThis.documentPictureInPicture ? "Document PiP" : "Popup fallback",
    globalThis.documentPictureInPicture ? "good" : "warning",
  );
  try {
    const { usage, quota } = await estimateCaptionStorage();
    const available = Math.max(0, quota - usage);
    setCapability("capability-storage", quota ? formatBytes(available) : "Estimate unavailable", quota ? "good" : "warning");
    elements["project-storage-usage"].textContent = quota
      ? `${formatBytes(usage)} used of ${formatBytes(quota)} browser storage.`
      : "Browser storage estimate is unavailable.";
  } catch {
    setCapability("capability-storage", "Estimate unavailable", "warning");
  }
}

function setCapability(id, text, tone) {
  elements[id].textContent = text;
  elements[id].dataset.tone = tone;
}

function updateCaptureCalculation() {
  try {
    const originalDurationMs = parseClockValue(elements["capture-duration"].value);
    const playbackRate = Number(elements["capture-rate"].value);
    state.captureDurationMs = calculateCaptureDurationMs(originalDurationMs, playbackRate);
    elements["calculated-capture-duration"].textContent = formatClockMs(state.captureDurationMs).slice(0, -4);
    elements["capture-timeline-example"].textContent = playbackRate === 1
      ? "10:00 captured → 10:00 movie time"
      : `10:00 captured → ${formatClockMs(capturedToOriginalTimeMs(600_000, playbackRate)).slice(0, -4)} movie time`;
    elements["capture-sync-mode"].textContent = playbackRate === 1
      ? "Compact same-speed fingerprint sync"
      : `English text sync at ${playbackRate}×`;
    elements["capture-alert"].hidden = true;
  } catch (error) {
    elements["calculated-capture-duration"].textContent = "Invalid duration";
    showCaptureAlert(error.message);
  }
}

function prepareTranscriptionModel() {
  if (!state.transcriptionWorker) {
    reportModelFailure("Web Workers are unavailable in this browser.");
    return;
  }
  const modelKey = elements["transcription-model"].value;
  state.transcriptionModelReady = false;
  elements["prepare-transcription-model"].disabled = true;
  elements["transcription-model-progress"].value = 0;
  elements["transcription-model-status"].textContent = "Preparing browser-local speech recognition…";
  state.transcriptionWorker.postMessage({ type: "prepare", modelKey });
}

function handleTranscriptionWorkerMessage({ data }) {
  if (data.type === "model-progress") {
    elements["transcription-model-progress"].value = data.progress;
    elements["transcription-model-status"].textContent = data.text;
    if (state.stage === "display") {
      elements["sync-message"].textContent = `Preparing local English recognition for text synchronization · ${data.text}`;
    }
    return;
  }
  if (data.type === "model-ready") {
    state.transcriptionModelReady = true;
    state.transcriptionModelMeta = data;
    settleModelWaiters(transcriptionModelWaiters, null, data);
    elements["prepare-transcription-model"].disabled = false;
    elements["start-capture"].disabled = false;
    elements["transcription-model-progress"].value = 1;
    elements["transcription-model-status"].textContent = `${data.config.label} ready via ${data.device.toUpperCase()} · ${data.runtime} · ${data.config.license}`;
    if (state.stage === "display" && state.displayCapture) {
      elements["sync-message"].textContent = "Speech model ready · listening for a distinctive English phrase.";
    }
    announce("Transcription model ready.");
    return;
  }
  if (data.type === "transcription-result") {
    const job = state.speechJobs.get(data.jobId);
    if (!job) return;
    state.speechJobs.delete(data.jobId);
      if (job.kind === "capture") handleCaptureTranscriptionResult(job, data);
      else handleDisplayTranscriptionResult(job, data);
    return;
  }
  if (data.type === "worker-error") {
    const job = state.speechJobs.get(data.jobId);
    if (job) {
      state.speechJobs.delete(data.jobId);
      if (job.kind === "capture") handleCaptureTranscriptionFailure(job, data.message);
      else {
        state.displaySyncJobPending = false;
        applyNoSyncObservation();
      }
    } else {
      reportModelFailure(data.message);
    }
  }
}

async function reportModelFailure(message) {
  state.transcriptionModelReady = false;
  settleModelWaiters(
    transcriptionModelWaiters,
    new Error(String(message || "Speech model preparation failed.")),
  );
  elements["prepare-transcription-model"].disabled = false;
  elements["start-capture"].disabled = true;
  elements["transcription-model-status"].textContent = `Speech model failure · ${message}`;
  showCaptureAlert(`Speech model failure: ${message}`);
  if (["capturing", "requesting", "stopping"].includes(state.captureSession?.state)) {
    await state.captureSession.stop({ reason: "error" }).catch(() => {});
    const discarded = state.captureQueue.clear();
    state.droppedCaptureChunks += discarded;
    for (const [jobId, job] of state.speechJobs) {
      if (job.kind === "capture") state.speechJobs.delete(jobId);
    }
    if (state.project) state.project.status = "interrupted";
    await persistCaptureProgress().catch(() => {});
    maybeFinalizeCapture();
  }
}

async function startCapture() {
  try {
    if (!state.transcriptionModelReady) throw new Error("Prepare the transcription model first.");
    const title = elements["capture-title"].value.trim();
    const originalDurationMs = parseClockValue(elements["capture-duration"].value);
    const capturePlaybackRate = Number(elements["capture-rate"].value);
    if (!title) throw new Error("Enter the movie title.");
    if (!originalDurationMs) throw new Error("Enter the original movie duration.");
    state.captureDurationMs = calculateCaptureDurationMs(originalDurationMs, capturePlaybackRate);
    state.captureQueue = new BoundedTranscriptionQueue(12);
    state.droppedCaptureChunks = 0;
    state.pendingFingerprintJobs = 0;
    state.captureEnded = false;
    state.captureStopReason = "";
    state.captureLastElapsedMs = 0;
    state.captureSilentElapsedMs = 0;
    state.captureAudioDetected = false;
    const reusableDraft = state.project?.status === "draft"
      && !state.captionPackage?.cues?.length
      ? state.project
      : null;
    state.captionPackage = createCaptionPackage({
      title,
      originalDurationMs,
      capturePlaybackRate,
      transcriptionModel: {
        id: state.transcriptionModelMeta.config.id,
        runtime: state.transcriptionModelMeta.runtime,
        revision: state.transcriptionModelMeta.config.revision,
        license: state.transcriptionModelMeta.config.license,
      },
      sync: {
        mode: capturePlaybackRate === 1 ? "fingerprint" : "text",
        fingerprints: [],
        textIndexVersion: 1,
      },
      settings: {
        ...readProjectPreferences(),
        captureStartMode: "first-audible",
      },
    });
    const now = new Date().toISOString();
    state.project = {
      id: reusableDraft?.id ?? createProjectId(),
      name: title,
      status: "capturing",
      createdAt: reusableDraft?.createdAt ?? now,
      updatedAt: now,
      package: state.captionPackage,
    };
    state.captureSession = new CaptionCaptureSession({
      onChunk: handleCaptureAudioChunk,
      onProgress: updateCaptureProgress,
      onStatus: handleCaptureStatus,
    });
    const capturePromise = state.captureSession.start({ captureDurationMs: state.captureDurationMs });
    await saveCurrentProject();
    await capturePromise;
    elements["start-capture"].disabled = true;
    elements["stop-capture"].disabled = false;
    elements["capture-status"].textContent = "Armed · waiting for movie audio";
    elements["capture-alert"].hidden = true;
    announce("Capture started. Play the movie at the selected constant speed.");
  } catch (error) {
    showCaptureAlert(error.message);
    if (state.project) {
      state.project.status = "interrupted";
      await saveCurrentProject().catch(() => {});
    }
  }
}

function handleCaptureAudioChunk(chunk) {
  if (!chunk.samples?.length) return;
  if (state.captionPackage?.capturePlaybackRate === 1 && state.fingerprintWorker) {
    const fingerprintSamples = chunk.samples.slice();
    const jobId = createJobId("fingerprint");
    state.pendingFingerprintJobs += 1;
    state.fingerprintJobs.set(jobId, { kind: "capture" });
    state.fingerprintWorker.postMessage({
      type: "fingerprint",
      jobId,
      samples: fingerprintSamples.buffer,
      sampleRate: chunk.sampleRate,
      startTimeMs: chunk.startMs,
    }, [fingerprintSamples.buffer]);
  }
  const queued = state.captureQueue.enqueue({
    samples: chunk.samples,
    sampleRate: chunk.sampleRate,
    startMs: chunk.startMs,
    endMs: chunk.endMs,
    speechRatio: chunk.speechRatio,
  });
  if (!queued) {
    state.droppedCaptureChunks += 1;
    showCaptureAlert("Transcription queue is falling behind. A raw-audio chunk was discarded instead of growing memory without bound.");
  }
  updateQueueStatus();
  processNextCaptureChunk();
}

function processNextCaptureChunk() {
  if (!state.transcriptionWorker || !state.transcriptionModelReady) return;
  const item = state.captureQueue.take();
  if (!item) {
    maybeFinalizeCapture();
    return;
  }
  const jobId = createJobId("speech");
  state.speechJobs.set(jobId, { kind: "capture", item });
  state.transcriptionWorker.postMessage({
    type: "transcribe",
    jobId,
    samples: item.samples.buffer,
    sampleRate: item.sampleRate,
    speechRatio: item.speechRatio,
  }, [item.samples.buffer]);
  updateQueueStatus();
}

async function handleCaptureTranscriptionResult(job, data) {
  state.captionPackage.cues = appendTranscriptionResult(
    state.captionPackage.cues,
    data.result,
    {
      capturedChunkStartMs: job.item.startMs,
      capturePlaybackRate: state.captionPackage.capturePlaybackRate,
      incomplete: state.captureStopReason && state.captureStopReason !== "limit",
    },
  );
  state.captureQueue.complete();
  state.project.package = state.captionPackage;
  await persistCaptureProgress();
  renderAllCaptionViews();
  updateQueueStatus();
  processNextCaptureChunk();
}

function handleCaptureTranscriptionFailure(job, message) {
  state.captureQueue.complete();
  state.droppedCaptureChunks += 1;
  showCaptureAlert(`Speech model failure: ${message}. The affected cue window remains marked for recovery.`);
  updateQueueStatus();
  processNextCaptureChunk();
}

async function persistCaptureProgress() {
  if (!state.project) return;
  state.project.package = state.captionPackage;
  await Promise.all([
    saveCurrentProject(),
    saveCaptureCheckpoint(state.project.id, {
      processedAudioMs: Math.round((state.captureSession?.processedSamples ?? 0) * 1000 / 16_000),
      cueCount: state.captionPackage.cues.length,
      droppedChunks: state.droppedCaptureChunks,
      status: state.project.status,
    }),
  ]).catch((error) => showCaptureAlert(error.message));
}

function updateCaptureProgress({
  elapsedMs,
  level,
  waitingForAudio = false,
  waitingMs = 0,
}) {
  const remainingMs = Math.max(0, state.captureDurationMs - elapsedMs);
  elements["capture-timer"].textContent = formatClockMs(elapsedMs);
  elements["capture-timer-remaining"].textContent = `${formatClockMs(remainingMs).slice(0, -4)} remaining`;
  elements["audio-meter-fill"].style.width = `${Math.round(level * 100)}%`;
  const progressClockMs = waitingForAudio ? waitingMs : elapsedMs;
  const deltaMs = Math.max(0, progressClockMs - state.captureLastElapsedMs);
  state.captureLastElapsedMs = progressClockMs;
  if (level >= 0.015) {
    state.captureAudioDetected = true;
    state.captureSilentElapsedMs = 0;
    setCapability("capability-tab-audio", "Shared tab audio received", "good");
  } else if (!state.captureAudioDetected) {
    state.captureSilentElapsedMs += deltaMs;
    if (state.captureSilentElapsedMs >= 10_000) {
      setCapability("capability-tab-audio", "No audible samples yet", "warning");
      showCaptureAlert("No audible tab audio has been detected. Verify that the movie is playing and tab audio sharing was enabled.");
      state.captureAudioDetected = true;
    }
  }
}

function handleCaptureStatus({
  state: captureState,
  reason,
  message,
  warning,
  armed = false,
  waitingMs = 0,
}) {
  elements["capture-status"].textContent = captureState === "stopped" ? "Processing queue" : message;
  if (captureState === "capturing" && armed) {
    state.captureLastElapsedMs = 0;
    if (state.captionPackage) {
      state.captionPackage.settings.captureLeadInDiscardedMs = Math.max(
        0,
        Math.round(Number(waitingMs) || 0),
      );
    }
  }
  if (warning) showCaptureAlert(message);
  if (captureState !== "stopped") return;
  state.captureEnded = true;
  state.captureStopReason = reason;
  elements["stop-capture"].disabled = true;
  if (state.project) state.project.status = "transcribing";
  if (reason !== "limit") {
    showCaptureAlert(`${message} Saved captions remain recoverable; unprocessed audio is gone.`);
  }
  maybeFinalizeCapture();
}

async function maybeFinalizeCapture() {
  if (!state.captureEnded || state.captureQueue.size || state.pendingFingerprintJobs) return;
  state.project.status = state.captureStopReason === "error" ? "interrupted" : "ready";
  state.project.package = state.captionPackage;
  await saveCurrentProject().catch((error) => showCaptureAlert(error.message));
  elements["capture-status"].textContent = state.captureStopReason === "limit" ? "Complete" : "Partial capture";
  elements["download-capture-package"].disabled = false;
  updateExportButtons();
  await refreshProjects();
  if (state.captureStopReason === "limit") {
    downloadPackage({ automatic: true });
    announce("Capture complete. The Caption Relay package download was started and remains available manually.");
  }
}

function updateQueueStatus() {
  const queue = state.captureQueue;
  const pending = queue.pending.length;
  const active = queue.active ? 1 : 0;
  elements["transcription-queue-status"].textContent = `${pending} queued · ${active} working${state.droppedCaptureChunks ? ` · ${state.droppedCaptureChunks} discarded` : ""}`;
}

function handleFingerprintWorkerMessage({ data }) {
  if (data.type === "fingerprint-result") {
    const job = state.fingerprintJobs.get(data.jobId);
    if (!job) return;
    state.fingerprintJobs.delete(data.jobId);
    if (job.kind === "capture") {
      state.pendingFingerprintJobs = Math.max(0, state.pendingFingerprintJobs - 1);
      state.captionPackage.sync.fingerprints.push(...data.fingerprints);
      state.captionPackage.sync.fingerprints.sort((left, right) => left.timeMs - right.timeMs);
      maybeFinalizeCapture();
    }
    return;
  }
  if (data.type === "fingerprint-match") {
    state.displaySyncJobPending = false;
    const job = state.fingerprintJobs.get(data.jobId);
    state.fingerprintJobs.delete(data.jobId);
    const observedAtMs = (job?.observedAtMs ?? performance.now())
      + Number(data.queryStartTimeMs ?? 0);
    if (data.result?.match) {
      applySyncMatch({
        movieTimeMs: data.result.match.timeMs,
        confidence: data.result.confidence,
        observedAtMs,
      });
    } else {
      applyNoSyncObservation(observedAtMs);
    }
    return;
  }
  if (data.type === "fingerprint-error") {
    state.displaySyncJobPending = false;
    const job = state.fingerprintJobs.get(data.jobId);
    state.fingerprintJobs.delete(data.jobId);
    if (job?.kind === "capture") {
      state.pendingFingerprintJobs = Math.max(0, state.pendingFingerprintJobs - 1);
      maybeFinalizeCapture();
    } else {
      applyNoSyncObservation();
    }
  }
}

function applyTimelineCorrection() {
  try {
    const correction = {
      offsetMs: Number(elements["timeline-offset"].value),
      scale: Number(elements["timeline-scale"].value),
    };
    state.captionPackage.cues = applyTimelineCorrectionToCues(state.captionPackage.cues, correction);
    state.captionPackage.sync.fingerprints = applyTimelineCorrectionToFingerprints(
      state.captionPackage.sync.fingerprints,
      correction,
    );
    scheduleSave();
    renderAllCaptionViews();
    announce("Global timeline correction applied.");
  } catch (error) {
    showCaptureAlert(error.message);
  }
}

async function importCaptionFile(file, destination) {
  if (!file) return;
  try {
    if (!await prepareProjectTransition()) return;
    if (file.size > 25 * 1024 * 1024) throw new RangeError("Caption imports are limited to 25 MB.");
    const text = await file.text();
    const format = detectCaptionFileFormat(file.name, text);
    let captionPackage;
    if (format === "package") {
      captionPackage = parseCaptionPackage(text);
    } else {
      const cues = format === "srt" ? parseSrt(text) : parseVtt(text);
      captionPackage = createCaptionPackage({
        title: file.name.replace(/\.(?:srt|vtt)$/i, ""),
        originalDurationMs: cues.at(-1)?.endMs ?? 0,
        capturePlaybackRate: 1,
        transcriptionModel: {
          id: "imported-standard-captions",
          runtime: "none",
          revision: "",
          license: "",
        },
        cues,
        sync: { mode: "text", fingerprints: [], textIndexVersion: 1 },
      });
    }
    await loadPackageIntoProject(captionPackage, file.name);
    if (destination === "display") configureDisplayPackage();
    showStage(destination);
    announce(`${captionPackage.cues.length} captions loaded safely.`);
  } catch (error) {
    reportError(error);
  } finally {
    if (destination === "display") elements["display-import"].value = "";
    else elements["translation-import"].value = "";
  }
}

async function loadPackageIntoProject(captionPackage, fallbackName) {
  state.captionPackage = validateCaptionPackage(captionPackage);
  const now = new Date().toISOString();
  state.project = {
    id: createProjectId(),
    name: state.captionPackage.title || fallbackName || "Caption Relay project",
    status: state.captionPackage.cues.some((cue) => cue.translations?.vi) ? "translated" : "ready",
    createdAt: now,
    updatedAt: now,
    package: state.captionPackage,
  };
  elements["capture-title"].value = state.captionPackage.title;
  elements["capture-duration"].value = formatClockMs(state.captionPackage.originalDurationMs).slice(0, -4);
  elements["capture-rate"].value = String(state.captionPackage.capturePlaybackRate);
  const modelId = state.captionPackage.transcriptionModel?.id;
  if (modelId === "onnx-community/whisper-tiny.en") {
    elements["transcription-model"].value = "tiny";
  } else if (modelId === "Xenova/whisper-small.en") {
    elements["transcription-model"].value = "small";
  }
  applyProjectPreferencesToForm(state.captionPackage.settings);
  await saveCurrentProject();
  await refreshProjects();
  state.cuePage = 0;
  renderAllCaptionViews();
  updateExportButtons();
}

async function prepareTranslationAdapter() {
  elements["prepare-translation-model"].disabled = true;
  elements["translation-model-progress"].value = 0;
  let builtInFailure = null;
  if ("Translator" in globalThis) {
    try {
      const options = { sourceLanguage: "en", targetLanguage: "vi" };
      const availability = await Translator.availability(options);
      if (availability !== "unavailable") {
        elements["translation-model-status"].textContent = `Chrome Translator API · ${availability}`;
        const translator = await Translator.create({
          ...options,
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", (event) => {
              elements["translation-model-progress"].value = event.loaded;
              elements["translation-model-status"].textContent = `Downloading Chrome English → Vietnamese language pack · ${Math.round(event.loaded * 100)}%`;
            });
          },
        });
        state.translationAdapter = (text) => translator.translate(text);
        state.translationAdapterName = "Chrome Translator API";
        elements["translation-model-progress"].value = 1;
        elements["translation-model-status"].textContent = "Chrome desktop Translator API ready · English → Vietnamese stays local.";
        finishTranslationPreparation();
        return;
      }
    } catch (error) {
      builtInFailure = error;
      elements["translation-model-status"].textContent = `Chrome Translator API unavailable (${error.message}); preparing OPUS-MT fallback…`;
    }
  }
  try {
    if (!state.translationWorker) throw builtInFailure ?? new Error("Translation worker is unavailable.");
    state.translationWorker.postMessage({ type: "prepare" });
    if (!builtInFailure) elements["translation-model-status"].textContent = "Preparing local OPUS-MT fallback…";
  } catch (error) {
    settleModelWaiters(translationModelWaiters, error);
    elements["prepare-translation-model"].disabled = false;
    elements["translation-model-status"].textContent = `Translation model failure · ${error.message}`;
  }
}

function handleTranslationWorkerMessage({ data }) {
  if (data.type === "translation-model-progress") {
    elements["translation-model-progress"].value = data.progress;
    elements["translation-model-status"].textContent = data.text;
    return;
  }
  if (data.type === "translation-model-ready") {
    state.translationWorkerReady = true;
    state.translationAdapterName = data.model.label;
    state.translationAdapter = translateWithWorker;
    elements["translation-model-progress"].value = 1;
    elements["translation-model-status"].textContent = `${data.model.label} ready via ${data.device.toUpperCase()} · ${data.runtime} · ${data.model.license}`;
    finishTranslationPreparation();
    return;
  }
  if (["translation-result", "translation-error"].includes(data.type)) {
    const pending = state.translationJobs.get(data.jobId);
    if (!pending) {
      if (data.type === "translation-error") {
        settleModelWaiters(
          translationModelWaiters,
          new Error(String(data.message || "Translation model preparation failed.")),
        );
        elements["prepare-translation-model"].disabled = false;
        elements["translation-model-status"].textContent = `Translation model failure · ${data.message}`;
      }
      return;
    }
    state.translationJobs.delete(data.jobId);
    if (data.type === "translation-result") pending.resolve(data.text);
    else pending.reject(new Error(data.message));
  }
}

function finishTranslationPreparation() {
  settleModelWaiters(translationModelWaiters, null, {
    name: state.translationAdapterName,
  });
  elements["prepare-translation-model"].disabled = false;
  elements["translate-all"].disabled = !state.captionPackage?.cues.length;
  elements["retry-failed-translations"].disabled = false;
  announce("Local translation is ready.");
}

function translateWithWorker(text) {
  return new Promise((resolve, reject) => {
    const jobId = createJobId("translation");
    state.translationJobs.set(jobId, { resolve, reject });
    state.translationWorker.postMessage({ type: "translate", jobId, text });
  });
}

async function runTranslation(
  retryFailedOnly,
  {
    cueIds = null,
    signal = null,
    throwOnError = false,
  } = {},
) {
  if (!state.captionPackage?.cues.length || !state.translationAdapter) return;
  const selectedCueIds = cueIds ? new Set(cueIds) : null;
  if (selectedCueIds) {
    const knownCueIds = new Set(state.captionPackage.cues.map((cue) => cue.id));
    const missingCueId = [...selectedCueIds].find((cueId) => !knownCueIds.has(cueId));
    if (missingCueId) throw new Error(`Caption cue not found: ${missingCueId}.`);
    retryFailedOnly = true;
  }
  state.translationPaused = false;
  state.translationRunning = true;
  elements["translate-all"].disabled = true;
  elements["pause-translation"].disabled = false;
  elements["pause-translation"].textContent = "Pause";
  try {
    const glossary = state.captionPackage.glossary;
    const previousCues = selectedCueIds
      ? state.captionPackage.cues.map((cue) => (
        selectedCueIds.has(cue.id)
          ? { ...cue, translationStatus: "failed" }
          : cue
      ))
      : state.captionPackage.cues;
    state.captionPackage.cues = await translateCaptionCues(
      state.captionPackage.cues,
      translateWithSelectedMode,
      {
        glossary,
        previousCues,
        retryFailedOnly,
        shouldPause: () => state.translationPaused,
        waitUntilResumed: () => waitUntilTranslationResumed(signal),
        shouldAbort: () => Boolean(signal?.aborted),
        onCue: ({ cue, index }) => {
          state.captionPackage.cues[index] = cue;
        },
        onProgress: ({ completed, total }) => {
          updateTranslationProgress(completed, total);
          if (completed % 5 === 0) scheduleSave();
          renderTranslationRows();
        },
      },
    );
    state.project.status = "translated";
    await saveCurrentProject();
    announce(`Translation pass complete with ${state.translationAdapterName}.`);
  } catch (error) {
    reportError(error);
    await saveCurrentProject().catch(() => {});
    if (throwOnError) throw error;
  } finally {
    elements["translate-all"].disabled = false;
    elements["pause-translation"].disabled = true;
    state.translationPaused = false;
    state.translationRunning = false;
    updateTranslationProgressFromCues();
    renderAllCaptionViews();
    updateExportButtons();
  }
}

function toggleTranslationPause() {
  state.translationPaused = !state.translationPaused;
  elements["pause-translation"].textContent = state.translationPaused ? "Resume" : "Pause";
  if (!state.translationPaused) {
    state.translationResumeWaiters.splice(0).forEach((resolve) => resolve());
  }
}

function waitUntilTranslationResumed(signal = null) {
  if (!state.translationPaused) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const resume = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      const index = state.translationResumeWaiters.indexOf(resume);
      if (index >= 0) state.translationResumeWaiters.splice(index, 1);
      const error = new Error("Translation was cancelled.");
      error.name = "AbortError";
      reject(error);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    state.translationResumeWaiters.push(resume);
  });
}

function updateTranslationProgress(completed, total) {
  elements["translation-progress"].value = total ? completed / total : 0;
  elements["translation-progress-label"].textContent = `${completed} / ${total} cues`;
}

function updateTranslationProgressFromCues() {
  const progress = countTranslationProgress(state.captionPackage?.cues ?? []);
  updateTranslationProgress(progress.completed + progress.failed, progress.total);
  elements["translation-failure-count"].textContent = `${progress.failed} failed`;
}

function replaceTranslations() {
  if (!state.captionPackage) return;
  state.captionPackage.cues = searchAndReplaceTranslations(
    state.captionPackage.cues,
    elements["translation-search"].value,
    elements["translation-replacement"].value,
  );
  scheduleSave();
  renderTranslationRows();
  announce("Vietnamese search and replace applied.");
}

function addGlossaryEntry() {
  if (!state.captionPackage) {
    reportError(new Error("Load a caption project first."));
    return;
  }
  state.captionPackage.glossary.push({ source: "", target: "" });
  renderGlossary();
  const inputs = elements["glossary-rows"].querySelectorAll("input");
  inputs[inputs.length - 2]?.focus();
}

function updateGlossaryEntry(event) {
  const input = event.target.closest("[data-glossary-index][data-glossary-field]");
  if (!input || !state.captionPackage) return;
  state.captionPackage.glossary[Number(input.dataset.glossaryIndex)][input.dataset.glossaryField] = input.value;
  scheduleSave();
}

function removeGlossaryEntry(event) {
  const button = event.target.closest("[data-remove-glossary]");
  if (!button || !state.captionPackage) return;
  state.captionPackage.glossary.splice(Number(button.dataset.removeGlossary), 1);
  scheduleSave();
  renderGlossary();
}

async function handleTranslationRetry(event) {
  const button = event.target.closest("[data-retry-cue]");
  if (!button || !state.translationAdapter) return;
  const cueIndex = state.captionPackage.cues.findIndex(
    (candidate) => candidate.id === button.dataset.retryCue,
  );
  if (cueIndex < 0) return;
  const cue = state.captionPackage.cues[cueIndex];
  button.disabled = true;
  try {
    state.captionPackage.cues[cueIndex] = await regenerateCaptionCue(
      cue,
      translateWithSelectedMode,
      { glossary: state.captionPackage.glossary },
    );
    await saveCurrentProject();
  } catch (error) {
    cue.translationStatus = "failed";
    cue.translationError = error.message;
    await saveCurrentProject().catch(() => {});
  }
  renderTranslationRows();
  updateTranslationProgressFromCues();
}

async function translateWithSelectedMode(text, cue) {
  if (elements["translation-mode"].value !== "literal") {
    return state.translationAdapter(text, cue);
  }
  const parts = String(text).split(/([,;:—–]+)/);
  const translated = [];
  for (const part of parts) {
    if (!part) continue;
    if (/^[,;:—–]+$/.test(part)) {
      translated.push(part);
    } else if (part.trim()) {
      translated.push(await state.translationAdapter(part.trim(), cue));
    }
  }
  return translated.join(" ")
    .replace(/\s+([,;:])/g, "$1")
    .replace(/([—–])\s+/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

async function openCaptionOverlay() {
  try {
    const mode = await state.overlay.open();
    state.overlay.applySettings(state.overlaySettings);
    elements["connect-movie-audio"].disabled = false;
    startDisplayClock();
    announce(mode === "document-picture-in-picture"
      ? "Always-on-top caption overlay opened."
      : "Document Picture-in-Picture is unavailable; popup overlay opened.");
  } catch (error) {
    if (error instanceof CaptionOverlaySupersededError) return;
    reportError(error);
  }
}

async function connectMovieAudio() {
  if (!state.captionPackage) return;
  try {
    await stopDisplayCapture();
    prepareDisplaySynchronization();
    state.displayCapture = createDisplayCapture();
    const capturePromise = state.displayCapture.start({ captureDurationMs: Infinity });
    if (!usesFingerprintSynchronization() && !state.transcriptionModelReady) {
      elements["transcription-model"].value = "tiny";
      prepareTranscriptionModel();
    }
    state.syncEngine.start(performance.now());
    renderSynchronizationState(state.syncEngine.snapshot(performance.now()));
    await capturePromise;
    announce("Movie audio connected. Return to the movie and press play.");
  } catch (error) {
    state.syncEngine.fail(error.message);
    renderSynchronizationState(state.syncEngine.snapshot(performance.now()));
    reportError(error);
  }
}

function createDisplayCapture() {
  const fingerprintMode = usesFingerprintSynchronization();
  return new CaptionCaptureSession({
    chunkSeconds: fingerprintMode ? 6 : 10,
    overlapSeconds: fingerprintMode ? 3 : 3,
    onChunk: handleDisplayAudioChunk,
    onProgress: () => updateDisplayedCaption(performance.now()),
    onStatus: ({ state: captureState, reason }) => {
      if (captureState === "stopped" && reason !== "manual") {
        state.syncEngine.fail("Movie audio sharing stopped.");
        renderSynchronizationState(state.syncEngine.snapshot(performance.now()));
      }
    },
  });
}

function prepareDisplaySynchronization() {
  state.displayTextIndex = buildTextSynchronizationIndex(state.captionPackage.cues);
  state.displaySyncJobPending = false;
  state.displayContradictoryObservations = 0;
  state.syncEngine.reset();
  if (usesFingerprintSynchronization()) {
    state.fingerprintWorker.postMessage({
      type: "set-reference",
      fingerprints: state.captionPackage.sync.fingerprints,
    });
  } else if (!state.transcriptionModelReady) {
    elements["sync-message"].textContent = "Text synchronization needs local English recognition. Connect Movie Audio to prepare it explicitly.";
  }
}

function usesFingerprintSynchronization() {
  return state.captionPackage?.capturePlaybackRate === 1
    && state.captionPackage?.sync?.mode !== "text"
    && state.captionPackage?.sync?.fingerprints?.length >= 2;
}

function handleDisplayAudioChunk(chunk) {
  if (state.displaySyncJobPending || !state.captionPackage) return;
  state.displaySyncJobPending = true;
  const receivedAtMs = performance.now();
  const observedAtMs = receivedAtMs - Math.max(0, chunk.endMs - chunk.startMs);
  const predictedMs = state.syncEngine.estimatedMovieTimeMs(observedAtMs);
  if (usesFingerprintSynchronization()) {
    const jobId = createJobId("fingerprint-match");
    state.fingerprintJobs.set(jobId, { kind: "display", observedAtMs });
    state.fingerprintWorker.postMessage({
      type: "match",
      jobId,
      samples: chunk.samples.buffer,
      sampleRate: chunk.sampleRate,
      predictedMs,
    }, [chunk.samples.buffer]);
    return;
  }
  if (!state.transcriptionModelReady) {
    state.displaySyncJobPending = false;
    return;
  }
  const jobId = createJobId("sync-speech");
  state.speechJobs.set(jobId, { kind: "display", observedAtMs });
  state.transcriptionWorker.postMessage({
    type: "transcribe",
    jobId,
    samples: chunk.samples.buffer,
    sampleRate: chunk.sampleRate,
    speechRatio: chunk.speechRatio,
  }, [chunk.samples.buffer]);
}

function handleDisplayTranscriptionResult(job, data) {
  state.displaySyncJobPending = false;
  const recognized = String(data.result?.text ?? "").trim();
  const predictedMs = state.syncEngine.estimatedMovieTimeMs(job.observedAtMs);
  const result = findTranscriptMatch(recognized, state.displayTextIndex, { predictedMs });
  if (!result.match) {
    if (isDistinctivePhrase(recognized)) {
      applyContradictorySyncObservation(job.observedAtMs);
    } else {
      applyNoSyncObservation(job.observedAtMs);
    }
    return;
  }
  const queryOffsetMs = Math.max(
    0,
    Number(data.result?.chunks?.[0]?.timestamp?.[0] ?? 0) * 1000,
  );
  applySyncMatch({
    movieTimeMs: result.match.startMs,
    confidence: result.confidence,
    observedAtMs: job.observedAtMs + queryOffsetMs,
    isCommonPhrase: !isDistinctivePhrase(recognized),
  });
}

function applySyncMatch(match) {
  state.displayContradictoryObservations = 0;
  const snapshot = state.syncEngine.ingestMatch({
    ...match,
    playbackRate: Number(elements["display-playback-rate"].value),
  });
  renderSynchronizationState(snapshot);
  updateDisplayedCaption(performance.now());
}

function applyNoSyncObservation(observedAtMs = performance.now()) {
  const snapshot = state.syncEngine.observeNoMatch(observedAtMs);
  renderSynchronizationState(snapshot);
  updateDisplayedCaption(performance.now());
}

function applyContradictorySyncObservation(observedAtMs = performance.now()) {
  state.displayContradictoryObservations = Math.min(
    CONTRADICTORY_OBSERVATIONS_REQUIRED,
    state.displayContradictoryObservations + 1,
  );
  const snapshot = state.displayContradictoryObservations >= CONTRADICTORY_OBSERVATIONS_REQUIRED
    ? state.syncEngine.rejectMatch(observedAtMs)
    : state.syncEngine.observeNoMatch(observedAtMs);
  renderSynchronizationState(snapshot);
  updateDisplayedCaption(performance.now());
}

function startDisplayClock() {
  state.displayClock.start();
}

function stopDisplayClock() {
  state.displayClock.stop();
}

function handleOverlayClosed() {
  if (!state.mirror?.stream) stopDisplayClock();
}

function updateDisplayedCaption(now) {
  const snapshot = state.syncEngine.tick(now);
  const cues = snapshot.showCaptions
    ? findActiveCues(state.captionPackage?.cues ?? [], snapshot.movieTimeMs)
    : [];
  const sourceText = cues.map((cue) => cue.sourceText).join("\n");
  const translatedText = cues.map((cue) => cue.translations?.vi ?? "").filter(Boolean).join("\n");
  const visible = snapshot.showCaptions && Boolean(translatedText);
  const status = snapshot.showCaptions
    ? `${humanizeSyncState(snapshot.state)} · ${Math.round(snapshot.confidence * 100)}%`
    : "No matching video detected";
  state.overlay.update({
    sourceText,
    translatedText,
    status,
    visible,
    matched: snapshot.showCaptions,
  });
  state.mirror.updateCaption(sourceText, translatedText, {
    bilingual: state.overlaySettings.bilingual,
    visible,
  });
  renderSynchronizationState(snapshot);
}

function renderSynchronizationState(snapshot) {
  elements["sync-state"].textContent = humanizeSyncState(snapshot.state);
  elements["sync-confidence"].textContent = `${Math.round(snapshot.confidence * 100)}%`;
  elements["sync-confidence-fill"].style.width = `${Math.round(snapshot.confidence * 100)}%`;
  elements["detected-movie-time"].textContent = formatClockMs(snapshot.movieTimeMs);
  elements["sync-message"].textContent = snapshot.showCaptions
    ? "Matching video detected · captions locked"
    : snapshot.error || "No matching video detected";
}

function configureDisplayPackage() {
  renderDisplayPackageSummary();
  prepareDisplaySynchronization();
}

function renderDisplayPackageSummary() {
  elements["display-package-name"].textContent = `${state.captionPackage.title || "Untitled"} · ${state.captionPackage.cues.length} cues · ${usesFingerprintSynchronization() ? "fingerprint" : "text"} sync`;
  elements["open-caption-overlay"].disabled = !state.captionPackage.cues.some((cue) => cue.translations?.vi);
  elements["start-mirror-mode"].disabled = false;
}

function resynchronize() {
  state.syncEngine.resynchronize();
  renderSynchronizationState(state.syncEngine.snapshot(performance.now()));
}

function setManualMovieTime() {
  try {
    state.syncEngine.setCurrentMovieTime(parseClockValue(elements["manual-movie-time"].value), performance.now());
    updateDisplayedCaption(performance.now());
  } catch (error) {
    reportError(error);
  }
}

function toggleCaptionClock() {
  const now = performance.now();
  if (state.syncEngine.state === "paused") {
    state.syncEngine.resume(now);
    elements["pause-caption-clock"].textContent = "Pause caption clock";
  } else {
    state.syncEngine.pause(now);
    elements["pause-caption-clock"].textContent = "Resume caption clock";
  }
  updateDisplayedCaption(now);
}

function resetSynchronization() {
  state.syncEngine.reset();
  renderSynchronizationState(state.syncEngine.snapshot(performance.now()));
  updateDisplayedCaption(performance.now());
}

async function startMirrorMode() {
  try {
    await stopDisplayCapture();
    const stream = await state.mirror.connect();
    prepareDisplaySynchronization();
    state.displayCapture = createDisplayCapture();
    state.syncEngine.start(performance.now());
    if (!usesFingerprintSynchronization() && !state.transcriptionModelReady) {
      elements["transcription-model"].value = "tiny";
      prepareTranscriptionModel();
    }
    await state.displayCapture.start({
      captureDurationMs: Infinity,
      includeVideo: true,
      providedStream: stream,
    });
    elements["fullscreen-mirror"].disabled = false;
    startDisplayClock();
    announce("Mirror Mode connected. Mirrored audio is muted by default to avoid duplication.");
  } catch (error) {
    reportError(error);
  }
}

async function stopDisplayCapture() {
  await state.displayCapture?.stop({ reason: "manual" }).catch(() => {});
  state.displayCapture = null;
}

function applyOverlaySettingsFromForm() {
  state.overlaySettings = {
    fontFamily: elements["overlay-font"].value,
    fontSizePx: Number(elements["overlay-size"].value),
    color: elements["overlay-color"].value,
    background: `${elements["overlay-background"].value}d6`,
    verticalPlacement: elements["overlay-placement"].value,
    bilingual: elements["overlay-bilingual"].checked,
  };
  state.overlay.applySettings(state.overlaySettings);
  elements["relay-mirror-caption"].style.fontFamily = state.overlaySettings.fontFamily;
  elements["relay-mirror-caption"].style.fontSize = `${state.overlaySettings.fontSizePx}px`;
  elements["relay-mirror-caption"].style.color = state.overlaySettings.color;
  elements["relay-mirror-caption"].style.background = state.overlaySettings.background;
  elements["relay-mirror"].dataset.placement = state.overlaySettings.verticalPlacement;
  saveCaptionRelaySettings({ overlay: state.overlaySettings }).catch(() => {});
}

async function restoreSettings() {
  try {
    const settings = await getCaptionRelaySettings();
    state.overlaySettings = { ...DEFAULT_OVERLAY_SETTINGS, ...settings?.overlay };
    elements["overlay-font"].value = state.overlaySettings.fontFamily;
    elements["overlay-size"].value = state.overlaySettings.fontSizePx;
    elements["overlay-color"].value = state.overlaySettings.color;
    elements["overlay-background"].value = state.overlaySettings.background.slice(0, 7);
    elements["overlay-placement"].value = state.overlaySettings.verticalPlacement;
    elements["overlay-bilingual"].checked = state.overlaySettings.bilingual;
    applyOverlaySettingsFromForm();
  } catch {
    // Storage capability panel already communicates unavailable persistence.
  }
}

function renderAllCaptionViews() {
  renderEnglishRows();
  renderTranslationRows();
  renderGlossary();
  updateTranslationProgressFromCues();
  updateExportButtons();
}

function renderEnglishRows() {
  const cues = state.captionPackage?.cues ?? [];
  const pageCues = getPageCues(cues);
  elements["english-cue-count"].textContent = `${cues.length} ${cues.length === 1 ? "cue" : "cues"}`;
  if (!pageCues.length) {
    elements["english-caption-rows"].replaceChildren(emptyTableRow(3, "Captured captions will appear here."));
  } else {
    elements["english-caption-rows"].replaceChildren(...pageCues.map((cue) => {
      const row = document.createElement("tr");
      const time = document.createElement("td");
      time.append(createCueTime(cue));
      const textCell = document.createElement("td");
      const textarea = document.createElement("textarea");
      textarea.value = cue.sourceText;
      textarea.dataset.cueId = cue.id;
      textarea.dataset.captionLanguage = "source";
      textarea.setAttribute("aria-label", `English caption at ${formatClockMs(cue.startMs)}`);
      textCell.append(textarea);
      const quality = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `relay-quality${cue.incomplete || (cue.confidence !== null && cue.confidence < .5) ? " is-warning" : ""}`;
      badge.textContent = cue.incomplete ? "Incomplete" : cue.confidence === null ? "Review" : `${Math.round(cue.confidence * 100)}%`;
      quality.append(badge);
      row.append(time, textCell, quality);
      return row;
    }));
  }
  updatePagination(cues.length);
}

function renderTranslationRows() {
  const cues = state.captionPackage?.cues ?? [];
  const pageCues = getPageCues(cues);
  if (!pageCues.length) {
    elements["translation-caption-rows"].replaceChildren(emptyTableRow(4, "Load captions to begin translation."));
    updatePagination(cues.length);
    return;
  }
  elements["translation-caption-rows"].replaceChildren(...pageCues.map((cue) => {
    const row = document.createElement("tr");
    const time = document.createElement("td");
    time.append(createCueTime(cue));
    const source = document.createElement("td");
    source.textContent = cue.sourceText;
    const target = document.createElement("td");
    const textarea = document.createElement("textarea");
    textarea.value = cue.translations?.vi ?? "";
    textarea.dataset.cueId = cue.id;
    textarea.dataset.captionLanguage = "vi";
    textarea.setAttribute("aria-label", `Vietnamese caption at ${formatClockMs(cue.startMs)}`);
    target.append(textarea);
    if (cue.translationStatus === "failed") {
      const error = document.createElement("small");
      error.className = "relay-translation-status is-failed";
      error.textContent = cue.translationError || "Translation failed";
      target.append(error);
    }
    const action = document.createElement("td");
    const retry = document.createElement("button");
    retry.className = "button button-quiet";
    retry.type = "button";
    retry.dataset.retryCue = cue.id;
    retry.textContent = "Regenerate";
    retry.disabled = !state.translationAdapter;
    action.append(retry);
    row.append(time, source, target, action);
    return row;
  }));
  updatePagination(cues.length);
}

function renderGlossary() {
  const glossary = state.captionPackage?.glossary ?? [];
  if (!glossary.length) {
    const empty = document.createElement("p");
    empty.className = "relay-empty";
    empty.textContent = "No glossary entries yet.";
    elements["glossary-rows"].replaceChildren(empty);
    return;
  }
  elements["glossary-rows"].replaceChildren(...glossary.map((entry, index) => {
    const row = document.createElement("div");
    row.className = "relay-glossary-row";
    const source = document.createElement("input");
    source.value = entry.source;
    source.placeholder = "English term";
    source.dataset.glossaryIndex = index;
    source.dataset.glossaryField = "source";
    const target = document.createElement("input");
    target.value = entry.target;
    target.placeholder = "Preferred Vietnamese";
    target.dataset.glossaryIndex = index;
    target.dataset.glossaryField = "target";
    const remove = document.createElement("button");
    remove.className = "relay-icon-button";
    remove.type = "button";
    remove.dataset.removeGlossary = index;
    remove.setAttribute("aria-label", `Remove glossary entry ${index + 1}`);
    remove.textContent = "×";
    row.append(source, target, remove);
    return row;
  }));
}

function handleCaptionEdit(event) {
  const input = event.target.closest("[data-cue-id][data-caption-language]");
  if (!input || !state.captionPackage) return;
  const cue = state.captionPackage.cues.find((candidate) => candidate.id === input.dataset.cueId);
  if (!cue) return;
  if (input.dataset.captionLanguage === "source") {
    cue.sourceText = input.value;
    state.displayTextIndex = buildTextSynchronizationIndex(state.captionPackage.cues);
  } else {
    cue.translations.vi = input.value;
    cue.translationStatus = "translated";
  }
  scheduleSave();
}

function createCueTime(cue) {
  const wrap = document.createElement("span");
  wrap.className = "relay-cue-time";
  const start = document.createElement("strong");
  start.textContent = formatClockMs(cue.startMs);
  const end = document.createElement("span");
  end.textContent = `→ ${formatClockMs(cue.endMs)}`;
  wrap.append(start, end);
  return wrap;
}

function emptyTableRow(columnCount, text) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columnCount;
  cell.className = "relay-empty";
  cell.textContent = text;
  row.append(cell);
  return row;
}

function getPageCues(cues) {
  const pageCount = Math.max(1, Math.ceil(cues.length / PAGE_SIZE));
  state.cuePage = Math.min(state.cuePage, pageCount - 1);
  return cues.slice(state.cuePage * PAGE_SIZE, (state.cuePage + 1) * PAGE_SIZE);
}

function changeCuePage(delta) {
  const pageCount = Math.max(1, Math.ceil((state.captionPackage?.cues.length ?? 0) / PAGE_SIZE));
  state.cuePage = Math.min(pageCount - 1, Math.max(0, state.cuePage + delta));
  renderEnglishRows();
  renderTranslationRows();
}

function updatePagination(cueCount) {
  const pageCount = Math.max(1, Math.ceil(cueCount / PAGE_SIZE));
  [
    ["cue-page-previous", "cue-page-status", "cue-page-next"],
    ["translation-cue-page-previous", "translation-cue-page-status", "translation-cue-page-next"],
  ].forEach(([previousId, statusId, nextId]) => {
    elements[statusId].textContent = `Page ${state.cuePage + 1} of ${pageCount}`;
    elements[previousId].disabled = state.cuePage <= 0;
    elements[nextId].disabled = state.cuePage >= pageCount - 1;
  });
}

function updateExportButtons() {
  const hasPackage = Boolean(state.captionPackage);
  const hasCues = Boolean(state.captionPackage?.cues.length);
  const hasVietnamese = Boolean(state.captionPackage?.cues.some((cue) => cue.translations?.vi));
  elements["download-capture-package"].disabled = !hasPackage;
  elements["translate-all"].disabled = !hasCues || !state.translationAdapter;
  [
    "download-vietnamese-vtt",
    "download-vietnamese-srt",
    "download-bilingual-vtt",
    "download-updated-package",
  ].forEach((id) => {
    elements[id].disabled = id === "download-updated-package" ? !hasPackage : !hasVietnamese;
  });
  elements["open-caption-overlay"].disabled = !hasVietnamese;
  elements["start-mirror-mode"].disabled = !hasVietnamese;
}

function persistProjectPreferences() {
  if (!state.captionPackage) return;
  state.captionPackage.settings = {
    ...state.captionPackage.settings,
    ...readProjectPreferences(),
  };
  scheduleSave();
}

function readProjectPreferences() {
  return {
    translationMode: elements["translation-mode"].value,
    pronounPreference: elements["pronoun-preference"].value.trim(),
  };
}

function applyProjectPreferencesToForm(settings = {}) {
  elements["translation-mode"].value = settings.translationMode ?? "natural";
  elements["pronoun-preference"].value = settings.pronounPreference ?? "";
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  elements["relay-save-status"].textContent = "Saving locally…";
  state.saveTimer = setTimeout(() => {
    saveCurrentProject().catch((error) => reportError(error));
  }, SAVE_DELAY_MS);
}

async function saveCurrentProject() {
  if (!state.project || !state.captionPackage) return;
  state.captionPackage = validateCaptionPackage(state.captionPackage);
  state.project.package = state.captionPackage;
  state.project.updatedAt = new Date().toISOString();
  await saveCaptionProject(state.project);
  elements["relay-save-status"].textContent = "Saved locally";
}

async function refreshProjects() {
  try {
    const projects = await listCaptionProjects();
    state.projects = [];
    for (const project of projects) {
      const recovered = recoverInterruptedProject(project);
      if (recovered.status !== project.status) await saveCaptionProject(recovered);
      state.projects.push(recovered);
    }
    elements["project-list"].replaceChildren(...state.projects.map((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = `${project.status === "interrupted" ? "⚠ " : ""}${project.name} · ${project.package?.cues?.length ?? 0} cues`;
      return option;
    }));
    if (state.project) elements["project-list"].value = state.project.id;
  } catch (error) {
    elements["relay-save-status"].textContent = "Local storage unavailable";
    announce(error.message);
  }
}

function setProjectDrawerOpen(open) {
  elements["project-drawer"].hidden = !open;
  elements["open-project-drawer"].setAttribute("aria-expanded", String(open));
  if (open) refreshCapabilities();
}

async function resumeSelectedProject() {
  if (!await prepareProjectTransition()) return;
  const project = await selectedProject();
  if (!project) return;
  state.project = project;
  state.captionPackage = project.package;
  applyProjectPreferencesToForm(state.captionPackage.settings);
  elements["capture-title"].value = state.captionPackage.title;
  elements["capture-duration"].value = formatClockMs(state.captionPackage.originalDurationMs).slice(0, -4);
  elements["capture-rate"].value = String(state.captionPackage.capturePlaybackRate);
  updateCaptureCalculation();
  renderAllCaptionViews();
  updateExportButtons();
  configureDisplayPackage();
  showStage(project.status === "translated" ? "display" : project.package.cues.length ? "translate" : "capture");
  setProjectDrawerOpen(false);
}

async function duplicateSelectedProject() {
  if (!await prepareProjectTransition()) return;
  const project = await selectedProject();
  if (!project) return;
  const duplicated = await duplicateCaptionProject(project);
  await refreshProjects();
  elements["project-list"].value = duplicated.id;
  announce("Project duplicated locally.");
}

async function renameSelectedProject() {
  if (!await prepareProjectTransition()) return;
  const project = await selectedProject();
  if (!project) return;
  const name = prompt("Rename Caption Relay project", project.name);
  if (!name?.trim()) return;
  const renamed = await renameCaptionProject(project, name);
  if (state.project?.id === renamed.id) {
    state.project = renamed;
    state.captionPackage = renamed.package;
    state.captionPackage.title = name.trim();
    state.project.name = name.trim();
    await saveCurrentProject();
  }
  await refreshProjects();
}

async function exportSelectedProject() {
  const project = await selectedProject();
  if (!project?.package) return;
  downloadText(
    serializeCaptionPackage(project.package),
    `${slugify(project.name)}.vpcaptions.json`,
    "application/json",
  );
}

async function deleteSelectedProject() {
  if (!await prepareProjectTransition()) return;
  const project = await selectedProject();
  if (!project || !confirm(`Delete "${project.name}" from this browser? Export it first if needed.`)) return;
  await deleteCaptionProject(project.id);
  if (state.project?.id === project.id) {
    state.project = null;
    state.captionPackage = null;
    renderAllCaptionViews();
  }
  await refreshProjects();
  announce("Local Caption Relay project deleted.");
}

async function prepareProjectTransition() {
  const captureIsActive = ["requesting", "capturing", "stopping"].includes(state.captureSession?.state)
    || state.captureQueue.size > 0
    || state.pendingFingerprintJobs > 0;
  if (captureIsActive) {
    announce("Finish the current capture and wait for its transcription queue before switching projects.");
    return false;
  }
  if (state.translationRunning) {
    announce("Pause or finish the current translation pass before switching projects.");
    return false;
  }
  await stopDisplayCapture();
  state.mirror.disconnect();
  state.syncEngine.reset();
  updateDisplayedCaption(performance.now());
  return true;
}

async function selectedProject() {
  const id = elements["project-list"].value;
  if (!id) {
    announce("Select a local project first.");
    return null;
  }
  return getCaptionProject(id);
}

async function clearCaptionModels() {
  if (["requesting", "capturing", "stopping"].includes(state.captureSession?.state)
    || state.translationRunning
    || state.displayCapture) {
    announce("Stop capture, translation, and movie-audio listening before clearing models.");
    return;
  }
  if (!confirm("Clear downloaded Caption Relay model files? They will need to download again before local inference.")) return;
  try {
    const result = await clearDownloadedCaptionModels();
    elements["model-manager-status"].textContent = result.supported
      ? `${result.removed} cached Caption Relay model files removed.`
      : "This browser does not expose model cache controls.";
    state.transcriptionModelReady = false;
    state.transcriptionWorker?.postMessage({ type: "dispose" });
    state.translationAdapter = null;
    state.translationWorkerReady = false;
    state.translationWorker?.postMessage({ type: "dispose" });
    updateExportButtons();
  } catch (error) {
    reportError(error);
  }
}

function downloadPackage({ automatic = false } = {}) {
  try {
    const captionPackage = requirePackage();
    downloadText(
      serializeCaptionPackage(captionPackage),
      `${packageFilenameBase()}.vpcaptions.json`,
      "application/json",
    );
    if (automatic) elements["relay-save-status"].textContent = "Package saved · automatic download requested";
  } catch (error) {
    reportError(error);
  }
}

function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function requirePackage() {
  if (!state.captionPackage) throw new Error("Load or capture a Caption Relay project first.");
  return validateCaptionPackage(state.captionPackage);
}

function packageFilenameBase() {
  return slugify(state.captionPackage?.title || "caption-relay");
}

function showCaptureAlert(message) {
  elements["capture-alert"].hidden = false;
  elements["capture-alert"].textContent = message;
  announce(message);
}

function reportError(error) {
  announce(String(error?.message ?? error ?? "Caption Relay action failed."));
}

function announce(message) {
  elements["relay-announcements"].textContent = message;
  elements["relay-announcements"].classList.add("is-visible");
  clearTimeout(state.announcementTimer);
  state.announcementTimer = setTimeout(() => {
    elements["relay-announcements"].classList.remove("is-visible");
  }, 4_000);
}

function humanizeSyncState(value) {
  return String(value ?? "idle").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function createJobId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "caption-relay";
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function createCaptionRelayAiController() {
  return {
    getRevision: getCaptionAiRevision,
    getAiSnapshot: getCaptionAiSnapshot,
    previewAiCommands: previewCaptionAiCommands,
    applyAiCommands: queueCaptionAiCommands,
    exportAi: exportCaptionProjectForAi,
  };
}

async function queueCaptionAiCommands(commands, options = {}) {
  await initializationPromise;
  const task = captionAiApplyChain.then(() => {
    throwIfAborted(options.signal);
    if (options.expectedRevision !== undefined) {
      const currentRevision = getCaptionAiRevision();
      if (currentRevision !== options.expectedRevision) {
        throw new AiCommandError(
          `The tool changed after this command was prepared. Current revision: ${currentRevision}.`,
          {
            code: "stale-revision",
            path: "$.expectedRevision",
            details: {
              expectedRevision: options.expectedRevision,
              currentRevision,
            },
          },
        );
      }
    }
    return applyCaptionAiCommands(commands, options);
  });
  captionAiApplyChain = task.catch(() => {});
  return task;
}

function getCaptionAiRevision() {
  const signature = captionAiSignature();
  if (!captionAiStateSignature) {
    captionAiStateSignature = signature;
  } else if (captionAiStateSignature !== signature) {
    captionAiStateSignature = signature;
    captionAiRevision = (captionAiRevision + 1) % Number.MAX_SAFE_INTEGER;
  }
  return captionAiRevision;
}

function captionAiSignature() {
  let hash = 2166136261;
  const add = (value) => {
    const text = String(value ?? "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  add(state.stage);
  add(captionAiMutationSerial);
  add(state.project?.id);
  add(state.project?.name);
  add(state.project?.status);
  add(state.project?.updatedAt);
  for (const project of state.projects) {
    add(project.id);
    add(project.name);
    add(project.status);
    add(project.updatedAt);
  }
  add(state.captionPackage?.title);
  add(state.captionPackage?.originalDurationMs);
  add(state.captionPackage?.capturePlaybackRate);
  add(state.captionPackage?.settings?.translationMode);
  add(state.captionPackage?.settings?.pronounPreference);
  for (const cue of state.captionPackage?.cues ?? []) {
    add(cue.id);
    add(cue.startMs);
    add(cue.endMs);
    add(cue.sourceText);
    add(cue.translations?.vi);
    add(cue.translationStatus);
  }
  for (const entry of state.captionPackage?.glossary ?? []) {
    add(entry.source);
    add(entry.target);
  }
  const sync = state.syncEngine.snapshot(performance.now());
  add(sync.state);
  add(Math.round(sync.confidence * 100));
  add(state.syncEngine.anchorMovieTimeMs);
  add(state.syncEngine.anchorObservedAtMs);
  add(state.syncEngine.pausedMovieTimeMs);
  add(state.syncEngine.playbackRate);
  add(state.syncEngine.hasAnchor);
  add(state.captureSession?.state);
  add(state.transcriptionModelReady);
  add(state.transcriptionModelMeta?.modelKey);
  add(state.translationRunning);
  add(state.translationPaused);
  add(Boolean(state.translationAdapter));
  add(state.overlay.isOpen());
  add(Boolean(state.displayCapture));
  add(Boolean(state.mirror?.stream));
  add(state.overlaySettings.fontFamily);
  add(state.overlaySettings.fontSizePx);
  add(state.overlaySettings.color);
  add(state.overlaySettings.background);
  add(state.overlaySettings.verticalPlacement);
  add(state.overlaySettings.bilingual);
  return hash.toString(16);
}

async function getCaptionAiSnapshot({ includeCueText = false } = {}) {
  await initializationPromise;
  const cues = state.captionPackage?.cues ?? [];
  const progress = countTranslationProgress(cues);
  const sync = state.syncEngine.snapshot(performance.now());
  return {
    revision: getCaptionAiRevision(),
    stage: state.stage,
    projects: state.projects.map((project) => {
      const projectCues = project.package?.cues ?? [];
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        updatedAt: project.updatedAt,
        cueCount: projectCues.length,
        translatedCount: projectCues.filter((cue) => cue.translations?.vi).length,
      };
    }),
    activeProject: state.project
      ? {
          id: state.project.id,
          name: state.project.name,
          status: state.project.status,
          cueCount: cues.length,
          translatedCount: progress.completed,
          failedTranslationCount: progress.failed,
          package: {
            title: state.captionPackage?.title ?? "",
            cues: includeCueText ? cues : [],
          },
        }
      : null,
    capture: {
      state: state.captureSession?.state ?? "idle",
      processedSamples: state.captureSession?.processedSamples ?? 0,
      elapsedMs: state.captureLastElapsedMs,
      queueLength: state.captureQueue.size,
      modelState: state.transcriptionModelReady ? "ready" : "not-ready",
      recoveryAvailable: state.project?.status === "interrupted",
    },
    translation: {
      state: state.translationRunning
        ? state.translationPaused ? "paused" : "running"
        : progress.pending ? "idle" : "complete",
      completed: progress.completed,
      failed: progress.failed,
      total: progress.total,
      style: state.captionPackage?.settings?.translationMode ?? "natural",
      modelState: state.translationAdapter ? "ready" : "not-ready",
    },
    synchronization: {
      ...sync,
      mode: state.captionPackage?.sync?.mode ?? "text",
      captionsVisible: sync.showCaptions,
    },
    overlay: {
      open: state.overlay.isOpen(),
      mode: state.overlay.mode ?? "",
      bilingual: state.overlaySettings.bilingual,
      verticalPlacement: state.overlaySettings.verticalPlacement,
    },
  };
}

async function previewCaptionAiCommands(commands, { signal } = {}) {
  await initializationPromise;
  const warnings = await validateCaptionAiDomainCommands(commands, signal);
  return { warnings };
}

async function validateCaptionAiDomainCommands(commands, signal) {
  throwIfAborted(signal);
  const projects = await listCaptionProjects();
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  let activeProject = state.project;
  let captionPackage = state.captionPackage;
  const warnings = [];
  const activeCapture = isCaptionCaptureActive();
  let activeTranslation = state.translationRunning;
  let translationPaused = state.translationPaused;
  let translationReady = Boolean(state.translationAdapter);
  const activePackageMutations = new Set([
    "project.update-metadata",
    "cue.update",
    "timeline.correct",
    "translation.configure",
    "translation.search-replace",
    "glossary.upsert",
    "glossary.remove",
  ]);

  for (const [index, command] of commands.entries()) {
    throwIfAborted(signal);
    const changesActiveProject = [
      "project.create",
      "project.activate",
      "project.delete",
    ].includes(command.type)
      || (["project.rename", "project.duplicate"].includes(command.type)
        && command.projectId === activeProject?.id);
    if (activeCapture
      && (changesActiveProject
        || activePackageMutations.has(command.type)
        || command.type === "translation.run")) {
      throw new Error("Finish capture and its transcription queue before changing the active project.");
    }
    if (activeTranslation
      && (changesActiveProject || activePackageMutations.has(command.type))) {
      throw new Error("Finish capture and translation work before changing the active project.");
    }
    if (["project.activate", "project.rename", "project.duplicate", "project.delete"].includes(command.type)
      && !projectMap.has(command.projectId)) {
      throw new Error(`Caption Relay project ${command.projectId} was not found.`);
    }
    if (command.type === "project.create") {
      captionPackage = createAiCaptionPackage(command);
      activeProject = { id: "preview-project", package: captionPackage };
      if (command.capturePlaybackRate > 1) {
        warnings.push("Accelerated capture uses English text synchronization, not ordinary fingerprints.");
      }
      continue;
    }
    if (command.type === "project.activate") {
      activeProject = projectMap.get(command.projectId);
      captionPackage = activeProject.package;
      continue;
    }
    if (command.type === "project.delete") {
      projectMap.delete(command.projectId);
      if (activeProject?.id === command.projectId) {
        activeProject = null;
        captionPackage = null;
      }
      continue;
    }
    if (command.type === "project.update-metadata") {
      requireAiPackage(captionPackage);
      const captureRateChanged = command.capturePlaybackRate !== undefined
        && command.capturePlaybackRate !== captionPackage.capturePlaybackRate;
      const durationChanged = command.originalDurationMs !== undefined
        && command.originalDurationMs !== captionPackage.originalDurationMs;
      const modelChanged = command.transcriptionModel !== undefined
        && captionSpeechModelMetadata(command.transcriptionModel).id
          !== captionPackage.transcriptionModel?.id;
      if (captionPackage.cues.length && (captureRateChanged || durationChanged)) {
        throw new Error("Capture speed and original duration cannot be changed after cues exist; use timeline.correct for timing repair.");
      }
      if (captionPackage.cues.length && modelChanged) {
        throw new Error("Speech-model metadata cannot be changed after captured or imported cues exist.");
      }
      continue;
    }
    if ([
      "cue.update",
      "timeline.correct",
      "translation.configure",
      "translation.search-replace",
      "translation.run",
      "glossary.upsert",
      "glossary.remove",
      "sync.control",
    ].includes(command.type)) {
      requireAiPackage(captionPackage);
    }
    if (command.type === "cue.update"
      && !captionPackage.cues.some((cue) => cue.id === command.cueId)) {
      throw new Error(`Caption cue ${command.cueId} was not found.`);
    }
    if (command.type === "timeline.correct") {
      applyTimelineCorrectionToCues(captionPackage.cues, command);
      applyTimelineCorrectionToFingerprints(
        captionPackage.sync?.fingerprints ?? [],
        command,
      );
    }
    if (command.type === "translation.run") {
      const startsPass = ["translate-all", "retry-failed", "regenerate-cues"]
        .includes(command.action);
      if (startsPass && activeTranslation) {
        throw new Error("A translation pass is already running.");
      }
      if (startsPass && !translationReady) {
        throw new Error("Prepare the local translation model before starting a translation command.");
      }
      if (command.action === "regenerate-cues") {
        const cueIds = new Set(captionPackage.cues.map((cue) => cue.id));
        const missing = command.cueIds.find((cueId) => !cueIds.has(cueId));
        if (missing) throw new Error(`Caption cue ${missing} was not found.`);
      }
      if (startsPass && index !== commands.length - 1) {
        throw new Error("A long-running translation command must be the final command in its batch.");
      }
      if (command.action === "pause") {
        if (!activeTranslation || translationPaused) {
          throw new Error("No running translation pass can be paused.");
        }
        translationPaused = true;
      } else if (command.action === "resume") {
        if (!activeTranslation || !translationPaused) {
          throw new Error("No paused translation pass can be resumed.");
        }
        translationPaused = false;
      } else if (startsPass) {
        activeTranslation = true;
        warnings.push("The local translation pass starts in the page and continues after the command receipt.");
      }
    }
    if (command.type === "capture.finish"
      && !["capturing", "stopping"].includes(state.captureSession?.state)) {
      throw new Error("No active capture is available to finish.");
    }
    if (command.type === "model.clear-cache"
      && (activeCapture || activeTranslation || state.displayCapture)) {
      throw new Error("Stop capture, translation, and shared movie audio before clearing models.");
    }
    if (command.type === "model.prepare") {
      if (command.kind === "transcription") {
        const alreadyReady = state.transcriptionModelReady
          && state.transcriptionModelMeta?.modelKey === command.model;
        if (!alreadyReady && !state.transcriptionWorker) {
          throw new Error("Web Workers are unavailable, so the local speech model cannot be prepared.");
        }
        if (!alreadyReady && (activeCapture || state.displayCapture)) {
          throw new Error("Stop capture and shared movie-audio listening before changing the speech model.");
        }
      } else if (!translationReady) {
        if (!("Translator" in globalThis) && !state.translationWorker) {
          throw new Error("No browser-local translation runtime is available.");
        }
        if (activeTranslation) {
          throw new Error("Finish the current translation pass before preparing another translation runtime.");
        }
      }
      warnings.push("Model preparation may download pinned Apache-2.0 files; project media and captions remain local.");
      if (command.kind === "translation") translationReady = true;
    }
  }
  return [...new Set(warnings)];
}

async function applyCaptionAiCommands(commands, { signal } = {}) {
  const warnings = await validateCaptionAiDomainCommands(commands, signal);
  const createdIds = [];
  const updatedIds = new Set();
  const deletedIds = [];
  let activePackageChanged = false;
  let displaySynchronizationChanged = false;

  for (const command of commands) {
    throwIfAborted(signal);
    switch (command.type) {
      case "project.create": {
        await flushCaptionProjectBeforeAiSwitch();
        const now = new Date().toISOString();
        state.captionPackage = createAiCaptionPackage(command);
        state.project = {
          id: createProjectId(),
          name: command.title,
          status: "draft",
          createdAt: now,
          updatedAt: now,
          package: state.captionPackage,
        };
        applyActiveProjectToForms();
        await saveCurrentProject();
        createdIds.push(state.project.id);
        displaySynchronizationChanged = true;
        showStage("capture");
        break;
      }
      case "project.activate": {
        await flushCaptionProjectBeforeAiSwitch();
        const project = await getCaptionProject(command.projectId);
        await activateCaptionProject(project);
        updatedIds.add(command.projectId);
        break;
      }
      case "project.rename": {
        if (command.projectId === state.project?.id) {
          await flushCurrentCaptionProjectForAi();
        }
        const project = await getCaptionProject(command.projectId);
        const renamed = await renameCaptionProject(project, command.name);
        if (state.project?.id === renamed.id) state.project = renamed;
        updatedIds.add(command.projectId);
        break;
      }
      case "project.duplicate": {
        if (command.projectId === state.project?.id) {
          await flushCurrentCaptionProjectForAi();
        }
        const project = await getCaptionProject(command.projectId);
        let duplicated = await duplicateCaptionProject(project);
        if (command.name) duplicated = await renameCaptionProject(duplicated, command.name);
        createdIds.push(duplicated.id);
        break;
      }
      case "project.delete": {
        const deletesActiveProject = state.project?.id === command.projectId;
        if (deletesActiveProject) await flushCaptionProjectBeforeAiSwitch();
        await deleteCaptionProject(command.projectId);
        if (deletesActiveProject) {
          state.overlay.close();
          state.project = null;
          state.captionPackage = null;
          displaySynchronizationChanged = true;
          renderAllCaptionViews();
        }
        deletedIds.push(command.projectId);
        break;
      }
      case "project.update-metadata":
        applyAiProjectMetadata(command);
        activePackageChanged = true;
        displaySynchronizationChanged = displaySynchronizationChanged
          || command.originalDurationMs !== undefined
          || command.capturePlaybackRate !== undefined
          || command.transcriptionModel !== undefined;
        updatedIds.add(state.project.id);
        break;
      case "stage.select":
        showStage(command.stage);
        break;
      case "cue.update":
        applyAiCueUpdate(command);
        activePackageChanged = true;
        updatedIds.add(state.project.id);
        break;
      case "timeline.correct":
        state.captionPackage.cues = applyTimelineCorrectionToCues(
          state.captionPackage.cues,
          command,
        );
        state.captionPackage.sync.fingerprints = applyTimelineCorrectionToFingerprints(
          state.captionPackage.sync.fingerprints,
          command,
        );
        activePackageChanged = true;
        displaySynchronizationChanged = true;
        updatedIds.add(state.project.id);
        break;
      case "translation.configure":
        applyAiTranslationConfiguration(command);
        activePackageChanged = true;
        updatedIds.add(state.project.id);
        break;
      case "translation.search-replace":
        state.captionPackage.cues = searchAndReplaceTranslations(
          state.captionPackage.cues,
          command.search,
          command.replacement,
          { caseSensitive: command.caseSensitive },
        );
        activePackageChanged = true;
        updatedIds.add(state.project.id);
        break;
      case "translation.run":
        await applyAiTranslationControl(command, signal);
        updatedIds.add(state.project.id);
        break;
      case "glossary.upsert":
        upsertAiGlossaryEntries(command.entries);
        activePackageChanged = true;
        updatedIds.add(state.project.id);
        break;
      case "glossary.remove": {
        const removals = new Set(command.sources.map((source) => source.toLocaleLowerCase()));
        state.captionPackage.glossary = state.captionPackage.glossary.filter(
          (entry) => !removals.has(entry.source.toLocaleLowerCase()),
        );
        activePackageChanged = true;
        updatedIds.add(state.project.id);
        break;
      }
      case "model.prepare":
        await prepareCaptionModelForAi(command, signal);
        break;
      case "model.clear-cache":
        await clearCaptionModelsWithoutPrompt();
        break;
      case "capture.finish":
        await state.captureSession.stop({ reason: "manual" });
        updatedIds.add(state.project?.id);
        break;
      case "sync.control":
        applyAiSynchronizationControl(command);
        break;
      case "overlay.configure":
        await applyAiOverlayConfiguration(command);
        break;
      case "display.stop":
        await applyAiDisplayStop(command);
        break;
      default:
        throw new Error(`Unsupported Caption Relay command: ${command.type}`);
    }
  }

  if (activePackageChanged && state.project && state.captionPackage) {
    await saveCurrentProject();
  }
  await refreshProjects();
  renderAllCaptionViews();
  configureDisplayPackageIfAvailable({
    resetSynchronization: displaySynchronizationChanged,
  });
  captionAiMutationSerial = (captionAiMutationSerial + 1) % Number.MAX_SAFE_INTEGER;
  getCaptionAiRevision();
  return {
    revision: captionAiRevision,
    createdIds,
    updatedIds: [...updatedIds].filter(Boolean),
    deletedIds,
    warnings,
  };
}

function createAiCaptionPackage(command) {
  const model = captionSpeechModelMetadata(command.transcriptionModel ?? "tiny");
  return createCaptionPackage({
    title: command.title,
    originalDurationMs: command.originalDurationMs,
    capturePlaybackRate: command.capturePlaybackRate,
    transcriptionModel: model,
    sync: {
      mode: command.capturePlaybackRate === 1 ? "fingerprint" : "text",
      fingerprints: [],
      textIndexVersion: 1,
    },
    settings: {
      translationMode: "natural",
      pronounPreference: "",
    },
  });
}

function captionSpeechModelMetadata(modelKey) {
  const models = {
    tiny: {
      id: "onnx-community/whisper-tiny.en",
      runtime: "@huggingface/transformers@3.8.1",
      revision: "2575352",
      license: "Apache-2.0",
    },
    small: {
      id: "Xenova/whisper-small.en",
      runtime: "@huggingface/transformers@3.8.1",
      revision: "529f2fb",
      license: "Apache-2.0",
    },
  };
  return { ...models[modelKey] };
}

function applyAiProjectMetadata(command) {
  if (command.title !== undefined) {
    state.captionPackage.title = command.title;
    state.project.name = command.title;
    elements["capture-title"].value = command.title;
  }
  if (command.originalDurationMs !== undefined) {
    state.captionPackage.originalDurationMs = command.originalDurationMs;
    elements["capture-duration"].value = formatClockMs(command.originalDurationMs).slice(0, -4);
  }
  if (command.capturePlaybackRate !== undefined) {
    state.captionPackage.capturePlaybackRate = command.capturePlaybackRate;
    state.captionPackage.sync = {
      mode: command.capturePlaybackRate === 1 ? "fingerprint" : "text",
      fingerprints: [],
      textIndexVersion: 1,
    };
    elements["capture-rate"].value = String(command.capturePlaybackRate);
  }
  if (command.transcriptionModel !== undefined) {
    state.captionPackage.transcriptionModel = captionSpeechModelMetadata(command.transcriptionModel);
    elements["transcription-model"].value = command.transcriptionModel;
  }
  updateCaptureCalculation();
}

function applyAiCueUpdate(command) {
  const cue = state.captionPackage.cues.find((candidate) => candidate.id === command.cueId);
  if (command.sourceText !== undefined) cue.sourceText = command.sourceText;
  if (command.vietnameseText !== undefined) {
    cue.translations.vi = command.vietnameseText;
    cue.translationStatus = command.vietnameseText ? "translated" : "pending";
    delete cue.translationError;
  }
  state.displayTextIndex = buildTextSynchronizationIndex(state.captionPackage.cues);
}

function applyAiTranslationConfiguration(command) {
  state.captionPackage.settings = {
    ...state.captionPackage.settings,
    ...(command.style !== undefined ? { translationMode: command.style } : {}),
    ...(command.pronounPreference !== undefined
      ? { pronounPreference: command.pronounPreference }
      : {}),
  };
  applyProjectPreferencesToForm(state.captionPackage.settings);
}

async function applyAiTranslationControl(command, signal) {
  if (command.action === "pause") {
    if (state.translationRunning && !state.translationPaused) toggleTranslationPause();
    return;
  }
  if (command.action === "resume") {
    if (state.translationRunning && state.translationPaused) toggleTranslationPause();
    return;
  }
  if (command.action === "translate-all") {
    void runTranslation(false, { signal, throwOnError: true }).catch(reportError);
    return;
  }
  if (command.action === "retry-failed") {
    void runTranslation(true, { signal, throwOnError: true }).catch(reportError);
    return;
  }
  void runTranslation(true, {
    cueIds: command.cueIds,
    signal,
    throwOnError: true,
  }).catch(reportError);
}

function upsertAiGlossaryEntries(entries) {
  const bySource = new Map(
    state.captionPackage.glossary.map((entry, index) => [
      entry.source.toLocaleLowerCase(),
      index,
    ]),
  );
  for (const entry of entries) {
    const key = entry.source.toLocaleLowerCase();
    const existingIndex = bySource.get(key);
    if (existingIndex === undefined) {
      bySource.set(key, state.captionPackage.glossary.length);
      state.captionPackage.glossary.push({ ...entry });
    } else {
      state.captionPackage.glossary[existingIndex] = { ...entry };
    }
  }
}

async function prepareCaptionModelForAi(command, signal) {
  if (command.kind === "transcription") {
    elements["transcription-model"].value = command.model;
    if (state.transcriptionModelReady
      && state.transcriptionModelMeta?.modelKey === command.model) return;
    await waitForModelPreparation(
      transcriptionModelWaiters,
      () => prepareTranscriptionModel(),
      signal,
    );
    return;
  }
  if (state.translationAdapter) return;
  await waitForModelPreparation(
    translationModelWaiters,
    () => prepareTranslationAdapter(),
    signal,
  );
}

function waitForModelPreparation(waiters, start, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      waiters.delete(waiter);
      signal?.removeEventListener("abort", waiter.onAbort);
    };
    const waiter = {
      signal,
      onAbort: null,
      resolve(value) {
        cleanup();
        resolve(value);
      },
      reject(error) {
        cleanup();
        reject(error);
      },
    };
    waiter.onAbort = () => {
      waiter.reject(new DOMException("Caption model preparation was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", waiter.onAbort, { once: true });
    waiters.add(waiter);
    timeout = setTimeout(
      () => waiter.reject(new Error("Caption model preparation timed out.")),
      15 * 60 * 1000,
    );
    try {
      start();
    } catch (error) {
      waiter.reject(error);
    }
  });
}

function settleModelWaiters(waiters, error, value) {
  for (const waiter of [...waiters]) {
    if (error) waiter.reject(error);
    else waiter.resolve(value);
  }
}

async function clearCaptionModelsWithoutPrompt() {
  const result = await clearDownloadedCaptionModels();
  elements["model-manager-status"].textContent = result.supported
    ? `${result.removed} cached Caption Relay model files removed.`
    : "This browser does not expose model cache controls.";
  state.transcriptionModelReady = false;
  state.transcriptionModelMeta = null;
  state.transcriptionWorker?.postMessage({ type: "dispose" });
  state.translationAdapter = null;
  state.translationAdapterName = "";
  state.translationWorkerReady = false;
  state.translationWorker?.postMessage({ type: "dispose" });
  updateExportButtons();
}

function applyAiSynchronizationControl(command) {
  const now = performance.now();
  switch (command.action) {
    case "resynchronize":
      state.syncEngine.resynchronize();
      break;
    case "set-current-time":
      state.syncEngine.setCurrentMovieTime(command.value, now);
      break;
    case "adjust":
      state.syncEngine.adjust(command.value, now);
      break;
    case "pause":
      state.syncEngine.pause(now);
      elements["pause-caption-clock"].textContent = "Resume caption clock";
      break;
    case "resume":
      state.syncEngine.resume(now);
      elements["pause-caption-clock"].textContent = "Pause caption clock";
      break;
    case "reset":
      state.syncEngine.reset();
      break;
    case "set-playback-rate":
      state.syncEngine.setPlaybackRate(command.value, now);
      elements["display-playback-rate"].value = String(command.value);
      break;
  }
  updateDisplayedCaption(now);
}

async function applyAiOverlayConfiguration(command) {
  if (command.fontFamily !== undefined) elements["overlay-font"].value = command.fontFamily;
  if (command.fontSizePx !== undefined) elements["overlay-size"].value = command.fontSizePx;
  if (command.color !== undefined) elements["overlay-color"].value = command.color;
  if (command.background !== undefined) elements["overlay-background"].value = command.background;
  if (command.verticalPlacement !== undefined) {
    elements["overlay-placement"].value = command.verticalPlacement;
  }
  if (command.bilingual !== undefined) elements["overlay-bilingual"].checked = command.bilingual;
  applyOverlaySettingsFromForm();
  await saveCaptionRelaySettings({ overlay: state.overlaySettings });
}

async function applyAiDisplayStop(command) {
  if (command.closeOverlay) state.overlay.close();
  if (command.disconnectAudio) await stopDisplayCapture();
  if (command.disconnectMirror) state.mirror.disconnect();
  if (command.disconnectAudio || command.disconnectMirror) {
    state.syncEngine.reset();
    updateDisplayedCaption(performance.now());
  }
}

async function activateCaptionProject(project) {
  if (!project) throw new Error("Caption Relay project was not found.");
  await stopDisplayCapture();
  state.mirror.disconnect();
  state.syncEngine.reset();
  state.project = project;
  state.captionPackage = project.package;
  applyActiveProjectToForms();
  renderAllCaptionViews();
  configureDisplayPackageIfAvailable();
  showStage(project.status === "translated"
    ? "display"
    : project.package.cues.length ? "translate" : "capture");
}

async function flushCaptionProjectBeforeAiSwitch() {
  if (!await prepareProjectTransition()) {
    throw new Error("Finish active capture or translation work before changing projects.");
  }
  await flushCurrentCaptionProjectForAi();
}

async function flushCurrentCaptionProjectForAi() {
  if (isCaptionCaptureActive() || state.translationRunning) {
    throw new Error("Finish active capture or translation work before saving this project action.");
  }
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  await saveCurrentProject();
}

function applyActiveProjectToForms() {
  elements["capture-title"].value = state.captionPackage.title;
  elements["capture-duration"].value = formatClockMs(
    state.captionPackage.originalDurationMs,
  ).slice(0, -4);
  elements["capture-rate"].value = String(state.captionPackage.capturePlaybackRate);
  applyProjectPreferencesToForm(state.captionPackage.settings);
  updateCaptureCalculation();
}

function configureDisplayPackageIfAvailable({ resetSynchronization = true } = {}) {
  if (state.captionPackage) {
    if (resetSynchronization) configureDisplayPackage();
    else renderDisplayPackageSummary();
  } else {
    elements["display-package-name"].textContent = "No translated package loaded";
    elements["open-caption-overlay"].disabled = true;
    elements["start-mirror-mode"].disabled = true;
  }
}

function requireAiPackage(captionPackage) {
  if (!captionPackage) throw new Error("Activate or create a Caption Relay project first.");
  return captionPackage;
}

function isCaptionCaptureActive() {
  return ["requesting", "capturing", "stopping"].includes(state.captureSession?.state)
    || state.captureQueue.size > 0
    || state.pendingFingerprintJobs > 0;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException("Caption Relay command was cancelled.", "AbortError");
  }
}

async function exportCaptionProjectForAi({
  format,
  projectId,
  filename,
  signal,
}) {
  await initializationPromise;
  throwIfAborted(signal);
  const project = projectId
    ? projectId === state.project?.id
      ? { ...state.project, package: state.captionPackage }
      : await getCaptionProject(projectId)
    : state.project
      ? { ...state.project, package: state.captionPackage }
      : null;
  if (!project?.package) throw new Error("The requested Caption Relay project was not found.");
  const captionPackage = validateCaptionPackage(project.package);
  const exportOptions = {
    package: {
      text: serializeCaptionPackage(captionPackage),
      extension: ".vpcaptions.json",
      type: "application/json",
    },
    "vtt-vi": {
      text: exportVtt(captionPackage.cues, { language: "vi" }),
      extension: "-vi.vtt",
      type: "text/vtt",
    },
    "srt-vi": {
      text: exportSrt(captionPackage.cues, { language: "vi" }),
      extension: "-vi.srt",
      type: "application/x-subrip",
    },
    "vtt-bilingual": {
      text: exportVtt(captionPackage.cues, { language: "vi", bilingual: true }),
      extension: "-bilingual.vtt",
      type: "text/vtt",
    },
  };
  const selected = exportOptions[format];
  const exportFilename = filename ?? `${slugify(project.name)}${selected.extension}`;
  throwIfAborted(signal);
  downloadText(selected.text, exportFilename, selected.type);
  return {
    downloaded: true,
    filename: exportFilename,
    size: new TextEncoder().encode(selected.text).byteLength,
  };
}

installAiPageHost(createCaptionRelayAiAdapter(createCaptionRelayAiController()));
