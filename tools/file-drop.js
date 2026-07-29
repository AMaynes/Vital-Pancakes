import {
  createId,
  createRepository,
  downloadBlob,
  downloadJson,
  estimateStorage,
  requestPersistentStorage,
} from "./local-toolkit.mjs";
import {
  buildManifest,
  createFileDropState,
  findDuplicate,
  getPreviewKind,
  recoverFile,
  removeFolder,
  renamePreservingExtension,
  safeStoredFilename,
  trashFile,
  validateFileDropState,
} from "./file-drop-model.mjs";
import { activateTabs, element, formatBytes, parseTags, toast } from "./suite-ui.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
  requireCommandString,
} from "./current-tool-ai-adapter.mjs?v=1";

const metadataRepository = createRepository("file-drop");
const blobRepository = createRepository("file-drop", { blobs: true });
const activeImports = new Map();
const objectUrls = new Set();
let state = createFileDropState();
let selectedFolderId = "";
let selectedCollectionId = "";

const byId = (id) => document.getElementById(id);

async function start() {
  try {
    state = validateFileDropState((await metadataRepository.get("state")) ?? createFileDropState());
    const interrupted = state.files.filter((file) => file.status === "importing");
    interrupted.forEach((file) => { file.status = "interrupted"; });
    if (interrupted.length) await save();
  } catch (error) {
    toast(`Saved File Drop metadata could not be opened: ${error.message}`, "error");
  }
  activateTabs(document.querySelector(".suite-tabs"), (tab) => {
    if (tab.includes("storage")) updateStorage();
  });
  bindEvents();
  render();
  installFileDropAiHost();
}

