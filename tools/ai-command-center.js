import { installAiPageHost } from "../app/ai-page-host.mjs";
import {
  AI_PERMISSION_LEVELS,
  normalizeAiCommandEnvelope,
} from "../app/ai-command-protocol.mjs";
import { CURRENT_AI_TOOLS } from "../app/ai-tool-catalog.mjs";
import { createAiCommandCenterAdapter } from "./ai-command-center-adapter.mjs";
import {
  buildAiCommandPrompt,
  createAiRequestId,
  normalizeGeneratedCommandDraft,
  parseGeneratedJson,
} from "./ai-command-draft.mjs";

const elements = Object.fromEntries([
  "webgpu-status",
  "model-select",
  "load-model",
  "cancel-model",
  "model-progress-wrap",
  "model-progress",
  "model-progress-text",
  "target-tool",
  "target-status",
  "natural-request",
  "include-content",
  "draft-with-model",
  "command-editor",
  "format-command",
  "preview-command",
  "apply-command",
  "copy-capabilities",
  "command-status",
  "command-result",
  "tool-frame",
  "stage-title",
  "reload-target",
].map((id) => [id, document.getElementById(id)]));

const TARGET_TOOLS = CURRENT_AI_TOOLS.filter((tool) => tool.id !== "ai-command-center");
const MODEL_DETAILS = {
  "Llama-3.2-1B-Instruct-q4f16_1-MLC": "Small model · about 0.8 GB download and 0.9 GB GPU memory",
  "Llama-3.2-3B-Instruct-q4f16_1-MLC": "Medium model · about 2.0 GB download and 2.3 GB GPU memory",
};

let commandCenterRevision = 0;
let activeTool = TARGET_TOOLS.find((tool) => tool.id === "visual-board") ?? TARGET_TOOLS[0];
let targetApi = null;
let targetCapabilities = null;
let targetRevision = 0;
let targetLoadSequence = 0;
let modelWorker = null;
let modelReady = false;
let modelLoadPromise = null;
let rejectModelLoad = null;
let activeGeneration = null;
let lastPreviewEnvelope = null;
let lastPreviewSource = "";

installAiPageHost(createAiCommandCenterAdapter({
  getState: getCommandCenterState,
  allowedToolIds: TARGET_TOOLS.map((tool) => tool.id),
  commit: applyCommandCenterState,
}));

initialize();

async function initialize() {
  populateTargetTools();
  bindEvents();
  await detectWebGpu();
  await openTarget(activeTool.id);
}

function populateTargetTools() {
  elements["target-tool"].replaceChildren(...TARGET_TOOLS.map((tool) => {
    const option = document.createElement("option");
    option.value = tool.id;
    option.textContent = tool.title;
    return option;
  }));
  elements["target-tool"].value = activeTool.id;
}

function bindEvents() {
  elements["target-tool"].addEventListener("change", () => {
    void openTarget(elements["target-tool"].value);
  });
  elements["reload-target"].addEventListener("click", () => void openTarget(activeTool.id, true));
  elements["load-model"].addEventListener("click", () => void loadSelectedModel());
  elements["cancel-model"].addEventListener("click", cancelModel);
  elements["draft-with-model"].addEventListener("click", () => void draftWithLocalModel());
  elements["preview-command"].addEventListener("click", () => void previewCommand());
  elements["apply-command"].addEventListener("click", () => void applyCommand());
  elements["format-command"].addEventListener("click", formatCommand);
  elements["copy-capabilities"].addEventListener("click", () => void copyCapabilities());
  elements["command-editor"].addEventListener("input", invalidatePreview);
}

async function detectWebGpu() {
  if (!navigator.gpu) {
    setWebGpuStatus("WebGPU unavailable", "error");
    elements["load-model"].disabled = true;
    return;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    setWebGpuStatus("WebGPU ready", "ready");
  } catch {
    setWebGpuStatus("WebGPU unavailable", "error");
    elements["load-model"].disabled = true;
  }
}

