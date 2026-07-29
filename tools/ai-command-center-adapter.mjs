import { AiCommandError, cloneJson, isRecord } from "../app/ai-command-protocol.mjs";

const COMMANDS = Object.freeze([
  {
    type: "target.open",
    permissions: ["update"],
    description: "Open an allowlisted AI-capable tool in the command workspace.",
  },
  {
    type: "draft.set",
    permissions: ["update"],
    description: "Place an untrusted command draft in the editor without applying it.",
  },
  {
    type: "draft.clear",
    permissions: ["update"],
    description: "Clear the command draft and preview.",
  },
]);

export function createAiCommandCenterAdapter({
  getState,
  commit,
  allowedToolIds,
}) {
  const allowed = new Set(allowedToolIds);
  const read = () => normalizeState(getState());
  return {
    id: "ai-command-center",
    title: "AI Command Center",
    getRevision: () => read().revision,
    getCapabilities: () => ({
      tool: "ai-command-center",
      version: 1,
      commands: cloneJson(COMMANDS),
      note: "This adapter manages the command-center workspace only. Use each target tool's adapter for domain changes.",
    }),
    getContext: () => {
      const state = read();
      return {
        tool: "ai-command-center",
        revision: state.revision,
        targetToolId: state.targetToolId,
        hasDraft: Boolean(state.draft),
        previewOk: state.previewOk,
      };
    },
    preview: async (envelope) => {
      const currentState = read();
      const nextState = execute(currentState, envelope.commands, allowed);
      return { revision: currentState.revision, result: summarize(nextState) };
    },
    apply: async (envelope) => {
      const nextState = execute(read(), envelope.commands, allowed);
      const revision = await commit(nextState);
      return {
        revision,
        updatedIds: ["command-center-state"],
        result: summarize(nextState),
      };
    },
  };
}

function execute(source, commands, allowed) {
  const state = cloneJson(source);
  commands.forEach((command, commandIndex) => {
    if (command.type === "target.open") {
      const toolId = String(command.toolId ?? "");
      if (!allowed.has(toolId)) {
        throw commandError("Choose an allowlisted AI-capable tool.", "unknown-tool", commandIndex);
      }
      state.targetToolId = toolId;
      state.draft = "";
      state.previewOk = false;
    } else if (command.type === "draft.set") {
      if (!isRecord(command.envelope)) {
        throw commandError("draft.set requires an envelope object.", "invalid-draft", commandIndex);
      }
      state.draft = JSON.stringify(command.envelope, null, 2).slice(0, 1_000_000);
      state.previewOk = false;
    } else if (command.type === "draft.clear") {
      state.draft = "";
      state.previewOk = false;
    } else {
      throw commandError(`Unsupported command-center command: ${command.type}.`, "unsupported-command", commandIndex);
    }
  });
  state.revision += 1;
  return state;
}

function normalizeState(value) {
  return {
    revision: Number.isSafeInteger(value?.revision) ? value.revision : 0,
    targetToolId: String(value?.targetToolId ?? ""),
    draft: String(value?.draft ?? ""),
    previewOk: Boolean(value?.previewOk),
  };
}

function summarize(state) {
  return {
    targetToolId: state.targetToolId,
    hasDraft: Boolean(state.draft),
    previewOk: state.previewOk,
  };
}

function commandError(message, code, commandIndex) {
  return new AiCommandError(message, {
    code,
    commandIndex,
    path: `$.commands[${commandIndex}]`,
  });
}
