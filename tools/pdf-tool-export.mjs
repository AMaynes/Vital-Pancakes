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
  PDFName,
  PDFHexString,
  defaultTextFieldAppearanceProvider,
}) {
  const x = pageWidth * placement.xRatio;
  const width = pageWidth * placement.widthRatio;
  const height = pageHeight * placement.heightRatio;
  const y = pageHeight - (pageHeight * placement.yRatio) - height;
  const safeId = placement.id.replace(/[^a-z0-9_-]/gi, "").slice(0, 48);
  const field = form.createTextField(`vp_field_${placementIndex + 1}_${safeId}`);
  if (/\r|\n/.test(placement.text)) field.enableMultiline();
  if (placement.text) field.setText(placement.text);
  if (placement.bold || placement.italic || placement.underline) {
    field.enableRichFormatting();
    if (PDFName && PDFHexString) {
      field.acroField.dict.set(
        PDFName.of("RV"),
        PDFHexString.fromText(createRichTextValue(placement, pageWidth)),
      );
    }
  }
  const backgroundComponents = {
    blue: [0.86, 0.945, 0.984],
    yellow: [1, 0.953, 0.749],
    red: [0.992, 0.878, 0.875],
    transparent: [1, 1, 1],
  }[placement.backgroundColor ?? "blue"];
  field.addToPage(page, {
    x,
    y,
    width,
    height,
    font: formFont,
    textColor: rgb(0.09, 0.14, 0.12),
    backgroundColor: rgb(...backgroundComponents),
    borderWidth: 0,
  });
  if (placement.backgroundColor === "transparent" && PDFName) {
    const widget = field.acroField.getWidgets().at(-1);
    widget.getAppearanceCharacteristics()?.dict.delete(PDFName.of("BG"));
  }
  field.setFontSize(Math.max(4, Math.min(32, pageWidth * placement.fontSizeRatio)));
  const appearanceProvider = placement.backgroundColor === "transparent" && defaultTextFieldAppearanceProvider
    ? createBorderlessTransparentAppearance(defaultTextFieldAppearanceProvider)
    : undefined;
  field.updateAppearances(formFont, appearanceProvider);
  return field;
}

function createBorderlessTransparentAppearance(defaultAppearanceProvider) {
  return (field, widget, font) => {
    const operators = defaultAppearanceProvider(field, widget, font);
    const operatorText = operators.map((operator) => operator.toString());
    const markedContentIndex = operatorText.indexOf("/Tx BMC");
    const boxStart = operatorText.indexOf("q", 3);
    let boxEnd = -1;
    for (let index = markedContentIndex - 1; index > boxStart; index -= 1) {
      if (operatorText[index] === "Q") {
        boxEnd = index;
        break;
      }
    }
    if (boxStart < 0 || boxEnd < boxStart) return operators;
    return [...operators.slice(0, boxStart), ...operators.slice(boxEnd + 1)];
  };
}

/** Flattens form appearances and removes dangling widget references left by PDF-Lib. */
export function flattenPdfForm(form, pages, context) {
  form.flatten();
  pages.forEach((page) => {
    const annotations = page.node.Annots();
    if (!annotations) return;
    annotations.asArray().forEach((reference) => {
      if (!context.lookup(reference)) page.node.removeAnnot(reference);
    });
  });
}

function createRichTextValue(placement, pageWidth) {
  const family = {
    helvetica: "Helvetica",
    "times-roman": "Times New Roman",
    courier: "Courier New",
  }[placement.fontFamily] ?? "Helvetica";
  const styles = [
    `font-family:${family}`,
    `font-size:${Math.max(4, Math.min(32, pageWidth * placement.fontSizeRatio))}pt`,
    placement.bold ? "font-weight:bold" : "",
    placement.italic ? "font-style:italic" : "",
    placement.underline ? "text-decoration:underline" : "",
  ].filter(Boolean).join(";");
  const text = String(placement.text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return `<body xmlns="http://www.w3.org/1999/xhtml"><p><span style="${styles}">${text}</span></p></body>`;
}

/** Draws an opaque white rectangle over source PDF content. */
export function drawWhiteout(page, placement, pageWidth, pageHeight, rgb) {
  const width = pageWidth * placement.widthRatio;
  const height = pageHeight * placement.heightRatio;
  page.drawRectangle({
    x: pageWidth * placement.xRatio,
    y: pageHeight - (pageHeight * placement.yRatio) - height,
    width,
    height,
    color: rgb(1, 1, 1),
  });
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