async function openTarget(toolId, forceReload = false) {
  const tool = TARGET_TOOLS.find((candidate) => candidate.id === toolId);
  if (!tool) throw new Error(`Unknown tool: ${toolId}`);
  activeTool = tool;
  elements["target-tool"].value = tool.id;
  elements["stage-title"].textContent = tool.title;
  targetApi = null;
  targetCapabilities = null;
  targetRevision = 0;
  invalidatePreview();
  setTargetStatus("Opening AI-capable tool…");
  elements["copy-capabilities"].disabled = true;
  elements["preview-command"].disabled = true;
  elements["draft-with-model"].disabled = true;
  const sequence = ++targetLoadSequence;
  const nextUrl = new URL(`../${tool.route}`, window.location.href);
  nextUrl.searchParams.set("aiHost", "1");
  if (forceReload) nextUrl.searchParams.set("aiReload", Date.now().toString(36));
  const frameLoaded = onceFrameLoaded(elements["tool-frame"]);
  elements["tool-frame"].src = nextUrl.href;

  try {
    await frameLoaded;
    const api = await waitForFrameApi(elements["tool-frame"], tool.id, sequence);
    if (sequence !== targetLoadSequence) return;
    targetApi = api;
    await refreshTargetDescription();
    setTargetStatus(`Ready · revision ${targetRevision}`, "success");
    elements["copy-capabilities"].disabled = false;
    elements["preview-command"].disabled = !elements["command-editor"].value.trim();
    elements["draft-with-model"].disabled = !modelReady;
    commandCenterRevision += 1;
  } catch (error) {
    if (sequence !== targetLoadSequence) return;
    setTargetStatus(
      `${error.message} This tool needs its AI adapter updated before models can use it.`,
      "error",
    );
  }
}

async function refreshTargetDescription() {
  const tools = targetApi.listTools();
  const descriptor = tools.find((tool) => tool.id === activeTool.id);
  if (!descriptor) throw new Error(`${activeTool.title} did not register its AI adapter.`);
  targetRevision = descriptor.revision;
  targetCapabilities = await targetApi.getCapabilities(activeTool.id);
}

async function loadSelectedModel() {
  if (modelLoadPromise) return modelLoadPromise;
  const worker = ensureModelWorker();
  const modelId = elements["model-select"].value;
  elements["model-progress-wrap"].hidden = false;
  elements["cancel-model"].hidden = false;
  elements["load-model"].disabled = true;
  elements["model-progress"].value = 0;
  elements["model-progress-text"].textContent = MODEL_DETAILS[modelId];
  setWebGpuStatus("Loading local model");
  modelLoadPromise = new Promise((resolve, reject) => {
    rejectModelLoad = reject;
    const handleMessage = (event) => {
      const message = event.data ?? {};
      if (message.type === "model-progress") {
        elements["model-progress"].value = Number(message.progress ?? 0);
        elements["model-progress-text"].textContent = message.text;
      } else if (message.type === "model-ready") {
        cleanup();
        modelReady = true;
        setWebGpuStatus("Local model ready", "ready");
        elements["model-progress-wrap"].hidden = true;
        elements["cancel-model"].hidden = true;
        elements["load-model"].textContent = "Model loaded";
        elements["draft-with-model"].disabled = !targetApi;
        resolve();
      } else if (message.type === "model-error") {
        cleanup();
        reject(new Error(message.error));
      }
    };
    const cleanup = () => {
      worker.removeEventListener("message", handleMessage);
      rejectModelLoad = null;
    };
    worker.addEventListener("message", handleMessage);
    worker.postMessage({ type: "load", modelId });
  });
  try {
    await modelLoadPromise;
  } catch (error) {
    setWebGpuStatus("Model load failed", "error");
    setCommandStatus(error.message, "error");
    elements["load-model"].disabled = false;
    elements["cancel-model"].hidden = true;
  } finally {
    modelLoadPromise = null;
  }
}

function cancelModel() {
  rejectModelLoad?.(new Error("Local model loading was cancelled."));
  rejectModelLoad = null;
  modelWorker?.terminate();
  modelWorker = null;
  modelReady = false;
  modelLoadPromise = null;
  activeGeneration = null;
  elements["model-progress-wrap"].hidden = true;
  elements["cancel-model"].hidden = true;
  elements["load-model"].disabled = false;
  elements["load-model"].textContent = "Load local model";
  elements["draft-with-model"].disabled = true;
  setWebGpuStatus("Model stopped");
}

