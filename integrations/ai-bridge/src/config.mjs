import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_ALLOWED_PAGE_ORIGINS,
  DEFAULT_GATEWAY_PORT,
} from "./constants.mjs";
import {
  createPairingToken,
  validatePairingToken,
} from "./authentication.mjs";
import { normalizeAllowedOrigins } from "./protocol.mjs";

const CONFIG_VERSION = 1;

export function getDefaultConfigPath(environment = process.env, platform = process.platform) {
  if (environment.VP_AI_BRIDGE_CONFIG) {
    return resolve(environment.VP_AI_BRIDGE_CONFIG);
  }
  if (platform === "win32") {
    const base = environment.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(base, "VitalPancakes", "ai-bridge.json");
  }
  const base = environment.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "vital-pancakes", "ai-bridge.json");
}

export async function createConfig({
  configPath = getDefaultConfigPath(),
  force = false,
} = {}) {
  if (!force) {
    try {
      await readFile(configPath, "utf8");
      throw new Error(`A bridge configuration already exists at ${configPath}.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const config = {
    version: CONFIG_VERSION,
    gatewayPort: DEFAULT_GATEWAY_PORT,
    pairingToken: createPairingToken(),
    allowedPageOrigins: [...DEFAULT_ALLOWED_PAGE_ORIGINS],
  };
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform !== "win32") await chmod(configPath, 0o600);
  return { configPath, config };
}

export async function loadConfig({
  configPath = getDefaultConfigPath(),
  environment = process.env,
} = {}) {
  let stored = {};
  try {
    stored = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`Unable to read AI bridge configuration: ${error.message}`);
    }
  }

  const pairingToken = environment.VP_AI_BRIDGE_TOKEN || stored.pairingToken;
  if (!validatePairingToken(pairingToken)) {
    throw new Error(
      `No valid pairing token is configured. Run "npm run setup" in integrations/ai-bridge.`,
    );
  }

  const gatewayPort = parsePort(
    environment.VP_AI_BRIDGE_PORT ?? stored.gatewayPort ?? DEFAULT_GATEWAY_PORT,
  );
  const allowedPageOrigins = environment.VP_AI_BRIDGE_ALLOWED_ORIGINS
    ? environment.VP_AI_BRIDGE_ALLOWED_ORIGINS.split(",").map((value) => value.trim())
    : stored.allowedPageOrigins ?? DEFAULT_ALLOWED_PAGE_ORIGINS;

  return {
    configPath,
    gatewayPort,
    pairingToken,
    allowedPageOrigins: normalizeAllowedOrigins(allowedPageOrigins),
  };
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid AI bridge port: ${String(value)}`);
  }
  return port;
}
