# Vital Pancakes AI Bridge

This optional local companion lets MCP clients call the same validated AI command API used by Vital Pancakes itself. The website stays static and works without this integration.

```text
Local MCP client
    │ stdio
    ▼
Vital Pancakes MCP server
    │ authenticated WebSocket on 127.0.0.1
    ▼
Chrome extension
    │ private MessageChannel
    ▼
window.VitalPancakesAI
```

The integration is intentionally local. It does not provide a public HTTP endpoint and does not make a browser tab available until the user explicitly connects that tab from the extension.

## Requirements

- Node.js 20 or newer.
- Chrome 116 or newer.
- A Vital Pancakes page that installs the shared `window.VitalPancakesAI` page host.
- A local MCP client that supports stdio servers, such as Codex.

## Setup

From this directory:

```bash
npm install
npm run setup
```

The setup command creates a private configuration file and prints a pairing token. The default locations are:

- macOS/Linux: `~/.config/vital-pancakes/ai-bridge.json`
- Windows: `%APPDATA%\VitalPancakes\ai-bridge.json`

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory’s `extension/` folder.
4. Open the extension’s **Details → Extension options**.
5. Paste the pairing token and save.
6. Configure the MCP client to launch `src/index.mjs`.

For Codex, use an absolute path:

```bash
codex mcp add vital-pancakes -- node /absolute/path/to/integrations/ai-bridge/src/index.mjs
```

Restart the MCP client after adding the server. Open Vital Pancakes, select the extension, choose the permission ceiling for this connection, and choose **Connect this tab**. The default permits summaries and full-content reads only. Create, update, delete, export, selected-file, and sensitive-data access must each be checked explicitly.

Tab connections and their permission ceilings stay only in extension service-worker memory. They are cleared on disconnect and are intentionally not remembered across browser/extension restarts.

To revoke the extension’s current token and create a replacement:

```bash
npm run setup -- --force
```

Paste the replacement into the extension options. The old token stops working immediately the next time the companion starts.

## MCP tools

The server exposes a small semantic surface:

| Tool | Page API method | Purpose |
|---|---|---|
| `vp_list_tools` | `listTools()` | List connected pages and truthful tool registrations. |
| `vp_get_capabilities` | `getCapabilities(toolId)` | Read commands, schemas, permissions, examples, and limits. |
| `vp_get_context` | `getContext(toolId, options)` | Read bounded, permission-filtered context. |
| `vp_preview_commands` | `dispatch(envelope, permissions)` | Preview an envelope whose mode is `preview`. |
| `vp_apply_commands` | `dispatch(envelope, permissions)` | Apply an envelope whose mode is `apply`. |
| `vp_undo` | `undo(toolId)` | Undo when the adapter supports it. |
| `vp_redo` | `redo(toolId)` | Redo when the adapter supports it. |
| `vp_export` | `exportTool(toolId, options)` | Request an adapter-approved export. |

The MCP server does not contain tool-specific business logic. It transports calls to the active page, where the shared registry validates permissions, revisions, limits, preview behavior, and atomic mutations. Permission names supplied in MCP arguments are requests, not authorization: the extension rejects requests beyond the user-selected per-tab ceiling and replaces forwarded permissions with that ceiling.

## Page host contract

The Vital Pancakes page owns a frozen API:

```js
window.VitalPancakesAI = Object.freeze({
  listTools,
  getCapabilities,
  getContext,
  dispatch,
  undo,
  redo,
  exportTool,
});
```

The extension never injects executable source and cannot directly read this page-world object from its isolated content-script world. Instead, it opens a `MessageChannel`.

### Connect

The content script transfers a port with:

```json
{
  "channel": "vital-pancakes-ai-bridge-v1",
  "kind": "connect",
  "connectionId": "random-page-connection-id"
}
```

The page accepts only messages where `event.source === window`, `event.origin === location.origin`, the channel matches, and exactly one `MessagePort` is transferred. It replies on that port:

```json
{
  "channel": "vital-pancakes-ai-bridge-v1",
  "kind": "ready",
  "connectionId": "random-page-connection-id",
  "page": {
    "protocolVersion": 1,
    "title": "Visual Board",
    "tools": ["visual-board"]
  }
}
```

### Request and response

Each request names only an allowlisted frozen API method. `params.args` is its positional argument list:

```json
{
  "channel": "vital-pancakes-ai-bridge-v1",
  "kind": "request",
  "requestId": "request-uuid",
  "method": "getCapabilities",
  "params": {
    "args": ["visual-board"]
  }
}
```

The page responds:

```json
{
  "channel": "vital-pancakes-ai-bridge-v1",
  "kind": "response",
  "requestId": "request-uuid",
  "ok": true,
  "result": {}
}
```

Failures use:

```json
{
  "channel": "vital-pancakes-ai-bridge-v1",
  "kind": "response",
  "requestId": "request-uuid",
  "ok": false,
  "error": {
    "code": "machine_readable_code",
    "message": "Concise safe explanation"
  }
}
```

The page should handle `kind: "cancel"` by aborting work when possible. Unknown methods, malformed arguments, missing permissions, stale revisions, and unsupported adapter operations must fail inside the page API rather than falling back to DOM clicks.

