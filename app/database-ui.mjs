/** Personal hierarchy browser, mixed-content editor and explicit package controls. */
import { getWorkspace } from "./store.js?v=19";
import { getDatabase, saveDatabase, initializeDatabase, getAsset, addAsset, getDeviceValue, setDeviceValue, flushDatabase, listRecoveryCopies, restoreRecoveryCopy } from "./database-store.mjs";
import { newId, clone, ENTRY_TYPES, STORAGE_POLICIES, storagePolicy, removeRecord, graphNeighborhood, importNotecards, sameRecord, reviewNotecard } from "./database-model.mjs";

import { chooseLocalDirectory, localDirectory, writeFolderPackage, readFolderPackage, downloadPackage, readPackageFile, importPackage } from "./database-package.mjs";
import { prepareDriveIdentity, connectDrive, disconnectDrive, driveConnected, syncDrive, readDrivePackage, driveState, driveAccount, setDriveSettings } from "./database-drive.mjs";
import { startDriveService, driveSyncStatus } from "./drive-service.mjs";
import { createDatabaseAiAdapter } from "./database-ai-adapter.mjs";
import { createDatabaseFilesAiAdapter } from "./database-files-ai-adapter.mjs";
import { installAiPageHost } from "./ai-page-host.mjs";
import { renderDocument, sanitizeRenderedHtml } from "../tools/markdown-studio-model.mjs";
import { listKnowledgeLinks } from "./knowledge-db.mjs";

const main = document.getElementById("app-main");
const dialog = document.getElementById("database-editor");
const allowedIds = new Set();
const fileGrants = new Set();
let config;
let receipt;
let graphRoot = "library";
let graphDepth = 2;
let urls = [];
let mathModule;
let selectedRecovery = null;
let directoryIds = new Set();

function workspaceSection(db, folderId) {
  let folder = db.folders[folderId];
  while (folder && !folder.legacySection) folder = db.folders[folder.parentId];
  return folder?.legacySection;
}

const el = (tag, text = "", className = "") => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
const route = id => `#${directoryIds.has(id) ? "folder" : "entry"}=${encodeURIComponent(id)}`;
const link = (title, href, className = "") => { const node = el("a", title, className); node.href = href; return node; };
function button(title, action, className = "button button-quiet") {
  const node = el("button", title, className); node.type = "button";
  node.addEventListener("click", async () => { node.disabled = true; try { await action(); } catch (error) { message(error.message, true); } finally { node.disabled = false; } });
  return node;
}
function message(text, error = false) { const node = document.getElementById("database-message"); node.hidden = false; node.textContent = text; node.dataset.error = String(error); }
function locationIds() { const params = new URLSearchParams(location.hash.slice(1)); return { folderId: params.get("folder") ?? "library", entryId: params.get("entry"), settings: params.has("storage") }; }

async function start() {
  try {
    await initializeDatabase(); getWorkspace(); await flushDatabase(); await listKnowledgeLinks();
    config = await startDriveService(); receipt = await getDeviceValue("drive-receipt");
    installAiPageHost(createDatabaseAiAdapter({ getSnapshot: getDatabase, commitSnapshot: saveDatabase, allowedIds, getLocation: () => locationIds().entryId ?? locationIds().folderId }));
    installAiPageHost(createDatabaseFilesAiAdapter({ getRevision: () => getDatabase().revision,
      getSummary: () => ({ entryCount: Object.keys(getDatabase().entries).length, assetCount: Object.keys(getDatabase().assets).length, driveConnected: driveConnected(), driveConfigured: Boolean(config.clientId), driveRemembered: driveState().remember, driveAutoSync: driveState().autoSync }), grants: fileGrants,
      actions: {
        "package.download": async () => { await downloadPackage(config); return {}; },
        "package.save-folder": async () => { await writeFolderPackage(await localDirectory(), config); return {}; },
        "package.import-folder": async () => { await importPackage(await readFolderPackage(await localDirectory())); allowedIds.clear(); fileGrants.clear(); receipt = null; location.hash = "#folder=library"; return {}; },
        "drive.sync": async () => { const result = await syncDrive(config); window.dispatchEvent(new Event("drive:manual-sync")); receipt = await getDeviceValue("drive-receipt"); render(); return { entryCount: result.entryCount }; },
        "drive.remember": async () => { await setDriveSettings({ remember: true }); render(); return {}; },
        "drive.auto-sync.enable": async () => { await setDriveSettings({ autoSync: true }); render(); return {}; },
        "drive.auto-sync.disable": async () => { await setDriveSettings({ autoSync: false }); render(); return {}; },
        "drive.disconnect": async () => { await disconnectDrive(); render(); return {}; },
        "drive.forget": async () => { await disconnectDrive({ forget: true }); render(); return {}; },
        "package.restore-recovery": async () => { if (!selectedRecovery) throw new Error("Select a recovery copy first."); await restoreRecoveryCopy(selectedRecovery); allowedIds.clear(); fileGrants.clear(); receipt = null; render(); return {}; },
      },
    }));
    window.addEventListener("hashchange", render);
    window.addEventListener("database:changed", render);
    window.addEventListener("database:error", event => message(event.detail, true));
    window.addEventListener("drive:status", () => {
      const node = document.getElementById("drive-sync-status"); if (node) node.textContent = driveSyncStatus();
      const connection = document.getElementById("drive-connection"); if (connection) connection.textContent = driveConnected() ? "Disconnect Drive" : connection.dataset.idleLabel;
      const auto = document.getElementById("drive-auto-sync"); if (auto) { auto.disabled = !driveConnected() || !navigator.locks; auto.checked = driveState().autoSync; }
      const remember = document.getElementById("drive-remember"); if (remember) remember.checked = driveState().remember;
    });
    window.addEventListener("drive:synced", async () => { receipt = await getDeviceValue("drive-receipt"); if (!dialog.open) render(); });
    document.getElementById("package-import").addEventListener("change", async event => {
      const file = event.target.files[0]; event.target.value = ""; if (!file) return;
      try { await confirmImport(await readPackageFile(file)); } catch (error) { message(error.message, true); }
    });
    render();
    // Import existing public cards once, preserving IDs and review records.
    for (const [subject, path] of [["Mathematics", "mathematics"], ["Arts", "arts"]]) {
      if (getDatabase().migrations[`notecards:${subject}`]) continue;
      try {
        const response = await fetch(new URL(`../educational_resources/${path}/flashcards.json`, import.meta.url));
        if (!response.ok) throw new Error(`Cannot load ${subject} notecards.`);
        const source = await response.json(); await saveDatabase(importNotecards(getDatabase(), subject, source));
      } catch (error) { message(`${error.message} Your saved entries are available; existing card practice still works.`, true); }
    }
  } catch (error) { main.replaceChildren(el("h1", "Your library could not open"), el("p", error.message), button("Retry", () => location.reload())); }
}

