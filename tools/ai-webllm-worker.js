/**
 * Local command-drafting worker. The WebLLM runtime and model are downloaded
 * only after the user explicitly chooses Load local model.
 */

const WEBLLM_MODULE_URL = "https://esm.run/@mlc-ai/web-llm@0.2.83";
const MAXIMUM_PROMPT_CHARACTERS = 240_000;

let engine = null;
let loadedModelId = null;
let activeRequestId = null;
let webllmModule = null;

self.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  try {
    if (message.type === "load") {
      await loadModel(String(message.modelId ?? ""));
    } else if (message.type === "generate") {
      await generateCommands(message);
    } else if (message.type === "cancel") {
      if (!message.requestId || message.requestId === activeRequestId) {
        activeRequestId = null;
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
    throw new Error("WebGPU is unavailable in this browser.");
  }
  if (!modelId) throw new Error("Choose a local model.");
  if (engine && loadedModelId === modelId) {
    self.postMessage({ type: "model-ready", modelId });
    return;
  }

  self.postMessage({ type: "model-progress", progress: 0, text: "Loading WebLLM" });
  webllmModule ??= await import(WEBLLM_MODULE_URL);
  engine = await webllmModule.CreateMLCEngine(modelId, {
    appConfig: {
      ...webllmModule.prebuiltAppConfig,
      cacheBackend: "indexeddb",
    },
    initProgressCallback(progress) {
      self.postMessage({
        type: "model-progress",
        progress: Number(progress.progress ?? 0),
        text: String(progress.text ?? "Downloading local model"),
      });
    },
  });
  loadedModelId = modelId;
  self.postMessage({ type: "model-ready", modelId });
}

async function generateCommands(message) {
  if (!engine || !loadedModelId) throw new Error("Load a local model first.");
  const system = String(message.system ?? "");
  const user = String(message.user ?? "");
  if (!user || system.length + user.length > MAXIMUM_PROMPT_CHARACTERS) {
    throw new Error("The command prompt is empty or too large for local drafting.");
  }

  activeRequestId = String(message.requestId ?? "");
  let output = "";
  const stream = await engine.chat.completions.create({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.1,
    max_tokens: 2_400,
    response_format: { type: "json_object" },
    stream: true,
  });
  for await (const chunk of stream) {
    if (activeRequestId !== message.requestId) break;
    output += chunk.choices?.[0]?.delta?.content ?? "";
    self.postMessage({
      type: "generation-stream",
      requestId: message.requestId,
      text: output,
    });
  }
  if (activeRequestId === message.requestId) {
    self.postMessage({
      type: "generation-complete",
      requestId: message.requestId,
      text: output,
    });
  }
  activeRequestId = null;
}

function readableError(error) {
  const message = String(error?.message ?? error ?? "Local model operation failed.");
  if (/memory|alloc|device lost|out of memory/i.test(message)) {
    return "The model exceeded available GPU memory. Close GPU-heavy tabs or load the smaller model.";
  }
  return message.slice(0, 800);
}
