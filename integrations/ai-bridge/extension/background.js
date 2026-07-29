import {
  BRIDGE_PROTOCOL_VERSION,
  createClientProof,
  createNonce,
  createServerProof,
  DEFAULT_GATEWAY_PORT,
  isPageApiMethod,
  isValidPairingToken,
  MAX_MESSAGE_CHARACTERS,
  PAGE_CHANNEL,
  proofsMatch,
} from "./bridge-shared.js";
import {
  applyPermissionCeiling,
  DEFAULT_BRIDGE_PERMISSIONS,
  normalizePermissionSelection,
} from "./permission-policy.js";

const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_MAX_MS = 30_000;

const pageCandidates = new Map();
const enabledTabIds = new Set();
const tabPermissionCeilings = new Map();
const pendingRequests = new Map();
let socket = null;
let socketState = "disconnected";
let reconnectTimer = null;
let reconnectDelayMs = 1_000;
let heartbeatTimer = null;
let handshake = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PAGE_CHANNEL || port.sender.frameId !== 0 || !port.sender.tab) return;
  const tabId = port.sender.tab.id;
  let pageId = null;

  port.onMessage.addListener((message) => {
    if (!message || message.channel !== PAGE_CHANNEL) return;
    if (message.kind === "page.ready") {
      try {
        const descriptor = buildPageDescriptor(port.sender, message);
        pageId = descriptor.pageId;
        pageCandidates.set(pageId, { port, tabId, descriptor });
        if (enabledTabIds.has(tabId)) {
          syncPages();
          sendPageActive(pageId);
        }
      } catch (error) {
        port.postMessage({
          channel: PAGE_CHANNEL,
          kind: "bridge.error",
          error: { code: "invalid_page", message: error.message },
        });
      }
      return;
    }
    if (message.kind === "response" && pageId) {
      completePageRequest(pageId, message);
    }
  });

  port.onDisconnect.addListener(() => {
    if (!pageId) return;
    const candidate = pageCandidates.get(pageId);
    if (candidate?.port === port) pageCandidates.delete(pageId);
    failRequestsForPage(pageId, "page_disconnected", "The connected page closed or reloaded.");
    syncPages();
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.kind !== "string") return false;
  if (message.kind === "popup.status") {
    sendResponse(getPopupStatus(message.tabId));
    return false;
  }
  if (message.kind === "popup.connect") {
    void connectTab(message.tabId, message.permissions).then(sendResponse);
    return true;
  }
  if (message.kind === "popup.disconnect") {
    disconnectTab(message.tabId);
    sendResponse(getPopupStatus(message.tabId));
    return false;
  }
  if (message.kind === "popup.reconnect-gateway") {
    reconnectGateway();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.pairingToken || changes.gatewayPort) reconnectGateway();
});

chrome.runtime.onInstalled.addListener(() => void ensureGatewayConnection());
chrome.runtime.onStartup.addListener(() => void ensureGatewayConnection());
void ensureGatewayConnection();

async function ensureGatewayConnection() {
  if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;
  const settings = await chrome.storage.local.get({
    pairingToken: "",
    gatewayPort: DEFAULT_GATEWAY_PORT,
  });
  if (!isValidPairingToken(settings.pairingToken)) {
    setSocketState("not-configured");
    return;
  }
  const gatewayPort = Number(settings.gatewayPort);
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65_535) {
    setSocketState("not-configured");
    return;
  }

  setSocketState("connecting");
  const nextSocket = new WebSocket(`ws://127.0.0.1:${gatewayPort}`);
  socket = nextSocket;
  handshake = { token: settings.pairingToken };

  nextSocket.addEventListener("message", (event) => {
    void handleGatewayMessage(nextSocket, event.data);
  });
  nextSocket.addEventListener("close", () => {
    if (socket !== nextSocket) return;
    socket = null;
    handshake = null;
    stopHeartbeat();
    setSocketState("disconnected");
    scheduleReconnect();
  });
  nextSocket.addEventListener("error", () => {
    if (nextSocket.readyState === WebSocket.OPEN) nextSocket.close();
  });
}

