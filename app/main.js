/**
 * Overview & Purpose
 * Renders the local-first Everyday Life, Studies & Projects, and tools areas,
 * including type-aware entry editors and offline registration.
 *
 * Architectural Relationships
 * Called by: workspace.html.
 * Calls: app/store.js and the browser DOM, dialog, and service-worker APIs.
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
  deleteItem,
  deleteSection,
  getSection,
  getWorkspace,
  isCoreSectionId,
  isDeletePasswordValid,
  updateItem,
} from "./store.js";

const appMain = document.querySelector("#app-main");
const itemDialog = document.querySelector("#item-dialog");
const itemForm = document.querySelector("#item-form");
const passwordDialog = document.querySelector("#password-dialog");
const passwordForm = document.querySelector("#password-form");
const animationTimers = new Set();

let activeSectionId = null;
let editingItemId = null;
let pendingDeleteAction = null;

const SECTION_LABELS = {
  "cooking-guide": "COOKING GUIDE",
  recipe: "RECIPE",
  workout: "WORKOUT",
  cleaning: "CLEANING AREA",
  routine: "ROUTINE",
  language: "LANGUAGE",
  algorithm: "ALGORITHM",
  project: "PROJECT",
  custom: "ENTRY",
};

const SECTION_ACCENTS = {
  "cooking-guide": "ochre",
  recipe: "coral",
  workout: "blue",
  cleaning: "sage",
  routine: "violet",
  language: "blue",
  algorithm: "violet",
  project: "ochre",
  custom: "coral",
};

const AREA_EVERYDAY = "everyday";
const AREA_STUDIES = "studies";
const AREA_TOOLS = "tools";
const VALID_AREAS = new Set([AREA_EVERYDAY, AREA_STUDIES, AREA_TOOLS]);

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
    "Keep concept studies, programming refreshers, algorithms, projects, and notecards together.",
  );
  const sectionHeading = createSectionHeading(
    "Studies and project libraries",
    "Add knowledge when it becomes useful. Nothing is prefilled.",
  );
  const libraryGrid = createElement("div", "library-grid");
  getSectionsForArea(workspace, AREA_STUDIES).forEach((section) => libraryGrid.append(createLibraryCard(section)));

  const notecardHeading = createSectionHeading("Notecards", "Practice existing collections or open the full educational archive.");
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
      title: "Study Library",
      copy: "Open mathematics, neuroscience, computer science, and arts resources.",
      href: "educational_resources/",
      icon: "▤",
      accent: "violet",
    },
  ].forEach((resource) => notecardGrid.append(createToolCard(resource)));

  appMain.append(hero, sectionHeading, libraryGrid, notecardHeading, notecardGrid);
}

/**
 * Renders the Everyday Life dashboard as three distinct practical domains.
 *
 * @param {{sections: Array<object>}} workspace Workspace data.
 */
