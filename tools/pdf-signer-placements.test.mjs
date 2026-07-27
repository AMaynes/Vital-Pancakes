/**
 * Overview & Purpose
 * Verifies deletion behavior for PDF Signer field placements.
 *
 * Architectural Relationships
 * Tests: pdf-signer-placements.mjs.
 * Calls: Node's built-in test and assertion modules.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { removePlacementById } from "./pdf-signer-placements.mjs";

test("removes the selected placed field without mutating the original list", () => {
  const signature = { id: "signature-1", kind: "signature" };
  const date = { id: "date-1", kind: "date" };
  const original = [signature, date];

  const result = removePlacementById(original, signature.id);

  assert.deepEqual(result.placements, [date]);
  assert.equal(result.removed, signature);
  assert.deepEqual(original, [signature, date]);
});

test("leaves placements intact when the requested field does not exist", () => {
  const original = [{ id: "signature-1", kind: "signature" }];

  const result = removePlacementById(original, "missing");

  assert.deepEqual(result.placements, original);
  assert.notEqual(result.placements, original);
  assert.equal(result.removed, null);
});
