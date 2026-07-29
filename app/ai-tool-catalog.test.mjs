import assert from "node:assert/strict";
import test from "node:test";

import { findAiTool } from "./ai-tool-catalog.mjs";

test("Caption Relay is registered with its dedicated AI adapter", () => {
  assert.deepEqual(findAiTool("caption-relay"), {
    id: "caption-relay",
    title: "Caption Relay",
    route: "tools/caption-relay.html",
    adapterModule: "tools/caption-relay-ai-adapter.mjs",
    available: true,
  });
});
