import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FILE_NAME,
  DEFAULT_FOLDER_NAME,
  ROOT_NODE_ID,
  addArchitectureNode,
  collectDescendantIds,
  createEmptyArchitecture,
  moveNodeToFolder,
  normalizeArchitecture,
  normalizeNodeName,
  removeArchitectureNode,
} from "./architecture-model.mjs";

test("an empty architecture always contains the permanent root", () => {
  const architecture = createEmptyArchitecture();
  assert.equal(architecture.rootId, ROOT_NODE_ID);
  assert.deepEqual(architecture.nodes.map((node) => node.name), ["root"]);
});

test("new folders and files use the requested blank names", () => {
  const architecture = createEmptyArchitecture();
  assert.equal(addArchitectureNode(architecture, { id: "folder", type: "folder" }).name, DEFAULT_FOLDER_NAME);
  assert.equal(addArchitectureNode(architecture, { id: "file", type: "file" }).name, DEFAULT_FILE_NAME);
});

test("moving a folder into its descendant is rejected", () => {
  const architecture = createEmptyArchitecture();
  addArchitectureNode(architecture, { id: "parent", type: "folder" });
  addArchitectureNode(architecture, { id: "child", type: "folder", parentId: "parent" });
  assert.equal(moveNodeToFolder(architecture, "parent", "child"), false);
  assert.equal(architecture.nodes.find((node) => node.id === "parent").parentId, ROOT_NODE_ID);
});

test("files and folders can move into another folder", () => {
  const architecture = createEmptyArchitecture();
  addArchitectureNode(architecture, { id: "target", type: "folder" });
  addArchitectureNode(architecture, { id: "file", type: "file" });
  assert.equal(moveNodeToFolder(architecture, "file", "target"), true);
  assert.equal(architecture.nodes.find((node) => node.id === "file").parentId, "target");
});

test("deleting a folder removes all descendants without affecting root", () => {
  const architecture = createEmptyArchitecture();
  addArchitectureNode(architecture, { id: "folder", type: "folder" });
  addArchitectureNode(architecture, { id: "file", type: "file", parentId: "folder" });
  assert.deepEqual([...collectDescendantIds(architecture.nodes, "folder")], ["file"]);
  assert.equal(removeArchitectureNode(architecture, "folder"), true);
  assert.deepEqual(architecture.nodes.map((node) => node.id), [ROOT_NODE_ID]);
  assert.equal(removeArchitectureNode(architecture, ROOT_NODE_ID), false);
});

test("legacy files and scopes migrate beneath the permanent root", () => {
  const architecture = normalizeArchitecture({
    files: [{ id: "file-1", parentId: null, type: "file", name: "index.js", notes: "entry" }],
    scopes: [{ id: "scope-1", parentId: null, name: "API", notes: "service" }],
  });
  assert.equal(architecture.nodes.find((node) => node.id === "file-1").parentId, ROOT_NODE_ID);
  assert.equal(architecture.nodes.find((node) => node.id === "migrated-scope-scope-1").parentId, "architecture-migrated-scopes");
});

test("renaming strips path separators and restores blank defaults", () => {
  assert.equal(normalizeNodeName(" src/components/ ", "folder"), "srccomponents");
  assert.equal(normalizeNodeName("", "folder"), DEFAULT_FOLDER_NAME);
  assert.equal(normalizeNodeName("", "file"), DEFAULT_FILE_NAME);
});
