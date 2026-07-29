/**
 * Folder-structure workspace with inline names, notes, and drag-to-nest.
 *
 * The permanent root node and every descendant are stored locally under the
 * established architecture key. Destructive actions use confirmation prompts
 * without requiring credentials.
 */

import { createId } from "../app/store.js";
import {
  DEFAULT_FILE_NAME,
  DEFAULT_FOLDER_NAME,
  ROOT_NODE_ID,
  addArchitectureNode,
  collectDescendantIds,
  createEmptyArchitecture,
  getArchitectureChildren,
  moveNodeToFolder,
  normalizeArchitecture,
  normalizeNodeName,
  removeArchitectureNode,
} from "./architecture-model.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
  requireCommandString,
} from "./current-tool-ai-adapter.mjs";

const ARCHITECTURE_KEY = "artificially-neuroscience-architecture-v1";
const SAVE_DELAY = 220;

const tree = document.querySelector("#architecture-tree");
const sheet = document.querySelector("#architecture-sheet");
const status = document.querySelector("#architecture-status");

let architecture = loadArchitecture();
let selectedId = ROOT_NODE_ID;
let saveTimer = null;
let draggedId = null;

/**
 * Loads and migrates saved data while guaranteeing a permanent root folder.
 *
 * @returns {{version: number, rootId: string, nodes: Array<object>}} Model.
 */
function loadArchitecture() {
  try {
    const saved = JSON.parse(localStorage.getItem(ARCHITECTURE_KEY));
    return normalizeArchitecture(saved);
  } catch (error) {
    console.error("Unable to load architecture data.", error);
    return createEmptyArchitecture();
  }
}

/**
 * Persists the complete model and updates the visible local-save status.
 */
function saveArchitecture() {
  window.clearTimeout(saveTimer);
  try {
    localStorage.setItem(ARCHITECTURE_KEY, JSON.stringify(architecture));
    status.textContent = "Saved locally";
    status.classList.remove("has-error");
  } catch (error) {
    console.error("Unable to save architecture data.", error);
    status.textContent = "Storage is full";
    status.classList.add("has-error");
  }
}

function queueSave() {
  status.textContent = "Saving…";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveArchitecture, SAVE_DELAY);
}

/**
 * Rebuilds the visible tree from the flat parent-linked model.
 */
function renderArchitecture() {
  const root = architecture.nodes.find((node) => node.id === ROOT_NODE_ID);
  tree.replaceChildren();
  if (!root) {
    architecture = createEmptyArchitecture();
    selectedId = ROOT_NODE_ID;
    return renderArchitecture();
  }
  tree.append(createTreeBranch(root, 0));
}

/**
 * Creates one row and its recursively nested children.
 *
 * @param {object} node Architecture node.
 * @param {number} depth Zero-based tree depth.
 * @returns {HTMLElement} Branch element.
 */
function createTreeBranch(node, depth) {
  const branch = document.createElement("div");
  branch.className = "architecture-branch";
  branch.dataset.nodeId = node.id;

  const children = getArchitectureChildren(architecture.nodes, node.id);
  const row = document.createElement("div");
  row.className = "architecture-node-row";
  row.dataset.nodeId = node.id;
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(depth + 1));
  row.classList.toggle("is-selected", selectedId === node.id);
  if (node.type === "folder") row.setAttribute("aria-expanded", String(!node.collapsed));

  const identity = createIdentityCell(node, depth, children.length);
  const notes = createNotesField(node);
  const actions = createRowActions(node);
  row.append(identity, notes, actions);
  row.addEventListener("click", () => selectNode(node.id));

  if (node.type === "folder") addFolderDropTarget(row, node);
  branch.append(row);

  if (node.type === "folder" && children.length && !node.collapsed) {
    const childGroup = document.createElement("div");
    childGroup.className = "architecture-children";
    childGroup.setAttribute("role", "group");
    children.forEach((child) => childGroup.append(createTreeBranch(child, depth + 1)));
    branch.append(childGroup);
  }
  return branch;
}

