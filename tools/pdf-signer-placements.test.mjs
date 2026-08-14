/**
 * Overview & Purpose
 * Verifies creation, editing, and deletion for PDF Tool placements.
 *
 * Architectural Relationships
 * Tests: pdf-signer-placements.mjs.
 * Calls: Node's built-in test and assertion modules.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createPdfPlacement,
  duplicatePlacementById,
  removePlacementById,
  updatePlacementById,
} from "./pdf-signer-placements.mjs";

const signerStyles = await readFile(new URL("./pdf-signer.css", import.meta.url), "utf8");

test("check, circle, and X placements stay transparent when idle", () => {
  assert.match(
    signerStyles,
    /\.pdf-placement\.mark-stamp\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
  );
  assert.match(
    signerStyles,
    /\.pdf-placement\.mark-stamp\.is-selected\s*\{[^}]*background:\s*transparent;/s,
  );
  assert.match(
    signerStyles,
    /\.pdf-placement\.whiteout-stamp\s*\{[^}]*border:\s*0;/s,
  );
});

test("creates a real fillable-text placement with bounded normalized geometry", () => {
  const placement = createPdfPlacement({
    id: "field-1",
    kind: "text-field",
    pageNumber: 2,
    text: "Editable answer",
    xRatio: 0.8,
    widthRatio: 0.4,
  });

  assert.equal(placement.text, "Editable answer");
  assert.equal(placement.font, "form-font");
  assert.equal(placement.fontFamily, "helvetica");
  assert.equal(placement.bold, false);
  assert.equal(placement.backgroundColor, "blue");
  assert.equal(placement.locked, false);
  assert.ok(Math.abs(placement.widthRatio - 0.2) < Number.EPSILON);
  assert.equal(placement.heightRatio, 0.075);
});

test("creates fixed check, circle, and X mark content", () => {
  assert.equal(createPdfPlacement({ id: "check", kind: "checkmark", pageNumber: 1 }).text, "✓");
  assert.equal(createPdfPlacement({ id: "circle", kind: "circle", pageNumber: 1 }).text, "○");
  assert.equal(createPdfPlacement({ id: "x", kind: "x-mark", pageNumber: 1 }).text, "×");
});

test("creates styled fillable fields and small white-out areas", () => {
  const field = createPdfPlacement({
    id: "styled-field",
    kind: "text-field",
    pageNumber: 1,
    fontFamily: "times-roman",
    bold: true,
    italic: true,
    underline: true,
    backgroundColor: "yellow",
    widthRatio: 0.001,
    heightRatio: 0.001,
  });
  const whiteout = createPdfPlacement({ id: "whiteout", kind: "whiteout", pageNumber: 1 });

  assert.equal(field.fontFamily, "times-roman");
  assert.equal(field.bold, true);
  assert.equal(field.italic, true);
  assert.equal(field.underline, true);
  assert.equal(field.backgroundColor, "yellow");
  assert.equal(field.widthRatio, 0.001);
  assert.equal(field.heightRatio, 0.001);
  assert.equal(whiteout.text, "");
});

test("updates fillable text and geometry without mutating the original list", () => {
  const original = [createPdfPlacement({
    id: "field-1",
    kind: "text-field",
    pageNumber: 1,
    text: "Before",
  })];

  const result = updatePlacementById(original, "field-1", {
    text: "After",
    heightRatio: 0.12,
    fontFamily: "courier",
    bold: true,
    backgroundColor: "red",
    locked: true,
  });

  assert.equal(result.updated.text, "After");
  assert.equal(result.updated.heightRatio, 0.12);
  assert.equal(result.updated.fontFamily, "courier");
  assert.equal(result.updated.bold, true);
  assert.equal(result.updated.backgroundColor, "red");
  assert.equal(result.updated.locked, true);
  assert.equal(original[0].text, "Before");
});

test("duplicates a fillable field with exact dimensions and an unlocked offset copy", () => {
  const original = [createPdfPlacement({
    id: "field-1",
    kind: "text-field",
    pageNumber: 1,
    text: "Copy me",
    widthRatio: 0.347,
    heightRatio: 0.041,
    bold: true,
    backgroundColor: "transparent",
    locked: true,
  })];

  const result = duplicatePlacementById(original, "field-1", {
    id: "field-2",
    pageNumber: 2,
    offsetXRatio: 0.01,
    offsetYRatio: 0.015,
  });

  assert.equal(result.duplicated.id, "field-2");
  assert.equal(result.duplicated.pageNumber, 2);
  assert.equal(result.duplicated.widthRatio, 0.347);
  assert.equal(result.duplicated.heightRatio, 0.041);
  assert.equal(result.duplicated.text, "Copy me");
  assert.equal(result.duplicated.bold, true);
  assert.equal(result.duplicated.backgroundColor, "transparent");
  assert.equal(result.duplicated.locked, false);
  assert.equal(original.length, 1);
});

test("rejects invalid placement kinds and update fields", () => {
  assert.throws(
    () => createPdfPlacement({ id: "bad", kind: "eraser", pageNumber: 1 }),
    /Unsupported PDF placement kind/,
  );
  const placements = [createPdfPlacement({ id: "field-1", kind: "text-field", pageNumber: 1 })];
  assert.throws(
    () => updatePlacementById(placements, "field-1", { pageNumber: 2 }),
    /Unsupported placement field/,
  );
  assert.throws(
    () => createPdfPlacement({ id: "bad-color", kind: "text-field", pageNumber: 1, backgroundColor: "green" }),
    /Unsupported fillable background color/,
  );
});

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
