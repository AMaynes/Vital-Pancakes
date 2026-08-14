/**
 * Overview & Purpose
 * Renders the local-first Everyday Life, Studies & Projects, and tools areas,
 * including type-aware entry editors and offline registration.
 *
 * Architectural Relationships
 * Called by: workspace.html.
 * Calls: app/store.js, the AI page host, and browser DOM, dialog, and
 * service-worker APIs.
 *
 * External Resources
 * workspace.css, manifest.webmanifest, and sw.js.
 *
 * Notes
 * All user-authored values are rendered with textContent. Animation timers are
 * cleared on every route render so they cannot outlive their visible cards.
 */

import {
  addItem,
  createId,
  deleteItem,
  deleteSection,
  getSection,
  getWorkspace,
  isCoreSectionId,
  saveWorkspace,
  updateItem,
} from "./store.js?v=16";
import { installAiPageHost } from "./ai-page-host.mjs";
import { createWorkspaceAiAdapter } from "./workspace-ai-adapter.mjs";
import {
  buildContentHash,
  CONTENT_VIEWS,
  getContentViewStorageKey,
  normalizeContentView,
} from "./content-view.mjs";
import {
  collectEntryTags,
  filterItemsByTags,
  normalizeEntryTags,
} from "./tag-filter.mjs?v=1";
import {
  buildKnowledgeOutline,
  buildProjectMapTree,
  groupEntriesByFolder,
  parseDefinitionLines,
  parseKnowledgeContent,
  parseNotecardLinks,
} from "./knowledge-entry-model.mjs?v=1";
import { listGlossaryEntries, saveGlossaryEntry } from "./knowledge-db.mjs";

const appMain = document.querySelector("#app-main");
const itemDialog = document.querySelector("#item-dialog");
const itemForm = document.querySelector("#item-form");
const animationTimers = new Set();

let activeSectionId = null;
let editingItemId = null;
const activeSectionSearchFilters = new Map();
const activeSectionTagFilters = new Map();
const activeWorkoutMuscleFilters = new Map();
const activeCleaningTagFilters = new Map();

const SECTION_LABELS = {
  "cooking-guide": "COOKING GUIDE",
  recipe: "RECIPE",
  workout: "WORKOUT",
  cleaning: "CLEANING ROUTINE",
  howto: "HOW-TO",
  routine: "ROUTINE",
  study: "STUDY",
  language: "LANGUAGE",
  algorithm: "ALGORITHM",
  project: "PROJECT",
  idea: "IDEA",
  question: "IDEA",
  custom: "ENTRY",
};

const SECTION_ACCENTS = {
  "cooking-guide": "ochre",
  recipe: "coral",
  workout: "blue",
  cleaning: "sage",
  howto: "coral",
  routine: "violet",
  study: "coral",
  language: "blue",
  algorithm: "violet",
  project: "ochre",
  idea: "sage",
  question: "sage",
  custom: "coral",
};

const SECTION_PRESENTATIONS = {
  "cooking-guide": {
    mode: "technique-atlas",
    kicker: "TECHNIQUE ATLAS",
    introduction: "Learn the transferable method—not only one dish. Each guide pairs heat, sensory signals, a repeatable sequence, and failure recovery.",
    stages: [
      ["1", "Understand", "Know what physical change you are trying to create."],
      ["2", "Observe", "Use sound, smell, color, and texture as live feedback."],
      ["3", "Correct", "Change heat, time, moisture, or movement before guessing."],
    ],
  },
  recipe: {
    mode: "recipe-book",
    kicker: "WORKING RECIPE BOOK",
    introduction: "Recipes are formatted for use at the stove: yield and timing first, mise en place beside the ordered method, and adjustment notes where they matter.",
    stages: [
      ["01", "Prepare", "Read the whole method and arrange ingredients by use."],
      ["02", "Cook", "Follow the order while watching the food, not only the clock."],
      ["03", "Revise", "Record the change that would make the next attempt better."],
    ],
  },
  workout: {
    mode: "training-log",
    kicker: "TRAINING TEMPLATES",
    introduction: "Each entry is a reusable session blueprint organized around purpose, dosage, equipment, movement order, and an explicit progression rule.",
    stages: [
      ["G", "Goal", "Choose the adaptation the session is supposed to produce."],
      ["D", "Dose", "Set frequency, duration, sets, reps, and effort."],
      ["P", "Progress", "Change one variable only after the current dose is owned."],
    ],
  },
  cleaning: {
    mode: "care-manual",
    kicker: "HOUSE CARE MANUAL",
    introduction: "Treat the house as zones and materials. Each route names the supplies, safety limits, frequency, and clean-to-dirty order.",
    stages: [
      ["Z", "Zone", "Define the exact surfaces included in this pass."],
      ["S", "Supply", "Use the least aggressive product that fits the material."],
      ["R", "Route", "Work high to low and clean to dirty without backtracking."],
    ],
  },
  study: {
    mode: "study-dossier",
    kicker: "INQUIRY DOSSIERS",
    introduction: "Studies separate the question, prediction, method, observations, conclusion, and limitations so a convincing story cannot outrun the evidence.",
    stages: [
      ["Q", "Question", "State something specific enough to be wrong."],
      ["E", "Evidence", "Decide what would change your mind before collecting it."],
      ["N", "Next test", "End with the smallest useful follow-up, not false closure."],
    ],
  },
  idea: {
    mode: "idea-board",
    kicker: "IDEA FORMULATION",
    introduction: "Ideas are unproven personal thinking. Working Ideas keeps uncertainty, assumptions, reasoning, and open questions visible while the thought takes shape.",
    stages: [
      ["?", "Prompt", "Capture the observation or tension that opened the question."],
      ["↗", "Branches", "List distinct paths to investigate, test, or build."],
      ["≈", "Position", "Say what you think now without disguising uncertainty."],
    ],
  },
  language: {
    mode: "language-reference",
    kicker: "LANGUAGE FIELD GUIDE",
    introduction: "Each language combines quick facts, a core-function mindmap, a syntax reference sheet, and specific lessons with explanations.",
    stages: [
      ["Q", "Quick facts", "Recover the language’s role, runtime, and data model."],
      ["M", "Mindmap", "See how the core concepts connect around the language."],
      ["L", "Lessons", "Preserve explanations that make the syntax meaningful."],
    ],
  },
  algorithm: {
    mode: "algorithm-lab",
    kicker: "ALGORITHM LAB",
    introduction: "Each algorithm moves from purpose and reasoning into an explained visual trace, English pseudocode, analysis, and real C and Java implementations.",
    stages: [
      ["P", "Purpose", "Recognize the problem shape and why this method fits."],
      ["V", "Visualize", "Walk through each state transition with an explanation."],
      ["C", "Code", "Connect English pseudocode to working C and Java."],
    ],
  },
  project: {
    mode: "project-casebook",
    kicker: "PROJECT CASEBOOK",
    introduction: "Projects preserve the main idea, visual overview, architecture, code map, implementation details, algorithm relationships, and dependencies.",
    stages: [
      ["01", "Idea", "State the project’s central purpose in plain language."],
      ["02", "System", "Map the architecture, functions, and moving parts."],
      ["03", "Build", "Explain implementation specifics and dependencies."],
    ],
  },
};

const LESSON_STUDY_PRESENTATION = {
  mode: "saved-lesson",
  kicker: "SOURCE-GROUNDED LESSON",
  introduction: "Approved lessons keep objectives, explanations, examples, review material, and checked textbook page references together in one editable record.",
  stages: [
    ["L", "Learn", "Follow the explanation from objectives through worked material."],
    ["R", "Review", "Use questions and flashcards for active recall."],
    ["S", "Source", "Return to the recorded textbook pages when a claim needs checking."],
  ],
};

const AREA_EVERYDAY = "everyday";
const AREA_STUDIES = "studies";
const AREA_TOOLS = "tools";
const VALID_AREAS = new Set([AREA_EVERYDAY, AREA_STUDIES, AREA_TOOLS]);
const WORKOUT_CATEGORIES = Object.freeze([
  {
    id: "push",
    title: "Push",
    description: "Chest, shoulder, and triceps movements built around pressing and arm extension.",
  },
  {
    id: "pull",
    title: "Pull",
    description: "Back, rear-delt, and biceps movements built around rowing, pulling, and arm flexion.",
  },
  {
    id: "legs",
    title: "Legs",
    description: "Quad, hamstring, glute, and calf movements built around squatting, hinging, and locomotion.",
  },
]);
const WORKOUT_MUSCLE_FILTERS = Object.freeze({
  push: [
    { id: "chest", label: "Chest", terms: ["chest", "pectoral", "pectoralis"] },
    { id: "upper-chest", label: "Upper chest", terms: ["upper chest", "incline"] },
    { id: "anterior-deltoids", label: "Front delts", terms: ["anterior deltoid", "front delt"] },
    { id: "lateral-deltoids", label: "Side delts", terms: ["lateral deltoid", "side delt"] },
    { id: "triceps", label: "Triceps", terms: ["triceps", "long head", "lateral head", "medial head"] },
    { id: "serratus-anterior", label: "Serratus", terms: ["serratus"] },
  ],
  pull: [
    { id: "lats", label: "Lats", terms: ["lat", "latissimus"] },
    { id: "upper-back", label: "Upper back", terms: ["upper back", "rhomboid", "teres"] },
    { id: "traps", label: "Traps", terms: ["trap", "trapezius"] },
    { id: "rear-deltoids", label: "Rear delts", terms: ["rear delt", "posterior deltoid"] },
    { id: "biceps", label: "Biceps", terms: ["biceps", "brachialis"] },
    { id: "forearms", label: "Forearms", terms: ["forearm", "grip"] },
  ],
  legs: [
    { id: "quads", label: "Quads", terms: ["quad", "quadriceps"] },
    { id: "hamstrings", label: "Hamstrings", terms: ["hamstring"] },
    { id: "glutes", label: "Glutes", terms: ["glute"] },
    { id: "calves", label: "Calves", terms: ["calf", "calves", "gastrocnemius", "soleus"] },
    { id: "adductors", label: "Adductors", terms: ["adductor"] },
    { id: "abductors", label: "Abductors", terms: ["abductor"] },
  ],
});
const CLEANING_CATEGORIES = Object.freeze([
  {
    id: "house",
    title: "House Cleaning",
    description: "Room-by-room routines for surfaces, appliances, floors, linens, waste, and seasonal deep cleaning.",
  },
  {
    id: "self-care",
    title: "Self Care",
    description: "Personal hygiene, grooming, laundry, linens, and clothing-care routines kept practical and repeatable.",
  },
]);
const ALGORITHM_CATEGORIES = Object.freeze([
  {
    id: "personal",
    title: "Personal Algorithms",
    description: "Your own reusable procedures, problem-solving methods, and algorithms developed through projects.",
  },
  {
    id: "traditional",
    title: "Traditional Algorithms",
    description: "Classic searching, sorting, traversal, graph, sequence, and mathematical foundations.",
  },
  {
    id: "advanced",
    title: "Advanced Algorithms",
    description: "More specialized techniques for optimization, pathfinding, connectivity, and pattern matching.",
  },
  {
    id: "analysis",
    title: "Algorithm Analysis",
    description: "Special lessons on comparison, time and space complexity, cases, recurrences, and benchmarking.",
  },
  howto: {
    mode: "howto-manual",
    kicker: "PERSONAL HOW-TO MANUAL",
    introduction: "Keep random practical procedures short, specific, and easy to follow when you do not want to rely on memory.",
    stages: [
      ["1", "Prepare", "List what must be ready before the task begins."],
      ["2", "Do", "Preserve the verified sequence in plain language."],
      ["3", "Confirm", "Record how to know the task is actually complete."],
    ],
  },
]);
const IDEA_CATEGORIES = Object.freeze([
  {
    id: "working",
    title: "Working Ideas",
    description: "Ideas still being formulated: provisional, unfinished, and explicitly unproven.",
  },
  {
    id: "formed",
    title: "Formed Ideas",
    description: "Coherent personal ideas that remain unproven until they are studied or tested.",
  },
]);

/**
 * Creates an element with optional class and text without parsing user HTML.
 *
 * @param {string} tagName HTML tag.
 * @param {string} className Space-separated class names.
 * @param {string} text Visible text.
 * @returns {HTMLElement} Constructed element.
 */
function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text) {
    element.textContent = text;
  }
  return element;
}

/**
 * Returns the section route encoded in the current hash.
 *
 * @returns {string|null} Section identifier, or null for the dashboard.
 */
function getRouteSectionId() {
  const parameters = new URLSearchParams(location.hash.slice(1));
  return parameters.get("section");
}

/**
 * Maps a library section to its top-level site area.
 *
 * @param {object} section Workspace section.
 * @returns {"everyday"|"studies"} Parent area.
 */
function getAreaForSection(section) {
  return section?.area === AREA_EVERYDAY ? AREA_EVERYDAY : AREA_STUDIES;
}

/**
 * Returns the active top-level area, deriving it from deep-linked sections.
 *
 * @returns {"everyday"|"studies"|"tools"} Active area.
 */
function getRouteArea() {
  const routeSectionId = getRouteSectionId();
  const section = routeSectionId ? getSection(routeSectionId) : null;
  if (section) return getAreaForSection(section);

  const parameters = new URLSearchParams(location.hash.slice(1));
  const requestedArea = parameters.get("area");
  if (requestedArea === "protocols") return AREA_EVERYDAY;
  return VALID_AREAS.has(requestedArea) ? requestedArea : AREA_TOOLS;
}

/**
 * Returns the editable libraries owned by one top-level area.
 *
 * @param {{sections: Array<object>}} workspace Workspace data.
 * @param {"everyday"|"studies"|"tools"} area Active area.
 * @returns {Array<object>} Area-specific sections.
 */
function getSectionsForArea(workspace, area) {
  if (area === AREA_EVERYDAY) {
    return workspace.sections.filter((section) => section.area === AREA_EVERYDAY);
  }
  if (area === AREA_STUDIES) {
    return workspace.sections.filter((section) => section.area !== AREA_EVERYDAY);
  }
  return [];
}

/**
 * Returns an entry deep-link target encoded in the current hash.
 *
 * @returns {string|null} Entry identifier, or null without a deep link.
 */
function getRouteItemId() {
  const parameters = new URLSearchParams(location.hash.slice(1));
  return parameters.get("item");
}

/**
 * Returns the active Push/Pull/Legs route when one is present.
 *
 * @returns {"push"|"pull"|"legs"|null} Supported category or null.
 */
function getRouteWorkoutCategory() {
  const requestedCategory = new URLSearchParams(location.hash.slice(1)).get("category");
  return WORKOUT_CATEGORIES.some((category) => category.id === requestedCategory)
    ? requestedCategory
    : null;
}

/**
 * Builds a workout category or exercise deep link.
 *
 * @param {string} categoryId Workout category identifier.
 * @param {string|null} itemId Optional exercise identifier.
 * @returns {string} Encoded hash.
 */
function buildWorkoutHash(categoryId, itemId = null) {
  const parameters = new URLSearchParams({ section: "workouts", category: categoryId });
  if (itemId) parameters.set("item", itemId);
  return `#${parameters.toString()}`;
}

function getRouteCleaningCategory() {
  const requestedCategory = new URLSearchParams(location.hash.slice(1)).get("category");
  return CLEANING_CATEGORIES.some((category) => category.id === requestedCategory)
    ? requestedCategory
    : null;
}

function buildCleaningHash(categoryId, itemId = null) {
  const parameters = new URLSearchParams({ section: "cleaning", category: categoryId });
  if (itemId) parameters.set("item", itemId);
  return `#${parameters.toString()}`;
}

function getRouteAlgorithmCategory() {
  const requestedCategory = new URLSearchParams(location.hash.slice(1)).get("category");
  return ALGORITHM_CATEGORIES.some((category) => category.id === requestedCategory)
    ? requestedCategory
    : null;
}

function buildAlgorithmHash(categoryId, itemId = null) {
  const parameters = new URLSearchParams({ section: "algorithms", category: categoryId });
  if (itemId) parameters.set("item", itemId);
  return `#${parameters.toString()}`;
}

function createCleaningTagFilters(section) {
  const categoryId = section.cleaningCategory;
  const availableTags = collectEntryTags(section.items);
  const availableTagNames = new Set(availableTags.map(({ tag }) => tag));
  const selectedTags = new Set(
    [...(activeCleaningTagFilters.get(categoryId) ?? [])]
      .filter((tag) => availableTagNames.has(tag)),
  );
  activeCleaningTagFilters.set(categoryId, selectedTags);
  const items = filterItemsByTags(section.items, selectedTags);

  if (!availableTags.length) return { element: null, items, selectedTags };

  const bar = createElement("section", "cleaning-filter-bar");
  bar.append(createElement("span", "tag-label", "Filter by tag"));
  const controls = createElement("div", "cleaning-filter-tags");
  availableTags.forEach(({ tag, count }) => {
    const button = createElement("button", "cleaning-filter-tag", `${tag} · ${count}`);
    button.type = "button";
    button.setAttribute("aria-pressed", String(selectedTags.has(tag)));
    button.addEventListener("click", () => {
      const nextTags = new Set(activeCleaningTagFilters.get(categoryId) ?? []);
      if (nextTags.has(tag)) nextTags.delete(tag);
      else nextTags.add(tag);
      activeCleaningTagFilters.set(categoryId, nextTags);
      renderWorkspace();
    });
    controls.append(button);
  });
  if (selectedTags.size) {
    const clearButton = createElement("button", "cleaning-filter-clear", "Clear filters");
    clearButton.type = "button";
    clearButton.addEventListener("click", () => {
      activeCleaningTagFilters.set(categoryId, new Set());
      renderWorkspace();
    });
    controls.append(clearButton);
  }
  bar.append(controls);
  return { element: bar, items, selectedTags };
}

/**
 * Returns normalized text used for workout muscle matching.
 *
 * @param {object} item Workout entry.
 * @returns {string} Searchable text.
 */
function getWorkoutSearchText(item) {
  return [
    item.title,
    item.summary,
    item.goal,
    ...(item.tags ?? []),
  ].join(" ").toLocaleLowerCase();
}

/**
 * Finds configured muscle filters that apply to a workout entry.
 *
 * @param {object} item Workout entry.
 * @param {string} categoryId Workout category identifier.
 * @returns {Array<string>} Matching muscle filter ids.
 */
function getWorkoutMuscleIds(item, categoryId) {
  const searchableText = getWorkoutSearchText(item);
  return (WORKOUT_MUSCLE_FILTERS[categoryId] ?? [])
    .filter((muscle) => muscle.terms.some((term) => searchableText.includes(term)))
    .map((muscle) => muscle.id);
}

/**
 * Builds toggleable workout muscle filters for the current category page.
 *
 * @param {object} section Workout category section.
 * @param {Array<object>} entries Category entries before filtering.
 * @returns {{element: HTMLElement|null, filteredItems: Array<object>, selectedIds: Set<string>}} Filter UI and result.
 */