function render() {
  for (const url of urls) URL.revokeObjectURL(url); urls = [];
  const db = getDatabase(); const { folderId, entryId, settings } = locationIds();
  directoryIds = new Set(Object.keys(db.folders));
  renderSidebar(db, folderId);
  main.replaceChildren();
  if (settings) { void renderStorage().catch(error => message(error.message, true)); return; }
  if (entryId) { const entry = db.entries[entryId]; if (entry) { void renderEntry(db, entry).catch(error => message(error.message, true)); return; } }
  const folder = db.folders[folderId] ?? db.folders.library;
  if (!folder) { main.append(el("h1", "Database"), el("p", "This package has no Library directory. Import your complete package to restore its navigation.")); return; }
  main.dataset.sectionTitle = folder.title;
  main.append(breadcrumbs(db, folder.id), el("p", "PERSONAL DATABASE", "eyebrow"), el("h1", folder.title));
  const actions = el("div", "", "database-actions");
  actions.append(button("New folder", () => editFolder(folder.id)), button("New entry", () => editEntry(folder.id), "button button-primary"), button("Storage", () => editStorage(folder)), button("Graph", () => { graphRoot = folder.id; renderGraph(db, folder.id); }), grantButton(db, folder.id));
  if (folder.parentId && !folder.role && !folder.legacySection) actions.append(button("Edit folder", () => editFolder(folder.parentId, folder)));
  main.append(actions, el("p", `Storage: ${storageLabel(db, folder)}. Subdirectories inherit this unless overridden.`, "database-help"));
  if (folder.role === "graphs") {
    main.append(el("p", "Explore the live hierarchy and references. Save a view to revisit its center and depth; the graph itself is never duplicated."));
    renderGraph(db, graphRoot, false);
  } else if (folder.role === "notecards") {
    main.append(el("p", "Cards live here once. Reference their IDs from entries or decks; every review updates the original card."));
    main.append(button("Review due cards", () => reviewCollection(folder.id)));
  } else if (folder.role === "glossary") main.append(el("p", "Keep definitions here and reference them from any entry."));
  else if (folder.role === "documents") main.append(el("p", "Store standalone documents here. Images and documents used in other entries stay with those entries."));
  if (folder.legacySection) main.append(link("Open the specialized collection editor →", `workspace.html#section=${encodeURIComponent(folder.legacySection.id)}`, "database-reference"));
  const children = [...Object.values(db.folders).filter(item => item.parentId === folder.id), ...Object.values(db.entries).filter(item => item.parentId === folder.id)];
  const search = el("input", "", "database-search"); search.type = "search"; search.placeholder = "Search within this directory…"; search.setAttribute("aria-label", "Search this directory");
  const list = el("ul", "", "database-list");
  const fill = () => {
    const query = search.value.trim().toLowerCase(); const recursive = query ? descendants(db, folder.id).filter(item => item.title.toLowerCase().includes(query)) : children;
    list.replaceChildren();
    for (const item of recursive.sort((a, b) => a.title.localeCompare(b.title)).slice(0, 150)) {
      const row = el("li"); const anchor = link("", route(item.id));
      anchor.append(el("span", db.folders[item.id] ? "▸" : item.type === "notecard" ? "▤" : "·"), el("strong", item.title), el("small", db.folders[item.id] ? "Directory" : item.type), el("span", storageLabel(db, item), "database-badge")); row.append(anchor); list.append(row);
    }
    if (!list.children.length) list.append(el("li", query ? "No matching entries." : "This directory is empty. Add a folder or an entry."));
    if (recursive.length > 150) list.append(el("li", `${recursive.length} results. Refine your search to see the rest.`));
  };
  search.addEventListener("input", fill); fill(); main.append(search, list);
}

