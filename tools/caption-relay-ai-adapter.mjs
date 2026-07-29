/**
 * Provider-independent Caption Relay AI contract.
 *
 * The adapter validates semantic commands and delegates them to the page
 * controller. It never simulates clicks, returns caption-package bytes, or
 * attempts browser operations that require a direct user gesture.
 */

import {
  AI_PROTOCOL_VERSION,
  AiCommandError,
  assertAiPermissions,
  cloneJson,
  isRecord,
} from "../app/ai-command-protocol.mjs";

export const CAPTION_RELAY_AI_CONTRACT_VERSION = 1;

const TOOL_ID = "caption-relay";
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_CONTEXT_CUES = 500;
const MAX_CONTEXT_CUE_OFFSET = 100_000;
const CUE_CURSOR_PREFIX = "caption-relay-cues-v1:";
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{6,100}$/;
const CAPTURE_RATES = Object.freeze([1, 1.25, 1.5, 2]);
const DISPLAY_RATES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);
const TIMING_ADJUSTMENTS_MS = Object.freeze([-5000, -1000, -250, 250, 1000, 5000]);
const EXPORT_FORMATS = Object.freeze([
  "package",
  "vtt-vi",
  "srt-vi",
  "vtt-bilingual",
]);

const COMMAND_DEFINITIONS = Object.freeze([
  definition({
    type: "project.create",
    title: "Create a caption project",
    description: "Create a local Caption Relay project and configure its original timeline.",
    permissions: ["create"],
    fields: {
      title: stringSchema(1, 500),
      originalDurationMs: integerSchema(1, MAX_DURATION_MS),
      capturePlaybackRate: enumSchema(CAPTURE_RATES),
      transcriptionModel: enumSchema(["tiny", "small"]),
    },
    required: ["title", "originalDurationMs", "capturePlaybackRate"],
    example: {
      type: "project.create",
      title: "Accessibility copy",
      originalDurationMs: 7_200_000,
      capturePlaybackRate: 1.5,
      transcriptionModel: "tiny",
    },
    normalize: normalizeProjectCreate,
  }),
  definition({
    type: "project.activate",
    title: "Activate a project",
    description: "Open one existing local project in the integrated pipeline.",
    permissions: ["update"],
    fields: { projectId: projectIdSchema() },
    required: ["projectId"],
    example: { type: "project.activate", projectId: "caption_example1" },
    normalize: (command, index) => ({
      type: command.type,
      projectId: requireProjectId(command.projectId, index, "projectId"),
    }),
  }),
  definition({
    type: "project.rename",
    title: "Rename a project",
    description: "Rename a saved local project without changing its caption package.",
    permissions: ["update"],
    fields: {
      projectId: projectIdSchema(),
      name: stringSchema(1, 500),
    },
    required: ["projectId", "name"],
    example: {
      type: "project.rename",
      projectId: "caption_example1",
      name: "Final Vietnamese captions",
    },
    normalize: normalizeProjectRename,
  }),
  definition({
    type: "project.duplicate",
    title: "Duplicate a project",
    description: "Create a local copy while retaining every cue and timestamp.",
    permissions: ["create"],
    fields: {
      projectId: projectIdSchema(),
      name: stringSchema(1, 500),
    },
    required: ["projectId"],
    example: { type: "project.duplicate", projectId: "caption_example1" },
    normalize: normalizeProjectDuplicate,
  }),
  definition({
    type: "project.delete",
    title: "Delete a project",
    description: "Delete one explicitly identified Caption Relay project.",
    permissions: ["delete"],
    fields: {
      projectId: projectIdSchema(),
      confirm: { const: true },
    },
    required: ["projectId", "confirm"],
    example: {
      type: "project.delete",
      projectId: "caption_example1",
      confirm: true,
    },
    normalize: normalizeProjectDelete,
  }),
  definition({
    type: "project.update-metadata",
    title: "Update capture metadata",
    description: "Update movie title, duration, fixed capture speed, or speech-model choice.",
    permissions: ["update"],
    fields: {
      title: stringSchema(1, 500),
      originalDurationMs: integerSchema(1, MAX_DURATION_MS),
      capturePlaybackRate: enumSchema(CAPTURE_RATES),
      transcriptionModel: enumSchema(["tiny", "small"]),
    },
    example: {
      type: "project.update-metadata",
      capturePlaybackRate: 1.5,
      transcriptionModel: "small",
    },
    normalize: normalizeProjectMetadata,
  }),
  definition({
    type: "stage.select",
    title: "Select a pipeline stage",
    description: "Show Capture, Translate, or Display without simulating a click.",
    permissions: ["update"],
    fields: { stage: enumSchema(["capture", "translate", "display"]) },
    required: ["stage"],
    example: { type: "stage.select", stage: "translate" },
    normalize: (command, index) => ({
      type: command.type,
      stage: requireEnum(command.stage, ["capture", "translate", "display"], index, "stage"),
    }),
  }),
  definition({
    type: "cue.update",
    title: "Edit one caption cue",
    description: "Edit English and/or Vietnamese text while preserving the cue ID and timestamps.",
    permissions: ["update"],
    fields: {
      cueId: stringSchema(1, 100),
      sourceText: stringSchema(0, MAX_TEXT_LENGTH),
      vietnameseText: stringSchema(0, MAX_TEXT_LENGTH),
    },
    required: ["cueId"],
    example: {
      type: "cue.update",
      cueId: "cue-000042",
      vietnameseText: "Chúng ta đi thôi.",
    },
    normalize: normalizeCueUpdate,
  }),
  definition({
    type: "timeline.correct",
    title: "Correct the caption timeline",
    description: "Apply a global offset and/or scale without changing cue IDs or text.",
    permissions: ["update"],
    fields: {
      offsetMs: integerSchema(-MAX_DURATION_MS, MAX_DURATION_MS),
      scale: numberSchema(0.5, 2),
      anchorMs: integerSchema(0, MAX_DURATION_MS),
    },
    example: {
      type: "timeline.correct",
      offsetMs: 250,
      scale: 1.0004,
      anchorMs: 0,
    },
    normalize: normalizeTimelineCorrection,
  }),
  definition({
    type: "translation.configure",
    title: "Configure Vietnamese translation",
    description: "Set literal or natural Vietnamese and an optional project-level pronoun note.",
    permissions: ["update"],
    fields: {
      style: enumSchema(["literal", "natural"]),
      pronounPreference: stringSchema(0, 500),
    },
    example: {
      type: "translation.configure",
      style: "natural",
      pronounPreference: "Use chị/em for the two sisters.",
    },
    normalize: normalizeTranslationConfiguration,
  }),
  definition({
    type: "translation.search-replace",
    title: "Search and replace Vietnamese text",
    description: "Replace repeated Vietnamese terminology across retained target cues.",
    permissions: ["update"],
    fields: {
      search: stringSchema(1, 500),
      replacement: stringSchema(0, 2_000),
      caseSensitive: { type: "boolean" },
    },
    required: ["search", "replacement"],
    example: {
      type: "translation.search-replace",
      search: "Thành phố Hồ Chí Minh",
      replacement: "Sài Gòn",
      caseSensitive: false,
    },
    normalize: normalizeTranslationReplacement,
  }),
  definition({
    type: "translation.run",
    title: "Control the local translation queue",
    description: "Start, pause, resume, retry failures, or regenerate selected Vietnamese cues locally.",
    permissions: ["update"],
    fields: {
      action: enumSchema([
        "translate-all",
        "pause",
        "resume",
        "retry-failed",
        "regenerate-cues",
      ]),
      cueIds: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        uniqueItems: true,
        items: stringSchema(1, 100),
      },
    },
    required: ["action"],
    example: {
      type: "translation.run",
      action: "regenerate-cues",
      cueIds: ["cue-000042"],
    },
    normalize: normalizeTranslationRun,
  }),
  definition({
    type: "glossary.upsert",
    title: "Add or update glossary entries",
    description: "Batch preferred English-to-Vietnamese names, places, titles, or phrasing.",
    permissions: ["update"],
    fields: {
      entries: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["source", "target"],
          properties: {
            source: stringSchema(1, 500),
            target: stringSchema(0, 500),
          },
        },
      },
    },
    required: ["entries"],
    example: {
      type: "glossary.upsert",
      entries: [
        { source: "Captain", target: "Đại úy" },
        { source: "Mai", target: "Mai" },
      ],
    },
    normalize: normalizeGlossaryUpsert,
  }),
  definition({
    type: "glossary.remove",
    title: "Remove glossary entries",
    description: "Remove glossary entries by their English source term.",
    permissions: ["update"],
    fields: {
      sources: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
        items: stringSchema(1, 500),
      },
    },
    required: ["sources"],
    example: { type: "glossary.remove", sources: ["Captain"] },
    normalize: normalizeGlossaryRemove,
  }),
  definition({
    type: "model.prepare",
    title: "Prepare a local model",
    description: "Download and initialize a pinned local speech or fallback translation model.",
    permissions: ["update"],
    fields: {
      kind: enumSchema(["transcription", "translation"]),
      model: enumSchema(["tiny", "small"]),
    },
    required: ["kind"],
    example: { type: "model.prepare", kind: "transcription", model: "tiny" },
    normalize: normalizeModelPrepare,
  }),
  definition({
    type: "model.clear-cache",
    title: "Clear downloaded model files",
    description: "Remove Caption Relay model files where browser cache controls permit.",
    permissions: ["delete"],
    fields: { confirm: { const: true } },
    required: ["confirm"],
    example: { type: "model.clear-cache", confirm: true },
    normalize: (command, index) => {
      requireTrue(command.confirm, index, "confirm");
      return { type: command.type, confirm: true };
    },
  }),
  definition({
    type: "capture.finish",
    title: "Finish an active capture",
    description: "Stop capture early and retain recoverable partial progress; starting capture remains human-only.",
    permissions: ["update"],
    fields: { confirm: { const: true } },
    required: ["confirm"],
    example: { type: "capture.finish", confirm: true },
    normalize: (command, index) => {
      requireTrue(command.confirm, index, "confirm");
      return { type: command.type, confirm: true };
    },
  }),
  definition({
    type: "sync.control",
    title: "Control caption synchronization",
    description: "Apply a supported manual timing, playback-rate, or synchronization state action.",
    permissions: ["update"],
    fields: {
      action: enumSchema([
        "resynchronize",
        "set-current-time",
        "adjust",
        "pause",
        "resume",
        "reset",
        "set-playback-rate",
      ]),
      value: numberSchema(-MAX_DURATION_MS, MAX_DURATION_MS),
    },
    required: ["action"],
    example: { type: "sync.control", action: "adjust", value: 250 },
    normalize: normalizeSyncControl,
  }),
  definition({
    type: "overlay.configure",
    title: "Configure caption appearance",
    description: "Update locally remembered overlay preferences without opening an overlay window.",
    permissions: ["update"],
    fields: {
      fontFamily: enumSchema(["Georgia, serif", "Arial, sans-serif", "monospace"]),
      fontSizePx: integerSchema(16, 80),
      color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      background: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      verticalPlacement: enumSchema(["top", "middle", "bottom"]),
      bilingual: { type: "boolean" },
    },
    example: {
      type: "overlay.configure",
      fontSizePx: 42,
      verticalPlacement: "bottom",
      bilingual: true,
    },
    normalize: normalizeOverlayConfiguration,
  }),
  definition({
    type: "display.stop",
    title: "Stop display resources",
    description: "Explicitly close or disconnect one or more active Caption Relay display resources.",
    permissions: ["update"],
    fields: {
      closeOverlay: { type: "boolean" },
      disconnectAudio: { type: "boolean" },
      disconnectMirror: { type: "boolean" },
    },
    example: {
      type: "display.stop",
      closeOverlay: true,
      disconnectAudio: true,
    },
    normalize: normalizeDisplayStop,
  }),
]);

