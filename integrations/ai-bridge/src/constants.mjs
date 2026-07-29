export const BRIDGE_PROTOCOL_VERSION = 1;
export const PAGE_CHANNEL = "vital-pancakes-ai-bridge-v1";
export const DEFAULT_GATEWAY_PORT = 43871;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_GATEWAY_MESSAGE_BYTES = 1_048_576;

export const PAGE_API_METHODS = Object.freeze([
  "listTools",
  "getCapabilities",
  "getContext",
  "dispatch",
  "undo",
  "redo",
  "exportTool",
]);

export const DEFAULT_ALLOWED_PAGE_ORIGINS = Object.freeze([
  "https://amaynes.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

export const PERMISSIONS = Object.freeze([
  "read-summary",
  "read-content",
  "create",
  "update",
  "delete",
  "export",
  "file-access",
  "sensitive-data",
]);
