/**
 * Provider-independent adapter host for existing Vital Pancakes tools.
 *
 * Tool pages supply JSON-safe snapshots and pure command operations. Mutating
 * envelopes execute against a clone and reach the page commit callback once,
 * after every command has succeeded.
 */

import { installAiPageHost } from "../app/ai-page-host.mjs";
import {
  AiCommandError,
  cloneJson,
  isRecord,
} from "../app/ai-command-protocol.mjs";

const MAXIMUM_CONTEXT_BYTES = 250_000;

/**
 * Creates and installs one page-local adapter.
 *
 * @param {object} configuration Page-owned state and command definitions.
 * @returns {object} Frozen public AI page API.
 */
export function installCurrentToolAiHost(configuration) {
  return installAiPageHost(createCurrentToolAiAdapter(configuration));
}

/**
 * Builds a registry-compatible adapter without touching page state.
 *
 * Operations receive an isolated state clone. A mutating operation returns its
 * next state as `state`; read operations return a JSON-safe `value`.
 *
 * @param {object} configuration Adapter configuration.
 * @returns {object} Registry-compatible adapter.
 */
export function createCurrentToolAiAdapter(configuration) {
  const config = normalizeConfiguration(configuration);
  const operations = new Map(config.commands.map((command) => [command.type, command]));
  let visibleRevision = 0;
  let lastStateSignature = null;

  function getRevision() {
    const signature = serializeState(config.getSnapshot());
    if (signature !== lastStateSignature) {
      visibleRevision += 1;
      lastStateSignature = signature;
    }
    return visibleRevision;
  }

  function getCapabilities() {
    return {
      id: config.id,
      title: config.title,
      description: config.description,
      commands: config.commands.map((command) => ({
        type: command.type,
        description: command.description,
        permissions: [...command.permissions],
        mutates: command.mutates,
        ...(command.schema ? { schema: cloneJson(command.schema) } : {}),
        ...(command.example ? { example: cloneJson(command.example) } : {}),
      })),
      limitations: [...config.limitations],
    };
  }

  async function getContext(options = {}) {
    const context = config.getContext
      ? await config.getContext(cloneJson(options), cloneJson(config.getSnapshot()))
      : { revision: getRevision() };
    assertContextSize(context);
    return context;
  }

  function getRequiredPermissions(commands) {
    return commands.flatMap((command, commandIndex) => {
      const operation = operations.get(command.type);
      if (!operation) {
        throw commandError(
          `Unsupported command: ${command.type}.`,
          commandIndex,
          "type",
          "unsupported-command",
        );
      }
      return operation.permissions;
    });
  }

  async function execute(envelope, executionContext = {}, shouldCommit) {
    const baseRevision = getRevision();
    const originalState = cloneJson(config.getSnapshot());
    let stagedState = cloneJson(originalState);
    const changes = createChangeSummary();
    const commandResults = [];

    for (let commandIndex = 0; commandIndex < envelope.commands.length; commandIndex += 1) {
      if (executionContext.signal?.aborted) {
        throw commandError(
          "The command was cancelled.",
          commandIndex,
          null,
          "cancelled",
          true,
        );
      }

      const command = envelope.commands[commandIndex];
      const operation = operations.get(command.type);
      if (!operation) {
        throw commandError(
          `Unsupported command: ${command.type}.`,
          commandIndex,
          "type",
          "unsupported-command",
        );
      }

      try {
        const outcome = await operation.execute(
          stagedState,
          cloneJson(command),
          {
            commandIndex,
            mode: envelope.mode,
            signal: executionContext.signal,
          },
        );
        const normalizedOutcome = normalizeOperationOutcome(outcome, operation.mutates);
        if (normalizedOutcome.state !== undefined) {
          stagedState = cloneJson(normalizedOutcome.state);
        }
        mergeChangeSummary(changes, normalizedOutcome);
        commandResults.push({
          type: command.type,
          value: normalizedOutcome.value ?? null,
        });
      } catch (error) {
        if (error instanceof AiCommandError) {
          if (error.commandIndex === null) error.commandIndex = commandIndex;
          if (!error.path) error.path = `$.commands[${commandIndex}]`;
          throw error;
        }
        throw commandError(
          error?.message || `${command.type} failed.`,
          commandIndex,
          null,
          error?.code || "tool-command-failed",
          true,
          error,
        );
      }
    }

    const stateChanged = serializeState(originalState) !== serializeState(stagedState);
    if (shouldCommit && stateChanged) {
      if (getRevision() !== baseRevision) {
        throw new AiCommandError("The tool changed while the command was running.", {
          code: "stale-revision",
          path: "$.expectedRevision",
          details: { expectedRevision: baseRevision, currentRevision: getRevision() },
        });
      }
      await config.commitSnapshot(cloneJson(stagedState), {
        requestId: envelope.requestId,
        commands: envelope.commands.map((command) => command.type),
      });
      lastStateSignature = null;
    }

    return {
      revision: getRevision(),
      createdIds: changes.createdIds,
      updatedIds: changes.updatedIds,
      deletedIds: changes.deletedIds,
      warnings: changes.warnings,
      undoGroupId: stateChanged && shouldCommit ? envelope.requestId : null,
      result: {
        stateChanged,
        commands: commandResults,
        ...(shouldCommit ? {} : { preview: true }),
      },
    };
  }

  const adapter = {
    id: config.id,
    title: config.title,
    getRevision,
    getCapabilities,
    getContext,
    getRequiredPermissions,
    preview: (envelope, context) => execute(envelope, context, false),
    apply: (envelope, context) => execute(envelope, context, true),
  };

  if (config.undo) adapter.undo = config.undo;
  if (config.redo) adapter.redo = config.redo;
  if (config.exportTool) adapter.export = config.exportTool;
  return Object.freeze(adapter);
}