function createWorkoutMuscleFilterBar(section, entries) {
  const categoryId = section.workoutCategory;
  const muscles = WORKOUT_MUSCLE_FILTERS[categoryId] ?? [];
  const availableMuscles = muscles.filter((muscle) => (
    entries.some((item) => getWorkoutMuscleIds(item, categoryId).includes(muscle.id))
  ));
  const selectedIds = new Set(
    [...(activeWorkoutMuscleFilters.get(categoryId) ?? [])]
      .filter((muscleId) => availableMuscles.some((muscle) => muscle.id === muscleId)),
  );
  activeWorkoutMuscleFilters.set(categoryId, selectedIds);

  const filteredItems = selectedIds.size
    ? entries.filter((item) => getWorkoutMuscleIds(item, categoryId).some((muscleId) => selectedIds.has(muscleId)))
    : entries;

  if (!availableMuscles.length) {
    return { element: null, filteredItems, selectedIds };
  }

  const bar = createElement("section", "workout-filter-bar");
  bar.append(createElement("span", "tag-label", "Muscle filters"));
  const controls = createElement("div", "workout-filter-tags");
  availableMuscles.forEach((muscle) => {
    const button = createElement("button", "workout-filter-tag", muscle.label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(selectedIds.has(muscle.id)));
    button.addEventListener("click", () => {
      const nextFilters = new Set(activeWorkoutMuscleFilters.get(categoryId) ?? []);
      if (nextFilters.has(muscle.id)) {
        nextFilters.delete(muscle.id);
      } else {
        nextFilters.add(muscle.id);
      }
      activeWorkoutMuscleFilters.set(categoryId, nextFilters);
      renderWorkspace();
    });
    controls.append(button);
  });
  if (selectedIds.size) {
    const clearButton = createElement("button", "workout-filter-clear", "Clear");
    clearButton.type = "button";
    clearButton.addEventListener("click", () => {
      activeWorkoutMuscleFilters.set(categoryId, new Set());
      renderWorkspace();
    });
    controls.append(clearButton);
  }
  bar.append(controls);
  return { element: bar, filteredItems, selectedIds };
}

/**
 * Clears timers and renders the active full-width workspace route.
 */
function renderWorkspace() {
  animationTimers.forEach((timer) => window.clearInterval(timer));
  animationTimers.clear();
  const area = getRouteArea();
  renderTopNavigation(area);

  const routeSectionId = getRouteSectionId();
  const section = routeSectionId ? getSection(routeSectionId) : null;
  if (section) {
    renderSection(section);
  } else {
    renderDashboard(area);
  }
}

/**
 * Marks the active area in the permanent five-section header.
 *
 * @param {"everyday"|"studies"|"tools"} area Active area.
 */