const DEFINITIONS_BY_TYPE = new Map(
  COMMAND_DEFINITIONS.map((command) => [command.type, command]),
);

const HUMAN_ACTIONS = Object.freeze([
  {
    id: "package.select-file",
    title: "Choose a caption file",
    reason: "The user must explicitly choose local package, SRT, or VTT content.",
  },
  {
    id: "capture.start",
    title: "Start Capture",
    reason: "getDisplayMedia and tab-audio selection require a direct user gesture.",
  },
  {
    id: "overlay.open",
    title: "Open Caption Overlay",
    reason: "Document Picture-in-Picture or popup opening requires a direct user gesture.",
  },
  {
    id: "display.connect-audio",
    title: "Connect Movie Audio",
    reason: "Shared-tab audio capture requires a separate direct user gesture.",
  },
  {
    id: "mirror.start",
    title: "Start Mirror Mode",
    reason: "Captured video and audio selection require a direct user gesture.",
  },
  {
    id: "mirror.fullscreen",
    title: "Enter Mirror Mode fullscreen",
    reason: "Fullscreen entry requires a direct user gesture.",
  },
]);

const CAPABILITIES = deepFreeze({
  contractVersion: CAPTION_RELAY_AI_CONTRACT_VERSION,
  protocolVersion: AI_PROTOCOL_VERSION,
  tool: TOOL_ID,
  title: "Caption Relay",
  description: "One local-first Capture → Translate → Display caption pipeline.",
  context: {
    summaryPermission: "read-summary",
    cueTextPermission: "read-content",
    maximumCueTextEntries: MAX_CONTEXT_CUES,
    defaultExcludesCueText: true,
    cuePagination: {
      offsetOption: "cueOffset",
      cursorOption: "cueCursor",
      responseField: "cuePagination",
      cursorVersion: 1,
    },
  },
  commands: COMMAND_DEFINITIONS.map((command) => ({
    type: command.type,
    title: command.title,
    description: command.description,
    permissions: command.permissions,
    previewable: true,
    inputSchema: command.inputSchema,
    example: command.example,
  })),
  exports: {
    permissions: ["export"],
    formats: EXPORT_FORMATS,
    behavior: "Creates a local browser download; caption or package bytes are not returned to the AI provider.",
  },
  models: [
    {
      purpose: "English speech recognition",
      runtime: "@huggingface/transformers@3.8.1",
      id: "onnx-community/whisper-tiny.en",
      revision: "2575352",
      license: "Apache-2.0",
    },
    {
      purpose: "Higher-quality English speech recognition",
      runtime: "@huggingface/transformers@3.8.1",
      id: "Xenova/whisper-small.en",
      revision: "529f2fb",
      license: "Apache-2.0",
    },
    {
      purpose: "English to Vietnamese fallback translation",
      runtime: "@huggingface/transformers@3.8.1",
      id: "Xenova/opus-mt-en-vi",
      revision: "30bcd46",
      license: "Apache-2.0",
    },
  ],
  humanActions: HUMAN_ACTIONS,
  privacy: {
    localProjectDataOnly: true,
    returnsRawMedia: false,
    returnsCaptionPackageBytes: false,
    storesRawMedia: false,
    hiddenNetworkInference: false,
  },
  examples: [
    {
      protocolVersion: AI_PROTOCOL_VERSION,
      requestId: "caption-create-preview",
      tool: TOOL_ID,
      mode: "preview",
      commands: [COMMAND_DEFINITIONS[0].example],
    },
    {
      protocolVersion: AI_PROTOCOL_VERSION,
      requestId: "caption-terminology-apply",
      tool: TOOL_ID,
      mode: "apply",
      commands: [
        COMMAND_DEFINITIONS.find((command) => command.type === "glossary.upsert").example,
        COMMAND_DEFINITIONS.find((command) => command.type === "translation.search-replace").example,
      ],
    },
  ],
});