function installFileDropAiHost() {
  installCurrentToolAiHost({
    id: "file-drop",
    title: "File Drop",
    description: "Organizes local vault metadata without exposing or reading stored file bytes.",
    limitations: [
      "AI commands cannot read, preview, hash, download, upload, or permanently delete file contents.",
      "Recoverable trash is the only AI-accessible deletion action.",
    ],
    getSnapshot: () => state,
    getContext: (_options, snapshot) => ({
      fileCount: snapshot.files.length,
      readyFiles: snapshot.files.filter((file) => file.status === "ready").length,
      trashedFiles: snapshot.files.filter((file) => file.trashedAt).length,
      folderCount: snapshot.folders.length,
      collectionCount: snapshot.collections.length,
      totalBytes: snapshot.files
        .filter((file) => file.status === "ready" && !file.trashedAt)
        .reduce((total, file) => total + file.size, 0),
    }),
    async commitSnapshot(nextState) {
      state = validateFileDropState(nextState);
      await metadataRepository.put("state", state);
      render();
    },
    commands: [
      {
        type: "vault.summary",
        description: "Read vault counts and total stored byte metadata without filenames or file content.",
        permissions: ["read-summary"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "vault.summary" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return {
            value: {
              files: snapshot.files.length,
              ready: snapshot.files.filter((file) => file.status === "ready").length,
              trashed: snapshot.files.filter((file) => file.trashedAt).length,
              folders: snapshot.folders.length,
              bytes: snapshot.files.reduce((total, file) => total + file.size, 0),
            },
          };
        },
      },
      {
        type: "files.list",
        description: "List file metadata only; stored bytes are never returned.",
        permissions: ["read-content"],
        schema: {
          type: "object",
          properties: { includeTrash: { type: "boolean" } },
          additionalProperties: false,
        },
        example: { type: "files.list", includeTrash: false },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["includeTrash"], commandIndex);
          return {
            value: snapshot.files
              .filter((file) => command.includeTrash || !file.trashedAt)
              .map(({ id, name, type, size, addedAt, modifiedAt, tags, description, folderId, collectionIds, favorite, trashedAt, status, fingerprintAlgorithm }) => ({
                id, name, type, size, addedAt, modifiedAt, tags, description,
                folderId, collectionIds, favorite, trashedAt, status, fingerprintAlgorithm,
              })),
          };
        },
      },
      {
        type: "folders.create",
        description: "Create a metadata folder in the local vault.",
        permissions: ["create"],
        mutates: true,
        schema: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", maxLength: 220 }, parentId: { type: "string" } },
          additionalProperties: false,
        },
        example: { type: "folders.create", name: "House documents", parentId: "folder-root" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["name", "parentId"], commandIndex);
          const name = safeStoredFilename(requireCommandString(command.name, "name", commandIndex, { maximumLength: 220 }));
          if (!name) throw new Error("Folder name is unsafe.");
          const parentId = command.parentId ?? "folder-root";
          if (!snapshot.folders.some((folder) => folder.id === parentId)) throw new Error("Parent folder not found.");
          const folder = { id: createId("folder"), name, parentId, system: false };
          return {
            state: { ...snapshot, folders: [...snapshot.folders, folder] },
            createdIds: [folder.id],
            value: folder,
          };
        },
      },
      {
        type: "files.update-metadata",
        description: "Rename or organize one stored file without touching its bytes.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["fileId", "changes"],
          properties: { fileId: { type: "string" }, changes: { type: "object" } },
          additionalProperties: false,
        },
        example: { type: "files.update-metadata", fileId: "file-id", changes: { tags: ["warranty"], favorite: true } },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["fileId", "changes"], commandIndex);
          const fileId = requireCommandString(command.fileId, "fileId", commandIndex, { maximumLength: 160 });
          const changes = requireCommandRecord(command.changes, "changes", commandIndex);
          const allowed = new Set(["name", "tags", "description", "folderId", "collectionIds", "favorite"]);
          const unknown = Object.keys(changes).find((key) => !allowed.has(key));
          if (unknown) throw new Error(`Unsupported file metadata field: ${unknown}.`);
          const file = snapshot.files.find((candidate) => candidate.id === fileId);
          if (!file) throw new Error("File metadata not found.");
          if (changes.tags !== undefined && !Array.isArray(changes.tags)) {
            throw new Error("tags must be an array.");
          }
          if (changes.collectionIds !== undefined && !Array.isArray(changes.collectionIds)) {
            throw new Error("collectionIds must be an array.");
          }
          if (changes.favorite !== undefined && typeof changes.favorite !== "boolean") {
            throw new Error("favorite must be true or false.");
          }
          if (changes.description !== undefined && typeof changes.description !== "string") {
            throw new Error("description must be text.");
          }
          if (changes.folderId !== undefined && typeof changes.folderId !== "string") {
            throw new Error("folderId must be text.");
          }
          if (changes.folderId && !snapshot.folders.some((folder) => folder.id === changes.folderId)) {
            throw new Error("Destination folder not found.");
          }
          const nextName = changes.name === undefined
            ? file.name
            : renamePreservingExtension(
              file.name,
              requireCommandString(changes.name, "changes.name", commandIndex, { maximumLength: 220 }),
            );
          const updated = {
            ...file,
            name: nextName,
            ...(changes.tags !== undefined ? { tags: parseTags(changes.tags.join(",")) } : {}),
            ...(changes.description !== undefined ? { description: changes.description.slice(0, 8000) } : {}),
            ...(changes.folderId !== undefined ? { folderId: changes.folderId } : {}),
            ...(Array.isArray(changes.collectionIds) ? { collectionIds: changes.collectionIds.filter((id) => snapshot.collections.some((collection) => collection.id === id)) } : {}),
            ...(changes.favorite !== undefined ? { favorite: changes.favorite } : {}),
          };
          return {
            state: { ...snapshot, files: snapshot.files.map((candidate) => candidate.id === fileId ? updated : candidate) },
            updatedIds: [fileId],
            value: updated,
          };
        },
      },
      {
        type: "files.trash",
        description: "Move one file entry to recoverable trash without deleting its bytes.",
        permissions: ["delete"],
        mutates: true,
        schema: {
          type: "object",
          required: ["fileId"],
          properties: { fileId: { type: "string" } },
          additionalProperties: false,
        },
        example: { type: "files.trash", fileId: "file-id" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["fileId"], commandIndex);
          const fileId = requireCommandString(command.fileId, "fileId", commandIndex, { maximumLength: 160 });
          if (!snapshot.files.some((file) => file.id === fileId)) throw new Error("File metadata not found.");
          return {
            state: {
              ...snapshot,
              files: snapshot.files.map((file) => file.id === fileId ? trashFile(file) : file),
            },
            updatedIds: [fileId],
          };
        },
      },
    ],
  });
}

