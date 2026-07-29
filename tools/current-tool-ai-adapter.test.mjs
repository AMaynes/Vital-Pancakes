import assert from "node:assert/strict";
import test from "node:test";

import { createCurrentToolAiAdapter } from "./current-tool-ai-adapter.mjs";

function envelope(mode, commands, requestId = "request-1") {
  return {
    protocolVersion: 1,
    requestId,
    tool: "test-tool",
    mode,
    commands,
  };
}

function createAdapterHarness() {
  let liveState = { items: [{ id: "first", value: 1 }] };
  let commits = 0;
  const adapter = createCurrentToolAiAdapter({
    id: "test-tool",
    title: "Test Tool",
    getSnapshot: () => liveState,
    commitSnapshot(nextState) {
      commits += 1;
      liveState = nextState;
    },
    commands: [
      {
        type: "items.list",
        permissions: ["read-content"],
        execute: (state) => ({ value: state.items }),
      },
      {
        type: "items.add",
        permissions: ["create"],
        mutates: true,
        execute(state, command) {
          if (!command.id) throw new Error("id is required");
          return {
            state: {
              ...state,
              items: [...state.items, { id: command.id, value: command.value }],
            },
            createdIds: [command.id],
          };
        },
      },
    ],
  });
  return {
    adapter,
    getState: () => liveState,
    getCommits: () => commits,
  };
}

test("preview stages mutations without changing or committing live state", async () => {
  const harness = createAdapterHarness();
  const result = await harness.adapter.preview(
    envelope("preview", [{ type: "items.add", id: "second", value: 2 }]),
    {},
  );

  assert.equal(result.result.stateChanged, true);
  assert.equal(result.result.preview, true);
  assert.deepEqual(result.createdIds, ["second"]);
  assert.deepEqual(harness.getState().items.map((item) => item.id), ["first"]);
  assert.equal(harness.getCommits(), 0);
});

test("apply commits a successful batch once", async () => {
  const harness = createAdapterHarness();
  const result = await harness.adapter.apply(
    envelope("apply", [
      { type: "items.add", id: "second", value: 2 },
      { type: "items.add", id: "third", value: 3 },
    ]),
    {},
  );

  assert.equal(result.result.stateChanged, true);
  assert.equal(harness.getCommits(), 1);
  assert.deepEqual(
    harness.getState().items.map((item) => item.id),
    ["first", "second", "third"],
  );
});

test("a later command failure rolls back the complete batch", async () => {
  const harness = createAdapterHarness();

  await assert.rejects(
    harness.adapter.apply(
      envelope("apply", [
        { type: "items.add", id: "second", value: 2 },
        { type: "items.add", value: 3 },
      ]),
      {},
    ),
    /id is required/,
  );
  assert.deepEqual(harness.getState().items.map((item) => item.id), ["first"]);
  assert.equal(harness.getCommits(), 0);
});

test("read operations return content without committing", async () => {
  const harness = createAdapterHarness();
  const result = await harness.adapter.apply(
    envelope("apply", [{ type: "items.list" }]),
    {},
  );

  assert.equal(result.result.stateChanged, false);
  assert.equal(harness.getCommits(), 0);
  assert.deepEqual(result.result.commands[0].value, [{ id: "first", value: 1 }]);
});

test("read operations cannot smuggle staged mutations into an apply batch", async () => {
  const adapter = createCurrentToolAiAdapter({
    id: "test-tool",
    title: "Test Tool",
    getSnapshot: () => ({ value: 1 }),
    commands: [{
      type: "state.bad-read",
      execute: () => ({ state: { value: 2 } }),
    }],
  });

  await assert.rejects(
    adapter.apply(envelope("apply", [{ type: "state.bad-read" }])),
    /read-only AI command cannot return staged state/,
  );
});

test("revision changes when page-owned state changes outside the adapter", () => {
  const harness = createAdapterHarness();
  const firstRevision = harness.adapter.getRevision();
  harness.getState().items.push({ id: "external", value: 4 });

  assert.equal(harness.adapter.getRevision(), firstRevision + 1);
});
