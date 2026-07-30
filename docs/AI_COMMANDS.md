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

## Knowledge Home commands

The homepage installs the `knowledge-home` adapter. It exposes bounded
`knowledge.search` and `knowledge.related` reads, glossary list/upsert/delete,
and relationship list/propose/add/review commands. AI-proposed relationships
remain pending until a user or approved command explicitly accepts them.
`vault.summary` returns storage counts only; archive passwords, private records,
file names, and file bytes are never exposed through the command contract.

```json
{
  "protocolVersion": 1,
  "requestId": "knowledge-search-1",
  "tool": "knowledge-home",
  "mode": "preview",
  "expectedRevision": 4,
  "commands": [
    {
      "type": "knowledge.search",
      "query": "synaptic plasticity",
      "limit": 10
    }
  ]
}
```

## Adaptive Review commands

The `master-lesson-builder` adapter exposes review summaries and card lists,
lesson-to-card synchronization, card create/update/delete, FSRS ratings, and
review-setting updates. Mutations participate in the same preview-first,
revision-checked atomic commit as lesson changes. Review content is limited to
the active local book.

## Visual Board examples

Replace `expectedRevision` with the current Visual Board revision. Preview and
review the receipt before changing `mode` to `apply`.

### Editable curve points and shared joints

`curves.points.insert` adds each requested world-coordinate point at the nearest
place on one target arc without flattening or replacing the curve.
`vertices.create` keeps line and curve targets editable, inserts vertices at
their crossings, and assigns one shared vertex ID to every incident path.

```json
{
  "protocolVersion": 1,
  "requestId": "curve-joints-1",
  "tool": "visual-board",
  "mode": "preview",
  "expectedRevision": 42,
  "commands": [
    {
      "type": "curves.points.insert",
      "targets": { "ids": ["curve-id-from-context"] },
      "points": [{ "x": 420, "y": 260 }]
    },
    {
      "type": "vertices.create",
      "targets": { "ids": ["curve-id-from-context", "line-id-from-context"] }
    }
  ]
}
```

### User-owned floor-plan templates

The Floor Plan panel can save selected vector objects as reusable templates.
Templates can be listed, created, renamed, replaced from explicit targets,
inserted, removed, and restored through the same adapter:

- `floor-plan.templates.list`
- `floor-plan.templates.create`
- `floor-plan.templates.update`
- `floor-plan.templates.replace`
- `floor-plan.templates.insert`
- `floor-plan.templates.remove`
- `floor-plan.templates.restore`

Built-in starter IDs can be replaced or hidden without modifying their bundled
definitions; `restore` discards the replacement and makes the default visible
again. Template contents remain editable and relationship-preserving. Raster
images are rejected and should use the general Board Library instead.

```json
{
  "protocolVersion": 1,
  "requestId": "save-floor-plan-template-1",
  "tool": "visual-board",
  "mode": "preview",
  "expectedRevision": 42,
  "commands": [
    {
      "type": "floor-plan.templates.create",
      "templateId": "courtyard-bedroom",
      "name": "Courtyard bedroom",
      "description": "Bedroom block with ensuite and garden doors.",
      "targets": { "selection": true }
    },
    {
      "type": "floor-plan.templates.insert",
      "templateId": "courtyard-bedroom",
      "placement": { "type": "point", "x": 900, "y": 400 }
    }
  ]
}
```

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

### Exact architectural geometry

Visual Board publishes its current layer, material, fill-pattern, and vector-symbol
catalog through `getCapabilities()`. Architectural commands are deterministic:

- `architecture.areas.create` and `architecture.paths.create` add exact polygonal
  or curved caller-authored material regions.
- `architecture.walls.create` adds independent segments.
  `architecture.wallPaths.create` compiles connected runs, join/cap patches, and
  genuine door/window gaps from explicit points and opening intervals.
- `architecture.openings.create`, `architecture.symbols.place`,
  `architecture.labels.create`, and `architecture.dimensions.create` add exact
  caller-supplied detail. Symbols preserve catalog proportions unless `fit` is
  explicitly `stretch`.
- `architecture.style.set`, `architecture.materials.apply`, and
  `architecture.layers.set` change the explicit drawing system or targets.
- `architecture.references.configure` turns existing local images into locked,
  optionally export-hidden tracing references only with `consent: true`. Image
  bytes are never included in AI context.
- `architecture.inspect` returns bounded geometry and polygon-aware overlaps.
  `architecture.validate` reports wall connectivity, room access, label
  collisions, clearances, and symbol distortion. Both are query-only.

The renderer does not choose a plan, infer rooms, place furniture, reroute walls,
or improve a design. The calling model is the architect; Visual Board only
validates, previews, renders, measures, and atomically applies its instructions.
Labels use board-coordinate font sizes, so camera zoom does not resize or reflow
them.

This preview creates one compact room fragment and inspects objects created
earlier in the same batch through stable client keys:

```json
{
  "protocolVersion": 1,
  "requestId": "example-architecture-1",
  "tool": "visual-board",
  "mode": "preview",
  "expectedRevision": 42,
  "commands": [
    {
      "type": "architecture.areas.create",
      "areas": [
        {
          "clientKey": "room-floor",
          "vertices": [
            {"x": 100, "y": 100}, {"x": 460, "y": 100},
            {"x": 460, "y": 360}, {"x": 100, "y": 360}
          ],
          "materialId": "hardwood",
          "layerId": "materials"
        }
      ]
    },
    {
      "type": "architecture.wallPaths.create",
      "wallPaths": [
        {
          "clientKey": "room-shell",
          "points": [
            { "x": 100, "y": 100 }, { "x": 460, "y": 100 },
            { "x": 460, "y": 360 }, { "x": 100, "y": 360 }
          ],
          "closed": true,
          "thickness": 12,
          "join": "miter",
          "materialId": "plaster",
          "openings": [
            {
              "segmentIndex": 0,
              "offset": 180,
              "width": 90,
              "kind": "door-french"
            }
          ],
          "layerId": "structure",
          "style": { "lineWeight": "exterior" }
        }
      ]
    },
    {
      "type": "architecture.symbols.place",
      "symbols": [
        {
          "clientKey": "bed",
          "symbolId": "bed-queen",
          "x": 260,
          "y": 145,
          "w": 120,
          "h": 168,
          "rotation": 0,
          "layerId": "furniture",
          "zIndex": 10
        }
      ]
    },
    {
      "type": "architecture.inspect",
      "targets": {
        "clientKeys": ["room-floor", "bed"],
        "wallPathId": "room-shell"
      },
      "includeIntersections": true,
      "includeConnectivity": true
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
