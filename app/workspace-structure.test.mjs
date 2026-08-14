import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controller = await readFile(new URL("./main.js", import.meta.url), "utf8");

test("Workspace keeps exactly four ordered Main tools before collapsed Other tools", () => {
  const mainTools = controller.match(/const mainTools = \[([\s\S]*?)\];\n  const otherTools =/i)?.[1] ?? "";
  const titles = [...mainTools.matchAll(/title: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(titles, [
    "Overhead",
    "Visual Board",
    "PDF Tool",
    "Master Lesson Builder",
  ]);
  assert.match(controller, /createElement\("details", "other-tools-section"\)/);
  assert.match(controller, /createElement\("strong", "", "Other tools"\)/);
});

test("Studies and Projects exposes only four top-level knowledge areas", () => {
  const dashboard = controller.match(
    /function renderStudiesDashboard\(workspace\) \{([\s\S]*?)\n\}\n\n\/\*\*/,
  )?.[1] ?? "";

  assert.match(dashboard, /title: "Notecards"/);
  assert.match(dashboard, /\["studies", "questions-ideas", "projects"\]/);
  assert.doesNotMatch(dashboard, /"algorithms", "programming-languages"/);
  assert.match(controller, /Algorithms and Programming Languages live inside Studies/);
  assert.match(controller, /Working Ideas holds unfinished personal thinking; Idea Playground/);
});
