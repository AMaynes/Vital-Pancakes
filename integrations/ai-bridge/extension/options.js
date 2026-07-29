import {
  DEFAULT_GATEWAY_PORT,
  isValidPairingToken,
} from "./bridge-shared.js";

const form = document.querySelector("#settings-form");
const tokenInput = document.querySelector("#pairing-token");
const portInput = document.querySelector("#gateway-port");
const clearButton = document.querySelector("#clear-pairing");
const message = document.querySelector("#settings-message");
document.querySelector("#extension-id").textContent = chrome.runtime.id;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pairingToken = tokenInput.value.trim();
  const gatewayPort = Number(portInput.value);
  if (!isValidPairingToken(pairingToken)) {
    message.textContent = "Use the complete pairing token printed by the setup command.";
    return;
  }
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65_535) {
    message.textContent = "Enter a valid local port.";
    return;
  }
  await chrome.storage.local.set({ pairingToken, gatewayPort });
  message.textContent = "Pairing saved.";
});

clearButton.addEventListener("click", async () => {
  await chrome.storage.local.remove(["pairingToken"]);
  tokenInput.value = "";
  message.textContent = "Pairing forgotten. This extension can no longer authenticate.";
});

const settings = await chrome.storage.local.get({
  pairingToken: "",
  gatewayPort: DEFAULT_GATEWAY_PORT,
});
tokenInput.value = settings.pairingToken;
portInput.value = settings.gatewayPort;
