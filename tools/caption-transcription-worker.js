/**
 * Dedicated browser-local Whisper worker. The pinned Transformers.js runtime
 * and Apache-2.0 model weights load only after an explicit prepare action.
 */

const TRANSFORMERS_RUNTIME = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const MODEL_CONFIGS = Object.freeze({
  tiny: Object.freeze({
    id: "onnx-community/whisper-tiny.en",
    revision: "2575352",
    label: "Whisper Tiny English",
    license: "Apache-2.0",
  }),
  small: Object.freeze({
    id: "Xenova/whisper-small.en",
    revision: "529f2fb",
    label: "Whisper Small English",
    license: "Apache-2.0",
  }),
});

let pipelineFactory = null;
let transcriber = null;
let loadedModelKey = "";
let workChain = Promise.resolve();

self.addEventListener("message", ({ data }) => {
  workChain = workChain
    .then(() => handleMessage(data))
    .catch((error) => {
      self.postMessage({
        type: "worker-error",
        jobId: data?.jobId,
        message: String(error?.message ?? "Speech model failed."),
      });
    });
});

async function handleMessage(message) {
  if (message?.type === "prepare") {
    await prepareModel(message.modelKey);
    return;
  }
  if (message?.type === "transcribe") {
    await transcribeChunk(message);
    return;
  }
  if (message?.type === "dispose") {
    await transcriber?.dispose?.();
    transcriber = null;
    loadedModelKey = "";
  }
}

async function prepareModel(modelKey = "tiny") {
  const config = MODEL_CONFIGS[modelKey];
  if (!config) throw new RangeError("Unknown speech model.");
  if (transcriber && loadedModelKey === modelKey) {
    self.postMessage({ type: "model-ready", modelKey, config, runtime: "@huggingface/transformers@3.8.1" });
    return;
  }
  if (!pipelineFactory) {
    self.postMessage({ type: "model-progress", progress: 0, text: "Loading the pinned speech runtime" });
    ({ pipeline: pipelineFactory } = await import(TRANSFORMERS_RUNTIME));
  }
  await transcriber?.dispose?.();
  transcriber = null;
  loadedModelKey = "";
  let device = self.navigator?.gpu ? "webgpu" : "wasm";
  self.postMessage({
    type: "model-progress",
    progress: 0,
    text: `Preparing ${config.label} with ${device.toUpperCase()}`,
  });
  try {
    transcriber = await createTranscriber(config, device);
  } catch (error) {
    if (device !== "webgpu") throw error;
    device = "wasm";
    self.postMessage({
      type: "model-progress",
      progress: 0,
      text: "WebGPU initialization failed; retrying with WASM",
    });
    transcriber = await createTranscriber(config, device);
  }
  loadedModelKey = modelKey;
  self.postMessage({
    type: "model-ready",
    modelKey,
    config,
    runtime: "@huggingface/transformers@3.8.1",
    device,
  });
}

function createTranscriber(config, device) {
  return pipelineFactory(
    "automatic-speech-recognition",
    config.id,
    {
      revision: config.revision,
      device,
      dtype: device === "webgpu" ? "q4" : "q8",
      progress_callback: (progress) => {
        self.postMessage({
          type: "model-progress",
          progress: normalizeProgress(progress),
          text: progress?.file ? `Downloading ${shortFilename(progress.file)}` : String(progress?.status ?? "Preparing model"),
        });
      },
    },
  );
}

async function transcribeChunk(message) {
  if (!transcriber) throw new Error("Prepare the transcription model before capturing.");
  const samples = new Float32Array(message.samples);
  const rms = calculateRms(samples);
  if (rms < 0.0015 || Number(message.speechRatio ?? 0) < 0.01) {
    self.postMessage({
      type: "transcription-result",
      jobId: message.jobId,
      result: { text: "", chunks: [] },
      silent: true,
    });
    return;
  }
  const result = await transcriber(samples, {
    language: "en",
    task: "transcribe",
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 2,
  });
  self.postMessage({
    type: "transcription-result",
    jobId: message.jobId,
    result: {
      text: String(result?.text ?? ""),
      chunks: Array.isArray(result?.chunks)
        ? result.chunks.map((chunk) => ({
          text: String(chunk.text ?? ""),
          timestamp: chunk.timestamp,
        }))
        : [],
    },
    silent: false,
  });
}

function calculateRms(samples) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.sqrt(energy / Math.max(1, samples.length));
}

function normalizeProgress(progress) {
  if (Number.isFinite(progress?.progress)) return Math.max(0, Math.min(1, progress.progress / 100));
  if (Number.isFinite(progress?.loaded) && Number.isFinite(progress?.total) && progress.total > 0) {
    return Math.max(0, Math.min(1, progress.loaded / progress.total));
  }
  return 0;
}

function shortFilename(value) {
  return String(value).split("/").at(-1) || "model file";
}
