import assert from "node:assert/strict";
import test from "node:test";

import {
  addStudyFolder,
  getWorkspace,
  isCoreSectionId,
  moveStudyEntry,
  moveStudyFolder,
  removeStudyFolder,
} from "./store.js";

const WORKSPACE_KEY = "artificially-neuroscience-workspace-v1";
const EVERYDAY_SECTION_IDS = ["how-to-cook", "recipes", "workouts", "cleaning", "everyday-other"];
const STUDIES_SECTION_IDS = [
  "studies",
  "idea-playground",
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
  globalThis.window = { dispatchEvent() {} };
  globalThis.CustomEvent = class CustomEvent {};
  if (initialWorkspace) {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(initialWorkspace));
  }
}

test("study folders can be added, nested, populated, and removed without deleting entries", () => {
  useStorage();
  const initial = getWorkspace();
  const studies = initial.sections.find((section) => section.id === "studies");
  const entry = studies.items[0];

  assert.equal(addStudyFolder("studies", "Drafts"), true);
  assert.equal(addStudyFolder("studies", "Archive"), true);
  assert.equal(moveStudyEntry("studies", entry.id, "Drafts"), true);
  assert.equal(moveStudyFolder("studies", "Drafts", "Archive"), true);

  let savedStudies = getWorkspace().sections.find((section) => section.id === "studies");
  assert.ok(savedStudies.folders.includes("Archive / Drafts"));
  assert.equal(savedStudies.items.find((item) => item.id === entry.id).folderPath, "Archive / Drafts");

  assert.equal(removeStudyFolder("studies", "Archive"), true);
  savedStudies = getWorkspace().sections.find((section) => section.id === "studies");
  assert.equal(savedStudies.folders.some((folder) => folder.startsWith("Archive")), false);
  assert.equal(savedStudies.items.find((item) => item.id === entry.id).folderPath, "");
});

test("a new workspace starts with eleven permanent libraries and editable examples", () => {
  useStorage();

  const workspace = getWorkspace();
  const everydaySections = workspace.sections.filter((section) => section.area === "everyday");
  const coreSections = workspace.sections.filter((section) => (
    [...EVERYDAY_SECTION_IDS, ...STUDIES_SECTION_IDS].includes(section.id)
  ));
  const sampleIds = coreSections.flatMap((section) => section.items.map((item) => item.id));

  assert.equal(workspace.version, 16);
  assert.deepEqual(everydaySections.map((section) => section.id), EVERYDAY_SECTION_IDS);
  assert.deepEqual(
    workspace.sections.filter((section) => section.area !== "everyday").map((section) => section.id),
    STUDIES_SECTION_IDS,
  );
  assert.ok(everydaySections.every((section) => isCoreSectionId(section.id)));
  assert.ok(coreSections.every((section) => section.items.length >= 1));
  assert.ok(coreSections.every((section) => section.items.every((item) => item.isSample === true)));
  assert.equal(new Set(sampleIds).size, sampleIds.length);
  assert.equal(workspace.sections.find((section) => section.id === "studies").type, "study");
  assert.equal(workspace.sections.find((section) => section.id === "idea-playground").playground, true);
  assert.equal(workspace.sections.find((section) => section.id === "questions-ideas").type, "idea");
  assert.equal(workspace.sections.find((section) => section.id === "everyday-other").type, "howto");
  assert.ok(workspace.sections.find((section) => section.id === "everyday-other").items.every((item) => item.steps.length));
  assert.ok([
    "An overview of how the economy works",
    "What is Entropy? What is Cross Entropy?",
    "Shannon Information Theory",
    "Neural Networks",
    "How to write technical papers effectively",
  ].every((title) => workspace.sections.find((section) => section.id === "studies").items.some((item) => item.title === title)));
  assert.ok(workspace.sections.find((section) => section.id === "how-to-cook").items.length >= 16);
  assert.ok(workspace.sections.find((section) => section.id === "how-to-cook").items.every((item) => item.tags?.length));
  const algorithms = workspace.sections.find((section) => section.id === "algorithms");
  assert.equal(algorithms.items.filter((item) => item.category === "traditional").length, 17);
  assert.equal(algorithms.items.filter((item) => item.category === "advanced").length, 5);
  assert.equal(algorithms.items.filter((item) => item.category === "analysis").length, 6);
  assert.ok(algorithms.items.every((item) => item.tags?.length));
  assert.ok(
    algorithms.items
      .filter((item) => item.category !== "analysis")
      .every((item) => item.purpose && item.cCode && item.javaCode),
  );
  const languages = workspace.sections.find((section) => section.id === "programming-languages");
  assert.ok(languages.items.every((item) => (
    item.quickFacts.length
    && item.coreConcepts.length
    && item.syntaxReference
    && item.lessons.length
  )));
  const projects = workspace.sections.find((section) => section.id === "projects");
  assert.ok(projects.items.every((item) => (
    item.mainIdea
    && item.overview
    && item.architecture
    && item.codeMap.length
    && item.specifics
    && item.dependencies.length
    && item.projectMap
  )));
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

  assert.equal(workspace.version, 16);
  const migratedStudy = workspace.sections.find((section) => section.id === "studies").items[0];
  assert.equal(migratedStudy.id, savedStudy.id);
  assert.equal(migratedStudy.notes, savedStudy.notes);
  assert.match(migratedStudy.content, /Supporting notes/);
  assert.ok(questionsAndIdeas.items.length >= 2);
  assert.ok(questionsAndIdeas.items.every((item) => item.isSample === true));
  assert.equal(questionsAndIdeas.type, "idea");
  assert.equal(isCoreSectionId(questionsAndIdeas.id), true);
});

