import {
  AiCommandError,
  assertAiPermissions,
  cloneJson,
  createAiCommandFailure,
  createAiCommandReceipt,
  normalizeAiCommandEnvelope,
} from "./ai-command-protocol.mjs";

const MAXIMUM_REMEMBERED_REQUESTS = 200;

/**
 * Creates one in-memory registry for the adapters available in a page.
 *
 * Adapters own domain validation and mutation. The registry owns transport
 * validation, permission checks, revisions, duplicate delivery, and receipts.
 */
export function createAiCommandRegistry() {
  const adapters = new Map();
  const appliedRequests = new Map();

  function register(adapter) {
    validateAdapter(adapter);
    if (adapters.has(adapter.id)) {
      throw new AiCommandError(`An adapter is already registered for ${adapter.id}.`, {
        code: "duplicate-adapter",
        recoverable: false,
      });
    }
    adapters.set(adapter.id, adapter);
    return () => adapters.delete(adapter.id);
  }

  function listTools() {
    return [...adapters.values()].map((adapter) => summarizeAdapter(adapter));
  }

  function getCapabilities(toolId) {
    const adapter = getAdapter(toolId);
    return cloneJson(adapter.getCapabilities());
  }

  async function getContext(toolId, options = {}) {
    const adapter = getAdapter(toolId);
    if (typeof adapter.getContext !== "function") return null;
    return cloneJson(await adapter.getContext(cloneJson(options)));
  }

  async function dispatch(candidate, options = {}) {
    let envelope;
    try {
      envelope = normalizeAiCommandEnvelope(candidate);
      const adapter = getAdapter(envelope.tool);
      assertAiPermissions(
        getRequiredPermissions(adapter, envelope.commands),
        options.grantedPermissions,
      );

      const signature = JSON.stringify(envelope);
      if (envelope.mode === "apply" && appliedRequests.has(envelope.requestId)) {
        const remembered = appliedRequests.get(envelope.requestId);
        if (remembered.signature !== signature) {
          throw new AiCommandError(
            "This requestId was already used for different command content.",
            { code: "request-id-conflict", path: "$.requestId" },
          );
        }
        return createAiCommandReceipt(envelope, {
          ...remembered.result,
          duplicate: true,
        });
      }

      assertExpectedRevision(adapter, envelope.expectedRevision);
      const operation = envelope.mode === "preview" ? adapter.preview : adapter.apply;
      if (typeof operation !== "function") {
        throw new AiCommandError(
          `${adapter.title} does not support ${envelope.mode}.`,
          { code: "unsupported-mode", path: "$.mode" },
        );
      }
      const result = await operation.call(adapter, cloneJson(envelope), {
        signal: options.signal,
        grantedPermissions: [...new Set(options.grantedPermissions ?? [])],
      });
      const receipt = createAiCommandReceipt(envelope, result);

      if (envelope.mode === "apply") {
        rememberAppliedRequest(appliedRequests, envelope.requestId, {
          signature,
          result: cloneJson(result),
        });
      }
      return receipt;
    } catch (error) {
      return createAiCommandFailure(error, envelope);
    }
  }

  async function undo(toolId) {
    const adapter = getAdapter(toolId);
    if (typeof adapter.undo !== "function") {
      throw new AiCommandError(`${adapter.title} does not support undo.`, {
        code: "undo-not-supported",
      });
    }
    return cloneJson(await adapter.undo());
  }

  async function redo(toolId) {
    const adapter = getAdapter(toolId);
    if (typeof adapter.redo !== "function") {
      throw new AiCommandError(`${adapter.title} does not support redo.`, {
        code: "redo-not-supported",
      });
    }
    return cloneJson(await adapter.redo());
  }

  async function exportTool(toolId, options = {}) {
    const adapter = getAdapter(toolId);
    if (typeof adapter.export !== "function") {
      throw new AiCommandError(`${adapter.title} does not support AI export.`, {
        code: "export-not-supported",
      });
    }
    return adapter.export(cloneJson(options));
  }

  function getAdapter(toolId) {
    const adapter = adapters.get(toolId);
    if (!adapter) {
      throw new AiCommandError(`No active AI adapter is registered for ${toolId}.`, {
        code: "tool-unavailable",
        path: "$.tool",
      });
    }
    return adapter;
  }

  return Object.freeze({
    register,
    listTools,
    getCapabilities,
    getContext,
    dispatch,
    undo,
    redo,
    exportTool,
  });
}

function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError("An AI tool adapter must be an object.");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(adapter.id ?? "")) {
    throw new TypeError("An AI tool adapter needs a stable lowercase id.");
  }
  if (typeof adapter.title !== "string" || !adapter.title.trim()) {
    throw new TypeError("An AI tool adapter needs a title.");
  }
  if (typeof adapter.getCapabilities !== "function") {
    throw new TypeError("An AI tool adapter must describe its capabilities.");
  }
  if (typeof adapter.preview !== "function" || typeof adapter.apply !== "function") {
    throw new TypeError("An AI tool adapter must implement preview and apply.");
  }
}

function summarizeAdapter(adapter) {
  const capabilities = adapter.getCapabilities();
  return {
    id: adapter.id,
    title: adapter.title,
    revision: readRevision(adapter),
    commands: Array.isArray(capabilities?.commands)
      ? capabilities.commands.map((command) => command.type)
      : [],
  };
}

function getRequiredPermissions(adapter, commands) {
  if (typeof adapter.getRequiredPermissions === "function") {
    return adapter.getRequiredPermissions(commands);
  }
  const definitions = new Map(
    (adapter.getCapabilities()?.commands ?? [])
      .map((command) => [command.type, command]),
  );
  return commands.flatMap((command, commandIndex) => {
    const definition = definitions.get(command.type);
    if (!definition) {
      throw new AiCommandError(`Unsupported command: ${command.type}.`, {
        code: "unsupported-command",
        path: `$.commands[${commandIndex}].type`,
        commandIndex,
      });
    }
    return definition.permissions ?? [];
  });
}

function assertExpectedRevision(adapter, expectedRevision) {
  if (expectedRevision === undefined) return;
  const currentRevision = readRevision(adapter);
  if (currentRevision !== expectedRevision) {
    throw new AiCommandError(
      `The tool changed after this command was prepared. Current revision: ${currentRevision}.`,
      {
        code: "stale-revision",
        path: "$.expectedRevision",
        details: { expectedRevision, currentRevision },
      },
    );
  }
}

function readRevision(adapter) {
  const revision = typeof adapter.getRevision === "function"
    ? Number(adapter.getRevision())
    : 0;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function rememberAppliedRequest(cache, requestId, entry) {
  cache.set(requestId, entry);
  while (cache.size > MAXIMUM_REMEMBERED_REQUESTS) {
    cache.delete(cache.keys().next().value);
  }
}
