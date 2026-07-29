import assert from "node:assert/strict";
import test from "node:test";

import { AI_PROTOCOL_VERSION, AiCommandError } from "../app/ai-command-protocol.mjs";
import { createAiCommandRegistry } from "../app/ai-command-registry.mjs";
import {
  CAPTION_RELAY_AI_CONTRACT_VERSION,
  createCaptionRelayAiAdapter,
  normalizeCaptionRelayAiCommands,
} from "./caption-relay-ai-adapter.mjs";

function createController({ captionCues = null } = {}) {
  let revision = 4;
  const calls = {
    previews: [],
    applies: [],
    applyOptions: [],
    exports: [],
    snapshots: [],
  };
  const defaultCues = [
    {
      id: "cue-000001",
      startMs: 1234,
      endMs: 3456,
      sourceText: "Private caption one.",
      translations: { vi: "Phụ đề riêng số một." },
      confidence: 0.94,
      translationStatus: "translated",
    },
    {
      id: "cue-000002",
      startMs: 4000,
      endMs: 5000,
      sourceText: "Private caption two.",
      translations: { vi: "" },
      confidence: null,
      translationStatus: "failed",
    },
  ];
  const snapshot = {
    revision,
    stage: "translate",
    activeProject: {
      id: "caption_example1",
      name: "Private movie title",
      status: "ready",
      package: {
        title: "Private movie title",
        cues: captionCues ?? defaultCues,
        sync: {
          fingerprints: [{ timeMs: 0, hash: "private-fingerprint" }],
        },
      },
      rawAudio: new Float32Array([0.1]),
    },
    projects: [
      {
        id: "caption_example1",
        name: "Private movie title",
        status: "ready",
        updatedAt: "2026-07-29T00:00:00.000Z",
        cueCount: 2,
        translatedCount: 1,
      },
    ],
    capture: {
      state: "idle",
      processedSamples: 32000,
      elapsedMs: 2000,
      queueLength: 0,
      modelState: "ready",
      recoveryAvailable: true,
      secret: "not exposed",
    },
    translation: {
      state: "paused",
      completed: 1,
      failed: 1,
      total: 2,
      style: "natural",
    },
    sync: {
      state: "locked",
      mode: "text",
      confidence: 0.83,
      movieTimeMs: 45_000,
      showCaptions: true,
    },
    overlay: {
      open: true,
      mode: "popup",
      bilingual: true,
      verticalPlacement: "bottom",
    },
  };

  return {
    calls,
    getRevision: () => revision,
    getAiSnapshot: async (options) => {
      calls.snapshots.push(options);
      return { ...snapshot, revision };
    },
    previewAiCommands: async (commands) => {
      calls.previews.push(commands);
      return { warnings: ["Preview only."] };
    },
    applyAiCommands: async (commands, options) => {
      calls.applies.push(commands);
      calls.applyOptions.push(options);
      revision += 1;
      return {
        revision,
        createdIds: commands[0]?.type === "project.create" ? ["caption_created1"] : [],
        updatedIds: ["caption_example1"],
        secretCaptionText: "must not escape",
      };
    },
    exportAi: async (options) => {
      calls.exports.push(options);
      return {
        downloaded: true,
        format: options.format,
        filename: options.filename ?? "private.vpcaptions.json",
        size: 4567,
        bytes: "must not escape",
      };
    },
  };
}

function envelope(commands, {
  requestId = "caption-request",
  mode = "preview",
  expectedRevision = 4,
} = {}) {
  return {
    protocolVersion: AI_PROTOCOL_VERSION,
    requestId,
    tool: "caption-relay",
    mode,
    expectedRevision,
    commands,
  };
}

