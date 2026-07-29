import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Draw button does not pass its MouseEvent into the draw request", async () => {
  const source = await readFile(new URL("randomized-picker.js", import.meta.url), "utf8");

  assert.match(
    source,
    /picker-draw"\)\.addEventListener\("click",\s*\(\)\s*=>\s*draw\(\)\)/,
  );
  assert.doesNotMatch(
    source,
    /picker-draw"\)\.addEventListener\("click",\s*draw\)/,
  );
});