function renderTopNavigation(area) {
  document.querySelectorAll("[data-site-area]").forEach((link) => {
    if (link.dataset.siteArea === area) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

/**
 * Shows the active area dashboard.
 *
 * @param {"everyday"|"studies"|"tools"} area Active area.
 */
function renderDashboard(area) {
  appMain.replaceChildren();
  delete appMain.dataset.sectionType;
  delete appMain.dataset.sectionTitle;
  delete appMain.dataset.itemTitle;
  const workspace = getWorkspace();

  if (area === AREA_TOOLS) {
    renderToolsDashboard();
    return;
  }

  if (area === AREA_STUDIES) {
    renderStudiesDashboard(workspace);
    return;
  }

  renderEverydayDashboard(workspace);
}

/**
 * Creates the consistent introduction used by each local-first area.
 *
 * @param {string} eyebrow Small uppercase label.
 * @param {string} title Area title.
 * @param {string} subtitle Area purpose.
 * @returns {HTMLElement} Area hero.
 */
function createAreaHero(eyebrow, title, subtitle) {
  const hero = createElement("section", "workspace-hero");
  const heroCopy = createElement("div", "hero-copy");
  heroCopy.append(
    createElement("p", "eyebrow", eyebrow),
    createElement("h1", "", title),
    createElement("p", "hero-subtitle", subtitle),
  );
  const dateCard = createElement("div", "date-card");
  const now = new Date();
  dateCard.append(
    createElement("span", "", new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(now).toUpperCase()),
    createElement("strong", "", String(now.getDate())),
    createElement("small", "", new Intl.DateTimeFormat(undefined, { month: "long" }).format(now)),
  );
  hero.append(heroCopy, dateCard);
  return hero;
}

/**
 * Renders the Studies & Projects library and its notecard collections.
 *
 * @param {{sections: Array<object>}} workspace Workspace data.
 */
function renderStudiesDashboard(workspace) {
  const hero = createAreaHero(
    "STUDIES & PROJECTS",
    "Develop ideas and preserve what you learn.",
    "Move from unproven thoughts to foldered studies and mapped projects without separating definitions, notecards, algorithms, or programming references from the work they support.",
  );
  const sectionsById = new Map(
    getSectionsForArea(workspace, AREA_STUDIES).map((section) => [section.id, section]),
  );
  const sectionHeading = createSectionHeading(
    "Knowledge areas",
    "Notecards, Studies, Ideas, and Projects are the only top-level areas here.",
  );
  const libraryGrid = createElement("div", "library-grid studies-hub-grid");

  const notecardsCard = createLibraryCard({
    id: "notecards",
    title: "Notecards",
    description: "Open the separate notecard archive for practice, review, and subject collections.",
    icon: "▤",
    type: "custom",
    items: [{}, {}, {}],
  });
  notecardsCard.href = "educational_resources/";
  libraryGrid.append(notecardsCard);

  ["studies", "questions-ideas", "projects"]
    .map((sectionId) => sectionsById.get(sectionId))
    .filter(Boolean)
    .forEach((section) => libraryGrid.append(createLibraryCard(section)));

  const notecardSection = createElement("section", "notecard-collections");
  notecardSection.id = "notecard-collections";
  const notecardHeading = createSectionHeading(
    "Notecards",
    "Practice existing collections or open the complete educational archive.",
  );
  const notecardGrid = createElement("div", "tool-grid");
  [
    {
      title: "Mathematics Notecards",
      copy: "Mixed practice, tests, missed-answer review, and worked explanations.",
      href: "educational_resources/mathematics/flashcard-practice.html",
      icon: "∑",
      accent: "blue",
    },
    {
      title: "Arts Notecards",
      copy: "Study art concepts, methods, movements, and visual language.",
      href: "educational_resources/arts/flashcard-practice.html",
      icon: "✦",
      accent: "ochre",
    },
    {
      title: "All Notecards",
      copy: "Open mathematics, neuroscience, computer science, and arts resources.",
      href: "educational_resources/",
      icon: "▤",
      accent: "violet",
    },
  ].forEach((resource) => notecardGrid.append(createToolCard(resource)));
  notecardSection.append(notecardHeading, notecardGrid);

  appMain.append(hero, sectionHeading, libraryGrid, notecardSection);
}

function getRouteKnowledgeSubsection() {
  return new URLSearchParams(location.hash.slice(1)).get("subsection");
}
/**
 * Renders the Everyday Life dashboard as distinct practical domains.
 *
 * @param {{sections: Array<object>}} workspace Workspace data.
 */
function renderEverydayDashboard(workspace) {
  const hero = createAreaHero(
    "EVERYDAY LIFE",
    "Keep ordinary life clear, capable, and manageable.",
    "Cooking, training, house care, and random practical how-tos stay here—separate from studies, research, projects, and work tools.",
  );
  const sections = getSectionsForArea(workspace, AREA_EVERYDAY);
  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  const domainGrid = createElement("div", "everyday-domain-grid");
  [
    {
      label: "01",
      title: "Cooking",
      copy: "Learn the underlying methods, then keep the recipes you actually use.",
      sectionIds: ["how-to-cook", "recipes"],
    },
    {
      label: "02",
      title: "Gym",
      copy: "Organize different workout types by goal, structure, exercises, and frequency.",
      sectionIds: ["workouts"],
    },
    {
      label: "03",
      title: "Cleaning",
      copy: "Keep house care and personal hygiene organized as clear, repeatable routines.",
      sectionIds: ["cleaning"],
    },
    {
      label: "04",
      title: "Other",
      copy: "Save random how-to instructions you do not want to forget or figure out again.",
      sectionIds: ["everyday-other"],
    },
  ].forEach((domain) => {
    const domainSection = createElement("section", "everyday-domain");
    const domainHeading = createElement("div", "everyday-domain-heading");
    domainHeading.append(
      createElement("span", "everyday-domain-number", domain.label),
      createElement("h2", "", domain.title),
      createElement("p", "", domain.copy),
    );
    const libraryGrid = createElement("div", "library-grid everyday-library-grid");
    domain.sectionIds
      .map((sectionId) => sectionsById.get(sectionId))
      .filter(Boolean)
      .forEach((section) => libraryGrid.append(createLibraryCard(section)));
    domainSection.append(domainHeading, libraryGrid);
    domainGrid.append(domainSection);
  });

  const displayedSectionIds = new Set([
    "how-to-cook",
    "recipes",
    "workouts",
    "cleaning",
    "everyday-other",
  ]);
  const additionalSections = sections.filter((section) => !displayedSectionIds.has(section.id));
  appMain.append(hero, domainGrid);
  if (additionalSections.length) {
    const additionalHeading = createSectionHeading(
      "Personal routines",
      "Saved routines carried forward from the former Protocols section.",
    );
    const additionalGrid = createElement("div", "library-grid");
    additionalSections.forEach((section) => additionalGrid.append(createLibraryCard(section)));
    appMain.append(additionalHeading, additionalGrid);
  }
}

/**
 * Renders the tools-only Workspace requested by the site organization.
 */
function renderToolsDashboard() {
  const hero = createAreaHero(
    "WORKSPACE",
    "Tools for doing the work.",
    "Keep the four tools you use most in reach, with every other specialized tool available when you need it.",
  );
  const mainTools = [
    {
      title: "Overhead",
      copy: "Capture thoughts, manage priorities and tasks, encrypt private records, track routines, and maintain inventory.",
      href: "tools/overhead.html",
      icon: "OH",
      accent: "coral",
    },
    {
      title: "Visual Board",
      copy: "A freeform canvas with drawing, rigging, image controls, reusable objects, and floor-plan templates.",
      href: "tools/visual-board.html",
      icon: "✣",
      accent: "blue",
    },
    {
      title: "PDF Tool",
      copy: "Sign PDFs, add genuine fillable text fields and vector marks, then download the edited copy.",
      href: "tools/pdf-signer.html",
      icon: "⌁",
      accent: "ochre",
    },
    {
      title: "Master Lesson Builder",
      copy: "Process textbooks locally, approve their outline, generate editable lessons, and chat with checked page citations.",
      href: "tools/master-lesson-builder.html",
      icon: "▥",
      accent: "coral",
    },
  ];
  const otherTools = [
    {
      title: "Graphing Tool",
      copy: "Import or enter data, build statistical charts, inspect summaries, and export reproducible graph projects.",
      href: "tools/graphing.html",
      icon: "⌁",
      accent: "blue",
    },
    {
      title: "Markdown & LaTeX Studio",
      copy: "Write local Markdown, math, and LaTeX source with safe preview, recovery, versions, export, and optional AI review.",
      href: "tools/markdown-studio.html",
      icon: "M",
      accent: "ochre",
    },
    {
      title: "Tool Designer & Planner",
      copy: "Turn rough ideas into reviewed requirements, implementation plans, agent prompts, and portable project packages.",
      href: "tools/tool-designer.html",
      icon: "◇",
      accent: "violet",
    },
    {
      title: "Color Aesthetic Generator",
      copy: "Build perceptual palettes from harmonies, moods, seeds, or local images with role and contrast checks.",
      href: "tools/color-aesthetic.html",
      icon: "◐",
      accent: "coral",
    },
    {
      title: "Bracket Generator",
      copy: "Run single elimination, double elimination, and round-robin tournaments with stable advancement and exports.",
      href: "tools/bracket-generator.html",
      icon: "⌜",
      accent: "sage",
    },
    {
      title: "Randomized Picker",
      copy: "Choose, order, group, eliminate, or spin weighted lists with transparent probabilities and seeded sessions.",
      href: "tools/randomized-picker.html",
      icon: "?",
      accent: "ochre",
    },
    {
      title: "Literature Analyzer",
      copy: "Highlight PDFs or webpages, attach comments, and export an annotated record.",
      href: "tools/literature-analyzer.html",
      icon: "⌑",
      accent: "sage",
    },
    {
      title: "Caption Relay",
      copy: "Capture English tab-audio captions, translate them locally into Vietnamese, and display a synchronized overlay.",
      href: "tools/caption-relay.html",
      icon: "CC",
      accent: "ochre",
    },
    {
      title: "Literature Curation",
      copy: "Organize literature analyses around an idea, claim, or hypothesis and compare how each source relates.",
      href: "tools/literature-curator.html",
      icon: "∵",
      accent: "blue",
    },
    {
      title: "Travel Planner",
      copy: "Start a trip, complete its travel brief, and build a linked day-by-day itinerary.",
      href: "tools/travel-planner.html",
      icon: "✈",
      accent: "coral",
    },
    {
      title: "Software Architect",
      copy: "Design a draggable software file and folder tree with aligned implementation notes.",
      href: "tools/architecture.html",
      icon: "⌘",
      accent: "violet",
    },
    {
      title: "File Converter",
      copy: "Convert images, audio, video, documents, archives, data, fonts, and specialist formats in your browser.",
      href: "tools/file-converter.html",
      icon: "⇄",
      accent: "coral",
    },
    {
      title: "Scientific Calculator",
      copy: "Evaluate nested scientific expressions with precise decimals, angle modes, memory, and local history.",
      href: "tools/scientific-calculator.html",
      icon: "∑",
      accent: "sage",
    },
    {
      title: "Budget & Finance",
      copy: "Project recurring cash flow, model investment growth and loan payoff, and find official tax sources.",
      href: "tools/budget-finance.html",
      icon: "$",
      accent: "ochre",
    },
  ];

  const mainHeading = createSectionHeading("Main", "These four tools stay visible.");
  const mainGrid = createElement("div", "tool-grid");
  mainTools.forEach((tool) => mainGrid.append(createToolCard(tool)));

  const otherSection = createElement("details", "other-tools-section");
  const otherSummary = createElement("summary", "other-tools-summary");
  const otherSummaryCopy = createElement("span");
  otherSummaryCopy.append(
    createElement("strong", "", "Other tools"),
    createElement("small", "", `${otherTools.length} specialized tools`),
  );
  otherSummary.append(
    otherSummaryCopy,
    createElement("span", "other-tools-toggle", "Show tools"),
  );
  const otherGrid = createElement("div", "tool-grid other-tools-grid");
  otherTools.forEach((tool) => otherGrid.append(createToolCard(tool)));
  otherSection.addEventListener("toggle", () => {
    otherSection.querySelector(".other-tools-toggle").textContent = otherSection.open
      ? "Hide tools"
      : "Show tools";
  });
  otherSection.append(otherSummary, otherGrid);

  appMain.append(hero, mainHeading, mainGrid, otherSection);
}
/**
 * Builds a reusable section heading row.
 *
 * @param {string} title Heading text.
 * @param {string} description Supporting copy.
 * @returns {HTMLElement} Heading row.
 */
function createSectionHeading(title, description) {
  const row = createElement("div", "content-heading-row");
  const copy = createElement("div");
  copy.append(createElement("h2", "", title), createElement("p", "", description));
  row.append(copy);
  return row;
}

/**
 * Creates a dashboard card for one core or legacy section.
 *
 * @param {object} section Section model.
 * @returns {HTMLElement} Linked section card.
 */
function createLibraryCard(section) {
  const card = createElement("a", `library-card accent-${SECTION_ACCENTS[section.type] ?? "coral"}`);
  card.href = `#section=${encodeURIComponent(section.id)}`;
  const icon = createElement("span", "card-symbol", section.icon);
  const body = createElement("div", "library-card-copy");
  body.append(
    createElement("span", "card-kicker", `${section.items.length} ${section.items.length === 1 ? "ENTRY" : "ENTRIES"}`),
    createElement("h3", "", section.title),
    createElement("p", "", section.description || "A flexible space for your notes."),
  );
  card.append(icon, body, createElement("span", "card-arrow", "↗"));
  return card;
}

/**
 * Creates a linked tool card.
 *
 * @param {{title: string, copy: string, href: string, icon: string, accent: string}} tool Tool metadata.
 * @returns {HTMLElement} Linked tool card.
 */
function createToolCard(tool) {
  const card = createElement("a", `tool-card accent-${tool.accent}`);
  card.href = tool.href;
  const icon = createElement("span", "tool-symbol", tool.icon);
  const body = createElement("div");
  body.append(createElement("h3", "", tool.title), createElement("p", "", tool.copy));
  card.append(icon, body, createElement("span", "card-arrow", "↗"));
  return card;
}

/**
 * Renders one section and its type-aware entries.
 *
 * @param {object} section Section model.
 */
function renderSection(section) {
  appMain.replaceChildren();
  appMain.dataset.sectionType = section.type;
  appMain.dataset.sectionTitle = section.title;
  delete appMain.dataset.itemTitle;
  activeSectionId = section.id;

  const routeItemId = getRouteItemId();
  const routeItem = routeItemId
    ? section.items.find((item) => item.id === routeItemId)
    : null;
  if (routeItem) {
    const workoutCategory = section.type === "workout"
      ? WORKOUT_CATEGORIES.find((candidate) => candidate.id === routeItem.category)
      : null;
    const cleaningCategory = section.type === "cleaning"
      ? CLEANING_CATEGORIES.find((candidate) => candidate.id === routeItem.category)
      : null;
    const algorithmCategory = section.type === "algorithm"
      ? ALGORITHM_CATEGORIES.find((candidate) => candidate.id === routeItem.category)
      : null;
    renderEntryDetail(
      workoutCategory
        ? { ...section, workoutCategory: workoutCategory.id, title: workoutCategory.title }
        : cleaningCategory
          ? { ...section, cleaningCategory: cleaningCategory.id, title: cleaningCategory.title }
          : algorithmCategory
            ? { ...section, algorithmCategory: algorithmCategory.id, title: algorithmCategory.title }
            : section,
      routeItem,
    );
    return;
  }

  if (section.type === "workout") {
    const categoryId = getRouteWorkoutCategory();
    if (!categoryId) {
      renderWorkoutCategoryIndex(section);
      return;
    }
    const category = WORKOUT_CATEGORIES.find((candidate) => candidate.id === categoryId);
    section = {
      ...section,
      workoutCategory: category.id,
      title: category.title,
      description: category.description,
      items: section.items.filter((item) => item.category === category.id),
    };
    appMain.dataset.sectionTitle = `Workout Types / ${category.title}`;
  }

  if (section.type === "cleaning") {
    const categoryId = getRouteCleaningCategory();
    if (!categoryId) {
      renderCleaningCategoryIndex(section);
      return;
    }
    const category = CLEANING_CATEGORIES.find((candidate) => candidate.id === categoryId);
    section = {
      ...section,
      cleaningCategory: category.id,
      title: category.title,
      description: category.description,
      items: section.items.filter((item) => item.category === category.id),
    };
    appMain.dataset.sectionTitle = `Cleaning / ${category.title}`;
  }

  if (section.type === "algorithm") {
    const categoryId = getRouteAlgorithmCategory();
    if (!categoryId) {
      renderAlgorithmCategoryIndex(section);
      return;
    }
    const category = ALGORITHM_CATEGORIES.find((candidate) => candidate.id === categoryId);
    section = {
      ...section,
      algorithmCategory: category.id,
      title: category.title,
      description: category.description,
      items: section.items.filter((item) => item.category === category.id),
    };
    appMain.dataset.sectionTitle = `Algorithms / ${category.title}`;
  }

  const workoutFilters = section.workoutCategory
    ? createWorkoutMuscleFilterBar(section, section.items)
    : null;
  const sectionFilters = ["cooking-guide", "algorithm", "study", "idea", "howto"].includes(section.type)
    ? createTagSearchFilterBar(section, workoutFilters?.filteredItems ?? section.items)
    : null;
  const cleaningFilters = section.cleaningCategory
    ? createCleaningTagFilters(section)
    : null;
  let visibleItems = cleaningFilters?.items
    ?? sectionFilters?.filteredItems
    ?? workoutFilters?.filteredItems
    ?? section.items;
  if (section.id === "questions-ideas" && getRouteKnowledgeSubsection() === "working-ideas") {
    visibleItems = visibleItems.filter((item) => (item.stage ?? "Working") === "Working");
  }
  const heading = createElement("section", "page-heading section-page-heading");
  const headingCopy = createElement("div");
  headingCopy.append(
    createElement("p", "eyebrow", `${section.icon} ${SECTION_LABELS[section.type] ?? "SECTION"} LIBRARY`),
    createElement("h1", "", section.title),
    createElement("p", "page-description", section.description || "A flexible space for your notes."),
  );
  const actions = createElement("div", "page-actions");
  const view = getSavedContentView(section.id);
  const viewSwitcher = createElement("div", "view-switcher");
  viewSwitcher.setAttribute("role", "group");
  viewSwitcher.setAttribute("aria-label", "Entry layout");
  viewSwitcher.append(
    createContentViewButton(section, CONTENT_VIEWS.LIST, view),
    createContentViewButton(section, CONTENT_VIEWS.GRID, view),
  );
  const addButton = createElement("button", "button button-primary", `+ Add ${getSingularLabel(section)}`);
  addButton.type = "button";
  addButton.addEventListener("click", () => openItemDialog(section));
  actions.append(viewSwitcher, addButton);
  if (!isCoreSectionId(section.id)) {
    const deleteButton = createElement("button", "button button-quiet", "Delete section");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => confirmSectionDelete(section));
    actions.append(deleteButton);
  }
  heading.append(headingCopy, actions);

  const meta = createElement("div", "section-meta");
  meta.append(
    createElement("span", "", `${visibleItems.length} ${visibleItems.length === 1 ? "entry" : "entries"}`),
    createElement("span", "", `${section.items.filter((item) => item.isSample).length} editable examples`),
    createElement("span", "", "Stored on this device"),
  );
  if (workoutFilters?.selectedIds.size || sectionFilters?.isActive || cleaningFilters?.selectedTags.size) {
    meta.prepend(createElement("span", "", `${visibleItems.length} of ${section.items.length} shown`));
  }

  const grid = createElement("div", `entry-index entry-index-${view}`);
  if (!visibleItems.length) {
    const empty = createEmptyState(
      section.items.length ? "No entries match those filters" : `No ${section.title.toLocaleLowerCase()} yet`,
      section.items.length ? "Try another search or clear a tag filter." : getEmptyMessage(section),
    );
    if (!section.items.length) {
      const emptyButton = createElement("button", "button button-primary", `Create the first ${getSingularLabel(section)}`);
      emptyButton.type = "button";
      emptyButton.addEventListener("click", () => openItemDialog(section));
      empty.append(emptyButton);
    }
    grid.append(empty);
  } else if (["study", "idea", "howto"].includes(section.type)) {
    groupEntriesByFolder(visibleItems).forEach(({ folder, entries }) => {
      const folderPanel = createElement("details", "study-folder");
      folderPanel.open = true;
      const summary = createElement("summary", "study-folder-heading");
      summary.append(
        createElement("span", "study-folder-icon", "▱"),
        createElement("strong", "", folder),
        createElement("small", "", `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`),
      );
      const folderGrid = createElement("div", `study-folder-entries entry-index-${view}`);
      entries
        .slice()
        .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
        .forEach((item, index) => folderGrid.append(createEntryIndexCard(section, item, index)));
      folderPanel.append(summary, folderGrid);
      grid.append(folderPanel);
    });
  } else {
    visibleItems
      .slice()
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
      .forEach((item, index) => grid.append(createEntryIndexCard(section, item, index)));
  }

  const subsectionPanel = createKnowledgeSubsectionPanel(section);
  appMain.append(heading);
  if (subsectionPanel) appMain.append(subsectionPanel);
  if (workoutFilters?.element) appMain.append(workoutFilters.element);
  if (sectionFilters?.element) appMain.append(sectionFilters.element);
  if (cleaningFilters?.element) appMain.append(cleaningFilters.element);
  appMain.append(meta, grid);
}

/**
 * Shows the child libraries that belong inside Studies or Ideas without
 * promoting them to top-level Studies & Projects areas.
 *
 * @param {object} section Active parent section.
 * @returns {HTMLElement|null} Subsection links and the current entry heading.
 */
function createKnowledgeSubsectionPanel(section) {
  if (!["studies", "questions-ideas"].includes(section.id)) return null;

  const workspace = getWorkspace();
  const panel = createElement("section", "knowledge-subsection-panel");
  const heading = createSectionHeading(
    "Subsections",
    section.id === "studies"
      ? "Algorithms and Programming Languages live inside Studies."
      : "Working Ideas holds unfinished personal thinking; Idea Playground holds experiments that begin testing it.",
  );
  const grid = createElement("div", "library-grid knowledge-subsection-grid");

  if (section.id === "studies") {
    ["algorithms", "programming-languages"]
      .map((sectionId) => workspace.sections.find((candidate) => candidate.id === sectionId))
      .filter(Boolean)
      .forEach((subsection) => grid.append(createLibraryCard(subsection)));
  } else {
    const workingIdeas = createLibraryCard({
      id: section.id,
      title: "Working Ideas",
      description: "Ideas still being formulated: provisional, unfinished, and explicitly unproven.",
      icon: "?",
      type: "idea",
      items: section.items.filter((item) => (item.stage ?? "Working") === "Working"),
    });
    workingIdeas.href = "#section=questions-ideas&subsection=working-ideas";
    grid.append(workingIdeas);
    const playground = workspace.sections.find((candidate) => candidate.id === "idea-playground");
    if (playground) grid.append(createLibraryCard(playground));
  }

  const entryHeading = createSectionHeading(
    section.id === "studies"
      ? "Study entries"
      : getRouteKnowledgeSubsection() === "working-ideas"
        ? "Working Ideas"
        : "Idea entries",
    section.id === "studies"
      ? "Use folders to group related studies while keeping each study independently linkable."
      : getRouteKnowledgeSubsection() === "working-ideas"
        ? "Use folders inside Working Ideas to group related thoughts while their uncertainty remains visible."
        : "Use folders to group your unproven personal thinking; open Working Ideas when you want only unfinished formulations.",
  );
  entryHeading.classList.add("knowledge-entry-heading");
  panel.append(heading, grid, entryHeading);
  return panel;
}

/**
 * Builds search and clickable tag filters for content-heavy libraries.
 *
 * @param {object} section Section model.
 * @param {Array<object>} entries Entries before filtering.
 * @returns {{element: HTMLElement|null, filteredItems: Array<object>, isActive: boolean}} Filter UI and result.
 */
function createTagSearchFilterBar(section, entries) {
  const tags = [...new Set(entries.flatMap((item) => item.tags ?? []))]
    .sort((left, right) => left.localeCompare(right));
  const searchText = activeSectionSearchFilters.get(section.id) ?? "";
  const selectedTags = new Set(
    [...(activeSectionTagFilters.get(section.id) ?? [])].filter((tag) => tags.includes(tag)),
  );
  activeSectionTagFilters.set(section.id, selectedTags);

  const normalizedSearch = searchText.trim().toLocaleLowerCase();
  const filteredItems = entries.filter((item) => {
    if (normalizedSearch && !getSectionSearchText(item).includes(normalizedSearch)) {
      return false;
    }
    if (!selectedTags.size) return true;
    const itemTags = new Set(normalizeEntryTags(item.tags));
    return section.type === "algorithm"
      ? [...selectedTags].some((tag) => itemTags.has(tag))
      : [...selectedTags].every((tag) => itemTags.has(tag));
  });

  if (!entries.length || (!tags.length && entries.length <= 4)) {
    return { element: null, filteredItems, isActive: Boolean(normalizedSearch || selectedTags.size) };
  }

  const bar = createElement("section", "section-filter-bar");
  const searchLabel = createElement("label", "section-search-filter");
  searchLabel.append(createElement("span", "tag-label", "Search"));
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = section.type === "algorithm"
    ? "Search algorithms"
    : section.type === "study"
      ? "Search studies and folders"
      : section.type === "idea"
        ? "Search working ideas"
        : section.type === "howto"
          ? "Search personal how-tos and folders"
        : "Search cooking methods";
  searchInput.value = searchText;
  searchInput.addEventListener("input", () => {
    const cursorPosition = searchInput.selectionStart ?? searchInput.value.length;
    activeSectionSearchFilters.set(section.id, searchInput.value);
    renderSection(section);
    const nextSearchInput = appMain.querySelector(".section-search-filter input");
    nextSearchInput?.focus();
    nextSearchInput?.setSelectionRange(cursorPosition, cursorPosition);
  });
  searchLabel.append(searchInput);
  bar.append(searchLabel);

  if (tags.length) {
    const controls = createElement("div", "section-filter-tags");
    controls.append(createElement("span", "tag-label", "Tags"));
    tags.forEach((tag) => {
      const button = createElement("button", "section-filter-tag", tag);
      button.type = "button";
      button.setAttribute("aria-pressed", String(selectedTags.has(tag)));
      button.addEventListener("click", () => {
        const nextTags = new Set(activeSectionTagFilters.get(section.id) ?? []);
        if (nextTags.has(tag)) {
          nextTags.delete(tag);
        } else {
          nextTags.add(tag);
        }
        activeSectionTagFilters.set(section.id, nextTags);
        renderSection(section);
      });
      controls.append(button);
    });
    if (selectedTags.size || normalizedSearch) {
      const clearButton = createElement("button", "section-filter-clear", "Clear");
      clearButton.type = "button";
      clearButton.addEventListener("click", () => {
        activeSectionSearchFilters.set(section.id, "");
        activeSectionTagFilters.set(section.id, new Set());
        renderSection(section);
      });
      controls.append(clearButton);
    }
    bar.append(controls);
  }

  return { element: bar, filteredItems, isActive: Boolean(normalizedSearch || selectedTags.size) };
}

/**
 * Returns normalized text used for collection search.
 *
 * @param {object} item Cooking guide entry.
 * @returns {string} Searchable text.
 */
function getSectionSearchText(item) {
  return Object.values(item)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();
}

/**
 * Renders Workout Types as three persistent training libraries before showing
 * the exercises inside an individual category.
 *
 * @param {object} section Workout Types section.
 */
function renderWorkoutCategoryIndex(section) {
  const heading = createElement("section", "page-heading section-page-heading");
  const headingCopy = createElement("div");
  headingCopy.append(
    createElement("p", "eyebrow", `${section.icon} TRAINING LIBRARY`),
    createElement("h1", "", section.title),
    createElement("p", "page-description", section.description),
  );
  heading.append(headingCopy);

  const categoryGrid = createElement("div", "workout-category-grid");
  WORKOUT_CATEGORIES.forEach((category) => {
    const entries = section.items.filter((item) => item.category === category.id);
    const card = createElement("a", "workout-category-card");
    card.href = buildWorkoutHash(category.id);
    const copy = createElement("div", "workout-category-copy");
    copy.append(
      createElement("span", "card-kicker", `${entries.length} ${entries.length === 1 ? "EXERCISE" : "EXERCISES"}`),
      createElement("h2", "", category.title),
      createElement("p", "", category.description),
    );
    const blankVisual = createElement("div", "workout-category-visual");
    blankVisual.setAttribute("aria-hidden", "true");
    card.append(copy, blankVisual, createElement("span", "card-arrow", "↗"));
    categoryGrid.append(card);
  });

  appMain.append(heading, categoryGrid);
}

/**
 * Renders Cleaning as two persistent, fully populated routine libraries.
 *
 * @param {object} section Cleaning section.
 */
function renderCleaningCategoryIndex(section) {
  const heading = createElement("section", "page-heading section-page-heading");
  const headingCopy = createElement("div");
  headingCopy.append(
    createElement("p", "eyebrow", `${section.icon} CARE LIBRARY`),
    createElement("h1", "", section.title),
    createElement("p", "page-description", section.description),
  );
  heading.append(headingCopy);

  const categoryGrid = createElement("div", "workout-category-grid cleaning-category-grid");
  CLEANING_CATEGORIES.forEach((category) => {
    const entries = section.items.filter((item) => item.category === category.id);
    const card = createElement("a", "workout-category-card cleaning-category-card");
    card.href = buildCleaningHash(category.id);
    const copy = createElement("div", "workout-category-copy");
    copy.append(
      createElement("span", "card-kicker", `${entries.length} ${entries.length === 1 ? "ROUTINE" : "ROUTINES"}`),
      createElement("h2", "", category.title),
      createElement("p", "", category.description),
    );
    const blankVisual = createElement("div", "workout-category-visual");
    blankVisual.setAttribute("aria-hidden", "true");
    card.append(copy, blankVisual, createElement("span", "card-arrow", "↗"));
    categoryGrid.append(card);
  });

  appMain.append(heading, categoryGrid);
}

/**
 * Renders Algorithms as Personal, Traditional, and Advanced libraries.
 *
 * @param {object} section Algorithms section.
 */
function renderAlgorithmCategoryIndex(section) {
  const heading = createElement("section", "page-heading section-page-heading");
  const headingCopy = createElement("div");
  headingCopy.append(
    createElement("p", "eyebrow", `${section.icon} ALGORITHM LAB`),
    createElement("h1", "", section.title),
    createElement("p", "page-description", section.description),
  );
  heading.append(headingCopy);

  const categoryGrid = createElement("div", "algorithm-category-grid");
  ALGORITHM_CATEGORIES.forEach((category, index) => {
    const entries = section.items.filter((item) => item.category === category.id);
    const card = createElement("a", `algorithm-category-card algorithm-category-${category.id}`);
    card.href = buildAlgorithmHash(category.id);
    const marker = createElement("span", "algorithm-category-marker", String(index + 1).padStart(2, "0"));
    const copy = createElement("div", "algorithm-category-copy");
    copy.append(
      createElement("span", "card-kicker", `${entries.length} ${entries.length === 1 ? "ALGORITHM" : "ALGORITHMS"}`),
      createElement("h2", "", category.title),
      createElement("p", "", category.description),
    );
    card.append(marker, copy, createElement("span", "card-arrow", "↗"));
    categoryGrid.append(card);
  });

  appMain.append(heading, categoryGrid);
}

/**
 * Reads a collection's retained list/grid preference.
 *
 * @param {string} sectionId Collection identifier.
 * @returns {"list"|"grid"} Retained view.
 */
function getSavedContentView(sectionId) {
  try {
    return normalizeContentView(localStorage.getItem(getContentViewStorageKey(sectionId)));
  } catch {
    return CONTENT_VIEWS.LIST;
  }
}

/**
 * Creates one button in the collection view switcher.
 *
 * @param {object} section Collection model.
 * @param {"list"|"grid"} targetView View selected by the button.
 * @param {"list"|"grid"} activeView Current view.
 * @returns {HTMLButtonElement} View button.
 */
function createContentViewButton(section, targetView, activeView) {
  const label = targetView === CONTENT_VIEWS.LIST ? "☷ List" : "⊞ Grid";
  const button = createElement("button", "view-button", label);
  button.type = "button";
  button.setAttribute("aria-pressed", String(targetView === activeView));
  button.addEventListener("click", () => {
    try {
      localStorage.setItem(getContentViewStorageKey(section.id), targetView);
    } catch {
      // The view still changes for this render when storage is unavailable.
    }
    renderSection(section);
  });
  return button;
}

/**
 * Creates one collapsed entry preview for list or grid collection layouts.
 *
 * @param {object} section Parent collection.
 * @param {object} item Entry model.
 * @param {number} index Entry position in the current sort.
 * @returns {HTMLElement} Linked preview card.
 */
function createEntryIndexCard(section, item, index) {
  const card = createElement("article", `entry-index-card entry-${section.type}`);
  const marker = createElement("span", "entry-index-marker", String(index + 1).padStart(2, "0"));
  const link = createElement("a", "entry-index-link");
  link.href = section.workoutCategory
    ? buildWorkoutHash(section.workoutCategory, item.id)
    : section.cleaningCategory
      ? buildCleaningHash(section.cleaningCategory, item.id)
      : section.algorithmCategory
        ? buildAlgorithmHash(section.algorithmCategory, item.id)
        : buildContentHash(section.id, item.id);
  link.setAttribute("aria-label", `Open ${item.title}`);

  const copy = createElement("div", "entry-index-copy");
  copy.append(
    createElement(
      "span",
      "card-kicker",
      `${item.isSample ? "EDITABLE EXAMPLE · " : ""}${getEntryTypeLabel(section, item)}`,
    ),
    createElement("h2", "", item.title),
    createElement("p", "", item.summary || "Open this entry to view its complete record."),
  );
  appendTagGroup(copy, "Tags", (item.tags ?? []).slice(0, 5));
  link.append(copy, createEntryVisual(section, item, true));

  const actions = createElement("div", "entry-index-actions");
  const editButton = createElement("button", "icon-button", "✎");
  editButton.type = "button";
  editButton.title = `Edit ${item.title}`;
  editButton.setAttribute("aria-label", `Edit ${item.title}`);
  editButton.addEventListener("click", () => openItemDialog(section, item));
  const deleteButton = createElement("button", "icon-button", "×");
  deleteButton.type = "button";
  deleteButton.title = `Delete ${item.title}`;
  deleteButton.setAttribute("aria-label", `Delete ${item.title}`);
  deleteButton.addEventListener("click", () => confirmItemDelete(section, item));
  actions.append(editButton, deleteButton);
  card.append(marker, link, actions);
  return card;
}

/**
 * Renders an individual entry as a subject-specific page.
 *
 * @param {object} section Parent collection.
 * @param {object} item Entry model.
 */
function renderEntryDetail(section, item) {
  appMain.dataset.itemTitle = item.title;

  const detail = createElement("article", `entry-detail entry-${section.type}`);
  const heading = createElement("header", "entry-detail-heading");
  const headingCopy = createElement("div");
  const backLink = createElement("a", "entry-back-link", `← ${section.title}`);
  backLink.href = section.workoutCategory
    ? buildWorkoutHash(section.workoutCategory)
    : section.cleaningCategory
      ? buildCleaningHash(section.cleaningCategory)
      : section.algorithmCategory
        ? buildAlgorithmHash(section.algorithmCategory)
        : buildContentHash(section.id);
  headingCopy.append(
    backLink,
    createElement(
      "p",
      "eyebrow",
      `${item.isSample ? "EDITABLE EXAMPLE · " : ""}${getEntryTypeLabel(section, item)}`,
    ),
    createElement("h1", "", item.title),
    createElement("p", "page-description", item.summary || section.description),
  );
  const actions = createElement("div", "page-actions entry-detail-actions");
  const editButton = createElement("button", "button button-primary", "Edit entry");
  editButton.type = "button";
  editButton.addEventListener("click", () => openItemDialog(section, item));
  const deleteButton = createElement("button", "button button-quiet", "Delete");
  deleteButton.type = "button";
  deleteButton.addEventListener("click", () => confirmItemDelete(section, item));
  actions.append(editButton, deleteButton);
  heading.append(headingCopy, actions);

  const lead = createElement("div", "entry-detail-lead");
  const context = createElement("section", "entry-detail-context");
  const presentation = item.format === "lesson"
    ? LESSON_STUDY_PRESENTATION
    : SECTION_PRESENTATIONS[section.type];
  context.append(
    createElement("p", "card-kicker", presentation?.kicker ?? "WORKING RECORD"),
    createElement(
      "p",
      "entry-detail-context-copy",
      presentation?.introduction ?? section.description ?? "A complete record kept for future use.",
    ),
  );
  if (presentation) {
    const stages = createElement("ol", "entry-detail-stages");
    presentation.stages.forEach(([marker, title]) => {
      const stage = createElement("li");
      stage.append(
        createElement("span", "", marker),
        createElement("strong", "", title),
      );
      stages.append(stage);
    });
    context.append(stages);
  }
  const visualPanel = createElement("aside", "entry-detail-visual-panel");
  visualPanel.append(
    createElement("span", "card-kicker", "SUBJECT VIEW"),
    createEntryVisual(section, item, false),
  );
  lead.append(context, visualPanel);

  const body = createElement("section", "entry-detail-content");
  body.append(createEntryBody(section, item));
  detail.append(heading, lead, body);
  appMain.append(detail);
}

function getEntryTypeLabel(section, item) {
  return item?.format === "lesson" ? "LESSON" : SECTION_LABELS[section.type] ?? "ENTRY";
}

/**
 * Builds a compact subject animation used in list, grid, and detail views.
 *
 * @param {object} section Parent collection.
 * @param {object} item Entry model.
 * @param {boolean} compact Whether this visual is a collection preview.
 * @returns {HTMLElement} Decorative subject visual.
 */
function createEntryVisual(section, item, compact) {
  const visual = createElement(
    "div",
    `entry-subject-visual visual-${section.type}${compact ? " is-compact" : ""}`,
  );
  visual.setAttribute("aria-hidden", "true");

  const frame = createElement("div", "subject-visual-frame");
  const symbol = createElement("div", "subject-visual-symbol");
  const type = section.type;
  if (type === "workout" || type === "cooking-guide" || type === "cleaning" || type === "howto") {
    visual.classList.add("is-blank");
    visual.append(frame);
    return visual;
  }
  if (type === "recipe") {
    symbol.append(
      createElement("i", "visual-vessel"),
      createElement("i", "visual-steam steam-one"),
      createElement("i", "visual-steam steam-two"),
      createElement("i", "visual-steam steam-three"),
    );
  } else if (type === "language") {
    symbol.append(
      createElement("i", "visual-code-line line-one"),
      createElement("i", "visual-code-line line-two"),
      createElement("i", "visual-code-line line-three"),
      createElement("i", "visual-cursor"),
    );
  } else if (type === "algorithm") {
    const tokens = (item.visualFrames?.[0] ?? "input > step > result")
      .split(">")
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, 3);
    tokens.forEach((token, index) => {
      const lastClass = index === tokens.length - 1 ? " is-last" : "";
      symbol.append(createElement("i", `visual-node node-${index + 1}${lastClass}`, token.slice(0, 2)));
    });
  } else if (type === "study" || type === "idea" || type === "question") {
    symbol.append(
      createElement("i", "visual-orbit"),
      createElement("i", "visual-orbit-node orbit-one"),
      createElement("i", "visual-orbit-node orbit-two"),
      createElement("i", "visual-orbit-node orbit-three"),
      createElement("i", "visual-core", ["idea", "question"].includes(type) ? "?" : "Q"),
    );
  } else if (type === "project") {
    symbol.append(
      createElement("i", "visual-route"),
      createElement("i", "visual-route-node route-one"),
      createElement("i", "visual-route-node route-two"),
      createElement("i", "visual-route-node route-three"),
    );
  } else {
    symbol.append(
      createElement("i", "visual-check-line check-one"),
      createElement("i", "visual-check-line check-two"),
      createElement("i", "visual-check-line check-three"),
    );
  }
  frame.append(symbol);
  visual.append(frame);
  return visual;
}

/**
 * Builds the subject-specific orientation strip shown before a library.
 *
 * @param {object} section Section model.
 * @returns {HTMLElement|null} Presentation strip for specialized core sections.
 */
function createSectionPresentation(section) {
  const presentation = SECTION_PRESENTATIONS[section.type];
  if (!presentation) return null;

  const panel = createElement("section", `section-presentation presentation-${presentation.mode}`);
  const introduction = createElement("div", "presentation-introduction");
  introduction.append(
    createElement("p", "card-kicker", presentation.kicker),
    createElement("p", "presentation-copy", presentation.introduction),
  );
  const stages = createElement("div", "presentation-stages");
  presentation.stages.forEach(([marker, title, copy]) => {
    const stage = createElement("article", "presentation-stage");
    stage.append(
      createElement("span", "presentation-marker", marker),
      createElement("strong", "", title),
      createElement("p", "", copy),
    );
    stages.append(stage);
  });
  panel.append(introduction, stages);
  return panel;
}

/**
 * Creates an empty-state panel.
 *
 * @param {string} title Empty-state title.
 * @param {string} copy Empty-state explanation.
 * @returns {HTMLElement} Empty-state element.
 */
function createEmptyState(title, copy) {
  const empty = createElement("section", "empty-state");
  empty.append(
    createElement("span", "empty-symbol", "∴"),
    createElement("h2", "", title),
    createElement("p", "", copy),
  );
  return empty;
}

/**
 * Produces section-specific guidance without adding any example content.
 *
 * @param {object} section Section model.
 * @returns {string} Empty-state guidance.
 */
function getEmptyMessage(section) {
  const messages = {
    "cooking-guide": "Add a cooking method or skill when you want its principles and steps available without searching again.",
    recipe: "Add a recipe you want to make, improve, and return to.",
    workout: "Add a type of workout with its purpose, frequency, and exercise structure.",
    cleaning: "Add a house-care or self-care routine with its frequency, supplies, ordered steps, and tags.",
    howto: "Add a random practical procedure when you want the exact preparation, steps, and warnings available later.",
    routine: "Turn a recurring task into a clear trigger and a checklist you can follow without re-planning it.",
    study: "Frame a question, decide what evidence matters, record the method, and keep limitations beside the findings.",
    idea: "Start in Working Ideas, make the unproven thought explicit, and record assumptions and open questions as it develops.",
    language: "Add a language when you need a refresher. Capture syntax, mental models, and the mistakes you want to avoid.",
    algorithm: "Add algorithms as you encounter them, including use cases and visual frames you can play back.",
    project: "Document a project’s interesting problem, your approach, and its language and algorithm relationships.",
    question: "Capture an open question or emerging idea, what prompted it, and the directions worth exploring.",
    custom: "Add the first note when this space has something worth keeping.",
  };
  return messages[section.type] ?? messages.custom;
}

/**
 * Returns a natural singular label for entry buttons.
 *
 * @param {object} section Section model.
 * @returns {string} Singular lowercase label.
 */
function getSingularLabel(section) {
  return {
    "cooking-guide": "cooking guide",
    recipe: "recipe",
    workout: "exercise",
    cleaning: "cleaning routine",
    howto: "how-to",
    routine: "routine",
    study: "study",
    idea: "idea",
    language: "language",
    algorithm: "algorithm",
    project: "project",
    question: "question or idea",
    custom: "entry",
  }[section.type] ?? "entry";
}

/**
 * Builds a type-aware entry card with safe edit and delete actions.
 *
 * @param {object} section Parent section.
 * @param {object} item Entry model.
 * @returns {HTMLElement} Entry card.
 */
function createEntryCard(section, item) {
  const card = createElement("article", `entry-card entry-${section.type}`);
  card.id = `entry-${item.id}`;
  const header = createElement("div", "entry-card-header");
  const titleGroup = createElement("div");
  titleGroup.append(
    createElement(
      "span",
      "card-kicker",
      `${item.isSample ? "EDITABLE EXAMPLE · " : ""}${getEntryTypeLabel(section, item)}`,
    ),
    createElement("h2", "", item.title),
  );
  const cardActions = createElement("div", "entry-card-actions");
  const editButton = createElement("button", "icon-button", "✎");
  editButton.type = "button";
  editButton.title = "Edit";
  editButton.addEventListener("click", () => openItemDialog(section, item));
  const deleteButton = createElement("button", "icon-button", "×");
  deleteButton.type = "button";
  deleteButton.title = "Delete";
  deleteButton.addEventListener("click", () => confirmItemDelete(section, item));
  cardActions.append(editButton, deleteButton);
  header.append(titleGroup, cardActions);
  card.append(header);

  if (item.summary) {
    card.append(createElement("p", "entry-summary", item.summary));
  }

  card.append(createEntryBody(section, item));
  return card;
}

/**
 * Dispatches an entry to its subject-specific content renderer.
 *
 * @param {object} section Parent collection.
 * @param {object} item Entry model.
 * @returns {HTMLElement} Complete entry content.
 */
function createEntryBody(section, item) {
  if (section.type === "cooking-guide") return createKnowledgeEntryLayout(section, item, {
    label: "Cooking study",
  });
  if (section.type === "recipe") return createRecipeBody(section, item);
  if (section.type === "workout") return createWorkoutBody(section, item);
  if (section.type === "cleaning") return createCleaningBody(section, item);
  if (section.type === "howto") return createHowToBody(section, item);
  if (section.type === "routine") return createRoutineBody(section, item);
  if (section.type === "study") return createStudyBody(section, item);
  if (section.type === "language") return createLanguageBody(item);
  if (section.type === "algorithm") return createAlgorithmBody(item);
  if (section.type === "project") return createProjectBody(section, item);
  if (section.type === "idea") return createIdeaBody(section, item);
  if (section.type === "question") return createIdeaBody(section, item);
  return createGenericBody(item);
}

/**
 * Renders a saved routine carried forward from the former Protocols area.
 *
 * @param {object} section Parent section.
 * @param {object} item Routine record.
 * @returns {HTMLElement} Routine content.
 */
function createRoutineBody(section, item) {
  const body = createElement("div", "entry-body");
  if (item.trigger) {
    body.append(createDefinition("Trigger", item.trigger));
  }
  appendPersistentChecklist(body, section, item, "Steps", item.steps, "checkedSteps");
  return body;
}

/**
 * Renders one practical reminder from Everyday Life / Other.
 *
 * @param {object} section Parent section.
 * @param {object} item How-to record.
 * @returns {HTMLElement} Practical how-to content.
 */
function createHowToBody(section, item) {
  const body = createElement("div", "entry-body howto-body");
  if (item.purpose) body.append(createDefinition("Why this is saved", item.purpose));
  if (item.checklist?.length) {
    body.append(createStructuredCardSection("Before you start", item.checklist, "howto-checklist"));
  }
  appendPersistentChecklist(body, section, item, "Steps", item.steps, "checkedSteps");
  if (item.warnings) body.append(createDefinition("Warnings and limits", item.warnings));
  if (item.notes) body.append(createDefinition("Personal notes", item.notes));
  appendTagGroup(body, "Tags", item.tags);
  return body;
}

/**
 * Renders cooking principles, essentials, mistakes, and a repeatable method.
 *
 * @param {object} section Parent section.
 * @param {object} item Cooking-guide record.
 * @returns {HTMLElement} Cooking-guide content.
 */
function createCookingGuideBody(section, item) {
  const body = createElement("div", "entry-body");
  const sensoryGuide = createElement("div", "sensory-guide");
  if (item.heat) sensoryGuide.append(createDefinition("Heat plan", item.heat));
  if (item.signals) sensoryGuide.append(createDefinition("Look · listen · smell", item.signals));
  if (sensoryGuide.childElementCount) body.append(sensoryGuide);
  const details = createElement("div", "technique-details");
  if (item.principles) details.append(createDefinition("What to understand", item.principles));
  if (item.essentials) details.append(createDefinition("Tools and essentials", item.essentials));
  if (item.mistakes) details.append(createDefinition("Common mistakes", item.mistakes));
  if (details.childElementCount) body.append(details);
  appendPersistentChecklist(body, section, item, "Method", item.steps, "checkedSteps");
  appendTagGroup(body, "Tags", item.tags);
  return body;
}

/**
 * Renders recipe details with separately trackable ingredients and method.
 *
 * @param {object} section Parent section.
 * @param {object} item Recipe record.
 * @returns {HTMLElement} Recipe content.
 */
function createRecipeBody(section, item) {
  const body = createElement("div", "entry-body recipe-spread recipe-reference-layout");
  const side = createElement("aside", "recipe-media-panel");
  const imageUrl = normalizeEntryUrl(item.imageUrl, { allowImageData: true });
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = item.title;
    image.loading = "lazy";
    side.append(image);
  } else {
    side.append(createElement("div", "recipe-image-placeholder", "Recipe picture"));
  }
  const macros = createElement("dl", "recipe-macros");
  [
    ["Calories", item.calories],
    ["Protein", item.protein],
    ["Carbs", item.carbs],
    ["Fat", item.fat],
  ].filter(([, value]) => value).forEach(([label, value]) => {
    macros.append(createElement("dt", "", label), createElement("dd", "", value));
  });
  if (macros.childElementCount) side.append(macros);

  const recipe = createElement("div", "recipe-reference-content");
  const details = createElement("div", "recipe-facts");
  if (item.servings) details.append(createDefinition("Servings", item.servings));
  if (item.timing) details.append(createDefinition("Time", item.timing));
  if (details.childElementCount) recipe.append(details);
  const columns = createElement("div", "recipe-columns");
  appendPersistentChecklist(columns, section, item, "Ingredients", item.ingredients, "checkedIngredients");
  appendPersistentChecklist(columns, section, item, "Equipment required", item.equipment, "checkedEquipment");
  recipe.append(columns);
  appendPersistentChecklist(recipe, section, item, "Cooking instructions", item.steps, "checkedSteps");
  if (item.notes) recipe.append(createDefinition("Adjustment notes", item.notes));
  body.append(side, recipe);
  return body;
}

