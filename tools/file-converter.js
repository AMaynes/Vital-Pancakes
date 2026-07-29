/**
 * Hosts the complete Convert to it! browser application inside the Vital
 * Pancakes workspace while preserving a useful local loading state.
 */

import { getConverterStatus } from "./file-converter-state.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
} from "./current-tool-ai-adapter.mjs";

const CONVERTER_URL = "./file-converter-app/index.html";
const LOAD_TIMEOUT_MS = 15_000;

const frame = document.querySelector("#converter-frame");
const status = document.querySelector("#converter-status");
const loadingPanel = document.querySelector("#converter-loading");
const loadingMessage = document.querySelector("#converter-loading-message");
const retryButton = document.querySelector("#retry-converter");

let loaded = false;
let timedOut = false;
let timeoutId = 0;

function renderStatus() {
  const nextStatus = getConverterStatus({
    online: navigator.onLine,
    loaded,
    timedOut,
  });

  status.textContent = nextStatus.label;
  status.dataset.tone = nextStatus.tone;
  loadingPanel.hidden = loaded;
  retryButton.hidden = !timedOut && navigator.onLine;

  if (!navigator.onLine) {
    loadingMessage.textContent = "Connect once to load the converter.";
  } else if (timedOut) {
    loadingMessage.textContent = "The conversion engines are taking longer than expected.";
  } else {
    loadingMessage.textContent = "Loading the complete converter…";
  }
}

function beginLoad() {
  window.clearTimeout(timeoutId);
  loaded = false;
  timedOut = false;
  renderStatus();

  timeoutId = window.setTimeout(() => {
    if (loaded) return;
    timedOut = true;
    renderStatus();
  }, LOAD_TIMEOUT_MS);
}

function reloadConverter() {
  beginLoad();
  frame.src = CONVERTER_URL;
}

frame.addEventListener("load", () => {
  window.clearTimeout(timeoutId);
  loaded = true;
  timedOut = false;
  renderStatus();
});

frame.addEventListener("error", () => {
  window.clearTimeout(timeoutId);
  timedOut = true;
  renderStatus();
});

retryButton.addEventListener("click", reloadConverter);
window.addEventListener("online", reloadConverter);
window.addEventListener("offline", renderStatus);

reloadConverter();

installCurrentToolAiHost({
  id: "file-converter",
  title: "File Converter",
  description: "Reports whether the embedded local conversion application is ready.",
  limitations: [
    "The embedded converter does not expose a stable command bridge yet.",
    "AI cannot select local files, configure conversions, run engines, or download output.",
  ],
  getSnapshot: () => ({
    online: navigator.onLine,
    loaded,
    timedOut,
  }),
  getContext: (_options, snapshot) => ({
    status: getConverterStatus(snapshot),
  }),
  commands: [
    {
      type: "status.get",
      description: "Report converter availability and loading state.",
      permissions: ["read-summary"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return { value: getConverterStatus(state) };
      },
    },
  ],
});
