import {
  PALETTE_FORMAT,
  PALETTE_VERSION,
  assignSemanticRoles,
  contrastRatio,
  generateHarmony,
  hexToRgb,
  migratePaletteProject,
  oklchToRgb,
  regenerateUnlocked,
  rgbToHex,
  rgbToOklch,
  simulateColorVision,
} from "./color-aesthetic-model.mjs";
import { createId, createRepository, downloadBlob, downloadJson, readJsonFile } from "./local-toolkit.mjs";
import { activateTabs, debounce, element, toast } from "./suite-ui.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
  requireCommandString,
} from "./current-tool-ai-adapter.mjs?v=1";

const repository = createRepository("color-aesthetic");
let project = createProject();
let selectedColorId = project.colors[0].id;
let dragColorId = null;

const byId = (id) => document.getElementById(id);

async function start() {
  try {
    const saved = await repository.get("current");
    if (saved) project = migratePaletteProject(saved);
  } catch (error) {
    toast(`Saved palette could not be opened: ${error.message}`, "error");
  }
  activateTabs(document.querySelector(".suite-tabs"), render);
  bindEvents();
  writeOptions();
  render();
  installColorAestheticAiHost();
}

function installColorAestheticAiHost() {
  installCurrentToolAiHost({
    id: "color-aesthetic",
    title: "Color Aesthetic Generator",
    description: "Generates and edits deterministic perceptual palettes without reading uploaded image pixels.",
    limitations: [
      "Uploaded image pixels and extracted sampling buffers are never available through AI commands.",
      "Accessibility results are contrast calculations and simulations, not guarantees for every viewer or display.",
    ],
    getSnapshot: () => project,
    getContext: (_options, snapshot) => ({
      id: snapshot.id,
      name: snapshot.name,
      colorCount: snapshot.colors.length,
      options: snapshot.options,
      assignedRoles: snapshot.colors.filter((color) => color.role).map((color) => color.role),
    }),
    async commitSnapshot(nextProject) {
      project = migratePaletteProject(nextProject);
      selectedColorId = project.colors[0]?.id ?? null;
      await repository.put("current", project);
      writeOptions();
      render();
    },
    commands: [
      {
        type: "palette.summary",
        description: "Read generation settings, role names, and color count without color values.",
        permissions: ["read-summary"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "palette.summary" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return {
            value: {
              name: snapshot.name,
              options: snapshot.options,
              colorCount: snapshot.colors.length,
              roles: snapshot.colors.map((color) => color.role).filter(Boolean),
            },
          };
        },
      },
      {
        type: "palette.get",
        description: "Read the complete current palette project.",
        permissions: ["read-content"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "palette.get" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return { value: snapshot };
        },
      },
      {
        type: "palette.generate",
        description: "Generate a deterministic harmony while retaining history and favorites.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["options"],
          properties: { name: { type: "string" }, options: { type: "object" } },
          additionalProperties: false,
        },
        example: { type: "palette.generate", name: "Quiet archive", options: { base: "#7B211A", harmony: "analogous", style: "muted", count: 6, seed: "quiet-archive" } },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["name", "options"], commandIndex);
          const options = {
            ...snapshot.options,
            ...requireCommandRecord(command.options, "options", commandIndex),
          };
          options.count = Math.max(2, Math.min(12, Math.trunc(Number(options.count) || 6)));
          const colors = generateHarmony(
            options.base,
            options.harmony,
            options.style,
            options.count,
            options.seed,
          );
          const next = migratePaletteProject({
            ...snapshot,
            ...(command.name !== undefined
              ? { name: requireCommandString(command.name, "name", commandIndex, { maximumLength: 220 }) }
              : {}),
            options,
            colors,
            history: [
              { id: createId("history"), colors: snapshot.colors, options: snapshot.options, at: new Date().toISOString() },
              ...snapshot.history,
            ].slice(0, 50),
          });
          return {
            state: next,
            updatedIds: [next.id],
            value: next.colors,
          };
        },
      },
      {
        type: "colors.update",
        description: "Update one color value, semantic role, or lock state.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["colorId", "changes"],
          properties: { colorId: { type: "string" }, changes: { type: "object" } },
          additionalProperties: false,
        },
        example: { type: "colors.update", colorId: "color-id", changes: { role: "accent", locked: true } },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["colorId", "changes"], commandIndex);
          const colorId = requireCommandString(command.colorId, "colorId", commandIndex, { maximumLength: 160 });
          const changes = requireCommandRecord(command.changes, "changes", commandIndex);
          const allowed = new Set(["hex", "role", "locked"]);
          const unknown = Object.keys(changes).find((key) => !allowed.has(key));
          if (unknown) throw new Error(`Unsupported color field: ${unknown}.`);
          if (!snapshot.colors.some((color) => color.id === colorId)) throw new Error("Color not found.");
          const colors = snapshot.colors.map((color) => color.id === colorId
            ? {
              ...color,
              ...(changes.hex !== undefined ? { hex: String(changes.hex).toUpperCase() } : {}),
              ...(changes.role !== undefined ? { role: String(changes.role).trim().slice(0, 80) } : {}),
              ...(changes.locked !== undefined ? { locked: Boolean(changes.locked) } : {}),
            }
            : color);
          const next = migratePaletteProject({ ...snapshot, colors });
          return {
            state: next,
            updatedIds: [colorId],
            value: next.colors.find((color) => color.id === colorId),
          };
        },
      },
      {
        type: "roles.assign",
        description: "Assign background, surface, text, accent, success, warning, and danger roles deterministically.",
        permissions: ["update"],
        mutates: true,
        schema: { type: "object", additionalProperties: false },
        example: { type: "roles.assign" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          const colors = assignSemanticRoles(snapshot.colors);
          return {
            state: { ...snapshot, colors },
            updatedIds: colors.map((color) => color.id),
            value: colors,
          };
        },
      },
    ],
  });
}

