import assert from "node:assert/strict";
import test from "node:test";

import { createAiCommandCenterAdapter } from "./ai-command-center-adapter.mjs";

test("command-center preview does not alter UI state and apply commits once", async () => {
  let state = {
    revision: 2,
    targetToolId: "visual-board",
    draft: "",
    previewOk: false,
  };
  let commits = 0;
  const adapter = createAiCommandCenterAdapter({
    getState: () => state,
    allowedToolIds: ["visual-board", "workspace"],
    commit: async (nextState) => {
      commits += 1;
      state = nextState;
      return state.revision;
    },
  });
  const envelope = {
    commands: [{ type: "target.open", toolId: "workspace" }],
  };

  const preview = await adapter.preview(envelope);
  assert.equal(preview.result.targetToolId, "workspace");
  assert.equal(state.targetToolId, "visual-board");
  assert.equal(commits, 0);

  const applied = await adapter.apply(envelope);
  assert.equal(applied.result.targetToolId, "workspace");
  assert.equal(state.targetToolId, "workspace");
  assert.equal(commits, 1);
});

test("command-center refuses targets outside the maintained catalog", async () => {
  const adapter = createAiCommandCenterAdapter({
    getState: () => ({
      revision: 0,
      targetToolId: "visual-board",
      draft: "",
      previewOk: false,
    }),
    allowedToolIds: ["visual-board"],
    commit: async () => 1,
  });

  await assert.rejects(
    () => adapter.preview({
      commands: [{ type: "target.open", toolId: "unknown-tool" }],
    }),
    (error) => error.code === "unknown-tool",
  );
});
