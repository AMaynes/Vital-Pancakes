/**
 * Overview & Purpose
 * Implements recursive system-scope navigation and an annotated file/folder
 * skeleton whose nodes link to real records in the Algorithms section.
 *
 * Architectural Relationships
 * Called by: architecture.html.
 * Calls: app/store.js for identifiers, password checks, and algorithm choices.
 *
 * External Resources
 * localStorage key "artificially-neuroscience-architecture-v1".
 *
 * Notes
 * Architecture data is a flat collection with parent identifiers. Rendering
 * derives both trees and zoomed views, which keeps mutation and persistence simple.
 */

import {
  createId,
  getAlgorithmOptions,
  getWorkspace,
  isDeletePasswordValid,
} from "../app/store.js";

const ARCHITECTURE_KEY = "artificially-neuroscience-architecture-v1";
const treePanel = document.querySelector("#architecture-tree");
const canvas = document.querySelector("#architecture-canvas");
const scopeMap = document.querySelector("#scope-map");
const breadcrumbs = document.querySelector("#scope-breadcrumbs");
const inspector = document.querySelector("#architecture-inspector");
const inspectorForm = document.querySelector("#inspector-form");
const inspectorEmpty = document.querySelector("#inspector-empty");
const nodeDialog = document.querySelector("#architecture-node-dialog");
const nodeForm = document.querySelector("#architecture-node-form");

let architecture = loadArchitecture();
let mode = "scopes";
let selectedId = null;
let focusedScopeId = null;
let pendingParentId = null;
let zoom = 1;

/**
 * Loads saved architecture or returns an intentionally empty model.
 *
 * @returns {{scopes: Array<object>, files: Array<object>}} Architecture model.
 */
function loadArchitecture() {
  try {
    const saved = JSON.parse(localStorage.getItem(ARCHITECTURE_KEY));
    if (Array.isArray(saved?.scopes) && Array.isArray(saved?.files)) return saved;
  } catch (error) {
    console.error("Unable to load architecture data.", error);
  }
  return { scopes: [], files: [] };
}

/**
 * Persists the complete architecture model locally.
 */
function saveArchitecture() {
  localStorage.setItem(ARCHITECTURE_KEY, JSON.stringify(architecture));
}

/**
 * Renders the active tree, canvas, and inspector from current state.
 */
function renderArchitecture() {
  renderBrowserTree();
  if (mode === "scopes") {
    renderScopeCanvas();
  } else {
    renderFileCanvas();
  }
  renderInspector();
}

/**
 * Builds the left navigation tree for scopes or file skeleton nodes.
 */
function renderBrowserTree() {
  treePanel.replaceChildren();
  const collection = mode === "scopes" ? architecture.scopes : architecture.files;
  const roots = collection.filter((node) => !node.parentId);
  if (!roots.length) {
    const empty = document.createElement("p");
    empty.className = "tree-empty";
    empty.textContent = mode === "scopes"
      ? "No system scopes yet. Add a root, then place smaller scopes inside it."
      : "No skeleton yet. Add a root folder or file, then build downward.";
    treePanel.append(empty);
    return;
  }

  const tree = document.createElement("ul");
  tree.className = "tree-list";
  roots.forEach((root) => tree.append(createTreeBranch(root, collection)));
  treePanel.append(tree);
}

/**
 * Recursively creates a navigation branch.
 *
 * @param {object} node Current node.
 * @param {Array<object>} collection Sibling model collection.
 * @returns {HTMLLIElement} Tree branch.
 */
function createTreeBranch(node, collection) {
  const listItem = document.createElement("li");
  const row = document.createElement("div");
  row.className = "tree-row";
  row.classList.toggle("is-selected", selectedId === node.id);
  const icon = document.createElement("span");
  icon.textContent = mode === "scopes" ? "◉" : node.type === "folder" ? "▾" : "·";
  const name = document.createElement("span");
  name.textContent = node.name;
  row.append(icon, name);
  row.addEventListener("click", () => {
    selectedId = node.id;
    if (mode === "scopes") focusedScopeId = node.id;
    renderArchitecture();
    inspector.classList.add("is-open");
  });
  listItem.append(row);

  const children = collection.filter((candidate) => candidate.parentId === node.id);
  if (children.length) {
    const childList = document.createElement("ul");
    children.forEach((child) => childList.append(createTreeBranch(child, collection)));
    listItem.append(childList);
  }
  return listItem;
}

/**
 * Renders the focused scope and its direct children as a recursive system map.
 */
