import assert from "node:assert/strict";
import test from "node:test";

import { createCurrentToolAiAdapter } from "../tools/current-tool-ai-adapter.mjs";
import { createHomeKnowledgeAiConfiguration } from "./home-knowledge-ai-adapter.mjs";

const documents = [
  {
    id: "entry-a",
    title: "Memory",
    text: "Spaced review improves memory.",
    kind: "study",
    source: "workspace",
  },
  {
    id: "entry-b",
    title: "Spaced repetition",
    text: "Reviews are scheduled over increasing intervals.",
    kind: "lesson",
    source: "master-lesson-builder",
  },
];

function harness() {
  let snapshot = {
    documents,
    glossary: [],
    links: [],
    inferenceSessions: [{
      id: "session-a",
      name: "Memory links",
      updatedAt: "2026-07-30T00:00:00.000Z",
      inferences: [{
        id: "inference-a",
        kind: "hypothesis",
        title: "Spacing connection",
        statement: "Spacing may improve retrievability.",
        confidence: 0.7,
        confidenceRationale: "Two records align.",
        citations: ["entry-a:chunk:1"],
        tags: [],
        status: "pending",
      }],
    }],
  };
  const adapter = createCurrentToolAiAdapter(createHomeKnowledgeAiConfiguration({
    getSnapshot: () => snapshot,
    getDocuments: () => documents,
    getVaultSummary: () => ({ databases: 2, files: 1 }),
    commitSnapshot: (next) => {
      snapshot = next;
    },
  }));
  return { adapter, getSnapshot: () => snapshot };
}

function envelope(mode, commands) {
  return {
    protocolVersion: 1,
    requestId: "home-request",
    tool: "knowledge-home",
    mode,
    commands,
  };
}

test("homepage adapter exposes bounded search without vault contents", async () => {
  const { adapter } = harness();
  const result = await adapter.apply(envelope("apply", [{
    type: "knowledge.search",
    query: "memory",
    limit: 10,
  }]));
  assert.equal(result.result.commands[0].value[0].id, "entry-a");
  assert.equal("text" in result.result.commands[0].value[0], false);
  assert.deepEqual(adapter.getCapabilities().limitations.some((value) => /password/i.test(value)), true);
});

test("AI relationships stay pending until a separate review command", async () => {
  const state = harness();
  await state.adapter.apply(envelope("apply", [{
    type: "relationships.propose",
    sourceId: "entry-a",
    targetId: "entry-b",
    relation: "supports",
    rationale: "Both concern spaced practice.",
  }]));
  assert.equal(state.getSnapshot().links[0].status, "pending");

  await state.adapter.apply(envelope("apply", [{
    type: "relationships.review",
    linkId: state.getSnapshot().links[0].id,
    status: "accepted",
  }]));
  assert.equal(state.getSnapshot().links[0].status, "accepted");
});

test("glossary mutation supports preview without persistence", async () => {
  const state = harness();
  const result = await state.adapter.preview(envelope("preview", [{
    type: "glossary.upsert",
    entry: { term: "Retrievability", definition: "Probability of successful recall." },
  }]));
  assert.equal(result.result.stateChanged, true);
  assert.equal(state.getSnapshot().glossary.length, 0);
});

test("saved inferences are reviewable but cannot be generated through commands", async () => {
  const state = harness();
  const capabilities = state.adapter.getCapabilities();
  assert.ok(capabilities.commands.some((command) => command.type === "inferences.list"));
  assert.ok(capabilities.commands.some((command) => command.type === "inferences.update"));
  assert.equal(capabilities.commands.some((command) => /run|generate/.test(command.type)), false);

  const result = await state.adapter.apply(envelope("apply", [{
    type: "inferences.update",
    sessionId: "session-a",
    inferenceId: "inference-a",
    changes: { status: "accepted", tags: ["reviewed"] },
  }]));
  assert.equal(result.result.commands[0].value.status, "accepted");
  assert.deepEqual(
    state.getSnapshot().inferenceSessions[0].inferences[0].tags,
    ["reviewed"],
  );
});
