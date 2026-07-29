import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_GATEWAY_MESSAGE_BYTES,
  PAGE_API_METHODS,
} from "./constants.mjs";

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const METHODS = new Set(PAGE_API_METHODS);

export class BridgeProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BridgeProtocolError";
    this.code = code;
    this.details = details;
  }
}

export function parseJsonMessage(raw) {
  const byteLength = Buffer.isBuffer(raw)
    ? raw.byteLength
    : Buffer.byteLength(String(raw), "utf8");
  if (byteLength > MAX_GATEWAY_MESSAGE_BYTES) {
    throw new BridgeProtocolError(
      "message_too_large",
      `Bridge messages may not exceed ${MAX_GATEWAY_MESSAGE_BYTES} bytes.`,
    );
  }

  let value;
  try {
    value = JSON.parse(String(raw));
  } catch {
    throw new BridgeProtocolError("invalid_json", "The bridge message is not valid JSON.");
  }
  if (!isRecord(value)) {
    throw new BridgeProtocolError("invalid_message", "The bridge message must be an object.");
  }
  if (value.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    throw new BridgeProtocolError(
      "unsupported_protocol",
      `Bridge protocol version ${BRIDGE_PROTOCOL_VERSION} is required.`,
    );
  }
  return value;
}

export function validateAuthenticationMessage(message) {
  requireKind(message, "authenticate");
  requireId(message.extensionId, "extensionId", EXTENSION_ID_PATTERN);
  requireId(message.extensionNonce, "extensionNonce");
  requireId(message.proof, "proof");
  return message;
}

export function validateAuthenticatedMessage(message) {
  if (message.kind === "ping") return message;
  if (message.kind === "pages.sync") {
    if (!Array.isArray(message.pages) || message.pages.length > 32) {
      throw new BridgeProtocolError(
        "invalid_pages",
        "pages.sync must contain no more than 32 pages.",
      );
    }
    return {
      ...message,
      pages: message.pages.map(validatePageDescriptor),
    };
  }
  if (message.kind === "response") {
    requireId(message.requestId, "requestId");
    if (typeof message.ok !== "boolean") {
      throw new BridgeProtocolError("invalid_response", "response.ok must be boolean.");
    }
    if (!message.ok && !isRecord(message.error)) {
      throw new BridgeProtocolError(
        "invalid_response",
        "A failed response must include an error object.",
      );
    }
    return message;
  }
  if (message.kind === "event") {
    requireId(message.pageId, "pageId");
    requireId(message.name, "name");
    return message;
  }
  throw new BridgeProtocolError(
    "unknown_message_kind",
    `Unsupported authenticated message kind: ${String(message.kind)}`,
  );
}

export function validatePageDescriptor(page) {
  if (!isRecord(page)) {
    throw new BridgeProtocolError("invalid_page", "Each page must be an object.");
  }
  requireId(page.pageId, "pageId");
  requireId(page.connectionId, "connectionId");
  if (typeof page.origin !== "string" || page.origin.length > 300) {
    throw new BridgeProtocolError("invalid_page", "page.origin is invalid.");
  }
  if (typeof page.url !== "string" || page.url.length > 2_000) {
    throw new BridgeProtocolError("invalid_page", "page.url is invalid.");
  }
  if (typeof page.title !== "string" || page.title.length > 300) {
    throw new BridgeProtocolError("invalid_page", "page.title is invalid.");
  }
  if (!Array.isArray(page.tools) || page.tools.length > 128) {
    throw new BridgeProtocolError("invalid_page", "page.tools is invalid.");
  }
  const tools = page.tools.map((toolId) => {
    requireId(toolId, "toolId");
    return toolId;
  });
  return { ...page, tools };
}

export function createGatewayRequest({
  requestId,
  pageId,
  method,
  params,
  deadlineMs,
}) {
  requireId(requestId, "requestId");
  requireId(pageId, "pageId");
  if (!METHODS.has(method)) {
    throw new BridgeProtocolError("unknown_method", `Unsupported page API method: ${method}`);
  }
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    kind: "request",
    requestId,
    pageId,
    method,
    params: params ?? {},
    deadlineMs,
  };
}

export function isAllowedExtensionOrigin(origin) {
  if (typeof origin !== "string") return false;
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  return Boolean(match);
}

export function normalizeAllowedOrigins(origins) {
  const normalized = new Set();
  for (const candidate of origins ?? []) {
    try {
      const url = new URL(candidate);
      if (url.origin !== candidate || !["http:", "https:"].includes(url.protocol)) {
        throw new Error();
      }
      normalized.add(url.origin);
    } catch {
      throw new BridgeProtocolError(
        "invalid_origin",
        `Allowed page origin is invalid: ${String(candidate)}`,
      );
    }
  }
  return normalized;
}

export function assertAllowedPage(page, allowedOrigins) {
  let url;
  try {
    url = new URL(page.url);
  } catch {
    throw new BridgeProtocolError("invalid_page_url", "The page URL is invalid.");
  }
  if (url.origin !== page.origin || !allowedOrigins.has(page.origin)) {
    throw new BridgeProtocolError(
      "page_origin_denied",
      `The page origin is not allowed: ${page.origin}`,
    );
  }
}

function requireKind(message, expected) {
  if (message.kind !== expected) {
    throw new BridgeProtocolError(
      "unexpected_message",
      `Expected ${expected}, received ${String(message.kind)}.`,
    );
  }
}

function requireId(value, field, pattern = ID_PATTERN) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new BridgeProtocolError("invalid_identifier", `${field} is invalid.`, { field });
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