async function handleGatewayMessage(activeSocket, serialized) {
  if (activeSocket !== socket || typeof serialized !== "string") return;
  if (serialized.length > MAX_MESSAGE_CHARACTERS) {
    activeSocket.close(4400, "Bridge message too large.");
    return;
  }
  let message;
  try {
    message = JSON.parse(serialized);
  } catch {
    activeSocket.close(4400, "Bridge message is not JSON.");
    return;
  }
  if (message.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    activeSocket.close(4400, "Bridge protocol mismatch.");
    return;
  }

  if (message.kind === "hello") {
    const extensionNonce = createNonce();
    handshake = {
      ...handshake,
      serverNonce: message.serverNonce,
      extensionNonce,
    };
    sendGateway({
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      kind: "authenticate",
      extensionId: chrome.runtime.id,
      extensionNonce,
      proof: await createClientProof({
        token: handshake.token,
        serverNonce: message.serverNonce,
        extensionNonce,
        extensionId: chrome.runtime.id,
      }),
    });
    return;
  }

  if (message.kind === "authenticated") {
    if (!handshake?.serverNonce || !handshake?.extensionNonce) {
      activeSocket.close(4401, "Unexpected authentication response.");
      return;
    }
    const expectedProof = await createServerProof({
      token: handshake.token,
      serverNonce: handshake.serverNonce,
      extensionNonce: handshake.extensionNonce,
      extensionId: chrome.runtime.id,
      sessionId: message.sessionId,
    });
    if (!proofsMatch(expectedProof, message.serverProof)) {
      activeSocket.close(4401, "Server pairing proof rejected.");
      return;
    }
    reconnectDelayMs = 1_000;
    setSocketState("connected");
    startHeartbeat();
    syncPages();
    return;
  }

  if (socketState !== "connected") return;
  if (message.kind === "request") {
    routeGatewayRequest(message);
  } else if (message.kind === "cancel") {
    cancelGatewayRequest(message);
  }
}

function routeGatewayRequest(message) {
  if (
    typeof message.requestId !== "string"
    || typeof message.pageId !== "string"
    || !isPageApiMethod(message.method)
  ) {
    sendGatewayError(message.requestId, "invalid_request", "The gateway request is invalid.");
    return;
  }
  const candidate = pageCandidates.get(message.pageId);
  if (!candidate || !enabledTabIds.has(candidate.tabId)) {
    sendGatewayError(message.requestId, "page_not_connected", "The requested page is not connected.");
    return;
  }
  if (Number.isFinite(message.deadlineMs) && Date.now() >= message.deadlineMs) {
    sendGatewayError(message.requestId, "request_expired", "The bridge request expired before delivery.");
    return;
  }
  let authorizedParams;
  try {
    authorizedParams = applyPermissionCeiling(
      message.method,
      message.params,
      tabPermissionCeilings.get(candidate.tabId) ?? [],
    );
  } catch (error) {
    sendGatewayError(
      message.requestId,
      String(error?.code || "permission_ceiling_exceeded"),
      error instanceof Error ? error.message : "This tab did not grant that permission.",
    );
    return;
  }
  pendingRequests.set(message.requestId, { pageId: message.pageId });
  candidate.port.postMessage({
    channel: PAGE_CHANNEL,
    kind: "request",
    requestId: message.requestId,
    method: message.method,
    params: authorizedParams,
  });
}

function cancelGatewayRequest(message) {
  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
  pendingRequests.delete(message.requestId);
  pageCandidates.get(pending.pageId)?.port.postMessage({
    channel: PAGE_CHANNEL,
    kind: "cancel",
    requestId: message.requestId,
  });
}

function completePageRequest(pageId, message) {
  const pending = pendingRequests.get(message.requestId);
  if (!pending || pending.pageId !== pageId) return;
  pendingRequests.delete(message.requestId);
  sendGateway({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: "response",
    requestId: message.requestId,
    ok: Boolean(message.ok),
    ...(message.ok
      ? { result: message.result }
      : { error: normalizeError(message.error) }),
  });
}

function failRequestsForPage(pageId, code, message) {
  for (const [requestId, pending] of pendingRequests) {
    if (pending.pageId !== pageId) continue;
    pendingRequests.delete(requestId);
    sendGatewayError(requestId, code, message);
  }
}