/**
 * Creates a Caption Relay adapter over the page's semantic controller.
 *
 * Required controller methods:
 * - getRevision()
 * - getAiSnapshot({ includeCueText, cueLimit, cueOffset })
 * - applyAiCommands(commands, { signal })
 * - exportAi({ format, projectId, filename, signal })
 *
 * previewAiCommands(commands, { signal }) is optional and must not mutate.
 */
export function createCaptionRelayAiAdapter(controller) {
  validateController(controller);

  return Object.freeze({
    id: TOOL_ID,
    title: "Caption Relay",
    getRevision: () => normalizeRevision(controller.getRevision()),
    getCapabilities: () => CAPABILITIES,
    getRequiredPermissions: (commands) => requiredPermissions(commands),
    getContext: (options = {}) => getContext(controller, options),
    preview: (envelope, options = {}) => previewCommands(controller, envelope, options),
    apply: (envelope, options = {}) => applyCommands(controller, envelope, options),
    export: (options = {}) => exportCaptionProject(controller, options),
  });
}

export function normalizeCaptionRelayAiCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new AiCommandError("Provide at least one Caption Relay command.", {
      code: "empty-command-list",
      path: "$.commands",
    });
  }
  return commands.map((command, commandIndex) => {
    if (!isRecord(command)) {
      throw commandError("Each Caption Relay command must be an object.", commandIndex);
    }
    const definitionEntry = DEFINITIONS_BY_TYPE.get(command.type);
    if (!definitionEntry) {
      throw commandError(
        `Unsupported Caption Relay command: ${String(command.type)}.`,
        commandIndex,
        "type",
        "unsupported-command",
      );
    }
    assertOnlyFields(command, Object.keys(definitionEntry.inputSchema.properties), commandIndex);
    definitionEntry.inputSchema.required.forEach((field) => {
      if (command[field] === undefined) {
        throw commandError(`${field} is required.`, commandIndex, field);
      }
    });
    return definitionEntry.normalize(command, commandIndex);
  });
}

