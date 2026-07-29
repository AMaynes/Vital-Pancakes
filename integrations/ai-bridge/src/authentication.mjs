import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export function createPairingToken() {
  return randomBytes(32).toString("base64url");
}

export function createNonce() {
  return randomBytes(32).toString("base64url");
}

export function validatePairingToken(token) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
  try {
    return Buffer.from(token, "base64url").byteLength >= 32;
  } catch {
    return false;
  }
}

function sign(token, parts) {
  const key = Buffer.from(token, "base64url");
  const hmac = createHmac("sha256", key);
  for (const part of parts) {
    hmac.update(String(part));
    hmac.update("\0");
  }
  return hmac.digest("base64url");
}

export function createClientProof({
  token,
  serverNonce,
  extensionNonce,
  extensionId,
}) {
  return sign(token, [
    "vital-pancakes-client-proof-v1",
    serverNonce,
    extensionNonce,
    extensionId,
  ]);
}

export function createServerProof({
  token,
  serverNonce,
  extensionNonce,
  extensionId,
  sessionId,
}) {
  return sign(token, [
    "vital-pancakes-server-proof-v1",
    serverNonce,
    extensionNonce,
    extensionId,
    sessionId,
  ]);
}

export function proofsMatch(expected, received) {
  if (typeof expected !== "string" || typeof received !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length
    && timingSafeEqual(expectedBytes, receivedBytes);
}
