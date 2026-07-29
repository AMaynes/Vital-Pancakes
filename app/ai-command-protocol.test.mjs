import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  AI_PROTOCOL_VERSION,
  AiCommandError,
  normalizeAiCommandEnvelope,
} from "./ai-command-protocol.mjs";
import { createAiCommandRegistry } from "./ai-command-registry.mjs";

const validEnvelope = {
  protocolVersion: AI_PROTOCOL_VERSION,
  requestId: "request-1",
  tool: "test-tool",
  mode: "apply",
  expectedRevision: 0,
  commands: [{ type: "record.create", title: "Example" }],
};

test("command envelopes reject unknown fields and unsupported versions", () => {
  assert.throws(
    () => normalizeAiCommandEnvelope({ ...validEnvelope, surprise: true }),
    (error) => error instanceof AiCommandError && error.code === "unknown-envelope-field",
  );
  assert.throws(
    () => normalizeAiCommandEnvelope({ ...validEnvelope, protocolVersion: 99 }),
    (error) => error.code === "unsupported-protocol-version",
  );
});

test("command envelopes accept plain JSON objects from another browser realm", () => {
  const crossRealmEnvelope = runInNewContext(`(${JSON.stringify(validEnvelope)})`);
  assert.equal(
    JSON.stringify(normalizeAiCommandEnvelope(crossRealmEnvelope)),
    JSON.stringify(validEnvelope),
  );
});

test("the registry previews and applies through the same adapter", async () => {
  let revision = 0;
  let records = [];
  const registry = createAiCommandRegistry();
  registry.register({
    id: "test-tool",
    title: "Test Tool",
    getRevision: () => revision,
    getCapabilities: () => ({
      commands: [{ type: "record.create", permissions: ["create"] }],
    }),
    preview: async (envelope) => ({
      revision,
      result: { count: records.length + envelope.commands.length },
    }),
    apply: async (envelope) => {
      records = [...records, ...envelope.commands];
      revision += 1;
      return {
        revision,
        createdIds: ["record-1"],
        result: { count: records.length },
      };
    },
  });

  const preview = await registry.dispatch(
    { ...validEnvelope, requestId: "preview-1", mode: "preview" },
    { grantedPermissions: ["create"] },
  );
  assert.equal(preview.ok, true);
  assert.equal(preview.result.count, 1);
  assert.equal(records.length, 0);

  const applied = await registry.dispatch(validEnvelope, {
    grantedPermissions: ["create"],
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.revision, 1);
  assert.equal(records.length, 1);
});

test("apply request IDs are idempotent and conflicting reuse is rejected", async () => {
  let applyCount = 0;
  let revision = 0;
  const registry = createAiCommandRegistry();
  registry.register({
    id: "test-tool",
    title: "Test Tool",
    getRevision: () => revision,
    getCapabilities: () => ({
      commands: [{ type: "record.create", permissions: ["create"] }],
    }),
    preview: async () => ({}),
    apply: async () => {
      applyCount += 1;
      revision += 1;
      return { revision };
    },
  });

  const first = await registry.dispatch(validEnvelope, {
    grantedPermissions: ["create"],
  });
  const duplicate = await registry.dispatch(validEnvelope, {
    grantedPermissions: ["create"],
  });
  const conflict = await registry.dispatch({
    ...validEnvelope,
    commands: [{ type: "record.create", title: "Different" }],
  }, {
    grantedPermissions: ["create"],
  });

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(applyCount, 1);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "request-id-conflict");
});

test("the registry enforces permissions and optimistic revisions", async () => {
  const registry = createAiCommandRegistry();
  registry.register({
    id: "test-tool",
    title: "Test Tool",
    getRevision: () => 4,
    getCapabilities: () => ({
      commands: [{ type: "record.create", permissions: ["create"] }],
    }),
    preview: async () => ({}),
    apply: async () => ({ revision: 5 }),
  });

  const missingPermission = await registry.dispatch({
    ...validEnvelope,
    expectedRevision: 4,
  });
  assert.equal(missingPermission.error.code, "permission-required");

  const stale = await registry.dispatch({
    ...validEnvelope,
    expectedRevision: 3,
  }, {
    grantedPermissions: ["create"],
  });
  assert.equal(stale.error.code, "stale-revision");
  assert.equal(stale.error.details.currentRevision, 4);
});