## Extension-to-companion protocol

The extension connects to `ws://127.0.0.1:43871` by default. Every JSON message carries `protocolVersion: 1`; binary messages and messages larger than 1 MiB are rejected.

### Authentication

1. The companion sends `hello` with a 256-bit `serverNonce`.
2. The extension sends `authenticate` with its Chrome extension ID, a 256-bit `extensionNonce`, and an HMAC-SHA-256 client proof.
3. The companion checks that the extension ID matches the WebSocket `Origin`, verifies the proof with a timing-safe comparison, and returns an authenticated session ID plus a server proof.
4. The extension verifies the server proof before exposing any pages.

The token itself never crosses the WebSocket. A heartbeat message every 20 seconds keeps the MV3 service worker connection active and detects restarts.

### Page registration

After authentication, the extension sends:

```json
{
  "protocolVersion": 1,
  "kind": "pages.sync",
  "pages": [
    {
      "pageId": "extension-id:tab-id:connection-id",
      "connectionId": "connection-id",
      "origin": "https://amaynes.github.io",
      "url": "https://amaynes.github.io/Vital-Pancakes/tools/visual-board.html",
      "title": "Visual Board",
      "tools": ["visual-board"]
    }
  ]
}
```

Only tabs explicitly connected in the extension are included. The companion independently checks each reported page against its configured origin allowlist.

### Routed request

The companion sends a request with a deadline:

```json
{
  "protocolVersion": 1,
  "kind": "request",
  "requestId": "request-uuid",
  "pageId": "extension-id:tab-id:connection-id",
  "method": "dispatch",
  "params": {
    "args": [
      {
        "protocolVersion": 1,
        "requestId": "command-request-id",
        "tool": "visual-board",
        "mode": "preview",
        "commands": []
      },
      {
        "grantedPermissions": ["read-summary"]
      }
    ]
  },
  "deadlineMs": 1785260000000
}
```

The extension routes it only to the matching connected page. Responses return the same `requestId`. Timeouts generate `cancel`; retries remain safe because command-envelope request IDs and page revisions are enforced by the shared command protocol.

## Security boundaries

- The gateway binds only to `127.0.0.1`, never `0.0.0.0`.
- WebSocket handshakes require a syntactically valid `chrome-extension://` Origin.
- Mutual HMAC authentication prevents another local web page or an unpaired extension from using the gateway.
- The extension manifest can run only on the Vital Pancakes GitHub Pages path and loopback development pages.
- A tab must be explicitly connected by the user.
- Each connected tab has a user-selected, in-memory permission ceiling. The default is read-only.
- MCP arguments cannot self-grant permissions; the extension enforces and injects the session ceiling before page delivery.
- The extension forwards only the seven frozen API methods.
- No `eval`, injected source, arbitrary page scripting, raw storage access, or general filesystem access is provided.
- The page API remains the final authority for permissions and destructive confirmations.
- Pairing tokens live outside the repository and should never be committed or included in logs.
- Large payloads, excessive pages, invalid identifiers, stale connections, timeouts, and unsupported origins are rejected.

The pairing token protects the local transport. It does not replace narrow page-level permissions. Sensitive, encrypted, financial, and file content must still require explicit grants in the Vital Pancakes adapter.

## Configuration

The companion accepts these environment overrides:

| Variable | Purpose |
|---|---|
| `VP_AI_BRIDGE_CONFIG` | Absolute path to a different configuration file. |
| `VP_AI_BRIDGE_TOKEN` | Pairing token override, useful for isolated tests. |
| `VP_AI_BRIDGE_PORT` | Loopback gateway port. |
| `VP_AI_BRIDGE_ALLOWED_ORIGINS` | Comma-separated exact page origins. |

The extension gateway port must match the companion. The extension’s website access remains limited by `manifest.json`, regardless of companion configuration.

## Verification

Run deterministic unit and loopback integration tests:

```bash
npm test
```

Exercise the MCP surface with the official Inspector:

```bash
npm run inspect
```

Local checks can verify:

- Pairing proof generation and mutual verification.
- Origin rejection.
- Message limits and validation.
- Page registration.
- Request routing, response correlation, cancellation, disconnects, and timeouts.
- MCP tool discovery and calls through stdio.
- An unpacked extension connected to a locally served Vital Pancakes page.

A public deployment is neither required nor desirable for this local bridge. OpenAI’s Responses API connects to remote MCP servers over Streamable HTTP, so it cannot directly call this loopback stdio server. A future remote integration would require a separately authorized Streamable HTTP deployment or secure tunnel and a new threat review; it should not silently expose this local gateway.

## Dependencies

- `@modelcontextprotocol/server` — official MCP TypeScript server SDK.
- `zod` — MCP input-schema validation.
- `ws` — mature WebSocket framing for the loopback gateway.

The gateway deliberately uses `ws` instead of implementing security-sensitive WebSocket framing itself.

Current protocol references:

- [OpenAI MCP and connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [MCP specification](https://modelcontextprotocol.io/specification/latest)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)
