import {
  ANGLE_MODES,
  CalculatorExpressionError,
  configureCalculatorMath,
  evaluateScientificExpression,
  normalizeAngleMode,
} from "./scientific-calculator-engine.mjs?v=1";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandString,
} from "./current-tool-ai-adapter.mjs";

const HISTORY_KEY = "vital-pancakes-scientific-calculator-history-v1";
const SETTINGS_KEY = "vital-pancakes-scientific-calculator-settings-v1";
const MAX_HISTORY_ITEMS = 50;

const expressionInput = document.querySelector("#calculator-expression");
const resultOutput = document.querySelector("#calculator-result");
const errorOutput = document.querySelector("#calculator-error");
const keys = document.querySelector("#calculator-keys");
const copyResultButton = document.querySelector("#calculator-copy-result");
const memoryStatus = document.querySelector("#calculator-memory-status");
const historyList = document.querySelector("#calculator-history-list");
const historyEmpty = document.querySelector("#calculator-history-empty");
const historyCount = document.querySelector("#calculator-history-count");
const clearHistoryButton = document.querySelector("#calculator-clear-history");
const saveStatus = document.querySelector("#calculator-save-status");
const angleButtons = [...document.querySelectorAll("[data-angle-mode]")];

const math = configureCalculatorMath(globalThis.math);
let settings = loadSettings();
let history = loadHistory();
let answer = settings.answer ? math.bignumber(settings.answer) : math.bignumber(0);
let memory = settings.memory ? math.bignumber(settings.memory) : math.bignumber(0);
let previewTimer = null;

renderAngleMode();
renderMemory();
renderHistory();
expressionInput.focus();

keys.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) event.preventDefault();
});

keys.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.insert !== undefined) {
    insertExpressionText(button.dataset.insert);
    return;
  }
  handleCalculatorAction(button.dataset.action);
});

document.querySelector(".calculator-memory").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (button) handleCalculatorAction(button.dataset.action);
});

angleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    settings.angleMode = normalizeAngleMode(button.dataset.angleMode);
    persistSettings();
    renderAngleMode();
    schedulePreview();
  });
});

expressionInput.addEventListener("input", () => {
  hideError();
  schedulePreview();
});

expressionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    calculate({ record: true, announceError: true });
  } else if (event.key === "Escape") {
    event.preventDefault();
    clearExpression();
  }
});

copyResultButton.addEventListener("click", copyResult);
clearHistoryButton.addEventListener("click", clearHistory);
historyList.addEventListener("click", handleHistoryClick);

function handleCalculatorAction(action) {
  switch (action) {
    case "evaluate":
      calculate({ record: true, announceError: true });
      break;
    case "clear":
      clearExpression();
      break;
    case "backspace":
      deleteExpressionCharacter();
      break;
    case "square":
      wrapSelectionOrExpression((value) => `(${value})^2`, "^2");
      break;
    case "reciprocal":
      wrapSelectionOrExpression((value) => `1/(${value})`, "1/(");
      break;
    case "negate":
      toggleExpressionSign();
      break;
    case "percent":
      wrapSelectionOrExpression((value) => `percent(${value})`, "/100");
      break;
    case "memory-clear":
      memory = math.bignumber(0);
      saveMemory();
      break;
    case "memory-recall":
      insertExpressionText(formatStoredNumber(memory));
      break;
    case "memory-add":
      updateMemory(1);
      break;
    case "memory-subtract":
      updateMemory(-1);
      break;
    default:
      break;
  }
}

function calculate({ record = false, announceError = false } = {}) {
  const expression = expressionInput.value.trim();
  if (!expression) {
    resultOutput.textContent = "0";
    hideError();
    return null;
  }

  try {
    const result = evaluateScientificExpression(math, expression, {
      angleMode: settings.angleMode,
      ans: answer,
    });
    resultOutput.textContent = result.display;
    hideError();
    if (record) {
      answer = result.value;
      persistSettings();
      addHistoryItem(expression, result.display);
    }
    return result;
  } catch (error) {
    resultOutput.textContent = "—";
    if (announceError) showError(getErrorMessage(error));
    return null;
  }
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => calculate(), 140);
}

function insertExpressionText(text) {
  const start = expressionInput.selectionStart ?? expressionInput.value.length;
  const end = expressionInput.selectionEnd ?? start;
  expressionInput.setRangeText(text, start, end, "end");
  expressionInput.dispatchEvent(new Event("input", { bubbles: true }));
  expressionInput.focus();
}

