import test from "node:test";
import assert from "node:assert/strict";

import { compareFileBytes } from "./file-converter-byte-verification.mjs";

function file(bytes) {
  return { bytes: Uint8Array.from(bytes) };
}

test("passes only when every byte in every file matches", async () => {
  const result = await compareFileBytes(
    [file([0, 1, 2]), file([255, 10])],
    [file([0, 1, 2]), file([255, 10])],
  );

  assert.deepEqual(result, { matches: true, comparedBytes: 5 });
});

test("reports returned file-count changes", async () => {
  const result = await compareFileBytes([file([1])], [file([1]), file([2])]);

  assert.deepEqual(result, {
    matches: false,
    reason: "file-count",
    expected: 1,
    actual: 2,
    comparedBytes: 0,
  });
});

test("reports exact file-length changes", async () => {
  const result = await compareFileBytes([file([1, 2, 3])], [file([1, 2])]);

  assert.deepEqual(result, {
    matches: false,
    reason: "file-length",
    fileIndex: 0,
    expected: 3,
    actual: 2,
    mismatchOffset: 2,
    comparedBytes: 0,
  });
});

test("reports the first mismatched byte offset", async () => {
  const result = await compareFileBytes([file([1, 2, 3])], [file([1, 9, 3])]);

  assert.deepEqual(result, {
    matches: false,
    reason: "byte-mismatch",
    fileIndex: 0,
    mismatchOffset: 1,
    comparedBytes: 1,
  });
});
