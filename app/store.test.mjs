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

test("a new workspace starts with nine permanent libraries and editable examples", () => {
  useStorage();

  const workspace = getWorkspace();
  const everydaySections = workspace.sections.filter((section) => section.area === "everyday");
  const coreSections = workspace.sections.filter((section) => (
    [...EVERYDAY_SECTION_IDS, ...STUDIES_SECTION_IDS].includes(section.id)
  ));
  const sampleIds = coreSections.flatMap((section) => section.items.map((item) => item.id));

  assert.equal(workspace.version, 8);
  assert.deepEqual(everydaySections.map((section) => section.id), EVERYDAY_SECTION_IDS);
  assert.deepEqual(
    workspace.sections.filter((section) => section.area !== "everyday").map((section) => section.id),
    STUDIES_SECTION_IDS,
  );
  assert.ok(everydaySections.every((section) => isCoreSectionId(section.id)));
  assert.ok(coreSections.every((section) => section.items.length >= 2));
  assert.ok(coreSections.every((section) => section.items.every((item) => item.isSample === true)));
  assert.equal(new Set(sampleIds).size, sampleIds.length);
  assert.equal(workspace.sections.find((section) => section.id === "studies").type, "study");
  assert.equal(isCoreSectionId("questions-ideas"), true);
  assert.equal(workspace.sections.some((section) => section.id === "protocols"), false);
});

test("an empty legacy Protocols library is replaced while core examples are restored", () => {
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

test("existing workspaces gain examples in empty libraries without losing saved studies", () => {
  const savedStudy = {
    id: "study-1",
    title: "Existing study",
    notes: "Legacy notes remain available to the specialized study editor.",
    tags: ["memory"],
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

  assert.equal(workspace.version, 8);
  assert.deepEqual(workspace.sections.find((section) => section.id === "studies").items, [savedStudy]);
  assert.ok(questionsAndIdeas.items.length >= 2);
  assert.ok(questionsAndIdeas.items.every((item) => item.isSample === true));
  assert.equal(questionsAndIdeas.type, "question");
  assert.equal(isCoreSectionId(questionsAndIdeas.id), true);
});

test("a version 6 workspace preserves populated libraries and seeds only empty core libraries", () => {
  const savedAlgorithm = {
    id: "algorithm-user",
    title: "My algorithm",
    updatedAt: "2026-01-01",
  };
  useStorage({
    version: 6,
    sections: [
      {
        id: "algorithms",
        title: "Algorithms",
        description: "Existing algorithms",
        icon: "⌬",
        type: "algorithm",
        items: [savedAlgorithm],
      },
      {
        id: "recipes",
        title: "Recipes",
        description: "Existing recipes",
        icon: "◫",
        type: "recipe",
        area: "everyday",
        items: [],
      },
    ],
  });

  const workspace = getWorkspace();

  assert.deepEqual(workspace.sections.find((section) => section.id === "algorithms").items, [savedAlgorithm]);
  assert.ok(workspace.sections.find((section) => section.id === "recipes").items.length >= 2);
});

test("deleted examples do not reappear when a version 7 workspace is upgraded", () => {
  useStorage({
    version: 7,
    sections: [
      {
        id: "recipes",
        title: "Recipes",
        description: "User cleared this library",
        icon: "◫",
        type: "recipe",
        area: "everyday",
        items: [],
      },
    ],
  });

  const workspace = getWorkspace();

  assert.deepEqual(workspace.sections.find((section) => section.id === "recipes").items, []);
  assert.ok(workspace.sections.find((section) => section.id === "algorithms").items.length >= 2);
});

test("Workout Types is seeded as a Push library while Pull and Legs begin empty", () => {
  useStorage();

  const workouts = getWorkspace().sections.find((section) => section.id === "workouts");
  const pushExercises = workouts.items.filter((item) => item.category === "push");

  assert.ok(pushExercises.length >= 12);
  assert.equal(workouts.items.some((item) => item.category === "pull"), false);
  assert.equal(workouts.items.some((item) => item.category === "legs"), false);
  assert.ok(pushExercises.some((item) => item.title === "Barbell bench press"));
  assert.ok(pushExercises.some((item) => item.title === "Standing overhead press"));
  assert.ok(pushExercises.some((item) => item.title === "Cable triceps pushdown"));
});

test("version 7 workout samples are replaced without losing categorized user entries", () => {
  const savedPullExercise = {
    id: "user-row",
    title: "Chest-supported row",
    category: "pull",
    updatedAt: "2026-07-27",
  };
  useStorage({
    version: 7,
    sections: [
      {
        id: "workouts",
        title: "Workout Types",
        type: "workout",
        area: "everyday",
        items: [
          { id: "sample-workout-full-body", title: "Old sample", isSample: true },
          savedPullExercise,
        ],
      },
    ],
  });

  const workouts = getWorkspace().sections.find((section) => section.id === "workouts");

  assert.equal(workouts.items.some((item) => item.id === "sample-workout-full-body"), false);
  assert.deepEqual(workouts.items.find((item) => item.id === savedPullExercise.id), savedPullExercise);
  assert.ok(workouts.items.some((item) => item.id === "sample-push-barbell-bench-press"));
});
