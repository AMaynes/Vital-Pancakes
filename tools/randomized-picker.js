import {
  createPickerProject,
  createSeededRandom,
  divideIntoGroups,
  migratePickerProject,
  normalizedProbabilities,
  parsePickerCsv,
  parsePickerInput,
  randomOrder,
  weightedSample,
} from "./randomized-picker-model.mjs";
import { createId, createRepository, downloadBlob, downloadJson, readJsonFile } from "./local-toolkit.mjs";
import { activateTabs, element, escapeCsv, toast } from "./suite-ui.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
} from "./current-tool-ai-adapter.mjs?v=1";

const repository = createRepository("randomized-picker");
let project = createPickerProject(parsePickerInput("Option A\nOption B\nOption C"));
let presets = [];
let lastDrawRequest = null;
let activeAnimation = null;

const byId = (id) => document.getElementById(id);

async function start() {
  try {
    const saved = await repository.get("current");
    if (saved) project = migratePickerProject(saved);
    presets = (await repository.get("presets")) ?? [];
  } catch (error) {
    toast(`Saved picker could not be opened: ${error.message}`, "error");
  }
  activateTabs(document.querySelector(".suite-tabs"), render);
  bindEvents();
  writeSettings();
  render();
  installRandomizedPickerAiHost();
}