/**
 * Renders one workout type with its purpose, schedule, and exercise sequence.
 *
 * @param {object} section Parent section.
 * @param {object} item Workout record.
 * @returns {HTMLElement} Workout content.
 */
function createWorkoutBody(section, item) {
  const body = createElement("div", "entry-body workout-reference-card");
  const muscles = item.muscleTags?.length
    ? item.muscleTags
    : String(item.goal ?? "").split(/[·,]/).map((tag) => tag.trim()).filter(Boolean);
  appendTagGroup(body, "Muscle groups", muscles);
  const columns = createElement("div", "workout-reference-columns");
  const information = createElement("section", "workout-reference-information");
  if (item.equipment) information.append(createDefinition("Equipment", item.equipment));
  const tabs = createElement("div", "workout-training-tabs");
  tabs.setAttribute("role", "tablist");
  const panels = createElement("div", "workout-training-panels");
  const modes = [
    ["Hypertrophy", item.hypertrophyPrescription || item.frequency],
    ["Strength", item.strengthPrescription || item.frequency],
    ["Endurance", item.endurancePrescription || item.frequency],
  ];
  modes.forEach(([label, prescription], index) => {
    const key = label.toLocaleLowerCase();
    const button = createElement("button", "workout-training-tab", label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === 0));
    button.dataset.workoutMode = key;
    const panel = createElement("section", "workout-training-panel");
    panel.dataset.workoutPanel = key;
    panel.hidden = index !== 0;
    panel.append(createDefinition("Sets / reps / rest", prescription || "Add a prescription for this training type."));
    if (item.squeeze) panel.append(createDefinition("Where to squeeze", item.squeeze));
    button.addEventListener("click", () => {
      tabs.querySelectorAll("[role=tab]").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === button)));
      panels.querySelectorAll("[data-workout-panel]").forEach((candidate) => { candidate.hidden = candidate !== panel; });
    });
    tabs.append(button);
    panels.append(panel);
  });
  information.append(tabs, panels);
  appendPersistentChecklist(information, section, item, "How to do it", item.exercises, "checkedExercises");
  if (item.progression) information.append(createDefinition("Progression rule", item.progression));

  const visual = createElement("aside", "workout-animation-panel");
  const animationUrl = normalizeEntryUrl(item.animationUrl, { allowImageData: true });
  if (animationUrl && /\.(?:mp4|webm|ogg)(?:$|[?#])/i.test(animationUrl)) {
    const video = document.createElement("video");
    video.controls = true;
    video.loop = true;
    video.muted = true;
    video.preload = "metadata";
    video.src = animationUrl;
    visual.append(video);
  } else if (animationUrl) {
    const image = document.createElement("img");
    image.src = animationUrl;
    image.alt = `How to perform ${item.title}`;
    image.loading = "lazy";
    visual.append(image);
  } else {
    visual.append(createEntryVisual(section, item, false), createElement("p", "", "Add an animation or demonstration URL in Edit entry."));
  }
  columns.append(information, visual);
  body.append(columns);
  const breathing = createElement("footer", "workout-breathing-note");
  breathing.append(
    createElement("strong", "", "Breathing"),
    document.createTextNode(` ${item.breathing || "Inhale during the lowering phase and exhale through the effort."}`),
  );
  body.append(breathing);
  return body;
}

/**
 * Renders a house area with supplies, frequency, and ordered cleaning steps.
 *
 * @param {object} section Parent section.
 * @param {object} item Cleaning record.
 * @returns {HTMLElement} Cleaning content.
 */
function createCleaningBody(section, item) {
  const body = createElement("div", `entry-body cleaning-notecard cleaning-card-${String(item.cardType ?? "Brief").toLocaleLowerCase()}`);
  body.append(createElement("span", "cleaning-card-type", `${item.cardType ?? "Brief"} ${item.category === "self-care" ? "self-care" : "house-cleaning"} card`));
  const details = createElement("div", "cleaning-scope");
  if (item.zone) details.append(createDefinition("Zone", item.zone));
  if (item.frequency) details.append(createDefinition("When to clean it", item.frequency));
  if (details.childElementCount) body.append(details);
  const route = createElement("div", "cleaning-route");
  appendPersistentChecklist(route, section, item, "Supply bench", item.supplies, "checkedSupplies");
  appendPersistentChecklist(route, section, item, "Cleaning route", item.steps, "checkedSteps");
  body.append(route);
  if (item.warnings) body.append(createDefinition("Material and safety limits", item.warnings));
  if (item.notes) body.append(createDefinition("Maintenance notes", item.notes));
  if (item.schedule?.length) body.append(createScheduleTabs(item.schedule));
  appendTagGroup(body, "Tags", normalizeEntryTags(item.tags));
  return body;
}

function createScheduleTabs(scheduleRows) {
  const schedule = createElement("section", "care-schedule");
  schedule.append(createElement("h3", "", "When / how often"));
  const tabs = createElement("div", "care-schedule-tabs");
  const panels = createElement("div", "care-schedule-panels");
  scheduleRows.forEach((row, index) => {
    const { label, explanation } = splitStructuredLine(row, `Timeframe ${index + 1}`);
    const button = createElement("button", "care-schedule-tab", label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(index === 0));
    const panel = createElement("p", "care-schedule-panel", explanation);
    panel.hidden = index !== 0;
    button.addEventListener("click", () => {
      tabs.querySelectorAll("button").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      panels.querySelectorAll(".care-schedule-panel").forEach((candidate) => { candidate.hidden = candidate !== panel; });
    });
    tabs.append(button);
    panels.append(panel);
  });
  schedule.append(tabs, panels);
  return schedule;
}

/**
 * Renders one study as an inquiry dossier rather than a generic note.
 *
 * @param {object} item Study record.
 * @returns {HTMLElement} Study content.
 */
function createStudyBody(section, item) {
  if (item.format === "lesson" && item.lesson) {
    return createKnowledgeEntryLayout(section, item, {
      content: createLessonStudyBody(item),
      label: "Study lesson",
    });
  }
  return createKnowledgeEntryLayout(section, item, { label: section.playground ? "Experimental study" : "Study" });
}

/**
 * Builds the shared study-like reading surface: a sticky, collapsible outline
 * and definition rail beside rich content. Ideas and How to Cook use the same
 * structure without inheriting the epistemic claims of a finished Study.
 */
function createKnowledgeEntryLayout(section, item, options = {}) {
  const layout = createElement("div", "knowledge-entry-layout");
  const sidebar = createElement("aside", "knowledge-entry-sidebar");
  const definitions = parseDefinitionLines(item.definitions);
  const blocks = parseKnowledgeContent(item.content);
  const outline = item.format === "lesson"
    ? (item.lesson?.sections ?? []).map((lessonSection, index) => ({
      id: `lesson-section-${index + 1}`,
      title: lessonSection.heading,
      level: 2,
    }))
    : buildKnowledgeOutline(item.content);

  const outlinePanel = createElement("details", "knowledge-sidebar-panel");
  outlinePanel.open = true;
  outlinePanel.append(createElement("summary", "", "Sections"));
  const outlineNav = createElement("nav", "knowledge-outline");
  outlineNav.setAttribute("aria-label", `${options.label ?? "Entry"} sections`);
  if (outline.length) {
    outline.forEach(({ id, title, level }) => {
      const link = createElement("a", level === 3 ? "is-subsection" : "", title);
      link.href = `#${id}`;
      outlineNav.append(link);
    });
  } else {
    outlineNav.append(createElement("p", "knowledge-sidebar-empty", "Add section blocks to build a jump list."));
  }
  outlinePanel.append(outlineNav);

  const definitionPanel = createElement("details", "knowledge-sidebar-panel");
  definitionPanel.open = true;
  definitionPanel.append(createElement("summary", "", `Definitions (${definitions.length})`));
  const definitionList = createElement("div", "knowledge-definition-list");
  if (definitions.length) {
    definitions.forEach((definition) => {
      const button = createElement("button", "knowledge-definition-button", definition.term);
      button.type = "button";
      button.addEventListener("click", () => openStudyDefinition(definition));
      definitionList.append(button);
    });
  } else {
    definitionList.append(createElement("p", "knowledge-sidebar-empty", "Definitions saved here also appear in the main glossary."));
  }
  definitionPanel.append(definitionList);

  const relationships = createKnowledgeRelationshipPanel(section, item);
  sidebar.append(outlinePanel, definitionPanel);
  if (relationships) sidebar.append(relationships);

  const content = createElement("div", "entry-body knowledge-entry-content");
  if (item.abstract || item.summary) {
    const abstract = createElement("section", "knowledge-abstract");
    abstract.append(createElement("span", "card-kicker", "ABSTRACT SUMMARY"));
    appendDefinitionAwareText(abstract, item.abstract || item.summary, definitions);
    content.append(abstract);
  }
  if (section.type === "idea" || section.type === "question") {
    const state = createElement("div", "question-state");
    state.append(createElement("span", "question-kind", "UNPROVEN IDEA"));
    if (item.stage) state.append(createElement("span", "question-status", item.stage));
    content.append(state);
    if (item.thesis) content.append(createDefinition("Current formulation", item.thesis));
    if (item.reasoning) content.append(createDefinition("Reasoning so far", item.reasoning));
    if (item.assumptions?.length) content.append(createDefinition("Assumptions", item.assumptions.join("\n")));
    if (item.openQuestions?.length) content.append(createDefinition("Open questions", item.openQuestions.join("\n")));
  }
  if (options.content) {
    (item.lesson?.sections ?? []).forEach((lessonSection, index) => {
      const sectionElement = options.content.querySelectorAll(".saved-lesson-section")[index];
      if (sectionElement) sectionElement.id = `lesson-section-${index + 1}`;
    });
    content.append(options.content);
  } else if (blocks.length) {
    blocks.forEach((block) => content.append(createKnowledgeBlock(block, definitions)));
  } else {
    content.append(createElement("p", "knowledge-empty-content", "Use Edit entry to add text, sections, images, diagrams, interactables, videos, or LaTeX equations."));
  }
  appendTagGroup(content, "Tags", item.tags ?? []);
  layout.append(sidebar, content);
  queueMicrotask(() => renderKnowledgeMath(layout));
  return layout;
}

function createKnowledgeRelationshipPanel(section, item) {
  const studies = getWorkspace().sections
    .filter((candidate) => candidate.type === "study")
    .flatMap((candidate) => candidate.items.map((study) => ({ ...study, sectionId: candidate.id })));
  const parent = studies.find((study) => study.id === item.parentStudyId);
  const children = studies.filter((study) => study.parentStudyId === item.id);
  const notecards = parseNotecardLinks(item.notecardLinks);
  const linkedStudies = (item.linkedStudyIds ?? [])
    .map((studyId) => studies.find((study) => study.id === studyId))
    .filter(Boolean);
  if (!parent && !children.length && !notecards.length && !linkedStudies.length && !item.folderPath) return null;
  const panel = createElement("details", "knowledge-sidebar-panel");
  panel.open = true;
  panel.append(createElement("summary", "", "Place & links"));
  const links = createElement("div", "knowledge-relationship-list");
  if (item.folderPath) links.append(createElement("span", "knowledge-folder-path", `▱ ${item.folderPath}`));
  if (parent) links.append(createStudyLink(parent, `Parent · ${parent.title}`));
  children.forEach((child) => links.append(createStudyLink(child, `Child · ${child.title}`)));
  linkedStudies.forEach((study) => links.append(createStudyLink(study, `Study · ${study.title}`)));
  notecards.forEach(({ label, url }) => {
    const link = createElement("a", "", `Notecard · ${label}`);
    link.href = normalizeEntryUrl(url) ?? "educational_resources/index.html";
    links.append(link);
  });
  panel.append(links);
  return panel;
}

function createStudyLink(study, label = study.title) {
  const link = createElement("a", "", label);
  link.href = buildContentHash(study.sectionId, study.id);
  return link;
}

function createKnowledgeBlock(block, definitions) {
  const element = createElement("section", `knowledge-block block-${block.type}`);
  element.id = block.id;
  if (block.type === "section") {
    element.append(createElement("h2", "", block.title || "Section"));
    appendDefinitionAwareText(element, block.body, definitions);
    return element;
  }
  if (block.type === "subsection") {
    element.append(createElement("h3", "", block.title || "Subsection"));
    appendDefinitionAwareText(element, block.body, definitions);
    return element;
  }
  if (block.type === "text") {
    if (block.title) element.append(createElement("h3", "", block.title));
    appendDefinitionAwareText(element, block.body, definitions);
    return element;
  }
  if (block.type === "equation") {
    if (block.title) element.append(createElement("span", "card-kicker", block.title));
    const equation = createElement("div", "knowledge-equation", block.body);
    equation.dataset.latex = block.body;
    element.append(equation);
    return element;
  }
  if (block.type === "diagram") {
    if (block.title) element.append(createElement("h3", "", block.title));
    const diagram = createElement("div", "knowledge-diagram");
    block.body.split("\n").filter(Boolean).forEach((row) => {
      const path = createElement("div", "knowledge-diagram-path");
      row.split(">").map((node) => node.trim()).filter(Boolean).forEach((node, index, nodes) => {
        path.append(createElement("span", "knowledge-diagram-node", node));
        if (index < nodes.length - 1) path.append(createElement("i", "knowledge-diagram-arrow", "→"));
      });
      diagram.append(path);
    });
    element.append(diagram);
    return element;
  }
  if (block.type === "image") {
    const url = normalizeEntryUrl(block.body, { allowImageData: true });
    if (url) {
      const figure = createElement("figure", "knowledge-media");
      const image = document.createElement("img");
      image.src = url;
      image.alt = block.title || "Study image";
      image.loading = "lazy";
      figure.append(image);
      if (block.title) figure.append(createElement("figcaption", "", block.title));
      element.append(figure);
    }
    return element;
  }
  if (["video", "interactable"].includes(block.type)) {
    const url = normalizeEntryUrl(block.body);
    if (block.title) element.append(createElement("h3", "", block.title));
    if (!url) return element;
    if (block.type === "video" && /\.(?:mp4|webm|ogg)(?:$|[?#])/i.test(url)) {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.src = url;
      element.append(video);
    } else {
      const frame = document.createElement("iframe");
      frame.src = url;
      frame.title = block.title || (block.type === "video" ? "Study video" : "Study interactable");
      frame.loading = "lazy";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation");
      element.append(frame);
    }
    const open = createElement("a", "knowledge-media-open", "Open separately ↗");
    open.href = url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    element.append(open);
  }
  return element;
}

function appendDefinitionAwareText(parent, value, definitions) {
  String(value ?? "").split(/\n{2,}/).filter(Boolean).forEach((paragraphText) => {
    const paragraph = createElement("p");
    const terms = definitions.map(({ term }) => term).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!terms.length) {
      paragraph.textContent = paragraphText;
      parent.append(paragraph);
      return;
    }
    const lookup = new Map(definitions.map((definition) => [definition.term.toLocaleLowerCase(), definition]));
    const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(\\[\\[(?:${escaped.join("|")})\\]\\]|\\b(?:${escaped.join("|")})\\b)`, "giu");
    let offset = 0;
    for (const match of paragraphText.matchAll(pattern)) {
      paragraph.append(document.createTextNode(paragraphText.slice(offset, match.index)));
      const raw = match[0].replace(/^\[\[|\]\]$/g, "");
      const definition = lookup.get(raw.toLocaleLowerCase());
      const button = createElement("button", "defined-term", raw);
      button.type = "button";
      button.addEventListener("click", () => openStudyDefinition(definition));
      paragraph.append(button);
      offset = match.index + match[0].length;
    }
    paragraph.append(document.createTextNode(paragraphText.slice(offset)));
    parent.append(paragraph);
  });
}

function openStudyDefinition(definition) {
  if (!definition) return;
  let dialog = document.querySelector("#study-definition-dialog");
  if (!dialog) {
    dialog = createElement("dialog", "app-dialog definition-dialog");
    dialog.id = "study-definition-dialog";
    const shell = createElement("div", "definition-dialog-shell");
    const close = createElement("button", "icon-button", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close definition");
    close.addEventListener("click", () => dialog.close());
    shell.append(close, createElement("p", "eyebrow", "DEFINITION"), createElement("h2"), createElement("p", "definition-dialog-copy"), createElement("div", "definition-dialog-actions"));
    dialog.append(shell);
    document.body.append(dialog);
  }
  dialog.querySelector("h2").textContent = definition.term;
  dialog.querySelector(".definition-dialog-copy").textContent = definition.definition || "No definition has been written yet.";
  const actions = dialog.querySelector(".definition-dialog-actions");
  actions.replaceChildren();
  const linked = findStudyRecord(definition.linkedStudyId);
  if (linked) actions.append(createStudyLink(linked, "Open the full study →"));
  dialog.showModal();
}

function findStudyRecord(studyId) {
  if (!studyId) return null;
  for (const section of getWorkspace().sections.filter((candidate) => candidate.type === "study")) {
    const study = section.items.find((candidate) => candidate.id === studyId);
    if (study) return { ...study, sectionId: section.id };
  }
  return null;
}

function normalizeEntryUrl(value, options = {}) {
  const source = String(value ?? "").trim();
  if (!source) return null;
  if (options.allowImageData && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(source)) return source;
  try {
    const url = new URL(source, document.baseURI);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

let knowledgeKatexModule = null;
async function renderKnowledgeMath(root) {
  const nodes = [...root.querySelectorAll("[data-latex]")];
  if (!nodes.length) return;
  try {
    if (!document.querySelector("link[data-knowledge-katex]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
      link.dataset.knowledgeKatex = "true";
      document.head.append(link);
    }
    knowledgeKatexModule ??= await import("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.mjs");
    nodes.forEach((node) => knowledgeKatexModule.render(node.dataset.latex, node, {
      displayMode: true,
      throwOnError: false,
      strict: "warn",
      trust: false,
    }));
  } catch {
    // LaTeX source remains visible when the optional renderer is unavailable.
  }
}

/**
 * Renders a source-grounded lesson without changing inquiry-style Study entries.
 *
 * @param {object} item Lesson-format Study record.
 * @returns {HTMLElement} Structured lesson content.
 */
function createLessonStudyBody(item) {
  const lesson = item.lesson ?? {};
  const body = createElement("div", "entry-body saved-lesson");
  const titlePage = createElement("header", "saved-lesson-title-page");
  titlePage.append(
    createElement("span", "card-kicker", [lesson.chapter, lesson.subchapter].filter(Boolean).join(" · ") || "SAVED LESSON"),
    createElement("h2", "", lesson.title || item.title),
  );
  if (lesson.subtitle) titlePage.append(createElement("p", "", lesson.subtitle));
  if (lesson.sourceTitle) titlePage.append(createElement("small", "", `Source · ${lesson.sourceTitle}`));
  body.append(titlePage);
  if (lesson.overview) body.append(createDefinition("Overview", lesson.overview));
  appendLessonList(body, "Learning objectives", lesson.learningObjectives);
  appendLessonList(body, "Prerequisites", lesson.prerequisites);
  if (lesson.keyConcepts?.length) {
    const concepts = createElement("section", "saved-lesson-grid");
    concepts.append(createElement("h3", "", "Key concepts"));
    const grid = createElement("div");
    lesson.keyConcepts.forEach(({ term, explanation }) => {
      const concept = createElement("article");
      concept.append(createElement("strong", "", term), createElement("p", "", explanation));
      grid.append(concept);
    });
    concepts.append(grid);
    body.append(concepts);
  }
  (lesson.sections ?? []).forEach((section) => {
    const lessonSection = createElement("section", "saved-lesson-section");
    lessonSection.append(createElement("h3", "", section.heading), createElement("p", "", section.content));
    appendSourcePages(lessonSection, section.citations?.map(({ page }) => page));
    body.append(lessonSection);
  });
  appendLessonList(body, "Worked examples", lesson.workedExamples);
  appendLessonList(body, "Common misconceptions", lesson.commonMisconceptions);
  appendLessonList(body, "Review questions", lesson.reviewQuestions);
  if (lesson.flashcards?.length) {
    const flashcards = createElement("section", "saved-lesson-grid");
    flashcards.append(createElement("h3", "", "Flashcards"));
    const grid = createElement("div");
    lesson.flashcards.forEach(({ question, answer }) => {
      const card = createElement("article");
      card.append(createElement("strong", "", question), createElement("p", "", answer));
      grid.append(card);
    });
    flashcards.append(grid);
    body.append(flashcards);
  }
  if (lesson.recap) body.append(createDefinition("Recap", lesson.recap));
  appendSourcePages(body, lesson.sourcePages ?? item.sourcePages);
  appendTagGroup(body, "Tags", item.tags);
  return body;
}

function appendLessonList(parent, label, values = []) {
  if (!values?.length) return;
  const section = createElement("section", "saved-lesson-list");
  section.append(createElement("h3", "", label));
  const list = document.createElement("ul");
  values.forEach((value) => list.append(createElement("li", "", value)));
  section.append(list);
  parent.append(section);
}

function appendSourcePages(parent, pages = []) {
  const uniquePages = [...new Set((pages ?? []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!uniquePages.length) return;
  const group = createElement("div", "saved-lesson-pages");
  group.append(createElement("span", "", "Source pages"));
  uniquePages.forEach((page) => group.append(createElement("strong", "", String(page))));
  parent.append(group);
}

/**
 * Adds a labeled checklist whose completion state is saved with its entry.
 *
 * @param {HTMLElement} parent Destination body.
 * @param {object} section Parent section.
 * @param {object} item Parent entry.
 * @param {string} labelText Visible list label.
 * @param {Array<string>} values Checklist values.
 * @param {string} checkedProperty Item property containing checked indexes.
 */
function appendPersistentChecklist(parent, section, item, labelText, values = [], checkedProperty) {
  if (!values?.length) return;
  const group = createElement("section", "life-list-group");
  group.append(createElement("h3", "", labelText));
  const checkedIndexes = new Set(item[checkedProperty] ?? []);
  const checklist = createElement("ol", "life-checklist");
  values.forEach((value, index) => {
    const row = createElement("li");
    const label = createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checkedIndexes.has(index);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? checkedIndexes.add(index) : checkedIndexes.delete(index);
      updateItem(section.id, item.id, { [checkedProperty]: [...checkedIndexes] });
    });
    label.append(checkbox, createElement("span", "", value));
    row.append(label);
    checklist.append(row);
  });
  group.append(checklist);
  parent.append(group);
}

/**
 * Renders one language as a field guide with facts, a core-function mindmap,
 * a syntax reference, and explained lessons.
 *
 * @param {object} item Language record.
 * @returns {HTMLElement} Language content.
 */
function createLanguageBody(item) {
  const body = createElement("div", "entry-body language-field-guide");
  if (item.quickFacts?.length) {
    body.append(createStructuredCardSection("Quick Facts", item.quickFacts, "language-quick-facts"));
  }
  if (item.coreConcepts?.length) {
    const mindmap = createElement("section", "language-mindmap");
    mindmap.append(createElement("h3", "", "Mindmap of core functionality"));
    const map = createElement("div", "language-mindmap-canvas");
    map.append(createElement("strong", "language-mindmap-core", item.title.replace(/\s+refresher$/i, "")));
    item.coreConcepts.forEach((value, index) => {
      const { label, explanation } = splitStructuredLine(value, `Concept ${index + 1}`);
      const node = createElement("article", "language-mindmap-node");
      node.append(createElement("strong", "", label), createElement("p", "", explanation));
      map.append(node);
    });
    mindmap.append(map);
    body.append(mindmap);
  }
  const syntaxReference = item.syntaxReference ?? item.syntax;
  if (syntaxReference) body.append(createCodeDefinition("Reference sheet · syntax", syntaxReference));
  if (item.lessons?.length) {
    body.append(createStructuredCardSection(
      "Specific Lessons + Explanations",
      item.lessons,
      "language-lessons",
    ));
  }
  return body;
}

/**
 * Renders an algorithm or analysis lesson in the requested progression from
 * purpose and explanation to visualization, pseudocode, and real code.
 *
 * @param {object} item Algorithm record.
 * @returns {HTMLElement} Algorithm content.
 */
function createAlgorithmBody(item) {
  const isAnalysisLesson = item.category === "analysis";
  const body = createElement(
    "div",
    `entry-body algorithm-reference${isAnalysisLesson ? " algorithm-analysis-lesson" : ""}`,
  );
  const details = createElement("div", "two-column-details");
  const purpose = item.purpose ?? item.useCases;
  if (purpose) details.append(createDefinition("Purpose", purpose));
  if (item.complexity) details.append(createDefinition("Time / space", item.complexity));
  if (details.childElementCount) body.append(details);
  if (item.explanation) body.append(createDefinition("How it works", item.explanation));
  if (item.invariant) body.append(createDefinition("Correctness anchor", item.invariant));
  if (item.keyIdeas?.length) {
    body.append(createStructuredCardSection("Key ideas", item.keyIdeas, "algorithm-key-ideas"));
  }
  if (item.workedExample) body.append(createDefinition("Worked example", item.workedExample));

  const frames = item.visualFrames ?? [];
  if (frames.length) {
    body.append(createAlgorithmAnimation(
      frames,
      item.frameExplanations,
      isAnalysisLesson ? "ANALYSIS WALKTHROUGH" : "DIAGRAM + STEP EXPLANATIONS",
    ));
  }
  if (item.pseudocode) body.append(createCodeDefinition("Pseudocode in English", item.pseudocode));
  if (item.cCode || item.javaCode) {
    const implementations = createElement("section", "algorithm-code-grid");
    implementations.append(createElement("h3", "", "Real code"));
    if (item.cCode) implementations.append(createCodeDefinition("C", item.cCode));
    if (item.javaCode) implementations.append(createCodeDefinition("Java", item.javaCode));
    body.append(implementations);
  }
  appendTagGroup(body, "Tags", normalizeEntryTags(item.tags));
  return body;
}

/**
 * Creates manual and automatic playback for a sequence of diagram frames.
 *
 * @param {Array<string>} frames Diagram frames written as “a > b > c”.
 * @param {Array<string>} explanations Optional explanation for each frame.
 * @param {string} label Toolbar label.
 * @returns {HTMLElement} Playback controls, stage, and step explanation.
 */
function createAlgorithmAnimation(frames, explanations = [], label = "VISUAL WALKTHROUGH") {
  const animation = createElement("section", "algorithm-animation");
  const toolbar = createElement("div", "animation-toolbar");
  toolbar.append(createElement("span", "card-kicker", label));
  const controls = createElement("div", "animation-controls");
  const previousButton = createElement("button", "button button-small", "← Previous");
  const playButton = createElement("button", "button button-small", "Play");
  const nextButton = createElement("button", "button button-small", "Next →");
  [previousButton, playButton, nextButton].forEach((button) => {
    button.type = "button";
    controls.append(button);
  });
  toolbar.append(controls);
  const stage = createElement("div", "algorithm-stage");
  const caption = createElement("div", "animation-caption");
  let frameIndex = 0;
  let timer = null;

  const stopPlayback = () => {
    if (!timer) return;
    window.clearInterval(timer);
    animationTimers.delete(timer);
    timer = null;
    playButton.textContent = "Play";
  };
  const showFrame = () => {
    stage.replaceChildren();
    const tokens = frames[frameIndex].split(">").map((token) => token.trim()).filter(Boolean);
    tokens.forEach((token, index) => {
      stage.append(createElement("span", `algorithm-node ${index === tokens.length - 1 ? "is-active" : ""}`, token));
      if (index < tokens.length - 1) {
        stage.append(createElement("i", "", "→"));
      }
    });
    const fallbackExplanation = tokens.length
      ? `${tokens.slice(0, -1).join(", then ")} leads to ${tokens.at(-1)}.`
      : "Observe how the state changes during this step.";
    caption.replaceChildren(
      createElement("strong", "", `Step ${frameIndex + 1} of ${frames.length}`),
      createElement("span", "", explanations[frameIndex] || fallbackExplanation),
    );
  };
  const moveFrame = (delta) => {
    stopPlayback();
    frameIndex = (frameIndex + delta + frames.length) % frames.length;
    showFrame();
  };

  previousButton.addEventListener("click", () => moveFrame(-1));
  nextButton.addEventListener("click", () => moveFrame(1));
  playButton.addEventListener("click", () => {
    if (timer) {
      stopPlayback();
      return;
    }
    playButton.textContent = "Pause";
    timer = window.setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      showFrame();
    }, 1800);
    animationTimers.add(timer);
  });
  showFrame();
  animation.append(toolbar, stage, caption);
  return animation;
}

/**
 * Renders a project as an idea-to-implementation system map.
 *
 * @param {object} item Project record.
 * @returns {HTMLElement} Project content.
 */
function createProjectBody(section, item) {
  const layout = createElement("div", "project-system-layout");
  const mapPanel = createElement("aside", "project-map-panel");
  mapPanel.append(
    createElement("span", "card-kicker", "ALWAYS-VISIBLE PROJECT MAP"),
    createElement("h3", "", "Overview → parts → studies"),
  );
  const mapTree = buildProjectMapTree(item.projectMap);
  if (mapTree.length) mapPanel.append(createProjectMapList(mapTree));
  else mapPanel.append(createElement("p", "knowledge-sidebar-empty", "Edit the project to add its system map."));

  const body = createElement("div", "entry-body project-blueprint");
  if (item.status) {
    body.append(createElement("span", `project-status status-${item.status.toLowerCase().replaceAll(" ", "-")}`, item.status));
  }
  const mainIdea = item.mainIdea ?? item.problem;
  if (mainIdea) body.append(createDefinition("Main Idea", mainIdea));
  if (item.overview) body.append(createDefinition("Broad overview", item.overview));
  if (item.visualFrames?.length) {
    body.append(createAlgorithmAnimation(
      item.visualFrames,
      item.frameExplanations,
      "PROJECT OVERVIEW · DIAGRAM + EXPLANATIONS",
    ));
  }
  if (item.architecture) body.append(createDefinition("Architecture Overview", item.architecture));
  if (item.codeMap?.length) {
    body.append(createStructuredCardSection("Code map / functions", item.codeMap, "project-code-map"));
  }
  const specifics = item.specifics ?? item.solution;
  if (specifics) body.append(createDefinition("Specifics · how it works", specifics));
  appendAlgorithmLinks(body, item.algorithmIds);
  appendTagGroup(body, "Languages", item.languages);
  appendTagGroup(body, "Dependencies / packages / services", item.dependencies);
  if (item.outcome) body.append(createDefinition("Current outcome", item.outcome));
  if (item.nextStep) body.append(createDefinition("Next meaningful move", item.nextStep));
  const linkedStudies = (item.studyIds ?? []).map(findStudyRecord).filter(Boolean);
  const mappedStudyIds = new Set(flattenProjectNodes(mapTree).map(({ studyId }) => studyId).filter(Boolean));
  if (mapTree.length || linkedStudies.length) {
    const parts = createElement("section", "project-parts-directory");
    parts.append(createElement("h2", "", "Project parts directory"));
    appendProjectPartCards(parts, mapTree);
    linkedStudies.filter(({ id }) => !mappedStudyIds.has(id)).forEach((study) => {
      const card = createElement("article", "project-part-card");
      card.append(createElement("span", "card-kicker", "LINKED STUDY"), createElement("h3", "", study.title));
      if (study.summary) card.append(createElement("p", "", study.summary));
      card.append(createStudyLink(study, "Open study →"));
      parts.append(card);
    });
    body.append(parts);
  }
  layout.append(mapPanel, body);
  return layout;
}

function createProjectMapList(nodes) {
  const list = createElement("ol", "project-map-tree");
  nodes.forEach((node) => {
    const row = createElement("li");
    const study = findStudyRecord(node.studyId);
    if (study) {
      row.append(createStudyLink(study, node.label));
    } else {
      const link = createElement("a", "", node.label);
      link.href = `#project-part-${node.id}`;
      row.append(link);
    }
    if (node.note) row.append(createElement("small", "", node.note));
    if (node.children.length) row.append(createProjectMapList(node.children));
    list.append(row);
  });
  return list;
}

function appendProjectPartCards(parent, nodes, depth = 0) {
  nodes.forEach((node) => {
    const card = createElement("article", "project-part-card");
    card.id = `project-part-${node.id}`;
    card.style.setProperty("--project-depth", String(depth));
    card.append(
      createElement("span", "card-kicker", depth ? `PART · LEVEL ${depth + 1}` : "BIG PICTURE"),
      createElement("h3", "", node.label),
    );
    if (node.note) card.append(createElement("p", "", node.note));
    const study = findStudyRecord(node.studyId);
    if (study) card.append(createStudyLink(study, `Open study · ${study.title} →`));
    parent.append(card);
    appendProjectPartCards(parent, node.children, depth + 1);
  });
}

function flattenProjectNodes(nodes) {
  return nodes.flatMap((node) => [node, ...flattenProjectNodes(node.children)]);
}

/**
 * Renders one open question or emerging idea with its current direction.
 *
 * @param {object} item Question-or-idea record.
 * @returns {HTMLElement} Question or idea content.
 */
function createIdeaBody(section, item) {
  return createKnowledgeEntryLayout(section, item, { label: "Idea" });
}

/**
 * Renders a custom section entry.
 *
 * @param {object} item Generic record.
 * @returns {HTMLElement} Generic content.
 */
function createGenericBody(item) {
  const body = createElement("div", "entry-body");
  if (item.notes) body.append(createDefinition("Notes", item.notes));
  appendTagGroup(body, "Tags", item.tags);
  return body;
}

/**
 * Creates a labeled text definition.
 *
 * @param {string} label Definition label.
 * @param {string} value Definition value.
 * @returns {HTMLElement} Definition element.
 */
function createDefinition(label, value) {
  const definition = createElement("div", "entry-definition");
  definition.append(createElement("span", "", label), createElement("p", "", value));
  return definition;
}

/**
 * Creates a labeled preformatted refresher block.
 *
 * @param {string} label Definition label.
 * @param {string} value Code-like content.
 * @returns {HTMLElement} Definition element.
 */
function createCodeDefinition(label, value) {
  const definition = createElement("div", "entry-definition entry-code-definition");
  definition.append(createElement("span", "", label), createElement("pre", "", value));
  return definition;
}

/**
 * Splits an editable “label | explanation” line at its first separator.
 *
 * @param {string} value Editable structured line.
 * @param {string} fallbackLabel Label used when no separator exists.
 * @returns {{label: string, explanation: string}} Card content.
 */
function splitStructuredLine(value, fallbackLabel) {
  const separatorIndex = String(value).indexOf("|");
  if (separatorIndex < 0) {
    return { label: fallbackLabel, explanation: String(value).trim() };
  }
  return {
    label: String(value).slice(0, separatorIndex).trim() || fallbackLabel,
    explanation: String(value).slice(separatorIndex + 1).trim(),
  };
}

/**
 * Builds a reusable set of labeled explanation cards.
 *
 * @param {string} title Section heading.
 * @param {Array<string>} values “label | explanation” lines.
 * @param {string} className Subject-specific class.
 * @returns {HTMLElement} Structured card section.
 */
function createStructuredCardSection(title, values, className) {
  const section = createElement("section", `structured-card-section ${className}`);
  section.append(createElement("h3", "", title));
  const grid = createElement("div", "structured-card-grid");
  values.forEach((value, index) => {
    const fallbackLabel = className === "algorithm-key-ideas"
      ? `Idea ${index + 1}`
      : `${title} ${index + 1}`;
    const { label, explanation } = splitStructuredLine(value, fallbackLabel);
    const card = createElement("article", "structured-card");
    card.append(createElement("strong", "", label), createElement("p", "", explanation));
    grid.append(card);
  });
  section.append(grid);
  return section;
}

/**
 * Appends a set of compact tags when values exist.
 *
 * @param {HTMLElement} parent Destination element.
 * @param {string} label Group label.
 * @param {Array<string>} values Tag values.
 */
function appendTagGroup(parent, label, values = []) {
  if (!values.length) return;
  const group = createElement("div", "tag-group");
  group.append(createElement("span", "tag-label", label));
  values.forEach((value) => group.append(createElement("span", "tag", value)));
  parent.append(group);
}

/**
 * Adds deep links from a project to its current Algorithm records.
 *
 * @param {HTMLElement} parent Destination body.
 * @param {Array<string>} algorithmIds Stored algorithm identifiers.
 */
function appendAlgorithmLinks(parent, algorithmIds = []) {
  const algorithms = getWorkspace().sections
    .filter((section) => section.type === "algorithm")
    .flatMap((section) => section.items)
    .filter((algorithm) => algorithm.category !== "analysis");
  const relatedAlgorithms = algorithmIds
    .map((algorithmId) => algorithms.find((algorithm) => algorithm.id === algorithmId))
    .filter(Boolean);
  if (!relatedAlgorithms.length) return;

  const group = createElement("div", "tag-group algorithm-link-group");
  group.append(createElement("span", "tag-label", "Algorithms · how it works"));
  relatedAlgorithms.forEach((algorithm) => {
    const link = createElement("a", "tag algorithm-link", algorithm.title);
    link.href = buildAlgorithmHash(algorithm.category ?? "personal", algorithm.id);
    group.append(link);
  });
  parent.append(group);
}

/**
 * Opens a type-aware entry editor for creation or update.
 *
 * @param {object} section Parent section.
 * @param {object|null} item Existing item when editing.
 */
function openItemDialog(section, item = null) {
  activeSectionId = section.id;
  editingItemId = item?.id ?? null;
  itemForm.reset();
  document.querySelector("#item-dialog-eyebrow").textContent = item ? "EDIT ENTRY" : `NEW ${SECTION_LABELS[section.type]}`;
  document.querySelector("#item-dialog-title").textContent = `${item ? "Edit" : "Add"} ${getSingularLabel(section)}`;
  const fields = document.querySelector("#item-form-fields");
  fields.replaceChildren(...createItemFields(section, item));
  itemDialog.showModal();
  window.setTimeout(() => fields.querySelector("input, textarea, select")?.focus(), 0);
}

/**
 * Builds the section-specific form controls.
 *
 * @param {object} section Parent section.
 * @param {object|null} item Existing item.
 * @returns {Array<HTMLElement>} Form controls.
 */
function createItemFields(section, item) {
  const fields = [
    createField("Title", "title", "text", item?.title ?? "", true, "Give this entry a clear name"),
    createField("One-line summary", "summary", "textarea", item?.summary ?? "", false, "Why is this worth remembering?"),
  ];

  if (section.type === "cooking-guide") {
    fields.push(
      createField("Abstract summary", "abstract", "textarea", item?.abstract ?? item?.summary ?? "", false, "Orient the reader to the cooking method"),
      createRichContentField(item?.content ?? ""),
      createField("Definitions · term | definition | linked study ID", "definitions", "textarea", item?.definitions ?? "", false, "Browning | Flavor-producing reactions caused by heat | study-id"),
      createField("Heat plan", "heat", "text", item?.heat ?? "", false, "How should the heat change through the method?"),
      createField("Sensory signals", "signals", "textarea", item?.signals ?? "", false, "What should you see, hear, smell, or feel?"),
      createField("What to understand", "principles", "textarea", item?.principles ?? "", false, "The principles behind this method"),
      createField("Tools and essentials", "essentials", "textarea", item?.essentials ?? "", false, "Equipment, ingredients, heat, or setup"),
      createField("Method · one step per line", "steps", "textarea", (item?.steps ?? []).join("\n"), false, "Write the method in the order you use it"),
      createField("Common mistakes", "mistakes", "textarea", item?.mistakes ?? "", false, "What usually goes wrong and how to notice it"),
      createField("Tags · comma separated", "tags", "text", (item?.tags ?? []).join(", "), false, "Optional cooking labels"),
    );
  } else if (section.type === "recipe") {
    fields.push(
      createField("Picture URL or image data URL", "imageUrl", "text", item?.imageUrl ?? "", false, "https://…/recipe.jpg"),
      createField("Calories", "calories", "text", item?.calories ?? "", false, "e.g. 620 kcal per serving"),
      createField("Protein", "protein", "text", item?.protein ?? "", false, "e.g. 35 g"),
      createField("Carbohydrates", "carbs", "text", item?.carbs ?? "", false, "e.g. 72 g"),
      createField("Fat", "fat", "text", item?.fat ?? "", false, "e.g. 18 g"),
      createField("Servings", "servings", "text", item?.servings ?? "", false, "e.g. 4 servings"),
      createField("Prep and cook time", "timing", "text", item?.timing ?? "", false, "e.g. 15 min prep · 35 min cook"),
      createField("Ingredients · one per line", "ingredients", "textarea", (item?.ingredients ?? []).join("\n"), false, "Include useful amounts"),
      createField("Method · one step per line", "steps", "textarea", (item?.steps ?? []).join("\n"), false, "Write the cooking order"),
      createField("Equipment required · one per line", "equipment", "textarea", (item?.equipment ?? []).join("\n"), false, "Pan, thermometer, blender…"),
      createField("Notes and adjustments", "notes", "textarea", item?.notes ?? "", false, "Substitutions, storage, or changes for next time"),
    );
  } else if (section.type === "workout") {
    fields.push(
      createSelectField(
        "Training category",
        "category",
        item?.category ?? section.workoutCategory ?? "push",
        ["push", "pull", "legs"],
      ),
      createField("Muscle group tags · comma separated", "muscleTags", "text", (item?.muscleTags ?? []).join(", "), false, "Chest, triceps, front delts"),
      createField("Animation or demonstration URL", "animationUrl", "text", item?.animationUrl ?? "", false, "Image, GIF, or video URL"),
      createField("Hypertrophy · sets / reps / rest", "hypertrophyPrescription", "text", item?.hypertrophyPrescription ?? item?.frequency ?? "", false, "3–4 sets · 8–12 reps · 90 sec rest"),
      createField("Strength · sets / reps / rest", "strengthPrescription", "text", item?.strengthPrescription ?? item?.frequency ?? "", false, "3–5 sets · 3–6 reps · 3 min rest"),
      createField("Endurance · sets / reps / rest", "endurancePrescription", "text", item?.endurancePrescription ?? item?.frequency ?? "", false, "2–4 sets · 15–25 reps · 45 sec rest"),
      createField("Primary muscles", "goal", "textarea", item?.goal ?? "", false, "The muscles this movement mainly trains"),
      createField("Working sets and reps", "frequency", "text", item?.frequency ?? "", false, "e.g. 3–4 working sets · 6–12 reps"),
      createField("Rest", "duration", "text", item?.duration ?? "", false, "e.g. Rest 90–150 seconds"),
      createField("Equipment", "equipment", "text", item?.equipment ?? "", false, "What must be available"),
      createField("Execution · one cue per line", "exercises", "textarea", (item?.exercises ?? []).join("\n"), false, "List the setup and movement cues in order"),
      createField("Breathing · one sentence", "breathing", "textarea", item?.breathing ?? "", false, "Where to inhale and exhale during the movement"),
      createField("Where to squeeze", "squeeze", "textarea", item?.squeeze ?? "", false, "The contraction cue for the target muscles"),
      createField("Progression rule", "progression", "textarea", item?.progression ?? "", false, "Exactly when and how should the workload change?"),
      createField("Coaching notes", "notes", "textarea", item?.notes ?? "", false, "Important form, comfort, or safety notes"),
    );
  } else if (section.type === "cleaning") {
    fields.push(
      createSelectField(
        "Cleaning subsection",
        "category",
        item?.category ?? section.cleaningCategory ?? "house",
        ["house", "self-care"],
      ),
      createSelectField("Card type", "cardType", item?.cardType ?? "Brief", ["Brief", "Master", "Extended"]),
      createField("Area or items included", "zone", "text", item?.zone ?? "", false, "What does this routine cover?"),
      createField("Frequency", "frequency", "text", item?.frequency ?? "", false, "Daily, weekly, monthly, or as needed"),
      createField("Supplies · one per line", "supplies", "textarea", (item?.supplies ?? []).join("\n"), false, "Only what this routine needs"),
      createField("Cleaning order · one step per line", "steps", "textarea", (item?.steps ?? []).join("\n"), false, "Work from the first action to the last"),
      createField("Material and safety limits", "warnings", "textarea", item?.warnings ?? "", false, "Chemical combinations, delicate materials, or ventilation"),
      createField("Notes", "notes", "textarea", item?.notes ?? "", false, "Warnings, material care, or shortcuts"),
      createField("Schedule · timeframe | what to do", "schedule", "textarea", (item?.schedule ?? []).join("\n"), false, "Every day | Reset…\nEvery week | Deep clean…"),
      createField("Filter tags · comma separated", "tags", "text", (item?.tags ?? []).join(", "), false, "e.g. weekly, kitchen, dust"),
    );
  } else if (section.type === "routine") {
    fields.push(
      createField("Trigger", "trigger", "textarea", item?.trigger ?? "", false, "When should you use this routine?"),
      createField("Steps · one per line", "steps", "textarea", (item?.steps ?? []).join("\n"), false, "Write only the steps you actually need"),
    );
  } else if (section.type === "howto") {
    fields.push(
      createField("Folder path", "folderPath", "text", item?.folderPath ?? "", false, "Appointments / VA or Car / Battery"),
      createField("Why this is saved", "purpose", "textarea", item?.purpose ?? "", false, "What should this card save you from having to remember or research again?"),
      createField("Before you start · one item per line", "checklist", "textarea", (item?.checklist ?? []).join("\n"), false, "Contacts, equipment, documents, or prerequisites"),
      createField("How to do it · one step per line", "steps", "textarea", (item?.steps ?? []).join("\n"), false, "Write the verified sequence in order"),
      createField("Warnings and limits", "warnings", "textarea", item?.warnings ?? "", false, "When to stop, get help, or use a different procedure"),
      createField("Personal notes", "notes", "textarea", item?.notes ?? "", false, "Exact numbers, contacts, links, or details that apply to you"),
      createField("Tags · comma separated", "tags", "text", (item?.tags ?? []).join(", "), false, "appointments, car, home, administration"),
    );
  } else if (section.type === "study") {
    fields.push(
      createField("Abstract summary", "abstract", "textarea", item?.abstract ?? item?.summary ?? "", false, "A concise orientation to the study"),
      createField("Folder path", "folderPath", "text", item?.folderPath ?? "", false, "Information Theory / Foundations"),
      createStudyParentSelect(item?.parentStudyId ?? "", item?.id),
      createRichContentField(item?.content ?? ""),
      createField("Definitions · term | definition | linked study ID", "definitions", "textarea", item?.definitions ?? "", false, "Entropy | Expected information in a distribution | linked-study-id"),
      createField("Linked notecards · label | URL", "notecardLinks", "textarea", item?.notecardLinks ?? "", false, "Entropy review | educational_resources/mathematics/flashcard-practice.html"),
    );
    if (item?.format === "lesson" && item.lesson) {
      fields.push(...createLessonStudyFields(item));
    } else {
      fields.push(
        createField("Research question", "researchQuestion", "textarea", item?.researchQuestion ?? "", false, "Specific enough that evidence could answer it"),
        createField("Prediction or hypothesis", "hypothesis", "textarea", item?.hypothesis ?? "", false, "What do you expect, and why?"),
        createField("Method", "method", "textarea", item?.method ?? "", false, "How will the question be investigated?"),
        createField("Evidence to collect · one per line", "evidence", "textarea", (item?.evidence ?? []).join("\n"), false, "Measurements, observations, sources, or comparison points"),
        createField("Findings", "findings", "textarea", item?.findings ?? "", false, "What does the evidence presently support?"),
        createField("Limitations", "limitations", "textarea", item?.limitations ?? "", false, "What weakens, narrows, or complicates the conclusion?"),
        createField("Next test", "nextSteps", "textarea", item?.nextSteps ?? "", false, "The smallest useful follow-up"),
        createField("Supporting notes", "notes", "textarea", item?.notes ?? "", false, "Context that does not belong in the evidence or conclusion"),
        createField("Tags · comma separated", "tags", "text", (item?.tags ?? []).join(", "), false, "Optional subject labels"),
      );
    }
  } else if (section.type === "idea" || section.type === "question") {
    fields.push(
      createSelectField("Idea stage", "stage", item?.stage ?? "Working", ["Working", "Formed", "Parked"]),
      createField("Abstract summary", "abstract", "textarea", item?.abstract ?? item?.summary ?? "", false, "What this unproven idea is about"),
      createField("Folder path", "folderPath", "text", item?.folderPath ?? "", false, "Economics / Systems"),
      createField("Current formulation", "thesis", "textarea", item?.thesis ?? item?.currentPosition ?? "", false, "What you presently think, without claiming proof"),
      createField("Reasoning so far", "reasoning", "textarea", item?.reasoning ?? item?.context ?? "", false, "Why the idea currently seems plausible"),
      createField("Assumptions · one per line", "assumptions", "textarea", (item?.assumptions ?? []).join("\n"), false, "Assumptions the idea depends on"),
      createField("Open questions · one per line", "openQuestions", "textarea", (item?.openQuestions ?? item?.directions ?? []).join("\n"), false, "Unknowns and ways the idea might fail"),
      createRichContentField(item?.content ?? ""),
      createField("Definitions · term | definition | linked study ID", "definitions", "textarea", item?.definitions ?? "", false, "Term | provisional definition | linked-study-id"),
      createStudyPicker("Studies or experiments linked to this idea", "linkedStudyIds", item?.linkedStudyIds ?? []),
    );
  } else if (section.type === "language") {
    fields.push(
      createField("Quick Facts · one per line", "quickFacts", "textarea", (item?.quickFacts ?? []).join("\n"), false, "Use: Label | explanation"),
      createField("Core functionality mindmap · one branch per line", "coreConcepts", "textarea", (item?.coreConcepts ?? []).join("\n"), false, "Use: Concept | what it controls"),
      createField("Reference sheet · syntax", "syntaxReference", "textarea", item?.syntaxReference ?? item?.syntax ?? "", false, "Runnable syntax worth keeping close"),
      createField("Specific lessons + explanations · one per line", "lessons", "textarea", (item?.lessons ?? []).join("\n"), false, "Use: Lesson | explanation"),
    );
  } else if (section.type === "algorithm") {
    fields.push(
      createSelectField(
        "Algorithm subsection",
        "category",
        item?.category ?? section.algorithmCategory ?? "personal",
        ["personal", "traditional", "advanced", "analysis"],
      ),
      createField("Purpose", "purpose", "textarea", item?.purpose ?? item?.useCases ?? "", false, "What problem does this solve, and when should you use it?"),
      createField("How it works", "explanation", "textarea", item?.explanation ?? "", false, "Explain it in your own words"),
      createField("Correctness anchor / invariant", "invariant", "textarea", item?.invariant ?? "", false, "What remains true after every step?"),
      createField("Key ideas · one per line", "keyIdeas", "textarea", (item?.keyIdeas ?? []).join("\n"), false, "Especially useful for Algorithm Analysis lessons"),
      createField("Worked example", "workedExample", "textarea", item?.workedExample ?? "", false, "Show the idea on a small concrete case"),
      createField(
        "Diagram / animation frames · one per line",
        "visualFrames",
        "textarea",
        (item?.visualFrames ?? []).join("\n"),
        false,
        "Use > between nodes, then add another line for the next frame",
      ),
      createField("Step explanations · one per frame", "frameExplanations", "textarea", (item?.frameExplanations ?? []).join("\n"), false, "Explain what changes in each frame"),
      createField("Pseudocode in English", "pseudocode", "textarea", item?.pseudocode ?? "", false, "Plain-language, implementation-neutral steps"),
      createField("Time / space complexity", "complexity", "text", item?.complexity ?? "", false, "Time, space, and trade-offs"),
      createField("Real code · C", "cCode", "textarea", item?.cCode ?? "", false, "A focused C implementation"),
      createField("Real code · Java", "javaCode", "textarea", item?.javaCode ?? "", false, "A focused Java implementation"),
      createField("Filter tags · comma separated", "tags", "text", (item?.tags ?? []).join(", "), false, "e.g. graph, sorting, dynamic programming"),
    );
  } else if (section.type === "project") {
    fields.push(
      createSelectField("Status", "status", item?.status ?? "Active", ["Concept", "Active", "Paused", "Complete", "Archived"]),
      createField("Main Idea", "mainIdea", "textarea", item?.mainIdea ?? item?.problem ?? "", false, "The central idea in plain language"),
      createField("Broad overview", "overview", "textarea", item?.overview ?? "", false, "What the whole system does"),
      createField("Interactive project map · id | parent id | label | note | study id", "projectMap", "textarea", item?.projectMap ?? "", false, "overview | | Big picture | Whole system |\npart-a | overview | Part A | What it does | study-id"),
      createStudyPicker("Studies organized under this project", "studyIds", item?.studyIds ?? []),
      createField("Overview diagram / animation frames · one per line", "visualFrames", "textarea", (item?.visualFrames ?? []).join("\n"), false, "Use > between nodes"),
      createField("Overview step explanations · one per frame", "frameExplanations", "textarea", (item?.frameExplanations ?? []).join("\n"), false, "Explain each visual transition"),
      createField("Architecture Overview", "architecture", "textarea", item?.architecture ?? "", false, "Major components, boundaries, and data flow"),
      createField("Code map / functions · one per line", "codeMap", "textarea", (item?.codeMap ?? []).join("\n"), false, "Use: file or function | responsibility"),
      createField("Specifics · how it works", "specifics", "textarea", item?.specifics ?? item?.solution ?? "", false, "Important implementation behavior and decisions"),
      createField("Languages · comma separated", "languages", "text", (item?.languages ?? []).join(", "), false, "e.g. Python, Rust"),
      createField("Dependencies / packages / services · comma separated", "dependencies", "text", (item?.dependencies ?? []).join(", "), false, "Only what the project actually relies on"),
      createAlgorithmPicker(item?.algorithmIds ?? []),
      createField("Current outcome", "outcome", "textarea", item?.outcome ?? "", false, "What exists or changed because of the work?"),
      createField("Next meaningful move", "nextStep", "textarea", item?.nextStep ?? "", false, "The next action that changes the project"),
    );
  } else if (section.type === "question") {
    fields.push(
      createSelectField("Kind", "kind", item?.kind ?? "Question", ["Question", "Idea"]),
      createSelectField(
        "Status",
        "status",
        item?.status ?? "Open",
        ["Open", "Exploring", "Developed", "Resolved", "Parked"],
      ),
      createField("What prompted it", "context", "textarea", item?.context ?? "", false, "Observation, tension, source, or problem that raised it"),
      createField(
        "Possible directions · one per line",
        "directions",
        "textarea",
        (item?.directions ?? []).join("\n"),
        false,
        "A path to investigate, test, build, or connect",
      ),
      createField(
        "Current position",
        "currentPosition",
        "textarea",
        item?.currentPosition ?? "",
        false,
        "What you presently think, including uncertainty",
      ),
    );
  } else {
    fields.push(
      createField("Notes", "notes", "textarea", item?.notes ?? "", false, "Write what you want to remember"),
      createField("Tags · comma separated", "tags", "text", (item?.tags ?? []).join(", "), false, "Optional labels"),
    );
  }

  return fields;
}

function createLessonStudyFields(item) {
  const lesson = item.lesson;
  return [
    createHiddenField("format", "lesson"),
    createHiddenField("sourceBookId", item.sourceBookId ?? ""),
    createHiddenField("sourceLessonId", item.sourceLessonId ?? ""),
    createField("Subtitle", "lessonSubtitle", "text", lesson.subtitle ?? "", false, "Optional lesson subtitle"),
    createField("Textbook title", "lessonSourceTitle", "text", lesson.sourceTitle ?? item.sourceTitle ?? "", false, "Original source title"),
    createField("Chapter", "lessonChapter", "text", lesson.chapter ?? "", false, "Parent chapter"),
    createField("Subchapter", "lessonSubchapter", "text", lesson.subchapter ?? "", false, "Lesson section"),
    createField("Overview", "lessonOverview", "textarea", lesson.overview ?? "", false, "Lesson orientation"),
    createField("Learning objectives · one per line", "lessonLearningObjectives", "textarea", (lesson.learningObjectives ?? []).join("\n"), false, "What the learner should be able to do"),
    createField("Prerequisites · one per line", "lessonPrerequisites", "textarea", (lesson.prerequisites ?? []).join("\n"), false, "Knowledge needed first"),
    createField("Key concepts · term | explanation", "lessonKeyConcepts", "textarea", (lesson.keyConcepts ?? []).map(({ term, explanation }) => `${term} | ${explanation}`).join("\n"), false, "One concept per line"),
    createField("Complete sections", "lessonSections", "textarea", formatLessonSections(lesson.sections), false, "Use ## Heading, content, and Sources: 1, 2"),
    createField("Worked examples · one per line", "lessonWorkedExamples", "textarea", (lesson.workedExamples ?? []).join("\n"), false, "Concrete applications"),
    createField("Common misconceptions · one per line", "lessonMisconceptions", "textarea", (lesson.commonMisconceptions ?? []).join("\n"), false, "Mistakes and corrections"),
    createField("Review questions · one per line", "lessonReviewQuestions", "textarea", (lesson.reviewQuestions ?? []).join("\n"), false, "Questions for active recall"),
    createField("Flashcards · question | answer", "lessonFlashcards", "textarea", (lesson.flashcards ?? []).map(({ question, answer }) => `${question} | ${answer}`).join("\n"), false, "One flashcard per line"),
    createField("Recap", "lessonRecap", "textarea", lesson.recap ?? "", false, "Closing summary"),
    createField("Tags · comma separated", "tags", "text", (item.tags ?? []).join(", "), false, "Chapter, subchapter, and subject labels"),
  ];
}

function createRichContentField(value) {
  const wrapper = createElement("section", "rich-content-editor");
  wrapper.append(
    createElement("span", "rich-content-editor-label", "Content builder"),
    createElement("p", "field-hint", "Add blocks in reading order. Media blocks use a URL; diagram lines use > between nodes; equation bodies use LaTeX."),
  );
  const toolbar = createElement("div", "rich-content-toolbar");
  const textarea = document.createElement("textarea");
  textarea.name = "content";
  textarea.value = value;
  textarea.rows = 14;
  textarea.placeholder = "::section Overview\nWrite the section here.\n\n::equation Entropy\nH(X) = -\\sum_x p(x) \\log p(x)";
  const labels = {
    text: "Text",
    section: "Section",
    subsection: "Subsection",
    image: "Image",
    diagram: "Diagram",
    interactable: "Interactable",
    video: "Video",
    equation: "Equation",
  };
  Object.entries(labels).forEach(([type, label]) => {
    const button = createElement("button", "button button-small", `+ ${label}`);
    button.type = "button";
    button.addEventListener("click", () => {
      const title = ["text"].includes(type) ? "" : ` ${label}`;
      const body = ["image", "video", "interactable"].includes(type)
        ? "\nhttps://"
        : type === "diagram"
          ? "\nPart A > Part B > Result"
          : type === "equation"
            ? "\nE = mc^2"
            : "\n";
      const insertion = `${textarea.value.trim() ? "\n\n" : ""}::${type}${title}${body}`;
      textarea.setRangeText(insertion, textarea.value.length, textarea.value.length, "end");
      textarea.focus();
    });
    toolbar.append(button);
  });
  wrapper.append(toolbar, textarea);
  return wrapper;
}

function createStudyParentSelect(selectedId, currentId) {
  const label = createElement("label");
  label.append(document.createTextNode("Parent study · optional nested study"));
  const select = document.createElement("select");
  select.name = "parentStudyId";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "No parent study";
  select.append(empty);
  getWorkspace().sections.filter((section) => section.type === "study").forEach((section) => {
    section.items.filter((study) => study.id !== currentId).forEach((study) => {
      const option = document.createElement("option");
      option.value = study.id;
      option.textContent = `${section.title} · ${study.title}`;
      option.selected = study.id === selectedId;
      select.append(option);
    });
  });
  label.append(select);
  return label;
}

function createStudyPicker(legendText, fieldName, selectedIds) {
  const fieldset = createElement("fieldset", "relation-fieldset");
  fieldset.append(createElement("legend", "", legendText));
  const studies = getWorkspace().sections
    .filter((section) => section.type === "study")
    .flatMap((section) => section.items.map((study) => ({ ...study, sectionTitle: section.title })));
  if (!studies.length) {
    fieldset.append(createElement("p", "field-hint", "Create a Study or Idea Playground experiment first."));
    return fieldset;
  }
  const grid = createElement("div", "relation-grid");
  studies.forEach((study) => {
    const label = createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = fieldName;
    checkbox.value = study.id;
    checkbox.checked = selectedIds.includes(study.id);
    label.append(checkbox, document.createTextNode(`${study.sectionTitle} · ${study.title}`));
    grid.append(label);
  });
  fieldset.append(grid);
  return fieldset;
}

function createHiddenField(name, value) {
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  return input;
}

function formatLessonSections(sections = []) {
  return sections.map((section) => [
    `## ${section.heading}`,
    section.content,
    `Sources: ${[...new Set((section.citations ?? []).map(({ page }) => page))].join(", ")}`,
  ].join("\n")).join("\n\n");
}

/**
 * Creates a labeled input or textarea.
 *
 * @param {string} labelText Visible label.
 * @param {string} name Form field name.
 * @param {"text"|"textarea"} type Control type.
 * @param {string} value Initial value.
 * @param {boolean} required Whether submission requires a value.
 * @param {string} placeholder Input hint.
 * @returns {HTMLElement} Label containing the control.
 */
function createField(labelText, name, type, value, required, placeholder) {
  const label = createElement("label");
  label.append(document.createTextNode(labelText));
  const control = document.createElement(type === "textarea" ? "textarea" : "input");
  control.name = name;
  control.value = value;
  control.required = required;
  control.placeholder = placeholder;
  if (type === "textarea") {
    const tallFields = new Set(["syntax", "syntaxReference", "pseudocode", "cCode", "javaCode"]);
    const mediumFields = new Set([
      "visualFrames", "frameExplanations", "quickFacts", "coreConcepts",
      "lessons", "keyIdeas", "codeMap", "architecture", "specifics",
    ]);
    control.rows = tallFields.has(name) ? 8 : mediumFields.has(name) ? 5 : 3;
  }
  label.append(control);
  return label;
}

/**
 * Creates a labeled select control.
 *
 * @param {string} labelText Visible label.
 * @param {string} name Form field name.
 * @param {string} value Selected value.
 * @param {Array<string>} options Allowed options.
 * @returns {HTMLElement} Label containing the select.
 */
function createSelectField(labelText, name, value, options) {
  const label = createElement("label");
  label.append(document.createTextNode(labelText));
  const control = document.createElement("select");
  control.name = name;
  options.forEach((optionValue) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue;
    option.selected = optionValue === value;
    control.append(option);
  });
  label.append(control);
  return label;
}

