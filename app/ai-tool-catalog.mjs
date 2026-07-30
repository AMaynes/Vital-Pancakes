/**
 * Canonical inventory of AI-addressable Vital Pancakes surfaces.
 *
 * The adjacent enforcement test compares this catalog to the Workspace cards.
 * Adding a tool without an AI contract therefore fails the maintained suite.
 */

export const CURRENT_AI_TOOLS = Object.freeze([
  current("knowledge-home", "Knowledge Home", "index.html", "app/home-knowledge-ai-adapter.mjs"),
  current("workspace", "Workspace Libraries", "workspace.html", "app/workspace-ai-adapter.mjs"),
  current("ai-command-center", "AI Command Center", "tools/ai-command-center.html", "tools/ai-command-center-adapter.mjs"),
  current("visual-board", "Visual Board", "tools/visual-board.html", "tools/visual-board-ai-adapter.mjs"),
  current("overhead", "Overhead", "tools/overhead.html", "tools/current-tool-ai-adapter.mjs"),
  current("graphing", "Graphing Tool", "tools/graphing.html", "tools/current-tool-ai-adapter.mjs"),
  current("inference", "Inference Tool", "tools/inference.html", "tools/current-tool-ai-adapter.mjs"),
  current("markdown-latex", "Markdown & LaTeX Studio", "tools/markdown-studio.html", "tools/current-tool-ai-adapter.mjs"),
  current("tool-designer", "Tool Designer & Planner", "tools/tool-designer.html", "tools/current-tool-ai-adapter.mjs"),
  current("color-aesthetic", "Color Aesthetic Generator", "tools/color-aesthetic.html", "tools/current-tool-ai-adapter.mjs"),
  current("bracket-generator", "Bracket Generator", "tools/bracket-generator.html", "tools/current-tool-ai-adapter.mjs"),
  current("randomized-picker", "Randomized Picker", "tools/randomized-picker.html", "tools/current-tool-ai-adapter.mjs"),
  current("pdf-signer", "PDF Signer", "tools/pdf-signer.html", "tools/current-tool-ai-adapter.mjs"),
  current("literature-analyzer", "Literature Analyzer", "tools/literature-analyzer.html", "tools/current-tool-ai-adapter.mjs"),
  current("master-lesson-builder", "Master Lesson Builder", "tools/master-lesson-builder.html", "tools/current-tool-ai-adapter.mjs"),
  current("literature-curator", "Literature Curation", "tools/literature-curator.html", "tools/current-tool-ai-adapter.mjs"),
  current("travel-planner", "Travel Planner", "tools/travel-planner.html", "tools/current-tool-ai-adapter.mjs"),
  current("software-architect", "Software Architect", "tools/architecture.html", "tools/current-tool-ai-adapter.mjs"),
  current("file-converter", "File Converter", "tools/file-converter.html", "tools/current-tool-ai-adapter.mjs"),
  current("scientific-calculator", "Scientific Calculator", "tools/scientific-calculator.html", "tools/current-tool-ai-adapter.mjs"),
  current("budget-finance", "Budget & Finance", "tools/budget-finance.html", "tools/current-tool-ai-adapter.mjs"),
  current("caption-relay", "Caption Relay", "tools/caption-relay.html", "tools/caption-relay-ai-adapter.mjs"),
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

function planned(id, title) {
  return Object.freeze({
    id,
    title,
    route: null,
    adapterModule: null,
    available: false,
  });
}
