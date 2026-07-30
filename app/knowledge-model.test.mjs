import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutomaticKnowledgeLinks,
  buildKnowledgeGraph,
  collectIndexableText,
  extractWikiReferences,
  findRelatedDocuments,
  getBacklinks,
  normalizeGlossaryEntry,
  searchKnowledgeDocuments,
  suggestLexicalRelationships,
} from "./knowledge-model.mjs";

const documents = [
  {
    id: "study-synapse",
    title: "Synaptic plasticity",
    text: "Long-term potentiation changes synaptic strength. See [[Hebbian learning]].",
    kind: "study",
    source: "workspace",
    recordId: "synapse",
    tags: ["neuroscience", "learning"],
  },
  {
    id: "algorithm-hebb",
    title: "Hebbian learning",
    text: "A learning rule connecting co-active neurons and synaptic plasticity.",
    kind: "algorithm",
    source: "workspace",
    recordId: "hebb",
    tags: ["neuroscience", "learning"],
  },
  {
    id: "recipe-soup",
    title: "Tomato soup",
    text: "Cook tomatoes and stock until tender.",
    kind: "recipe",
    source: "workspace",
  },
];

test("text search ranks exact titles, filters kinds, and returns snippets", () => {
  const results = searchKnowledgeDocuments(documents, "Hebbian learning");
  assert.equal(results[0].id, "algorithm-hebb");
  assert.match(results[1].snippet, /Hebbian learning/i);
  assert.deepEqual(
    searchKnowledgeDocuments(documents, "learning", { kind: "study" }).map(({ id }) => id),
    ["study-synapse"],
  );
});

test("wiki references create automatic links and backlinks", () => {
  const links = buildAutomaticKnowledgeLinks(documents);
  assert.equal(links.length, 1);
  assert.equal(links[0].sourceId, "study-synapse");
  assert.equal(links[0].targetId, "algorithm-hebb");
  assert.equal(getBacklinks("algorithm-hebb", links, documents)[0].source.title, "Synaptic plasticity");
  assert.deepEqual(extractWikiReferences("[[Target|Readable label]]"), [{
    target: "Target",
    label: "Readable label",
    relation: "wiki",
  }]);
});

test("related entries and graph keep linked concepts ahead of unrelated content", () => {
  const links = buildAutomaticKnowledgeLinks(documents);
  const related = findRelatedDocuments("study-synapse", documents, links);
  assert.equal(related[0].id, "algorithm-hebb");
  const graph = buildKnowledgeGraph(documents, links);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.links.length, 1);
});

test("glossary aliases resolve references and sensitive fields never enter index text", () => {
  const glossary = [normalizeGlossaryEntry({
    id: "ltp",
    term: "Long-term potentiation",
    aliases: ["LTP"],
    definition: "A persistent strengthening of synapses.",
  })];
  const linked = buildAutomaticKnowledgeLinks([{
    id: "note",
    title: "Memory note",
    text: "Review [[LTP]].",
    kind: "note",
    source: "workspace",
  }], glossary);
  assert.equal(linked[0].targetId, "glossary:ltp");

  const indexed = collectIndexableText({
    title: "Visible",
    privateSections: [{ plaintext: "Never index this" }],
    password: "also hidden",
    notes: "Allowed note",
  });
  assert.match(indexed, /Visible/);
  assert.match(indexed, /Allowed note/);
  assert.doesNotMatch(indexed, /Never index|also hidden/);
});

test("relationship suggestions are reviewable and deterministic", () => {
  const suggestions = suggestLexicalRelationships(documents);
  assert.equal(suggestions.length > 0, true);
  assert.equal(suggestions[0].origin, "ai");
  assert.equal(suggestions[0].status, "pending");
  assert.deepEqual(suggestLexicalRelationships(documents), suggestions);
});
