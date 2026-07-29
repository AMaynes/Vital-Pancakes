# Repository Instructions

Be concise and preserve Vital Pancakes as a static, local-first website.

## AI command compatibility is mandatory

Every user-facing tool must remain directly usable by AI through the shared command protocol.

- When adding, removing, renaming, or changing a tool feature, update that tool's AI adapter, capability schema, examples, permissions, and contract tests in the same change.
- A new Workspace tool is incomplete until it is registered in `app/ai-tool-catalog.mjs` and exposes a truthful adapter through the shared AI page host.
- Never make an AI control a tool by simulating clicks when a domain command can express the operation.
- Keep commands semantic, batch-friendly, validated, previewable where mutation is involved, and provider-independent.
- Route ChatGPT/Codex, the JSON command console, MCP, and WebLLM through the same adapter contract. WebLLM must not mutate tool state directly.
- Do not expose private, encrypted, financial, or file content without an explicit narrow permission grant.
- Preserve versioned command compatibility or provide a migration.
- Run `node --test app/*.test.mjs tools/*.test.mjs` after changing a tool or AI command infrastructure.

The enforcement tests intentionally fail when a Workspace tool is missing from the AI catalog. Do not bypass those tests; add or update the adapter contract.
