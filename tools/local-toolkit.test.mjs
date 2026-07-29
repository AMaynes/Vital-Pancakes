import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKUP_FORMAT,
  buildBackup,
  createUndoManager,
  mergeImportedRecords,
  safeFilename,
  validateBackupEnvelope,
} from "./local-toolkit.mjs";

test("buildBackup and validation preserve versioned records", () => {
  const backup = buildBackup("example", [{ id: "a", title: "One" }]);
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.deepEqual(validateBackupEnvelope(backup, "example").records, [{ id: "a", title: "One" }]);
  assert.throws(() => validateBackupEnvelope({ ...backup, version: 99 }, "example"), /Unsupported/);
});

test("conflict-safe imports preserve both different records", () => {
  const result = mergeImportedRecords(
    [{ id: "same", title: "Local" }],
    [{ id: "same", title: "Imported" }, { id: "new", title: "New" }],
  );
  assert.equal(result.records.length, 3);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.records.find((record) => record.id === "same").title, "Local");
});

test("undo manager supports reversible edits", () => {
  const history = createUndoManager(2);
  history.record({ count: 1 }, { count: 2 }, "increment");
  assert.deepEqual(history.undo({ count: 2 }).value, { count: 1 });
  assert.deepEqual(history.redo({ count: 1 }).value, { count: 2 });
});

test("safeFilename removes path and control characters", () => {
  assert.equal(safeFilename("../bad/name\u0000.json"), "bad-name-.json");
  assert.equal(safeFilename("..."), "download");
});
