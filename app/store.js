/**
 * Overview & Purpose
 * Owns the local-first workspace data model and all persistence mutations.
 *
 * Architectural Relationships
 * Called by: The workspace dashboard and architecture designer.
 * Calls: Browser localStorage and workspace change events.
 *
 * External Resources
 * localStorage key "artificially-neuroscience-workspace-v1".
 *
 * Notes
 * State is intentionally device-local. The delete password is a UI safeguard,
 * not a security boundary, because this is a client-only static application.
 */

const WORKSPACE_KEY = "artificially-neuroscience-workspace-v1";
export const DELETE_PASSWORD = "password";
const CURRENT_WORKSPACE_VERSION = 5;
const EVERYDAY_AREA = "everyday";

const DEFAULT_SECTIONS = [
  {
    id: "how-to-cook",
    title: "How to Cook",
    description: "Techniques, methods, tools, and repeatable steps for becoming a capable cook.",
    icon: "⌁",
    type: "cooking-guide",
    area: EVERYDAY_AREA,
    items: [],
  },
  {
    id: "recipes",
    title: "Recipes",
    description: "Ingredients, timing, method, and practical notes for meals worth making again.",
    icon: "◫",
    type: "recipe",
    area: EVERYDAY_AREA,
    items: [],
  },
  {
    id: "workouts",
    title: "Workout Types",
    description: "Different kinds of training organized by purpose, structure, exercises, and frequency.",
    icon: "⌇",
    type: "workout",
    area: EVERYDAY_AREA,
    items: [],
  },
  {
    id: "cleaning",
    title: "House Cleaning",
    description: "Break the house into manageable parts with supplies, order, and repeatable cleaning steps.",
    icon: "⌂",
    type: "cleaning",
    area: EVERYDAY_AREA,
    items: [],
  },
  {
    id: "studies",
    title: "Studies",
    description: "Concept breakdowns, visual explanations, essays, and notes worth developing.",
    icon: "◉",
    type: "custom",
    items: [],
  },
  {
    id: "programming-languages",
    title: "Programming Languages",
    description: "Fast, personal refreshers for returning to a language.",
    icon: "⌘",
    type: "language",
    items: [],
  },
  {
    id: "algorithms",
    title: "Algorithms",
    description: "Use cases, reasoning, complexity, and animated visual explanations.",
    icon: "⌬",
    type: "algorithm",
    items: [],
  },
  {
    id: "projects",
    title: "Projects",
    description: "Problems worth remembering, how you solved them, and what you used.",
    icon: "◇",
    type: "project",
    items: [],
  },
];
const CORE_SECTION_IDS = new Set(DEFAULT_SECTIONS.map((section) => section.id));
const LEGACY_ROUTINE_SECTION = {
  id: "personal-routines",
  title: "Personal Routines",
  description: "Saved personal playbooks carried forward from the former Protocols section.",
  icon: "◎",
  type: "routine",
  area: EVERYDAY_AREA,
  items: [],
};

/**
 * Creates a collision-resistant identifier for local records.
 *
 * @returns {string} A browser-generated identifier.
 */
export function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Returns an isolated initial workspace with empty content sections.
 *
 * @returns {{version: number, sections: Array<object>}} A new workspace.
 */
function createInitialWorkspace() {
  return {
    version: CURRENT_WORKSPACE_VERSION,
    sections: DEFAULT_SECTIONS.map((section) => ({ ...section, items: [] })),
  };
}

/**
 * Restores every fixed core library and moves saved Protocol entries into an
 * optional Personal Routines library. Empty legacy Protocols are discarded.
 *
 * @param {{version?: number, sections: Array<object>}} workspace Stored data.
 * @returns {{workspace: object, changed: boolean}} Migrated data and change flag.
 */
function migrateWorkspace(workspace) {
  let changed = false;
  let sections = workspace.sections;

  const legacyProtocolSections = sections.filter((section) => (
    section.id === "protocols" || section.type === "protocol"
  ));
  const existingRoutineSection = sections.find((section) => section.id === LEGACY_ROUTINE_SECTION.id);
  if (legacyProtocolSections.length) {
    const routineItemsById = new Map();
    [existingRoutineSection, ...legacyProtocolSections].filter(Boolean).forEach((section) => {
      (section.items ?? []).forEach((item) => routineItemsById.set(item.id, item));
    });
    sections = sections.filter((section) => (
      section.id !== LEGACY_ROUTINE_SECTION.id
      && section.id !== "protocols"
      && section.type !== "protocol"
    ));
    if (routineItemsById.size) {
      sections.push({
        ...LEGACY_ROUTINE_SECTION,
        ...existingRoutineSection,
        id: LEGACY_ROUTINE_SECTION.id,
        title: LEGACY_ROUTINE_SECTION.title,
        description: LEGACY_ROUTINE_SECTION.description,
        icon: LEGACY_ROUTINE_SECTION.icon,
        type: LEGACY_ROUTINE_SECTION.type,
        area: LEGACY_ROUTINE_SECTION.area,
        items: [...routineItemsById.values()],
      });
    }
    changed = true;
  }

  const shouldRestoreCoreSections = (
    (workspace.version ?? 1) < CURRENT_WORKSPACE_VERSION
    || DEFAULT_SECTIONS.some((section) => !sections.some((candidate) => candidate.id === section.id))
  );
  if (shouldRestoreCoreSections) {
    const existingSections = new Map(sections.map((section) => [section.id, section]));
    const coreSections = DEFAULT_SECTIONS.map((section) => (
      existingSections.has(section.id)
        ? {
          ...section,
          ...existingSections.get(section.id),
          id: section.id,
          type: section.type,
          area: section.area,
        }
        : { ...section, items: [] }
    ));
    const customSections = sections.filter((section) => !CORE_SECTION_IDS.has(section.id));
    workspace.sections = [...coreSections, ...customSections];
    changed = true;
  } else if (changed) {
    workspace.sections = sections;
  }

  if ((workspace.version ?? 1) < CURRENT_WORKSPACE_VERSION) {
    workspace.version = CURRENT_WORKSPACE_VERSION;
    changed = true;
  }
  return { workspace, changed };
}