function bindEvents() {
  ["file-add", "file-drop-choose"].forEach((id) => byId(id).addEventListener("click", () => byId("file-input").click()));
  byId("file-input").addEventListener("change", (event) => {
    importFiles([...event.target.files]);
    event.target.value = "";
  });
  const zone = byId("file-drop-zone");
  ["dragenter", "dragover"].forEach((type) => zone.addEventListener(type, (event) => {
    event.preventDefault();
    zone.classList.add("is-dragover");
  }));
  ["dragleave", "drop"].forEach((type) => zone.addEventListener(type, (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragover");
  }));
  zone.addEventListener("drop", (event) => importFiles([...event.dataTransfer.files]));
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") byId("file-input").click();
  });

  ["file-search", "file-sort", "file-folder-filter", "file-collection-filter"].forEach((id) => {
    byId(id).addEventListener(id === "file-search" ? "input" : "change", renderFiles);
  });
  byId("file-download-selected").addEventListener("click", downloadSelected);
  byId("file-trash-selected").addEventListener("click", trashSelected);
  byId("folder-add").addEventListener("click", addFolder);
  byId("collection-add").addEventListener("click", addCollection);
  byId("empty-trash").addEventListener("click", emptyTrash);
  byId("request-persistence").addEventListener("click", async () => {
    const result = await requestPersistentStorage();
    toast(!result.supported ? "Persistent storage is not supported here." : result.persisted ? "Persistent storage granted." : "The browser did not grant persistent storage.");
  });
  byId("file-manifest").addEventListener("click", () => downloadJson(buildManifest(state), "file-drop-manifest.json"));
  byId("file-backup").addEventListener("click", exportFullBackup);
  byId("file-import-backup").addEventListener("click", () => byId("file-backup-input").click());
  byId("file-backup-input").addEventListener("change", importFullBackup);
  byId("file-preview-close").addEventListener("click", closePreview);
  byId("file-preview-dialog").addEventListener("close", revokePreviewUrls);
}

async function importFiles(files) {
  for (const file of files) {
    if (!(file instanceof File)) continue;
    const safeName = safeStoredFilename(file.name);
    if (!safeName) {
      toast(`Skipped unsafe filename: ${file.name}`, "error");
      continue;
    }
    const id = createId("file");
    const metadata = {
      id,
      name: safeName,
      type: file.type || "application/octet-stream",
      size: file.size,
      addedAt: new Date().toISOString(),
      modifiedAt: new Date(file.lastModified || Date.now()).toISOString(),
      lastOpenedAt: null,
      tags: [],
      description: "",
      folderId: selectedFolderId || "folder-root",
      collectionIds: selectedCollectionId ? [selectedCollectionId] : [],
      favorite: false,
      trashedAt: null,
      status: "importing",
      fingerprint: "",
      fingerprintAlgorithm: "",
    };
    state.files.push(metadata);
    await save();
    render();
    addImportProgress(id, safeName);
    const controller = { cancelled: false, worker: null };
    activeImports.set(id, controller);
    try {
      const hash = await fingerprintFile(id, file, controller);
      if (controller.cancelled) throw new DOMException("Import cancelled.", "AbortError");
      metadata.fingerprint = hash.fingerprint;
      metadata.fingerprintAlgorithm = hash.algorithm;
      const duplicate = findDuplicate(state.files.filter((candidate) => candidate.id !== id), metadata);
      if (duplicate) {
        const keep = confirm(`“${safeName}” matches “${duplicate.name}” byte-for-byte by fingerprint. Keep another copy?`);
        if (!keep) {
          state.files = state.files.filter((candidate) => candidate.id !== id);
          await save();
          continue;
        }
      }
      await blobRepository.put(id, file);
      metadata.status = "ready";
      await save();
    } catch (error) {
      metadata.status = error.name === "AbortError" ? "cancelled" : "failed";
      metadata.error = error.message;
      await save();
      toast(`${safeName}: ${error.message}`, error.name === "AbortError" ? "info" : "error");
    } finally {
      activeImports.delete(id);
      byId(`import-${CSS.escape(id)}`)?.remove();
      render();
      updateStorage();
    }
  }
}

