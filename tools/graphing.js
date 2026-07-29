import {
  applyTransformations,
  coerceDataset,
  createGraphProject,
  detectSchema,
  migrateGraphProject,
  parseDelimited,
  parseJsonDataset,
  summarizeNumeric,
  validateChartSpec,
} from "./graphing-model.mjs";
import { prepareRecords, renderChartSvg } from "./graphing-renderer.mjs";
import { createRepository, downloadBlob, downloadJson, readJsonFile } from "./local-toolkit.mjs";
import { activateTabs, debounce, element, escapeCsv, toast } from "./suite-ui.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
} from "./current-tool-ai-adapter.mjs?v=1";

const repository = createRepository("graphing");
const sample = parseDelimited("Month,Revenue,Cost,Region\nJanuary,12000,8200,North\nFebruary,15800,9100,North\nMarch,14100,8800,South\nApril,17900,10400,South");
let project = createGraphProject(coerceDataset(sample, detectSchema(sample)));
let currentSvg = "";

const byId = (id) => document.getElementById(id);

async function start() {
  try {
    const saved = await repository.get("current");
    if (saved) project = migrateGraphProject(saved);
  } catch (error) {
    toast(`Saved project could not be opened: ${error.message}`, "error");
  }
  activateTabs(document.querySelector(".suite-tabs"));
  bindEvents();
  renderAll();
  installGraphingAiHost();
}

function installGraphingAiHost() {
  installCurrentToolAiHost({
    id: "graphing",
    title: "Graphing Tool",
    description: "Reads local tabular data and stages chart or transformation settings without modifying source rows.",
    limitations: [
      "AI commands do not import files or overwrite source dataset rows.",
      "Row content requires explicit read-content permission and is bounded per request.",
    ],
    getSnapshot: () => project,
    getContext: (_options, snapshot) => ({
      title: snapshot.title,
      rows: snapshot.dataset.records.length,
      columns: snapshot.dataset.headers,
      schema: snapshot.schema,
      chartType: snapshot.spec.type,
      transformations: snapshot.transformations.length,
    }),
    async commitSnapshot(nextProject) {
      project = migrateGraphProject(nextProject);
      await repository.put("current", project);
      renderAll();
    },
    commands: [
      {
        type: "dataset.describe",
        description: "Read column names, detected types, invalid-row count, and row count without row values.",
        permissions: ["read-summary"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "dataset.describe" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return {
            value: {
              headers: snapshot.dataset.headers,
              schema: snapshot.schema,
              rowCount: snapshot.dataset.records.length,
              invalidRowCount: snapshot.dataset.invalidRows?.length ?? 0,
            },
          };
        },
      },
      {
        type: "dataset.rows",
        description: "Read a bounded slice of source rows.",
        permissions: ["read-content"],
        schema: {
          type: "object",
          properties: { offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 500 } },
          additionalProperties: false,
        },
        example: { type: "dataset.rows", offset: 0, limit: 50 },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["offset", "limit"], commandIndex);
          const offset = Math.max(0, Math.trunc(Number(command.offset) || 0));
          const limit = Math.max(1, Math.min(500, Math.trunc(Number(command.limit) || 100)));
          return {
            value: {
              offset,
              total: snapshot.dataset.records.length,
              rows: snapshot.dataset.records.slice(offset, offset + limit),
            },
          };
        },
      },
      {
        type: "chart.get",
        description: "Read the current chart specification and transformation pipeline.",
        permissions: ["read-content"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "chart.get" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return { value: { title: snapshot.title, spec: snapshot.spec, transformations: snapshot.transformations } };
        },
      },
      {
        type: "chart.configure",
        description: "Update documented chart settings while retaining the source dataset.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["changes"],
          properties: { changes: { type: "object" }, title: { type: "string", maxLength: 240 } },
          additionalProperties: false,
        },
        example: { type: "chart.configure", title: "Monthly totals", changes: { type: "bar", x: "Month", y: "Revenue", labels: true } },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["changes", "title"], commandIndex);
          const changes = requireCommandRecord(command.changes, "changes", commandIndex);
          const allowed = new Set(Object.keys(snapshot.spec));
          const unknown = Object.keys(changes).find((key) => !allowed.has(key));
          if (unknown) throw new Error(`Unsupported chart setting: ${unknown}.`);
          const spec = { ...snapshot.spec, ...changes };
          const records = applyTransformations(snapshot.dataset.records, snapshot.transformations);
          const validation = validateChartSpec(spec, records);
          if (!validation.valid) throw new Error(validation.errors.join(" "));
          return {
            state: {
              ...snapshot,
              ...(command.title !== undefined ? { title: String(command.title).trim().slice(0, 240) || snapshot.title } : {}),
              spec,
            },
            updatedIds: ["chart-spec"],
            warnings: validation.warnings,
            value: spec,
          };
        },
      },
      {
        type: "transformations.replace",
        description: "Replace the resettable chart transformation pipeline without changing source rows.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["transformations"],
          properties: { transformations: { type: "array" } },
          additionalProperties: false,
        },
        example: { type: "transformations.replace", transformations: [{ id: "filter-1", type: "filter", column: "Region", operator: "equals", value: "North" }] },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["transformations"], commandIndex);
          if (!Array.isArray(command.transformations) || command.transformations.length > 100) {
            throw new Error("transformations must be a list of at most 100 steps.");
          }
          const transformations = structuredClone(command.transformations);
          const records = applyTransformations(snapshot.dataset.records, transformations);
          const validation = validateChartSpec(snapshot.spec, records);
          if (!validation.valid) throw new Error(validation.errors.join(" "));
          return {
            state: { ...snapshot, transformations },
            updatedIds: ["transformation-pipeline"],
            warnings: validation.warnings,
            value: { resultingRows: records.length },
          };
        },
      },
    ],
  });
}

