import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPermissionCeiling,
  DEFAULT_BRIDGE_PERMISSIONS,
  normalizePermissionSelection,
  PermissionCeilingError,
} from "../extension/permission-policy.js";

test("the connection permission default is read-only", () => {
  assert.deepEqual(
    DEFAULT_BRIDGE_PERMISSIONS,
    ["read-summary", "read-content"],
  );
});

test("normalization drops unknown values and preserves canonical order", () => {
  assert.deepEqual(
    normalizePermissionSelection(["delete", "unknown", "read-summary", "delete"]),
    ["read-summary", "delete"],
  );
});

test("model-supplied permissions cannot exceed the user ceiling", () => {
  assert.throws(
    () => applyPermissionCeiling(
      "dispatch",
      {
        args: [
          { mode: "apply" },
          { grantedPermissions: ["create"] },
        ],
      },
      DEFAULT_BRIDGE_PERMISSIONS,
    ),
    (error) => (
      error instanceof PermissionCeilingError
      && error.code === "permission_ceiling_exceeded"
    ),
  );
});

test("forwarded permissions come from the user ceiling", () => {
  const original = {
    args: [
      { mode: "apply" },
      { grantedPermissions: ["create"] },
    ],
  };
  const result = applyPermissionCeiling(
    "dispatch",
    original,
    ["read-summary", "create", "update"],
  );
  assert.deepEqual(
    result.args[1].grantedPermissions,
    ["read-summary", "create", "update"],
  );
  assert.deepEqual(original.args[1].grantedPermissions, ["create"]);
});

test("export and undo require explicit session permissions", () => {
  assert.throws(
    () => applyPermissionCeiling(
      "exportTool",
      { args: ["visual-board", {}] },
      DEFAULT_BRIDGE_PERMISSIONS,
    ),
    /Export access was not granted/,
  );
  assert.throws(
    () => applyPermissionCeiling(
      "undo",
      { args: ["visual-board"] },
      DEFAULT_BRIDGE_PERMISSIONS,
    ),
    /Update access was not granted/,
  );
  assert.doesNotThrow(() => applyPermissionCeiling(
    "undo",
    { args: ["visual-board"] },
    ["update"],
  ));
});

test("context reads require a read grant and receive only the session ceiling", () => {
  assert.throws(
    () => applyPermissionCeiling(
      "getContext",
      { args: ["visual-board", {}] },
      [],
    ),
    /Read access was not granted/,
  );
  const result = applyPermissionCeiling(
    "getContext",
    { args: ["visual-board", {}] },
    ["read-summary"],
  );
  assert.deepEqual(result.args[1].grantedPermissions, ["read-summary"]);
});
