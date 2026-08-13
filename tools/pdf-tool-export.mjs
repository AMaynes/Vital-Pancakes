/**
 * Overview & Purpose
 * Adds PDF-Lib form fields and vector marks to existing PDF pages.
 *
 * Architectural Relationships
 * Called by: pdf-signer.js and its adjacent export test.
 * Calls: PDF-Lib objects supplied by the caller.
 *
 * Notes
 * The helpers only add content. They never inspect or remove source PDF marks.
 */

/**
 * Creates a named AcroForm text field that stays editable after export.
 *
 * @param {object} options PDF-Lib objects, geometry, and placement data.
 * @returns {object} Created PDF-Lib text field.
 */
export function addFillableTextField({
  form,
  formFont,
  page,
  pageWidth,
  pageHeight,
  placement,
  placementIndex,
  rgb,
}) {
  const x = pageWidth * placement.xRatio;
  const width = pageWidth * placement.widthRatio;
  const height = pageHeight * placement.heightRatio;
  const y = pageHeight - (pageHeight * placement.yRatio) - height;
  const safeId = placement.id.replace(/[^a-z0-9_-]/gi, "").slice(0, 48);
  const field = form.createTextField(`vp_field_${placementIndex + 1}_${safeId}`);
  field.enableMultiline();
  if (placement.text) field.setText(placement.text);
  field.addToPage(page, {
    x,
    y,
    width,
    height,
    font: formFont,
    textColor: rgb(0.09, 0.14, 0.12),
    borderColor: rgb(0.19, 0.35, 0.31),
    backgroundColor: rgb(1, 1, 1),
    borderWidth: 1,
  });
  field.setFontSize(Math.max(6, Math.min(32, pageWidth * placement.fontSizeRatio)));
  return field;
}

/**
 * Draws a check, circle, or X without relying on unsupported font glyphs.
 *
 * @param {object} page PDF-Lib page.
 * @param {object} placement Mark placement.
 * @param {number} pageWidth PDF page width.
 * @param {number} pageHeight PDF page height.
 * @param {Function} rgb PDF-Lib RGB color factory.
 */
export function drawVectorMark(page, placement, pageWidth, pageHeight, rgb) {
  const x = pageWidth * placement.xRatio;
  const width = pageWidth * placement.widthRatio;
  const height = pageHeight * placement.heightRatio;
  const y = pageHeight - (pageHeight * placement.yRatio) - height;
  const inset = Math.max(1, Math.min(width, height) * 0.14);
  const thickness = Math.max(1.25, Math.min(width, height) * 0.08);
  const color = rgb(0.09, 0.14, 0.12);

  if (placement.kind === "circle") {
    page.drawEllipse({
      x: x + (width / 2),
      y: y + (height / 2),
      xScale: Math.max(1, (width / 2) - inset),
      yScale: Math.max(1, (height / 2) - inset),
      borderColor: color,
      borderWidth: thickness,
    });
    return;
  }

  if (placement.kind === "x-mark") {
    page.drawLine({
      start: { x: x + inset, y: y + inset },
      end: { x: x + width - inset, y: y + height - inset },
      color,
      thickness,
    });
    page.drawLine({
      start: { x: x + inset, y: y + height - inset },
      end: { x: x + width - inset, y: y + inset },
      color,
      thickness,
    });
    return;
  }

  page.drawLine({
    start: { x: x + (width * 0.12), y: y + (height * 0.5) },
    end: { x: x + (width * 0.4), y: y + (height * 0.18) },
    color,
    thickness,
  });
  page.drawLine({
    start: { x: x + (width * 0.4), y: y + (height * 0.18) },
    end: { x: x + (width * 0.9), y: y + (height * 0.84) },
    color,
    thickness,
  });
}