function renderSidebar(db, selected) {
  const sidebar = document.getElementById("database-sidebar"); sidebar.replaceChildren(el("p", "YOUR DATABASE", "eyebrow"));
  for (const id of ["sharedvp", "everyday", "research", "studies-projects", "library"]) {
    if (!db.folders[id]) continue;
    const anchor = link(db.folders[id].title, id === "sharedvp" ? "sharedvp.html" : route(id)); if (id === selected) anchor.setAttribute("aria-current", "page"); sidebar.append(anchor);
  }
  sidebar.append(el("p", "LIBRARY", "eyebrow"));
  for (const id of ["knowledge-graphs", "documents", "glossary", "notecards"]) {
    if (!db.folders[id]) continue; const anchor = link(db.folders[id].title, route(id)); if (id === selected) anchor.setAttribute("aria-current", "page"); sidebar.append(anchor);
  }
  sidebar.append(el("p", "FILES & BACKUP", "eyebrow"), link("Storage & backup", "#storage"));
}
function breadcrumbs(db, id) {
  const trail = []; let item = db.folders[id]; while (item) { trail.unshift(item); item = db.folders[item.parentId]; }
  const nav = el("nav", "", "database-crumbs"); nav.setAttribute("aria-label", "Directory path");
  trail.forEach((folder, index) => { if (index) nav.append(el("span", "/")); nav.append(link(folder.title, route(folder.id))); }); return nav;
}
function storageLabel(db, item) {
  const policy = storagePolicy(db, item.id);
  const confirmed = receipt?.datasetId === db.datasetId && sameRecord(receipt.database?.entries?.[item.id] ?? receipt.database?.folders?.[item.id], item);
  return policy === "local" ? "Local" : `${policy === "both" ? "Local + cloud" : "Cloud"} · ${confirmed ? "synced" : "pending"}`;
}
function descendants(db, id) {
  const children = Object.values(db.folders).concat(Object.values(db.entries)); const ids = new Set([id]); let found = true;
  while (found) { found = false; for (const item of children) if (ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); found = true; } }
  return children.filter(item => item.id !== id && ids.has(item.id));
}
function grantButton(db, id) {
  return button(allowedIds.has(id) ? "Revoke AI access here" : "Allow AI access here", () => {
    const ids = [id, ...Object.values(db.entries).filter(item => item.parentId === id).map(item => item.id), ...Object.values(db.folders).filter(item => item.parentId === id).map(item => item.id)];
    if (allowedIds.has(id)) allowedIds.clear(); else ids.forEach(value => allowedIds.add(value));
    message("AI access applies only to this entry or directory and its current direct children, until this page closes."); render();
  });
}

