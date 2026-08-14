import test from "node:test";
import assert from "node:assert/strict";

import {
  buildKnowledgeOutline,
  buildProjectMapTree,
  groupEntriesByFolder,
  normalizeFolderCatalog,
  parseDefinitionLines,
  parseKnowledgeContent,
  parseNotecardLinks,
  parseProjectMap,
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
  assert.equal(groups[0].folder, "Information / Theory");
  assert.equal(groups[1].folder, "Unfiled");
});

test("explicit study folders remain visible when empty", () => {
  const entries = [{ id: "a", folderPath: "Information/Theory" }];
  assert.deepEqual(normalizeFolderCatalog(entries, ["Drafts", "Information / Theory"]), [
    "Drafts",
    "Information / Theory",
  ]);
  assert.deepEqual(
    groupEntriesByFolder(entries, ["Drafts"], { includeUnfiled: true })
      .map(({ folder, entries: folderEntries }) => [folder, folderEntries.length]),
    [["Drafts", 0], ["Information / Theory", 1], ["Unfiled", 0]],
  );
});