async function getContext(controller, options) {
  if (!isRecord(options)) {
    throw new AiCommandError("Caption Relay context options must be an object.", {
      code: "invalid-context-options",
    });
  }
  assertOnlyOptionFields(options, [
    "includeCueText",
    "cueLimit",
    "cueOffset",
    "cueCursor",
    "grantedPermissions",
  ]);
  const includeCueText = options.includeCueText === true;
  if (options.includeCueText !== undefined && typeof options.includeCueText !== "boolean") {
    throw new AiCommandError("includeCueText must be a boolean.", {
      code: "invalid-context-options",
      path: "$.includeCueText",
    });
  }
  const cueLimit = options.cueLimit === undefined
    ? 100
    : requireContextCueLimit(options.cueLimit);
  if (options.cueOffset !== undefined && options.cueCursor !== undefined) {
    throw new AiCommandError("Use cueOffset or cueCursor, not both.", {
      code: "invalid-context-options",
      path: "$.cueCursor",
    });
  }
  const cueOffset = options.cueCursor !== undefined
    ? decodeCueCursor(options.cueCursor)
    : options.cueOffset === undefined
      ? 0
      : requireContextCueOffset(options.cueOffset);
  assertAiPermissions(
    includeCueText ? ["read-summary", "read-content"] : ["read-summary"],
    options.grantedPermissions,
  );
  const snapshot = await controller.getAiSnapshot({ includeCueText, cueLimit, cueOffset });
  return sanitizeContext(snapshot, { includeCueText, cueLimit, cueOffset });
}

async function previewCommands(controller, envelope, options) {
  const commands = normalizeCaptionRelayAiCommands(envelope.commands);
  let warnings = [];
  if (typeof controller.previewAiCommands === "function") {
    const result = await controller.previewAiCommands(cloneJson(commands), {
      signal: options.signal,
    });
    warnings = normalizeWarnings(result?.warnings);
  }
  return {
    revision: normalizeRevision(controller.getRevision()),
    warnings,
    result: {
      commandCount: commands.length,
      effects: commands.map(describeCommandEffect),
      willMutate: false,
    },
  };
}

async function applyCommands(controller, envelope, options) {
  const commands = normalizeCaptionRelayAiCommands(envelope.commands);
  const result = await controller.applyAiCommands(cloneJson(commands), {
    signal: options.signal,
    expectedRevision: envelope.expectedRevision,
  });
  return sanitizeApplyResult(result, commands, controller.getRevision());
}

async function exportCaptionProject(controller, options) {
  if (!isRecord(options)) {
    throw new AiCommandError("Caption Relay export options must be an object.", {
      code: "invalid-export-options",
    });
  }
  assertOnlyOptionFields(options, [
    "format",
    "projectId",
    "filename",
    "grantedPermissions",
    "signal",
  ]);
  assertAiPermissions(["export"], options.grantedPermissions);
  const format = requireEnum(
    options.format ?? "package",
    EXPORT_FORMATS,
    null,
    "format",
    "invalid-export-options",
  );
  const projectId = options.projectId === undefined
    ? undefined
    : requireProjectId(options.projectId, null, "projectId", "invalid-export-options");
  const filename = options.filename === undefined
    ? undefined
    : requireFilename(options.filename);
  const result = await controller.exportAi({
    format,
    ...(projectId ? { projectId } : {}),
    ...(filename ? { filename } : {}),
    signal: options.signal,
  });
  return {
    ok: result?.downloaded !== false,
    format,
    filename: safeString(result?.filename, 300),
    size: Number.isSafeInteger(result?.size) && result.size >= 0 ? result.size : null,
    downloaded: result?.downloaded !== false,
    warning: safeString(result?.warning, 500),
  };
}

function requiredPermissions(commands) {
  if (!Array.isArray(commands)) return [];
  return commands.flatMap((command, commandIndex) => {
    const definitionEntry = DEFINITIONS_BY_TYPE.get(command?.type);
    if (!definitionEntry) {
      throw commandError(
        `Unsupported Caption Relay command: ${String(command?.type)}.`,
        commandIndex,
        "type",
        "unsupported-command",
      );
    }
    return definitionEntry.permissions;
  });
}

function sanitizeContext(snapshot, { includeCueText, cueLimit, cueOffset }) {
  const source = isRecord(snapshot) ? snapshot : {};
  const activeProject = isRecord(source.activeProject) ? source.activeProject : {};
  const packageValue = isRecord(activeProject.package)
    ? activeProject.package
    : isRecord(source.package)
      ? source.package
      : {};
  const cues = Array.isArray(packageValue.cues)
    ? packageValue.cues
    : Array.isArray(source.cues)
      ? source.cues
      : [];
  const translationCounts = countTranslations(cues);

  const context = {
    tool: TOOL_ID,
    revision: normalizeRevision(source.revision),
    stage: allowedOrNull(source.stage, ["capture", "translate", "display"]),
    activeProject: activeProject.id
      ? {
          id: safeString(activeProject.id, 100),
          name: safeString(activeProject.name ?? activeProject.title ?? packageValue.title, 500),
          status: safeString(activeProject.status, 40),
          cueCount: Number.isSafeInteger(activeProject.cueCount)
            ? activeProject.cueCount
            : cues.length,
          translatedCount: Number.isSafeInteger(activeProject.translatedCount)
            ? activeProject.translatedCount
            : translationCounts.translated,
          failedTranslationCount: Number.isSafeInteger(activeProject.failedTranslationCount)
            ? activeProject.failedTranslationCount
            : translationCounts.failed,
        }
      : null,
    projects: sanitizeProjects(source.projects),
    capture: sanitizeCaptureSummary(source.capture),
    translation: sanitizeTranslationSummary(source.translation),
    synchronization: sanitizeSynchronizationSummary(source.synchronization ?? source.sync),
    overlay: sanitizeOverlaySummary(source.overlay),
  };

  if (includeCueText) {
    const pageEnd = Math.min(cues.length, cueOffset + cueLimit);
    const previousOffset = cueOffset > 0
      ? Math.max(0, cueOffset - cueLimit)
      : null;
    const nextOffset = pageEnd < cues.length ? pageEnd : null;
    context.cues = cues.slice(cueOffset, pageEnd).map(sanitizeCue);
    context.cuesTruncated = cueOffset > 0 || pageEnd < cues.length;
    context.cuePagination = {
      offset: cueOffset,
      limit: cueLimit,
      returned: context.cues.length,
      total: cues.length,
      hasPrevious: previousOffset !== null,
      hasNext: nextOffset !== null,
      previousOffset,
      nextOffset,
      previousCursor: previousOffset === null ? null : encodeCueCursor(previousOffset),
      nextCursor: nextOffset === null ? null : encodeCueCursor(nextOffset),
    };
  }
  return context;
}