async function renderEntry(db, entry) {
  const currentId = entry.id;
  main.append(breadcrumbs(db, entry.parentId), el("p", entry.type.toUpperCase(), "eyebrow"), el("h1", entry.title));
  const actions = el("div", "", "database-actions"); actions.append(button("Edit", () => editEntry(entry.parentId, entry)), button("Storage", () => editStorage(entry)), button("Graph", () => { graphRoot = entry.id; renderGraph(db, entry.id); }), grantButton(db, entry.id), button("Delete", async () => {
    if (!confirm(`Delete “${entry.title}”?`)) return; const next = getDatabase(); removeRecord(next, entry.id); await saveDatabase(next); location.hash = route(entry.parentId);
  })); main.append(actions, el("p", `${storageLabel(db, entry)} · ID: ${entry.id}`, "database-help"));
  const article = el("article", "", "database-entry"); main.append(article);
  if (entry.id.startsWith("workspace:")) {
    const section = workspaceSection(db, entry.parentId);
    article.append(link("Open the full entry and its specialized editor →", `workspace.html#section=${encodeURIComponent(section?.id ?? "")}&item=${encodeURIComponent(entry.data.id)}`, "database-reference"));
    if (entry.data.summary) article.append(el("p", entry.data.summary));
  }
  if (entry.type === "glossary") { article.append(markdown(entry.data.definition ?? "")); if (entry.data.aliases?.length) article.append(el("p", `Also: ${entry.data.aliases.join(", ")}`, "database-help")); }
  if (entry.type === "notecard") article.append(cardPanel(entry));
  if (entry.type === "practice-state") {
    article.append(el("p", `${entry.data.pendingReviews?.length ?? 0} drafted submissions · ${entry.data.wrongQueue?.length ?? 0} missed generated problems`), link("Open subject practice →", `educational_resources/${entry.parentId.includes("Mathematics") ? "mathematics" : "arts"}/flashcard-practice.html`, "database-reference"));
  }
  if (entry.type === "deck") for (const id of entry.data.cardIds ?? []) { const card = db.entries[id]; if (card) article.append(link(card.title, route(id), "database-reference")); }
  if (entry.type === "graph") renderGraph(db, entry.data.rootId ?? "library", false, article, entry.data.depth ?? 2);
  for (const block of entry.content) {
    if (locationIds().entryId !== currentId) return;
    if (block.type === "markdown") article.append(markdown(block.text));
    else if (block.type === "equation") { const math = el("div", "", "math-render"); math.dataset.latex = block.text ?? ""; math.dataset.display = "true"; math.append(el("code", block.text)); article.append(math); }
    else if (["image", "document"].includes(block.type)) {
      const asset = db.assets[block.assetId]; const blob = await getAsset(block.assetId);
      if (locationIds().entryId !== currentId) return;
      if (!blob) { article.append(el("p", `Attachment unavailable on this device: ${asset.name}. Import the complete package or sync Drive.`)); continue; }
      const url = URL.createObjectURL(blob); urls.push(url);
      if (block.type === "image") { const image = el("img"); image.src = url; image.alt = block.caption ?? asset.name; image.loading = "lazy"; article.append(image); }
      const download = link(block.caption || asset.name, url, "database-reference"); download.download = asset.name; article.append(download);
      if (block.source) article.append(el("pre", block.source));
    } else if (["notecard", "glossary"].includes(block.type)) {
      const target = db.entries[block.entryId]; if (target) { const reference = link(target.title, route(target.id), "database-reference"); if (target.type === "glossary") reference.append(el("p", target.data.definition)); article.append(reference); }
    } else if (["link", "interactable"].includes(block.type)) {
      const anchor = link(block.label || block.url, block.url, "database-reference"); anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; article.append(anchor);
      if (block.embed) article.append(button("Load interactable", () => {
        const iframe = el("iframe"); iframe.src = block.url; iframe.title = block.label || "Interactable"; iframe.loading = "lazy"; iframe.setAttribute("sandbox", "allow-scripts allow-forms"); iframe.referrerPolicy = "no-referrer"; article.append(iframe);
      }));
    } else if (block.type === "diagram") article.append(el("pre", block.text));
  }
  const related = Object.values(db.links).filter(item => item.sourceId === entry.id || item.targetId === entry.id);
  if (related.length) { article.append(el("h2", "Connections")); for (const edge of related) { const id = edge.sourceId === entry.id ? edge.targetId : edge.sourceId; article.append(link(`${edge.type}: ${(db.entries[id] ?? db.folders[id]).title}`, route(id), "database-reference")); } }
  main.append(button("Add connection", () => editConnection(entry.id)));
  await renderMath(article);
}
function markdown(source) { const node = el("div"); node.innerHTML = sanitizeRenderedHtml(renderDocument(source ?? "", "markdown-math")); return node; }
async function renderMath(parent) {
  const nodes = [...parent.querySelectorAll(".math-render")]; if (!nodes.length) return;
  try {
    if (!document.querySelector("link[data-database-math]")) { const css = el("link"); css.rel = "stylesheet"; css.href = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"; css.dataset.databaseMath = "true"; document.head.append(css); }
    mathModule ??= await import("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.mjs");
    for (const node of nodes) mathModule.render(node.dataset.latex, node, { displayMode: node.dataset.display === "true", throwOnError: false, trust: false });
  } catch { /* Offline source stays visible and editable. */ }
}

function cardPanel(entry, next = null) {
  const panel = el("section", "", "database-card"); const data = entry.data;
  const answer = markdown(data.back ?? data.answer ?? ""); answer.hidden = true;
  panel.append(markdown(data.front ?? data.question ?? entry.title), button("Show answer", () => { answer.hidden = !answer.hidden; }), answer);
  const actions = el("div", "", "database-actions");
  for (const remembered of [false, true]) actions.append(button(remembered ? "Remembered" : "Review again", async () => {
    const db = getDatabase(); reviewNotecard(db, entry.id, remembered);
    await saveDatabase(db); if (next) next(); else message("Review saved to the original card.");
  })); panel.append(actions, el("p", `Reviewed ${data.review?.count ?? 0} times`, "database-help")); void renderMath(panel); return panel;
}
function reviewCollection(id) {
  const cards = descendants(getDatabase(), id).filter(item => item.type === "notecard" && (!item.data.review?.dueAt || Date.parse(item.data.review.dueAt) <= Date.now()));
  let index = 0; const show = () => {
    main.replaceChildren(link("← Back to cards", route(id)), el("h1", "Notecard review"));
    if (index >= cards.length) { main.append(el("p", "All due cards reviewed.")); return; }
    const entry = getDatabase().entries[cards[index].id]; main.append(el("p", `${index + 1} of ${cards.length}`), cardPanel(entry, () => { index++; show(); }));
  }; show();
}

function showForm(title, fields, onSubmit, extra = null) {
  dialog.replaceChildren(); const form = el("form", "", "database-form"); form.append(el("h2", title), ...fields);
  const actions = el("div", "", "database-actions"); actions.append(button("Cancel", () => dialog.close())); if (extra) actions.append(extra);
  const save = el("button", "Save", "button button-primary"); save.type = "submit"; actions.append(save); form.append(actions);
  form.addEventListener("submit", async event => { event.preventDefault(); save.disabled = true; try { await onSubmit(); dialog.close(); render(); } catch (error) { message(error.message, true); } finally { save.disabled = false; } });
  dialog.append(form); dialog.showModal();
}
function field(title, tag = "input", value = "") { const label = el("label", title); const input = el(tag); input.value = value; label.append(input); return { label, input }; }
function selectField(title, options, selected) { const control = field(title, "select"); for (const [value, title] of options) { const option = el("option", title); option.value = value; control.input.append(option); } control.input.value = selected; return control; }
function policyControl(selected) { return selectField("Storage", STORAGE_POLICIES.map(value => [value, { inherit: "Inherit directory setting", local: "Local", cloud: "Cloud (browser cache while editing)", both: "Local + cloud" }[value]]), selected); }
function editStorage(record) {
  const policy = policyControl(record.storage ?? "inherit");
  showForm("Storage preference", [policy.label, el("p", "Cloud-selected content will be queued if automatic sync is enabled. Otherwise, use Storage & backup to save files or sync Google Drive manually.", "database-help")], async () => { const db = getDatabase(); (db.folders[record.id] ?? db.entries[record.id]).storage = policy.input.value; await saveDatabase(db); });
}
function editFolder(parentId, existing = null) {
  const title = field("Directory name", "input", existing?.title ?? ""); title.input.required = true;
  const policy = policyControl(existing?.storage ?? "inherit");
  showForm(existing ? "Edit directory" : "New directory", [title.label, policy.label], async () => {
    const db = getDatabase(); const id = existing?.id ?? newId("folder"); db.folders[id] = { ...existing, id, parentId, title: title.input.value.trim(), storage: policy.input.value }; await saveDatabase(db);
  }, existing ? button("Delete empty directory", async () => { if (!confirm(`Delete “${existing.title}”?`)) return; const db = getDatabase(); removeRecord(db, existing.id); await saveDatabase(db); dialog.close(); location.hash = route(parentId); }) : null);
}
function editEntry(parentId, existing = null) {
  if (existing?.type === "practice-state") { location.href = `educational_resources/${parentId.includes("Mathematics") ? "mathematics" : "arts"}/flashcard-practice.html`; return; }
  if (existing?.id.startsWith("workspace:")) { location.href = `workspace.html#section=${encodeURIComponent(workspaceSection(getDatabase(), parentId).id)}&item=${encodeURIComponent(existing.data.id)}`; return; }
  const db = getDatabase(); const role = db.folders[parentId]?.role;
  const suggested = { glossary: "glossary", notecards: "notecard", documents: "document", graphs: "graph" }[role] ?? "blog";
  const title = field("Title", "input", existing?.title ?? ""); title.input.required = true;
  const type = selectField("Entry type", ENTRY_TYPES.map(value => [value, value === "blog" ? "Mixed article" : value[0].toUpperCase() + value.slice(1)]), existing?.type ?? suggested);
  type.input.disabled = Boolean(existing);
  const directory = selectField("Directory", Object.values(db.folders).filter(folder => folder.id !== "sharedvp").map(folder => [folder.id, pathTitle(db, folder.id)]), parentId);
  const policy = policyControl(existing?.storage ?? "inherit"); const special = el("div"); const blocksNode = el("div"); const toolbar = el("div", "", "database-actions"); const blocks = clone(existing?.content ?? []);
  if (!existing && ["blog", "text"].includes(type.input.value)) blocks.push({ type: "markdown", text: "" });
  let readSpecial = () => existing?.data ?? {};
  const refreshSpecial = () => {
    special.replaceChildren(); const current = type.input.value;
    if (current === "notecard") {
      if (!isInsideRole(db, directory.input.value, "notecards")) directory.input.value = "notecards";
      const front = field("Front (Markdown and LaTeX)", "textarea", existing?.data.front ?? ""); const back = field("Back", "textarea", existing?.data.back ?? ""); special.append(front.label, back.label); readSpecial = () => ({ ...existing?.data, front: front.input.value, back: back.input.value });
    } else if (current === "glossary") {
      if (!isInsideRole(db, directory.input.value, "glossary")) directory.input.value = "glossary";
      const definition = field("Definition", "textarea", existing?.data.definition ?? ""); const aliases = field("Aliases (comma separated)", "input", existing?.data.aliases?.join(", ") ?? ""); special.append(definition.label, aliases.label);
      readSpecial = () => ({ ...existing?.data, term: title.input.value.trim(), definition: definition.input.value, aliases: aliases.input.value.split(",").map(value => value.trim()).filter(Boolean) });
    } else if (current === "deck") {
      const cards = field("Card IDs (one per line)", "textarea", existing?.data.cardIds?.join("\n") ?? ""); special.append(cards.label, el("p", "Copy IDs from the Notecards library. Decks reference existing cards.", "database-help")); readSpecial = () => ({ cardIds: cards.input.value.split("\n").map(value => value.trim()).filter(Boolean) });
    } else if (current === "graph") {
      const root = selectField("Graph center", [...Object.values(db.folders), ...Object.values(db.entries).filter(entry => entry.type !== "graph")].map(item => [item.id, item.title]), existing?.data.rootId ?? graphRoot);
      const depth = field("Connections deep (0–6)", "input", existing?.data.depth ?? graphDepth); depth.input.type = "number"; depth.input.min = "0"; depth.input.max = "6"; special.append(root.label, depth.label); readSpecial = () => ({ rootId: root.input.value, depth: Number(depth.input.value) });
    } else readSpecial = () => existing?.data ?? {};
  };
  const refreshBlocks = () => { blocksNode.replaceChildren(); blocks.forEach((block, index) => blocksNode.append(blockEditor(block, index, blocks, refreshBlocks))); };
  const addType = selectField("Add content", [["markdown", "Text / Markdown"], ["equation", "LaTeX equation"], ["image", "Image / diagram file"], ["document", "Document file"], ["link", "Link"], ["notecard", "Notecard reference"], ["glossary", "Glossary reference"], ["interactable", "Interactable link / embed"], ["diagram", "Editable diagram source"]], "markdown");
  toolbar.append(addType.label, button("Add block", () => { blocks.push({ type: addType.input.value, ...(["markdown", "equation", "diagram"].includes(addType.input.value) ? { text: "" } : {}) }); refreshBlocks(); }));
  type.input.addEventListener("change", refreshSpecial); refreshSpecial(); refreshBlocks();
  showForm(existing ? "Edit entry" : "New entry", [title.label, type.label, directory.label, policy.label, special, blocksNode, toolbar], async () => {
    const next = getDatabase(); const data = readSpecial(); let id = existing?.id ?? newId(type.input.value === "glossary" ? "glossary" : "entry");
    if (type.input.value === "glossary") { if (!existing) id = `glossary:${id}`; data.id = id.replace(/^glossary:/, ""); }
    next.entries[id] = { ...existing, id, parentId: directory.input.value, type: type.input.value, title: title.input.value.trim(), content: blocks, data, storage: policy.input.value, updatedAt: new Date().toISOString() };
    await saveDatabase(next); location.hash = route(id);
  });
}

function blockEditor(block, index, blocks, refresh) {
  const container = el("section", "", "database-block-editor"); container.append(el("strong", `${index + 1}. ${block.type}`));
  const bind = (label, key, tag = "input") => { const control = field(label, tag, block[key] ?? ""); control.input.addEventListener("input", () => { block[key] = control.input.value; }); container.append(control.label); return control.input; };
  if (["markdown", "equation", "diagram"].includes(block.type)) bind(block.type === "equation" ? "LaTeX source" : block.type === "diagram" ? "Diagram source (Mermaid, SVG or code; stored as editable text)" : "Markdown", "text", "textarea");
  else if (["image", "document"].includes(block.type)) {
    const file = field("Attachment", "input"); file.input.type = "file"; if (block.type === "image") file.input.accept = "image/*";
    const status = el("p", block.assetId ? getDatabase().assets[block.assetId]?.name : "Choose a file", "database-help");
    file.input.addEventListener("change", async () => { try { const asset = await addAsset(file.input.files[0]); block.assetId = asset.id; status.textContent = asset.name; } catch (error) { message(error.message, true); } });
    container.append(file.label, status); bind("Caption", "caption"); if (block.type === "image") bind("Editable source (optional)", "source", "textarea");
  } else if (["notecard", "glossary"].includes(block.type)) {
    const db = getDatabase(); const options = Object.values(db.entries).filter(entry => entry.type === block.type).map(entry => [entry.id, entry.title]);
    const reference = selectField("Reference original entry", [["", "Choose an entry"], ...options], block.entryId ?? ""); reference.input.addEventListener("change", () => { block.entryId = reference.input.value; }); container.append(reference.label);
  } else {
    bind("Link label", "label"); bind("URL (relative site link or HTTPS)", "url");
    if (block.type === "interactable") { const checkbox = field("Offer embedded view", "input"); checkbox.input.type = "checkbox"; checkbox.input.checked = Boolean(block.embed); checkbox.input.addEventListener("change", () => { block.embed = checkbox.input.checked; }); container.append(checkbox.label); bind("Notes / starting parameters", "notes", "textarea"); }
  }
  const actions = el("div", "", "database-actions"); actions.append(button("Remove", () => { blocks.splice(index, 1); refresh(); }));
  if (index > 0) actions.append(button("Move up", () => { [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]]; refresh(); })); container.append(actions); return container;
}
function pathTitle(db, id) { const parts = []; let folder = db.folders[id]; while (folder) { parts.unshift(folder.title); folder = db.folders[folder.parentId]; } return parts.join(" / "); }
function isInsideRole(db, id, role) { let folder = db.folders[id]; while (folder) { if (folder.role === role) return true; folder = db.folders[folder.parentId]; } return false; }
function editConnection(sourceId) {
  const db = getDatabase(); const target = selectField("Connect to", Object.values(db.entries).concat(Object.values(db.folders)).filter(item => item.id !== sourceId).map(item => [item.id, item.title]), ""); const label = field("Relationship", "input", "related");
  showForm("Add connection", [target.label, label.label], async () => { const next = getDatabase(); const id = newId("link"); next.links[id] = { id, sourceId, targetId: target.input.value, type: label.input.value.trim() || "related" }; await saveDatabase(next); });
}