function renderEverydayDashboard(workspace) {
  const hero = createAreaHero(
    "EVERYDAY LIFE",
    "Keep ordinary life clear, capable, and manageable.",
    "Cooking, training, and house care stay here—separate from studies, research, projects, and work tools.",
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
      copy: "Divide the house into parts so every area has a clear cleaning method.",
      sectionIds: ["cleaning"],
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

  const displayedSectionIds = new Set(["how-to-cook", "recipes", "workouts", "cleaning"]);
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
    "Draw, sign, plan, analyze, and design without mixing tools into your personal knowledge sections.",
  );
  const toolsHeading = createSectionHeading("Workspace tools", "Choose the surface that matches the task.");
  const toolsGrid = createElement("div", "tool-grid");
  [
    {
      title: "Visual Board",
      copy: "A freeform canvas where diagrams, connectors, shapes, notes, and paint coexist.",
      href: "tools/visual-board.html",
      icon: "✣",
      accent: "blue",
    },
    {
      title: "PDF Signer",
      copy: "View a PDF, create a typed signature, place it, and download the signed copy.",
      href: "tools/pdf-signer.html",
      icon: "⌁",
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
      title: "Travel Planner",
      copy: "Keep flights, stays, places, and daily itinerary notes on a simple calendar.",
      href: "tools/travel-planner.html",
      icon: "✈",
      accent: "coral",
    },
    {
      title: "Architecture",
      copy: "Build a draggable file and folder tree with aligned implementation notes.",
      href: "tools/architecture.html",
      icon: "⌘",
      accent: "violet",
    },
  ].forEach((tool) => toolsGrid.append(createToolCard(tool)));

  appMain.append(hero, toolsHeading, toolsGrid);
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
  activeSectionId = section.id;

  const heading = createElement("section", "page-heading section-page-heading");
  const headingCopy = createElement("div");
  headingCopy.append(
    createElement("p", "eyebrow", `${section.icon} ${SECTION_LABELS[section.type] ?? "SECTION"} LIBRARY`),
    createElement("h1", "", section.title),
    createElement("p", "page-description", section.description || "A flexible space for your notes."),
  );
  const actions = createElement("div", "page-actions");
  const addButton = createElement("button", "button button-primary", `+ Add ${getSingularLabel(section)}`);
  addButton.type = "button";
  addButton.addEventListener("click", () => openItemDialog(section));
  actions.append(addButton);
  if (!isCoreSectionId(section.id)) {
    const deleteButton = createElement("button", "button button-quiet", "Delete section");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => confirmSectionDelete(section));
    actions.append(deleteButton);
  }
  heading.append(headingCopy, actions);

  const meta = createElement("div", "section-meta");
  meta.append(
    createElement("span", "", `${section.items.length} ${section.items.length === 1 ? "entry" : "entries"}`),
    createElement("span", "", "Stored on this device"),
  );

  const grid = createElement("div", "entry-grid");
  if (!section.items.length) {
    const empty = createEmptyState(
      `No ${section.title.toLocaleLowerCase()} yet`,
      getEmptyMessage(section),
    );
    const emptyButton = createElement("button", "button button-primary", `Create the first ${getSingularLabel(section)}`);
    emptyButton.type = "button";
    emptyButton.addEventListener("click", () => openItemDialog(section));
    empty.append(emptyButton);
    grid.append(empty);
  } else {
    section.items
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .forEach((item) => grid.append(createEntryCard(section, item)));
  }

  appMain.append(heading, meta, grid);
  const routeItemId = getRouteItemId();
  if (routeItemId) {
    window.requestAnimationFrame(() => {
      const target = document.querySelector(`#entry-${CSS.escape(routeItemId)}`);
      target?.classList.add("is-targeted");
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
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
    cleaning: "Add one room, surface, or part of the house with the order and supplies needed to clean it.",
    routine: "Turn a recurring task into a clear trigger and a checklist you can follow without re-planning it.",
    language: "Add a language when you need a refresher. Capture syntax, mental models, and the mistakes you want to avoid.",
    algorithm: "Add algorithms as you encounter them, including use cases and visual frames you can play back.",
    project: "Document a project’s interesting problem, your approach, and its language and algorithm relationships.",
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
    workout: "workout type",
    cleaning: "cleaning area",
    routine: "routine",
    language: "language",
    algorithm: "algorithm",
    project: "project",
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
    createElement("span", "card-kicker", SECTION_LABELS[section.type] ?? "ENTRY"),
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

  if (section.type === "cooking-guide") {
    card.append(createCookingGuideBody(section, item));
  } else if (section.type === "recipe") {
    card.append(createRecipeBody(section, item));
  } else if (section.type === "workout") {
    card.append(createWorkoutBody(section, item));
  } else if (section.type === "cleaning") {
    card.append(createCleaningBody(section, item));
  } else if (section.type === "routine") {
    card.append(createRoutineBody(section, item));
  } else if (section.type === "language") {
    card.append(createLanguageBody(item));
  } else if (section.type === "algorithm") {
    card.append(createAlgorithmBody(item));
  } else if (section.type === "project") {
    card.append(createProjectBody(item));
  } else {
    card.append(createGenericBody(item));
  }
  return card;
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
 * Renders cooking principles, essentials, mistakes, and a repeatable method.
 *
 * @param {object} section Parent section.
 * @param {object} item Cooking-guide record.
 * @returns {HTMLElement} Cooking-guide content.
 */
function createCookingGuideBody(section, item) {
  const body = createElement("div", "entry-body");
  const details = createElement("div", "two-column-details");
  if (item.principles) details.append(createDefinition("What to understand", item.principles));
  if (item.essentials) details.append(createDefinition("Tools and essentials", item.essentials));
  if (item.mistakes) details.append(createDefinition("Common mistakes", item.mistakes));
  if (details.childElementCount) body.append(details);
  appendPersistentChecklist(body, section, item, "Method", item.steps, "checkedSteps");
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
  const body = createElement("div", "entry-body");
  const details = createElement("div", "two-column-details");
  if (item.servings) details.append(createDefinition("Servings", item.servings));
  if (item.timing) details.append(createDefinition("Time", item.timing));
  if (item.notes) details.append(createDefinition("Notes", item.notes));
  if (details.childElementCount) body.append(details);
  appendPersistentChecklist(body, section, item, "Ingredients", item.ingredients, "checkedIngredients");
  appendPersistentChecklist(body, section, item, "Method", item.steps, "checkedSteps");
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
  const body = createElement("div", "entry-body");
  const details = createElement("div", "two-column-details");
  if (item.goal) details.append(createDefinition("Purpose", item.goal));
  if (item.frequency) details.append(createDefinition("Frequency", item.frequency));
  if (item.notes) details.append(createDefinition("Notes", item.notes));
  if (details.childElementCount) body.append(details);
  appendPersistentChecklist(body, section, item, "Exercises", item.exercises, "checkedExercises");
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
  const body = createElement("div", "entry-body");
  const details = createElement("div", "two-column-details");
  if (item.frequency) details.append(createDefinition("When to clean it", item.frequency));
  if (item.notes) details.append(createDefinition("Notes", item.notes));
  if (details.childElementCount) body.append(details);
  appendPersistentChecklist(body, section, item, "Supplies", item.supplies, "checkedSupplies");
  appendPersistentChecklist(body, section, item, "Cleaning order", item.steps, "checkedSteps");
  return body;
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
 * Renders language refresher fields.
 *
 * @param {object} item Language record.
 * @returns {HTMLElement} Language content.
 */
function createLanguageBody(item) {
  const body = createElement("div", "entry-body two-column-details");
  if (item.mentalModel) body.append(createDefinition("Mental model", item.mentalModel));
  if (item.syntax) body.append(createCodeDefinition("Syntax refresher", item.syntax));
  if (item.gotchas) body.append(createDefinition("Gotchas", item.gotchas));
  return body;
}

/**
 * Renders algorithm notes plus an optional user-authored animation.
 *
 * @param {object} item Algorithm record.
 * @returns {HTMLElement} Algorithm content.
 */
function createAlgorithmBody(item) {
  const body = createElement("div", "entry-body");
  const details = createElement("div", "two-column-details");
  if (item.useCases) details.append(createDefinition("Use when", item.useCases));
  if (item.complexity) details.append(createDefinition("Complexity", item.complexity));
  if (item.explanation) details.append(createDefinition("How it works", item.explanation));
  body.append(details);

  const frames = item.visualFrames ?? [];
  if (frames.length) {
    body.append(createAlgorithmAnimation(frames));
  }
  return body;
}

/**
 * Creates a small playback surface from user-authored “a > b > c” frames.
 *
 * @param {Array<string>} frames Animation frames.
 * @returns {HTMLElement} Playback control and stage.
 */
function createAlgorithmAnimation(frames) {
  const animation = createElement("section", "algorithm-animation");
  const toolbar = createElement("div", "animation-toolbar");
  toolbar.append(createElement("span", "card-kicker", "VISUAL WALKTHROUGH"));
  const playButton = createElement("button", "button button-small", "Play");
  playButton.type = "button";
  toolbar.append(playButton);
  const stage = createElement("div", "algorithm-stage");
  const caption = createElement("p", "animation-caption");
  let frameIndex = 0;
  let timer = null;

  const showFrame = () => {
    stage.replaceChildren();
    const tokens = frames[frameIndex].split(">").map((token) => token.trim()).filter(Boolean);
    tokens.forEach((token, index) => {
      stage.append(createElement("span", `algorithm-node ${index === tokens.length - 1 ? "is-active" : ""}`, token));
      if (index < tokens.length - 1) {
        stage.append(createElement("i", "", "→"));
      }
    });
    caption.textContent = `Frame ${frameIndex + 1} of ${frames.length}`;
  };

  playButton.addEventListener("click", () => {
    if (timer) {
      window.clearInterval(timer);
      animationTimers.delete(timer);
      timer = null;
      playButton.textContent = "Play";
      return;
    }
    playButton.textContent = "Pause";
    timer = window.setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      showFrame();
    }, 1100);
    animationTimers.add(timer);
  });
  showFrame();
  animation.append(toolbar, stage, caption);
  return animation;
}

/**
 * Renders project fields and related language/algorithm labels.
 *
 * @param {object} item Project record.
 * @returns {HTMLElement} Project content.
 */
function createProjectBody(item) {
  const body = createElement("div", "entry-body");
  const details = createElement("div", "two-column-details");
  if (item.problem) details.append(createDefinition("Interesting problem", item.problem));
  if (item.solution) details.append(createDefinition("How I solved it", item.solution));
  body.append(details);
  appendTagGroup(body, "Languages", item.languages);
  appendTagGroup(body, "Algorithms", resolveAlgorithmNames(item.algorithmIds));
  return body;
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
 * Resolves stored algorithm identifiers to current titles.
 *
 * @param {Array<string>} algorithmIds Algorithm identifiers.
 * @returns {Array<string>} Existing algorithm titles.
 */
function resolveAlgorithmNames(algorithmIds = []) {
  const algorithms = getWorkspace().sections
    .filter((section) => section.type === "algorithm")
    .flatMap((section) => section.items);
  return algorithmIds
    .map((algorithmId) => algorithms.find((algorithm) => algorithm.id === algorithmId)?.title)
    .filter(Boolean);
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
      createField("What to understand", "principles", "textarea", item?.principles ?? "", false, "The principles behind this method"),
      createField("Tools and essentials", "essentials", "textarea", item?.essentials ?? "", false, "Equipment, ingredients, heat, or setup"),
      createField("Method · one step per line", "steps", "textarea", (item?.steps ?? []).join("\n"), false, "Write the method in the order you use it"),
      createField("Common mistakes", "mistakes", "textarea", item?.mistakes ?? "", false, "What usually goes wrong and how to notice it"),
    );
  } else if (section.type === "recipe") {
    fields.push(
      createField("Servings", "servings", "text", item?.servings ?? "", false, "e.g. 4 servings"),
      createField("Prep and cook time", "timing", "text", item?.timing ?? "", false, "e.g. 15 min prep · 35 min cook"),
      createField("Ingredients · one per line", "ingredients", "textarea", (item?.ingredients ?? []).join("\n"), false, "Include useful amounts"),
      createField("Method · one step per line", "steps", "textarea", (item?.steps ?? []).join("\n"), false, "Write the cooking order"),
      createField("Notes and adjustments", "notes", "textarea", item?.notes ?? "", false, "Substitutions, storage, or changes for next time"),
    );
  } else if (section.type === "workout") {
    fields.push(
      createField("Purpose", "goal", "textarea", item?.goal ?? "", false, "What this kind of workout develops"),
      createField("Frequency and structure", "frequency", "text", item?.frequency ?? "", false, "How often, duration, sets, or intensity"),
      createField("Exercises · one per line", "exercises", "textarea", (item?.exercises ?? []).join("\n"), false, "List the movements in order"),
      createField("Notes", "notes", "textarea", item?.notes ?? "", false, "Progression, recovery, equipment, or form cues"),
    );
  } else if (section.type === "cleaning") {
    fields.push(
      createField("Frequency", "frequency", "text", item?.frequency ?? "", false, "Daily, weekly, monthly, or as needed"),
      createField("Supplies · one per line", "supplies", "textarea", (item?.supplies ?? []).join("\n"), false, "Only what this part of the house needs"),
      createField("Cleaning order · one step per line", "steps", "textarea", (item?.steps ?? []).join("\n"), false, "Work from the first action to the last"),
      createField("Notes", "notes", "textarea", item?.notes ?? "", false, "Warnings, material care, or shortcuts"),
    );
  } else if (section.type === "routine") {
    fields.push(
      createField("Trigger", "trigger", "textarea", item?.trigger ?? "", false, "When should you use this routine?"),
      createField("Steps · one per line", "steps", "textarea", (item?.steps ?? []).join("\n"), false, "Write only the steps you actually need"),
    );
  } else if (section.type === "language") {
    fields.push(
      createField("Mental model", "mentalModel", "textarea", item?.mentalModel ?? "", false, "How should you think in this language?"),
      createField("Syntax refresher", "syntax", "textarea", item?.syntax ?? "", false, "Keep your most useful syntax here"),
      createField("Gotchas", "gotchas", "textarea", item?.gotchas ?? "", false, "Mistakes, edge cases, and conventions"),
    );
  } else if (section.type === "algorithm") {
    fields.push(
      createField("Use cases", "useCases", "textarea", item?.useCases ?? "", false, "What kind of problem is this good for?"),
      createField("How it works", "explanation", "textarea", item?.explanation ?? "", false, "Explain it in your own words"),
      createField("Complexity", "complexity", "text", item?.complexity ?? "", false, "Time, space, and trade-offs"),
      createField(
        "Animation frames · one per line",
        "visualFrames",
        "textarea",
        (item?.visualFrames ?? []).join("\n"),
        false,
        "Use > between nodes, then add another line for the next frame",
      ),
    );
  } else if (section.type === "project") {
    fields.push(
      createField("Interesting problem", "problem", "textarea", item?.problem ?? "", false, "What made this problem worth solving?"),
      createField("How I solved it", "solution", "textarea", item?.solution ?? "", false, "Capture the approach and the useful insight"),
      createField("Languages · comma separated", "languages", "text", (item?.languages ?? []).join(", "), false, "e.g. Python, Rust"),
      createAlgorithmPicker(item?.algorithmIds ?? []),
    );
  } else {
    fields.push(
      createField("Notes", "notes", "textarea", item?.notes ?? "", false, "Write what you want to remember"),
      createField("Tags · comma separated", "tags", "text", (item?.tags ?? []).join(", "), false, "Optional labels"),
    );
  }

  return fields;
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
  if (type === "textarea") control.rows = name === "visualFrames" || name === "syntax" ? 5 : 3;
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
    .flatMap((section) => section.items);
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
      principles: String(formData.get("principles") ?? "").trim(),
      essentials: String(formData.get("essentials") ?? "").trim(),
      steps: lineList("steps"),
      mistakes: String(formData.get("mistakes") ?? "").trim(),
    };
  }
  if (section.type === "recipe") {
    return {
      ...base,
      servings: String(formData.get("servings") ?? "").trim(),
      timing: String(formData.get("timing") ?? "").trim(),
      ingredients: lineList("ingredients"),
      steps: lineList("steps"),
      notes: String(formData.get("notes") ?? "").trim(),
    };
  }
  if (section.type === "workout") {
    return {
      ...base,
      goal: String(formData.get("goal") ?? "").trim(),
      frequency: String(formData.get("frequency") ?? "").trim(),
      exercises: lineList("exercises"),
      notes: String(formData.get("notes") ?? "").trim(),
    };
  }
  if (section.type === "cleaning") {
    return {
      ...base,
      frequency: String(formData.get("frequency") ?? "").trim(),
      supplies: lineList("supplies"),
      steps: lineList("steps"),
      notes: String(formData.get("notes") ?? "").trim(),
    };
  }
  if (section.type === "routine") {
    return { ...base, trigger: String(formData.get("trigger") ?? "").trim(), steps: lineList("steps") };
  }
  if (section.type === "language") {
    return {
      ...base,
      mentalModel: String(formData.get("mentalModel") ?? "").trim(),
      syntax: String(formData.get("syntax") ?? "").trim(),
      gotchas: String(formData.get("gotchas") ?? "").trim(),
    };
  }
  if (section.type === "algorithm") {
    return {
      ...base,
      useCases: String(formData.get("useCases") ?? "").trim(),
      explanation: String(formData.get("explanation") ?? "").trim(),
      complexity: String(formData.get("complexity") ?? "").trim(),
      visualFrames: lineList("visualFrames"),
    };
  }
  if (section.type === "project") {
    return {
      ...base,
      problem: String(formData.get("problem") ?? "").trim(),
      solution: String(formData.get("solution") ?? "").trim(),
      languages: commaList("languages"),
      algorithmIds: formData.getAll("algorithmIds").map(String),
    };
  }
  return {
    ...base,
    notes: String(formData.get("notes") ?? "").trim(),
    tags: commaList("tags"),
  };
}

