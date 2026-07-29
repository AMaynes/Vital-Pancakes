#!/usr/bin/env node

import { createConfig, getDefaultConfigPath } from "../src/config.mjs";

const force = process.argv.includes("--force");
const configPath = getDefaultConfigPath();

try {
  const created = await createConfig({ configPath, force });
  console.log(`Vital Pancakes AI bridge configuration created:
${created.configPath}

Pairing token:
${created.config.pairingToken}

Paste this token into the Vital Pancakes AI Bridge extension options.
Keep it private; rerun with --force to revoke it and generate a replacement.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
