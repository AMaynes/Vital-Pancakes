import assert from "node:assert/strict";
import test from "node:test";

import {
  exportVisualBoardToSvg,
  getVisualBoardExportBounds,
} from "./visual-board-static-export.mjs";

function board(objects, options = {}) {
  return {
    version: 14,
    revision: 1,
    objects,
    assets: options.assets ?? {},
    settings: {
      floorPlan: {
        units: "ft",
        pixelsPerUnit: 10,
      },
      architecture: {
        layers: [
          { id: "site", name: "Site", order: -10, visible: true },
          { id: "structure", name: "Structure", order: 0, visible: true },
          { id: "furniture", name: "Furniture", order: 10, visible: true },
          { id: "labels", name: "Labels", order: 20, visible: true },
          { id: "dimensions", name: "Dimensions", order: 30, visible: true },
          { id: "hidden", name: "Hidden", order: 40, visible: false },
        ],
      },
    },
  };
}

const baseStyle = Object.freeze({
  color: "#24231f",
  strokeWidth: 2,
  dashPattern: "solid",
  opacity: 1,
  fillOpacity: 1,
});

test("architectural SVG export is deterministic, layered, and DOM independent", () => {
  const document = board([
    {
      ...baseStyle,
      id: "hidden-wall",
      type: "wall",
      x: 0,
      y: 0,
      w: 50,
      h: 8,
      rotation: 0,
      layerId: "hidden",
      fillColor: "#333333",
    },
    {
      ...baseStyle,
      id: "lawn",
      type: "area",
      x: 10,
      y: 10,
      w: 260,
      h: 160,
      rotation: 0,
      vertices: [
        { x: 0, y: 0.1 },
        { x: 0.9, y: 0 },
        { x: 1, y: 0.8 },
        { x: 0.2, y: 1 },
      ],
      materialId: "lawn",
      layerId: "site",
    },
    {
      ...baseStyle,
      id: "wall",
      type: "wall",
      x: 50,
      y: 60,
      w: 180,
      h: 10,
      rotation: 0.2,
      fillColor: "#4b4038",
      layerId: "structure",
    },
    {
      ...baseStyle,
      id: "sofa",
      type: "symbol",
      symbolId: "sofa",
      x: 80,
      y: 85,
      w: 70,
      h: 30,
      rotation: 0,
      fillColor: "#d8c7ba",
      accentColor: "#9a6a1f",
      layerId: "furniture",
    },
    {
      ...baseStyle,
      id: "label",
      type: "textbox",
      x: 70,
      y: 120,
      w: 140,
      h: 44,
      rotation: 0,
      text: "Kitchen & Bath <Suite>",
      colorRanges: [{ start: 0, end: 7, color: "#8a2e24" }],
      fontSize: 14,
      fontFamily: "sans",
      scaleMode: "world",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      padding: 4,
      layerId: "labels",
    },
    {
      ...baseStyle,
      id: "dimension",
      type: "dimension",
      x: 50,
      y: 175,
      endX: 250,
      endY: 175,
      offset: 18,
      fontSize: 12,
      label: "20 ft",
      layerId: "dimensions",
    },
  ]);
  const before = structuredClone(document);
  const options = {
    viewBounds: { x: 0, y: 0, width: 300, height: 220 },
    width: 1_200,
    height: 880,
    title: "Estate <Plan>",
  };

  const first = exportVisualBoardToSvg(document, options);
  const second = exportVisualBoardToSvg(document, options);

  assert.equal(first, second);
  assert.deepEqual(document, before);
  assert.match(first, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(first, /width="1200" height="880" viewBox="0 0 300 220"/);
  assert.match(first, /<title>Estate &lt;Plan&gt;<\/title>/);
  assert.match(first, /<pattern id="vp-pattern-1"/);
  assert.match(first, /data-object-id="lawn"/);
  assert.match(first, /data-symbol-id="sofa"/);
  assert.match(first, /rotate\(11\.459 140 65\)/);
  assert.match(first, />20 ft<\/text>/);
  assert.match(first, /Kitchen/);
  assert.match(first, /&amp;/);
  assert.match(first, /&lt;Suite&gt;/);
  assert.doesNotMatch(first, /hidden-wall/);
});

test("existing drawing primitives and embedded raster images serialize as vectors", () => {
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  const document = board([
    {
      ...baseStyle,
      id: "pen",
      type: "pen",
      points: [{ x: 0, y: 0 }, { x: 20, y: 15 }],
    },
    {
      ...baseStyle,
      id: "trace",
      type: "trace",
      paths: [[{ x: 30, y: 0 }, { x: 40, y: 0 }, { x: 35, y: 10 }]],
    },
    {
      ...baseStyle,
      id: "line",
      type: "line",
      x: 0,
      y: 30,
      endX: 40,
      endY: 30,
      dashPattern: "dashed",
    },
    {
      ...baseStyle,
      id: "connector",
      type: "connector",
      x: 0,
      y: 45,
      endX: 40,
      endY: 45,
    },
    {
      ...baseStyle,
      id: "arc",
      type: "arc",
      x: 0,
      y: 60,
      midX: 20,
      midY: 45,
      endX: 40,
      endY: 60,
    },
    {
      ...baseStyle,
      id: "triangle",
      type: "shape",
      shapeKind: "triangle",
      x: 50,
      y: 0,
      w: 30,
      h: 30,
      rotation: 0,
    },
    {
      ...baseStyle,
      id: "rectangle",
      type: "rectangle",
      x: 50,
      y: 40,
      w: 30,
      h: 20,
      rotation: 0,
      fillColor: "#e8ddca",
    },
    {
      ...baseStyle,
      id: "ellipse",
      type: "ellipse",
      x: 90,
      y: 40,
      w: 30,
      h: 20,
      rotation: 0,
      fillColor: "#bfe7ef",
    },
    {
      ...baseStyle,
      id: "image",
      type: "image",
      assetId: "image-1",
      x: 130,
      y: 0,
      w: 40,
      h: 30,
      rotation: 0,
      sourceWidth: 1,
      sourceHeight: 1,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    },
  ], {
    assets: {
      "image-1": { dataUrl: tinyPng, width: 1, height: 1 },
    },
  });

  const svg = exportVisualBoardToSvg(document, {
    viewBounds: { x: -10, y: -10, width: 200, height: 100 },
    backgroundColor: "transparent",
  });

  [
    "pen",
    "trace",
    "line",
    "connector",
    "arc",
    "shape",
    "rectangle",
    "ellipse",
    "image",
  ].forEach((type) => assert.match(svg, new RegExp(`data-object-type="${type}"`)));
  assert.match(svg, /stroke-dasharray="10 6\.4"/);
  assert.match(svg, /<polygon points="40,45/);
  assert.match(svg, / Q 20 30 40 60"/);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /<image href="data:image\/png;base64,/);
  assert.doesNotMatch(svg, /<rect[^>]+fill="#ffffff" stroke="none"\/><g/);
});

test("professional architecture export preserves symbol proportions and export privacy", () => {
  const document = board([
    {
      ...baseStyle,
      id: "brick-court",
      type: "area",
      x: 0,
      y: 0,
      w: 220,
      h: 140,
      rotation: 0,
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      materialId: "brick",
      layerId: "site",
    },
    {
      ...baseStyle,
      id: "contained-sofa",
      type: "symbol",
      symbolId: "sofa",
      x: 10,
      y: 10,
      w: 100,
      h: 100,
      fit: "contain",
      rotation: 0,
      layerId: "furniture",
    },
    {
      ...baseStyle,
      id: "room-label",
      type: "textbox",
      x: 20,
      y: 115,
      w: 180,
      h: 20,
      rotation: 0,
      text: "GREAT ROOM",
      colorRanges: [],
      fontSize: 13,
      fontWeight: 700,
      fontFamily: "sans",
      scaleMode: "world",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 0,
      layerId: "labels",
    },
    {
      ...baseStyle,
      id: "private-reference",
      type: "image",
      assetId: "reference",
      x: 0,
      y: 0,
      w: 220,
      h: 140,
      rotation: 0,
      hiddenInExport: true,
      layerId: "site",
    },
  ], {
    assets: {
      reference: { dataUrl: "data:image/png;base64,PRIVATE" },
    },
  });

  const svg = exportVisualBoardToSvg(document, {
    viewBounds: { x: 0, y: 0, width: 220, height: 140 },
  });

  assert.match(svg, /data-symbol-id="sofa"/);
  assert.match(svg, /<rect x="13" y="42" width="94" height="36"/);
  assert.match(svg, /font-weight="700"/);
  assert.match(svg, /M 0 \.5 H 24/);
  assert.doesNotMatch(svg, /private-reference|PRIVATE/);
});

test("automatic export bounds include strokes and caller padding", () => {
  const document = board([{
    ...baseStyle,
    id: "room",
    type: "rectangle",
    x: 10,
    y: 20,
    w: 30,
    h: 40,
    rotation: 0,
  }]);

  assert.deepEqual(getVisualBoardExportBounds(document, { padding: 5 }), {
    x: 4,
    y: 14,
    width: 42,
    height: 52,
  });
  assert.match(
    exportVisualBoardToSvg(document, { padding: 5 }),
    /viewBox="4 14 42 52"/,
  );
});

test("explicit SVG view bounds reject invalid dimensions", () => {
  assert.throws(
    () => exportVisualBoardToSvg(board([]), {
      viewBounds: { x: 0, y: 0, width: 0, height: 100 },
    }),
    /positive width\/height/,
  );
  assert.throws(
    () => exportVisualBoardToSvg({ objects: null }),
    /objects array/,
  );
});

test("complex curve export preserves every cubic segment", () => {
  const svg = exportVisualBoardToSvg(board([{
    ...baseStyle,
    id: "complex-curve",
    type: "arc",
    x: 0,
    y: 0,
    midX: 40,
    midY: -20,
    endX: 100,
    endY: 0,
    curvePoints: [
      { x: 0, y: 0 },
      { x: 40, y: -20 },
      { x: 70, y: 30 },
      { x: 100, y: 0 },
    ],
    curveHandles: [
      {
        control1: { x: 10, y: -10 },
        control2: { x: 25, y: -20 },
      },
      {
        control1: { x: 50, y: -20 },
        control2: { x: 60, y: 30 },
      },
      {
        control1: { x: 80, y: 30 },
        control2: { x: 90, y: 10 },
      },
    ],
  }]));

  assert.match(svg, /M 0 0 C 10 -10 25 -20 40 -20 C 50 -20 60 30 70 30 C 80 30 90 10 100 0/);
});

test("floor-plan visibility settings omit hidden dimensions and hover labels", () => {
  const document = board([
    {
      ...baseStyle,
      id: "hidden-dimension",
      type: "dimension",
      x: 0,
      y: 0,
      endX: 100,
      endY: 0,
      offset: 12,
      fontSize: 12,
      layerId: "dimensions",
      semantic: { role: "floor-plan-dimension" },
    },
    {
      ...baseStyle,
      id: "hover-label",
      type: "textbox",
      x: 0,
      y: 20,
      w: 100,
      h: 30,
      rotation: 0,
      text: "Hover",
      colorRanges: [],
      fontSize: 12,
      fontFamily: "sans",
      layerId: "labels",
      semantic: { role: "floor-plan-labeler" },
    },
    {
      ...baseStyle,
      id: "visible-room",
      type: "rectangle",
      x: 0,
      y: 60,
      w: 100,
      h: 40,
      rotation: 0,
      fillColor: "#ffffff",
      layerId: "structure",
    },
  ]);
  document.settings.floorPlan.dimensionsVisible = false;
  document.settings.floorPlan.labelsAlwaysVisible = false;

  const svg = exportVisualBoardToSvg(document);
  assert.doesNotMatch(svg, /hidden-dimension/);
  assert.doesNotMatch(svg, /hover-label/);
  assert.match(svg, /visible-room/);
});