/**
 * Requests password confirmation before deleting a section.
 *
 * @param {object} section Section to delete.
 */
function confirmSectionDelete(section) {
  if (isCoreSectionId(section.id)) {
    showToast("Core sections cannot be deleted.");
    return;
  }

  openPasswordDialog(`Delete “${section.title}”?`, () => {
    deleteSection(section.id);
    location.hash = `area=${getAreaForSection(section)}`;
    showToast("Section deleted from this device.");
  });
}

/**
 * Requests password confirmation before deleting one entry.
 *
 * @param {object} section Parent section.
 * @param {object} item Entry to delete.
 */
function confirmItemDelete(section, item) {
  openPasswordDialog(`Delete “${item.title}”?`, () => {
    deleteItem(section.id, item.id);
    renderWorkspace();
    showToast("Entry deleted.");
  });
}

/**
 * Opens the shared password gate around a pending destructive action.
 *
 * @param {string} title Dialog title.
 * @param {Function} action Action to run after a correct password.
 */
function openPasswordDialog(title, action) {
  pendingDeleteAction = action;
  passwordForm.reset();
  document.querySelector("#password-error").textContent = "";
  document.querySelector("#password-dialog-title").textContent = title;
  passwordDialog.showModal();
  window.setTimeout(() => passwordForm.elements.password.focus(), 0);
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

itemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const section = getSection(activeSectionId);
  if (!section) return;
  const itemInput = readItemForm(section);
  if (editingItemId) {
    updateItem(section.id, editingItemId, itemInput);
  } else {
    addItem(section.id, itemInput);
  }
  itemDialog.close();
  renderWorkspace();
  showToast(editingItemId ? "Entry updated." : "Entry added.");
});

passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const password = String(new FormData(passwordForm).get("password") ?? "");
  if (!isDeletePasswordValid(password)) {
    document.querySelector("#password-error").textContent = "That password is not correct.";
    passwordForm.elements.password.select();
    return;
  }
  passwordDialog.close();
  pendingDeleteAction?.();
  pendingDeleteAction = null;
});

document.querySelectorAll("[data-dialog-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog")?.close());
});
window.addEventListener("hashchange", renderWorkspace);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.error("Offline service worker registration failed.", error);
  });
}

renderWorkspace();
