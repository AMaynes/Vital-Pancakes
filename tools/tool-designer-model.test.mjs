import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeterministicDesign,
  buildImplementationPrompt,
  createDesignProject,
  createRevision,
  mergeLockedDesign,
  normalizeRequirements,
  reviewDesign,
  validateDesignProject,
} from "./tool-designer-model.mjs";

test("requirement normalization merges template and user requirements", () => {
  const project = createDesignProject({
    name: "Lab",
    template: "visualizer",
    answers: { mustHave: "Heatmap\nCSV import", inputs: "Sensor readings", outputs: "PNG" },
  });
  const requirements = normalizeRequirements(project);
  assert.ok(requirements.mustHave.includes("Heatmap"));
  assert.ok(requirements.inputs.includes("Sensor readings"));
  assert.ok(requirements.outputs.includes("PNG"));
});

test("locked design sections survive regeneration", () => {
  const existing = { summary: "Keep this" };
  const merged = mergeLockedDesign(existing, { summary: "Replace", goals: "Goals" }, ["summary"]);
  assert.equal(merged.summary, "Keep this");
  assert.equal(merged.goals, "Goals");
});

test("review flags contradictions, missing decisions, and oversized scope", () => {
  const project = createDesignProject({
    brainDump: "Use cloud sync and an account.",
    answers: {
      privacy: "browser-local, no backend",
      mustHave: Array.from({ length: 20 }, (_, index) => `Feature ${index}`).join("\n"),
    },
  });
  project.design = buildDeterministicDesign(project);
  const ids = reviewDesign(project).map((item) => item.id);
  assert.ok(ids.includes("privacy-contradiction"));
  assert.ok(ids.includes("oversized-scope"));
});

test("version history snapshots do not mutate with the project", () => {
  const project = createDesignProject({ name: "Original" });
  project.design = buildDeterministicDesign(project);
  const revision = createRevision(project, "First", new Date("2026-07-29T00:00:00Z"));
  project.design.summary = "Changed";
  assert.notEqual(revision.design.summary, project.design.summary);
});

test("implementation prompt contains every design section and repository defaults", () => {
  const project = createDesignProject({ name: "Complete Tool", brainDump: "Do a useful thing." });
  project.design = buildDeterministicDesign(project);
  const prompt = buildImplementationPrompt(project);
  assert.match(prompt, /Acceptance Criteria/);
  assert.match(prompt, /Static GitHub Pages/);
  assert.match(prompt, /service worker/);
  assert.match(prompt, /Implement the complete tool/);
});

test("project package validation rejects unknown templates and versions", () => {
  const project = createDesignProject();
  assert.equal(validateDesignProject(project).version, 1);
  assert.throws(() => validateDesignProject({ ...project, template: "unknown" }), /Unknown/);
  assert.throws(() => validateDesignProject({ ...project, version: 4 }), /Unsupported/);
});
