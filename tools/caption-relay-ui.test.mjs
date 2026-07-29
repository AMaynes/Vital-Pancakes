import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("./caption-relay.html", import.meta.url);
const scriptUrl = new URL("./caption-relay.js", import.meta.url);

test("Capture and Translate expose coherent caption-page controls", async () => {
  const [html, source] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(scriptUrl, "utf8"),
  ]);

  for (const id of [
    "cue-page-previous",
    "cue-page-status",
    "cue-page-next",
    "translation-cue-page-previous",
    "translation-cue-page-status",
    "translation-cue-page-next",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /aria-label="Translation review pages"/);
  assert.match(source, /const PAGE_SIZE = 100;/);
  assert.match(source, /translation-cue-page-previous.+changeCuePage\(-1\)/);
  assert.match(source, /translation-cue-page-next.+changeCuePage\(1\)/);
  assert.match(source, /\["translation-cue-page-previous", "translation-cue-page-status", "translation-cue-page-next"\]/);
});

test("Caption Relay connects overlay closure to a restartable display clock", async () => {
  const source = await readFile(scriptUrl, "utf8");

  assert.match(source, /new CaptionOverlay\(\{ onClose: handleOverlayClosed \}\)/);
  assert.match(source, /new CaptionDisplayClock\(\{ tick: updateDisplayedCaption \}\)/);
  assert.match(source, /window\.addEventListener\("pagehide", stopDisplayClock/);
  assert.match(source, /function handleOverlayClosed\(\)[\s\S]*stopDisplayClock\(\)/);
});