test("version 11 workspaces receive the expanded cooking guide samples", () => {
  useStorage({
    version: 11,
    sections: [
      {
        id: "how-to-cook",
        title: "How to Cook",
        description: "Existing cooking notes",
        icon: "⌁",
        type: "cooking-guide",
        area: "everyday",
        items: [
          {
            id: "user-cook-note",
            title: "My house sauce",
            updatedAt: "2026-01-01",
            tags: ["sauce"],
          },
        ],
      },
    ],
  });

  const cooking = getWorkspace().sections.find((section) => section.id === "how-to-cook");

  assert.equal(getWorkspace().version, 16);
  assert.ok(cooking.items.some((item) => item.id === "user-cook-note"));
  assert.ok(cooking.items.some((item) => item.id === "sample-cook-knife-prep"));
  assert.ok(cooking.items.some((item) => item.tags?.includes("heat control")));
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

  const algorithms = workspace.sections.find((section) => section.id === "algorithms");
  const migratedAlgorithm = algorithms.items.find((item) => item.id === savedAlgorithm.id);
  assert.equal(migratedAlgorithm.id, savedAlgorithm.id);
  assert.equal(migratedAlgorithm.title, savedAlgorithm.title);
  assert.equal(migratedAlgorithm.updatedAt, savedAlgorithm.updatedAt);
  assert.equal(migratedAlgorithm.category, "personal");
  assert.deepEqual(migratedAlgorithm.tags, ["personal"]);
  assert.equal(migratedAlgorithm.purpose, "");
  assert.equal(migratedAlgorithm.cCode, "");
  assert.equal(migratedAlgorithm.javaCode, "");
  assert.ok(algorithms.items.some((item) => item.id === "sample-algorithm-merge-sort"));
  assert.ok(algorithms.items.some((item) => item.id === "sample-analysis-time-complexity"));
  assert.ok(workspace.sections.find((section) => section.id === "recipes").items.length >= 2);
});