test("capabilities publish strict schemas, examples, permissions, models, and gesture limits", () => {
  const adapter = createCaptionRelayAiAdapter(createController());
  const capabilities = adapter.getCapabilities();
  const commandTypes = capabilities.commands.map((command) => command.type);

  assert.equal(capabilities.contractVersion, CAPTION_RELAY_AI_CONTRACT_VERSION);
  assert.equal(capabilities.protocolVersion, AI_PROTOCOL_VERSION);
  assert.equal(capabilities.context.defaultExcludesCueText, true);
  assert.deepEqual(capabilities.context.cuePagination, {
    offsetOption: "cueOffset",
    cursorOption: "cueCursor",
    responseField: "cuePagination",
    cursorVersion: 1,
  });
  assert.deepEqual(capabilities.exports.permissions, ["export"]);
  assert.deepEqual(capabilities.exports.formats, [
    "package",
    "vtt-vi",
    "srt-vi",
    "vtt-bilingual",
  ]);
  assert.ok(commandTypes.includes("project.create"));
  assert.ok(commandTypes.includes("cue.update"));
  assert.ok(commandTypes.includes("glossary.upsert"));
  assert.ok(commandTypes.includes("timeline.correct"));
  assert.ok(commandTypes.includes("translation.search-replace"));
  assert.ok(commandTypes.includes("sync.control"));
  assert.ok(commandTypes.includes("overlay.configure"));
  assert.ok(commandTypes.every((type) => (
    !["capture.start", "overlay.open", "display.connect-audio", "mirror.start"].includes(type)
  )));
  assert.ok(capabilities.commands.every((command) => {
    return command.previewable === true
      && command.inputSchema.additionalProperties === false
      && command.inputSchema.properties.type.const === command.type
      && command.example.type === command.type
      && Array.isArray(command.permissions);
  }));
  assert.ok(capabilities.models.every((model) => model.license === "Apache-2.0"));
  assert.deepEqual(
    capabilities.humanActions.map((action) => action.id),
    [
      "package.select-file",
      "capture.start",
      "overlay.open",
      "display.connect-audio",
      "mirror.start",
      "mirror.fullscreen",
    ],
  );

  assert.doesNotThrow(() => normalizeCaptionRelayAiCommands(
    capabilities.commands.map((command) => command.example),
  ));
});

