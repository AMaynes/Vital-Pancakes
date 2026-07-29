/**
 * Shared dedicated worker for optional local WebLLM assistance. The runtime and
 * model are lazy-loaded only after an explicit load request.
 */

const WEBLLM_MODULE_URL = "https://esm.run/@mlc-ai/web-llm@0.2.83";

let engine = null;
let loadedModelId = null;
let activeRequestId = null;
let webllmModule = null;

self.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  try {
    if (message.type === "load") await loadModel(message.modelId);
    if (message.type === "generate") await generate(message);
    if (message.type === "cancel" && (!message.requestId || message.requestId === activeRequestId)) {
      engine?.interruptGenerate?.();
      activeRequestId = null;
      self.postMessage({ type: "generation-cancelled", requestId: message.requestId ?? null });
    }
    if (message.type === "unload") await unload();
  } catch (error) {
    self.postMessage({
      type: message.type === "load" ? "model-error" : "generation-error",
      requestId: message.requestId ?? null,
      error: readableError(error),
    });
  }
});

async function loadModel(modelId) {
  if (!self.navigator?.gpu) throw new Error("WebGPU is unavailable. Use a current WebGPU-capable browser and device.");
  if (!modelId) throw new Error("Choose a local model first.");
  if (engine && loadedModelId === modelId) {
    self.postMessage({ type: "model-ready", modelId });
    return;
  }
  if (engine) await unload();
  self.postMessage({ type: "model-progress", progress: 0, text: "Loading the local WebLLM runtime" });
  webllmModule ??= await import(WEBLLM_MODULE_URL);
  engine = await webllmModule.CreateMLCEngine(modelId, {
    appConfig: { ...webllmModule.prebuiltAppConfig, cacheBackend: "indexeddb" },
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
  if (!engine || !loadedModelId) throw new Error("Load a model before using local assistance.");
  activeRequestId = message.requestId;
  let output = "";
  const request = {
    messages: [
      { role: "system", content: String(message.system ?? "") },
      { role: "user", content: String(message.user ?? "") },
    ],
    temperature: Number.isFinite(message.temperature) ? message.temperature : 0.2,
    max_tokens: Math.min(4000, Math.max(64, Number(message.maxTokens) || 1600)),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (message.json) request.response_format = { type: "json_object" };
  const response = await engine.chat.completions.create(request);
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

async function unload() {
  activeRequestId = null;
  if (engine?.unload) await engine.unload();
  engine = null;
  loadedModelId = null;
  self.postMessage({ type: "model-unloaded" });
}

function readableError(error) {
  const message = String(error?.message ?? error ?? "Local model operation failed.");
  if (/memory|alloc|device lost|out of memory/i.test(message)) {
    return "The model exceeded available GPU memory. Close other GPU-heavy tabs or load the smaller model.";
  }
  if (/fetch|network|failed to load/i.test(message)) {
    return "The model runtime or weights could not be downloaded. Connect to the internet for the first load, then try again.";
  }
  return message;
}
