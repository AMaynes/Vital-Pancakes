import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("selection toolbar uses consolidated contextual actions", async () => {
  const markup = await readFile(
    new URL("./visual-board.html", import.meta.url),
    "utf8",
  );
  const controller = await readFile(
    new URL("./visual-board.js", import.meta.url),
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
  assert.doesNotMatch(markup, /toggle-animation|animation-panel|interpolation-dialog|>Animate</);
  assert.doesNotMatch(markup, /AI Commands|open-ai-commands|ai-commands-dialog|visual-board-ai\.css/);
  assert.doesNotMatch(
    controller,
    /board\.animation|animationPanel|AnimationExport|FrameInterpolation|interpolateRifeFrames|aiCommandsEditor|openAiCommandsDialog|runAiCommandEditor/,
  );
  assert.match(controller, /installAiPageHost\(createVisualBoardAiAdapter\(/);
  assert.match(
    markup,
    /id="add-curve-vertex"[\s\S]*?>\s*-\+-\s*<span class="tool-button-label">Add vertex<\/span>/,
  );

  const saveToLibraryMarkup = markup.match(
    /<button[^>]*id="save-to-library"[\s\S]*?<\/button>/,
  )?.[0];
  const downloadSelectionMarkup = markup.match(
    /<button[^>]*id="export-character"[\s\S]*?<\/button>/,
  )?.[0];
  assert.ok(saveToLibraryMarkup);
  assert.ok(downloadSelectionMarkup);
  assert.match(saveToLibraryMarkup, /aria-label="Save selection to library"/);
  assert.match(downloadSelectionMarkup, /aria-label="Download selection"/);
  assert.match(saveToLibraryMarkup, /<svg /);
  assert.match(downloadSelectionMarkup, /<svg /);
  assert.doesNotMatch(saveToLibraryMarkup, /tool-button-label/);
  assert.doesNotMatch(downloadSelectionMarkup, /tool-button-label/);
  assert.match(
    controller,
    /mergeVerticesButton\.hidden = false;\s+mergeVerticesButton\.disabled = !canCreateVertices;/,
  );
  assert.match(
    controller,
    /exportCharacterButton\.disabled = selectedObjects\.length === 0;/,
  );
  assert.match(controller, /exportCharacterButton\.hidden = false;/);
  assert.match(controller, /lockDimensionsButton\.hidden = false;/);
  assert.match(
    controller,
    /ungroupSelectionButton\.hidden = false;\s+ungroupSelectionButton\.disabled = !canUngroup;/,
  );
  assert.match(
    controller,
    /function canCreateVertexNetwork\(objects\) \{[\s\S]*objects\.some\(\(object\) => !LINE_TYPES\.has\(object\.type\)\)/,
  );

  const groupIndex = markup.indexOf('id="group-selection"');
  const ungroupIndex = markup.indexOf('id="ungroup-selection"');
  assert.ok(groupIndex >= 0);
  assert.ok(ungroupIndex > groupIndex);
});