function sanitizeProjects(projects) {
  if (!Array.isArray(projects)) return [];
  return projects.slice(0, 200).map((project) => ({
    id: safeString(project?.id, 100),
    name: safeString(project?.name ?? project?.title, 500),
    status: safeString(project?.status, 40),
    updatedAt: safeString(project?.updatedAt, 40),
    cueCount: nonNegativeIntegerOrNull(project?.cueCount),
    translatedCount: nonNegativeIntegerOrNull(project?.translatedCount),
  }));
}

function sanitizeCaptureSummary(capture) {
  const source = isRecord(capture) ? capture : {};
  return {
    state: safeString(source.state, 40),
    processedSamples: nonNegativeIntegerOrNull(source.processedSamples),
    elapsedMs: nonNegativeIntegerOrNull(source.elapsedMs),
    queueLength: nonNegativeIntegerOrNull(source.queueLength),
    modelState: safeString(source.modelState, 40),
    recoveryAvailable: Boolean(source.recoveryAvailable),
  };
}

function sanitizeTranslationSummary(translation) {
  const source = isRecord(translation) ? translation : {};
  return {
    state: safeString(source.state, 40),
    completed: nonNegativeIntegerOrNull(source.completed),
    failed: nonNegativeIntegerOrNull(source.failed),
    total: nonNegativeIntegerOrNull(source.total),
    style: allowedOrNull(source.style ?? source.mode, ["literal", "natural"]),
    modelState: safeString(source.modelState, 40),
  };
}

function sanitizeSynchronizationSummary(sync) {
  const source = isRecord(sync) ? sync : {};
  return {
    state: safeString(source.state, 40),
    mode: allowedOrNull(source.mode, ["fingerprint", "text", "fingerprint-or-text"]),
    confidence: finiteInRangeOrNull(source.confidence, 0, 1),
    movieTimeMs: nonNegativeIntegerOrNull(source.movieTimeMs),
    captionsVisible: Boolean(source.captionsVisible ?? source.showCaptions),
  };
}

function sanitizeOverlaySummary(overlay) {
  const source = isRecord(overlay) ? overlay : {};
  return {
    open: Boolean(source.open),
    mode: safeString(source.mode, 50),
    bilingual: Boolean(source.bilingual),
    verticalPlacement: allowedOrNull(
      source.verticalPlacement,
      ["top", "middle", "bottom"],
    ),
  };
}

function sanitizeCue(cue) {
  return {
    id: safeString(cue?.id, 100),
    startMs: nonNegativeIntegerOrNull(cue?.startMs),
    endMs: nonNegativeIntegerOrNull(cue?.endMs),
    sourceText: safeString(cue?.sourceText, MAX_TEXT_LENGTH),
    vietnameseText: safeString(cue?.translations?.vi, MAX_TEXT_LENGTH),
    confidence: finiteInRangeOrNull(cue?.confidence, 0, 1),
    translationStatus: safeString(cue?.translationStatus, 40),
  };
}

function sanitizeApplyResult(result, commands, fallbackRevision) {
  const source = isRecord(result) ? result : {};
  return {
    revision: normalizeRevision(source.revision ?? fallbackRevision),
    createdIds: normalizeIds(source.createdIds),
    updatedIds: normalizeIds(source.updatedIds),
    deletedIds: normalizeIds(source.deletedIds),
    warnings: normalizeWarnings(source.warnings),
    undoGroupId: safeString(source.undoGroupId, 128),
    result: {
      commandCount: commands.length,
      effects: commands.map(describeCommandEffect),
      applied: true,
    },
  };
}

function describeCommandEffect(command) {
  let target = "Caption Relay";
  switch (command.type) {
    case "project.create": target = "new local project"; break;
    case "project.activate":
    case "project.rename":
    case "project.duplicate":
    case "project.delete": target = command.projectId; break;
    case "project.update-metadata": target = "active project metadata"; break;
    case "stage.select": target = command.stage; break;
    case "cue.update": target = command.cueId; break;
    case "timeline.correct": target = "all retained cues"; break;
    case "translation.configure": target = "active project translation settings"; break;
    case "translation.search-replace": target = "Vietnamese cue text"; break;
    case "translation.run":
    case "sync.control": target = command.action; break;
    case "glossary.upsert": target = `${command.entries.length} glossary entries`; break;
    case "glossary.remove": target = `${command.sources.length} glossary entries`; break;
    case "model.prepare": target = `${command.kind} model`; break;
    case "model.clear-cache": target = "downloaded Caption Relay models"; break;
    case "capture.finish": target = "active capture"; break;
    case "overlay.configure": target = "overlay settings"; break;
    case "display.stop": target = "active display resources"; break;
  }
  return { type: command.type, target };
}

