import assert from "node:assert/strict";
import test from "node:test";

import {
  readOtherLocalStorageDocuments,
  readWorkspaceDocuments,
} from "./knowledge-sync.mjs";

function storage(entries) {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
  };
}

test("workspace libraries become stable searchable documents with routes", () => {
  const localStorage = storage({
    "artificially-neuroscience-workspace-v1": JSON.stringify({
      sections: [{
        id: "studies",
        title: "Studies",
        type: "study",
        items: [{
          id: "memory",
          title: "Memory study",
          findings: "Spacing improves recall.",
          tags: ["learning"],
        }],
      }],
    }),
  });
  const documents = readWorkspaceDocuments(localStorage);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].id, "workspace:studies:memory");
  assert.match(documents[0].text, /Spacing improves recall/);
  assert.match(documents[0].url, /section=studies/);
});

test("literature annotations are indexed without unrelated view settings", () => {
  const localStorage = storage({
    "pinakes-vitae-literature-analyzer-v1": JSON.stringify({
      sources: {
        paper: {
          name: "Paper",
          annotations: [{ quote: "Important finding", comment: "Connect to study" }],
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      },
    }),
    "vital-pancakes-content-view": JSON.stringify({ layout: "grid" }),
  });
  const documents = readOtherLocalStorageDocuments(localStorage);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].kind, "highlight");
  assert.match(documents[0].text, /Important finding/);
});