function createIdentityCell(node, depth, childCount) {
  const identity = document.createElement("div");
  identity.className = "architecture-node-identity";
  identity.style.setProperty("--tree-depth", depth);

  if (node.id === ROOT_NODE_ID) {
    const rootMarker = document.createElement("span");
    rootMarker.className = "architecture-root-marker";
    rootMarker.textContent = "○";
    rootMarker.title = "Permanent root folder";
    identity.append(rootMarker);
  } else {
    const dragHandle = document.createElement("span");
    dragHandle.className = "architecture-drag-handle";
    dragHandle.textContent = "⠿";
    dragHandle.title = "Drag into another folder";
    dragHandle.draggable = true;
    dragHandle.addEventListener("dragstart", (event) => startDragging(event, node));
    dragHandle.addEventListener("dragend", finishDragging);
    identity.append(dragHandle);
  }

  if (node.type === "folder") {
    const toggle = document.createElement("button");
    toggle.className = "architecture-folder-toggle";
    toggle.type = "button";
    toggle.textContent = childCount ? (node.collapsed ? "▸" : "▾") : "○";
    toggle.title = childCount ? (node.collapsed ? "Expand folder" : "Collapse folder") : "Empty folder";
    toggle.disabled = childCount === 0;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!childCount) return;
      node.collapsed = !node.collapsed;
      saveArchitecture();
      renderArchitecture();
    });
    identity.append(toggle);
  } else {
    const fileMarker = document.createElement("span");
    fileMarker.className = "architecture-file-marker";
    fileMarker.textContent = "—";
    identity.append(fileMarker);
  }

  const nameInput = document.createElement("input");
  nameInput.className = "architecture-name-input";
  nameInput.value = node.name;
  nameInput.maxLength = 120;
  nameInput.spellcheck = false;
  nameInput.setAttribute("aria-label", `Rename ${node.type}`);
  resizeNameField(nameInput);
  nameInput.addEventListener("click", (event) => event.stopPropagation());
  nameInput.addEventListener("input", () => {
    node.name = nameInput.value;
    resizeNameField(nameInput);
    queueSave();
  });
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      nameInput.blur();
    }
  });
  nameInput.addEventListener("blur", () => {
    node.name = normalizeNodeName(nameInput.value, node.type);
    nameInput.value = node.name;
    resizeNameField(nameInput);
    saveArchitecture();
  });
  identity.append(nameInput);

  if (node.type === "folder") {
    const slash = document.createElement("span");
    slash.className = "architecture-folder-slash";
    slash.textContent = "/";
    identity.append(slash);
  }
  return identity;
}

function createNotesField(node) {
  const notes = document.createElement("textarea");
  notes.className = "architecture-note-input";
  notes.rows = 1;
  notes.value = node.notes;
  notes.placeholder = "Add a note…";
  notes.setAttribute("aria-label", `Notes for ${node.name}`);
  notes.addEventListener("click", (event) => event.stopPropagation());
  notes.addEventListener("input", () => {
    node.notes = notes.value;
    resizeNotesField(notes);
    queueSave();
  });
  notes.addEventListener("blur", saveArchitecture);
  window.requestAnimationFrame(() => resizeNotesField(notes));
  return notes;
}

function createRowActions(node) {
  const actions = document.createElement("div");
  actions.className = "architecture-row-actions";
  if (node.id === ROOT_NODE_ID) return actions;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "architecture-delete-node";
  deleteButton.title = `Delete ${node.name}`;
  deleteButton.setAttribute("aria-label", `Delete ${node.name}`);
  deleteButton.textContent = "×";
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteNode(node);
  });
  actions.append(deleteButton);
  return actions;
}

function resizeNotesField(field) {
  field.style.height = "0";
  field.style.height = `${Math.max(28, field.scrollHeight)}px`;
}

function resizeNameField(field) {
  const characterWidth = Math.min(45, Math.max(5, field.value.length + 1));
  field.style.width = `${characterWidth}ch`;
}

function selectNode(nodeId) {
  if (selectedId === nodeId) return;
  selectedId = nodeId;
  tree.querySelectorAll(".architecture-node-row").forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.nodeId === selectedId);
  });
}

function startDragging(event, node) {
  draggedId = node.id;
  selectedId = node.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", node.id);
  window.requestAnimationFrame(() => {
    const branch = [...tree.querySelectorAll(".architecture-branch")]
      .find((candidate) => candidate.dataset.nodeId === node.id);
    branch?.querySelector(".architecture-node-row")?.classList.add("is-dragging");
  });
}

function finishDragging() {
  draggedId = null;
  tree.querySelectorAll(".is-dragging, .is-drop-target").forEach((element) => {
    element.classList.remove("is-dragging", "is-drop-target");
  });
}