function normalizeProjectCreate(command, index) {
  return {
    type: command.type,
    title: requireString(command.title, 1, 500, index, "title").trim(),
    originalDurationMs: requireInteger(
      command.originalDurationMs,
      1,
      MAX_DURATION_MS,
      index,
      "originalDurationMs",
    ),
    capturePlaybackRate: requireEnum(
      command.capturePlaybackRate,
      CAPTURE_RATES,
      index,
      "capturePlaybackRate",
    ),
    transcriptionModel: command.transcriptionModel === undefined
      ? "tiny"
      : requireEnum(command.transcriptionModel, ["tiny", "small"], index, "transcriptionModel"),
  };
}

function normalizeProjectRename(command, index) {
  return {
    type: command.type,
    projectId: requireProjectId(command.projectId, index, "projectId"),
    name: requireString(command.name, 1, 500, index, "name").trim(),
  };
}

function normalizeProjectDuplicate(command, index) {
  return {
    type: command.type,
    projectId: requireProjectId(command.projectId, index, "projectId"),
    ...(command.name === undefined
      ? {}
      : { name: requireString(command.name, 1, 500, index, "name").trim() }),
  };
}

function normalizeProjectDelete(command, index) {
  requireTrue(command.confirm, index, "confirm");
  return {
    type: command.type,
    projectId: requireProjectId(command.projectId, index, "projectId"),
    confirm: true,
  };
}

function normalizeProjectMetadata(command, index) {
  requireAtLeastOne(command, [
    "title",
    "originalDurationMs",
    "capturePlaybackRate",
    "transcriptionModel",
  ], index);
  return compact({
    type: command.type,
    title: command.title === undefined
      ? undefined
      : requireString(command.title, 1, 500, index, "title").trim(),
    originalDurationMs: command.originalDurationMs === undefined
      ? undefined
      : requireInteger(
        command.originalDurationMs,
        1,
        MAX_DURATION_MS,
        index,
        "originalDurationMs",
      ),
    capturePlaybackRate: command.capturePlaybackRate === undefined
      ? undefined
      : requireEnum(command.capturePlaybackRate, CAPTURE_RATES, index, "capturePlaybackRate"),
    transcriptionModel: command.transcriptionModel === undefined
      ? undefined
      : requireEnum(command.transcriptionModel, ["tiny", "small"], index, "transcriptionModel"),
  });
}

function normalizeCueUpdate(command, index) {
  requireAtLeastOne(command, ["sourceText", "vietnameseText"], index);
  return compact({
    type: command.type,
    cueId: requireCueId(command.cueId, index),
    sourceText: command.sourceText === undefined
      ? undefined
      : requireString(command.sourceText, 0, MAX_TEXT_LENGTH, index, "sourceText"),
    vietnameseText: command.vietnameseText === undefined
      ? undefined
      : requireString(command.vietnameseText, 0, MAX_TEXT_LENGTH, index, "vietnameseText"),
  });
}

function normalizeTimelineCorrection(command, index) {
  requireAtLeastOne(command, ["offsetMs", "scale", "anchorMs"], index);
  return {
    type: command.type,
    offsetMs: command.offsetMs === undefined
      ? 0
      : requireInteger(command.offsetMs, -MAX_DURATION_MS, MAX_DURATION_MS, index, "offsetMs"),
    scale: command.scale === undefined
      ? 1
      : requireNumber(command.scale, 0.5, 2, index, "scale"),
    anchorMs: command.anchorMs === undefined
      ? 0
      : requireInteger(command.anchorMs, 0, MAX_DURATION_MS, index, "anchorMs"),
  };
}

function normalizeTranslationConfiguration(command, index) {
  requireAtLeastOne(command, ["style", "pronounPreference"], index);
  return compact({
    type: command.type,
    style: command.style === undefined
      ? undefined
      : requireEnum(command.style, ["literal", "natural"], index, "style"),
    pronounPreference: command.pronounPreference === undefined
      ? undefined
      : requireString(command.pronounPreference, 0, 500, index, "pronounPreference"),
  });
}

function normalizeTranslationReplacement(command, index) {
  return {
    type: command.type,
    search: requireString(command.search, 1, 500, index, "search"),
    replacement: requireString(command.replacement, 0, 2_000, index, "replacement"),
    caseSensitive: command.caseSensitive === undefined
      ? false
      : requireBoolean(command.caseSensitive, index, "caseSensitive"),
  };
}

function normalizeTranslationRun(command, index) {
  const action = requireEnum(command.action, [
    "translate-all",
    "pause",
    "resume",
    "retry-failed",
    "regenerate-cues",
  ], index, "action");
  if (action !== "regenerate-cues" && command.cueIds !== undefined) {
    throw commandError("cueIds is only valid for regenerate-cues.", index, "cueIds");
  }
  if (action === "regenerate-cues") {
    return {
      type: command.type,
      action,
      cueIds: requireUniqueStrings(command.cueIds, 1, 500, 100, index, "cueIds"),
    };
  }
  return { type: command.type, action };
}

function normalizeGlossaryUpsert(command, index) {
  if (!Array.isArray(command.entries) || command.entries.length < 1 || command.entries.length > 100) {
    throw commandError("entries must contain 1 to 100 glossary entries.", index, "entries");
  }
  const entries = command.entries.map((entry, entryIndex) => {
    if (!isRecord(entry)) {
      throw commandError("Each glossary entry must be an object.", index, `entries[${entryIndex}]`);
    }
    const unknown = Object.keys(entry).find((field) => !["source", "target"].includes(field));
    if (unknown) {
      throw commandError(
        `Unknown glossary-entry field: ${unknown}.`,
        index,
        `entries[${entryIndex}].${unknown}`,
      );
    }
    return {
      source: requireString(
        entry.source,
        1,
        500,
        index,
        `entries[${entryIndex}].source`,
      ).trim(),
      target: requireString(
        entry.target,
        0,
        500,
        index,
        `entries[${entryIndex}].target`,
      ),
    };
  });
  if (new Set(entries.map((entry) => entry.source.toLocaleLowerCase())).size !== entries.length) {
    throw commandError("Glossary source terms must be unique within a batch.", index, "entries");
  }
  return { type: command.type, entries };
}

