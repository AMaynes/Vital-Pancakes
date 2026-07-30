import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TOOL_HOSTS = [
  ["pdf-signer.js", "pdf-signer", ["document.describe", "placements.list"]],
  [
    "literature-analyzer.js",
    "literature-analyzer",
    ["source.describe", "annotations.list"],
  ],
  [
    "master-lesson-builder.js",
    "master-lesson-builder",
    ["books.list", "outline.get", "lesson.get"],
  ],
  [
    "literature-curator.js",
    "literature-curator",
    ["curations.list", "curations.get", "curations.upsert", "analyses.upsert"],
  ],
  [
    "travel-planner.js",
    "travel-planner",
    ["calendar.describe", "plans.list", "plans.get", "plans.upsert"],
  ],
  [
    "architecture.js",
    "software-architect",
    ["tree.describe", "nodes.get", "nodes.create", "nodes.update", "nodes.move"],
  ],
  ["file-converter.js", "file-converter", ["status.get"]],
  [
    "scientific-calculator.js",
    "scientific-calculator",
    ["expression.evaluate", "state.get", "history.list"],
  ],
  [
    "budget-finance.js",
    "budget-finance",
    [
      "budget.calculate",
      "investment.calculate",
      "loan.calculate",
      "tax.search",
      "state.get",
      "budget.current-project",
    ],
  ],
  [
    "overhead.js",
    "overhead",
    ["overhead.summary", "brain-dump.add", "tasks.upsert"],
  ],
  [
    "graphing.js",
    "graphing",
    ["dataset.describe", "chart.configure", "transformations.replace"],
  ],
  [
    "markdown-studio.js",
    "markdown-latex",
    ["documents.list", "documents.create", "documents.update"],
  ],
  [
    "tool-designer.js",
    "tool-designer",
    ["projects.list", "requirements.update", "design.update-section"],
  ],
  [
    "color-aesthetic.js",
    "color-aesthetic",
    ["palette.summary", "palette.generate", "colors.update"],
  ],
  [
    "bracket-generator.js",
    "bracket-generator",
    ["tournament.describe", "tournament.create", "match.result.set"],
  ],
  [
    "randomized-picker.js",
    "randomized-picker",
    ["picker.describe", "items.replace", "draw.run"],
  ],
];

for (const [filename, toolId, commandTypes] of TOOL_HOSTS) {
  test(`${toolId} installs its truthful page-local AI host`, async () => {
    const source = await readFile(new URL(filename, import.meta.url), "utf8");

    assert.match(source, /installCurrentToolAiHost\s*\(\s*\{/);
    assert.match(source, new RegExp(`id:\\s*["']${escapeRegExp(toolId)}["']`));
    commandTypes.forEach((commandType) => {
      assert.match(
        source,
        new RegExp(`type:\\s*["']${escapeRegExp(commandType)}["']`),
        `${commandType} must stay in the page adapter contract`,
      );
    });
  });
}

test("caption-relay installs its dedicated privacy-aware AI host", async () => {
  const [pageSource, adapterSource] = await Promise.all([
    readFile(new URL("caption-relay.js", import.meta.url), "utf8"),
    readFile(new URL("caption-relay-ai-adapter.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(
    pageSource,
    /installAiPageHost\s*\(\s*createCaptionRelayAiAdapter\s*\(/,
    "Caption Relay must install its dedicated adapter, not merely import it",
  );
  assert.equal(
    pageSource.match(/function createCaptionRelayAiController\s*\(/g)?.length,
    1,
    "Caption Relay must keep one page controller",
  );
  assert.equal(
    pageSource.match(/installAiPageHost\s*\(/g)?.length,
    1,
    "Caption Relay must install its page host once",
  );
  assert.doesNotMatch(
    pageSource,
    /AI_TRANSCRIPTION_MODELS|getCaptionRelayAiRevision|applyCaptionRelayAiCommand/,
  );
  [
    "project.create",
    "project.update-metadata",
    "cue.update",
    "timeline.correct",
    "translation.search-replace",
    "glossary.upsert",
    "glossary.remove",
  ].forEach((commandType) => {
    assert.match(
      adapterSource,
      new RegExp(`type:\\s*["']${escapeRegExp(commandType)}["']`),
      `${commandType} must stay in the Caption Relay adapter contract`,
    );
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