function bindEvents() {
  byId("graph-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    const extension = file.name.split(".").at(-1).toLowerCase();
    if (!["csv", "tsv", "json"].includes(extension)) return toast("Choose CSV, TSV, or JSON.", "error");
    await loadText(await file.text(), extension);
  });
  byId("graph-parse-paste").addEventListener("click", () => loadText(byId("graph-paste").value, byId("graph-paste-format").value));
  byId("graph-add-row").addEventListener("click", () => {
    project.dataset.records.push(Object.fromEntries(project.dataset.headers.map((header) => [header, null])));
    saveAndRender();
  });
  byId("graph-add-column").addEventListener("click", () => {
    const name = prompt("Column name");
    if (!name?.trim() || project.dataset.headers.includes(name.trim())) return;
    project.dataset.headers.push(name.trim());
    project.schema[name.trim()] = "text";
    project.dataset.records.forEach((record) => { record[name.trim()] = null; });
    saveAndRender();
  });
  byId("graph-filter-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    project.transformations.push({ id: crypto.randomUUID(), type: "filter", ...values });
    saveAndRender();
  });
  byId("graph-sort-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    project.transformations.push({ id: crypto.randomUUID(), type: "sort", ...values });
    saveAndRender();
  });
  byId("graph-reset-transforms").addEventListener("click", () => {
    project.transformations = [];
    saveAndRender();
  });
  byId("graph-spec-form").addEventListener("input", debounce(readSpecForm, 80));
  byId("graph-save").addEventListener("click", exportProject);
  byId("graph-open").addEventListener("click", () => byId("graph-open-input").click());
  byId("graph-open-input").addEventListener("change", openProject);
  byId("graph-export-project").addEventListener("click", exportProject);
  byId("graph-export-svg").addEventListener("click", () => downloadBlob(new Blob([currentSvg], { type: "image/svg+xml" }), "graph.svg"));
  byId("graph-export-png").addEventListener("click", exportPng);
  byId("graph-export-csv").addEventListener("click", exportCsv);
  byId("graph-export-json").addEventListener("click", () => downloadJson(transformedRecords(), "graph-data.json"));
  byId("graph-export-package").addEventListener("click", exportPackage);
  byId("graph-print").addEventListener("click", () => window.print());
}

