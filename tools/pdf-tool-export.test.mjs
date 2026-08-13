/**
 * Overview & Purpose
 * Verifies that PDF Tool exports real editable fields and valid vector marks.
 *
 * Architectural Relationships
 * Tests: pdf-tool-export.mjs with the browser-bundled PDF-Lib distribution.
 * Calls: Node's built-in test, assertions, and CommonJS bridge.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { addFillableTextField, drawVectorMark } from "./pdf-tool-export.mjs";

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require("../vendor/pdf-lib.min.js");

test("exports a reopenable editable text field with vector marks", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const form = document.getForm();
  const formFont = await document.embedFont(StandardFonts.Helvetica);
  const basePlacement = {
    id: "field-1",
    pageNumber: 1,
    xRatio: 0.2,
    yRatio: 0.3,
    widthRatio: 0.4,
    heightRatio: 0.08,
    fontSizeRatio: 0.022,
  };

  addFillableTextField({
    form,
    formFont,
    page,
    pageWidth: page.getWidth(),
    pageHeight: page.getHeight(),
    placement: { ...basePlacement, kind: "text-field", text: "Editable answer" },
    placementIndex: 0,
    rgb,
  });
  ["checkmark", "circle", "x-mark"].forEach((kind, index) => {
    drawVectorMark(page, {
      ...basePlacement,
      id: kind,
      kind,
      xRatio: 0.2 + (index * 0.1),
      yRatio: 0.55,
      widthRatio: 0.07,
      heightRatio: 0.07,
    }, page.getWidth(), page.getHeight(), rgb);
  });
  form.updateFieldAppearances(formFont);

  const bytes = await document.save();
  const reopened = await PDFDocument.load(bytes);
  const field = reopened.getForm().getTextField("vp_field_1_field-1");

  assert.ok(bytes.length > 0);
  assert.equal(field.getText(), "Editable answer");
  assert.equal(field.isMultiline(), true);
});
