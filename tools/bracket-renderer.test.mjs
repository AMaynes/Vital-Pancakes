import assert from "node:assert/strict";
import test from "node:test";

import { createTournament } from "./bracket-model.mjs";
import { renderBracketSvg } from "./bracket-renderer.mjs";

for (const type of ["single", "double", "round-robin"]) {
  test(`renders accessible nonblank ${type} SVG`, () => {
    const tournament = createTournament({
      name: `<${type}>`,
      type,
      participants: ["A", "B", "C", "D"],
    });
    const svg = renderBracketSvg(tournament);
    assert.match(svg, /^<svg/);
    assert.match(svg, /role="img"/);
    assert.ok(svg.length > 800);
    assert.ok(!svg.includes(`<${type}>`));
  });
}