async function loadText(text, format) {
  if (!text.trim()) return toast("Paste or choose some data first.", "error");
  try {
    byId("graph-import-progress").hidden = false;
    const result = text.length > 250_000
      ? await parseInWorker(text, format)
      : parseOnMain(text, format);
    project = createGraphProject(result.dataset, result.schema);
    await saveAndRender();
    toast(`Loaded ${project.dataset.records.length} rows.`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    byId("graph-import-progress").hidden = true;
  }
}

function parseOnMain(text, format) {
  const parsed = format === "json" ? parseJsonDataset(text) : parseDelimited(text, format === "tsv" ? "\t" : ",");
  const schema = detectSchema(parsed);
  return { dataset: coerceDataset(parsed, schema), schema };
}

function parseInWorker(text, format) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./graphing-worker.js?v=1", { type: "module" });
    const id = crypto.randomUUID();
    worker.addEventListener("message", (event) => {
      if (event.data.id !== id) return;
      worker.terminate();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error));
    });
    worker.addEventListener("error", (event) => reject(new Error(event.message)));
    worker.postMessage({ id, text, format });
  });
}

async function saveAndRender() {
  await repository.put("current", project);
  renderAll();
}

function renderAll() {
  renderSchema();
  renderEditor();
  renderColumnSelects();
  renderTransformations();
  writeSpecForm();
  renderChart();
  byId("graph-data-status").textContent = `${project.dataset.records.length} rows · ${project.dataset.headers.length} columns`;
  byId("graph-invalid-status").textContent = project.dataset.invalidRows?.length ? `${project.dataset.invalidRows.length} invalid or uneven row values were set to missing.` : "No invalid rows detected.";
}

function renderSchema() {
  const container = byId("graph-schema");
  container.replaceChildren();
  project.dataset.headers.forEach((header) => {
    const label = element("label", "suite-field");
    label.append(element("span", "", header));
    const select = element("select");
    ["number", "date", "category", "text", "boolean", "empty"].forEach((type) => select.append(Object.assign(element("option", "", type), { value: type })));
    select.value = project.schema[header] ?? "text";
    select.addEventListener("change", () => {
      project.schema[header] = select.value;
      project.dataset = coerceDataset(project.dataset, project.schema);
      saveAndRender();
    });
    label.append(select);
    container.append(label);
  });
}

function renderEditor() {
  const head = byId("graph-editor-head");
  const body = byId("graph-editor-body");
  head.replaceChildren();
  body.replaceChildren();
  const row = element("tr");
  project.dataset.headers.forEach((header) => row.append(element("th", "", header)));
  head.append(row);
  project.dataset.records.slice(0, 250).forEach((record, rowIndex) => {
    const tableRow = element("tr");
    project.dataset.headers.forEach((header) => {
      const cell = element("td");
      const input = element("input");
      input.value = record[header] ?? "";
      input.setAttribute("aria-label", `${header}, row ${rowIndex + 1}`);
      input.addEventListener("change", () => {
        const raw = input.value;
        if (project.schema[header] === "number") record[header] = raw === "" ? null : Number(raw);
        else if (project.schema[header] === "boolean") record[header] = ["true", "yes", "1"].includes(raw.toLowerCase());
        else record[header] = raw || null;
        saveAndRender();
      });
      cell.append(input);
      tableRow.append(cell);
    });
    body.append(tableRow);
  });
  if (project.dataset.records.length > 250) {
    const truncated = element("tr");
    const cell = element("td", "", `${project.dataset.records.length - 250} more rows remain in the dataset and exports.`);
    cell.colSpan = project.dataset.headers.length;
    truncated.append(cell);
    body.append(truncated);
  }
}

function renderColumnSelects() {
  const selectIds = ["graph-filter-column", "graph-sort-column"];
  selectIds.forEach((id) => {
    const select = byId(id);
    const current = select.value;
    select.replaceChildren();
    project.dataset.headers.forEach((header) => select.append(Object.assign(element("option", "", header), { value: header })));
    if (project.dataset.headers.includes(current)) select.value = current;
  });
  ["x", "y", "series", "size"].forEach((name) => {
    const select = byId("graph-spec-form").elements[name];
    const current = project.spec[name] ?? "";
    select.replaceChildren(Object.assign(element("option", "", "None"), { value: "" }));
    project.dataset.headers.forEach((header) => select.append(Object.assign(element("option", "", header), { value: header })));
    select.value = project.dataset.headers.includes(current) ? current : "";
  });
}

