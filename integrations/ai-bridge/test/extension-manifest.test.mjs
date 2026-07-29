import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const EXTENSION_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../extension",
);

test("MV3 extension stays narrowly scoped and references local files", async () => {
  const manifest = JSON.parse(await readFile(
    resolve(EXTENSION_DIRECTORY, "manifest.json"),
    "utf8",
  ));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "tabs"]);
  assert.equal(manifest.permissions.includes("scripting"), false);
  assert.deepEqual(manifest.host_permissions, [
    "https://amaynes.github.io/Vital-Pancakes/*",
    "http://localhost/*",
    "http://127.0.0.1/*",
  ]);
  assert.match(
    manifest.content_security_policy.extension_pages,
    /connect-src 'self' ws:\/\/127\.0\.0\.1:\*/,
  );

  const referencedFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...manifest.content_scripts.flatMap((contentScript) => contentScript.js),
  ];
  await Promise.all(
    referencedFiles.map((path) => access(resolve(EXTENSION_DIRECTORY, path))),
  );
});

test("extension source contains no dynamic script execution path", async () => {
  const sources = await Promise.all([
    "background.js",
    "content-bridge.js",
    "bridge-shared.js",
    "permission-policy.js",
  ].map((path) => readFile(resolve(EXTENSION_DIRECTORY, path), "utf8")));
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /\beval\s*\(/u);
  assert.doesNotMatch(combined, /\bnew\s+Function\s*\(/u);
  assert.doesNotMatch(combined, /chrome\.scripting/u);
});
