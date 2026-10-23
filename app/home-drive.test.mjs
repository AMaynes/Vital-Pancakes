import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("home Google entry point opens existing storage controls and discloses WIP", () => {
  const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(home, /href="library\.html#storage" aria-describedby="home-drive-note">Sign in with Google<\/a>/);
  assert.match(home, /id="home-drive-note">Google Drive · WIP\./);
  assert.match(home, /Connecting alone does not upload entries/);
  const library = readFileSync(new URL("../library.html", import.meta.url), "utf8");
  assert.match(library, /app\/database-ui\.mjs/);
  const controller = readFileSync(new URL("./database-ui.mjs", import.meta.url), "utf8");
  assert.match(controller, /settings: params\.has\("storage"\)/);
  assert.match(controller, /await connectDrive\(config\)/);
});