function normalizeGlossaryRemove(command, index) {
  return {
    type: command.type,
    sources: requireUniqueStrings(command.sources, 1, 100, 500, index, "sources")
      .map((source) => source.trim()),
  };
}

function normalizeModelPrepare(command, index) {
  const kind = requireEnum(command.kind, ["transcription", "translation"], index, "kind");
  if (kind === "translation" && command.model !== undefined) {
    throw commandError("The translation fallback model is pinned and does not accept model.", index, "model");
  }
  return {
    type: command.type,
    kind,
    ...(kind === "transcription"
      ? {
          model: command.model === undefined
            ? "tiny"
            : requireEnum(command.model, ["tiny", "small"], index, "model"),
        }
      : {}),
  };
}

function normalizeSyncControl(command, index) {
  const action = requireEnum(command.action, [
    "resynchronize",
    "set-current-time",
    "adjust",
    "pause",
    "resume",
    "reset",
    "set-playback-rate",
  ], index, "action");
  if (["set-current-time", "adjust", "set-playback-rate"].includes(action)
    && command.value === undefined) {
    throw commandError(`value is required for ${action}.`, index, "value");
  }
  if (!["set-current-time", "adjust", "set-playback-rate"].includes(action)
    && command.value !== undefined) {
    throw commandError(`value is not valid for ${action}.`, index, "value");
  }
  if (action === "set-current-time") {
    return {
      type: command.type,
      action,
      value: requireInteger(command.value, 0, MAX_DURATION_MS, index, "value"),
    };
  }
  if (action === "adjust") {
    return {
      type: command.type,
      action,
      value: requireEnum(command.value, TIMING_ADJUSTMENTS_MS, index, "value"),
    };
  }
  if (action === "set-playback-rate") {
    return {
      type: command.type,
      action,
      value: requireEnum(command.value, DISPLAY_RATES, index, "value"),
    };
  }
  return { type: command.type, action };
}

function normalizeOverlayConfiguration(command, index) {
  const fields = [
    "fontFamily",
    "fontSizePx",
    "color",
    "background",
    "verticalPlacement",
    "bilingual",
  ];
  requireAtLeastOne(command, fields, index);
  return compact({
    type: command.type,
    fontFamily: command.fontFamily === undefined
      ? undefined
      : requireEnum(
        command.fontFamily,
        ["Georgia, serif", "Arial, sans-serif", "monospace"],
        index,
        "fontFamily",
      ),
    fontSizePx: command.fontSizePx === undefined
      ? undefined
      : requireInteger(command.fontSizePx, 16, 80, index, "fontSizePx"),
    color: command.color === undefined
      ? undefined
      : requireColor(command.color, index, "color"),
    background: command.background === undefined
      ? undefined
      : requireColor(command.background, index, "background"),
    verticalPlacement: command.verticalPlacement === undefined
      ? undefined
      : requireEnum(
        command.verticalPlacement,
        ["top", "middle", "bottom"],
        index,
        "verticalPlacement",
      ),
    bilingual: command.bilingual === undefined
      ? undefined
      : requireBoolean(command.bilingual, index, "bilingual"),
  });
}

function normalizeDisplayStop(command, index) {
  const fields = ["closeOverlay", "disconnectAudio", "disconnectMirror"];
  requireAtLeastOne(command, fields, index);
  const normalized = compact({
    type: command.type,
    closeOverlay: command.closeOverlay === undefined
      ? undefined
      : requireBoolean(command.closeOverlay, index, "closeOverlay"),
    disconnectAudio: command.disconnectAudio === undefined
      ? undefined
      : requireBoolean(command.disconnectAudio, index, "disconnectAudio"),
    disconnectMirror: command.disconnectMirror === undefined
      ? undefined
      : requireBoolean(command.disconnectMirror, index, "disconnectMirror"),
  });
  if (!fields.some((field) => normalized[field] === true)) {
    throw commandError("At least one display resource must be selected.", index);
  }
  return normalized;
}

function definition({
  type,
  title,
  description,
  permissions,
  fields,
  required = [],
  example,
  normalize,
}) {
  return deepFreeze({
    type,
    title,
    description,
    permissions,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["type", ...required],
      properties: {
        type: { const: type },
        ...fields,
      },
    },
    example,
    normalize,
  });
}

function validateController(controller) {
  if (!controller || typeof controller !== "object") {
    throw new TypeError("Caption Relay AI requires a page controller.");
  }
  ["getRevision", "getAiSnapshot", "applyAiCommands", "exportAi"].forEach((method) => {
    if (typeof controller[method] !== "function") {
      throw new TypeError(`Caption Relay AI controller is missing ${method}().`);
    }
  });
}

function assertOnlyFields(command, schemaFields, commandIndex) {
  const allowed = new Set(schemaFields);
  const unknown = Object.keys(command).find((field) => !allowed.has(field));
  if (unknown) {
    throw commandError(`Unknown ${command.type} field: ${unknown}.`, commandIndex, unknown);
  }
}

function assertOnlyOptionFields(options, allowedFields) {
  const unknown = Object.keys(options).find((field) => !allowedFields.includes(field));
  if (unknown) {
    throw new AiCommandError(`Unknown option: ${unknown}.`, {
      code: "unknown-option",
      path: `$.${unknown}`,
    });
  }
}

function requireAtLeastOne(command, fields, index) {
  if (!fields.some((field) => command[field] !== undefined)) {
    throw commandError(`Provide at least one of: ${fields.join(", ")}.`, index);
  }
}

