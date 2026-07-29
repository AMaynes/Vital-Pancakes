import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createClientProof as createBrowserClientProof,
  createServerProof as createBrowserServerProof,
} from "../extension/bridge-shared.js";
import {
  createClientProof,
  createPairingToken,
  createServerProof,
  proofsMatch,
  validatePairingToken,
} from "../src/authentication.mjs";

test("pairing tokens contain at least 256 bits", () => {
  const token = createPairingToken();
  assert.equal(validatePairingToken(token), true);
  assert.equal(Buffer.from(token, "base64url").byteLength, 32);
});

test("browser and companion produce identical mutual proofs", async () => {
  const input = {
    token: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY",
    serverNonce: "server_nonce_123456",
    extensionNonce: "extension_nonce_123456",
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    sessionId: "session-123",
  };
  assert.equal(
    await createBrowserClientProof(input),
    createClientProof(input),
  );
  assert.equal(
    await createBrowserServerProof(input),
    createServerProof(input),
  );
});

test("proof comparison rejects modified and differently sized values", () => {
  assert.equal(proofsMatch("abc", "abc"), true);
  assert.equal(proofsMatch("abc", "abd"), false);
  assert.equal(proofsMatch("abc", "abcd"), false);
});

test("short and malformed tokens are rejected", () => {
  assert.equal(validatePairingToken("short"), false);
  assert.equal(validatePairingToken("not+base64url"), false);
  assert.equal(validatePairingToken(null), false);
});