test("version 13 language, algorithm, and project records gain the new structure without losing legacy content", () => {
  useStorage({
    version: 13,
    sections: [
      {
        id: "programming-languages",
        type: "language",
        items: [{
          id: "user-language",
          title: "Rust",
          useWhen: "Systems work",
          mentalModel: "Ownership controls lifetimes.",
          syntax: "fn main() {}",
          patterns: ["Model invalid states out"],
          gotchas: "Borrowing rules are explicit.",
        }],
      },
      {
        id: "algorithms",
        type: "algorithm",
        items: [{
          id: "user-algorithm",
          title: "My scheduler",
          category: "advanced",
          useCases: "Prioritize personal work.",
          tags: ["scheduling"],
        }],
      },
      {
        id: "projects",
        type: "project",
        items: [{
          id: "user-project",
          title: "Planner",
          problem: "Plans were scattered.",
          solution: "Use one timeline.",
          outcome: "A working prototype.",
        }],
      },
    ],
  });

  const workspace = getWorkspace();
  const language = workspace.sections.find((section) => section.id === "programming-languages")
    .items.find((item) => item.id === "user-language");
  const algorithm = workspace.sections.find((section) => section.id === "algorithms")
    .items.find((item) => item.id === "user-algorithm");
  const project = workspace.sections.find((section) => section.id === "projects")
    .items.find((item) => item.id === "user-project");

  assert.equal(workspace.version, 16);
  assert.deepEqual(language.quickFacts, [
    "Best for | Systems work",
    "Watch for | Borrowing rules are explicit.",
  ]);
  assert.deepEqual(language.coreConcepts, ["Personal mental model | Ownership controls lifetimes."]);
  assert.equal(language.syntaxReference, "fn main() {}");
  assert.deepEqual(language.lessons, ["Practice | Model invalid states out"]);
  assert.equal(algorithm.category, "advanced");
  assert.equal(algorithm.purpose, "Prioritize personal work.");
  assert.equal(algorithm.cCode, "");
  assert.equal(algorithm.javaCode, "");
  assert.deepEqual(algorithm.tags, ["scheduling"]);
  assert.equal(project.mainIdea, "Plans were scattered.");
  assert.equal(project.overview, "A working prototype.");
  assert.equal(project.specifics, "Use one timeline.");
  assert.deepEqual(project.codeMap, []);
  assert.deepEqual(project.dependencies, []);
  assert.match(project.projectMap, /Overview & big picture/);
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

test("Workout Types is seeded with Push, Pull, and Legs exercise libraries", () => {
  useStorage();

  const workouts = getWorkspace().sections.find((section) => section.id === "workouts");
  const pushExercises = workouts.items.filter((item) => item.category === "push");
  const pullExercises = workouts.items.filter((item) => item.category === "pull");
  const legExercises = workouts.items.filter((item) => item.category === "legs");

  assert.ok(pushExercises.length >= 12);
  assert.ok(pullExercises.length >= 12);
  assert.ok(legExercises.length >= 12);
  assert.ok(pushExercises.some((item) => item.title === "Barbell bench press"));
  assert.ok(pushExercises.some((item) => item.title === "Standing overhead press"));
  assert.ok(pushExercises.some((item) => item.title === "Cable triceps pushdown"));
  assert.ok(pullExercises.some((item) => item.title === "Pull-up"));
  assert.ok(pullExercises.some((item) => item.title === "Chest-supported row"));
  assert.ok(pullExercises.some((item) => item.title === "Hammer curl"));
  assert.ok(legExercises.some((item) => item.title === "Barbell back squat"));
  assert.ok(legExercises.some((item) => item.title === "Romanian deadlift"));
  assert.ok(legExercises.some((item) => item.title === "Standing calf raise"));
});

test("version 9 workout libraries receive Pull and Legs samples without losing user entries", () => {
  const savedExercise = {
    id: "user-pull-entry",
    title: "My cable row",
    category: "pull",
    updatedAt: "2026-07-27",
  };
  useStorage({
    version: 9,
    sections: [
      {
        id: "workouts",
        title: "Workout Types",
        type: "workout",
        area: "everyday",
        items: [
          {
            id: "sample-push-barbell-bench-press",
            title: "Barbell bench press",
            category: "push",
            isSample: true,
          },
          savedExercise,
        ],
      },
    ],
  });

  const workouts = getWorkspace().sections.find((section) => section.id === "workouts");

  assert.equal(getWorkspace().version, 16);
  const migratedExercise = workouts.items.find((item) => item.id === savedExercise.id);
  assert.equal(migratedExercise.id, savedExercise.id);
  assert.equal(migratedExercise.title, savedExercise.title);
  assert.deepEqual(migratedExercise.muscleTags, []);
  assert.ok(workouts.items.some((item) => item.id === "sample-pull-pull-up"));
  assert.ok(workouts.items.some((item) => item.id === "sample-legs-back-squat"));
  assert.equal(
    workouts.items.filter((item) => item.id === "sample-push-barbell-bench-press").length,
    1,
  );
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
  const migratedExercise = workouts.items.find((item) => item.id === savedPullExercise.id);
  assert.equal(migratedExercise.id, savedPullExercise.id);
  assert.equal(migratedExercise.category, savedPullExercise.category);
  assert.equal(migratedExercise.animationUrl, "");
  assert.ok(workouts.items.some((item) => item.id === "sample-push-barbell-bench-press"));
});

test("Cleaning contains filled House Cleaning and Self Care libraries with tags", () => {
  useStorage();

  const cleaning = getWorkspace().sections.find((section) => section.id === "cleaning");
  const houseEntries = cleaning.items.filter((item) => item.category === "house");
  const selfCareEntries = cleaning.items.filter((item) => item.category === "self-care");

  assert.equal(cleaning.title, "Cleaning");
  assert.ok(houseEntries.length >= 10);
  assert.ok(selfCareEntries.length >= 9);
  assert.ok(cleaning.items.every((item) => item.tags.length >= 2));
  assert.ok(houseEntries.some((item) => item.title === "Refrigerator cleanout"));
  assert.ok(selfCareEntries.some((item) => item.title === "Personal laundry"));
  assert.ok(selfCareEntries.some((item) => item.title === "Oral hygiene"));
  assert.ok(houseEntries.some((item) => item.cardType === "Master" && item.schedule.length));
  assert.ok(selfCareEntries.some((item) => item.cardType === "Master" && item.schedule.length));
  assert.ok(selfCareEntries.some((item) => item.cardType === "Extended"));
});

test("version 10 cleaning entries gain categories and tags without losing user content", () => {
  const savedLaundryEntry = {
    id: "user-laundry",
    title: "Laundry for dark clothes",
    frequency: "Weekly",
    updatedAt: "2026-07-27",
  };
  useStorage({
    version: 10,
    sections: [
      {
        id: "cleaning",
        title: "House Cleaning",
        type: "cleaning",
        area: "everyday",
        items: [
          { id: "sample-clean-kitchen-reset", title: "Old sample", isSample: true },
          savedLaundryEntry,
        ],
      },
    ],
  });

  const cleaning = getWorkspace().sections.find((section) => section.id === "cleaning");
  const migratedEntry = cleaning.items.find((item) => item.id === savedLaundryEntry.id);

  assert.equal(cleaning.items.some((item) => item.id === "sample-clean-kitchen-reset" && item.title === "Old sample"), false);
  assert.equal(migratedEntry.category, "self-care");
  assert.ok(migratedEntry.tags.includes("weekly"));
  assert.ok(migratedEntry.tags.includes("laundry"));
  assert.ok(cleaning.items.some((item) => item.id === "sample-self-shower"));
});
