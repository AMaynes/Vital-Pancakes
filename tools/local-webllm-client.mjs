/**
 * Promise-based client for the shared local WebLLM worker.
 */

export const LOCAL_MODEL_OPTIONS = Object.freeze([
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Small",
    details: "About 0.8 GB download and 0.9 GB GPU memory",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Medium",
    details: "About 2.0 GB download and 2.3 GB GPU memory",
  },
]);

export class LocalWebLlmClient {
  constructor(options = {}) {
    this.workerUrl = options.workerUrl ?? "./local-webllm-worker.js?v=1";
    this.worker = null;
    this.pending = new Map();
    this.loadedModelId = null;
    this.onProgress = options.onProgress ?? (() => {});
  }

  isSupported() {
    return Boolean(globalThis.navigator?.gpu && globalThis.Worker);
  }

  async load(modelId) {
    if (!this.isSupported()) throw new Error("WebGPU is unavailable in this browser or device.");
    this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set("model-load", { resolve, reject });
      this.worker.postMessage({ type: "load", modelId });
    });
  }

  async generate({ system, user, json = false, temperature = 0.2, maxTokens = 1600, onStream = () => {} }) {
    this.ensureWorker();
    if (!this.loadedModelId) throw new Error("Load a local model first.");
    const requestId = globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}`;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onStream });
    });
    this.worker.postMessage({ type: "generate", requestId, system, user, json, temperature, maxTokens });
    return { requestId, promise };
  }

  cancel(requestId) {
    this.worker?.postMessage({ type: "cancel", requestId });
  }

  unload() {
    this.worker?.postMessage({ type: "unload" });
    this.loadedModelId = null;
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.loadedModelId = null;
    this.pending.forEach(({ reject }) => reject(new Error("Local model worker was closed.")));
    this.pending.clear();
  }

  ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(this.workerUrl);
    this.worker.addEventListener("message", (event) => this.handleMessage(event.data ?? {}));
    this.worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "The local model worker failed.");
      this.pending.forEach(({ reject }) => reject(error));
      this.pending.clear();
    });
  }

  handleMessage(message) {
    if (message.type === "model-progress") {
      this.onProgress(message);
      return;
    }
    if (message.type === "model-ready") {
      this.loadedModelId = message.modelId;
      this.pending.get("model-load")?.resolve(message.modelId);
      this.pending.delete("model-load");
      return;
    }
    if (message.type === "model-error") {
      this.pending.get("model-load")?.reject(new Error(message.error));
      this.pending.delete("model-load");
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === "generation-stream") pending.onStream(message.text);
    if (message.type === "generation-complete") {
      pending.resolve(message.text);
      this.pending.delete(message.requestId);
    }
    if (message.type === "generation-error") {
      pending.reject(new Error(message.error));
      this.pending.delete(message.requestId);
    }
    if (message.type === "generation-cancelled") {
      const error = new DOMException("Generation cancelled.", "AbortError");
      pending.reject(error);
      this.pending.delete(message.requestId);
    }
  }
}