function renderGraph(db, rootId, replace = true, destination = main, depth = graphDepth) {
  if (!db.folders[rootId] && !db.entries[rootId]) rootId = "library";
  const graph = graphNeighborhood(db, rootId, depth, 120);
  const section = el("section"); section.append(el("h2", `Connections around ${(db.folders[rootId] ?? db.entries[rootId]).title}`));
  const controls = el("div", "", "database-actions"); const depthControl = selectField("Connections deep", Array.from({ length: 7 }, (_, index) => [String(index), String(index)]), String(depth));
  depthControl.input.addEventListener("change", () => { graphDepth = Number(depthControl.input.value); renderGraph(getDatabase(), rootId, true); });
  controls.append(depthControl.label, button("Save graph view", () => { graphRoot = rootId; graphDepth = depth; editEntry("knowledge-graphs"); })); section.append(controls);
  const ns = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(ns, "svg"); const levels = new Map();
  for (const node of graph.nodes) { if (!levels.has(node.level)) levels.set(node.level, []); levels.get(node.level).push(node); }
  const rows = Math.max(...[...levels.values()].map(nodes => nodes.length)); const height = Math.max(500, rows * 52 + 70); const width = Math.max(850, (depth + 1) * 220);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.style.height = `${height}px`; svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Live directory and reference graph. Select a node to recenter.");
  const positions = new Map(); for (const [level, nodes] of levels) nodes.forEach((node, index) => positions.set(node.id, { x: 105 + level * 220, y: 40 + (index + .5) * (height - 80) / nodes.length }));
  for (const edge of graph.edges) {
    const from = positions.get(edge.sourceId); const to = positions.get(edge.targetId); const line = document.createElementNS(ns, "line"); for (const [key, value] of Object.entries({ x1: from.x, y1: from.y, x2: to.x, y2: to.y })) line.setAttribute(key, value); svg.append(line);
  }
  for (const node of graph.nodes) {
    const group = document.createElementNS(ns, "g"); const { x, y } = positions.get(node.id); group.setAttribute("transform", `translate(${x},${y})`); group.dataset.root = String(node.id === rootId); group.setAttribute("tabindex", "0"); group.setAttribute("role", "button"); group.setAttribute("aria-label", `Center on ${node.title}`);
    const rect = document.createElementNS(ns, "rect"); for (const [key, value] of Object.entries({ x: -92, y: -18, width: 184, height: 36, rx: 3 })) rect.setAttribute(key, value);
    const text = document.createElementNS(ns, "text"); text.setAttribute("text-anchor", "middle"); text.setAttribute("y", "4"); text.textContent = node.title.length > 26 ? `${node.title.slice(0, 25)}…` : node.title; const title = document.createElementNS(ns, "title"); title.textContent = node.title;
    const center = () => { graphRoot = node.id; renderGraph(getDatabase(), node.id, true); }; group.addEventListener("click", center); group.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); center(); } }); group.append(rect, text, title); svg.append(group);
  }
  const viewport = el("div", "", "database-graph"); viewport.append(svg); section.append(viewport, el("p", `${graph.nodes.length} nodes · depth ${depth}${graph.truncated ? " · node limit reached; reduce depth or recenter" : ""}`, "database-help"), link("Open center entry / directory →", route(rootId)));
  if (replace) main.replaceChildren(link("← Back to directory", route(locationIds().folderId)), section); else destination.append(section);
}