function renderTransformations() {
  const list = byId("graph-transform-list");
  list.replaceChildren();
  project.transformations.forEach((transform, index) => {
    const row = element("li", "suite-row");
    row.append(element("span", "suite-chip", String(index + 1)));
    const main = element("div", "suite-row-main");
    main.append(element("strong", "", transform.type === "filter" ? `Filter ${transform.column}` : `Sort ${transform.column}`));
    main.append(element("span", "", transform.type === "filter" ? `${transform.operator} ${transform.value}` : transform.direction));
    const remove = element("button", "button button-quiet", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
      project.transformations = project.transformations.filter((candidate) => candidate.id !== transform.id);
      saveAndRender();
    });
    row.append(main, remove);
    list.append(row);
  });
  if (!project.transformations.length) list.append(element("li", "suite-empty", "No transformations. The chart sees every source row."));
}

function writeSpecForm() {
  const form = byId("graph-spec-form");
  Object.entries(project.spec).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else if (key === "annotations") field.value = (value ?? []).map((item) => item.text ?? item).join("\n");
    else field.value = value ?? "";
  });
}

function readSpecForm() {
  const form = byId("graph-spec-form");
  const values = Object.fromEntries(new FormData(form));
  project.spec = {
    ...project.spec,
    ...values,
    bins: Math.max(1, Number(values.bins) || 10),
    legend: form.elements.legend.checked,
    labels: form.elements.labels.checked,
    annotations: String(values.annotations ?? "").split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ text })),
  };
  repository.put("current", project);
  renderChart();
}

function transformedRecords() {
  return applyTransformations(project.dataset.records, project.transformations);
}

function renderChart() {
  const records = transformedRecords();
  const validation = validateChartSpec(project.spec, records);
  const warning = byId("graph-validation");
  const messages = [...validation.errors, ...validation.warnings];
  warning.hidden = messages.length === 0;
  warning.textContent = messages.join(" ");
  byId("graph-chart-status").textContent = `${records.length} transformed rows · ${validation.valid ? "valid specification" : "needs attention"}`;
  if (!validation.valid) {
    byId("graph-preview").replaceChildren(element("div", "suite-empty", "Choose compatible columns and scales to render the chart."));
    return;
  }
  currentSvg = renderChartSvg(records, project.spec);
  byId("graph-preview").innerHTML = currentSvg;
  renderStatistics(records);
}

function renderStatistics(records) {
  const container = byId("graph-statistics");
  container.replaceChildren();
  const values = records.map((record) => record[project.spec.y]).filter((value) => value !== null);
  const stats = summarizeNumeric(values);
  if (!stats.count) {
    container.append(element("p", "", "Choose a numeric Y column for statistics."));
    return;
  }
  Object.entries(stats).forEach(([label, value]) => {
    const card = element("div");
    card.append(element("span", "suite-label", label.replace(/([A-Z])/g, " $1")));
    card.append(element("strong", "", typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : value));
    container.append(card);
  });
}

async function openProject(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  try {
    project = migrateGraphProject(await readJsonFile(file));
    await saveAndRender();
    toast("Graph project opened.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function exportProject() {
  downloadJson(project, `${safeBaseName()}.vpgraph.json`);
}

function exportCsv() {
  const records = transformedRecords();
  const headers = project.dataset.headers;
  const csv = [headers.map(escapeCsv).join(","), ...records.map((record) => headers.map((header) => escapeCsv(record[header])).join(","))].join("\r\n");
  downloadBlob(new Blob([`${csv}\r\n`], { type: "text/csv;charset=utf-8" }), `${safeBaseName()}-data.csv`);
}

function exportPackage() {
  downloadJson({
    format: "vital-pancakes-graph-package",
    version: 1,
    project,
    transformedData: transformedRecords(),
    graphSvg: currentSvg,
  }, `${safeBaseName()}-package.json`);
}

async function exportPng() {
  const blob = new Blob([currentSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1120;
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((png) => {
      URL.revokeObjectURL(url);
      if (png) downloadBlob(png, `${safeBaseName()}.png`);
    }, "image/png");
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    toast("The PNG renderer could not load the SVG.", "error");
  };
  image.src = url;
}

function safeBaseName() {
  return (project.spec.title || project.title || "graph").trim().replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "graph";
}

start();