function fingerprintFile(id, file, controller) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./file-drop-hash-worker.js?v=1");
    controller.worker = worker;
    worker.addEventListener("message", (event) => {
      if (event.data.id !== id) return;
      if (event.data.type === "progress") {
        const progress = byId(`import-progress-${id}`);
        if (progress) progress.value = event.data.total ? event.data.loaded / event.data.total : 0;
      }
      if (event.data.type === "complete") {
        worker.terminate();
        resolve(event.data);
      }
      if (event.data.type === "error") {
        worker.terminate();
        const error = new Error(event.data.error);
        if (event.data.cancelled) error.name = "AbortError";
        reject(error);
      }
    });
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(event.message || "The fingerprint worker failed."));
    });
    worker.postMessage({ type: "hash", id, file });
  });
}

function addImportProgress(id, name) {
  const row = element("div", "suite-row");
  row.id = `import-${id}`;
  row.append(element("span", "suite-chip", "Import"));
  const main = element("div", "suite-row-main");
  main.append(element("strong", "", name));
  const progress = element("progress", "suite-progress");
  progress.id = `import-progress-${id}`;
  progress.max = 1;
  main.append(progress);
  const cancel = actionButton("Cancel", () => {
    const active = activeImports.get(id);
    if (!active) return;
    active.cancelled = true;
    active.worker?.postMessage({ type: "cancel", id });
  });
  row.append(main, cancel);
  byId("file-import-progress").append(row);
}

async function save() {
  await metadataRepository.put("state", state);
}

function render() {
  renderFolders();
  renderCollections();
  renderFiles();
  renderFavorites();
  renderRecent();
  renderTrash();
  updateStorage();
}

function renderFolders() {
  const list = byId("folder-list");
  const select = byId("file-folder-filter");
  list.replaceChildren();
  select.replaceChildren(Object.assign(element("option", "", "All folders"), { value: "" }));
  state.folders.forEach((folder) => {
    const row = element("li", "suite-row");
    const button = actionButton(folder.name, () => {
      selectedFolderId = folder.id === "folder-root" ? "" : folder.id;
      byId("file-folder-filter").value = selectedFolderId;
      renderFiles();
    });
    row.append(button);
    if (!folder.system) row.append(actionButton("×", () => deleteFolder(folder.id), `Delete ${folder.name}`));
    list.append(row);
    if (folder.id !== "folder-root") select.append(Object.assign(element("option", "", folder.name), { value: folder.id }));
  });
  select.value = selectedFolderId;
}

function renderCollections() {
  const list = byId("collection-list");
  const select = byId("file-collection-filter");
  list.replaceChildren();
  select.replaceChildren(Object.assign(element("option", "", "All collections"), { value: "" }));
  state.collections.forEach((collection) => {
    const row = element("li", "suite-row");
    row.append(actionButton(collection.name, () => {
      selectedCollectionId = collection.id;
      select.value = collection.id;
      renderFiles();
    }));
    row.append(actionButton("×", () => {
      state.collections = state.collections.filter((item) => item.id !== collection.id);
      state.files.forEach((file) => {
        file.collectionIds = (file.collectionIds ?? []).filter((id) => id !== collection.id);
      });
      selectedCollectionId = "";
      save().then(render);
    }, `Delete ${collection.name}`));
    list.append(row);
    select.append(Object.assign(element("option", "", collection.name), { value: collection.id }));
  });
  select.value = selectedCollectionId;
}

