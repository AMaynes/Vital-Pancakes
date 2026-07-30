import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("selection toolbar uses consolidated contextual actions", async () => {
  const markup = await readFile(
    new URL("./visual-board.html", import.meta.url),
    "utf8",
  );

  assert.match(markup, /tool-button-label">FlipH</);
  assert.match(markup, /tool-button-label">FlipV</);
  assert.match(markup, /id="line-control" data-line-picker/);
  assert.match(markup, /data-line-option="line"/);
  assert.match(markup, /data-line-option="connector"/);
  assert.match(markup, /id="toggle-arrow-start"/);
  assert.doesNotMatch(markup, /data-tool="line"/);
  assert.doesNotMatch(markup, /data-tool="connector"/);
  assert.match(markup, /data-floor-plan-tab="maintenance"/);
  assert.match(markup, /id="bucket-fill-tool"[\s\S]*aria-label="Fill closed area"/);
  assert.match(markup, /id="stroke-width" type="range" min="0\.05" max="24" step="0\.05"/);
  assert.doesNotMatch(markup, /id="curve-vertices"/);
  assert.doesNotMatch(markup, /id="reinitialize-curve-vertices"/);
  assert.doesNotMatch(markup, /id="explode-selection"/);
  assert.doesNotMatch(markup, /id="reassemble-selection"/);

  const groupIndex = markup.indexOf('id="group-selection"');
  const ungroupIndex = markup.indexOf('id="ungroup-selection"');
  assert.ok(groupIndex >= 0);
  assert.ok(ungroupIndex > groupIndex);
});
