import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAllowedPage,
  BridgeProtocolError,
  createGatewayRequest,
  isAllowedExtensionOrigin,
  normalizeAllowedOrigins,
  parseJsonMessage,
  validateAuthenticatedMessage,
  validateAuthenticationMessage,
} from "../src/protocol.mjs";

test("parses a versioned JSON bridge message", () => {
  assert.deepEqual(
    parseJsonMessage('{"protocolVersion":1,"kind":"ping"}'),
    { protocolVersion: 1, kind: "ping" },
  );
});

test("rejects malformed JSON and unsupported protocol versions", () => {
  assert.throws(() => parseJsonMessage("{"), BridgeProtocolError);
  assert.throws(
    () => parseJsonMessage('{"protocolVersion":2,"kind":"ping"}'),
    /version 1 is required/,
  );
});

test("validates extension identity and proof fields", () => {
  const message = {
    protocolVersion: 1,
    kind: "authenticate",
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    extensionNonce: "nonce_123456789",
    proof: "proof_123456789",
  };
  assert.equal(validateAuthenticationMessage(message), message);
  assert.throws(
    () => validateAuthenticationMessage({ ...message, extensionId: "bad" }),
    /extensionId is invalid/,
  );
});

test("allows Chrome extension origins but rejects ordinary sites", () => {
  assert.equal(
    isAllowedExtensionOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop"),
    true,
  );
  assert.equal(isAllowedExtensionOrigin("https://amaynes.github.io"), false);
  assert.equal(isAllowedExtensionOrigin("null"), false);
});

test("page origin and URL must agree with the exact allowlist", () => {
  const origins = normalizeAllowedOrigins([
    "https://amaynes.github.io",
    "http://localhost:8000",
  ]);
  const page = {
    pageId: "page-1",
    connectionId: "connection-1",
    origin: "https://amaynes.github.io",
    url: "https://amaynes.github.io/Vital-Pancakes/tools/visual-board.html",
    title: "Visual Board",
    tools: ["visual-board"],
  };
  assert.doesNotThrow(() => assertAllowedPage(page, origins));
  assert.throws(
    () => assertAllowedPage({ ...page, origin: "https://evil.example" }, origins),
    /not allowed/,
  );
});

test("gateway requests allow only frozen page API methods", () => {
  assert.equal(
    createGatewayRequest({
      requestId: "request-1",
      pageId: "page-1",
      method: "dispatch",
      params: {},
      deadlineMs: 123,
    }).method,
    "dispatch",
  );
  assert.throws(
    () => createGatewayRequest({
      requestId: "request-1",
      pageId: "page-1",
      method: "evaluateJavaScript",
      params: {},
      deadlineMs: 123,
    }),
    /Unsupported page API method/,
  );
});

test("authenticated page lists are bounded and validated", () => {
  const page = {
    pageId: "page-1",
    connectionId: "connection-1",
    origin: "http://localhost:8000",
    url: "http://localhost:8000/tools/visual-board.html",
    title: "Visual Board",
    tools: ["visual-board"],
  };
  const message = {
    protocolVersion: 1,
    kind: "pages.sync",
    pages: [page],
  };
  assert.deepEqual(validateAuthenticatedMessage(message).pages, [page]);
  assert.throws(
    () => validateAuthenticatedMessage({ ...message, pages: Array(33).fill(page) }),
    /no more than 32/,
  );
});
