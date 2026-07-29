const gatewayStatus = document.querySelector("#gateway-status");
const pageStatus = document.querySelector("#page-status");
const connectButton = document.querySelector("#connect-page");
const disconnectButton = document.querySelector("#disconnect-page");
const optionsButton = document.querySelector("#open-options");
const message = document.querySelector("#message");
const permissionInputs = [...document.querySelectorAll(
  '#permission-controls input[type="checkbox"]',
)];

let activeTabId = null;

connectButton.addEventListener("click", async () => {
  message.textContent = "";
  const result = await chrome.runtime.sendMessage({
    kind: "popup.connect",
    tabId: activeTabId,
    permissions: permissionInputs
      .filter((input) => input.checked)
      .map((input) => input.value),
  });
  if (!result?.ok) message.textContent = result?.message || "Unable to connect this tab.";
  await refresh();
});

disconnectButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    kind: "popup.disconnect",
    tabId: activeTabId,
  });
  await refresh();
});

optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  const status = await chrome.runtime.sendMessage({
    kind: "popup.status",
    tabId: activeTabId,
  });
  gatewayStatus.textContent = gatewayLabel(status.socketState);
  pageStatus.textContent = status.pageConnected
    ? `Connected: ${status.pageTitle || "Vital Pancakes"}`
    : status.pageReady
      ? "This Vital Pancakes tab is ready to connect."
      : "Open or reload a Vital Pancakes page in this tab.";
  connectButton.disabled = !status.pageReady || status.pageConnected;
  disconnectButton.disabled = !status.pageConnected;
  for (const input of permissionInputs) {
    input.checked = status.permissions.includes(input.value);
    input.disabled = status.pageConnected;
  }
}

function gatewayLabel(state) {
  const labels = {
    connected: "Local companion connected.",
    connecting: "Connecting to the local companion…",
    disconnected: "Local companion is not running.",
    "not-configured": "Pairing token required.",
  };
  return labels[state] || "Local companion unavailable.";
}

void refresh();
