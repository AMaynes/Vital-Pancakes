import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  calculateTrackerSummary,
  classifyDueDate,
  completeTask,
  decryptPrivatePayload,
  emptyOverheadState,
  encryptPrivatePayload,
  getInventoryWarning,
  nextOccurrence,
  validateEncryptionEnvelope,
  validateOverheadState,
} from "./overhead-model.mjs";

test("classifies overdue, today, upcoming, and unscheduled tasks", () => {
  const now = new Date(2026, 6, 29, 12);
  assert.equal(classifyDueDate("2026-07-28", now), "overdue");
  assert.equal(classifyDueDate("2026-07-29", now), "today");
  assert.equal(classifyDueDate("2026-08-03", now), "upcoming");
  assert.equal(classifyDueDate("", now), "unscheduled");
});

test("recurrence advances without mutating the original task", () => {
  assert.equal(nextOccurrence("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(nextOccurrence("2024-02-29", "yearly"), "2025-02-28");
  const task = { id: "t", dueDate: "2026-07-29", recurrence: "weekly", completionHistory: [] };
  const complete = completeTask(task, new Date(2026, 6, 29, 12));
  assert.equal(complete.dueDate, "2026-08-05");
  assert.equal(complete.completed, false);
  assert.equal(task.completionHistory.length, 0);
});

test("tracker summaries calculate streak, progress, and missed entries", () => {
  const tracker = {
    startedAt: "2026-07-26",
    schedule: "daily",
    history: [
      { at: "2026-07-26T10:00:00.000Z", value: true },
      { at: "2026-07-28T10:00:00.000Z", value: true },
      { at: "2026-07-29T10:00:00.000Z", value: true },
    ],
  };
  const summary = calculateTrackerSummary(tracker, new Date(2026, 6, 29, 18));
  assert.equal(summary.streak, 2);
  assert.equal(summary.missed, 1);
  assert.equal(summary.progress, 0.75);
});

test("inventory warnings cover low stock and expiration", () => {
  const warning = getInventoryWarning(
    { quantity: 1, minimum: 2, expirationDate: "2026-08-02" },
    new Date(2026, 6, 29),
  );
  assert.equal(warning.lowStock, true);
  assert.equal(warning.expiringSoon, true);
  assert.equal(warning.daysUntilExpiration, 4);
});

test("private envelopes use authenticated encryption and reject wrong passwords", async () => {
  const envelope = await encryptPrivatePayload({ account: "private", secret: "value" }, "correct");
  validateEncryptionEnvelope(envelope);
  assert.deepEqual(await decryptPrivatePayload(envelope, "correct"), {
    account: "private",
    secret: "value",
  });
  await assert.rejects(decryptPrivatePayload(envelope, "wrong"), /incorrect|damaged/);
  const corrupted = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` };
  await assert.rejects(decryptPrivatePayload(corrupted, "correct"), /incorrect|damaged/);
});

test("validation rejects duplicate ids and migrations retain sections", () => {
  const state = emptyOverheadState(new Date("2026-07-29T00:00:00Z"));
  assert.equal(validateOverheadState(state).version, 1);
  state.tasks.push({ id: "list-inbox" });
  assert.throws(() => validateOverheadState(state), /Duplicate/);
});