function renderFiles() {
  selectedFolderId = byId("file-folder-filter").value;
  selectedCollectionId = byId("file-collection-filter").value;
  const query = byId("file-search").value.toLowerCase().trim();
  const sort = byId("file-sort").value;
  const files = state.files
    .filter((file) => !file.trashedAt)
    .filter((file) => !selectedFolderId || file.folderId === selectedFolderId)
    .filter((file) => !selectedCollectionId || file.collectionIds?.includes(selectedCollectionId))
    .filter((file) => !query || `${file.name} ${file.tags.join(" ")} ${file.description}`.toLowerCase().includes(query))
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "size") return b.size - a.size;
      if (sort === "modified") return b.modifiedAt.localeCompare(a.modifiedAt);
      return b.addedAt.localeCompare(a.addedAt);
    });
  byId("file-count").textContent = `${files.length} stored file${files.length === 1 ? "" : "s"}`;
  renderFileRows(byId("file-list"), files, { selectable: true });
}

function renderFavorites() {
  renderFileRows(byId("favorite-list"), state.files.filter((file) => file.favorite && !file.trashedAt));
}

function renderRecent() {
  renderFileRows(
    byId("recent-list"),
    state.files.filter((file) => !file.trashedAt).sort((a, b) => String(b.lastOpenedAt || b.addedAt).localeCompare(String(a.lastOpenedAt || a.addedAt))).slice(0, 30),
  );
}

function renderTrash() {
  const list = byId("trash-list");
  const files = state.files.filter((file) => file.trashedAt);
  list.replaceChildren();
  files.forEach((file) => {
    const row = fileRow(file);
    const actions = row.lastElementChild;
    actions.replaceChildren(
      actionButton("Recover", () => {
        Object.assign(file, recoverFile(file));
        save().then(render);
      }),
      actionButton("Delete forever", () => permanentlyDelete(file.id), "Permanently delete"),
    );
    list.append(row);
  });
  if (!files.length) list.append(element("li", "suite-empty", "Trash is empty."));
}

function renderFileRows(list, files, options = {}) {
  list.replaceChildren();
  files.forEach((file) => {
    const row = fileRow(file, options);
    list.append(row);
  });
  if (!files.length) list.append(element("li", "suite-empty", "No files match this view."));
}

function fileRow(file, options = {}) {
  const row = element("li", "suite-row");
  if (options.selectable) {
    const checkbox = Object.assign(element("input"), { type: "checkbox" });
    checkbox.dataset.fileSelect = file.id;
    row.append(checkbox);
  } else {
    row.append(element("span", "suite-chip", file.favorite ? "★" : file.name.split(".").at(-1).toUpperCase().slice(0, 5)));
  }
  const main = element("div", "suite-row-main");
  main.append(element("strong", "", file.name));
  const folder = state.folders.find((candidate) => candidate.id === file.folderId)?.name ?? "Unknown folder";
  main.append(element("span", "", `${file.type} · ${formatBytes(file.size)} · ${folder} · ${file.status}${file.tags.length ? ` · ${file.tags.join(", ")}` : ""}`));
  const actions = element("div", "suite-actions");
  if (file.status === "ready") {
    actions.append(actionButton("Preview", () => previewFile(file)));
    actions.append(actionButton("Download", () => downloadFile(file)));
  }
  actions.append(actionButton(file.favorite ? "Unfavorite" : "Favorite", () => {
    file.favorite = !file.favorite;
    save().then(render);
  }));
  actions.append(actionButton("Edit", () => editFile(file)));
  actions.append(actionButton("Trash", () => {
    Object.assign(file, trashFile(file));
    save().then(render);
  }));
  row.append(main, actions);
  return row;
}

