import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controller = await readFile(new URL("./main.js", import.meta.url), "utf8");

test("Everyday how-to presentation stays in the presentation map", () => {
  const presentations = controller.slice(
    controller.indexOf("const SECTION_PRESENTATIONS"),
    controller.indexOf("const LESSON_STUDY_PRESENTATION"),
  );
  const algorithmCategories = controller.slice(
    controller.indexOf("const ALGORITHM_CATEGORIES"),
    controller.indexOf("const IDEA_CATEGORIES"),
  );

  assert.match(presentations, /howto:\s*\{/);
  assert.doesNotMatch(algorithmCategories, /howto:\s*\{/);
});

test("Workspace keeps exactly four ordered Main tools before collapsed Other tools", () => {
  const mainTools = controller.match(/const mainTools = \[([\s\S]*?)\];\n  const otherTools =/i)?.[1] ?? "";
  const titles = [...mainTools.matchAll(/title: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(titles, [
    "Overhead",
    "Visual Board",
    "PDF Tool",
    "Software Architect",
  ]);
  assert.match(controller, /createElement\("details", "other-tools-section"\)/);
  assert.match(controller, /createElement\("strong", "", "Other tools"\)/);
});

test("Workspace leaves a zero-count external resource list below Other tools", () => {
  const dashboard = controller.match(
    /function renderToolsDashboard\(\) \{([\s\S]*?)\n\}\n\/\*\*/,
  )?.[1] ?? "";

  assert.match(dashboard, /const externalTools = \[\];/);
  assert.match(dashboard, /createElement\("strong", "", "External tools"\)/);
  assert.match(dashboard, /createElement\("ul", "external-tools-list"\)/);
  assert.match(dashboard, /link\.target = "_blank"/);
  assert.match(dashboard, /appMain\.append\(hero, mainHeading, mainGrid, otherSection, externalSection\)/);
});

test("Studies and Projects orders three knowledge areas above Notecards", () => {
  const dashboard = controller.match(
    /function renderStudiesDashboard\(workspace\) \{([\s\S]*?)\n\}\n\n\/\*\*/,
  )?.[1] ?? "";

  assert.match(dashboard, /\["questions-ideas", "studies", "projects"\]/);
  assert.doesNotMatch(dashboard, /notecardsCard|libraryGrid\.append\([^)]*Notecards/);
  assert.ok(dashboard.indexOf('createElement("section", "notecard-collections")') > dashboard.indexOf('createElement("div", "library-grid studies-hub-grid")'));
  assert.doesNotMatch(dashboard, /"algorithms", "programming-languages"/);
  assert.match(controller, /Algorithms and Programming Languages live inside Studies/);
  assert.match(controller, /Working Ideas holds unfinished personal thinking; Idea Playground/);
});
