import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManifest,
  createFileDropState,
  findDuplicate,
  getPreviewKind,
  moveFolder,
  recoverFile,
  removeFolder,
  renamePreservingExtension,
  trashFile,
  validateFileDropState,
} from "./file-drop-model.mjs";

test("duplicate handling uses fingerprint and size rather than display name", () => {
  const files = [{ id: "a", name: "one.txt", size: 3, fingerprint: "abc", status: "ready", trashedAt: null }];
  assert.equal(findDuplicate(files, { name: "other.txt", size: 3, fingerprint: "abc" }).id, "a");
  assert.equal(findDuplicate(files, { name: "one.txt", size: 4, fingerprint: "abc" }), null);
});

test("folder movement rejects cycles and removal returns files to root", () => {
  const state = createFileDropState();
  state.folders.push(
    { id: "a", name: "A", parentId: "folder-root" },
    { id: "b", name: "B", parentId: "a" },
  );
  state.files.push({ id: "file", name: "x.txt", type: "text/plain", size: 1, folderId: "b" });
  assert.throws(() => moveFolder(state.folders, "a", "b"), /cycle/);
  const removed = removeFolder(state, "a");
  assert.equal(removed.files[0].folderId, "folder-root");
  assert.deepEqual(removed.folders.map((folder) => folder.id), ["folder-root"]);
});

test("manifest validation rejects unsafe filenames and corruption", () => {
  const state = createFileDropState();
  state.files.push({ id: "f", name: "safe.txt", type: "text/plain", size: 1, folderId: "folder-root" });
  assert.equal(buildManifest(state).format, "vital-pancakes-file-drop");
  state.files[0].name = "../unsafe.txt";
  assert.throws(() => validateFileDropState(state), /Unsafe filename/);
});

test("renaming preserves an underlying extension when omitted", () => {
  assert.equal(renamePreservingExtension("notes.md", "meeting"), "meeting.md");
  assert.equal(renamePreservingExtension("notes.md", "meeting.txt"), "meeting.txt");
  assert.throws(() => renamePreservingExtension("notes.md", "../bad"), /safe filename/);
});

test("trash recovery is reversible", () => {
  const trashed = trashFile({ id: "a", trashedAt: null }, new Date("2026-07-29T00:00:00Z"));
  assert.equal(trashed.trashedAt, "2026-07-29T00:00:00.000Z");
  assert.equal(recoverFile(trashed).trashedAt, null);
});

test("preview policy blocks active content and permits supported passive formats", () => {
  assert.equal(getPreviewKind({ name: "page.html", type: "text/html" }), "blocked");
  assert.equal(getPreviewKind({ name: "image.svg", type: "image/svg+xml" }), "blocked");
  assert.equal(getPreviewKind({ name: "photo.png", type: "image/png" }), "image");
  assert.equal(getPreviewKind({ name: "paper.pdf", type: "application/pdf" }), "pdf");
  assert.equal(getPreviewKind({ name: "data.bin", type: "application/octet-stream" }), "unsupported");
});
