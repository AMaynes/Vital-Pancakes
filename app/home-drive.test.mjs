import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("home Google entry point opens existing storage controls and discloses WIP", () => {
  const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(home, /href="library\.html#storage" aria-describedby="home-drive-note">Sign in with Google<\/a>/);
  assert.match(home, /id="home-drive-note">Google Drive · WIP\./);
  assert.match(home, /Connecting alone does not upload entries/);
  assert.match(home, /Test accounts only/);
  const library = readFileSync(new URL("../library.html", import.meta.url), "utf8");
  assert.match(library, /app\/database-ui\.mjs/);
  assert.match(home, /site-navigation\.js\?v=21/);
  assert.match(library, /site-navigation\.js\?v=21/);
  const controller = readFileSync(new URL("./database-ui.mjs", import.meta.url), "utf8");
  assert.match(controller, /settings: params\.has\("storage"\)/);
  assert.match(controller, /await connectDrive\(config\)/);
});

test("deployed Drive configuration contains a public web client and only the limited scope", () => {
  const config = JSON.parse(readFileSync(new URL("../cloud-config.json", import.meta.url), "utf8"));
  assert.match(config.clientId, /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
  assert.equal(config.scope, "https://www.googleapis.com/auth/drive.file");
  assert.deepEqual(Object.keys(config).sort(), ["clientId", "defaultLocalDirectory", "folderName", "provider", "scope", "version"]);
});
