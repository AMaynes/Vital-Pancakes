/**
 * Transport-neutral command envelopes shared by every AI-capable surface.
 *
 * The protocol deliberately contains no model or browser assumptions. ChatGPT,
 * MCP, WebLLM, the command console, and tests all cross the same validation
 * boundary before a tool adapter sees a command.
 */

export const AI_PROTOCOL_VERSION = 1;
export const AI_ENVELOPE_MODES = Object.freeze(["preview", "apply"]);
export const AI_PERMISSION_LEVELS = Object.freeze([
  "read-summary",
  "read-content",
  "create",
  "update",
  "delete",
  "export",
  "file-access",
  "sensitive-data",
]);

export const AI_PROTOCOL_LIMITS = Object.freeze({
  maximumCommands: 100,
  maximumEnvelopeBytes: 1_000_000,
  maximumRequestIdLength: 128,
  maximumToolIdLength: 80,
  maximumCommandTypeLength: 100,
  maximumMetadataBytes: 16_000,
});

const ENVELOPE_FIELDS = new Set([
  "protocolVersion",
  "requestId",
  "tool",
  "mode",
  "expectedRevision",
  "commands",
  "metadata",
]);

export class AiCommandError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AiCommandError";
    this.code = options.code ?? "invalid-command";
    this.path = options.path ?? null;
    this.commandIndex = Number.isInteger(options.commandIndex)
      ? options.commandIndex
      : null;
    this.recoverable = options.recoverable !== false;
    this.details = isRecord(options.details) ? cloneJson(options.details) : null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      path: this.path,
      commandIndex: this.commandIndex,
      recoverable: this.recoverable,
      details: this.details,
    };
  }
}

/**
 * Validates and clones one untrusted command envelope.
 *
 * @param {unknown} candidate Untrusted parsed JSON.
 * @returns {object} Normalized envelope.
 */
