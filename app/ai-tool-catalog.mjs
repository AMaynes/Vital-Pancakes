/**
 * Canonical inventory of AI-addressable Vital Pancakes surfaces.
 */

export const CURRENT_AI_TOOLS = Object.freeze([
  current(
    "caption-relay",
    "Caption Relay",
    "tools/caption-relay.html",
    "tools/caption-relay-ai-adapter.mjs",
  ),
]);

export const PLANNED_AI_TOOL_CONTRACTS = Object.freeze([]);

export const AI_TOOL_CATALOG = Object.freeze([
  ...CURRENT_AI_TOOLS,
  ...PLANNED_AI_TOOL_CONTRACTS,
]);

export function findAiTool(toolId) {
  return AI_TOOL_CATALOG.find((tool) => tool.id === toolId) ?? null;
}

function current(id, title, route, adapterModule) {
  return Object.freeze({
    id,
    title,
    route,
    adapterModule,
    available: true,
  });
}