async function previewFile(file) {
  const blob = await blobRepository.get(file.id);
  if (!(blob instanceof Blob)) return toast("The stored bytes are missing or damaged.", "error");
  const kind = getPreviewKind(file);
  const content = byId("file-preview-content");
  content.replaceChildren();
  byId("file-preview-title").textContent = file.name;
  byId("file-preview-meta").textContent = `${file.type} · ${formatBytes(file.size)}`;
  if (kind === "blocked") content.append(element("div", "suite-warning", "Preview blocked because this format may contain active scripts. You can still download the stored file."));
  else if (kind === "unsupported") content.append(element("div", "suite-empty", "This file type has no safe in-browser preview."));
  else if (["image", "audio", "video", "pdf"].includes(kind)) {
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    const node = element(kind === "pdf" ? "iframe" : kind);
    node.src = url;
    node.controls = ["audio", "video"].includes(kind);
    node.alt = file.name;
    node.style.cssText = "display:block;width:100%;max-height:70vh;border:0;object-fit:contain;";
    if (kind === "pdf") node.style.height = "70vh";
    content.append(node);
  } else {
    const maximum = 2 * 1024 * 1024;
    if (blob.size > maximum) content.append(element("div", "suite-warning", `Previewing the first ${formatBytes(maximum)} of this text file.`));
    let text = await blob.slice(0, maximum).text();
    if (kind === "json") {
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { text = "Invalid JSON\n\n" + text; }
    }
    const pre = element("pre", "suite-card");
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = text;
    content.append(pre);
  }
  file.lastOpenedAt = new Date().toISOString();
  await save();
  byId("file-preview-dialog").showModal();
}

function closePreview() {
  byId("file-preview-dialog").close();
}

function revokePreviewUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  byId("file-preview-content").replaceChildren();
}

async function downloadFile(file) {
  const blob = await blobRepository.get(file.id);
  if (!(blob instanceof Blob)) return toast("The stored bytes are missing.", "error");
  downloadBlob(blob, file.name);
}

async function downloadSelected() {
  const selected = selectedFileIds();
  if (!selected.length) return toast("Select at least one file.");
  for (const id of selected) {
    const file = state.files.find((candidate) => candidate.id === id);
    if (file) await downloadFile(file);
  }
  toast(`${selected.length} browser download${selected.length === 1 ? "" : "s"} started.`);
}

function trashSelected() {
  const selected = selectedFileIds();
  if (!selected.length) return;
  state.files.forEach((file) => {
    if (selected.includes(file.id)) Object.assign(file, trashFile(file));
  });
  save().then(render);
}

function selectedFileIds() {
  return [...document.querySelectorAll("[data-file-select]:checked")].map((node) => node.dataset.fileSelect);
}

function editFile(file) {
  const name = prompt("Stored filename", file.name);
  if (name === null) return;
  const description = prompt("Description", file.description) ?? file.description;
  const tags = prompt("Comma-separated tags", file.tags.join(", ")) ?? file.tags.join(", ");
  try {
    file.name = renamePreservingExtension(file.name, name);
    file.description = description.trim();
    file.tags = parseTags(tags);
    const folder = prompt(`Folder id:\n${state.folders.map((item) => `${item.id}: ${item.name}`).join("\n")}`, file.folderId);
    if (state.folders.some((item) => item.id === folder)) file.folderId = folder;
    const collection = prompt(`Collection id to add (blank leaves unchanged):\n${state.collections.map((item) => `${item.id}: ${item.name}`).join("\n")}`, "");
    if (state.collections.some((item) => item.id === collection) && !file.collectionIds.includes(collection)) file.collectionIds.push(collection);
    save().then(render);
  } catch (error) {
    toast(error.message, "error");
  }
}

function addFolder() {
  const name = prompt("Folder name");
  if (!name) return;
  if (!safeStoredFilename(name)) return toast("Use a safe folder name without path characters.", "error");
  state.folders.push({ id: createId("folder"), name: name.trim(), parentId: "folder-root" });
  save().then(render);
}

