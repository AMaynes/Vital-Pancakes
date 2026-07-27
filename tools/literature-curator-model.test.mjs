import assert from "node:assert/strict";
import test from "node:test";

import {
  countRelationships,
  removeAnalysis,
  sanitizeLiteratureCurations,
  upsertAnalysis,
  upsertCuration,
} from "./literature-curator-model.mjs";

const curation = {
  id: "curation-1",
  title: "Sleep and memory",
  targetType: "Hypothesis",
  statement: "Sleep consolidates declarative memory.",
  synthesis: "",
  analyses: [],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

const analysis = {
  id: "analysis-1",
  sourceTitle: "A review of sleep-dependent memory",
  citation: "Author (2025)",
  sourceUrl: "https://example.com/paper",
  relationship: "Supports",
  finding: "Retention improved after sleep.",
  analysis: "The review supports the proposed mechanism.",
  notes: "",
  createdAt: "2026-07-28T01:00:00.000Z",
  updatedAt: "2026-07-28T01:00:00.000Z",
};

test("stored curations reject malformed records and unsafe source links", () => {
  const sanitized = sanitizeLiteratureCurations({
    curations: [
      {
        ...curation,
        analyses: [
          analysis,
          { ...analysis, id: "analysis-2", sourceUrl: "javascript:alert(1)" },
          { id: "missing-title" },
        ],
      },
      { id: "missing-title" },
    ],
  });

  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].analyses.length, 2);
  assert.equal(
    sanitized[0].analyses.find((candidate) => candidate.id === "analysis-2").sourceUrl,
    "",
  );
  assert.equal(
    sanitized[0].analyses.find((candidate) => candidate.id === "analysis-1").sourceUrl,
    "https://example.com/paper",
  );
});

test("curations and analyses update immutably", () => {
  const initial = upsertCuration([], curation);
  const withAnalysis = upsertAnalysis(initial, curation.id, analysis);
  const withoutAnalysis = removeAnalysis(
    withAnalysis,
    curation.id,
    analysis.id,
    "2026-07-28T02:00:00.000Z",
  );

  assert.equal(initial[0].analyses.length, 0);
  assert.equal(withAnalysis[0].analyses.length, 1);
  assert.equal(withAnalysis[0].analyses[0].sourceTitle, analysis.sourceTitle);
  assert.equal(withoutAnalysis[0].analyses.length, 0);
  assert.equal(withoutAnalysis[0].updatedAt, "2026-07-28T02:00:00.000Z");
});

test("relationship counts preserve the evidence matrix categories", () => {
  const counts = countRelationships([
    analysis,
    { ...analysis, id: "analysis-2", relationship: "Supports" },
    { ...analysis, id: "analysis-3", relationship: "Contradicts" },
  ]);

  assert.deepEqual(counts, {
    Supports: 2,
    Complicates: 0,
    Contradicts: 1,
    Context: 0,
  });
});
