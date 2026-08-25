import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controller = await readFile(new URL("./main.js", import.meta.url), "utf8");
const stylesheet = await readFile(new URL("../workspace.css", import.meta.url), "utf8");
const knowledgeDatabase = await readFile(new URL("./knowledge-db.mjs", import.meta.url), "utf8");

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

test("Study entries omit the inquiry dossier and subject view lead panel", () => {
  const start = controller.indexOf("function renderEntryDetail(section, item)");
  const end = controller.indexOf("function getEntryTypeLabel", start);
  const detailRenderer = controller.slice(start, end);

  assert.match(detailRenderer, /detail\.append\(heading\)/);
  assert.match(detailRenderer, /if \(section\.type !== "study"\) detail\.append\(lead\)/);
  assert.match(detailRenderer, /detail\.append\(body\)/);
  assert.doesNotMatch(detailRenderer, /detail\.append\(heading, lead, body\)/);
});

test("Study editing turns the reading surface into the editor instead of opening a builder", () => {
  assert.match(controller, /function openItemEditor\(section, item\)/);
  assert.match(controller, /section\.type !== "study"[\s\S]*openItemDialog/);
  assert.match(controller, /function showInlineStudyContentEditor\(section, item\)/);
  assert.match(controller, /querySelector\("\.knowledge-entry-content"\)/);
  assert.match(controller, /const abstract = content\.querySelector\("\.knowledge-abstract"\)/);
  assert.match(controller, /layout\.classList\.add\("is-direct-editing"\)/);
  assert.match(controller, /if \(abstract\) content\.append\(abstract\)/);
  assert.match(controller, /content\.append\(canvas\)/);
  assert.match(controller, /updateItem\(section\.id, item\.id, \{ content: serializeKnowledgeContent\(blocks\) \}\)/);
  assert.doesNotMatch(controller, /createElement\("form", "inline-content-editor"\)/);
});

test("Study block types drag directly into the reading surface with inline controls", () => {
  const directEditor = controller.match(
    /function showInlineStudyContentEditor\(section, item\) \{([\s\S]*?)\n\}\n\nfunction createRichContentField/,
  )?.[1] ?? "";

  assert.match(directEditor, /tool\.draggable = true/);
  assert.match(directEditor, /knowledge-direct-canvas/);
  assert.match(directEditor, /createKnowledgeBlock\(numberedBlocks\[blockIndex\], definitions\)/);
  assert.match(directEditor, /knowledge-direct-control", "✎"/);
  assert.match(directEditor, /knowledge-direct-control", "×"/);
  assert.match(directEditor, /controls\.append\(edit, remove\)/);
  assert.match(directEditor, /element\.prepend\(handle, controls\)/);
  assert.match(directEditor, /moveOrInsertBlock/);
  assert.match(directEditor, /canPlaceKnowledgeSubsection\(candidateBlocks, index\)/);
  assert.match(directEditor, /A subsection must have a section before it/);
  assert.doesNotMatch(directEditor, /if \(!acceptHierarchy\(blocks\)\) return/);
  assert.match(directEditor, /const isHeading = \["section", "subsection"\]\.includes\(block\.type\)/);
  assert.doesNotMatch(directEditor, /document\.createElement\("select"\)|Block type|typeSelect/);
  assert.match(directEditor, /element\.addEventListener\("dblclick"/);
  assert.match(directEditor, /titleNode\.contentEditable = "true"/);
  assert.match(directEditor, /bodyEditor\.contentEditable = "true"/);
  assert.match(directEditor, /document\.addEventListener\("click"/);
  assert.match(directEditor, /clickedBlock\?\.dataset\.editorBlockId === editingBlockId/);
  assert.match(directEditor, /event\.key !== "Escape" \|\| !editingBlockId/);
  assert.match(controller, /activeDirectEditorController\?\.abort\(\)/);
  assert.match(directEditor, /numberKnowledgeBlocks\(blocks\)/);
  assert.match(directEditor, /picker\.accept = `\$\{block\.type\}\/\*`/);
  assert.match(directEditor, /event\.clipboardData\?\.items/);
  assert.match(directEditor, /saveKnowledgeMedia\(file\)/);
  assert.match(directEditor, /type === "section"\s*\? \[block, createNewBlock\("text"\)\]/);
});

test("direct Study editing keeps fields visually embedded in the reading surface", () => {
  assert.match(stylesheet, /\.knowledge-direct-inline-edit,[\s\S]*\.knowledge-direct-source-input\s*\{[\s\S]*background: transparent/);
  assert.match(stylesheet, /border-bottom: 1px solid transparent/);
  assert.match(stylesheet, /\.knowledge-direct-source-input\s*\{[^}]*resize: none/);
});

test("Study uploads persist image and video blobs outside localStorage", () => {
  assert.match(knowledgeDatabase, /const DATABASE_VERSION = 3/);
  assert.match(knowledgeDatabase, /const MEDIA_STORE = "media"/);
  assert.match(knowledgeDatabase, /export async function saveKnowledgeMedia\(file\)/);
  assert.match(knowledgeDatabase, /blob: file/);
  assert.match(controller, /getKnowledgeMedia\(node\.dataset\.knowledgeMediaId\)/);
});

test("the content builder edits draggable blocks instead of exposing its storage syntax", () => {
  const builder = controller.match(
    /function createRichContentField\(value\) \{([\s\S]*?)\n\}\n\nfunction createStudyParentSelect/,
  )?.[1] ?? "";

  assert.match(builder, /parseKnowledgeContent\(value\)/);
  assert.match(builder, /serializeKnowledgeContent\(blocks\)/);
  assert.match(builder, /row\.draggable = true/);
  assert.match(builder, /addEventListener\("drop"/);
  assert.match(builder, /rich-content-block-action", "✎"/);
  assert.match(builder, /rich-content-block-action", "×"/);
  assert.match(builder, /type === "section"[\s\S]*type: "text"/);
  assert.doesNotMatch(builder, /document\.createElement\("select"\)|Block type|typeSelect/);
  assert.doesNotMatch(builder, /textarea\.rows = 14|setRangeText|::section Overview/);
});