function deleteFolder(id) {
  if (!confirm("Delete this folder? Its files will move to All files.")) return;
  try {
    state = removeFolder(state, id);
    selectedFolderId = "";
    save().then(render);
  } catch (error) {
    toast(error.message, "error");
  }
}

function addCollection() {
  const name = prompt("Collection name");
  if (!name?.trim()) return;
  state.collections.push({ id: createId("collection"), name: name.trim(), description: "" });
  save().then(render);
}

async function permanentlyDelete(id) {
  if (!confirm("Permanently delete this stored file? This cannot be undone.")) return;
  await blobRepository.delete(id);
  state.files = state.files.filter((file) => file.id !== id);
  await save();
  render();
}

async function emptyTrash() {
  const trashed = state.files.filter((file) => file.trashedAt);
  if (!trashed.length || !confirm(`Permanently delete ${trashed.length} trashed file(s)?`)) return;
  for (const file of trashed) await blobRepository.delete(file.id);
  state.files = state.files.filter((file) => !file.trashedAt);
  await save();
  render();
}

async function updateStorage() {
  const estimate = await estimateStorage();
  if (!estimate.supported) {
    byId("storage-usage").textContent = "Storage estimates are unavailable in this browser.";
    return;
  }
  const ratio = estimate.quota ? estimate.usage / estimate.quota : 0;
  byId("storage-usage").textContent = `${formatBytes(estimate.usage)} used of approximately ${formatBytes(estimate.quota)}${ratio > 0.85 ? " · Low space" : ""}`;
  byId("storage-progress").value = ratio;
}

async function exportFullBackup() {
  const files = state.files.filter((file) => file.status === "ready");
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (!confirm(`Create a ${formatBytes(total)} full backup containing ${files.length} file(s)? Large backups may take time and need similar free memory for the final download.`)) return;
  const readyIds = new Set(files.map((file) => file.id));
  const manifest = buildManifest(state);
  manifest.files = manifest.files.filter((file) => readyIds.has(file.id));
  const header = new TextEncoder().encode(JSON.stringify(manifest));
  const headerLength = new Uint8Array(8);
  new DataView(headerLength.buffer).setBigUint64(0, BigInt(header.byteLength), true);
  const parts = [headerLength, header];
  for (const file of files) {
    const blob = await blobRepository.get(file.id);
    if (!(blob instanceof Blob)) throw new Error(`Missing file bytes: ${file.name}`);
    parts.push(blob);
  }
  downloadBlob(new Blob(parts, { type: "application/x-vital-pancakes-file-drop" }), `file-drop-${new Date().toISOString().slice(0, 10)}.vpfiles`);
}

async function importFullBackup(event) {
  const [backup] = event.target.files;
  event.target.value = "";
  if (!backup) return;
  try {
    if (backup.size < 8) throw new TypeError("The backup is truncated.");
    const headerBytes = await backup.slice(0, 8).arrayBuffer();
    const headerLength = Number(new DataView(headerBytes).getBigUint64(0, true));
    if (!Number.isSafeInteger(headerLength) || headerLength <= 0 || headerLength > 50 * 1024 * 1024) {
      throw new TypeError("The backup header is invalid.");
    }
    const manifest = validateFileDropState(JSON.parse(await backup.slice(8, 8 + headerLength).text()));
    let offset = 8 + headerLength;
    for (const file of manifest.files) {
      const end = offset + file.size;
      if (end > backup.size) throw new TypeError(`The backup is truncated at ${file.name}.`);
      await blobRepository.put(file.id, backup.slice(offset, end, file.type));
      offset = end;
    }
    state = manifest;
    await save();
    render();
    toast(`Restored ${manifest.files.length} file entries.`);
  } catch (error) {
    toast(`Backup import failed: ${error.message}`, "error");
  }
}

function actionButton(label, callback, ariaLabel = label) {
  const button = element("button", "button button-quiet", label);
  button.type = "button";
  button.setAttribute("aria-label", ariaLabel);
  button.addEventListener("click", callback);
  return button;
}

start();