function createProject() {
  const options = { base: "#7B211A", harmony: "analogous", style: "archival", count: 6, seed: "", mood: "" };
  return {
    format: PALETTE_FORMAT,
    version: PALETTE_VERSION,
    id: createId("palette"),
    name: "Untitled palette",
    options,
    colors: generateHarmony(options.base, options.harmony, options.style, options.count, options.seed),
    history: [],
    favorites: [],
  };
}

function bindEvents() {
  byId("palette-generate").addEventListener("click", generateCandidates);
  byId("palette-regenerate-unlocked").addEventListener("click", () => {
    snapshotHistory();
    project.colors = regenerateUnlocked(project.colors, project.options);
    selectedColorId = project.colors[0].id;
    saveAndRender();
  });
  byId("palette-options").addEventListener("change", readOptions);
  byId("palette-image").addEventListener("change", extractImagePalette);
  byId("palette-assign-roles").addEventListener("click", () => {
    snapshotHistory();
    project.colors = assignSemanticRoles(project.colors);
    saveAndRender();
  });
  byId("palette-adjust-form").addEventListener("input", debounce(adjustSelectedColor, 40));
  byId("palette-vision").addEventListener("change", renderPreviews);
  byId("palette-favorite").addEventListener("click", () => {
    project.favorites.unshift({ id: createId("favorite"), colors: structuredClone(project.colors), at: new Date().toISOString() });
    project.favorites = project.favorites.slice(0, 30);
    saveAndRender();
  });
  byId("palette-save").addEventListener("click", () => downloadJson(project, "palette.vppalette.json"));
  byId("palette-open").addEventListener("click", () => byId("palette-open-input").click());
  byId("palette-open-input").addEventListener("change", openProject);
  document.querySelectorAll("[data-palette-export]").forEach((button) => button.addEventListener("click", () => exportPalette(button.dataset.paletteExport)));
  byId("palette-copy-all").addEventListener("click", () => copyText(project.colors.map((color) => `${color.role || color.id}: ${color.hex}`).join("\n")));
}

function readOptions() {
  const values = Object.fromEntries(new FormData(byId("palette-options")));
  project.options = {
    ...project.options,
    ...values,
    base: values.base.toUpperCase(),
    count: Math.max(2, Math.min(12, Number(values.count) || 6)),
  };
}

