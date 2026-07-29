import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_GATEWAY_MESSAGE_BYTES,
} from "./constants.mjs";
import {
  createNonce,
  createServerProof,
  createClientProof,
  proofsMatch,
} from "./authentication.mjs";
import {
  BridgeProtocolError,
  isAllowedExtensionOrigin,
  parseJsonMessage,
  validateAuthenticatedMessage,
  validateAuthenticationMessage,
} from "./protocol.mjs";

const AUTHENTICATION_TIMEOUT_MS = 5_000;

export class WebSocketGateway {
  #broker;
  #pairingToken;
  #port;
  #server = null;

  constructor({ broker, pairingToken, port }) {
    this.#broker = broker;
    this.#pairingToken = pairingToken;
    this.#port = port;
  }

  async start() {
    if (this.#server) throw new Error("The WebSocket gateway is already running.");
    const server = new WebSocketServer({
      host: "127.0.0.1",
      port: this.#port,
      maxPayload: MAX_GATEWAY_MESSAGE_BYTES,
      perMessageDeflate: false,
      clientTracking: true,
    });
    this.#server = server;
    server.on("connection", (socket, request) => this.#accept(socket, request));
    await new Promise((resolve, reject) => {
      const handleListening = () => {
        server.off("error", handleError);
        resolve();
      };
      const handleError = (error) => {
        server.off("listening", handleListening);
        reject(error);
      };
      server.once("listening", handleListening);
      server.once("error", handleError);
    });
    return this.address();
  }

  address() {
    const address = this.#server?.address();
    return typeof address === "object" && address
      ? { host: address.address, port: address.port }
      : null;
  }

  async close() {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    for (const socket of server.clients) socket.close(1001, "Bridge server stopping.");
    await new Promise((resolve) => server.close(resolve));
  }

  #accept(socket, request) {
    const origin = request.headers.origin;
    if (!isAllowedExtensionOrigin(origin)) {
      socket.close(4403, "Chrome extension origin required.");
      return;
    }
    const extensionIdFromOrigin = origin.slice("chrome-extension://".length);
    const serverNonce = createNonce();
    let isAuthenticated = false;
    let connection = null;
    const authenticationTimer = setTimeout(() => {
      socket.close(4408, "Authentication timed out.");
    }, AUTHENTICATION_TIMEOUT_MS);
    authenticationTimer.unref?.();

    sendSocketMessage(socket, {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      kind: "hello",
      serverNonce,
      authentication: "hmac-sha256",
    });

    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        socket.close(4400, "Binary bridge messages are not supported.");
        return;
      }
      try {
        const message = parseJsonMessage(raw);
        if (!isAuthenticated) {
          const auth = validateAuthenticationMessage(message);
          if (auth.extensionId !== extensionIdFromOrigin) {
            throw new BridgeProtocolError(
              "extension_origin_mismatch",
              "The extension ID does not match the WebSocket Origin.",
            );
          }
          const expectedProof = createClientProof({
            token: this.#pairingToken,
            serverNonce,
            extensionNonce: auth.extensionNonce,
            extensionId: auth.extensionId,
          });
          if (!proofsMatch(expectedProof, auth.proof)) {
            socket.close(4401, "Pairing token rejected.");
            return;
          }

          clearTimeout(authenticationTimer);
          isAuthenticated = true;
          const sessionId = randomUUID();
          connection = Object.freeze({
            sessionId,
            extensionId: auth.extensionId,
            send: (payload) => sendSocketMessage(socket, payload),
            close: (code, reason) => socket.close(code, reason),
          });
          this.#broker.attachConnection(connection);
          sendSocketMessage(socket, {
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            kind: "authenticated",
            sessionId,
            serverProof: createServerProof({
              token: this.#pairingToken,
              serverNonce,
              extensionNonce: auth.extensionNonce,
              extensionId: auth.extensionId,
              sessionId,
            }),
          });
          return;
        }

        const validated = validateAuthenticatedMessage(message);
        if (validated.kind === "ping") {
          sendSocketMessage(socket, {
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            kind: "pong",
            sentAt: validated.sentAt,
          });
        } else if (validated.kind === "pages.sync") {
          this.#broker.syncPages(connection, validated.pages);
        } else if (validated.kind === "response") {
          this.#broker.handleResponse(connection, validated);
        } else if (validated.kind === "event" && validated.name === "page.active") {
          this.#broker.setActivePage(connection, validated.pageId);
        }
      } catch (error) {
        const code = error instanceof BridgeProtocolError ? error.code : "bridge_failure";
        sendSocketMessage(socket, {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          kind: "error",
          error: {
            code,
            message: error instanceof Error ? error.message : "Bridge request failed.",
          },
        });
        if (!isAuthenticated) socket.close(4400, "Invalid authentication message.");
      }
    });

    socket.on("close", () => {
      clearTimeout(authenticationTimer);
      if (connection) this.#broker.detachConnection(connection);
    });
    socket.on("error", () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1011, "WebSocket transport failed.");
      }
    });
  }
}

function sendSocketMessage(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error("The browser bridge WebSocket is not open.");
  }
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > MAX_GATEWAY_MESSAGE_BYTES) {
    throw new BridgeProtocolError(
      "message_too_large",
      `Bridge messages may not exceed ${MAX_GATEWAY_MESSAGE_BYTES} bytes.`,
    );
  }
  socket.send(serialized);
}