/**
 * Requires an ordinary JSON object at one command field.
 */
export function requireCommandRecord(value, field, commandIndex) {
  if (!isRecord(value)) {
    throw commandError(
      `${field} must be a JSON object.`,
      commandIndex,
      field,
      "invalid-command-field",
    );
  }
  return cloneJson(value);
}

/**
 * Requires and bounds a command string.
 */
export function requireCommandString(
  value,
  field,
  commandIndex,
  { maximumLength = 2_000, allowEmpty = false } = {},
) {
  const normalized = String(value ?? "").trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximumLength) {
    throw commandError(
      `${field} must ${allowEmpty ? "be no longer than" : "contain between 1 and"} ${maximumLength} characters.`,
      commandIndex,
      field,
      "invalid-command-field",
    );
  }
  return normalized;
}

/**
 * Rejects fields outside an operation's documented contract.
 */
export function rejectUnknownCommandFields(command, allowedFields, commandIndex) {
  const allowed = new Set(["type", ...allowedFields]);
  const unknown = Object.keys(command).find((field) => !allowed.has(field));
  if (unknown) {
    throw commandError(
      `Unknown ${command.type} field: ${unknown}.`,
      commandIndex,
      unknown,
      "unknown-command-field",
    );
  }
}

function normalizeConfiguration(configuration) {
  if (!isRecord(configuration)) throw new TypeError("AI adapter configuration is required.");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(configuration.id ?? "")) {
    throw new TypeError("AI adapter configuration needs a stable lowercase id.");
  }
  if (typeof configuration.title !== "string" || !configuration.title.trim()) {
    throw new TypeError("AI adapter configuration needs a title.");
  }
  if (typeof configuration.getSnapshot !== "function") {
    throw new TypeError("AI adapter configuration needs getSnapshot().");
  }

  const commands = (Array.isArray(configuration.commands) ? configuration.commands : [])
    .map(normalizeCommandDefinition);
  if (!commands.length) throw new TypeError("AI adapter configuration needs commands.");
  if (new Set(commands.map((command) => command.type)).size !== commands.length) {
    throw new TypeError("AI command types must be unique within a tool.");
  }
  if (
    commands.some((command) => command.mutates)
    && typeof configuration.commitSnapshot !== "function"
  ) {
    throw new TypeError("Mutating AI commands require commitSnapshot().");
  }

  return {
    id: configuration.id,
    title: configuration.title.trim(),
    description: String(configuration.description ?? "").trim(),
    limitations: (Array.isArray(configuration.limitations)
      ? configuration.limitations
      : [])
      .map((limitation) => String(limitation).trim())
      .filter(Boolean),
    commands,
    getSnapshot: configuration.getSnapshot,
    getContext: typeof configuration.getContext === "function"
      ? configuration.getContext
      : null,
    commitSnapshot: configuration.commitSnapshot,
    undo: typeof configuration.undo === "function" ? configuration.undo : null,
    redo: typeof configuration.redo === "function" ? configuration.redo : null,
    exportTool: typeof configuration.exportTool === "function"
      ? configuration.exportTool
      : null,
  };
}