/**
 * Builds a project-to-algorithm relationship picker from live Algorithm entries.
 *
 * @param {Array<string>} selectedIds Existing relationship identifiers.
 * @returns {HTMLElement} Algorithm fieldset.
 */
function createAlgorithmPicker(selectedIds) {
  const fieldset = createElement("fieldset", "relation-fieldset");
  fieldset.append(createElement("legend", "", "Algorithms used"));
  const algorithms = getWorkspace().sections
    .filter((section) => section.type === "algorithm")
    .flatMap((section) => section.items)
    .filter((algorithm) => algorithm.category !== "analysis");
  if (!algorithms.length) {
    fieldset.append(createElement("p", "field-hint", "No algorithms exist yet. Add them in the Algorithms section first."));
    return fieldset;
  }
  const grid = createElement("div", "relation-grid");
  algorithms.forEach((algorithm) => {
    const label = createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "algorithmIds";
    checkbox.value = algorithm.id;
    checkbox.checked = selectedIds.includes(algorithm.id);
    label.append(checkbox, document.createTextNode(algorithm.title));
    grid.append(label);
  });
  fieldset.append(grid);
  return fieldset;
}

/**
 * Converts the entry editor into a normalized section record.
 *
 * @param {object} section Parent section.
 * @returns {object} Normalized item fields.
 */
