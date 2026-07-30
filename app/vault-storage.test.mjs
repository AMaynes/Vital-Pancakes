import assert from "node:assert/strict";
import test from "node:test";

import {
  isSafeOpfsPath,
  normalizeRestoreMode,
  validateVaultManifest,
  VAULT_MANIFEST_FORMAT,
  VAULT_MANIFEST_VERSION,
} from "./vault-storage.mjs";

function manifest() {
  return {
    format: VAULT_MANIFEST_FORMAT,
    version: VAULT_MANIFEST_VERSION,
    exportedAt: "2026-07-30T00:00:00.000Z",
    localStorage: [{ key: "workspace", value: "{}" }],
    databases: [{
      name: "vital-pancakes-test",
      version: 1,
      stores: [{
        name: "records",
        keyPath: "id",
        autoIncrement: false,
        count: 2,
        indexes: [{
          name: "title",
          keyPath: "title",
          unique: false,
          multiEntry: false,
        }],
      }],
    }],
    opfsFiles: [{
      path: "files/report.pdf",
      size: 123,
      type: "application/pdf",
      lastModified: 0,
    }],
  };
}

test("vault manifest validation accepts complete versioned schemas", () => {
  const value = manifest();
  assert.deepEqual(validateVaultManifest(value), value);
});

test("vault manifest rejects duplicate keys, unsafe files, and corrupt schemas", () => {
  const duplicate = manifest();
  duplicate.localStorage.push({ key: "workspace", value: "duplicate" });
  assert.throws(() => validateVaultManifest(duplicate), /local settings/i);

  const unsafe = manifest();
  unsafe.opfsFiles[0].path = "../outside";
  assert.throws(() => validateVaultManifest(unsafe), /file manifest/i);

  const corrupt = manifest();
  corrupt.databases[0].stores[0].count = -1;
  assert.throws(() => validateVaultManifest(corrupt), /object-store/i);
});

test("OPFS paths and restore modes are constrained", () => {
  assert.equal(isSafeOpfsPath("folders/My file.pdf"), true);
  assert.equal(isSafeOpfsPath("../secret"), false);
  assert.equal(isSafeOpfsPath("/absolute/file"), false);
  assert.equal(isSafeOpfsPath("folder\\file"), false);
  assert.equal(normalizeRestoreMode(), "merge");
  assert.equal(normalizeRestoreMode("replace"), "replace");
  assert.throws(() => normalizeRestoreMode("append"), /merge or replace/i);
});