function writeOptions() {
  const form = byId("palette-options");
  Object.entries(project.options).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
}

function generateCandidates() {
  readOptions();
  snapshotHistory();
  const container = byId("palette-candidates");
  container.replaceChildren();
  for (let index = 0; index < 4; index += 1) {
    const seed = `${project.options.seed || project.options.mood || project.options.base}:${index}`;
    const colors = generateHarmony(project.options.base, project.options.harmony, inferMoodStyle(), project.options.count, seed);
    const card = element("button", "suite-card");
    card.type = "button";
    card.style.textAlign = "left";
    card.append(element("h3", "", `Candidate ${index + 1}`));
    const strip = element("div");
    strip.style.cssText = "display:flex;height:70px;";
    colors.forEach((color) => {
      const swatch = element("span");
      swatch.style.cssText = `flex:1;background:${color.hex}`;
      strip.append(swatch);
    });
    card.append(strip);
    card.addEventListener("click", () => {
      project.colors = colors;
      selectedColorId = colors[0].id;
      saveAndRender();
      toast(`Candidate ${index + 1} selected.`);
    });
    container.append(card);
  }
}

function inferMoodStyle() {
  const mood = project.options.mood.toLowerCase();
  if (/quiet|soft|calm|subtle/.test(mood)) return "muted";
  if (/bright|energetic|bold|joy/.test(mood)) return "vibrant";
  if (/night|dark|serious/.test(mood)) return "dark";
  if (/earth|forest|natural|organic/.test(mood)) return "natural";
  if (/old|archive|library|historic/.test(mood)) return "archival";
  return project.options.style;
}

function snapshotHistory() {
  project.history.unshift({ id: createId("history"), colors: structuredClone(project.colors), options: structuredClone(project.options), at: new Date().toISOString() });
  project.history = project.history.slice(0, 50);
}

async function saveAndRender() {
  await repository.put("current", project);
  render();
}

function render() {
  renderStrip();
  writeAdjustment();
  renderPreviews();
  renderHistory();
}

function renderStrip() {
  const strip = byId("palette-strip");
  strip.style.setProperty("--count", project.colors.length);
  strip.replaceChildren();
  project.colors.forEach((color) => {
    const swatch = element("div", `palette-color${color.id === selectedColorId ? " is-selected" : ""}`);
    swatch.tabIndex = 0;
    swatch.setAttribute("role", "button");
    swatch.draggable = true;
    swatch.style.background = color.hex;
    swatch.setAttribute("aria-label", `${color.hex}${color.role ? `, ${color.role}` : ""}`);
    const label = element("span");
    label.append(element("strong", "", color.hex), element("small", "", color.role || "Unassigned"));
    const lock = element("button", "palette-lock", color.locked ? "●" : "○");
    lock.type = "button";
    lock.title = color.locked ? "Unlock color" : "Lock color";
    lock.setAttribute("aria-label", lock.title);
    lock.addEventListener("click", (event) => {
      event.stopPropagation();
      color.locked = !color.locked;
      saveAndRender();
    });
    swatch.append(label, lock);
    swatch.addEventListener("click", () => {
      selectedColorId = color.id;
      renderStrip();
      writeAdjustment();
    });
    swatch.addEventListener("keydown", (event) => {
      if (event.target !== swatch) return;
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      selectedColorId = color.id;
      renderStrip();
      writeAdjustment();
    });
    swatch.addEventListener("dragstart", () => { dragColorId = color.id; });
    swatch.addEventListener("dragover", (event) => event.preventDefault());
    swatch.addEventListener("drop", () => reorderColor(color.id));
    strip.append(swatch);
  });
}

function reorderColor(targetId) {
  if (!dragColorId || dragColorId === targetId) return;
  const source = project.colors.findIndex((color) => color.id === dragColorId);
  const target = project.colors.findIndex((color) => color.id === targetId);
  const [moved] = project.colors.splice(source, 1);
  project.colors.splice(target, 0, moved);
  dragColorId = null;
  saveAndRender();
}

