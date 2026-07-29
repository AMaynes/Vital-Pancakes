#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { BridgeBroker } from "./bridge-broker.mjs";
import { loadConfig } from "./config.mjs";
import { createVitalPancakesMcpServer } from "./mcp-server.mjs";
import { WebSocketGateway } from "./websocket-gateway.mjs";

async function main() {
  const config = await loadConfig();
  const broker = new BridgeBroker({
    allowedPageOrigins: config.allowedPageOrigins,
  });
  const gateway = new WebSocketGateway({
    broker,
    pairingToken: config.pairingToken,
    port: config.gatewayPort,
  });
  const address = await gateway.start();

  console.error(
    `Vital Pancakes browser bridge listening on ws://${address.host}:${address.port}`,
  );

  const stdio = serveStdio(
    () => createVitalPancakesMcpServer(broker),
    {
      onerror: (error) => console.error(`MCP transport error: ${error.message}`),
    },
  );
  let isClosing = false;
  const close = async () => {
    if (isClosing) return;
    isClosing = true;
    await Promise.allSettled([
      stdio.close(),
      gateway.close(),
    ]);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  process.stdin.once("end", () => void close());
  process.stdin.once("close", () => void close());
}

main().catch((error) => {
  console.error(`Vital Pancakes AI bridge failed: ${error.message}`);
  process.exitCode = 1;
});