function normalizeCommandDefinition(definition) {
  if (!isRecord(definition) || !/^[a-z0-9][a-z0-9.-]*$/.test(definition.type ?? "")) {
    throw new TypeError("Each AI command needs a stable dotted type.");
  }
  if (typeof definition.execute !== "function") {
    throw new TypeError(`${definition.type} needs an execute function.`);
  }
  return {
    type: definition.type,
    description: String(definition.description ?? "").trim(),
    permissions: [...new Set((Array.isArray(definition.permissions)
      ? definition.permissions
      : []).map(String))],
    mutates: Boolean(definition.mutates),
    schema: definition.schema,
    example: definition.example,
    execute: definition.execute,
  };
}

function normalizeOperationOutcome(outcome, mutates) {
  if (outcome === undefined) return {};
  if (!isRecord(outcome)) {
    throw new TypeError("AI command operations must return a JSON object.");
  }
  if (mutates && outcome.state === undefined) {
    throw new TypeError("A mutating AI command must return its staged state.");
  }
  if (!mutates && outcome.state !== undefined) {
    throw new TypeError("A read-only AI command cannot return staged state.");
  }
  return {
    ...(outcome.state === undefined ? {} : { state: cloneJson(outcome.state) }),
    ...(outcome.value === undefined ? {} : { value: cloneJson(outcome.value) }),
    createdIds: normalizeIdentifierList(outcome.createdIds),
    updatedIds: normalizeIdentifierList(outcome.updatedIds),
    deletedIds: normalizeIdentifierList(outcome.deletedIds),
    warnings: normalizeStringList(outcome.warnings, 100),
  };
}

function createChangeSummary() {
  return {
    createdIds: [],
    updatedIds: [],
    deletedIds: [],
    warnings: [],
  };
}

function mergeChangeSummary(summary, outcome) {
  summary.createdIds = mergeUnique(summary.createdIds, outcome.createdIds);
  summary.updatedIds = mergeUnique(summary.updatedIds, outcome.updatedIds);
  summary.deletedIds = mergeUnique(summary.deletedIds, outcome.deletedIds);
  summary.warnings = mergeUnique(summary.warnings, outcome.warnings).slice(0, 100);
}

function mergeUnique(first, second) {
  return [...new Set([...(first ?? []), ...(second ?? [])])];
}

function normalizeIdentifierList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string" && item)
    .slice(0, 10_000))];
}

function normalizeStringList(value, limit) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, limit);
}

function serializeState(state) {
  try {
    const serialized = JSON.stringify(state);
    if (serialized === undefined) {
      throw new TypeError("The value has no JSON representation.");
    }
    return serialized;
  } catch (error) {
    throw new AiCommandError("The tool state is not JSON-serializable.", {
      code: "invalid-tool-state",
      recoverable: false,
      cause: error,
    });
  }
}

function assertContextSize(context) {
  const serialized = serializeState(context);
  const byteLength = typeof TextEncoder === "function"
    ? new TextEncoder().encode(serialized).byteLength
    : serialized.length;
  if (byteLength > MAXIMUM_CONTEXT_BYTES) {
    throw new AiCommandError("The requested context is too large.", {
      code: "context-too-large",
      recoverable: true,
    });
  }
}

function commandError(
  message,
  commandIndex,
  field,
  code,
  recoverable = true,
  cause = null,
) {
  return new AiCommandError(message, {
    code,
    commandIndex,
    path: field === null
      ? `$.commands[${commandIndex}]`
      : `$.commands[${commandIndex}].${field}`,
    recoverable,
    ...(cause ? { cause } : {}),
  });
}
