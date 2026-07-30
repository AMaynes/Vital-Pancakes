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

test("visual boards index searchable labels without traversing geometry", () => {
  const objects = Array.from({ length: 5_000 }, (_, index) => ({
    id: `line-${index}`,
    type: "line",
    x: index,
    y: index % 200,
    endX: index + 10,
    endY: (index % 200) + 10,
    groupId: `group-${Math.floor(index / 10)}`,
    startVertexId: `vertex-${index}`,
    endVertexId: `vertex-${index + 1}`,
    ...(index === 2_500
      ? {
        type: "textbox",
        text: "Skeleton bench press",
        semantic: { label: "Left shoulder", tags: ["anatomy"] },
      }
      : {}),
  }));
  const localStorage = storage({
    "artificially-neuroscience-visual-board-v1": JSON.stringify({
      version: 20,
      objects,
      assets: {
        reference: {
          name: "skeleton.png",
          dataUrl: "data:image/png;base64,PRIVATE",
        },
      },
    }),
  });

  const documents = readOtherLocalStorageDocuments(localStorage);

  assert.equal(documents.length, 1);
  assert.equal(documents[0].kind, "board");
  assert.match(documents[0].text, /Skeleton bench press|Left shoulder|anatomy|skeleton\.png/);
  assert.doesNotMatch(documents[0].text, /vertex-4999|group-499/);
  assert.ok(documents[0].text.length < 500);
});