function addFolderDropTarget(row, folder) {
  row.addEventListener("dragover", (event) => {
    if (!draggedId || !moveIsAllowed(draggedId, folder.id)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    row.classList.add("is-drop-target");
  });
  row.addEventListener("dragleave", (event) => {
    if (!row.contains(event.relatedTarget)) row.classList.remove("is-drop-target");
  });
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    row.classList.remove("is-drop-target");
    const nodeId = draggedId || event.dataTransfer.getData("text/plain");
    if (!moveNodeToFolder(architecture, nodeId, folder.id)) return;
    folder.collapsed = false;
    selectedId = nodeId;
    saveArchitecture();
    finishDragging();
    renderArchitecture();
  });
}

function moveIsAllowed(nodeId, folderId) {
  if (nodeId === ROOT_NODE_ID || nodeId === folderId) return false;
  const descendants = collectDescendantIds(architecture.nodes, nodeId);
  return !descendants.has(folderId);
}

function getSelectedParentId() {
  const selected = architecture.nodes.find((node) => node.id === selectedId);
  if (!selected) return ROOT_NODE_ID;
  return selected.type === "folder" ? selected.id : selected.parentId || ROOT_NODE_ID;
}

function createNode(type) {
  const parentId = getSelectedParentId();
  const node = addArchitectureNode(architecture, {
    id: createId(),
    type,
    parentId,
  });
  const parent = architecture.nodes.find((candidate) => candidate.id === parentId);
  if (parent) parent.collapsed = false;
  selectedId = node.id;
  saveArchitecture();
  renderArchitecture();
  window.requestAnimationFrame(() => {
    const branch = [...tree.querySelectorAll(".architecture-branch")]
      .find((candidate) => candidate.dataset.nodeId === node.id);
    const input = branch?.querySelector(".architecture-name-input");
    input?.focus();
    input?.select();
  });
}

function deleteNode(node) {
  const descendants = collectDescendantIds(architecture.nodes, node.id);
  if (descendants.size) {
    const confirmed = window.confirm(
      `Delete “${node.name}” and ${descendants.size} item${descendants.size === 1 ? "" : "s"} inside it?`,
    );
    if (!confirmed) return;
  }
  const parentId = node.parentId || ROOT_NODE_ID;
  removeArchitectureNode(architecture, node.id);
  selectedId = parentId;
  saveArchitecture();
  renderArchitecture();
}

function clearWorkspace() {
  const confirmed = window.confirm(
    "Clear the entire architecture workspace? This cannot be undone.",
  );
  if (!confirmed) return;

  architecture = createEmptyArchitecture();
  selectedId = ROOT_NODE_ID;
  saveArchitecture();
  renderArchitecture();
}

