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
  assert.doesNotMatch(markup, /id="curve-vertices"/);
  assert.doesNotMatch(markup, /id="reinitialize-curve-vertices"/);
  assert.doesNotMatch(markup, /id="explode-selection"/);
  assert.doesNotMatch(markup, /id="reassemble-selection"/);

  const groupIndex = markup.indexOf('id="group-selection"');
  const ungroupIndex = markup.indexOf('id="ungroup-selection"');
  assert.ok(groupIndex >= 0);
  assert.ok(ungroupIndex > groupIndex);
});