function writeAdjustment() {
  const color = selectedColor();
  if (!color) return;
  const oklch = rgbToOklch(hexToRgb(color.hex));
  const form = byId("palette-adjust-form");
  form.elements.hex.value = color.hex;
  form.elements.hue.value = oklch.h;
  form.elements.chroma.value = oklch.c;
  form.elements.lightness.value = oklch.l;
  form.elements.role.value = color.role || "";
  byId("palette-selected-title").textContent = `${color.role || "Selected color"} · ${color.hex}`;
  byId("palette-hue-output").textContent = `${Math.round(oklch.h)}°`;
  byId("palette-chroma-output").textContent = oklch.c.toFixed(3);
  byId("palette-lightness-output").textContent = oklch.l.toFixed(2);
}

function adjustSelectedColor(event) {
  const color = selectedColor();
  if (!color) return;
  const form = byId("palette-adjust-form");
  try {
    if (event.target.name === "hex") {
      color.hex = rgbToHex(hexToRgb(form.elements.hex.value));
    } else if (event.target.name === "role") {
      color.role = form.elements.role.value;
    } else {
      color.hex = rgbToHex(oklchToRgb({
        h: Number(form.elements.hue.value),
        c: Number(form.elements.chroma.value),
        l: Number(form.elements.lightness.value),
      }));
    }
    repository.put("current", project);
    renderStrip();
    renderPreviews();
    writeAdjustment();
  } catch {
    // Keep the previous valid color while the user is typing a partial hex.
  }
}

function renderPreviews() {
  const vision = byId("palette-vision").value;
  const colors = project.colors.map((color) => ({ ...color, display: vision ? simulateColorVision(color.hex, vision) : color.hex }));
  const role = (name, fallbackIndex) => colors.find((color) => color.role === name)?.display ?? colors[fallbackIndex % colors.length]?.display ?? "#000000";
  const preview = byId("palette-ui-preview");
  preview.style.setProperty("--preview-bg", role("background", 0));
  preview.style.setProperty("--preview-text", role("text", colors.length - 1));
  preview.style.setProperty("--preview-accent", role("accent", 2));
  byId("palette-type-preview").style.color = role("text", colors.length - 1);
  byId("palette-type-preview").style.background = role("surface", 1);
  byId("palette-type-preview").style.padding = "16px";
  const chart = byId("palette-chart-preview");
  chart.replaceChildren();
  colors.forEach((color, index) => {
    const bar = element("span");
    bar.style.setProperty("--bar", color.display);
    bar.style.height = `${35 + (index * 17) % 65}%`;
    bar.title = color.hex;
    chart.append(bar);
  });
  renderContrast(colors);
}

function renderContrast(colors) {
  const container = byId("palette-contrast");
  container.replaceChildren();
  const background = colors.find((color) => color.role === "background") ?? colors[0];
  colors.filter((color) => color.id !== background?.id).forEach((color) => {
    const ratio = contrastRatio(background.hex, color.hex);
    const card = element("div");
    card.append(element("strong", "", `${background.role || background.hex} / ${color.role || color.hex}`));
    card.append(element("p", "", `${ratio.toFixed(2)}:1 · ${ratio >= 7 ? "AAA normal text" : ratio >= 4.5 ? "AA normal text" : ratio >= 3 ? "Large text only" : "Fails text contrast"}`));
    container.append(card);
  });
}

function renderHistory() {
  renderSavedList(byId("palette-history"), project.history);
  renderSavedList(byId("palette-favorites"), project.favorites);
}

function renderSavedList(container, entries) {
  container.replaceChildren();
  entries.forEach((entry) => {
    const button = element("button", "suite-card");
    button.type = "button";
    button.append(element("strong", "", new Date(entry.at).toLocaleString()));
    const strip = element("span");
    strip.style.cssText = `display:block;height:42px;background:linear-gradient(90deg,${entry.colors.map((color, index) => `${color.hex} ${index / entry.colors.length * 100}% ${(index + 1) / entry.colors.length * 100}%`).join(",")})`;
    button.append(strip);
    button.addEventListener("click", () => {
      snapshotHistory();
      project.colors = structuredClone(entry.colors);
      if (entry.options) project.options = structuredClone(entry.options);
      selectedColorId = project.colors[0].id;
      saveAndRender();
    });
    container.append(button);
  });
  if (!entries.length) container.append(element("p", "suite-empty", "Nothing saved here yet."));
}

