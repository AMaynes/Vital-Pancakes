import assert from "node:assert/strict";
import test from "node:test";

import { renderChartSvg } from "./graphing-renderer.mjs";

const rows = [
  { category: "A", series: "First", value: 1, size: 3 },
  { category: "B", series: "Second", value: 2, size: 4 },
];

for (const type of ["line", "multi-line", "bar", "grouped-bar", "stacked-bar", "scatter", "bubble", "area", "histogram", "box", "pie", "donut", "heatmap"]) {
  test(`renderer produces nonblank accessible SVG for ${type}`, () => {
    const svg = renderChartSvg(rows, {
      type, x: "category", y: "value", series: "series", size: "size",
      bins: 2, scaleX: "linear", scaleY: "linear", title: `<${type}>`,
      accent: "#7B211A", background: "#FFFFFF", annotations: [],
    });
    assert.match(svg, /^<svg/);
    assert.match(svg, /role="img"/);
    assert.ok(svg.length > 400);
    assert.ok(!svg.includes(`<${type}>`));
  });
}
