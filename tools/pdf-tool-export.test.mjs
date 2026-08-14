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

import { addFillableTextField, drawVectorMark, drawWhiteout, flattenPdfForm, getVectorMarkGeometry } from "./pdf-tool-export.mjs";

test("vector mark geometry scales to the exact placement box", () => {
  const circle = getVectorMarkGeometry("circle", 100, 60);
  const check = getVectorMarkGeometry("checkmark", 100, 60);
  const xMark = getVectorMarkGeometry("x-mark", 100, 60);

  assert.deepEqual(circle.ellipse, { cx: 50, cy: 30, rx: 41.6, ry: 21.6 });
  assert.equal(circle.thickness, 4.8);
  assert.deepEqual(check.lines[0].start, { x: 12, y: 30 });
  assert.deepEqual(check.lines[1].end, { x: 90, y: 50.4 });
  assert.equal(xMark.lines.length, 2);
  assert.deepEqual(xMark.lines[0], { start: { x: 8.4, y: 8.4 }, end: { x: 91.6, y: 51.6 } });
});

const require = createRequire(import.meta.url);
const {
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts,
  defaultTextFieldAppearanceProvider,
  rgb,
} = require("../vendor/pdf-lib.min.js");

test("exports a reopenable editable text field with vector marks", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const form = document.getForm();
  const formFont = await document.embedFont(StandardFonts.HelveticaBoldOblique);
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
    placement: {
      ...basePlacement,
      kind: "text-field",
      text: "Editable answer",
      fontFamily: "helvetica",
      bold: true,
      italic: true,
      underline: true,
      backgroundColor: "yellow",
    },
    placementIndex: 0,
    rgb,
    PDFName,
    PDFHexString,
    defaultTextFieldAppearanceProvider,
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
  drawWhiteout(page, {
    ...basePlacement,
    kind: "whiteout",
    xRatio: 0.1,
    yRatio: 0.7,
  }, page.getWidth(), page.getHeight(), rgb);

  const bytes = await document.save();
  const reopened = await PDFDocument.load(bytes);
  const field = reopened.getForm().getTextField("vp_field_1_field-1");

  assert.ok(bytes.length > 0);
  assert.equal(field.getText(), "Editable answer");
  assert.equal(field.isMultiline(), false);
  assert.equal(field.isRichFormatted(), true);
  assert.ok(field.acroField.dict.get(PDFName.of("RV")));
  const widget = field.acroField.getWidgets()[0];
  assert.equal(widget.getBorderStyle().getWidth(), 0);
  assert.deepEqual(widget.getAppearanceCharacteristics().getBackgroundColor(), [1, 0.953, 0.749]);
});

test("exports transparent fields and can flatten their visible text", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const form = document.getForm();
  const formFont = await document.embedFont(StandardFonts.Helvetica);
  addFillableTextField({
    form,
    formFont,
    page,
    pageWidth: page.getWidth(),
    pageHeight: page.getHeight(),
    placement: {
      id: "transparent-field",
      kind: "text-field",
      pageNumber: 1,
      text: "Static answer",
      fontFamily: "helvetica",
      fontSizeRatio: 0.022,
      backgroundColor: "transparent",
      xRatio: 0.2,
      yRatio: 0.3,
      widthRatio: 0.4,
      heightRatio: 0.08,
    },
    placementIndex: 0,
    rgb,
    PDFName,
    PDFHexString,
    defaultTextFieldAppearanceProvider,
  });
  const widget = form.getTextField("vp_field_1_transparent-field").acroField.getWidgets()[0];
  assert.equal(widget.getAppearanceCharacteristics().getBackgroundColor(), undefined);
  flattenPdfForm(form, document.getPages(), document.context);

  const bytes = await document.save();
  const reopened = await PDFDocument.load(bytes);
  assert.equal(reopened.getForm().getFields().length, 0);
  assert.equal(reopened.getPages()[0].node.Annots()?.size() ?? 0, 0);
});
