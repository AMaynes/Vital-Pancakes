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

test("Notecards keeps the archive action beside the heading and subjects in the grid", () => {
  const dashboard = controller.match(
    /function renderStudiesDashboard\(workspace\) \{([\s\S]*?)\n\}\n\nfunction getRouteKnowledgeSubsection/,
  )?.[1] ?? "";

  assert.match(dashboard, /createElement\("a", "button button-small", "All notecards"\)/);
  assert.match(dashboard, /notecardTitleRow\.append\(createElement\("h2", "", "Notecards"\), allNotecardsLink\)/);
  assert.match(dashboard, /title: "Mathematics Notecards"/);
  assert.match(dashboard, /title: "Arts Notecards"/);
  assert.doesNotMatch(dashboard, /title: "All Notecards"/);
});

test("every entry library renders through one recursive file explorer", () => {
  const sectionRenderer = controller.match(
    /function renderSection\(section\) \{([\s\S]*?)\n\}\n\n\/\*\*/,
  )?.[1] ?? "";

  assert.match(sectionRenderer, /createEntryFileExplorer\(section, visibleItems\)/);
  assert.doesNotMatch(sectionRenderer, /createEntryIndexCard|groupEntriesByFolder|CONTENT_VIEWS/);
  assert.match(controller, /function createFileTreeFolder\(section, folder, depth\)/);
  assert.match(controller, /folder\.children\.forEach\(\(child\) => children\.append\(createFileTreeFolder/);
  assert.match(controller, /row\.draggable = true/);
});

test("Study equations use the local KaTeX bundle instead of raw CDN-dependent source", async () => {
  const markup = await readFile(new URL("../workspace.html", import.meta.url), "utf8");
  assert.match(markup, /vendor\/katex\/katex\.min\.css/);
  assert.match(controller, /import\("\.\.\/vendor\/katex\/katex\.mjs"\)\)\.default/);
  assert.doesNotMatch(controller, /cdn\.jsdelivr\.net\/npm\/katex/);
});

test("Study editing reveals an inline content builder instead of the item dialog", () => {
  assert.match(controller, /function openItemEditor\(section, item\)/);
  assert.match(controller, /section\.type !== "study"[\s\S]*openItemDialog/);
  assert.match(controller, /function showInlineStudyContentEditor\(section, item\)/);
  assert.match(controller, /createElement\("form", "inline-content-editor"\)/);
  assert.match(controller, /createRichContentField\(item\.content \?\? ""\)/);
  assert.match(controller, /updateItem\(section\.id, item\.id, \{ content \}\)/);
});