function installRandomizedPickerAiHost() {
  installCurrentToolAiHost({
    id: "randomized-picker",
    title: "Randomized Picker",
    description: "Configures lists, reports probabilities, and draws results independently of presentation animation timing.",
    limitations: [
      "Unseeded draws use crypto.getRandomValues and cannot be reproduced.",
      "AI commands do not save or delete reusable presets.",
    ],
    getSnapshot: () => project,
    getContext: (_options, snapshot) => ({
      name: snapshot.name,
      itemCount: snapshot.items.length,
      enabledCount: snapshot.items.filter((item) => item.enabled !== false).length,
      settings: snapshot.settings,
      historyCount: snapshot.history.length,
    }),
    async commitSnapshot(nextProject) {
      cancelAnimation();
      project = migratePickerProject(nextProject);
      lastDrawRequest = null;
      await repository.put("current", project);
      writeSettings();
      render();
    },
    commands: [
      {
        type: "picker.describe",
        description: "Read picker settings and item counts without item names or notes.",
        permissions: ["read-summary"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "picker.describe" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return {
            value: {
              name: snapshot.name,
              itemCount: snapshot.items.length,
              enabledCount: snapshot.items.filter((item) => item.enabled !== false).length,
              settings: snapshot.settings,
              historyCount: snapshot.history.length,
            },
          };
        },
      },
      {
        type: "items.list",
        description: "Read picker items and their normalized probabilities.",
        permissions: ["read-content"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "items.list" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          const eligible = pickerEligibleItems(snapshot);
          const probabilities = new Map(
            normalizedProbabilities(eligible).map((item) => [item.id, item.probability]),
          );
          return {
            value: snapshot.items.map((item) => ({
              ...item,
              probability: probabilities.get(item.id) ?? 0,
              excluded: snapshot.settings.excludedIds.includes(item.id),
            })),
          };
        },
      },
      {
        type: "items.replace",
        description: "Replace the source list with validated weighted items and clear prior results.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["items"],
          properties: { items: { type: "array" } },
          additionalProperties: false,
        },
        example: { type: "items.replace", items: [{ name: "Ada", weight: 2, category: "A", enabled: true }, { name: "Grace", weight: 1, category: "B", enabled: true }] },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["items"], commandIndex);
          if (!Array.isArray(command.items)) throw new Error("items must be a list.");
          const items = command.items.map((item) => ({
            id: item.id || createId("item"),
            name: item.name,
            weight: item.weight ?? 1,
            category: String(item.category ?? ""),
            notes: String(item.notes ?? ""),
            enabled: item.enabled !== false,
          }));
          const next = migratePickerProject({
            ...snapshot,
            items,
            history: [],
            settings: { ...snapshot.settings, excludedIds: [] },
          });
          return {
            state: next,
            updatedIds: ["picker-items"],
            value: { itemCount: next.items.length },
          };
        },
      },
      {
        type: "settings.update",
        description: "Update selection mode, count, replacement, seed, category, or temporary exclusions.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["changes"],
          properties: { changes: { type: "object" } },
          additionalProperties: false,
        },
        example: { type: "settings.update", changes: { mode: "multiple", count: 3, withReplacement: false, seeded: true, seed: "session-42" } },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["changes"], commandIndex);
          const changes = requireCommandRecord(command.changes, "changes", commandIndex);
          const allowed = new Set(["mode", "count", "withReplacement", "seeded", "seed", "category", "excludedIds"]);
          const unknown = Object.keys(changes).find((key) => !allowed.has(key));
          if (unknown) throw new Error(`Unsupported picker setting: ${unknown}.`);
          const modes = ["one", "multiple", "order", "groups", "eliminate", "wheel"];
          if (changes.mode && !modes.includes(changes.mode)) throw new Error("Unsupported picker mode.");
          const settings = {
            ...snapshot.settings,
            ...changes,
            count: Math.max(1, Math.trunc(Number(changes.count ?? snapshot.settings.count) || 1)),
            withReplacement: changes.withReplacement ?? snapshot.settings.withReplacement,
            seeded: changes.seeded ?? snapshot.settings.seeded,
            excludedIds: Array.isArray(changes.excludedIds)
              ? changes.excludedIds.filter((id) => snapshot.items.some((item) => item.id === id))
              : snapshot.settings.excludedIds,
          };
          const next = migratePickerProject({ ...snapshot, settings });
          return {
            state: next,
            updatedIds: ["picker-settings"],
            value: next.settings,
          };
        },
      },
      {
        type: "probabilities.get",
        description: "Calculate normalized probabilities for currently eligible items.",
        permissions: ["read-content"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "probabilities.get" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return { value: normalizedProbabilities(pickerEligibleItems(snapshot)) };
        },
      },
      {
        type: "draw.run",
        description: "Draw once using current settings; presentation animation never influences the result.",
        permissions: ["update"],
        mutates: true,
        schema: { type: "object", additionalProperties: false },
        example: { type: "draw.run" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          const request = structuredClone(snapshot.settings);
          const random = request.seeded
            ? createSeededRandom(request.seed || "vital-pancakes")
            : undefined;
          const items = pickerEligibleItems(snapshot);
          let result;
          if (request.mode === "order") result = randomOrder(items, random);
          else if (request.mode === "groups") result = divideIntoGroups(items, request.count, random);
          else {
            const count = ["one", "wheel", "eliminate"].includes(request.mode) ? 1 : request.count;
            result = weightedSample(items, count, {
              random,
              withReplacement: request.withReplacement,
              excludedIds: [],
              category: "",
            });
          }
          const entry = {
            id: createId("result"),
            at: new Date().toISOString(),
            settings: request,
            result,
          };
          const settings = request.mode === "eliminate"
            ? {
              ...snapshot.settings,
              excludedIds: [...new Set([...snapshot.settings.excludedIds, result[0].id])],
            }
            : snapshot.settings;
          return {
            state: { ...snapshot, settings, history: [entry, ...snapshot.history] },
            createdIds: [entry.id],
            value: entry,
          };
        },
      },
    ],
  });
}

function pickerEligibleItems(snapshot) {
  return snapshot.items.filter((item) => (
    item.enabled !== false
    && !snapshot.settings.excludedIds.includes(item.id)
    && (!snapshot.settings.category || item.category === snapshot.settings.category)
  ));
}

