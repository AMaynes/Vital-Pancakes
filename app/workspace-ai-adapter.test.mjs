import assert from "node:assert/strict";
import test from "node:test";

import { AI_PROTOCOL_VERSION } from "./ai-command-protocol.mjs";
import { createAiCommandRegistry } from "./ai-command-registry.mjs";
import {
  calculateWorkspaceRevision,
  createWorkspaceAiAdapter,
} from "./workspace-ai-adapter.mjs";

function createWorkspace() {
  return {
    version: 16,
    sections: [
      {
        id: "studies",
        title: "Studies",
        type: "study",
        items: [
          {
            id: "study-1",
            title: "Existing study",
            summary: "Private full notes stay behind read-content.",
            researchQuestion: "What should be tested?",
            notes: "Complete content",
            tags: ["memory"],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      {
        id: "algorithms",
        title: "Algorithms",
        type: "algorithm",
        items: [
          {
            id: "algorithm-1",
            title: "Breadth-first search",
            summary: "Traverse by distance.",
            category: "traditional",
          },
        ],
      },
      {
        id: "projects",
        title: "Projects",
        type: "project",
        items: [],
      },
    ],
  };
}

function createHarness(initialWorkspace = createWorkspace()) {
  let workspace = structuredClone(initialWorkspace);
  let commitCount = 0;
  let nextIdentifier = 1;
  const adapter = createWorkspaceAiAdapter({
    readWorkspace: () => workspace,
    commitWorkspace: (nextWorkspace) => {
      workspace = structuredClone(nextWorkspace);
      commitCount += 1;
    },
    createId: () => `generated-${nextIdentifier++}`,
    now: () => "2026-07-29T12:00:00.000Z",
  });
  const registry = createAiCommandRegistry();
  registry.register(adapter);
  return {
    adapter,
    registry,
    getWorkspace: () => structuredClone(workspace),
    getCommitCount: () => commitCount,
    replaceWorkspace: (nextWorkspace) => {
      workspace = structuredClone(nextWorkspace);
    },
  };
}

function envelope({
  requestId,
  mode = "preview",
  expectedRevision,
  commands,
}) {
  return {
    protocolVersion: AI_PROTOCOL_VERSION,
    requestId,
    tool: "workspace",
    mode,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    commands,
  };
}

test("Workspace context is bounded metadata and capabilities describe truthful commands", async () => {
  const harness = createHarness();
  const context = await harness.registry.getContext("workspace", { limit: 2 });
  const capabilities = harness.registry.getCapabilities("workspace");

  assert.equal(context.sections.length, 2);
  assert.equal(context.omittedSectionCount, 1);
  assert.equal(context.entryContentIncluded, false);
  assert.equal("entries" in context.sections[0], false);
  assert.deepEqual(
    capabilities.commands.map(({ type }) => type),
    [
      "sections.list",
      "entries.search",
      "entries.get",
      "entries.create",
      "entries.update",
      "entries.delete",
    ],
  );
  assert.deepEqual(
    capabilities.sectionTypes.project.fields.status.values,
    ["Concept", "Active", "Paused", "Complete", "Archived"],
  );
  assert.equal(capabilities.sectionTypes.study.fields.content.kind, "string");
  assert.equal(capabilities.sectionTypes.study.fields.notecardLinks.kind, "string");
  assert.deepEqual(capabilities.sectionTypes.idea.fields.stage.values, ["Working", "Formed", "Parked"]);
  assert.equal(capabilities.sectionTypes.project.fields.studyIds.kind, "identifier-list");
  assert.equal(capabilities.sectionTypes.workout.fields.muscleTags.kind, "tags");
});

test("preview stages a whole batch without saving and apply commits it once", async () => {
  const harness = createHarness();
  const commands = [
    {
      type: "entries.create",
      sectionId: "studies",
      clientKey: "draft",
      item: {
        title: "Draft study",
        summary: "Initial summary",
        researchQuestion: "Does the staged update work?",
      },
    },
    {
      type: "entries.update",
      sectionId: "studies",
      clientKey: "draft",
      patch: {
        title: "Updated draft study",
        tags: ["Batch"],
      },
    },
    {
      type: "entries.search",
      sectionId: "studies",
      query: "updated draft",
      includeSamples: false,
    },
  ];
  const permissions = {
    grantedPermissions: ["create", "update", "read-summary"],
  };

  const preview = await harness.registry.dispatch(
    envelope({ requestId: "workspace-preview", commands }),
    permissions,
  );

  assert.equal(preview.ok, true);
  assert.equal(preview.result.summary.wouldPersist, true);
  assert.equal(preview.result.operations[2].result.totalMatches, 1);
  assert.equal(harness.getCommitCount(), 0);
  assert.equal(harness.getWorkspace().sections[0].items.length, 1);

  const revision = calculateWorkspaceRevision(harness.getWorkspace());
  const applied = await harness.registry.dispatch(
    envelope({
      requestId: "workspace-apply",
      mode: "apply",
      expectedRevision: revision,
      commands,
    }),
    permissions,
  );
  const savedStudies = harness.getWorkspace().sections[0].items;

  assert.equal(applied.ok, true);
  assert.equal(harness.getCommitCount(), 1);
  assert.equal(savedStudies.length, 2);
  assert.equal(savedStudies[1].title, "Updated draft study");
  assert.deepEqual(savedStudies[1].tags, ["Batch"]);
  assert.equal(savedStudies[1].createdAt, "2026-07-29T12:00:00.000Z");
  assert.equal(applied.clientKeyMap.draft, savedStudies[1].id);
  assert.equal(applied.revision, calculateWorkspaceRevision(harness.getWorkspace()));
});

test("a later invalid command leaves every staged mutation unapplied", async () => {
  const harness = createHarness();
  const before = harness.getWorkspace();
  const result = await harness.registry.dispatch(
    envelope({
      requestId: "workspace-invalid-batch",
      mode: "apply",
      commands: [
        {
          type: "entries.create",
          sectionId: "studies",
          item: { title: "Should not persist" },
        },
        {
          type: "entries.update",
          sectionId: "studies",
          itemId: "study-1",
          patch: { arbitraryStorageField: "rejected" },
        },
      ],
    }),
    { grantedPermissions: ["create", "update"] },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unsupported-entry-field");
  assert.equal(result.error.commandIndex, 1);
  assert.equal(harness.getCommitCount(), 0);
  assert.deepEqual(harness.getWorkspace(), before);
});

test("read permissions separate summaries from complete entry content", async () => {
  const harness = createHarness();
  const searchCommand = envelope({
    requestId: "workspace-search",
    commands: [{ type: "entries.search", query: "existing study" }],
  });
  const getCommand = envelope({
    requestId: "workspace-get",
    commands: [{
      type: "entries.get",
      sectionId: "studies",
      itemId: "study-1",
    }],
  });

  const search = await harness.registry.dispatch(searchCommand, {
    grantedPermissions: ["read-summary"],
  });
  const deniedContent = await harness.registry.dispatch(getCommand, {
    grantedPermissions: ["read-summary"],
  });
  const content = await harness.registry.dispatch(getCommand, {
    grantedPermissions: ["read-content"],
  });

  assert.equal(search.ok, true);
  assert.equal(search.result.operations[0].result.entries[0].title, "Existing study");
  assert.equal("notes" in search.result.operations[0].result.entries[0], false);
  assert.equal(deniedContent.ok, false);
  assert.equal(deniedContent.error.code, "permission-required");
  assert.equal(content.ok, true);
  assert.equal(content.result.operations[0].result.entry.notes, "Complete content");
  assert.equal(harness.getCommitCount(), 0);
});

test("registry revision checks catch ordinary Workspace changes before apply", async () => {
  const harness = createHarness();
  const expectedRevision = harness.adapter.getRevision();
  const externallyChanged = harness.getWorkspace();
  externallyChanged.sections[0].items[0].title = "Edited in the Workspace UI";
  harness.replaceWorkspace(externallyChanged);

  const result = await harness.registry.dispatch(
    envelope({
      requestId: "workspace-stale",
      mode: "apply",
      expectedRevision,
      commands: [{
        type: "entries.delete",
        sectionId: "studies",
        itemId: "study-1",
      }],
    }),
    { grantedPermissions: ["delete"] },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "stale-revision");
  assert.equal(harness.getCommitCount(), 0);
  assert.equal(harness.getWorkspace().sections[0].items.length, 1);
});

test("project relationships accept only existing non-analysis algorithms", async () => {
  const harness = createHarness();
  const valid = await harness.registry.dispatch(
    envelope({
      requestId: "workspace-project-valid",
      mode: "apply",
      commands: [{
        type: "entries.create",
        sectionId: "projects",
        item: {
          title: "Graph explorer",
          algorithmIds: ["algorithm-1"],
        },
      }],
    }),
    { grantedPermissions: ["create"] },
  );
  const invalid = await harness.registry.dispatch(
    envelope({
      requestId: "workspace-project-invalid",
      mode: "apply",
      commands: [{
        type: "entries.create",
        sectionId: "projects",
        item: {
          title: "Broken reference",
          algorithmIds: ["missing-algorithm"],
        },
      }],
    }),
    { grantedPermissions: ["create"] },
  );

  assert.equal(valid.ok, true);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "invalid-algorithm-reference");
  assert.equal(harness.getCommitCount(), 1);
});

test("read-only apply envelopes do not rewrite Workspace storage", async () => {
  const harness = createHarness();
  const result = await harness.registry.dispatch(
    envelope({
      requestId: "workspace-read-apply",
      mode: "apply",
      commands: [{ type: "sections.list", limit: 3 }],
    }),
    { grantedPermissions: ["read-summary"] },
  );

  assert.equal(result.ok, true);
  assert.equal(result.result.summary.wouldPersist, false);
  assert.equal(harness.getCommitCount(), 0);
});
