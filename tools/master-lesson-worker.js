/**
 * Dedicated WebLLM worker. The library and model are loaded only after an
 * explicit user action; model artifacts use WebLLM's IndexedDB cache backend.
 */

const WEBLLM_MODULE_URL = "https://esm.run/@mlc-ai/web-llm@0.2.83";

let engine = null;
let loadedModelId = null;
let activeRequestId = null;
let webllmModule = null;

self.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  try {
    if (message.type === "load") {
      await loadModel(message.modelId);
      return;
    }
    if (message.type === "generate") {
      await generate(message);
      return;
    }
    if (message.type === "cancel") {
      if (!message.requestId || message.requestId === activeRequestId) {
        engine?.interruptGenerate?.();
      }
    }
  } catch (error) {
    self.postMessage({
      type: message.type === "load" ? "model-error" : "generation-error",
      requestId: message.requestId ?? null,
      error: readableError(error),
    });
  }
});

async function loadModel(modelId) {
  if (!self.navigator?.gpu) {
    throw new Error("WebGPU is unavailable. Use a current WebGPU-capable browser and device.");
  }
  if (!modelId) throw new Error("Choose a local model first.");
  if (engine && loadedModelId === modelId) {
    self.postMessage({ type: "model-ready", modelId });
    return;
  }

  self.postMessage({ type: "model-progress", progress: 0, text: "Loading the WebLLM runtime" });
  webllmModule ??= await import(WEBLLM_MODULE_URL);
  const appConfig = {
    ...webllmModule.prebuiltAppConfig,
    cacheBackend: "indexeddb",
  };
  engine = await webllmModule.CreateMLCEngine(modelId, {
    appConfig,
    initProgressCallback(progress) {
      self.postMessage({
        type: "model-progress",
        progress: Number(progress.progress ?? 0),
        text: progress.text ?? "Downloading local model",
      });
    },
  });
  loadedModelId = modelId;
  self.postMessage({ type: "model-ready", modelId });
}

async function generate(message) {
  if (!engine || !loadedModelId) throw new Error("Load a model before generating.");
  activeRequestId = message.requestId;
  let output = "";
  const response = await engine.chat.completions.create({
    messages: [
      { role: "system", content: String(message.system ?? "") },
      { role: "user", content: String(message.user ?? "") },
    ],
    temperature: Number.isFinite(message.temperature) ? message.temperature : 0.2,
    max_tokens: Math.min(3000, Math.max(128, Number(message.maxTokens) || 1800)),
    response_format: { type: "json_object" },
    stream: true,
    stream_options: { include_usage: true },
  });

  for await (const chunk of response) {
    if (activeRequestId !== message.requestId) break;
    const token = chunk.choices?.[0]?.delta?.content ?? "";
    if (!token) continue;
    output += token;
    self.postMessage({ type: "generation-stream", requestId: message.requestId, text: output });
  }
  if (activeRequestId === message.requestId) {
    self.postMessage({ type: "generation-complete", requestId: message.requestId, text: output });
  }
  activeRequestId = null;
}

function readableError(error) {
  const message = String(error?.message ?? error ?? "Local model operation failed.");
  if (/memory|alloc|device lost|out of memory/i.test(message)) {
    return "The selected model exceeded available GPU memory. Close other GPU-heavy tabs or load the smaller model.";
  }
  return message;
}
