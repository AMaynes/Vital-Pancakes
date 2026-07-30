import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  collectVaultEntries,
  encryptVaultEntries,
  readVaultEntries,
} from "./vault-archive.mjs";
import {
  decodeStructuredValue,
  encodeStructuredValue,
} from "./vault-codec.mjs";

test("vault archive preserves ordered text and binary entries byte for byte", async () => {
  const source = Uint8Array.from({ length: 9_321 }, (_, index) => (index * 37) % 256);
  const archive = await encryptVaultEntries([
    { kind: "manifest", id: "manifest", data: JSON.stringify({ databases: 2 }) },
    { kind: "binary", id: "file:one", metadata: { name: "one.bin" }, data: source },
  ], "correct horse battery", { cryptoRef: webcrypto, iterations: 10_000, chunkSize: 1024 });

  const restored = await collectVaultEntries(archive, "correct horse battery", { cryptoRef: webcrypto });

  assert.deepEqual(restored.entries.map(({ kind, id }) => ({ kind, id })), [
    { kind: "manifest", id: "manifest" },
    { kind: "binary", id: "file:one" },
  ]);
  assert.deepEqual(
    new Uint8Array(await restored.entries[1].data.arrayBuffer()),
    source,
  );
});

test("vault archive defaults to the browser Web Crypto provider", async () => {
  const archive = await encryptVaultEntries([
    { kind: "manifest", id: "manifest", data: "{}" },
  ], "browser-password", { iterations: 10_000 });

  const restored = await collectVaultEntries(archive, "browser-password");

  assert.equal(restored.entryCount, 1);
  assert.equal(await restored.entries[0].data.text(), "{}");
});

test("vault archive rejects the wrong password and altered ciphertext", async () => {
  const archive = await encryptVaultEntries([
    { kind: "manifest", id: "manifest", data: "{}" },
  ], "right-password", { cryptoRef: webcrypto, iterations: 10_000 });

  await assert.rejects(
    collectVaultEntries(archive, "wrong-password", { cryptoRef: webcrypto }),
    /incorrect|altered/i,
  );

  const altered = new Uint8Array(await archive.arrayBuffer());
  altered[altered.length - 8] ^= 0xff;
  await assert.rejects(
    collectVaultEntries(altered, "right-password", { cryptoRef: webcrypto }),
    /incorrect|altered/i,
  );
});

test("vault archive detects truncation and supports cancellation", async () => {
  const archive = await encryptVaultEntries([
    { kind: "manifest", id: "manifest", data: "{}" },
  ], "right-password", { cryptoRef: webcrypto, iterations: 10_000 });
  const bytes = new Uint8Array(await archive.arrayBuffer());

  await assert.rejects(
    collectVaultEntries(bytes.slice(0, -20), "right-password", { cryptoRef: webcrypto }),
    /truncated|ended/i,
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readVaultEntries(archive, "right-password", { cryptoRef: webcrypto, signal: controller.signal }),
    /cancel/i,
  );
});

test("structured codec round-trips special values and binary attachments", async () => {
  const sourceBytes = Uint8Array.from([0, 1, 2, 127, 128, 255]);
  const source = {
    missing: undefined,
    when: new Date("2026-07-30T00:00:00.000Z"),
    count: 12n,
    bytes: sourceBytes,
    blob: new Blob([sourceBytes], { type: "application/octet-stream" }),
    map: new Map([["key", new Set(["a", "b"])]]),
    values: [NaN, Infinity, -Infinity, -0],
  };
  const { encoded, attachments } = encodeStructuredValue(source);
  const restored = await decodeStructuredValue(
    encoded,
    new Map(attachments.map((attachment) => [attachment.id, attachment.blob])),
  );

  assert.equal(restored.missing, undefined);
  assert.equal(restored.when.toISOString(), source.when.toISOString());
  assert.equal(restored.count, 12n);
  assert.deepEqual(restored.bytes, sourceBytes);
  assert.deepEqual(new Uint8Array(await restored.blob.arrayBuffer()), sourceBytes);
  assert.deepEqual([...restored.map.get("key")], ["a", "b"]);
  assert.equal(Number.isNaN(restored.values[0]), true);
  assert.equal(restored.values[1], Infinity);
  assert.equal(restored.values[2], -Infinity);
  assert.equal(Object.is(restored.values[3], -0), true);
});