function renderScopeCanvas() {
  canvas.classList.remove("file-mode");
  scopeMap.className = "scope-map";
  scopeMap.style.transform = `scale(${zoom})`;
  scopeMap.replaceChildren();
  breadcrumbs.hidden = architecture.scopes.length === 0;

  if (!architecture.scopes.length) {
    renderCanvasEmpty(
      "No system map yet",
      "Start with the largest scope. Each child can be opened and viewed as the new big picture.",
    );
    breadcrumbs.hidden = true;
    return;
  }

  if (!focusedScopeId || !architecture.scopes.some((scope) => scope.id === focusedScopeId)) {
    focusedScopeId = architecture.scopes.find((scope) => !scope.parentId)?.id ?? architecture.scopes[0].id;
  }
  const focusedScope = architecture.scopes.find((scope) => scope.id === focusedScopeId);
  const children = architecture.scopes.filter((scope) => scope.parentId === focusedScope.id);
  renderBreadcrumbs(focusedScope);

  const rootNode = createScopeNode(focusedScope, true);
  scopeMap.append(rootNode);
  children.forEach((child, index) => {
    const angle = -Math.PI / 2 + index * ((Math.PI * 2) / Math.max(children.length, 1));
    const x = 50 + Math.cos(angle) * 40;
    const y = 50 + Math.sin(angle) * 37;
    const edge = document.createElement("span");
    edge.className = "scope-edge";
    edge.style.transform = `rotate(${angle}rad)`;
    scopeMap.append(edge);

    const node = createScopeNode(child, false);
    node.style.left = `${x}%`;
    node.style.top = `${y}%`;
    node.style.transform = "translate(-50%, -50%)";
    scopeMap.append(node);
  });

  if (!children.length) {
    const hint = document.createElement("p");
    hint.className = "scope-leaf-hint";
    hint.textContent = "This scope has no inside parts yet.";
    scopeMap.append(hint);
  }
}

/**
 * Creates a clickable scope node that can become the next focused system.
 *
 * @param {object} scope Scope model.
 * @param {boolean} isRoot Whether it is the current big-picture scope.
 * @returns {HTMLButtonElement} Scope node.
 */
function createScopeNode(scope, isRoot) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `scope-node ${isRoot ? "is-root" : ""}`;
  const title = document.createElement("strong");
  title.textContent = scope.name;
  const note = document.createElement("small");
  note.textContent = scope.notes ? scope.notes.slice(0, 72) : isRoot ? "Current scope" : "Open scope";
  node.append(title, note);
  node.addEventListener("click", () => {
    selectedId = scope.id;
    if (!isRoot) focusedScopeId = scope.id;
    renderArchitecture();
    inspector.classList.add("is-open");
  });
  return node;
}

/**
 * Shows the ancestry path for the focused system scope.
 *
 * @param {object} scope Focused scope.
 */
function renderBreadcrumbs(scope) {
  breadcrumbs.replaceChildren();
  const path = getNodePath(scope, architecture.scopes);
  path.forEach((pathNode, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = pathNode.name;
    button.addEventListener("click", () => {
      focusedScopeId = pathNode.id;
      selectedId = pathNode.id;
      renderArchitecture();
    });
    breadcrumbs.append(button);
    if (index < path.length - 1) {
      const separator = document.createElement("i");
      separator.textContent = "›";
      breadcrumbs.append(separator);
    }
  });
  breadcrumbs.hidden = false;
}

/**
 * Renders the file/folder skeleton as a spacious recursive architecture.
 */
function renderFileCanvas() {
  breadcrumbs.hidden = true;
  canvas.classList.add("file-mode");
  scopeMap.className = "file-map";
  scopeMap.style.transform = `scale(${zoom})`;
  scopeMap.replaceChildren();
  const roots = architecture.files.filter((node) => !node.parentId);
  if (!roots.length) {
    renderCanvasEmpty(
      "No script skeleton yet",
      "Create folders and files, then annotate what each part does and attach the algorithms it uses.",
    );
    return;
  }

  roots.forEach((root) => scopeMap.append(createFileMapBranch(root)));
}

/**
 * Recursively renders a file map branch with live algorithm links.
 *
 * @param {object} node File or folder node.
 * @returns {HTMLElement} File map branch.
 */