export function normalizeAiCommandEnvelope(candidate) {
  if (!isRecord(candidate)) {
    throw new AiCommandError("The command package must be a JSON object.", {
      code: "invalid-envelope",
      path: "$",
    });
  }

  const envelopeBytes = jsonByteLength(candidate);
  if (envelopeBytes > AI_PROTOCOL_LIMITS.maximumEnvelopeBytes) {
    throw new AiCommandError(
      `The command package exceeds ${AI_PROTOCOL_LIMITS.maximumEnvelopeBytes} bytes.`,
      { code: "envelope-too-large", path: "$", recoverable: true },
    );
  }

  const unknownField = Object.keys(candidate).find((field) => !ENVELOPE_FIELDS.has(field));
  if (unknownField) {
    throw new AiCommandError(`Unknown command-package field: ${unknownField}.`, {
      code: "unknown-envelope-field",
      path: `$.${unknownField}`,
    });
  }

  if (candidate.protocolVersion !== AI_PROTOCOL_VERSION) {
    throw new AiCommandError(
      `Unsupported protocol version. Expected ${AI_PROTOCOL_VERSION}.`,
      {
        code: "unsupported-protocol-version",
        path: "$.protocolVersion",
        details: {
          expected: AI_PROTOCOL_VERSION,
          received: candidate.protocolVersion ?? null,
        },
      },
    );
  }

  const requestId = normalizeIdentifier(
    candidate.requestId,
    "requestId",
    AI_PROTOCOL_LIMITS.maximumRequestIdLength,
  );
  const tool = normalizeIdentifier(
    candidate.tool,
    "tool",
    AI_PROTOCOL_LIMITS.maximumToolIdLength,
  );
  const mode = String(candidate.mode ?? "");
  if (!AI_ENVELOPE_MODES.includes(mode)) {
    throw new AiCommandError('Mode must be either "preview" or "apply".', {
      code: "invalid-mode",
      path: "$.mode",
    });
  }

  if (!Array.isArray(candidate.commands) || candidate.commands.length === 0) {
    throw new AiCommandError("Provide at least one command.", {
      code: "empty-command-list",
      path: "$.commands",
    });
  }
  if (candidate.commands.length > AI_PROTOCOL_LIMITS.maximumCommands) {
    throw new AiCommandError(
      `A command package can contain at most ${AI_PROTOCOL_LIMITS.maximumCommands} commands.`,
      { code: "too-many-commands", path: "$.commands" },
    );
  }

  const commands = candidate.commands.map((command, commandIndex) => {
    if (!isRecord(command)) {
      throw new AiCommandError("Each command must be a JSON object.", {
        code: "invalid-command",
        path: `$.commands[${commandIndex}]`,
        commandIndex,
      });
    }
    const type = normalizeIdentifier(
      command.type,
      `commands[${commandIndex}].type`,
      AI_PROTOCOL_LIMITS.maximumCommandTypeLength,
    );
    return { ...cloneJson(command), type };
  });

  let expectedRevision;
  if (candidate.expectedRevision !== undefined) {
    expectedRevision = Number(candidate.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new AiCommandError("expectedRevision must be a non-negative integer.", {
        code: "invalid-revision",
        path: "$.expectedRevision",
      });
    }
  }

  const metadata = candidate.metadata === undefined
    ? undefined
    : normalizeMetadata(candidate.metadata);

  return {
    protocolVersion: AI_PROTOCOL_VERSION,
    requestId,
    tool,
    mode,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    commands,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function createAiCommandReceipt(envelope, result = {}) {
  return {
    ok: true,
    protocolVersion: AI_PROTOCOL_VERSION,
    requestId: envelope.requestId,
    tool: envelope.tool,
    mode: envelope.mode,
    revision: Number.isSafeInteger(result.revision) ? result.revision : null,
    createdIds: normalizeIdentifierList(result.createdIds),
    updatedIds: normalizeIdentifierList(result.updatedIds),
    deletedIds: normalizeIdentifierList(result.deletedIds),
    clientKeyMap: normalizeClientKeyMap(result.clientKeyMap),
    warnings: normalizeWarnings(result.warnings),
    undoGroupId: typeof result.undoGroupId === "string" ? result.undoGroupId : null,
    duplicate: Boolean(result.duplicate),
    result: result.result === undefined ? null : cloneJson(result.result),
  };
}

export function createAiCommandFailure(error, envelope = null) {
  const normalized = error instanceof AiCommandError
    ? error
    : new AiCommandError(error?.message || "The tool command failed.", {
      code: "tool-command-failed",
      recoverable: false,
      cause: error,
    });
  return {
    ok: false,
    protocolVersion: AI_PROTOCOL_VERSION,
    requestId: envelope?.requestId ?? null,
    tool: envelope?.tool ?? null,
    mode: envelope?.mode ?? null,
    error: normalized.toJSON(),
  };
}

export function assertAiPermissions(requiredPermissions, grantedPermissions) {
  const granted = new Set(Array.isArray(grantedPermissions) ? grantedPermissions : []);
  const missing = [...new Set(requiredPermissions ?? [])]
    .filter((permission) => !granted.has(permission));
  if (missing.length) {
    throw new AiCommandError(`Permission required: ${missing.join(", ")}.`, {
      code: "permission-required",
      path: "$.commands",
      details: { missingPermissions: missing },
    });
  }
}

export function jsonByteLength(value) {
  const serialized = JSON.stringify(value);
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(serialized).byteLength
    : serialized.length;
}

export function cloneJson(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new AiCommandError("Command data must be JSON-serializable.", {
      code: "non-serializable-command",
      path: "$",
      cause: error,
    });
  }
}

export function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function normalizeIdentifier(value, field, limit) {
  const identifier = String(value ?? "").trim();
  if (!identifier || identifier.length > limit || !/^[a-zA-Z0-9._:/-]+$/.test(identifier)) {
    throw new AiCommandError(
      `${field} must be a non-empty identifier no longer than ${limit} characters.`,
      { code: "invalid-identifier", path: `$.${field}` },
    );
  }
  return identifier;
}

function normalizeMetadata(value) {
  if (!isRecord(value)) {
    throw new AiCommandError("metadata must be a JSON object.", {
      code: "invalid-metadata",
      path: "$.metadata",
    });
  }
  if (jsonByteLength(value) > AI_PROTOCOL_LIMITS.maximumMetadataBytes) {
    throw new AiCommandError("metadata is too large.", {
      code: "metadata-too-large",
      path: "$.metadata",
    });
  }
  return cloneJson(value);
}

function normalizeIdentifierList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string" && item)
    .slice(0, 10_000))];
}

function normalizeClientKeyMap(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, identifier]) => key && typeof identifier === "string" && identifier)
      .slice(0, 10_000),
  );
}

function normalizeWarnings(value) {
  return (Array.isArray(value) ? value : [])
    .map((warning) => String(warning).trim())
    .filter(Boolean)
    .slice(0, 100);
}