/**
 * Reports whether a section is one of the permanent libraries.
 *
 * @param {string} sectionId Section identifier.
 * @returns {boolean} Whether the section is permanent.
 */
export function isCoreSectionId(sectionId) {
  return CORE_SECTION_IDS.has(sectionId);
}

/**
 * Parses and validates stored workspace data, falling back safely when corrupt.
 *
 * @returns {{version: number, sections: Array<object>}} Current workspace data.
 */
export function getWorkspace() {
  const storedWorkspace = localStorage.getItem(WORKSPACE_KEY);
  if (!storedWorkspace) {
    const initialWorkspace = createInitialWorkspace();
    // Initialization happens during rendering; avoid a synchronous change event
    // re-entering the interface before that first render has completed.
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(initialWorkspace));
    return initialWorkspace;
  }

  try {
    const parsedWorkspace = JSON.parse(storedWorkspace);
    if (!Array.isArray(parsedWorkspace.sections)) {
      throw new TypeError("Workspace sections are missing.");
    }
    const migration = migrateWorkspace(parsedWorkspace);
    if (migration.changed) {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(migration.workspace));
    }
    return migration.workspace;
  } catch (error) {
    console.error("Unable to read saved workspace; using an empty workspace.", error);
    return createInitialWorkspace();
  }
}

/**
 * Persists the entire workspace atomically and notifies same-page consumers.
 *
 * @param {{version: number, sections: Array<object>}} workspace Workspace to save.
 */
export function saveWorkspace(workspace) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  window.dispatchEvent(new CustomEvent("workspace:changed", { detail: workspace }));
}

/**
 * Permanently removes one legacy custom section and its local entries.
 *
 * @param {string} sectionId Section identifier.
 * @returns {boolean} Whether a matching non-core section was removed.
 */
export function deleteSection(sectionId) {
  if (isCoreSectionId(sectionId)) {
    return false;
  }

  const workspace = getWorkspace();
  const sectionCount = workspace.sections.length;
  workspace.sections = workspace.sections.filter((section) => section.id !== sectionId);
  if (workspace.sections.length === sectionCount) {
    return false;
  }
  saveWorkspace(workspace);
  return true;
}

/**
 * Adds an entry to a section.
 *
 * @param {string} sectionId Parent section identifier.
 * @param {object} itemInput Sanitized form fields.
 * @returns {object|null} The created item or null when the section is absent.
 */
export function addItem(sectionId, itemInput) {
  const workspace = getWorkspace();
  const section = workspace.sections.find((candidate) => candidate.id === sectionId);
  if (!section) {
    return null;
  }

  const item = {
    ...itemInput,
    id: createId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  section.items.push(item);
  saveWorkspace(workspace);
  return item;
}

/**
 * Replaces editable fields on an existing entry while preserving identity.
 *
 * @param {string} sectionId Parent section identifier.
 * @param {string} itemId Entry identifier.
 * @param {object} itemInput Sanitized form fields.
 * @returns {object|null} The updated item or null when it is absent.
 */
export function updateItem(sectionId, itemId, itemInput) {
  const workspace = getWorkspace();
  const section = workspace.sections.find((candidate) => candidate.id === sectionId);
  const itemIndex = section?.items.findIndex((candidate) => candidate.id === itemId) ?? -1;
  if (!section || itemIndex < 0) {
    return null;
  }

  const existingItem = section.items[itemIndex];
  const updatedItem = {
    ...existingItem,
    ...itemInput,
    id: existingItem.id,
    updatedAt: new Date().toISOString(),
  };
  section.items[itemIndex] = updatedItem;
  saveWorkspace(workspace);
  return updatedItem;
}

/**
 * Removes one entry from a section.
 *
 * @param {string} sectionId Parent section identifier.
 * @param {string} itemId Entry identifier.
 * @returns {boolean} Whether the entry was removed.
 */
export function deleteItem(sectionId, itemId) {
  const workspace = getWorkspace();
  const section = workspace.sections.find((candidate) => candidate.id === sectionId);
  if (!section) {
    return false;
  }

  const itemCount = section.items.length;
  section.items = section.items.filter((item) => item.id !== itemId);
  if (section.items.length === itemCount) {
    return false;
  }
  saveWorkspace(workspace);
  return true;
}

/**
 * Performs the deliberately simple local delete-password comparison.
 *
 * @param {string} candidate User-entered password.
 * @returns {boolean} Whether deletion may proceed.
 */
export function isDeletePasswordValid(candidate) {
  return candidate === DELETE_PASSWORD;
}

/**
 * Finds a section by its stable identifier.
 *
 * @param {string} sectionId Section identifier.
 * @returns {object|null} Matching section or null.
 */
export function getSection(sectionId) {
  return getWorkspace().sections.find((section) => section.id === sectionId) ?? null;
}

/**
 * Returns named algorithm records for architecture and project relationships.
 *
 * @returns {Array<{id: string, title: string, sectionId: string}>} Algorithm choices.
 */
export function getAlgorithmOptions() {
  return getWorkspace().sections
    .filter((section) => section.type === "algorithm")
    .flatMap((section) => section.items.map(({ id, title }) => ({
      id,
      title,
      sectionId: section.id,
    })));
}
