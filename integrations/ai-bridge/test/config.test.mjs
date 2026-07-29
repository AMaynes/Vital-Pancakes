import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createConfig,
  loadConfig,
} from "../src/config.mjs";

test("creates and reloads a private versioned pairing configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vp-ai-bridge-"));
  const configPath = join(directory, "config", "bridge.json");
  try {
    const created = await createConfig({ configPath });
    const serialized = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(serialized.version, 1);
    assert.equal(serialized.pairingToken, created.config.pairingToken);
    if (process.platform !== "win32") {
      assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    }
    const loaded = await loadConfig({ configPath, environment: {} });
    assert.equal(loaded.pairingToken, created.config.pairingToken);
    assert.equal(loaded.allowedPageOrigins.has("https://amaynes.github.io"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("environment values override stored port and origins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vp-ai-bridge-"));
  const configPath = join(directory, "bridge.json");
  try {
    const created = await createConfig({ configPath });
    const loaded = await loadConfig({
      configPath,
      environment: {
        VP_AI_BRIDGE_TOKEN: created.config.pairingToken,
        VP_AI_BRIDGE_PORT: "45000",
        VP_AI_BRIDGE_ALLOWED_ORIGINS: "http://localhost:9000",
      },
    });
    assert.equal(loaded.gatewayPort, 45_000);
    assert.deepEqual([...loaded.allowedPageOrigins], ["http://localhost:9000"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