test("preview validates a batch without mutation and apply delegates normalized commands once", async () => {
  const controller = createController();
  const registry = createAiCommandRegistry();
  registry.register(createCaptionRelayAiAdapter(controller));
  const commands = [
    {
      type: "timeline.correct",
      offsetMs: 250,
    },
    {
      type: "cue.update",
      cueId: "cue-000001",
      vietnameseText: "Đi thôi.",
    },
  ];

  const preview = await registry.dispatch(envelope(commands), {
    grantedPermissions: ["update"],
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.revision, 4);
  assert.equal(preview.result.willMutate, false);
  assert.equal(controller.calls.previews.length, 1);
  assert.equal(controller.calls.applies.length, 0);
  assert.deepEqual(controller.calls.previews[0][0], {
    type: "timeline.correct",
    offsetMs: 250,
    scale: 1,
    anchorMs: 0,
  });

  const applied = await registry.dispatch(envelope(commands, {
    requestId: "caption-apply",
    mode: "apply",
  }), {
    grantedPermissions: ["update"],
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.revision, 5);
  assert.deepEqual(applied.updatedIds, ["caption_example1"]);
  assert.equal(applied.result.applied, true);
  assert.equal("secretCaptionText" in applied.result, false);
  assert.equal(controller.calls.applies.length, 1);
  assert.deepEqual(controller.calls.applyOptions[0], {
    signal: undefined,
    expectedRevision: 4,
  });
});

test("invalid or unknown commands are rejected before the controller runs", async () => {
  const controller = createController();
  const registry = createAiCommandRegistry();
  registry.register(createCaptionRelayAiAdapter(controller));

  const unknownField = await registry.dispatch(envelope([{
    type: "cue.update",
    cueId: "cue-000001",
    vietnameseText: "Được.",
    clickSelector: "#translation-row",
  }]), {
    grantedPermissions: ["update"],
  });
  assert.equal(unknownField.ok, false);
  assert.equal(unknownField.error.code, "invalid-command");
  assert.equal(unknownField.error.path, "$.commands[0].clickSelector");

  const badRate = await registry.dispatch(envelope([{
    type: "project.create",
    title: "Example",
    originalDurationMs: 60_000,
    capturePlaybackRate: 1.75,
  }]), {
    grantedPermissions: ["create"],
  });
  assert.equal(badRate.ok, false);
  assert.equal(badRate.error.path, "$.commands[0].capturePlaybackRate");

  const unknownCommand = await registry.dispatch(envelope([{
    type: "dom.click",
    selector: "#start-capture",
  }]), {
    grantedPermissions: ["update"],
  });
  assert.equal(unknownCommand.ok, false);
  assert.equal(unknownCommand.error.code, "unsupported-command");
  assert.equal(controller.calls.applies.length, 0);
  assert.equal(controller.calls.previews.length, 0);
});

test("command permissions distinguish create, update, and destructive actions", async () => {
  const controller = createController();
  const registry = createAiCommandRegistry();
  registry.register(createCaptionRelayAiAdapter(controller));
  const deletion = envelope([{
    type: "project.delete",
    projectId: "caption_example1",
    confirm: true,
  }], {
    requestId: "caption-delete",
    mode: "apply",
  });

  const denied = await registry.dispatch(deletion, {
    grantedPermissions: ["update"],
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "permission-required");
  assert.deepEqual(denied.error.details.missingPermissions, ["delete"]);

  const allowed = await registry.dispatch(deletion, {
    grantedPermissions: ["delete"],
  });
  assert.equal(allowed.ok, true);
  assert.equal(controller.calls.applies.length, 1);
});

test("context is summary-only by default and cue text requires read-content", async () => {
  const controller = createController();
  const adapter = createCaptionRelayAiAdapter(controller);

  await assert.rejects(
    () => adapter.getContext({}),
    (error) => error instanceof AiCommandError && error.code === "permission-required",
  );

  const summary = await adapter.getContext({
    grantedPermissions: ["read-summary"],
  });
  assert.equal(summary.activeProject.cueCount, 2);
  assert.equal(summary.activeProject.translatedCount, 1);
  assert.equal("cues" in summary, false);
  assert.equal("package" in summary.activeProject, false);
  assert.equal("rawAudio" in summary.activeProject, false);
  assert.equal("secret" in summary.capture, false);

  await assert.rejects(
    () => adapter.getContext({
      includeCueText: true,
      grantedPermissions: ["read-summary"],
    }),
    (error) => error.code === "permission-required"
      && error.details.missingPermissions.includes("read-content"),
  );

  const content = await adapter.getContext({
    includeCueText: true,
    cueLimit: 1,
    grantedPermissions: ["read-summary", "read-content"],
  });
  assert.equal(content.cues.length, 1);
  assert.equal(content.cuesTruncated, true);
  assert.equal(content.cues[0].sourceText, "Private caption one.");
  assert.equal(content.cues[0].vietnameseText, "Phụ đề riêng số một.");
  assert.deepEqual(content.cuePagination, {
    offset: 0,
    limit: 1,
    returned: 1,
    total: 2,
    hasPrevious: false,
    hasNext: true,
    previousOffset: null,
    nextOffset: 1,
    previousCursor: null,
    nextCursor: "caption-relay-cues-v1:1",
  });
  assert.equal(JSON.stringify(content).includes("private-fingerprint"), false);
  assert.deepEqual(controller.calls.snapshots.at(-1), {
    includeCueText: true,
    cueLimit: 1,
    cueOffset: 0,
  });
});

test("cue context supports compatible offset and cursor pagination", async () => {
  const controller = createController();
  const adapter = createCaptionRelayAiAdapter(controller);
  const permissions = ["read-summary", "read-content"];

  const byOffset = await adapter.getContext({
    includeCueText: true,
    cueLimit: 1,
    cueOffset: 1,
    grantedPermissions: permissions,
  });
  assert.equal(byOffset.cues[0].id, "cue-000002");
  assert.deepEqual(byOffset.cuePagination, {
    offset: 1,
    limit: 1,
    returned: 1,
    total: 2,
    hasPrevious: true,
    hasNext: false,
    previousOffset: 0,
    nextOffset: null,
    previousCursor: "caption-relay-cues-v1:0",
    nextCursor: null,
  });

  const firstPage = await adapter.getContext({
    includeCueText: true,
    cueLimit: 1,
    grantedPermissions: permissions,
  });
  const byCursor = await adapter.getContext({
    includeCueText: true,
    cueLimit: 1,
    cueCursor: firstPage.cuePagination.nextCursor,
    grantedPermissions: permissions,
  });
  assert.deepEqual(byCursor.cues, byOffset.cues);
  assert.equal(byCursor.cuePagination.offset, 1);

  await assert.rejects(
    () => adapter.getContext({
      includeCueText: true,
      cueOffset: -1,
      grantedPermissions: permissions,
    }),
    (error) => error.code === "invalid-context-options" && error.path === "$.cueOffset",
  );
  await assert.rejects(
    () => adapter.getContext({
      includeCueText: true,
      cueCursor: "caption-relay-cues-v2:1",
      grantedPermissions: permissions,
    }),
    (error) => error.code === "invalid-context-options" && error.path === "$.cueCursor",
  );
  await assert.rejects(
    () => adapter.getContext({
      includeCueText: true,
      cueOffset: 1,
      cueCursor: "caption-relay-cues-v1:1",
      grantedPermissions: permissions,
    }),
    (error) => error.code === "invalid-context-options" && error.path === "$.cueCursor",
  );
});

test("cue pagination reaches entries beyond the per-response maximum", async () => {
  const captionCues = Array.from({ length: 501 }, (_, index) => ({
    id: `cue-${String(index + 1).padStart(6, "0")}`,
    startMs: index * 1_000,
    endMs: (index * 1_000) + 900,
    sourceText: `Caption ${index + 1}`,
    translations: { vi: `Phụ đề ${index + 1}` },
    confidence: null,
    translationStatus: "translated",
  }));
  const adapter = createCaptionRelayAiAdapter(createController({ captionCues }));

  const page = await adapter.getContext({
    includeCueText: true,
    cueLimit: 1,
    cueCursor: "caption-relay-cues-v1:500",
    grantedPermissions: ["read-summary", "read-content"],
  });

  assert.equal(page.cues[0].id, "cue-000501");
  assert.equal(page.cuePagination.offset, 500);
  assert.equal(page.cuePagination.total, 501);
  assert.equal(page.cuePagination.hasNext, false);
});

test("exports require permission, validate safe filenames, and never return bytes", async () => {
  const controller = createController();
  const adapter = createCaptionRelayAiAdapter(controller);

  await assert.rejects(
    () => adapter.export({ format: "package" }),
    (error) => error.code === "permission-required",
  );
  await assert.rejects(
    () => adapter.export({
      format: "package",
      filename: "../private.json",
      grantedPermissions: ["export"],
    }),
    (error) => error.code === "invalid-export-options",
  );

  const result = await adapter.export({
    format: "vtt-bilingual",
    projectId: "caption_example1",
    filename: "captions.vtt",
    grantedPermissions: ["export"],
  });
  assert.deepEqual(controller.calls.exports[0], {
    format: "vtt-bilingual",
    projectId: "caption_example1",
    filename: "captions.vtt",
    signal: undefined,
  });
  assert.equal(result.downloaded, true);
  assert.equal(result.filename, "captions.vtt");
  assert.equal(result.size, 4567);
  assert.equal("bytes" in result, false);
});