function createFileMapBranch(node) {
  const branch = document.createElement("div");
  branch.className = "file-map-branch";
  const card = document.createElement("div");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.className = "file-map-node";
  card.classList.toggle("is-selected", selectedId === node.id);
  const identity = document.createElement("div");
  const icon = document.createElement("span");
  icon.textContent = node.type === "folder" ? "▰" : "▤";
  const name = document.createElement("strong");
  name.textContent = node.name;
  identity.append(icon, name);
  const notes = document.createElement("p");
  notes.textContent = node.notes || "No notes yet";
  card.append(identity, notes);

  card.addEventListener("click", () => {
    selectedId = node.id;
    renderArchitecture();
    inspector.classList.add("is-open");
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      card.click();
    }
  });
  branch.append(card);

  const algorithmLinks = resolveAlgorithmLinks(node.algorithmIds);
  if (algorithmLinks.length) {
    const tags = document.createElement("div");
    tags.className = "file-algorithm-tags";
    algorithmLinks.forEach((algorithm) => {
      const tag = document.createElement("a");
      tag.href = `../workspace.html#section=${encodeURIComponent(algorithm.sectionId)}&item=${encodeURIComponent(algorithm.id)}`;
      tag.textContent = algorithm.title;
      tags.append(tag);
    });
    branch.append(tags);
  }

  const children = architecture.files.filter((candidate) => candidate.parentId === node.id);
  if (children.length) {
    const childGroup = document.createElement("div");
    childGroup.className = "file-map-children";
    children.forEach((child) => childGroup.append(createFileMapBranch(child)));
    branch.append(childGroup);
  }
  return branch;
}

/**
 * Places an empty-state prompt in the central canvas.
 *
 * @param {string} title Empty-state title.
 * @param {string} copy Guidance.
 */
function renderCanvasEmpty(title, copy) {
  scopeMap.className = "scope-empty";
  scopeMap.style.transform = "";
  const symbol = document.createElement("span");
  symbol.className = "empty-symbol";
  symbol.textContent = "⌘";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = copy;
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "button button-primary";
  addButton.textContent = mode === "scopes" ? "Add root scope" : "Add root node";
  addButton.addEventListener("click", () => openNodeDialog(null));
  scopeMap.append(symbol, heading, paragraph, addButton);
}

/**
 * Renders a type-aware inspector for the selected architecture node.
 */
function renderInspector() {
  const collection = mode === "scopes" ? architecture.scopes : architecture.files;
  const node = collection.find((candidate) => candidate.id === selectedId);
  if (!node) {
    inspectorEmpty.hidden = false;
    inspectorForm.hidden = true;
    return;
  }

  inspectorEmpty.hidden = true;
  inspectorForm.hidden = false;
  document.querySelector("#inspector-kind").textContent = mode === "scopes" ? "SYSTEM SCOPE" : node.type.toUpperCase();
  document.querySelector("#inspector-title").textContent = node.name;
  document.querySelector("#inspector-path").textContent = getNodePath(node, collection).map((pathNode) => pathNode.name).join(" / ");
  inspectorForm.elements.name.value = node.name;
  inspectorForm.elements.notes.value = node.notes ?? "";
  document.querySelector("#inspector-algorithms").hidden = mode === "scopes";
  document.querySelector("#add-child-node").textContent = mode === "scopes" ? "Add inside" : "Add child";
  document.querySelector("#add-child-node").hidden = mode === "files" && node.type === "file";
  if (mode === "files") renderAlgorithmChoices(node);
}

/**
 * Builds live algorithm checkboxes for one file/folder node.
 *
 * @param {object} node File or folder node.
 */
function renderAlgorithmChoices(node) {
  const list = document.querySelector("#algorithm-link-list");
  const libraryLink = document.querySelector(".algorithm-library-link");
  list.replaceChildren();
  const algorithms = getAlgorithmOptions();
  const firstAlgorithmSection = getWorkspace().sections.find((section) => section.type === "algorithm");
  libraryLink.href = firstAlgorithmSection
    ? `../workspace.html#section=${encodeURIComponent(firstAlgorithmSection.id)}`
    : "../workspace.html";
  if (!algorithms.length) {
    const hint = document.createElement("p");
    hint.className = "field-hint";
    hint.textContent = "Your Algorithms section is empty.";
    list.append(hint);
    return;
  }
  algorithms.forEach((algorithm) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "algorithmIds";
    checkbox.value = algorithm.id;
    checkbox.checked = (node.algorithmIds ?? []).includes(algorithm.id);
    label.append(checkbox, document.createTextNode(algorithm.title));
    list.append(label);
  });
}

/**
 * Resolves current algorithm identifiers to deep-link metadata.
 *
 * @param {Array<string>} algorithmIds Algorithm identifiers.
 * @returns {Array<{id: string, title: string, sectionId: string}>} Existing links.
 */
function resolveAlgorithmLinks(algorithmIds = []) {
  const options = getAlgorithmOptions();
  return algorithmIds
    .map((algorithmId) => options.find((option) => option.id === algorithmId))
    .filter(Boolean);
}

/**
 * Returns the root-to-node ancestry path with cycle protection.
 *
 * @param {object} node Starting node.
 * @param {Array<object>} collection Node collection.
 * @returns {Array<object>} Ordered ancestry.
 */
