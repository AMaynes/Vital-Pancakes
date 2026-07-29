/**
 * Dedicated Apache-2.0 English-to-Vietnamese fallback translator. Chrome's
 * built-in Translator API remains the preferred adapter in the page.
 */

const TRANSFORMERS_RUNTIME = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const MODEL = Object.freeze({
  id: "Xenova/opus-mt-en-vi",
  revision: "30bcd46",
  label: "OPUS-MT English → Vietnamese",
  license: "Apache-2.0",
});

let pipelineFactory = null;
let translator = null;
let workChain = Promise.resolve();

self.addEventListener("message", ({ data }) => {
  workChain = workChain
    .then(() => handleMessage(data))
    .catch((error) => {
      self.postMessage({
        type: "translation-error",
        jobId: data?.jobId,
        message: String(error?.message ?? "Translation model failed."),
      });
    });
});

async function handleMessage(message) {
  if (message?.type === "prepare") {
    await prepare();
    return;
  }
  if (message?.type === "translate") {
    if (!translator) await prepare();
    const output = await translator(`>>vie<< ${String(message.text ?? "")}`, {
      max_new_tokens: Math.min(256, Math.max(24, String(message.text ?? "").length * 2)),
    });
    const translatedText = Array.isArray(output)
      ? output[0]?.translation_text ?? output[0]?.generated_text
      : output?.translation_text ?? output?.generated_text;
    self.postMessage({
      type: "translation-result",
      jobId: message.jobId,
      text: String(translatedText ?? "").trim(),
    });
    return;
  }
  if (message?.type === "dispose") {
    await translator?.dispose?.();
    translator = null;
  }
}

async function prepare() {
  if (translator) {
    self.postMessage({ type: "translation-model-ready", model: MODEL, runtime: "@huggingface/transformers@3.8.1" });
    return;
  }
  if (!pipelineFactory) {
    self.postMessage({ type: "translation-model-progress", progress: 0, text: "Loading the pinned translation runtime" });
    ({ pipeline: pipelineFactory } = await import(TRANSFORMERS_RUNTIME));
  }
  let device = self.navigator?.gpu ? "webgpu" : "wasm";
  try {
    translator = await createTranslator(device);
  } catch (error) {
    if (device !== "webgpu") throw error;
    device = "wasm";
    self.postMessage({
      type: "translation-model-progress",
      progress: 0,
      text: "WebGPU initialization failed; retrying with WASM",
    });
    translator = await createTranslator(device);
  }
  self.postMessage({
    type: "translation-model-ready",
    model: MODEL,
    runtime: "@huggingface/transformers@3.8.1",
    device,
  });
}

function createTranslator(device) {
  return pipelineFactory("translation", MODEL.id, {
    revision: MODEL.revision,
    device,
    dtype: device === "webgpu" ? "q4" : "q8",
    progress_callback: (progress) => {
      self.postMessage({
        type: "translation-model-progress",
        progress: normalizeProgress(progress),
        text: progress?.file ? `Downloading ${shortFilename(progress.file)}` : String(progress?.status ?? "Preparing model"),
      });
    },
  });
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