async function renderStorage() {
  main.append(el("p", "FILES & BACKUP", "eyebrow"), el("h1", "Storage & backup"));
  main.append(el("p", "Your database stays in this browser while you edit. Save a complete folder or ZIP package to keep a portable copy. Google Drive receives only directories and entries marked Cloud or Local + cloud."));
  const handle = await getDeviceValue("directory-handle");
  main.append(el("h2", "Local files"), el("p", handle ? `Selected folder: ${handle.name}` : "Default starting location: Documents. Choose the database folder there once to grant access.", "database-help"));
  const localActions = el("div", "", "database-actions");
  localActions.append(button("Choose local folder", async () => { await chooseLocalDirectory(); render(); }), button("Save to folder", async () => { await writeFolderPackage(await localDirectory(), config); message("Saved database.json, assets/, cloud-config.json and README.md to your folder."); }), button("Import folder", async () => { await confirmImport(await readFolderPackage(await localDirectory())); }), button("Download complete ZIP", async () => { await downloadPackage(config); message("Complete database package downloaded."); }), button("Import ZIP / JSON", () => document.getElementById("package-import").click()));
  main.append(localActions, el("p", "Folder access depends on your browser. ZIP import and export work without it. Saving refuses to overwrite a changed folder copy.", "database-help"));
  main.append(el("h2", "Google Drive"), el("p", config.clientId ? "Google sign-in is configured. Remember this browser to retain your connection through reloads and navigation in this tab. Google access still expires; reconnect when prompted. Other browser profiles and devices start disconnected." : "Not configured. Add a Google web OAuth client ID to cloud-config.json and authorize this site’s origin. No password or secret belongs in that file.", "database-help"));
  const account = await driveAccount();
  if (account) main.append(el("p", `This browser library is bound to ${account.email || "your original Google account"}. A different account cannot sync it.`, "database-help"));
  main.append(el("p", "Shared device? Use separate browser profiles. Disconnect and Forget connection stop Drive access but do not hide or delete this browser’s library. Forget keeps the account safety binding. Browser storage is not encrypted by this feature.", "database-help"));
  const status = el("p", driveSyncStatus(), "database-help"); status.id = "drive-sync-status"; status.setAttribute("role", "status"); main.append(status);
  if (config.clientId) void prepareDriveIdentity(config).catch(error => message(error.message, true));
  const cloudActions = el("div", "", "database-actions");
  cloudActions.append(button(driveConnected() ? "Disconnect Drive" : account ? "Reconnect Google Drive" : "Connect Google Drive", async () => { if (driveConnected()) await disconnectDrive(); else await connectDrive(config); render(); }), button("Sync selected content", async () => {
    message("Syncing selected content…"); const result = await syncDrive(config); window.dispatchEvent(new Event("drive:manual-sync")); receipt = await getDeviceValue("drive-receipt"); message(`Drive sync complete: ${result.entryCount} entries.`); render();
  }));
  cloudActions.firstElementChild.id = "drive-connection";
  cloudActions.firstElementChild.dataset.idleLabel = account ? "Reconnect Google Drive" : "Connect Google Drive";
  main.append(cloudActions);
  const remember = el("label", "Remember this browser (use only in your own browser profile) ");
  const rememberInput = el("input"); rememberInput.id = "drive-remember"; rememberInput.type = "checkbox"; rememberInput.checked = driveState().remember;
  rememberInput.addEventListener("change", async () => { try { await setDriveSettings({ remember: rememberInput.checked }); } catch (error) { message(error.message, true); } render(); }); remember.prepend(rememberInput);
  const auto = el("label", "Automatically sync cloud-selected content while this site is open ");
  const autoInput = el("input"); autoInput.id = "drive-auto-sync"; autoInput.type = "checkbox"; autoInput.checked = driveState().autoSync; autoInput.disabled = !driveConnected() || !navigator.locks;
  autoInput.addEventListener("change", async () => { try { await setDriveSettings({ autoSync: autoInput.checked }); } catch (error) { message(error.message, true); } render(); }); auto.prepend(autoInput);
  const preferences = el("div", "", "database-drive-preferences"); preferences.append(remember, auto);
  const forgetActions = el("div", "", "database-actions"); forgetActions.append(button("Forget connection in this browser", async () => { await disconnectDrive({ forget: true }); message("Connection forgotten and automatic sync stopped. Local entries and the account safety binding remain."); render(); }));
  main.append(preferences, el("p", "Automatic sync includes future edits to Cloud / Local + cloud entries and checks for changes about once a minute. Offline edits stay pending in this browser. Closing the site stops sync; expired Google access needs a Reconnect click. Local-only entries and separate tool stores are not uploaded.", "database-help"), forgetActions);
  if (receipt?.datasetId === getDatabase().datasetId) main.append(el("p", `Last completed sync: ${new Date(receipt.at).toLocaleString()}`, "database-help"), link("Open Drive package →", `https://drive.google.com/drive/folders/${encodeURIComponent(receipt.folderId)}`, "database-reference"));
  const folderId = field("Existing VP Drive folder ID (for another device)"); const cloudImport = el("div", "", "database-actions");
  cloudImport.append(button("Import Drive package", async () => { const packageData = await readDrivePackage(folderId.input.value.trim()); if (await confirmImport(packageData)) await setDeviceValue(`drive-folder:${packageData.database.datasetId}`, packageData.folderId); }));
  main.append(folderId.label, cloudImport);
  const conflicts = await getDeviceValue("drive-conflicts");
  if (conflicts?.conflicts?.length) {
    main.append(el("h2", "Sync conflicts"), el("p", "Both copies are preserved. Edit the local entry to match the remote version, or keep your local version by resolving it below. The next sync still checks for newer changes."));
    for (const conflict of conflicts.conflicts) {
      const row = el("div", "", "database-card"); row.append(el("strong", conflict.id));
      row.append(conflictVersion("This device", conflict.local), conflictVersion("Google Drive", conflict.remote));
      if (conflict.reason) row.append(el("p", "This entry was deleted on another device."));
      row.append(button("Keep local for this conflict", () => resolveConflict(conflict, "local")), button("Use remote for this conflict", () => resolveConflict(conflict, "remote"))); main.append(row);
    }
  }
  main.append(el("h2", "Browser storage"), button("Ask browser to retain data", async () => { const persisted = await navigator.storage?.persist?.(); message(persisted ? "Browser persistence granted. Keep a file backup too." : "Persistence was not granted. Keep a folder or ZIP backup."); }));
  const recoveryKeys = await listRecoveryCopies();
  if (recoveryKeys.length) {
    const recovery = selectField("Recovery copy", recoveryKeys.map(key => [key, new Date(Number(key.slice(9))).toLocaleString()]), recoveryKeys[0]);
    selectedRecovery = recovery.input.value; recovery.input.addEventListener("change", () => { selectedRecovery = recovery.input.value; });
    main.append(el("h2", "Recovery"), recovery.label, button("Restore selected copy", async () => { if (!confirm("Restore this copy? Your current database will be retained as a new recovery copy.")) return; await restoreRecoveryCopy(selectedRecovery); allowedIds.clear(); receipt = null; message("Recovery copy restored."); render(); }));
  }
  main.append(el("h2", "AI file access"), el("p", "Grant one specific action after selecting your folder or connecting Drive. The command receives a completion receipt; your files and credentials are not returned.", "database-help"));
  const action = selectField("Allow once", [["package.download", "Download complete ZIP"], ["package.save-folder", "Save selected local folder"], ["package.import-folder", "Import selected local folder (replace current database)"], ["drive.sync", "Sync selected cloud content"], ["drive.remember", "Remember this browser connection"], ["drive.auto-sync.enable", "Enable ongoing sync of cloud-selected content"], ["drive.auto-sync.disable", "Disable automatic sync"], ["drive.disconnect", "Disconnect Drive (keeps local data)"], ["drive.forget", "Forget connection (keeps local data and safety binding)"], ["package.restore-recovery", "Restore selected recovery copy"]], "package.download");
  main.append(action.label, button("Allow this AI action once", () => { fileGrants.add(action.input.value); message(`Allowed once: ${action.input.value}. Access ends when this page closes.`); }));
}
function conflictVersion(title, record) {
  const section = el("section"); section.append(el("h3", title));
  if (!record) { section.append(el("p", "Deleted or unavailable in this copy.")); return section; }
  section.append(el("strong", record.title ?? "Saved record"));
  for (const block of record.content ?? []) {
    if (block.text) section.append(el("p", block.text));
    else if (block.url) section.append(el("p", block.url));
    else if (block.entryId) section.append(el("p", `Reference: ${block.entryId}`));
    else if (block.assetId) section.append(el("p", `Attachment: ${block.caption ?? block.assetId}`));
  }
  for (const [key, value] of Object.entries(record.data ?? {})) {
    if (["id", "createdAt", "updatedAt"].includes(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value)) {
      const label = key.replace(/([A-Z])/g, " $1").replace(/_/g, " ");
      section.append(el("p", `${label}: ${Array.isArray(value) ? value.join("; ") : value}`));
    }
  }
  return section;
}
async function resolveConflict(conflict, choice) {
  const db = getDatabase(); const saved = await getDeviceValue("drive-conflicts"); const root = await getDeviceValue(`drive-folder:${db.datasetId}`); const base = await getDeviceValue(`drive-base:${root}`);
  if (!saved?.remote || !root) throw new Error("Reconnect and retry sync to refresh this conflict.");
  const baseline = base ?? clone(saved.remote);
  // Resolve exactly one record against the downloaded remote revision. Any
  // later remote edit remains a new conflict during the next three-way merge.
  const remoteRecord = saved.remote[conflict.table]?.[conflict.id];
  if (remoteRecord) baseline[conflict.table][conflict.id] = clone(remoteRecord); else delete baseline[conflict.table][conflict.id];
  if (saved.remote.tombstones[conflict.id]) baseline.tombstones[conflict.id] = clone(saved.remote.tombstones[conflict.id]); else delete baseline.tombstones[conflict.id];
  if (choice === "remote") {
    if (remoteRecord) db[conflict.table][conflict.id] = clone(remoteRecord); else delete db[conflict.table][conflict.id];
    if (saved.remote.tombstones[conflict.id]) db.tombstones[conflict.id] = clone(saved.remote.tombstones[conflict.id]); else delete db.tombstones[conflict.id];
    await saveDatabase(db);
  } else if (conflict.reason) { delete db.tombstones[conflict.id]; await saveDatabase(db); }
  await setDeviceValue(`drive-base:${root}`, baseline); saved.conflicts = saved.conflicts.filter(item => item.id !== conflict.id || item.table !== conflict.table); await setDeviceValue("drive-conflicts", saved.conflicts.length ? saved : null); render();
}
async function confirmImport(packageData) {
  if (!confirm(`Open this package (${Object.keys(packageData.database.entries).length} entries)? Your current database is saved as a recovery copy in this browser first.`)) return false;
  await importPackage(packageData); allowedIds.clear(); receipt = null; location.hash = "#folder=library"; message("Database imported. The previous database is retained as a recovery copy."); return true;
}

void start();