function getNodePath(node, collection) {
  const path = [];
  const visited = new Set();
  let current = node;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = collection.find((candidate) => candidate.id === current.parentId);
  }
  return path;
}

/**
 * Opens the creation dialog for a root or child node.
 *
 * @param {string|null} parentId Optional parent identifier.
 */
function openNodeDialog(parentId) {
  pendingParentId = parentId;
  nodeForm.reset();
  document.querySelector("#node-type-field").hidden = mode === "scopes";
  document.querySelector("#architecture-node-dialog-title").textContent = mode === "scopes"
    ? parentId ? "Add an inside scope" : "Add a root scope"
    : parentId ? "Add inside this node" : "Add a root node";
  nodeDialog.showModal();
  window.setTimeout(() => nodeForm.elements.name.focus(), 0);
}

/**
 * Creates a new architecture node from the dialog.
 *
 * @param {SubmitEvent} event Form submission.
 */
function createNode(event) {
  event.preventDefault();
  const formData = new FormData(nodeForm);
  const node = {
    id: createId(),
    parentId: pendingParentId,
    name: String(formData.get("name") ?? "").trim(),
    notes: "",
  };
  if (mode === "files") {
    node.type = String(formData.get("type") ?? "folder");
    node.algorithmIds = [];
    architecture.files.push(node);
  } else {
    architecture.scopes.push(node);
    focusedScopeId = node.id;
  }
  selectedId = node.id;
  saveArchitecture();
  nodeDialog.close();
  renderArchitecture();
  inspector.classList.add("is-open");
}

/**
 * Saves inspector fields into the selected node.
 *
 * @param {SubmitEvent} event Form submission.
 */
function saveInspector(event) {
  event.preventDefault();
  const collection = mode === "scopes" ? architecture.scopes : architecture.files;
  const node = collection.find((candidate) => candidate.id === selectedId);
  if (!node) return;
  const formData = new FormData(inspectorForm);
  node.name = String(formData.get("name") ?? "").trim();
  node.notes = String(formData.get("notes") ?? "").trim();
  if (mode === "files") {
    node.algorithmIds = formData.getAll("algorithmIds").map(String);
  }
  saveArchitecture();
  renderArchitecture();
}

/**
 * Deletes the selected node and all nested descendants after password confirmation.
 */
function deleteSelectedNode() {
  const collection = mode === "scopes" ? architecture.scopes : architecture.files;
  const node = collection.find((candidate) => candidate.id === selectedId);
  if (!node) return;
  const password = window.prompt(`Enter the delete password to delete “${node.name}” and everything inside it.`);
  if (password === null) return;
  if (!isDeletePasswordValid(password)) {
    window.alert("That password is not correct.");
    return;
  }

  const deletedIds = new Set([node.id]);
  let foundChild = true;
  while (foundChild) {
    foundChild = false;
    collection.forEach((candidate) => {
      if (candidate.parentId && deletedIds.has(candidate.parentId) && !deletedIds.has(candidate.id)) {
        deletedIds.add(candidate.id);
        foundChild = true;
      }
    });
  }
  const remaining = collection.filter((candidate) => !deletedIds.has(candidate.id));
  if (mode === "scopes") {
    architecture.scopes = remaining;
    focusedScopeId = node.parentId;
  } else {
    architecture.files = remaining;
  }
  selectedId = null;
  saveArchitecture();
  renderArchitecture();
}

/**
 * Exports architecture data as a portable JSON backup.
 */
function exportArchitecture() {
  const blob = new Blob([JSON.stringify(architecture, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `architecture-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelectorAll(".architecture-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    mode = tab.dataset.mode;
    selectedId = null;
    document.querySelectorAll(".architecture-tab").forEach((candidate) => candidate.classList.toggle("is-active", candidate === tab));
    renderArchitecture();
  });
});

document.querySelector("#add-architecture-node").addEventListener("click", () => openNodeDialog(null));
document.querySelector("#add-child-node").addEventListener("click", () => {
  if (selectedId) openNodeDialog(selectedId);
});
document.querySelector("#delete-architecture-node").addEventListener("click", deleteSelectedNode);
document.querySelector("#export-architecture").addEventListener("click", exportArchitecture);
nodeForm.addEventListener("submit", createNode);
inspectorForm.addEventListener("submit", saveInspector);
document.querySelectorAll("[data-dialog-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog")?.close());
});

canvas.addEventListener("wheel", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoom = Math.min(1.4, Math.max(0.65, zoom + (event.deltaY < 0 ? 0.08 : -0.08)));
  scopeMap.style.transform = `scale(${zoom})`;
}, { passive: false });

renderArchitecture();
