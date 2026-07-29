import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(toolsDirectory, "file-converter-app");

test("bundled format cache retains the complete upstream conversion graph", async () => {
  const cache = JSON.parse(await readFile(resolve(appDirectory, "cache.json"), "utf8"));
  const handlerNames = cache.map(([name]) => name);
  const formatCount = cache.reduce((total, [, formats]) => total + formats.length, 0);

  assert.ok(cache.length >= 80);
  assert.ok(formatCount >= 900);
  assert.ok(handlerNames.includes("FFmpeg"));
  assert.ok(handlerNames.includes("ImageMagick"));
  assert.ok(handlerNames.includes("pandoc"));
  assert.ok(handlerNames.includes("sevenZip"));
});

test("converter build includes exact verification and all timing sizes", async () => {
  const html = await readFile(resolve(appDirectory, "index.html"), "utf8");
  const source = await readFile(resolve(appDirectory, "source/main.ts"), "utf8");

  assert.match(html, /Byte-for-byte round trip/);
  ["100 KB", "1 MB", "100 MB", "1 GB"].forEach((size) => {
    assert.match(html, new RegExp(size.replace(" ", "\\s")));
  });
  assert.match(source, /compareFileBytes/);
  assert.match(source, /verifyRoundTrip/);
});

test("converter entry references local build assets that exist", async () => {
  const html = await readFile(resolve(appDirectory, "index.html"), "utf8");
  const references = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)]
    .map((match) => match[1]);

  assert.ok(references.length >= 3);
  await Promise.all(references.map(async (reference) => {
    const asset = resolve(appDirectory, reference);
    assert.ok((await readFile(asset)).byteLength > 0, `${reference} should exist`);
  }));
});

test("TurboWarp receives its browser JSZip dependency before the app starts", async () => {
  const html = await readFile(resolve(appDirectory, "index.html"), "utf8");
  const jsZipPosition = html.indexOf("./assets/jszip-3.11.1.min.js");
  const appPosition = html.indexOf("./assets/index-CqjCqN4s.js");

  assert.ok(jsZipPosition >= 0);
  assert.ok(appPosition > jsZipPosition);
});
