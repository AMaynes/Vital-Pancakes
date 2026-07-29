import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { createPairingToken } from "../src/authentication.mjs";

test("stdio MCP server initializes and advertises the semantic tool set", async (context) => {
  const child = spawn(process.execPath, ["src/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      VP_AI_BRIDGE_TOKEN: createPairingToken(),
      VP_AI_BRIDGE_PORT: "0",
      VP_AI_BRIDGE_ALLOWED_ORIGINS: "http://localhost:8000",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });
  const messages = createMessageReader(child.stdout);

  send(child, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "bridge-test", version: "1.0.0" },
    },
  });
  const initialized = await messages.next();
  assert.equal(initialized.id, 1);
  assert.equal(initialized.result.serverInfo.name, "vital-pancakes");

  send(child, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });
  send(child, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  const listed = await messages.next();
  assert.equal(listed.id, 2);
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    [
      "vp_list_tools",
      "vp_get_capabilities",
      "vp_get_context",
      "vp_preview_commands",
      "vp_apply_commands",
      "vp_undo",
      "vp_redo",
      "vp_export",
    ],
  );
  assert.equal(
    listed.result.tools.find((tool) => tool.name === "vp_get_context")
      .annotations.readOnlyHint,
    true,
  );

  send(child, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "vp_list_tools",
      arguments: {},
    },
  });
  const called = await messages.next();
  assert.equal(called.id, 3);
  assert.equal(called.result.isError, undefined);
  assert.deepEqual(called.result.structuredContent, {
    ok: true,
    result: {
      pages: [],
      tools: [],
      warning: "No page is connected. Open Vital Pancakes and connect the tab from the extension.",
    },
  });

  child.stdin.end();
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
});

function send(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function createMessageReader(stream) {
  const iterator = createInterface({ input: stream, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  return {
    async next() {
      const timeout = new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("MCP response timed out.")),
          3_000,
        );
        timer.unref?.();
      });
      const next = iterator.next().then(({ value, done }) => {
        if (done) throw new Error("MCP stdout closed before a response arrived.");
        return JSON.parse(value);
      });
      return Promise.race([next, timeout]);
    },
  };
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
}