async function connectTab(tabId, requestedPermissions) {
  if (!Number.isInteger(tabId)) return { ok: false, message: "No active tab is available." };
  const candidate = findCandidateByTab(tabId);
  if (!candidate) {
    return {
      ok: false,
      message: "Vital Pancakes is not ready in this tab. Reload the page and try again.",
    };
  }
  const permissionCeiling = normalizePermissionSelection(
    Array.isArray(requestedPermissions)
      ? requestedPermissions
      : DEFAULT_BRIDGE_PERMISSIONS,
  );
  enabledTabIds.add(tabId);
  tabPermissionCeilings.set(tabId, permissionCeiling);
  await ensureGatewayConnection();
  syncPages();
  sendPageActive(candidate.descriptor.pageId);
  return getPopupStatus(tabId);
}

function disconnectTab(tabId) {
  enabledTabIds.delete(tabId);
  tabPermissionCeilings.delete(tabId);
  const candidate = findCandidateByTab(tabId);
  if (candidate) {
    failRequestsForPage(
      candidate.descriptor.pageId,
      "page_disconnected",
      "The user disconnected this page.",
    );
  }
  syncPages();
}

function findCandidateByTab(tabId) {
  return [...pageCandidates.values()].find((candidate) => candidate.tabId === tabId) ?? null;
}

function buildPageDescriptor(sender, message) {
  const url = new URL(sender.url || sender.tab.url);
  if (!isAllowedVitalPancakesUrl(url)) {
    throw new Error("This page is outside the Vital Pancakes origin allowlist.");
  }
  if (
    typeof message.connectionId !== "string"
    || !/^[A-Za-z0-9_-]{16,160}$/.test(message.connectionId)
  ) {
    throw new Error("The page connection ID is invalid.");
  }
  const page = message.page && typeof message.page === "object" ? message.page : {};
  const tools = Array.isArray(page.tools)
    ? page.tools.filter((toolId) => typeof toolId === "string").slice(0, 128)
    : [];
  return {
    pageId: `${chrome.runtime.id}:${sender.tab.id}:${message.connectionId}`,
    connectionId: message.connectionId,
    origin: url.origin,
    url: url.href,
    title: String(page.title || sender.tab.title || "Vital Pancakes").slice(0, 300),
    tools,
  };
}

function isAllowedVitalPancakesUrl(url) {
  if (
    url.origin === "https://amaynes.github.io"
    && url.pathname.startsWith("/Vital-Pancakes/")
  ) {
    return true;
  }
  return (
    url.protocol === "http:"
    && ["localhost", "127.0.0.1"].includes(url.hostname)
  );
}

function syncPages() {
  if (socketState !== "connected") return;
  const pages = [...pageCandidates.values()]
    .filter((candidate) => enabledTabIds.has(candidate.tabId))
    .map((candidate) => candidate.descriptor);
  sendGateway({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: "pages.sync",
    pages,
  });
}

function sendPageActive(pageId) {
  if (socketState !== "connected") return;
  sendGateway({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: "event",
    pageId,
    name: "page.active",
  });
}

function sendGatewayError(requestId, code, message) {
  if (typeof requestId !== "string") return;
  sendGateway({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: "response",
    requestId,
    ok: false,
    error: { code, message },
  });
}

function sendGateway(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  const serialized = JSON.stringify(message);
  if (serialized.length > MAX_MESSAGE_CHARACTERS) return false;
  socket.send(serialized);
  return true;
}

function normalizeError(error) {
  return {
    code: String(error?.code || "page_request_failed").slice(0, 120),
    message: String(error?.message || "The page rejected the request.").slice(0, 1_000),
    ...(error?.details && typeof error.details === "object"
      ? { details: error.details }
      : {}),
  };
}

function getPopupStatus(tabId) {
  const candidate = findCandidateByTab(tabId);
  return {
    ok: true,
    socketState,
    pageReady: Boolean(candidate),
    pageConnected: Boolean(candidate && enabledTabIds.has(tabId)),
    pageTitle: candidate?.descriptor.title ?? "",
    permissions: tabPermissionCeilings.get(tabId) ?? [...DEFAULT_BRIDGE_PERMISSIONS],
  };
}

function setSocketState(nextState) {
  socketState = nextState;
  void chrome.action.setBadgeText({
    text: nextState === "connected" ? "AI" : "",
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    void ensureGatewayConnection();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
}

function reconnectGateway() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  stopHeartbeat();
  if (socket) {
    const current = socket;
    socket = null;
    current.close(1000, "Bridge settings changed.");
  }
  setSocketState("disconnected");
  reconnectDelayMs = 1_000;
  void ensureGatewayConnection();
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    sendGateway({
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      kind: "ping",
      sentAt: Date.now(),
    });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}
