(() => {
  const CHANNEL = "vital-pancakes-ai-bridge-v1";
  const ALLOWED_METHODS = new Set([
    "listTools",
    "getCapabilities",
    "getContext",
    "dispatch",
    "undo",
    "redo",
    "exportTool",
  ]);
  const connectionId = createConnectionId();
  const runtimePort = chrome.runtime.connect({ name: CHANNEL });
  let pagePort = null;
  let isReady = false;
  let retryTimer = null;
  let attempts = 0;

  connectPage();

  runtimePort.onMessage.addListener((message) => {
    if (!message || message.channel !== CHANNEL) return;
    if (message.kind === "request") {
      if (!isReady || !pagePort || !ALLOWED_METHODS.has(message.method)) {
        runtimePort.postMessage({
          channel: CHANNEL,
          kind: "response",
          requestId: message.requestId,
          ok: false,
          error: {
            code: "page_api_unavailable",
            message: "The Vital Pancakes AI page API is not ready.",
          },
        });
        return;
      }
      pagePort.postMessage(message);
    } else if (message.kind === "cancel" && pagePort) {
      pagePort.postMessage(message);
    }
  });

  runtimePort.onDisconnect.addListener(() => {
    clearTimeout(retryTimer);
    pagePort?.close();
    pagePort = null;
    isReady = false;
  });

  function connectPage() {
    attempts += 1;
    const channel = new MessageChannel();
    pagePort?.close();
    pagePort = channel.port1;
    pagePort.addEventListener("message", handlePageMessage);
    pagePort.start();
    window.postMessage(
      {
        channel: CHANNEL,
        kind: "connect",
        connectionId,
      },
      window.location.origin,
      [channel.port2],
    );
    clearTimeout(retryTimer);
    if (!isReady && attempts < 120) {
      retryTimer = setTimeout(connectPage, 500);
    }
  }

  function handlePageMessage(event) {
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    if (message.kind === "ready") {
      if (message.connectionId !== connectionId) return;
      isReady = true;
      clearTimeout(retryTimer);
      runtimePort.postMessage({
        channel: CHANNEL,
        kind: "page.ready",
        connectionId,
        page: {
          protocolVersion: Number(message.page?.protocolVersion) || 1,
          title: String(message.page?.title || document.title),
          tools: Array.isArray(message.page?.tools) ? message.page.tools : [],
        },
      });
      return;
    }
    if (message.kind === "response") {
      runtimePort.postMessage(message);
    }
  }

  function createConnectionId() {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
  }
})();
