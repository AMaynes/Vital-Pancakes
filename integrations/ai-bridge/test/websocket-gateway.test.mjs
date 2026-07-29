import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import {
  createClientProof,
  createPairingToken,
  createServerProof,
  proofsMatch,
} from "../src/authentication.mjs";
import { BridgeBroker } from "../src/bridge-broker.mjs";
import { WebSocketGateway } from "../src/websocket-gateway.mjs";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;

test("authenticates an extension and routes a complete page request", async (context) => {
  const pairingToken = createPairingToken();
  const broker = new BridgeBroker({
    allowedPageOrigins: new Set(["http://localhost:8000"]),
  });
  const gateway = new WebSocketGateway({ broker, pairingToken, port: 0 });
  const address = await gateway.start();
  context.after(() => gateway.close());

  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`, {
    headers: { Origin: ORIGIN },
  });
  context.after(() => socket.close());
  const hello = await nextJsonMessage(socket);
  assert.equal(hello.kind, "hello");

  const extensionNonce = "extension_nonce_123456";
  socket.send(JSON.stringify({
    protocolVersion: 1,
    kind: "authenticate",
    extensionId: EXTENSION_ID,
    extensionNonce,
    proof: createClientProof({
      token: pairingToken,
      serverNonce: hello.serverNonce,
      extensionNonce,
      extensionId: EXTENSION_ID,
    }),
  }));
  const authenticated = await nextJsonMessage(socket);
  assert.equal(authenticated.kind, "authenticated");
  assert.equal(
    proofsMatch(
      createServerProof({
        token: pairingToken,
        serverNonce: hello.serverNonce,
        extensionNonce,
        extensionId: EXTENSION_ID,
        sessionId: authenticated.sessionId,
      }),
      authenticated.serverProof,
    ),
    true,
  );

  socket.send(JSON.stringify({
    protocolVersion: 1,
    kind: "pages.sync",
    pages: [{
      pageId: `${EXTENSION_ID}:1:connection-1`,
      connectionId: "connection-1",
      origin: "http://localhost:8000",
      url: "http://localhost:8000/tools/visual-board.html",
      title: "Visual Board",
      tools: ["visual-board"],
    }],
  }));
  await waitFor(() => broker.listPages().length === 1);

  const resultPromise = broker.request("listTools", { args: [] });
  const request = await nextJsonMessage(socket);
  assert.equal(request.kind, "request");
  assert.equal(request.method, "listTools");
  socket.send(JSON.stringify({
    protocolVersion: 1,
    kind: "response",
    requestId: request.requestId,
    ok: true,
    result: [{ id: "visual-board" }],
  }));
  assert.deepEqual(await resultPromise, [{ id: "visual-board" }]);
});

test("rejects non-extension WebSocket origins", async (context) => {
  const broker = new BridgeBroker({
    allowedPageOrigins: new Set(["http://localhost:8000"]),
  });
  const gateway = new WebSocketGateway({
    broker,
    pairingToken: createPairingToken(),
    port: 0,
  });
  const address = await gateway.start();
  context.after(() => gateway.close());

  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`, {
    headers: { Origin: "https://evil.example" },
  });
  const [code] = await new Promise((resolve, reject) => {
    socket.once("close", (...args) => resolve(args));
    socket.once("error", reject);
  });
  assert.equal(code, 4403);
});

function nextJsonMessage(socket) {
  return new Promise((resolve, reject) => {
    const handleMessage = (raw) => {
      cleanup();
      try {
        resolve(JSON.parse(String(raw)));
      } catch (error) {
        reject(error);
      }
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("message", handleMessage);
      socket.off("error", handleError);
    };
    socket.once("message", handleMessage);
    socket.once("error", handleError);
  });
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Condition timed out.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
