# AI Commands

Vital Pancakes exposes one provider-independent command contract to the JSON
editor, local WebLLM, ChatGPT/Codex through MCP, and other approved clients.
Models draft semantic commands; each tool's adapter remains responsible for
validation, permissions, preview, and mutation.

## Shared protocol

The command path is:

1. `app/ai-command-protocol.mjs` validates the transport envelope.
2. `app/ai-command-registry.mjs` checks the tool, permissions, request ID, and revision.
3. A page-local adapter validates domain fields and previews or applies the batch.
4. `app/ai-page-host.mjs` exposes the frozen `window.VitalPancakesAI` API.
5. `app/ai-tool-catalog.mjs` records which Workspace tools have current contracts.

```json
{
  "protocolVersion": 1,
  "requestId": "unique-request-id",
  "tool": "visual-board",
  "mode": "preview",
  "expectedRevision": 42,
  "commands": [
    {
      "type": "objects.create",
      "objects": [
        { "objectType": "rectangle", "x": 100, "y": 100, "w": 180, "h": 100 }
      ]
    }
  ]
}
```

- Use `preview` first. It must not change live state.
- For an approved mutation, resend the validated envelope as `apply`.
- Include the revision returned by `listTools()` so stale commands are rejected.
- Reusing an applied `requestId` with identical content is idempotent; different
  content with that ID is rejected.
- Permissions are narrow capabilities: `read-summary`, `read-content`, `create`,
  `update`, `delete`, `export`, `file-access`, and `sensitive-data`.
- Receipts report revisions, affected IDs, client-key mappings, warnings, and
  command-specific results. They never prove an action that the adapter did not perform.

## Adapter checklist

When a user-facing tool or feature changes:

- Register its stable ID, route, and adapter in `app/ai-tool-catalog.mjs`.
- Install the adapter through `installAiPageHost`; do not automate DOM clicks.
- Publish truthful command names, fields, permissions, limits, and examples.
- Return bounded context; omit file bytes and private content by default.
- Validate every untrusted field against an allowlist and cap payload sizes.
- Execute batches on cloned state. Preview saves nothing; apply crosses one
  atomic commit boundary only after every command succeeds.
- Expose a revision that changes when ordinary UI edits change tool state.
- Use client keys for references to objects created earlier in the same batch.
- Require explicit permission for destructive, file, export, financial, or
  sensitive operations.
- Update adapter tests and run the maintained Node suites before merging.

## Visual Board examples

Replace `expectedRevision` with the current Visual Board revision. Preview and
review the receipt before changing `mode` to `apply`.

### Flowchart

```json
{
  "protocolVersion": 1,
  "requestId": "example-flowchart-1",
  "tool": "visual-board",
  "mode": "preview",
  "expectedRevision": 42,
  "commands": [
    {
      "type": "diagram.create",
      "diagramType": "flowchart",
      "direction": "vertical",
      "nodes": [
        { "key": "start", "label": "Collect evidence" },
        { "key": "review", "label": "Review evidence" },
        { "key": "decide", "label": "Make decision" }
      ],
      "edges": [
        { "from": "start", "to": "review" },
        { "from": "review", "to": "decide" }
      ],
      "placement": { "type": "viewport-center" },
      "stylePreset": "archival"
    }
  ]
}
```

### Mind map

```json
{
  "protocolVersion": 1,
  "requestId": "example-mind-map-1",
  "tool": "visual-board",
  "mode": "preview",
  "expectedRevision": 42,
  "commands": [
    {
      "type": "diagram.create",
      "diagramType": "mind-map",
      "topic": "Photosynthesis",
      "branches": [
        {
          "label": "Light-dependent reactions",
          "children": ["Water splitting", "ATP", "NADPH"]
        },
        {
          "label": "Calvin cycle",
          "children": ["Carbon fixation", "G3P", "Glucose"]
        }
      ],
      "placement": { "type": "viewport-center" },
      "stylePreset": "archival"
    }
  ]
}
```

## WebLLM Command Center

Open **Workspace → AI Command Center** to:

1. Select an AI-capable tool and inspect its live capabilities and bounded context.
2. Optionally load a local WebGPU model and ask it to draft command JSON.
3. Preview the normalized envelope, inspect the live tool and receipt, then
   explicitly apply it. Delete-capable envelopes receive an additional confirmation.

WebLLM only drafts. The selected tool's normal adapter performs validation and
mutation, so manual JSON, WebLLM, and connected clients follow the same rules.
Prompt content stays in the browser; including tool content is an explicit option.

## Local MCP bridge

The optional bridge connects an MCP client to a user-approved browser tab over
an authenticated loopback connection. It is not a public website endpoint.
Follow the [local MCP bridge setup guide](../integrations/ai-bridge/README.md)
for dependency installation, pairing, Chrome extension setup, and client configuration.

## Tests and CI

Run the same suites enforced by `.github/workflows/node-tests.yml`:

```sh
node --test app/*.test.mjs tools/*.test.mjs
npm ci --prefix integrations/ai-bridge
npm test --prefix integrations/ai-bridge
```

The catalog and integration tests intentionally fail when a Workspace tool
route lacks a catalog entry, adapter module, or page-host installation.