function exportArchitecture() {
  const blob = new Blob([JSON.stringify(architecture, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `software-architecture-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelector("#add-architecture-folder").addEventListener("click", () => createNode("folder"));
document.querySelector("#add-architecture-file").addEventListener("click", () => createNode("file"));
document.querySelector("#clear-architecture").addEventListener("click", clearWorkspace);
document.querySelector("#export-architecture").addEventListener("click", exportArchitecture);

sheet.addEventListener("dragover", (event) => {
  if (!draggedId || !moveIsAllowed(draggedId, ROOT_NODE_ID)) return;
  if (event.target.closest(".architecture-node-row")) return;
  event.preventDefault();
});
sheet.addEventListener("drop", (event) => {
  if (event.target.closest(".architecture-node-row")) return;
  event.preventDefault();
  if (!draggedId || !moveNodeToFolder(architecture, draggedId, ROOT_NODE_ID)) return;
  saveArchitecture();
  finishDragging();
  renderArchitecture();
});

saveArchitecture();
renderArchitecture();

installCurrentToolAiHost({
  id: "software-architect",
  title: "Software Architect",
  description: "Reads and safely stages the local folder-and-file architecture model.",
  limitations: [
    "Node deletion, complete clearing, and file export remain explicit user actions.",
    "Commands model structure only and do not create files on the computer.",
  ],
  getSnapshot: () => ({
    architecture,
    selectedId,
  }),
  getContext: (_options, snapshot) => ({
    rootId: snapshot.architecture.rootId,
    selectedId: snapshot.selectedId,
    nodeCount: snapshot.architecture.nodes.length,
    folderCount: snapshot.architecture.nodes.filter((node) => node.type === "folder").length,
    fileCount: snapshot.architecture.nodes.filter((node) => node.type === "file").length,
  }),
  commitSnapshot(nextState) {
    if (draggedId) throw new Error("Finish the current drag before applying AI changes.");
    const nextArchitecture = normalizeArchitecture(nextState.architecture);
    localStorage.setItem(ARCHITECTURE_KEY, JSON.stringify(nextArchitecture));
    window.clearTimeout(saveTimer);
    architecture = nextArchitecture;
    selectedId = architecture.nodes.some((node) => node.id === nextState.selectedId)
      ? nextState.selectedId
      : ROOT_NODE_ID;
    status.textContent = "AI changes saved locally";
    status.classList.remove("has-error");
    renderArchitecture();
  },
  commands: [
    {
      type: "tree.describe",
      description: "Read the flat parent-linked architecture tree.",
      permissions: ["read-content"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return { value: state.architecture };
      },
    },
    {
      type: "nodes.get",
      description: "Read one architecture node and its direct children.",
      permissions: ["read-content"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["nodeId"], commandIndex);
        const nodeId = requireCommandString(
          command.nodeId,
          "nodeId",
          commandIndex,
          { maximumLength: 128 },
        );
        const node = state.architecture.nodes.find((candidate) => candidate.id === nodeId);
        return {
          value: node
            ? {
              node,
              children: getArchitectureChildren(state.architecture.nodes, node.id),
            }
            : null,
        };
      },
    },
    {
      type: "nodes.create",
      description: "Create one folder or file under an existing folder.",
      permissions: ["create"],
      mutates: true,
      schema: {
        type: "object",
        required: ["node"],
        properties: { node: { type: "object" } },
        additionalProperties: false,
      },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["node"], commandIndex);
        const input = requireCommandRecord(command.node, "node", commandIndex);
        const unknown = Object.keys(input).find(
          (field) => !["id", "type", "parentId", "name", "notes"].includes(field),
        );
        if (unknown) throw new Error(`Unsupported node field: ${unknown}.`);
        if (input.type !== undefined && !["file", "folder"].includes(input.type)) {
          throw new Error("node.type must be file or folder.");
        }
        const type = input.type === "file" ? "file" : "folder";
        const id = input.id !== undefined
          ? requireCommandString(input.id, "node.id", commandIndex, { maximumLength: 128 })
          : createId();
        if (!/^[a-zA-Z0-9._:/-]+$/.test(id)) {
          throw new Error("node.id contains unsupported characters.");
        }
        if (state.architecture.nodes.some((node) => node.id === id)) {
          throw new Error("That node ID already exists.");
        }
        const node = addArchitectureNode(state.architecture, {
          id,
          type,
          parentId: input.parentId,
        });
        node.name = normalizeNodeName(input.name, type);
        node.notes = String(input.notes ?? "").slice(0, 20_000);
        return {
          state: { ...state, selectedId: id },
          createdIds: [id],
          value: node,
        };
      },
    },
    {
      type: "nodes.update",
      description: "Update the name, notes, or collapsed state of one node.",
      permissions: ["update"],
      mutates: true,
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["nodeId", "patch"], commandIndex);
        const nodeId = requireCommandString(
          command.nodeId,
          "nodeId",
          commandIndex,
          { maximumLength: 128 },
        );
        const patch = requireCommandRecord(command.patch, "patch", commandIndex);
        const unknown = Object.keys(patch).find(
          (field) => !["name", "notes", "collapsed"].includes(field),
        );
        if (unknown) throw new Error(`Unsupported node patch field: ${unknown}.`);
        const node = state.architecture.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error("The node does not exist.");
        if (patch.name !== undefined) node.name = normalizeNodeName(patch.name, node.type);
        if (patch.notes !== undefined) node.notes = String(patch.notes).slice(0, 20_000);
        if (patch.collapsed !== undefined && node.type === "folder") {
          node.collapsed = Boolean(patch.collapsed);
        }
        return {
          state: { ...state, selectedId: nodeId },
          updatedIds: [nodeId],
          value: node,
        };
      },
    },
    {
      type: "nodes.move",
      description: "Move one node into another folder while preventing cycles.",
      permissions: ["update"],
      mutates: true,
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["nodeId", "folderId"], commandIndex);
        const nodeId = requireCommandString(
          command.nodeId,
          "nodeId",
          commandIndex,
          { maximumLength: 128 },
        );
        const folderId = requireCommandString(
          command.folderId,
          "folderId",
          commandIndex,
          { maximumLength: 128 },
        );
        if (!moveNodeToFolder(state.architecture, nodeId, folderId)) {
          throw new Error("The node cannot be moved to that folder.");
        }
        return {
          state: { ...state, selectedId: nodeId },
          updatedIds: [nodeId],
          value: { nodeId, folderId },
        };
      },
    },
  ],
});
