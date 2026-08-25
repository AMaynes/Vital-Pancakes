import test from "node:test";
import assert from "node:assert/strict";

import {
  buildKnowledgeOutline,
  buildEntryFileTree,
  buildProjectMapTree,
  canPlaceKnowledgeSubsection,
  groupEntriesByFolder,
  hasValidKnowledgeHierarchy,
  normalizeFolderCatalog,
  normalizeKnowledgeHeaderBlocks,
  parseDefinitionLines,
  parseKnowledgeContent,
  parseNotecardLinks,
  parseProjectMap,
  serializeKnowledgeContent,
} from "./knowledge-entry-model.mjs";

test("knowledge content keeps rich block types and stable unique anchors", () => {
  const blocks = parseKnowledgeContent(`::section Overview\nText\n::equation Entropy\nH(X)=-sum p log p\n::section Overview\nMore`);
  assert.deepEqual(blocks.map(({ type, id }) => [type, id]), [
    ["section", "overview"],
    ["equation", "entropy"],
    ["section", "overview-2"],
  ]);
  assert.deepEqual(buildKnowledgeOutline("::section A\nBody\n::subsection B\nBody"), [
    { id: "a", title: "A", level: 2 },
    { id: "b", title: "B", level: 3 },
  ]);
});

test("legacy plain notes remain a text block", () => {
  assert.equal(parseKnowledgeContent("One old note")[0].body, "One old note");
});

test("visual editor blocks serialize without changing their order or content", () => {
  const source = "::section Overview\nFirst paragraph\n\n::equation Entropy\nH(X) = -\\sum_x p(x) \\log p(x)";
  const blocks = parseKnowledgeContent(source);
  assert.equal(serializeKnowledgeContent(blocks), source);
  assert.deepEqual(
    parseKnowledgeContent(serializeKnowledgeContent([blocks[1], blocks[0]])).map(({ type, title }) => [type, title]),
    [["equation", "Entropy"], ["section", "Overview"]],
  );
});

test("subsections require an earlier section", () => {
  assert.equal(hasValidKnowledgeHierarchy([
    { type: "section" },
    { type: "text" },
    { type: "subsection" },
  ]), true);
  assert.equal(hasValidKnowledgeHierarchy([
    { type: "text" },
    { type: "subsection" },
    { type: "section" },
  ]), false);
  assert.equal(hasValidKnowledgeHierarchy([{ type: "subsection" }]), false);
});

test("subsection placement checks only the moved block and its destination", () => {
  const blocks = [
    { type: "subsection" },
    { type: "text" },
    { type: "section" },
    { type: "subsection" },
  ];
  assert.equal(canPlaceKnowledgeSubsection(blocks, 0), false);
  assert.equal(canPlaceKnowledgeSubsection(blocks, 1), true);
  assert.equal(canPlaceKnowledgeSubsection(blocks, 2), true);
  assert.equal(canPlaceKnowledgeSubsection(blocks, 3), true);
});

test("section bodies become separate text blocks while headings stay header-only", () => {
  assert.deepEqual(normalizeKnowledgeHeaderBlocks([
    { id: "overview", type: "section", title: "Overview", body: "Existing paragraph" },
    { id: "details", type: "subsection", title: "Details", body: "" },
  ]), [
    { id: "overview", type: "section", title: "Overview", body: "" },
    { id: "", type: "text", title: "", body: "Existing paragraph" },
    { id: "details", type: "subsection", title: "Details", body: "" },
  ]);
});

test("definitions and notecard links parse bounded pipe rows", () => {
  assert.deepEqual(parseDefinitionLines("Entropy | Uncertainty | entropy-study\nEntropy | duplicate"), [
    { term: "Entropy", definition: "Uncertainty", linkedStudyId: "entropy-study" },
  ]);
  assert.deepEqual(parseNotecardLinks("Cross entropy | educational_resources/mathematics/flashcard-practice.html"), [
    { label: "Cross entropy", url: "educational_resources/mathematics/flashcard-practice.html" },
  ]);
});

test("project maps form recursive trees and reject cycles", () => {
  const source = "system | | Whole system | Overview |\nengine | system | Engine | Core | study-engine\nleaf | engine | Detail | Leaf | study-leaf";
  const tree = buildProjectMapTree(source);
  assert.equal(tree[0].children[0].children[0].studyId, "study-leaf");
  const cyclic = parseProjectMap("a | b | A\nb | a | B");
  assert.ok(cyclic.some((node) => node.parentId === ""));
});

test("study folders are normalized and grouped without flattening entries", () => {
  const groups = groupEntriesByFolder([
    { id: "a", folderPath: "Information/Theory" },
    { id: "b", folderPath: "" },
  ]);
  assert.equal(groups[0].folder, "Information");
  assert.equal(groups[0].entries.length, 0);
  assert.equal(groups[1].folder, "Information / Theory");
  assert.equal(groups[2].folder, "Unfiled");
});

test("explicit study folders remain visible when empty", () => {
  const entries = [{ id: "a", folderPath: "Information/Theory" }];
  assert.deepEqual(normalizeFolderCatalog(entries, ["Drafts", "Information / Theory"]), [
    "Drafts",
    "Information",
    "Information / Theory",
  ]);
  assert.deepEqual(
    groupEntriesByFolder(entries, ["Drafts"], { includeUnfiled: true })
      .map(({ folder, entries: folderEntries }) => [folder, folderEntries.length]),
    [["Drafts", 0], ["Information", 0], ["Information / Theory", 1], ["Unfiled", 0]],
  );
});

test("entry file trees materialize recursive directories and retain root files", () => {
  const rootEntry = { id: "root", folderPath: "" };
  const nestedEntry = { id: "nested", folderPath: "Programming / Web / Browser" };
  const tree = buildEntryFileTree([rootEntry, nestedEntry], ["Empty / Child"]);

  assert.deepEqual(tree.entries, [rootEntry]);
  assert.deepEqual(tree.folders.map(({ name }) => name), ["Empty", "Programming"]);
  assert.equal(tree.folders[0].children[0].name, "Child");
  assert.equal(tree.folders[1].children[0].children[0].entries[0], nestedEntry);
});