async function extractImagePalette(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = byId("palette-image-canvas");
    const scale = Math.min(1, 220 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const samples = [];
    for (let index = 0; index < pixels.length; index += 4 * 6) {
      if (pixels[index + 3] < 128) continue;
      samples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
    }
    const colors = await clusterInWorker(samples, project.options.count);
    snapshotHistory();
    project.colors = colors.map((hex, index) => ({ id: `color-${index + 1}`, hex, locked: false, role: "" }));
    project.options.base = colors[0];
    selectedColorId = project.colors[0].id;
    writeOptions();
    saveAndRender();
  } catch (error) {
    toast(`Image palette extraction failed: ${error.message}`, "error");
  }
}

function clusterInWorker(samples, count) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./color-aesthetic-worker.js?v=1", { type: "module" });
    const id = crypto.randomUUID();
    worker.addEventListener("message", (event) => {
      if (event.data.id !== id) return;
      worker.terminate();
      event.data.ok ? resolve(event.data.colors) : reject(new Error(event.data.error));
    });
    worker.addEventListener("error", (event) => reject(new Error(event.message)));
    worker.postMessage({ id, samples, count });
  });
}

async function openProject(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  try {
    project = migratePaletteProject(await readJsonFile(file));
    selectedColorId = project.colors[0].id;
    writeOptions();
    await saveAndRender();
  } catch (error) {
    toast(error.message, "error");
  }
}

function exportPalette(format) {
  const roles = project.colors.map((color, index) => [color.role || `color-${index + 1}`, color.hex]);
  if (format === "json") return downloadJson({ colors: Object.fromEntries(roles) }, "palette.json");
  if (format === "css") return downloadBlob(new Blob([`:root {\n${roles.map(([name, hex]) => `  --${slug(name)}: ${hex};`).join("\n")}\n}\n`], { type: "text/css" }), "palette.css");
  if (format === "scss") return downloadBlob(new Blob([`${roles.map(([name, hex]) => `$${slug(name)}: ${hex};`).join("\n")}\n`], { type: "text/x-scss" }), "palette.scss");
  if (format === "text") return downloadBlob(new Blob([`${roles.map(([name, hex]) => `${name}: ${hex}`).join("\n")}\n`], { type: "text/plain" }), "palette.txt");
  const svg = swatchSvg();
  if (format === "svg") return downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "palette.svg");
  if (format === "png") return svgToPng(svg);
}

function swatchSvg() {
  const width = 1200;
  const swatchWidth = width / project.colors.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="420" viewBox="0 0 ${width} 420"><rect width="1200" height="420" fill="#fffdf8"/>${project.colors.map((color, index) => `<rect x="${index * swatchWidth}" width="${swatchWidth}" height="320" fill="${color.hex}"/><text x="${index * swatchWidth + 12}" y="350" font-family="sans-serif" font-size="18" fill="#1b1a17">${color.hex}</text><text x="${index * swatchWidth + 12}" y="380" font-family="sans-serif" font-size="14" fill="#5e5a52">${escapeXml(color.role || `Color ${index + 1}`)}</text>`).join("")}</svg>`;
}

function svgToPng(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 420;
    canvas.getContext("2d").drawImage(image, 0, 0);
    canvas.toBlob((blob) => {
      URL.revokeObjectURL(url);
      if (blob) downloadBlob(blob, "palette.png");
    });
  };
  image.src = url;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Palette copied.");
  } catch {
    toast("Clipboard access was not available.", "error");
  }
}

function selectedColor() {
  return project.colors.find((color) => color.id === selectedColorId) ?? project.colors[0];
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[character]));
}

start();
