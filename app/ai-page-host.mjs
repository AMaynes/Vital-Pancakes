import { createAiCommandRegistry } from "./ai-command-registry.mjs";
import { cloneJson } from "./ai-command-protocol.mjs";

const PAGE_BRIDGE_CHANNEL = "vital-pancakes-ai-bridge-v1";
const MAXIMUM_BRIDGE_BYTES = 1_048_576;
const MAXIMUM_BRIDGE_ARGUMENTS = 16;
const PUBLIC_METHODS = new Set([
  "listTools",
  "getCapabilities",
  "getContext",
  "dispatch",
  "undo",
  "redo",
  "exportTool",
]);

const registry = createAiCommandRegistry();
let installedApi = null;
let bridgeIsListening = false;
const pagePorts = new Map();

/**
 * Registers a page-local adapter and exposes the provider-independent API.
 *
 * @param {object} adapter Tool adapter.
 * @returns {object} Frozen public API.
 */
export function installAiPageHost(adapter) {
  registry.register(adapter);
  if (!installedApi) installedApi = createPublicApi();
  if (typeof window !== "undefined") {
    if (window.VitalPancakesAI !== installedApi) {
      Object.defineProperty(window, "VitalPancakesAI", {
        value: installedApi,
        configurable: false,
        enumerable: true,
        writable: false,
      });
    }
    startPageBridge();
    window.dispatchEvent(new CustomEvent("vital-pancakes-ai-ready", {
      detail: { tools: installedApi.listTools() },
    }));
  }
  return installedApi;
}

export function getAiPageRegistry() {
  return registry;
}

function createPublicApi() {
  return Object.freeze({
    version: 1,
    listTools: () => cloneJson(registry.listTools()),
    getCapabilities: (toolId) => registry.getCapabilities(toolId),
    getContext: (toolId, options) => registry.getContext(toolId, options),
    dispatch: (envelope, options) => registry.dispatch(envelope, options),
    undo: (toolId) => registry.undo(toolId),
    redo: (toolId) => registry.redo(toolId),
    exportTool: (toolId, options) => registry.exportTool(toolId, options),
  });
}

function startPageBridge() {
  if (bridgeIsListening) return;
  bridgeIsListening = true;
  window.addEventListener("message", acceptPageBridgeConnection);
}

function acceptPageBridgeConnection(event) {
  const message = event.data;
  if (
    event.source !== window
    || event.origin !== window.location.origin
    || !isPlainRecord(message)
    || message.channel !== PAGE_BRIDGE_CHANNEL
    || message.kind !== "connect"
    || !/^[A-Za-z0-9_-]{16,160}$/.test(message.connectionId ?? "")
    || event.ports.length !== 1
  ) {
    return;
  }

  const port = event.ports[0];
  pagePorts.get(message.connectionId)?.close();
  pagePorts.set(message.connectionId, port);
  const controllers = new Map();
  port.addEventListener("message", (portEvent) => {
    void handlePageBridgeMessage(port, controllers, portEvent.data);
  });
  port.addEventListener("messageerror", () => port.close(), { once: true });
  port.start();
  port.postMessage({
    channel: PAGE_BRIDGE_CHANNEL,
    kind: "ready",
    connectionId: message.connectionId,
    page: {
      protocolVersion: installedApi.version,
      title: String(document.title).slice(0, 300),
      tools: installedApi.listTools().map((tool) => tool.id),
    },
  });
}

async function handlePageBridgeMessage(port, controllers, message) {
  if (!isPlainRecord(message) || message.channel !== PAGE_BRIDGE_CHANNEL) return;
  if (message.kind === "cancel") {
    controllers.get(message.requestId)?.abort();
    controllers.delete(message.requestId);
    return;
  }
  if (message.kind !== "request") return;

  const requestId = String(message.requestId ?? "");
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(requestId)) {
    postBridgeFailure(port, requestId || null, "invalid-request", "The bridge request ID is invalid.");
    return;
  }
  if (!PUBLIC_METHODS.has(message.method)) {
    postBridgeFailure(port, requestId, "unknown-method", "The requested page method is not available.");
    return;
  }
  if (bridgeByteLength(message) > MAXIMUM_BRIDGE_BYTES) {
    postBridgeFailure(port, requestId, "request-too-large", "The bridge request is too large.");
    return;
  }

  const args = Array.isArray(message.params?.args) ? message.params.args : [];
  if (args.length > MAXIMUM_BRIDGE_ARGUMENTS) {
    postBridgeFailure(port, requestId, "too-many-arguments", "The bridge request has too many arguments.");
    return;
  }
  const controller = new AbortController();
  controllers.set(requestId, controller);
  try {
    const normalizedArgs = cloneJson(args);
    addAbortSignal(message.method, normalizedArgs, controller.signal);
    const result = await installedApi[message.method](...normalizedArgs);
    if (bridgeByteLength(result) > MAXIMUM_BRIDGE_BYTES) {
      throw Object.assign(new Error("The page result is too large for the bridge."), {
        code: "response-too-large",
      });
    }
    port.postMessage({
      channel: PAGE_BRIDGE_CHANNEL,
      kind: "response",
      requestId,
      ok: true,
      result,
    });
  } catch (error) {
    postBridgeFailure(
      port,
      requestId,
      String(error?.code || (controller.signal.aborted ? "request-cancelled" : "page-api-failure")),
      controller.signal.aborted ? "The page request was cancelled." : String(error?.message || "The page request failed."),
    );
  } finally {
    controllers.delete(requestId);
  }
}

function addAbortSignal(method, args, signal) {
  if (method === "dispatch") {
    args[1] = { ...(isPlainRecord(args[1]) ? args[1] : {}), signal };
  }
}

function postBridgeFailure(port, requestId, code, message) {
  port.postMessage({
    channel: PAGE_BRIDGE_CHANNEL,
    kind: "response",
    requestId,
    ok: false,
    error: {
      code: String(code).slice(0, 120),
      message: String(message).slice(0, 500),
    },
  });
}

function bridgeByteLength(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  if (serialized === undefined) return 0;
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(serialized).byteLength
    : serialized.length;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