function readItemForm(section) {
  const formData = new FormData(itemForm);
  const base = {
    title: String(formData.get("title") ?? "").trim(),
    summary: String(formData.get("summary") ?? "").trim(),
  };
  const lineList = (name) => String(formData.get(name) ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const commaList = (name) => String(formData.get(name) ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (section.type === "cooking-guide") {
    return {
      ...base,
      abstract: String(formData.get("abstract") ?? "").trim(),
      content: String(formData.get("content") ?? "").trim(),
      definitions: String(formData.get("definitions") ?? "").trim(),
      heat: String(formData.get("heat") ?? "").trim(),
      signals: String(formData.get("signals") ?? "").trim(),
      principles: String(formData.get("principles") ?? "").trim(),
      essentials: String(formData.get("essentials") ?? "").trim(),
      steps: lineList("steps"),
      mistakes: String(formData.get("mistakes") ?? "").trim(),
      tags: commaList("tags"),
    };
  }
  if (section.type === "recipe") {
    return {
      ...base,
      imageUrl: String(formData.get("imageUrl") ?? "").trim(),
      calories: String(formData.get("calories") ?? "").trim(),
      protein: String(formData.get("protein") ?? "").trim(),
      carbs: String(formData.get("carbs") ?? "").trim(),
      fat: String(formData.get("fat") ?? "").trim(),
      servings: String(formData.get("servings") ?? "").trim(),
      timing: String(formData.get("timing") ?? "").trim(),
      ingredients: lineList("ingredients"),
      equipment: lineList("equipment"),
      steps: lineList("steps"),
      notes: String(formData.get("notes") ?? "").trim(),
    };
  }
  if (section.type === "workout") {
    return {
      ...base,
      category: ["push", "pull", "legs"].includes(String(formData.get("category")))
        ? String(formData.get("category"))
        : "push",
      muscleTags: commaList("muscleTags"),
      animationUrl: String(formData.get("animationUrl") ?? "").trim(),
      hypertrophyPrescription: String(formData.get("hypertrophyPrescription") ?? "").trim(),
      strengthPrescription: String(formData.get("strengthPrescription") ?? "").trim(),
      endurancePrescription: String(formData.get("endurancePrescription") ?? "").trim(),
      goal: String(formData.get("goal") ?? "").trim(),
      frequency: String(formData.get("frequency") ?? "").trim(),
      duration: String(formData.get("duration") ?? "").trim(),
      equipment: String(formData.get("equipment") ?? "").trim(),
      exercises: lineList("exercises"),
      breathing: String(formData.get("breathing") ?? "").trim(),
      squeeze: String(formData.get("squeeze") ?? "").trim(),
      progression: String(formData.get("progression") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
    };
  }
  if (section.type === "cleaning") {
    return {
      ...base,
      category: ["house", "self-care"].includes(String(formData.get("category")))
        ? String(formData.get("category"))
        : "house",
      cardType: ["Brief", "Master", "Extended"].includes(String(formData.get("cardType")))
        ? String(formData.get("cardType"))
        : "Brief",
      zone: String(formData.get("zone") ?? "").trim(),
      frequency: String(formData.get("frequency") ?? "").trim(),
      supplies: lineList("supplies"),
      steps: lineList("steps"),
      warnings: String(formData.get("warnings") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
      schedule: lineList("schedule"),
      tags: commaList("tags").map((tag) => tag.toLocaleLowerCase()),
    };
  }
  if (section.type === "routine") {
    return { ...base, trigger: String(formData.get("trigger") ?? "").trim(), steps: lineList("steps") };
  }
  if (section.type === "howto") {
    return {
      ...base,
      folderPath: String(formData.get("folderPath") ?? "").trim(),
      purpose: String(formData.get("purpose") ?? "").trim(),
      checklist: lineList("checklist"),
      steps: lineList("steps"),
      warnings: String(formData.get("warnings") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
      tags: commaList("tags"),
    };
  }
  if (section.type === "study") {
    if (formData.get("format") === "lesson") {
      const existing = editingItemId
        ? section.items.find((item) => item.id === editingItemId)
        : null;
      const lesson = readLessonStudyForm(formData, existing?.lesson);
      return {
        ...base,
        abstract: String(formData.get("abstract") ?? "").trim(),
        folderPath: String(formData.get("folderPath") ?? "").trim(),
        parentStudyId: String(formData.get("parentStudyId") ?? "").trim(),
        content: String(formData.get("content") ?? "").trim(),
        definitions: String(formData.get("definitions") ?? "").trim(),
        notecardLinks: String(formData.get("notecardLinks") ?? "").trim(),
        format: "lesson",
        lesson,
        sourceBookId: String(formData.get("sourceBookId") ?? ""),
        sourceLessonId: String(formData.get("sourceLessonId") ?? ""),
        sourceTitle: lesson.sourceTitle,
        sourcePages: lesson.sourcePages,
        tags: commaList("tags"),
      };
    }
    return {
      ...base,
      abstract: String(formData.get("abstract") ?? "").trim(),
      folderPath: String(formData.get("folderPath") ?? "").trim(),
      parentStudyId: String(formData.get("parentStudyId") ?? "").trim(),
      content: String(formData.get("content") ?? "").trim(),
      definitions: String(formData.get("definitions") ?? "").trim(),
      notecardLinks: String(formData.get("notecardLinks") ?? "").trim(),
      researchQuestion: String(formData.get("researchQuestion") ?? "").trim(),
      hypothesis: String(formData.get("hypothesis") ?? "").trim(),
      method: String(formData.get("method") ?? "").trim(),
      evidence: lineList("evidence"),
      findings: String(formData.get("findings") ?? "").trim(),
      limitations: String(formData.get("limitations") ?? "").trim(),
      nextSteps: String(formData.get("nextSteps") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
      tags: commaList("tags"),
    };
  }
  if (section.type === "idea" || section.type === "question") {
    return {
      ...base,
      stage: ["Working", "Formed", "Parked"].includes(String(formData.get("stage")))
        ? String(formData.get("stage"))
        : "Working",
      abstract: String(formData.get("abstract") ?? "").trim(),
      folderPath: String(formData.get("folderPath") ?? "").trim(),
      thesis: String(formData.get("thesis") ?? "").trim(),
      reasoning: String(formData.get("reasoning") ?? "").trim(),
      assumptions: lineList("assumptions"),
      openQuestions: lineList("openQuestions"),
      content: String(formData.get("content") ?? "").trim(),
      definitions: String(formData.get("definitions") ?? "").trim(),
      linkedStudyIds: formData.getAll("linkedStudyIds").map(String),
    };
  }
  if (section.type === "language") {
    return {
      ...base,
      quickFacts: lineList("quickFacts"),
      coreConcepts: lineList("coreConcepts"),
      syntaxReference: String(formData.get("syntaxReference") ?? "").trim(),
      lessons: lineList("lessons"),
    };
  }
  if (section.type === "algorithm") {
    return {
      ...base,
      category: ["personal", "traditional", "advanced", "analysis"].includes(String(formData.get("category")))
        ? String(formData.get("category"))
        : "personal",
      purpose: String(formData.get("purpose") ?? "").trim(),
      explanation: String(formData.get("explanation") ?? "").trim(),
      invariant: String(formData.get("invariant") ?? "").trim(),
      keyIdeas: lineList("keyIdeas"),
      workedExample: String(formData.get("workedExample") ?? "").trim(),
      visualFrames: lineList("visualFrames"),
      frameExplanations: lineList("frameExplanations"),
      pseudocode: String(formData.get("pseudocode") ?? "").trim(),
      complexity: String(formData.get("complexity") ?? "").trim(),
      cCode: String(formData.get("cCode") ?? "").trim(),
      javaCode: String(formData.get("javaCode") ?? "").trim(),
      tags: commaList("tags").map((tag) => tag.toLocaleLowerCase()),
    };
  }
  if (section.type === "project") {
    return {
      ...base,
      status: String(formData.get("status") ?? "Active"),
      mainIdea: String(formData.get("mainIdea") ?? "").trim(),
      overview: String(formData.get("overview") ?? "").trim(),
      projectMap: String(formData.get("projectMap") ?? "").trim(),
      studyIds: formData.getAll("studyIds").map(String),
      visualFrames: lineList("visualFrames"),
      frameExplanations: lineList("frameExplanations"),
      architecture: String(formData.get("architecture") ?? "").trim(),
      codeMap: lineList("codeMap"),
      specifics: String(formData.get("specifics") ?? "").trim(),
      outcome: String(formData.get("outcome") ?? "").trim(),
      nextStep: String(formData.get("nextStep") ?? "").trim(),
      languages: commaList("languages"),
      dependencies: commaList("dependencies"),
      algorithmIds: formData.getAll("algorithmIds").map(String),
    };
  }
  if (section.type === "question") {
    return {
      ...base,
      kind: String(formData.get("kind") ?? "Question"),
      status: String(formData.get("status") ?? "Open"),
      context: String(formData.get("context") ?? "").trim(),
      directions: lineList("directions"),
      currentPosition: String(formData.get("currentPosition") ?? "").trim(),
    };
  }
  return {
    ...base,
    notes: String(formData.get("notes") ?? "").trim(),
    tags: commaList("tags"),
  };
}

function readLessonStudyForm(formData, existingLesson = {}) {
  const lines = (name) => String(formData.get(name) ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const pairs = (name, firstKey, secondKey) => lines(name).map((line) => {
    const separator = line.indexOf("|");
    return {
      [firstKey]: (separator < 0 ? line : line.slice(0, separator)).trim(),
      [secondKey]: (separator < 0 ? "" : line.slice(separator + 1)).trim(),
    };
  });
  const sections = parseLessonSections(String(formData.get("lessonSections") ?? ""), existingLesson.sections);
  const sourcePages = [...new Set(sections.flatMap((section) => section.citations.map(({ page }) => page)))].sort((a, b) => a - b);
  return {
    title: String(formData.get("title") ?? "").trim(),
    subtitle: String(formData.get("lessonSubtitle") ?? "").trim(),
    sourceTitle: String(formData.get("lessonSourceTitle") ?? "").trim(),
    chapter: String(formData.get("lessonChapter") ?? "").trim(),
    subchapter: String(formData.get("lessonSubchapter") ?? "").trim(),
    overview: String(formData.get("lessonOverview") ?? "").trim(),
    learningObjectives: lines("lessonLearningObjectives"),
    prerequisites: lines("lessonPrerequisites"),
    keyConcepts: pairs("lessonKeyConcepts", "term", "explanation"),
    sections,
    workedExamples: lines("lessonWorkedExamples"),
    commonMisconceptions: lines("lessonMisconceptions"),
    reviewQuestions: lines("lessonReviewQuestions"),
    flashcards: pairs("lessonFlashcards", "question", "answer"),
    recap: String(formData.get("lessonRecap") ?? "").trim(),
    sourcePages,
  };
}

function parseLessonSections(value, existingSections = []) {
  return String(value ?? "")
    .split(/(?=^##\s+)/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split("\n");
      const heading = lines.shift()?.replace(/^##\s*/, "").trim() || `Lesson section ${index + 1}`;
      const sourceLineIndex = lines.findIndex((line) => /^Sources:\s*/i.test(line));
      const pageText = sourceLineIndex >= 0 ? lines.splice(sourceLineIndex, 1)[0] : "";
      const pages = [...new Set(
        (pageText.match(/\d+/g) ?? []).map(Number).filter((page) => Number.isInteger(page) && page > 0),
      )];
      const priorCitations = existingSections[index]?.citations ?? [];
      return {
        heading,
        content: lines.join("\n").trim(),
        citations: pages.map((page) => (
          priorCitations.find((citation) => citation.page === page)
          ?? { page, chunkId: "saved-study" }
        )),
      };
    });
}

/**
 * Confirms before deleting a section.
 *
 * @param {object} section Section to delete.
 */
function confirmSectionDelete(section) {
  if (isCoreSectionId(section.id)) {
    showToast("Core sections cannot be deleted.");
    return;
  }

  if (!window.confirm(`Delete “${section.title}”?`)) return;

  deleteSection(section.id);
  location.hash = `area=${getAreaForSection(section)}`;
  showToast("Section deleted from this device.");
}

/**
 * Confirms before deleting one entry.
 *
 * @param {object} section Parent section.
 * @param {object} item Entry to delete.
 */
function confirmItemDelete(section, item) {
  if (!window.confirm(`Delete “${item.title}”?`)) return;

  deleteItem(section.id, item.id);
  renderWorkspace();
  showToast("Entry deleted.");
}

/**
 * Displays a short-lived, non-blocking status message.
 *
 * @param {string} message Status text.
 */
function showToast(message) {
  const region = document.querySelector("#toast-region");
  const toast = createElement("div", "toast", message);
  region.append(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 250);
  }, 2600);
}

itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const section = getSection(activeSectionId);
  if (!section) return;
  const itemInput = readItemForm(section);
  const wasEditing = Boolean(editingItemId);
  let savedItem;
  if (editingItemId) {
    savedItem = updateItem(section.id, editingItemId, itemInput);
  } else {
    savedItem = addItem(section.id, itemInput);
  }
  const glossaryResult = await syncEntryDefinitions(section, savedItem);
  itemDialog.close();
  renderWorkspace();
  showToast(glossaryResult
    ? `${wasEditing ? "Entry updated" : "Entry added"}; ${glossaryResult} definition${glossaryResult === 1 ? "" : "s"} synced to the glossary.`
    : (wasEditing ? "Entry updated." : "Entry added."));
});

async function syncEntryDefinitions(section, item, options = {}) {
  const definitions = parseDefinitionLines(item?.definitions);
  if (!definitions.length) return 0;
  try {
    const glossary = await listGlossaryEntries();
    let savedCount = 0;
    for (const definition of definitions) {
      const existing = glossary.find((entry) => entry.term.toLocaleLowerCase() === definition.term.toLocaleLowerCase());
      const linked = findStudyRecord(definition.linkedStudyId);
      const link = linked
        ? `workspace.html${buildContentHash(linked.sectionId, linked.id)}`
        : `workspace.html${buildContentHash(section.id, item.id)}`;
      const saved = await saveGlossaryEntry({
        ...existing,
        id: existing?.id,
        term: definition.term,
        definition: definition.definition,
        links: [...new Set([...(existing?.links ?? []), link])],
        tags: [...new Set([...(existing?.tags ?? []), "study definition"])],
        createdAt: existing?.createdAt,
      });
      glossary.push(saved);
      savedCount += 1;
    }
    return savedCount;
  } catch (error) {
    console.warn("Study definitions could not be synchronized to the glossary.", error);
    if (!options.quiet) showToast("Entry saved; one or more glossary definitions need review.");
    return 0;
  }
}

async function syncAllWorkspaceDefinitions(workspace = getWorkspace()) {
  const sections = workspace.sections.filter((section) => ["study", "idea", "cooking-guide"].includes(section.type));
  for (const section of sections) {
    for (const item of section.items) {
      if (item.definitions) await syncEntryDefinitions(section, item, { quiet: true });
    }
  }
}

document.querySelectorAll("[data-dialog-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog")?.close());
});
window.addEventListener("hashchange", renderWorkspace);

renderWorkspace();
syncAllWorkspaceDefinitions().catch((error) => console.warn("Glossary synchronization was not completed.", error));

installAiPageHost(createWorkspaceAiAdapter({
  readWorkspace: getWorkspace,
  commitWorkspace: (workspace) => {
    saveWorkspace(workspace);
    syncAllWorkspaceDefinitions(workspace).catch((error) => console.warn("Glossary synchronization was not completed.", error));
    window.requestAnimationFrame(renderWorkspace);
  },
  createId,
}));
