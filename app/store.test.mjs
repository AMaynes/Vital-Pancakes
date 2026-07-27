import assert from "node:assert/strict";
import test from "node:test";

import { getWorkspace, isCoreSectionId } from "./store.js";

const WORKSPACE_KEY = "artificially-neuroscience-workspace-v1";
const EVERYDAY_SECTION_IDS = ["how-to-cook", "recipes", "workouts", "cleaning"];
const STUDIES_SECTION_IDS = [
  "studies",
  "questions-ideas",
  "programming-languages",
  "algorithms",
  "projects",
];

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  clear() {
    this.#values.clear();
  }
}

function useStorage(initialWorkspace = null) {
  globalThis.localStorage = new MemoryStorage();
  if (initialWorkspace) {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(initialWorkspace));
  }
}

test("a new workspace starts with four permanent Everyday Life libraries", () => {
  useStorage();

  const workspace = getWorkspace();
  const everydaySections = workspace.sections.filter((section) => section.area === "everyday");

  assert.equal(workspace.version, 6);
  assert.deepEqual(everydaySections.map((section) => section.id), EVERYDAY_SECTION_IDS);
  assert.deepEqual(
    workspace.sections.filter((section) => section.area !== "everyday").map((section) => section.id),
    STUDIES_SECTION_IDS,
  );
  assert.ok(everydaySections.every((section) => isCoreSectionId(section.id)));
  assert.equal(isCoreSectionId("questions-ideas"), true);
  assert.equal(workspace.sections.some((section) => section.id === "protocols"), false);
});

test("an empty legacy Protocols library is replaced without adding example content", () => {
  useStorage({
    version: 4,
    sections: [
      {
        id: "protocols",
        title: "Protocols",
        description: "Legacy",
        icon: "◎",
        type: "protocol",
        items: [],
      },
      {
        id: "studies",
        title: "Studies",
        description: "Existing studies",
        icon: "◉",
        type: "custom",
        items: [{ id: "study-1", title: "Preserved", updatedAt: "2026-01-01" }],
      },
    ],
  });

  const workspace = getWorkspace();

  assert.deepEqual(
    workspace.sections.filter((section) => section.area === "everyday").map((section) => section.id),
    EVERYDAY_SECTION_IDS,
  );
  assert.equal(workspace.sections.some((section) => section.id === "protocols"), false);
  assert.equal(workspace.sections.some((section) => section.id === "personal-routines"), false);
  assert.equal(workspace.sections.find((section) => section.id === "studies").items[0].title, "Preserved");
});

test("saved Protocol entries migrate into an Everyday Life routines library", () => {
  const savedRoutine = {
    id: "routine-1",
    title: "Morning reset",
    trigger: "After waking",
    steps: ["Open the blinds"],
    updatedAt: "2026-01-01",
  };
  useStorage({
    version: 4,
    sections: [
      {
        id: "protocols",
        title: "Protocols",
        description: "Legacy",
        icon: "◎",
        type: "protocol",
        items: [savedRoutine],
      },
    ],
  });

  const workspace = getWorkspace();
  const routines = workspace.sections.find((section) => section.id === "personal-routines");

  assert.equal(routines.area, "everyday");
  assert.equal(routines.type, "routine");
  assert.deepEqual(routines.items, [savedRoutine]);
});

test("existing workspaces gain Questions & Ideas without losing saved studies", () => {
  const savedStudy = {
    id: "study-1",
    title: "Existing study",
    updatedAt: "2026-01-01",
  };
  useStorage({
    version: 5,
    sections: [
      {
        id: "studies",
        title: "Studies",
        description: "Existing studies",
        icon: "◉",
        type: "custom",
        items: [savedStudy],
      },
    ],
  });

  const workspace = getWorkspace();
  const questionsAndIdeas = workspace.sections.find((section) => section.id === "questions-ideas");

  assert.equal(workspace.version, 6);
  assert.deepEqual(workspace.sections.find((section) => section.id === "studies").items, [savedStudy]);
  assert.deepEqual(questionsAndIdeas.items, []);
  assert.equal(questionsAndIdeas.type, "question");
  assert.equal(isCoreSectionId(questionsAndIdeas.id), true);
});