async function draftWithLocalModel() {
  const request = elements["natural-request"].value.trim();
  if (!request) {
    setCommandStatus("Describe what you want the tool to do.", "error");
    elements["natural-request"].focus();
    return;
  }
  if (!modelReady || !targetApi) return;
  if (activeGeneration) {
    modelWorker.postMessage({ type: "cancel", requestId: activeGeneration.requestId });
  }

  setCommandStatus("Reading bounded tool context…");
  elements["draft-with-model"].disabled = true;
  try {
    await refreshTargetDescription();
    const context = await targetApi.getContext(
      activeTool.id,
      createTargetContextOptions(
        activeTool.id,
        elements["include-content"].checked,
      ),
    );
    const prompt = buildAiCommandPrompt({
      toolId: activeTool.id,
      capabilities: targetCapabilities,
      context: boundPromptContext(context),
      request,
      revision: targetRevision,
    });
    const requestId = createAiRequestId("webllm");
    const output = await generateWithWorker({ ...prompt, requestId });
    const draft = normalizeGeneratedCommandDraft(parseGeneratedJson(output), {
      toolId: activeTool.id,
      revision: targetRevision,
      requestId,
    });
    elements["command-editor"].value = JSON.stringify(draft, null, 2);
    await previewCommand();
  } catch (error) {
    setCommandStatus(error.message || "Unable to draft commands.", "error");
  } finally {
    elements["draft-with-model"].disabled = !modelReady || !targetApi;
  }
}

function generateWithWorker({ requestId, system, user }) {
  const worker = ensureModelWorker();
  return new Promise((resolve, reject) => {
    activeGeneration = { requestId };
    const handleMessage = (event) => {
      const message = event.data ?? {};
      if (message.requestId !== requestId) return;
      if (message.type === "generation-stream") {
        setCommandStatus(`Drafting locally… ${message.text.length.toLocaleString()} characters`);
      } else if (message.type === "generation-complete") {
        cleanup();
        resolve(message.text);
      } else if (message.type === "generation-error") {
        cleanup();
        reject(new Error(message.error));
      }
    };
    const cleanup = () => {
      worker.removeEventListener("message", handleMessage);
      if (activeGeneration?.requestId === requestId) activeGeneration = null;
    };
    worker.addEventListener("message", handleMessage);
    worker.postMessage({ type: "generate", requestId, system, user });
  });
}

async function previewCommand() {
  if (!targetApi) return;
  try {
    await refreshTargetDescription();
    const parsed = parseGeneratedJson(elements["command-editor"].value);
    const requestId = typeof parsed?.requestId === "string"
      ? parsed.requestId
      : createAiRequestId("manual");
    const envelope = normalizeGeneratedCommandDraft(parsed, {
      toolId: activeTool.id,
      revision: targetRevision,
      requestId,
    });
    const receipt = await targetApi.dispatch(envelope, {
      grantedPermissions: AI_PERMISSION_LEVELS,
    });
    elements["command-editor"].value = JSON.stringify(envelope, null, 2);
    elements["command-result"].textContent = JSON.stringify(receipt, null, 2);
    if (!receipt.ok) {
      lastPreviewEnvelope = null;
      elements["apply-command"].disabled = true;
      setCommandStatus(receipt.error?.message ?? "Command validation failed.", "error");
      return;
    }
    lastPreviewEnvelope = envelope;
    lastPreviewSource = elements["command-editor"].value;
    elements["apply-command"].disabled = false;
    setCommandStatus("Preview passed. Review the live tool and receipt, then apply.", "success");
    commandCenterRevision += 1;
  } catch (error) {
    lastPreviewEnvelope = null;
    elements["apply-command"].disabled = true;
    setCommandStatus(error.message || "Command validation failed.", "error");
  }
}

async function applyCommand() {
  if (
    !targetApi
    || !lastPreviewEnvelope
    || elements["command-editor"].value !== lastPreviewSource
  ) {
    invalidatePreview();
    return;
  }
  if (requiresDeleteConfirmation(lastPreviewEnvelope) && !window.confirm(
    "This command can delete tool content. Apply it now?",
  )) {
    return;
  }
  elements["apply-command"].disabled = true;
  const envelope = normalizeAiCommandEnvelope({
    ...lastPreviewEnvelope,
    mode: "apply",
  });
  const receipt = await targetApi.dispatch(envelope, {
    grantedPermissions: AI_PERMISSION_LEVELS,
  });
  elements["command-result"].textContent = JSON.stringify(receipt, null, 2);
  if (!receipt.ok) {
    setCommandStatus(receipt.error?.message ?? "The command was not applied.", "error");
    return;
  }
  setCommandStatus("Command applied through the tool’s validated adapter.", "success");
  lastPreviewEnvelope = null;
  lastPreviewSource = "";
  await refreshTargetDescription();
  setTargetStatus(`Ready · revision ${targetRevision}`, "success");
  commandCenterRevision += 1;
}