function wrapSelectionOrExpression(wrapper, emptyInsertion) {
  const start = expressionInput.selectionStart ?? 0;
  const end = expressionInput.selectionEnd ?? start;
  const selected = expressionInput.value.slice(start, end);
  if (selected) {
    expressionInput.setRangeText(wrapper(selected), start, end, "end");
  } else if (expressionInput.value.trim()) {
    expressionInput.value = wrapper(expressionInput.value);
    expressionInput.setSelectionRange(expressionInput.value.length, expressionInput.value.length);
  } else {
    expressionInput.setRangeText(emptyInsertion, start, end, "end");
  }
  expressionInput.dispatchEvent(new Event("input", { bubbles: true }));
  expressionInput.focus();
}

function toggleExpressionSign() {
  const value = expressionInput.value.trim();
  if (!value) {
    insertExpressionText("-");
    return;
  }
  if (value.startsWith("-(") && value.endsWith(")")) {
    expressionInput.value = value.slice(2, -1);
  } else {
    expressionInput.value = `-(${value})`;
  }
  expressionInput.setSelectionRange(expressionInput.value.length, expressionInput.value.length);
  expressionInput.dispatchEvent(new Event("input", { bubbles: true }));
  expressionInput.focus();
}

function deleteExpressionCharacter() {
  const start = expressionInput.selectionStart ?? expressionInput.value.length;
  const end = expressionInput.selectionEnd ?? start;
  if (start !== end) {
    expressionInput.setRangeText("", start, end, "end");
  } else if (start > 0) {
    expressionInput.setRangeText("", start - 1, start, "end");
  }
  expressionInput.dispatchEvent(new Event("input", { bubbles: true }));
  expressionInput.focus();
}

function clearExpression() {
  expressionInput.value = "";
  resultOutput.textContent = "0";
  hideError();
  expressionInput.focus();
}

function updateMemory(direction) {
  const result = calculate({ announceError: true });
  if (!result) return;
  memory = direction > 0 ? math.add(memory, result.value) : math.subtract(memory, result.value);
  saveMemory();
}

function saveMemory() {
  settings.memory = formatStoredNumber(memory);
  persistSettings();
  renderMemory();
}

function renderMemory() {
  memoryStatus.textContent = `M: ${formatStoredNumber(memory)}`;
}

async function copyResult() {
  const result = resultOutput.textContent.trim();
  if (!result || result === "—") return;
  try {
    await navigator.clipboard.writeText(result);
    setSaveStatus("Result copied");
  } catch {
    showError("The browser could not copy the result.");
  }
}

function addHistoryItem(expression, result) {
  const latest = history[0];
  if (
    latest
    && latest.expression === expression
    && latest.result === result
    && latest.angleMode === settings.angleMode
  ) return;

  history.unshift({
    id: globalThis.crypto?.randomUUID?.() ?? `calculation-${Date.now()}`,
    expression,
    result,
    angleMode: settings.angleMode,
    createdAt: new Date().toISOString(),
  });
  history = history.slice(0, MAX_HISTORY_ITEMS);
  persistHistory();
  renderHistory();
}

function handleHistoryClick(event) {
  const button = event.target.closest("button[data-history-id]");
  if (!button) return;
  const item = history.find((entry) => entry.id === button.dataset.historyId);
  if (!item) return;

  if (button.dataset.historyAction === "delete") {
    history = history.filter((entry) => entry.id !== item.id);
    persistHistory();
    renderHistory();
    return;
  }

  expressionInput.value = item.expression;
  settings.angleMode = item.angleMode;
  resultOutput.textContent = item.result;
  renderAngleMode();
  persistSettings();
  hideError();
  expressionInput.focus();
  expressionInput.setSelectionRange(expressionInput.value.length, expressionInput.value.length);
}

function renderHistory() {
  historyList.replaceChildren();
  historyEmpty.hidden = history.length > 0;
  historyCount.textContent = `${history.length} ${history.length === 1 ? "calculation" : "calculations"}`;
  clearHistoryButton.disabled = history.length === 0;

  history.forEach((item) => {
    const row = document.createElement("li");
    row.className = "calculator-history-item";

    const recall = document.createElement("button");
    recall.className = "calculator-history-recall";
    recall.type = "button";
    recall.dataset.historyId = item.id;
    recall.dataset.historyAction = "recall";
    recall.title = `Reuse ${item.expression}`;

    const expression = document.createElement("span");
    expression.className = "calculator-history-expression";
    expression.textContent = item.expression;
    const result = document.createElement("span");
    result.className = "calculator-history-result";
    result.textContent = `= ${item.result}`;
    const mode = document.createElement("span");
    mode.className = "calculator-history-mode";
    mode.textContent = item.angleMode;
    recall.append(expression, result, mode);

    const remove = document.createElement("button");
    remove.className = "calculator-history-delete";
    remove.type = "button";
    remove.dataset.historyId = item.id;
    remove.dataset.historyAction = "delete";
    remove.setAttribute("aria-label", `Delete ${item.expression} from history`);
    remove.title = "Delete calculation";
    remove.textContent = "×";
    row.append(recall, remove);
    historyList.append(row);
  });
}

