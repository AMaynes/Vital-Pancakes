export const BRIDGE_PERMISSIONS = Object.freeze([
  "read-summary",
  "read-content",
  "create",
  "update",
  "delete",
  "export",
  "file-access",
  "sensitive-data",
]);

export const DEFAULT_BRIDGE_PERMISSIONS = Object.freeze([
  "read-summary",
  "read-content",
]);

const PERMISSION_SET = new Set(BRIDGE_PERMISSIONS);
const PERMISSION_AWARE_METHODS = new Set([
  "getContext",
  "dispatch",
  "exportTool",
]);

export class PermissionCeilingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PermissionCeilingError";
    this.code = code;
  }
}

export function normalizePermissionSelection(values) {
  const selected = new Set(
    Array.isArray(values)
      ? values.filter((value) => PERMISSION_SET.has(value))
      : [],
  );
  return BRIDGE_PERMISSIONS.filter((permission) => selected.has(permission));
}

export function applyPermissionCeiling(method, params, permissionCeiling) {
  const effectivePermissions = normalizePermissionSelection(permissionCeiling);
  const effectiveSet = new Set(effectivePermissions);
  if (method === "exportTool" && !effectiveSet.has("export")) {
    throw new PermissionCeilingError(
      "permission_ceiling_exceeded",
      "Export access was not granted when this tab was connected.",
    );
  }
  if (["undo", "redo"].includes(method) && !effectiveSet.has("update")) {
    throw new PermissionCeilingError(
      "permission_ceiling_exceeded",
      "Update access was not granted when this tab was connected.",
    );
  }
  if (
    method === "getContext"
    && !effectiveSet.has("read-summary")
    && !effectiveSet.has("read-content")
  ) {
    throw new PermissionCeilingError(
      "permission_ceiling_exceeded",
      "Read access was not granted when this tab was connected.",
    );
  }
  if (!PERMISSION_AWARE_METHODS.has(method)) return cloneParams(params);

  const cloned = cloneParams(params);
  const requested = normalizePermissionSelection(
    cloned.args?.[1]?.grantedPermissions,
  );
  const denied = requested.filter((permission) => !effectiveSet.has(permission));
  if (denied.length) {
    throw new PermissionCeilingError(
      "permission_ceiling_exceeded",
      `This tab did not grant: ${denied.join(", ")}.`,
    );
  }

  const args = Array.isArray(cloned.args) ? [...cloned.args] : [];
  const options = isRecord(args[1]) ? { ...args[1] } : {};
  options.grantedPermissions = effectivePermissions;
  args[1] = options;
  return { ...cloned, args };
}

function cloneParams(params) {
  if (!isRecord(params)) return { args: [] };
  return {
    ...params,
    ...(Array.isArray(params.args) ? { args: [...params.args] } : {}),
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