function invalidatePreview() {
  lastPreviewEnvelope = null;
  lastPreviewSource = "";
  elements["apply-command"].disabled = true;
  elements["preview-command"].disabled = !targetApi || !elements["command-editor"].value.trim();
}

function formatCommand() {
  try {
    elements["command-editor"].value = JSON.stringify(
      parseGeneratedJson(elements["command-editor"].value),
      null,
      2,
    );
    invalidatePreview();
    setCommandStatus("Command JSON formatted. Preview it again.");
  } catch (error) {
    setCommandStatus(error.message, "error");
  }
}

async function copyCapabilities() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(targetCapabilities, null, 2));
    setCommandStatus("Capabilities copied.");
  } catch {
    elements["command-result"].textContent = JSON.stringify(targetCapabilities, null, 2);
    setCommandStatus("Clipboard unavailable; capabilities are shown below.");
  }
}

function requiresDeleteConfirmation(envelope) {
  const definitions = new Map(
    (targetCapabilities?.commands ?? []).map((command) => [command.type, command]),
  );
  return envelope.commands.some((command) => (
    definitions.get(command.type)?.permissions?.includes("delete")
  ));
}

function boundPromptContext(context) {
  const serialized = JSON.stringify(context);
  if (serialized.length <= 120_000) return context;
  return {
    truncated: true,
    note: "The tool context exceeded the local prompt budget.",
    jsonExcerpt: serialized.slice(0, 120_000),
  };
}

function createTargetContextOptions(toolId, includeContent) {
  const options = { grantedPermissions: AI_PERMISSION_LEVELS };
  if (toolId === "visual-board") {
    return {
      ...options,
      scope: "viewport",
      detail: "geometry",
      maximumObjects: 300,
    };
  }
  if (toolId === "caption-relay") {
    return {
      ...options,
      includeCueText: includeContent,
      cueLimit: 200,
    };
  }
  return { ...options, includeContent };
}

function ensureModelWorker() {
  modelWorker ??= new Worker("./ai-webllm-worker.js", { type: "module" });
  return modelWorker;
}

function onceFrameLoaded(frame) {
  return new Promise((resolve) => {
    frame.addEventListener("load", resolve, { once: true });
  });
}

async function waitForFrameApi(frame, toolId, sequence) {
  const deadline = performance.now() + 12_000;
  while (performance.now() < deadline) {
    if (sequence !== targetLoadSequence) throw new Error("Tool opening was superseded.");
    try {
      const api = frame.contentWindow?.VitalPancakesAI;
      if (api?.listTools?.().some((tool) => tool.id === toolId)) return api;
    } catch {
      throw new Error("The selected tool is not on the Vital Pancakes origin.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error(`${activeTool.title} did not expose its AI command API.`);
}

function getCommandCenterState() {
  return {
    revision: commandCenterRevision,
    targetToolId: activeTool?.id ?? "",
    draft: elements["command-editor"]?.value ?? "",
    previewOk: Boolean(lastPreviewEnvelope),
  };
}

async function applyCommandCenterState(nextState) {
  if (nextState.targetToolId && nextState.targetToolId !== activeTool?.id) {
    await openTarget(nextState.targetToolId);
  }
  elements["command-editor"].value = nextState.draft;
  invalidatePreview();
  commandCenterRevision += 1;
  return commandCenterRevision;
}

function setWebGpuStatus(text, state = "") {
  elements["webgpu-status"].textContent = text;
  elements["webgpu-status"].className = `ai-status-badge${state ? ` is-${state}` : ""}`;
}

function setTargetStatus(text, state = "") {
  elements["target-status"].textContent = text;
  elements["target-status"].className = `ai-inline-status${state ? ` is-${state}` : ""}`;
}

function setCommandStatus(text, state = "") {
  elements["command-status"].textContent = text;
  elements["command-status"].className = `ai-inline-status${state ? ` is-${state}` : ""}`;
}
