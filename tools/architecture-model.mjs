/**
 * Pure model helpers for the Architecture Designer folder tree.
 */

export const ARCHITECTURE_VERSION = 2;
export const ROOT_NODE_ID = "architecture-root";
export const DEFAULT_FOLDER_NAME = "BlankFolder";
export const DEFAULT_FILE_NAME = "BlankFile.BlankExtension";

export function createEmptyArchitecture() {
  return {
    version: ARCHITECTURE_VERSION,
    rootId: ROOT_NODE_ID,
    nodes: [createRootNode()],
  };
}

export function normalizeArchitecture(saved) {
  if (saved?.version === ARCHITECTURE_VERSION && Array.isArray(saved.nodes)) {
    return repairArchitecture(saved.nodes);
  }
  return migrateLegacyArchitecture(saved);
}

export function normalizeNodeName(value, type) {
  const sanitized = String(value ?? "")
    .replace(/[\\/]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized) return sanitized;
  return type === "folder" ? DEFAULT_FOLDER_NAME : DEFAULT_FILE_NAME;
}

export function getArchitectureChildren(nodes, parentId) {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort((first, second) => first.order - second.order || first.name.localeCompare(second.name));
}

export function collectDescendantIds(nodes, nodeId) {
  const descendants = new Set();
  let foundNewNode = true;
  while (foundNewNode) {
    foundNewNode = false;
    nodes.forEach((node) => {
      if (node.parentId === nodeId || descendants.has(node.parentId)) {
        if (!descendants.has(node.id)) {
          descendants.add(node.id);
          foundNewNode = true;
        }
      }
    });
  }
  return descendants;
}

export function addArchitectureNode(architecture, { id, type, parentId }) {
  const safeType = type === "file" ? "file" : "folder";
  const safeParentId = getValidParentId(architecture.nodes, parentId);
  const siblings = getArchitectureChildren(architecture.nodes, safeParentId);
  const node = {
    id,
    parentId: safeParentId,
    type: safeType,
    name: safeType === "folder" ? DEFAULT_FOLDER_NAME : DEFAULT_FILE_NAME,
    notes: "",
    collapsed: false,
    order: siblings.length ? Math.max(...siblings.map((sibling) => sibling.order)) + 1 : 0,
  };
  architecture.nodes.push(node);
  return node;
}

export function moveNodeToFolder(architecture, nodeId, folderId) {
  const node = architecture.nodes.find((candidate) => candidate.id === nodeId);
  const folder = architecture.nodes.find((candidate) => candidate.id === folderId);
  if (!node || !folder || folder.type !== "folder" || node.id === ROOT_NODE_ID) return false;
  if (node.id === folder.id || collectDescendantIds(architecture.nodes, node.id).has(folder.id)) return false;
  if (node.parentId === folder.id) return false;

  const siblings = getArchitectureChildren(architecture.nodes, folder.id);
  node.parentId = folder.id;
  node.order = siblings.length ? Math.max(...siblings.map((sibling) => sibling.order)) + 1 : 0;
  return true;
}

export function removeArchitectureNode(architecture, nodeId) {
  if (nodeId === ROOT_NODE_ID) return false;
  const removedIds = collectDescendantIds(architecture.nodes, nodeId);
  removedIds.add(nodeId);
  const previousLength = architecture.nodes.length;
  architecture.nodes = architecture.nodes.filter((node) => !removedIds.has(node.id));
  return architecture.nodes.length !== previousLength;
}

function createRootNode(name = "root", notes = "") {
  return {
    id: ROOT_NODE_ID,
    parentId: null,
    type: "folder",
    name: normalizeNodeName(name, "folder"),
    notes: String(notes ?? ""),
    collapsed: false,
    order: 0,
  };
}

function repairArchitecture(sourceNodes) {
  const sourceRoot = sourceNodes.find((node) => node.id === ROOT_NODE_ID);
  const root = createRootNode(sourceRoot?.name, sourceRoot?.notes);
  root.collapsed = Boolean(sourceRoot?.collapsed);

  const nodes = sourceNodes
    .filter((node) => node?.id && node.id !== ROOT_NODE_ID)
    .map((node, index) => normalizeNode(node, index));
  nodes.unshift(root);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  nodes.slice(1).forEach((node) => {
    const parent = byId.get(node.parentId);
    if (!parent || parent.type !== "folder" || parent.id === node.id) node.parentId = ROOT_NODE_ID;
  });
  nodes.slice(1).forEach((node) => {
    if (parentChainContains(nodes, node.parentId, node.id)) node.parentId = ROOT_NODE_ID;
  });
  return { version: ARCHITECTURE_VERSION, rootId: ROOT_NODE_ID, nodes };
}

function migrateLegacyArchitecture(saved) {
  const legacyFiles = Array.isArray(saved?.files) ? saved.files : [];
  const legacyRoot = legacyFiles.find((node) => (
    node?.type === "folder"
    && !node.parentId
    && String(node.name ?? "").replace(/\/$/, "").toLowerCase() === "root"
  ));
  const nodes = [createRootNode(legacyRoot?.name, legacyRoot?.notes)];

  legacyFiles
    .filter((node) => node?.id && node !== legacyRoot)
    .forEach((node, index) => {
      const migrated = normalizeNode(node, index);
      if (!migrated.parentId || migrated.parentId === legacyRoot?.id) migrated.parentId = ROOT_NODE_ID;
      nodes.push(migrated);
    });

  const legacyScopes = Array.isArray(saved?.scopes) ? saved.scopes : [];
  if (legacyScopes.length) {
    const scopeFolderId = "architecture-migrated-scopes";
    nodes.push({
      id: scopeFolderId,
      parentId: ROOT_NODE_ID,
      type: "folder",
      name: "MigratedScopes",
      notes: "System scopes preserved from the previous Architecture Designer.",
      collapsed: false,
      order: nodes.length,
    });
    legacyScopes.forEach((scope, index) => {
      nodes.push({
        id: `migrated-scope-${scope.id}`,
        parentId: scope.parentId ? `migrated-scope-${scope.parentId}` : scopeFolderId,
        type: "folder",
        name: normalizeNodeName(scope.name, "folder"),
        notes: String(scope.notes ?? ""),
        collapsed: false,
        order: index,
      });
    });
  }
  return repairArchitecture(nodes);
}

function normalizeNode(node, fallbackOrder) {
  const type = node.type === "file" ? "file" : "folder";
  return {
    id: String(node.id),
    parentId: node.parentId ? String(node.parentId) : ROOT_NODE_ID,
    type,
    name: normalizeNodeName(node.name, type),
    notes: String(node.notes ?? ""),
    collapsed: type === "folder" && Boolean(node.collapsed),
    order: Number.isFinite(Number(node.order)) ? Number(node.order) : fallbackOrder,
  };
}

function getValidParentId(nodes, parentId) {
  const parent = nodes.find((node) => node.id === parentId && node.type === "folder");
  return parent?.id ?? ROOT_NODE_ID;
}

function parentChainContains(nodes, parentId, targetId) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set();
  let currentId = parentId;
  while (currentId && !visited.has(currentId)) {
    if (currentId === targetId) return true;
    visited.add(currentId);
    currentId = byId.get(currentId)?.parentId;
  }
  return false;
}
