export const BRIDGE_PROTOCOL_VERSION = 1;
export const PAGE_CHANNEL = "vital-pancakes-ai-bridge-v1";
export const DEFAULT_GATEWAY_PORT = 43871;
export const MAX_MESSAGE_CHARACTERS = 1_048_576;

export const PAGE_API_METHODS = Object.freeze([
  "listTools",
  "getCapabilities",
  "getContext",
  "dispatch",
  "undo",
  "redo",
  "exportTool",
]);

const PAGE_API_METHOD_SET = new Set(PAGE_API_METHODS);

export function isPageApiMethod(value) {
  return PAGE_API_METHOD_SET.has(value);
}

export function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

export async function createClientProof({
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

export async function createServerProof({
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
  const expectedBytes = new TextEncoder().encode(expected);
  const receivedBytes = new TextEncoder().encode(received);
  if (expectedBytes.length !== receivedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ receivedBytes[index];
  }
  return difference === 0;
}

export function isValidPairingToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/.test(token)) return false;
  try {
    return base64UrlToBytes(token).byteLength >= 32;
  } catch {
    return false;
  }
}

async function sign(token, parts) {
  const key = await crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new TextEncoder().encode(parts.map((part) => `${part}\0`).join(""));
  return bytesToBase64Url(new Uint8Array(
    await crypto.subtle.sign("HMAC", key, bytes),
  ));
}

function base64UrlToBytes(value) {
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - value.length % 4) % 4)}`;
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