function clearHistory() {
  history = [];
  persistHistory();
  renderHistory();
}

function renderAngleMode() {
  angleButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.angleMode === settings.angleMode));
  });
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return {
      angleMode: normalizeAngleMode(stored?.angleMode),
      answer: isStoredNumber(stored?.answer) ? stored.answer : "0",
      memory: isStoredNumber(stored?.memory) ? stored.memory : "0",
    };
  } catch {
    return { angleMode: ANGLE_MODES.DEG, answer: "0", memory: "0" };
  }
}

function persistSettings() {
  settings.answer = formatStoredNumber(answer);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    setSaveStatus("Local settings unavailable");
  }
}

function loadHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY));
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(isHistoryItem)
      .slice(0, MAX_HISTORY_ITEMS)
      .map((item) => ({ ...item, angleMode: normalizeAngleMode(item.angleMode) }));
  } catch {
    return [];
  }
}

function persistHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    setSaveStatus("History saved locally");
  } catch {
    setSaveStatus("Local history unavailable");
  }
}

function isHistoryItem(item) {
  return Boolean(
    item
    && typeof item.id === "string"
    && typeof item.expression === "string"
    && item.expression.length <= 500
    && typeof item.result === "string"
    && item.result.length <= 200
  );
}

function isStoredNumber(value) {
  return typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
}

function formatStoredNumber(value) {
  return math.format(value, { notation: "auto", precision: 64 });
}

function getErrorMessage(error) {
  return error instanceof CalculatorExpressionError
    ? error.message
    : "This expression cannot be calculated.";
}

function showError(message) {
  errorOutput.textContent = message;
  errorOutput.hidden = false;
}

function hideError() {
  errorOutput.hidden = true;
  errorOutput.textContent = "";
}

function setSaveStatus(message) {
  saveStatus.textContent = message;
}

installCurrentToolAiHost({
  id: "scientific-calculator",
  title: "Scientific Calculator",
  description: "Evaluates bounded scientific expressions with the calculator's safe math engine.",
  limitations: [
    "AI evaluation does not alter the visible expression, answer, memory, or history.",
    "History and memory changes remain explicit calculator actions.",
  ],
  getSnapshot: () => ({
    expression: expressionInput.value,
    displayedResult: resultOutput.textContent,
    angleMode: settings.angleMode,
    answer: formatStoredNumber(answer),
    memory: formatStoredNumber(memory),
    history,
  }),
  getContext: (_options, snapshot) => ({
    angleMode: snapshot.angleMode,
    expressionPresent: Boolean(snapshot.expression.trim()),
    historyCount: snapshot.history.length,
    memoryStored: snapshot.memory !== "0",
  }),
  commands: [
    {
      type: "expression.evaluate",
      description: "Evaluate one safe real-valued scientific expression without recording it.",
      permissions: [],
      schema: {
        type: "object",
        required: ["expression"],
        properties: {
          expression: { type: "string", maxLength: 500 },
          angleMode: { enum: ["deg", "rad", "grad"] },
          ans: { type: ["string", "number"] },
        },
        additionalProperties: false,
      },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(
          command,
          ["expression", "angleMode", "ans"],
          commandIndex,
        );
        const expression = requireCommandString(
          command.expression,
          "expression",
          commandIndex,
          { maximumLength: 500 },
        );
        if (
          command.angleMode !== undefined
          && !Object.values(ANGLE_MODES).includes(command.angleMode)
        ) {
          throw new Error("angleMode must be deg, rad, or grad.");
        }
        if (
          command.ans !== undefined
          && typeof command.ans !== "string"
          && typeof command.ans !== "number"
        ) {
          throw new Error("ans must be a string or number.");
        }
        const angleMode = command.angleMode ?? state.angleMode;
        const evaluated = evaluateScientificExpression(math, expression, {
          angleMode,
          ans: command.ans ?? state.answer,
        });
        return {
          value: {
            expression,
            display: evaluated.display,
            angleMode,
          },
        };
      },
    },
    {
      type: "state.get",
      description: "Read the current expression, answer, memory, settings, and history.",
      permissions: ["read-content"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return { value: state };
      },
    },
    {
      type: "history.list",
      description: "Read the locally stored calculation history.",
      permissions: ["read-content"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return { value: state.history };
      },
    },
  ],
});