function bindEvents() {
  byId("picker-load-quick").addEventListener("click", () => {
    try {
      project.items = parsePickerInput(byId("picker-quick-input").value, byId("picker-input-mode").value);
      project.history = [];
      saveAndRender();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  byId("picker-csv-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    try {
      project.items = parsePickerCsv(await file.text()).map((item) => ({ ...item, id: createId("item") }));
      project.history = [];
      saveAndRender();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  byId("picker-add-item").addEventListener("click", () => {
    project.items.push({ id: createId("item"), name: "New item", weight: 1, category: "", notes: "", enabled: true });
    saveAndRender();
  });
  byId("picker-settings").addEventListener("input", readSettings);
  byId("picker-draw").addEventListener("click", () => draw());
  byId("picker-reroll").addEventListener("click", () => {
    if (!lastDrawRequest) return draw();
    draw(lastDrawRequest);
  });
  byId("picker-undo").addEventListener("click", undoResult);
  byId("picker-reset").addEventListener("click", () => {
    project.history = [];
    project.settings.excludedIds = [];
    lastDrawRequest = null;
    saveAndRender();
  });
  byId("picker-save-preset").addEventListener("click", savePreset);
  byId("picker-save").addEventListener("click", () => downloadJson(project, "picker.vppicker.json"));
  byId("picker-open").addEventListener("click", () => byId("picker-open-input").click());
  byId("picker-open-input").addEventListener("change", openProject);
  document.querySelectorAll("[data-picker-export]").forEach((button) => button.addEventListener("click", () => exportData(button.dataset.pickerExport)));
  byId("picker-copy-audit").addEventListener("click", copyAudit);
}

function writeSettings() {
  const form = byId("picker-settings");
  Object.entries(project.settings).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value ?? "";
  });
}

function readSettings() {
  const form = byId("picker-settings");
  const values = Object.fromEntries(new FormData(form));
  project.settings = {
    ...project.settings,
    ...values,
    count: Math.max(1, Number(values.count) || 1),
    withReplacement: form.elements.withReplacement.checked,
    seeded: form.elements.seeded.checked,
  };
  repository.put("current", project);
  renderProbabilities();
  byId("picker-wheel").hidden = project.settings.mode !== "wheel";
}

async function saveAndRender() {
  await repository.put("current", project);
  render();
}

function render() {
  renderItems();
  renderCategories();
  renderProbabilities();
  renderHistory();
  renderPresets();
  renderWheel();
  byId("picker-item-status").textContent = `${project.items.length} items · ${project.items.filter((item) => item.enabled).length} enabled`;
}

function renderItems() {
  const body = byId("picker-item-table");
  body.replaceChildren();
  project.items.forEach((item) => {
    const row = element("tr");
    row.append(inputCell(item.enabled, "checkbox", (value) => { item.enabled = value; }));
    row.append(inputCell(item.name, "text", (value) => { item.name = value; }));
    row.append(inputCell(item.weight, "number", (value) => { item.weight = value; }, { min: "0", step: "any" }));
    row.append(inputCell(item.category, "text", (value) => { item.category = value; }));
    row.append(inputCell(item.notes, "text", (value) => { item.notes = value; }));
    const excluded = project.settings.excludedIds.includes(item.id);
    row.append(inputCell(excluded, "checkbox", (value) => {
      project.settings.excludedIds = value
        ? [...new Set([...project.settings.excludedIds, item.id])]
        : project.settings.excludedIds.filter((id) => id !== item.id);
    }));
    const actions = element("td");
    const remove = element("button", "button button-quiet", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => {
      project.items = project.items.filter((candidate) => candidate.id !== item.id);
      project.settings.excludedIds = project.settings.excludedIds.filter((id) => id !== item.id);
      saveAndRender();
    });
    actions.append(remove);
    row.append(actions);
    body.append(row);
  });
}

function inputCell(value, type, update, attributes = {}) {
  const cell = element("td");
  const input = element("input", "suite-input");
  input.type = type;
  if (type === "checkbox") input.checked = Boolean(value);
  else input.value = value;
  Object.entries(attributes).forEach(([key, attributeValue]) => input.setAttribute(key, attributeValue));
  input.addEventListener("change", () => {
    update(type === "checkbox" ? input.checked : input.value);
    repository.put("current", project);
    renderCategories();
    renderProbabilities();
  });
  cell.append(input);
  return cell;
}

function renderCategories() {
  const select = byId("picker-category");
  const current = project.settings.category;
  select.replaceChildren(Object.assign(element("option", "", "All categories"), { value: "" }));
  [...new Set(project.items.map((item) => item.category).filter(Boolean))].sort().forEach((category) => {
    select.append(Object.assign(element("option", "", category), { value: category }));
  });
  select.value = current;
}

function eligibleItems() {
  return project.items.filter((item) => (
    item.enabled !== false
    && !project.settings.excludedIds.includes(item.id)
    && (!project.settings.category || item.category === project.settings.category)
  ));
}

function renderProbabilities() {
  const container = byId("picker-probabilities");
  container.replaceChildren();
  try {
    normalizedProbabilities(eligibleItems()).forEach((item) => {
      const row = element("div", "picker-probability");
      row.append(element("strong", "", item.name));
      const meter = element("meter");
      meter.min = 0;
      meter.max = 1;
      meter.value = item.probability;
      row.append(meter, element("span", "", `${(item.probability * 100).toFixed(2)}%`));
      container.append(row);
    });
  } catch (error) {
    container.append(element("div", "suite-warning", error.message));
  }
}

function draw(requestOverride = null) {
  cancelAnimation();
  readSettings();
  try {
    const request = requestOverride
      && typeof requestOverride === "object"
      && typeof requestOverride.mode === "string"
      ? structuredClone(requestOverride)
      : structuredClone(project.settings);
    const random = request.seeded ? createSeededRandom(request.seed || "vital-pancakes") : undefined;
    const items = eligibleItems();
    let result;
    if (request.mode === "order") result = randomOrder(items, random);
    else if (request.mode === "groups") result = divideIntoGroups(items, request.count, random);
    else {
      const count = request.mode === "one" || request.mode === "wheel" || request.mode === "eliminate" ? 1 : request.count;
      result = weightedSample(items, count, {
        random,
        withReplacement: request.withReplacement,
        excludedIds: [],
        category: "",
      });
    }
    const entry = {
      id: createId("result"),
      at: new Date().toISOString(),
      settings: structuredClone(request),
      result: structuredClone(result),
    };
    project.history.unshift(entry);
    if (request.mode === "eliminate") {
      const eliminated = result[0];
      project.settings.excludedIds = [...new Set([...project.settings.excludedIds, eliminated.id])];
    }
    lastDrawRequest = request;
    repository.put("current", project);
    animateResult(entry);
    renderHistory();
    renderItems();
    renderProbabilities();
  } catch (error) {
    toast(error.message, "error");
  }
}

function animateResult(entry) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return showResult(entry);
  const candidates = eligibleItems();
  let frame = 0;
  const total = 24;
  const tick = () => {
    const candidate = candidates[frame % Math.max(1, candidates.length)];
    byId("picker-result").replaceChildren(element("strong", "", candidate?.name ?? "Ready"));
    frame += 1;
    if (frame >= total) return showResult(entry);
    activeAnimation = setTimeout(tick, 25 + frame * 3);
  };
  tick();
}

function showResult(entry) {
  const result = entry.result;
  const resultBox = byId("picker-result");
  resultBox.replaceChildren();
  if (entry.settings.mode === "groups") {
    const grid = element("div", "suite-grid");
    result.forEach((group, index) => {
      const card = element("div");
      card.append(element("strong", "", `Group ${index + 1}`), element("p", "", group.items.map((item) => item.name).join(", ")));
      grid.append(card);
    });
    resultBox.append(grid);
  } else {
    resultBox.append(element("strong", "", result.map((item) => item.name).join(" · ")));
  }
  if (entry.settings.mode === "wheel") animateWheelTo(result[0]);
}

function cancelAnimation() {
  clearTimeout(activeAnimation);
  activeAnimation = null;
}

function undoResult() {
  const [removed] = project.history.splice(0, 1);
  if (!removed) return;
  if (removed.settings.mode === "eliminate") {
    removed.result.forEach((item) => {
      project.settings.excludedIds = project.settings.excludedIds.filter((id) => id !== item.id);
    });
  }
  byId("picker-result").replaceChildren(element("strong", "", project.history[0] ? displayResult(project.history[0]) : "Ready"));
  saveAndRender();
}

function renderHistory() {
  const list = byId("picker-history");
  list.replaceChildren();
  project.history.forEach((entry) => {
    const row = element("li", "suite-row");
    row.append(element("span", "suite-chip", entry.settings.mode));
    const main = element("div", "suite-row-main");
    main.append(element("strong", "", displayResult(entry)));
    main.append(element("span", "", `${new Date(entry.at).toLocaleString()}${entry.settings.seeded ? ` · seed ${entry.settings.seed || "vital-pancakes"}` : " · secure random"}`));
    row.append(main);
    list.append(row);
  });
  if (!project.history.length) list.append(element("li", "suite-empty", "No draws yet."));
}

function displayResult(entry) {
  if (entry.settings.mode === "groups") return entry.result.map((group, index) => `Group ${index + 1}: ${group.items.map((item) => item.name).join(", ")}`).join(" | ");
  return entry.result.map((item) => item.name).join(", ");
}

function renderWheel() {
  const canvas = byId("picker-wheel");
  canvas.hidden = project.settings.mode !== "wheel";
  if (canvas.hidden) return;
  const context = canvas.getContext("2d");
  const items = eligibleItems();
  context.clearRect(0, 0, canvas.width, canvas.height);
  const center = canvas.width / 2;
  const radius = center - 30;
  items.forEach((item, index) => {
    const start = index / items.length * Math.PI * 2 - Math.PI / 2;
    const end = (index + 1) / items.length * Math.PI * 2 - Math.PI / 2;
    context.beginPath();
    context.moveTo(center, center);
    context.arc(center, center, radius, start, end);
    context.fillStyle = ["#7B211A", "#2D5D68", "#B58B36", "#51764B", "#80527B"][index % 5];
    context.fill();
    context.save();
    context.translate(center, center);
    context.rotate((start + end) / 2);
    context.fillStyle = "#fff";
    context.font = "700 18px system-ui";
    context.textAlign = "right";
    context.fillText(item.name.slice(0, 18), radius - 24, 6);
    context.restore();
  });
  context.fillStyle = "#1b1a17";
  context.beginPath();
  context.moveTo(center, 8);
  context.lineTo(center - 16, 42);
  context.lineTo(center + 16, 42);
  context.closePath();
  context.fill();
}

function animateWheelTo(item) {
  if (!item || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = byId("picker-wheel");
  canvas.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(1080deg)" }],
    { duration: 900, easing: "cubic-bezier(.15,.75,.25,1)" },
  );
}

async function savePreset() {
  const name = prompt("Saved list name", project.name);
  if (!name?.trim()) return;
  presets.unshift({ id: createId("preset"), name: name.trim(), items: structuredClone(project.items) });
  presets = presets.slice(0, 40);
  await repository.put("presets", presets);
  renderPresets();
}

function renderPresets() {
  const list = byId("picker-presets");
  list.replaceChildren();
  presets.forEach((preset) => {
    const row = element("li", "suite-row");
    const open = element("button", "button button-quiet", preset.name);
    open.type = "button";
    open.addEventListener("click", () => {
      project = createPickerProject(structuredClone(preset.items));
      writeSettings();
      saveAndRender();
    });
    row.append(open);
    list.append(row);
  });
  if (!presets.length) list.append(element("li", "suite-empty", "No saved lists."));
}

async function openProject(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  try {
    project = migratePickerProject(await readJsonFile(file));
    writeSettings();
    await saveAndRender();
  } catch (error) {
    toast(error.message, "error");
  }
}

function exportData(format) {
  if (format === "project") return downloadJson(project, "picker.vppicker.json");
  if (format === "json") return downloadJson(project.history, "picker-results.json");
  if (format === "text") {
    const text = project.history.map((entry) => `${entry.at}\t${entry.settings.mode}\t${displayResult(entry)}`).join("\n");
    return downloadBlob(new Blob([`${text}\n`], { type: "text/plain" }), "picker-results.txt");
  }
  const csv = ["timestamp,mode,result,seed", ...project.history.map((entry) => [
    escapeCsv(entry.at), escapeCsv(entry.settings.mode), escapeCsv(displayResult(entry)), escapeCsv(entry.settings.seeded ? entry.settings.seed : ""),
  ].join(","))].join("\r\n");
  downloadBlob(new Blob([`${csv}\r\n`], { type: "text/csv" }), "picker-results.csv");
}

async function copyAudit() {
  const summary = [
    `Vital Pancakes Randomized Picker audit`,
    `Items: ${project.items.length}`,
    `Mode: ${project.settings.mode}`,
    `Replacement: ${project.settings.withReplacement ? "with replacement" : "without replacement"}`,
    `Randomness: ${project.settings.seeded ? `deterministic seed “${project.settings.seed || "vital-pancakes"}”` : "crypto.getRandomValues()"}`,
    `Latest result: ${project.history[0] ? displayResult(project.history[0]) : "none"}`,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(summary);
    toast("Audit summary copied.");
  } catch {
    toast("Clipboard access was unavailable.", "error");
  }
}

start();
