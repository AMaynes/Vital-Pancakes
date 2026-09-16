import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createCurrentToolAiAdapter } from "../tools/current-tool-ai-adapter.mjs";
import { createHomeKnowledgeAiConfiguration } from "./home-knowledge-ai-adapter.mjs";
import { scheduleKnowledgeSync, syncKnowledgeIndex } from "./knowledge-sync.mjs";

test("WIP knowledge adapter exposes no data or operational commands", async () => {
  const controller = new Proxy({}, { get() { throw new Error("Storage must not be accessed"); } });
  const config = createHomeKnowledgeAiConfiguration(controller);
  assert.deepEqual(config.commands, []);
  assert.deepEqual(config.getSnapshot(), { status: "WIP", available: false });
  assert.throws(() => createCurrentToolAiAdapter(config), /needs commands/);
});

test("WIP index entry points never read storage", async () => {
  const options = new Proxy({}, { get() { throw new Error("Storage must not be accessed"); } });
  assert.equal(scheduleKnowledgeSync(options), undefined);
  assert.deepEqual(await syncKnowledgeIndex(options), { status: "WIP", available: false });
});

test("homepage WIP descriptions have no operational controls or controller", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const center = html.slice(html.indexOf('<section class="knowledge-center'), html.indexOf('<section class="section-block">', html.indexOf('<section class="knowledge-center')));
  assert.equal((center.match(/knowledge-wip-label/g) ?? []).length, 9);
  assert.doesNotMatch(center, /<(button|input|select|form|svg)\b/);
  assert.doesNotMatch(html, /app\/home-knowledge.js|id="vault-dialog"|id="knowledge-inference-dialog"/);
});