function requireString(value, minimum, maximum, index, field, code = "invalid-command") {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw commandError(
      `${field} must be a string from ${minimum} to ${maximum} characters.`,
      index,
      field,
      code,
    );
  }
  if (minimum > 0 && !value.trim()) {
    throw commandError(`${field} cannot be blank.`, index, field, code);
  }
  return value;
}

function requireInteger(value, minimum, maximum, index, field, code = "invalid-command") {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw commandError(
      `${field} must be an integer from ${minimum} to ${maximum}.`,
      index,
      field,
      code,
    );
  }
  return value;
}

function requireNumber(value, minimum, maximum, index, field, code = "invalid-command") {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw commandError(
      `${field} must be a number from ${minimum} to ${maximum}.`,
      index,
      field,
      code,
    );
  }
  return value;
}

function requireEnum(value, allowed, index, field, code = "invalid-command") {
  if (![...allowed].includes(value)) {
    throw commandError(
      `${field} must be one of: ${[...allowed].join(", ")}.`,
      index,
      field,
      code,
    );
  }
  return value;
}

function requireBoolean(value, index, field) {
  if (typeof value !== "boolean") {
    throw commandError(`${field} must be a boolean.`, index, field);
  }
  return value;
}

function requireTrue(value, index, field) {
  if (value !== true) {
    throw commandError(`${field} must be true.`, index, field);
  }
}

function requireProjectId(value, index, field, code = "invalid-command") {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) {
    throw commandError("projectId is invalid.", index, field, code);
  }
  return value;
}

function requireCueId(value, index) {
  const cueId = requireString(value, 1, 100, index, "cueId");
  if (/[\u0000-\u001f\u007f]/.test(cueId)) {
    throw commandError("cueId contains control characters.", index, "cueId");
  }
  return cueId;
}

function requireUniqueStrings(value, minimum, maximum, textMaximum, index, field) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw commandError(
      `${field} must contain ${minimum} to ${maximum} entries.`,
      index,
      field,
    );
  }
  const normalized = value.map((entry, entryIndex) => requireString(
    entry,
    1,
    textMaximum,
    index,
    `${field}[${entryIndex}]`,
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw commandError(`${field} must not contain duplicates.`, index, field);
  }
  return normalized;
}

function requireColor(value, index, field) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw commandError(`${field} must be a six-digit hex color.`, index, field);
  }
  return value.toLowerCase();
}

function requireFilename(value) {
  if (typeof value !== "string"
    || !value.trim()
    || value.length > 255
    || /[\\/\u0000-\u001f\u007f]/.test(value)) {
    throw new AiCommandError("filename must be a safe basename no longer than 255 characters.", {
      code: "invalid-export-options",
      path: "$.filename",
    });
  }
  return value.trim();
}

function requireContextCueLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CONTEXT_CUES) {
    throw new AiCommandError(
      `cueLimit must be an integer from 1 to ${MAX_CONTEXT_CUES}.`,
      { code: "invalid-context-options", path: "$.cueLimit" },
    );
  }
  return value;
}

function requireContextCueOffset(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CONTEXT_CUE_OFFSET) {
    throw new AiCommandError(
      `cueOffset must be an integer from 0 to ${MAX_CONTEXT_CUE_OFFSET}.`,
      { code: "invalid-context-options", path: "$.cueOffset" },
    );
  }
  return value;
}

function encodeCueCursor(offset) {
  return `${CUE_CURSOR_PREFIX}${offset}`;
}

function decodeCueCursor(value) {
  if (typeof value !== "string" || !value.startsWith(CUE_CURSOR_PREFIX)) {
    throw invalidCueCursor();
  }
  const offsetText = value.slice(CUE_CURSOR_PREFIX.length);
  if (!/^(?:0|[1-9]\d*)$/.test(offsetText)) throw invalidCueCursor();
  const offset = Number(offsetText);
  try {
    return requireContextCueOffset(offset);
  } catch {
    throw invalidCueCursor();
  }
}

function invalidCueCursor() {
  return new AiCommandError("cueCursor is invalid or belongs to an unsupported cursor version.", {
    code: "invalid-context-options",
    path: "$.cueCursor",
  });
}

function commandError(message, commandIndex, field = null, code = "invalid-command") {
  const base = Number.isInteger(commandIndex)
    ? `$.commands[${commandIndex}]`
    : "$";
  const suffix = field
    ? field.startsWith("[") ? field : `.${field}`
    : "";
  return new AiCommandError(message, {
    code,
    commandIndex: Number.isInteger(commandIndex) ? commandIndex : null,
    path: `${base}${suffix}`,
  });
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function normalizeIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((entry) => typeof entry === "string" && entry)
    .slice(0, 10_000))];
}

function normalizeWarnings(value) {
  return (Array.isArray(value) ? value : [])
    .map((warning) => String(warning).trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 100);
}

function countTranslations(cues) {
  let translated = 0;
  let failed = 0;
  for (const cue of cues) {
    if (cue?.translationStatus === "failed") failed += 1;
    else if (typeof cue?.translations?.vi === "string" && cue.translations.vi) translated += 1;
  }
  return { translated, failed };
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function safeString(value, maximum) {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function nonNegativeIntegerOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function finiteInRangeOrNull(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function allowedOrNull(value, allowed) {
  return allowed.includes(value) ? value : null;
}

function stringSchema(minLength, maxLength) {
  return { type: "string", minLength, maxLength };
}

function integerSchema(minimum, maximum) {
  return { type: "integer", minimum, maximum };
}

function numberSchema(minimum, maximum) {
  return { type: "number", minimum, maximum };
}

function enumSchema(values) {
  return { enum: [...values] };
}

function projectIdSchema() {
  return {
    type: "string",
    minLength: 6,
    maxLength: 100,
    pattern: "^[A-Za-z0-9_-]+$",
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
