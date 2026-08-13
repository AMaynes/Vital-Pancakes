/**
 * Provider-independent AI command adapter for Workspace libraries.
 *
 * Commands operate on a cloned workspace snapshot. Preview never persists, and
 * apply commits the fully validated snapshot once so a failed batch cannot
 * partially change the user's libraries.
 */

import {
  AiCommandError,
  cloneJson,
  isRecord,
} from "./ai-command-protocol.mjs";

const MAXIMUM_CONTEXT_SECTIONS = 50;
const MAXIMUM_SEARCH_RESULTS = 100;
const MAXIMUM_QUERY_LENGTH = 500;
const MAXIMUM_TITLE_LENGTH = 300;
const MAXIMUM_TEXT_LENGTH = 200_000;
const MAXIMUM_LIST_ITEMS = 300;
const MAXIMUM_LIST_ITEM_LENGTH = 20_000;
const MAXIMUM_TAGS = 50;
const MAXIMUM_TAG_LENGTH = 120;
const MAXIMUM_LESSON_SECTIONS = 80;
const MAXIMUM_LESSON_PAIRS = 200;
const MAXIMUM_CITATIONS = 300;
const MAXIMUM_IDENTIFIER_LENGTH = 300;

const BASE_FIELDS = Object.freeze({
  title: field("string", { required: true, maximumLength: MAXIMUM_TITLE_LENGTH }),
  summary: field("string"),
});

const SECTION_SCHEMAS = Object.freeze({
  "cooking-guide": sectionSchema({
    abstract: field("string"),
    content: field("string"),
    definitions: field("string"),
    heat: field("string"),
    signals: field("string"),
    principles: field("string"),
    essentials: field("string"),
    steps: field("string-list"),
    mistakes: field("string"),
    tags: field("tags"),
  }),
  recipe: sectionSchema({
    imageUrl: field("string"),
    calories: field("string"),
    protein: field("string"),
    carbs: field("string"),
    fat: field("string"),
    servings: field("string"),
    timing: field("string"),
    ingredients: field("string-list"),
    equipment: field("string-list"),
    steps: field("string-list"),
    notes: field("string"),
  }),
  workout: sectionSchema({
    category: field("enum", { values: ["push", "pull", "legs"], defaultValue: "push" }),
    goal: field("string"),
    muscleTags: field("tags"),
    animationUrl: field("string"),
    hypertrophyPrescription: field("string"),
    strengthPrescription: field("string"),
    endurancePrescription: field("string"),
    frequency: field("string"),
    duration: field("string"),
    equipment: field("string"),
    exercises: field("string-list"),
    breathing: field("string"),
    squeeze: field("string"),
    progression: field("string"),
    notes: field("string"),
  }),
  cleaning: sectionSchema({
    category: field("enum", { values: ["house", "self-care"], defaultValue: "house" }),
    cardType: field("enum", { values: ["Brief", "Master", "Extended"], defaultValue: "Brief" }),
    zone: field("string"),
    frequency: field("string"),
    supplies: field("string-list"),
    steps: field("string-list"),
    warnings: field("string"),
    notes: field("string"),
    schedule: field("string-list"),
    tags: field("tags", { lowercase: true }),
  }),
  routine: sectionSchema({
    trigger: field("string"),
    steps: field("string-list"),
  }),
  study: sectionSchema({
    format: field("enum", { values: ["lesson"] }),
    lesson: field("lesson"),
    sourceBookId: field("identifier"),
    sourceLessonId: field("identifier"),
    sourceTitle: field("string"),
    sourcePages: field("page-list"),
    abstract: field("string"),
    folderPath: field("string"),
    parentStudyId: field("identifier"),
    projectId: field("identifier"),
    content: field("string"),
    definitions: field("string"),
    notecardLinks: field("string"),
    researchQuestion: field("string"),
    hypothesis: field("string"),
    method: field("string"),
    evidence: field("string-list"),
    findings: field("string"),
    limitations: field("string"),
    nextSteps: field("string"),
    notes: field("string"),
    tags: field("tags"),
  }),
  idea: sectionSchema({
    stage: field("enum", { values: ["Working", "Formed", "Parked"], defaultValue: "Working" }),
    abstract: field("string"),
    folderPath: field("string"),
    thesis: field("string"),
    reasoning: field("string"),
    assumptions: field("string-list"),
    openQuestions: field("string-list"),
    content: field("string"),
    definitions: field("string"),
    linkedStudyIds: field("identifier-list"),
  }),
  language: sectionSchema({
    quickFacts: field("string-list"),
    coreConcepts: field("string-list"),
    syntaxReference: field("string"),
    lessons: field("string-list"),
  }),
  algorithm: sectionSchema({
    category: field("enum", {
      values: ["personal", "traditional", "advanced", "analysis"],
      defaultValue: "personal",
    }),
    purpose: field("string"),
    explanation: field("string"),
    invariant: field("string"),
    keyIdeas: field("string-list"),
    workedExample: field("string"),
    visualFrames: field("string-list"),
    frameExplanations: field("string-list"),
    pseudocode: field("string"),
    complexity: field("string"),
    cCode: field("string"),
    javaCode: field("string"),
    tags: field("tags", { lowercase: true }),
  }),
  project: sectionSchema({
    status: field("enum", {
      values: ["Concept", "Active", "Paused", "Complete", "Archived"],
      defaultValue: "Active",
    }),
    mainIdea: field("string"),
    overview: field("string"),
    projectMap: field("string"),
    studyIds: field("identifier-list"),
    visualFrames: field("string-list"),
    frameExplanations: field("string-list"),
    architecture: field("string"),
    codeMap: field("string-list"),
    specifics: field("string"),
    outcome: field("string"),
    nextStep: field("string"),
    languages: field("string-list"),
    dependencies: field("string-list"),
    algorithmIds: field("identifier-list"),
  }),
  question: sectionSchema({
    kind: field("enum", { values: ["Question", "Idea"], defaultValue: "Question" }),
    status: field("enum", {
      values: ["Open", "Exploring", "Developed", "Resolved", "Parked"],
      defaultValue: "Open",
    }),
    context: field("string"),
    directions: field("string-list"),
    currentPosition: field("string"),
  }),
  custom: sectionSchema({
    notes: field("string"),
    tags: field("tags"),
  }),
});

const COMMAND_DEFINITIONS = Object.freeze([
  command(
    "sections.list",
    ["read-summary"],
    "List bounded section metadata and entry counts.",
    ["area", "sectionType", "limit"],
  ),
  command(
    "entries.search",
    ["read-summary"],
    "Search entries and return bounded title-and-summary records.",
    ["query", "sectionId", "sectionType", "tags", "includeSamples", "limit"],
  ),
  command(
    "entries.get",
    ["read-content"],
    "Read one complete entry by stable section and entry identifiers.",
    ["sectionId", "itemId"],
    ["sectionId", "itemId"],
  ),
  command(
    "entries.create",
    ["create"],
    "Create one validated entry in an existing section.",
    ["sectionId", "item", "clientKey"],
    ["sectionId", "item"],
  ),
  command(
    "entries.update",
    ["update"],
    "Patch allowlisted editable fields on one entry.",
    ["sectionId", "itemId", "clientKey", "patch"],
    ["sectionId", "patch"],
    "Provide exactly one of itemId or a clientKey created earlier in the same batch.",
  ),
  command(
    "entries.delete",
    ["delete"],
    "Delete one explicitly identified entry.",
    ["sectionId", "itemId", "clientKey"],
    ["sectionId"],
    "Provide exactly one of itemId or a clientKey created earlier in the same batch.",
  ),
]);

/**
 * Creates the Workspace adapter from explicit persistence dependencies.
 *
 * `commitWorkspace` must atomically replace the persisted workspace. It is
 * called once per successful mutating envelope and never during preview.
 *
 * @param {object} dependencies Persistence, identifier, and clock functions.
 * @returns {object} Shared-registry-compatible adapter.
 */
export function createWorkspaceAiAdapter(dependencies) {
  validateDependencies(dependencies);
  const now = typeof dependencies.now === "function"
    ? dependencies.now
    : () => new Date().toISOString();

  return {
    id: "workspace",
    title: "Workspace Libraries",
    getRevision: () => calculateWorkspaceRevision(readWorkspace(dependencies)),
    getCapabilities: () => getWorkspaceAiCapabilities(),
    getContext: (options) => serializeWorkspaceContext(readWorkspace(dependencies), options),
    preview: async (envelope) => {
      const sourceWorkspace = readWorkspace(dependencies);
      const execution = executeWorkspaceCommands(sourceWorkspace, envelope, {
        createId: dependencies.createId,
        timestamp: normalizeTimestamp(now()),
      });
      return createExecutionResult(execution, {
        receiptRevision: calculateWorkspaceRevision(sourceWorkspace),
        isPreview: true,
      });
    },
    apply: async (envelope) => {
      const sourceWorkspace = readWorkspace(dependencies);
      const execution = executeWorkspaceCommands(sourceWorkspace, envelope, {
        createId: dependencies.createId,
        timestamp: normalizeTimestamp(now()),
      });
      if (execution.mutated) {
        await dependencies.commitWorkspace(cloneJson(execution.workspace));
      }
      return createExecutionResult(execution, {
        receiptRevision: calculateWorkspaceRevision(execution.workspace),
        isPreview: false,
      });
    },
  };
}

export function getWorkspaceAiCapabilities() {
  return {
    tool: "workspace",
    version: 1,
    commands: cloneJson(COMMAND_DEFINITIONS),
    sectionTypes: Object.fromEntries(
      Object.entries(SECTION_SCHEMAS).map(([sectionType, schema]) => [
        sectionType,
        {
          fields: Object.fromEntries(
            Object.entries(schema.fields).map(([name, definition]) => [
              name,
              {
                kind: definition.kind,
                required: Boolean(definition.required),
                ...(definition.values ? { values: [...definition.values] } : {}),
              },
            ]),
          ),
        },
      ]),
    ),
    limits: {
      maximumCommands: 100,
      maximumSearchResults: MAXIMUM_SEARCH_RESULTS,
      maximumTitleLength: MAXIMUM_TITLE_LENGTH,
      maximumTextLength: MAXIMUM_TEXT_LENGTH,
      maximumListItems: MAXIMUM_LIST_ITEMS,
    },
    examples: [
      {
        name: "Create a study draft",
        command: {
          type: "entries.create",
          sectionId: "studies",
          clientKey: "new-study",
          item: {
            title: "Retrieval practice follow-up",
            summary: "A draft study generated from an open question.",
            abstract: "A foldered follow-up study with an explicit test and reusable definitions.",
            folderPath: "Learning / Memory",
            researchQuestion: "Which retrieval cue produces the strongest delayed recall?",
            content: "::section Background\nDefine the comparison.\n\n::equation Recall score\nR = correct / attempted",
            definitions: "Retrieval cue | Information available when attempting recall |",
            notecardLinks: "Retrieval practice | educational_resources/mathematics/flashcard-practice.html",
            tags: ["memory", "draft"],
          },
        },
      },
      {
        name: "Find active projects",
        command: {
          type: "entries.search",
          sectionId: "projects",
          query: "active",
          limit: 20,
        },
      },
    ],
  };
}

/**
 * Returns storage metadata only; full entry content remains behind
 * `entries.get` and its `read-content` permission.
 *
 * @param {object} sourceWorkspace Workspace snapshot.
 * @param {object} options Optional section filters.
 * @returns {object} Bounded context safe for tool orientation.
 */
export function serializeWorkspaceContext(sourceWorkspace, options = {}) {
  const workspace = normalizeWorkspaceSnapshot(sourceWorkspace);
  const sectionId = normalizeOptionalFilter(options?.sectionId, MAXIMUM_IDENTIFIER_LENGTH);
  const area = normalizeOptionalFilter(options?.area, 80);
  const sectionType = normalizeOptionalFilter(options?.sectionType, 80);
  const limit = clampInteger(options?.limit, 1, MAXIMUM_CONTEXT_SECTIONS, 20);
  const matchingSections = workspace.sections.filter((section) => (
    (!sectionId || section.id === sectionId)
    && (!area || normalizeArea(section) === area)
    && (!sectionType || section.type === sectionType)
  ));
  const sections = matchingSections.slice(0, limit).map(summarizeSection);

  return {
    tool: "workspace",
    revision: calculateWorkspaceRevision(workspace),
    sectionCount: workspace.sections.length,
    itemCount: workspace.sections.reduce(
      (total, section) => total + section.items.length,
      0,
    ),
    sections,
    omittedSectionCount: Math.max(0, matchingSections.length - sections.length),
    entryContentIncluded: false,
  };
}

/**
 * Produces a deterministic optimistic-concurrency revision from persisted
 * content, including changes made through the ordinary Workspace interface.
 *
 * @param {object} workspace Workspace snapshot.
 * @returns {number} Non-negative safe integer.
 */
export function calculateWorkspaceRevision(workspace) {
  const serialized = JSON.stringify(workspace);
  let low = 0x811c9dc5;
  let high = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const codeUnit = serialized.charCodeAt(index);
    low = Math.imul(low ^ codeUnit, 0x01000193);
    high = Math.imul(high ^ codeUnit, 0x5bd1e995);
  }
  return ((high >>> 0) & 0x1fffff) * 0x1_0000_0000 + (low >>> 0);
}

function executeWorkspaceCommands(sourceWorkspace, envelope, options) {
  const workspace = normalizeWorkspaceSnapshot(sourceWorkspace);
  const initialIds = new Set(
    workspace.sections.flatMap((section) => section.items.map((item) => item.id)),
  );
  const runtime = {
    workspace,
    createId: options.createId,
    timestamp: options.timestamp,
    initialIds,
    clientKeyMap: new Map(),
    createdIds: [],
    updatedIds: new Set(),
    deletedIds: new Set(),
    operations: [],
    mutated: false,
  };

  envelope.commands.forEach((commandValue, commandIndex) => {
    try {
      executeWorkspaceCommand(runtime, commandValue, commandIndex);
    } catch (error) {
      if (error instanceof AiCommandError && error.commandIndex === null) {
        error.commandIndex = commandIndex;
        error.path ??= `$.commands[${commandIndex}]`;
      }
      throw error;
    }
  });

  return {
    workspace: runtime.workspace,
    mutated: runtime.mutated,
    operations: runtime.operations,
    createdIds: runtime.createdIds,
    updatedIds: [...runtime.updatedIds].filter((id) => (
      runtime.initialIds.has(id) && !runtime.deletedIds.has(id)
    )),
    deletedIds: [...runtime.deletedIds],
    clientKeyMap: Object.fromEntries(
      [...runtime.clientKeyMap].map(([key, reference]) => [key, reference.itemId]),
    ),
  };
}

function executeWorkspaceCommand(runtime, commandValue, commandIndex) {
  if (!isRecord(commandValue)) {
    throw commandError("A Workspace command must be a JSON object.", "invalid-command", commandIndex);
  }
  const command = cloneJson(commandValue);
  switch (command.type) {
    case "sections.list":
      listSections(runtime, command, commandIndex);
      break;
    case "entries.search":
      searchEntries(runtime, command, commandIndex);
      break;
    case "entries.get":
      getEntry(runtime, command, commandIndex);
      break;
    case "entries.create":
      createEntry(runtime, command, commandIndex);
      break;
    case "entries.update":
      updateEntry(runtime, command, commandIndex);
      break;
    case "entries.delete":
      deleteEntry(runtime, command, commandIndex);
      break;
    default:
      throw commandError(
        `Unsupported Workspace command: ${command.type}.`,
        "unsupported-command",
        commandIndex,
      );
  }
}

function listSections(runtime, command, commandIndex) {
  assertCommandFields(command, ["type", "area", "sectionType", "limit"], commandIndex);
  const area = normalizeOptionalFilter(command.area, 80, commandIndex);
  const sectionType = normalizeOptionalFilter(command.sectionType, 80, commandIndex);
  const limit = clampInteger(command.limit, 1, MAXIMUM_CONTEXT_SECTIONS, 20, commandIndex);
  const matches = runtime.workspace.sections.filter((section) => (
    (!area || normalizeArea(section) === area)
    && (!sectionType || section.type === sectionType)
  ));
  runtime.operations.push({
    commandIndex,
    type: command.type,
    result: {
      sections: matches.slice(0, limit).map(summarizeSection),
      totalMatches: matches.length,
      omittedCount: Math.max(0, matches.length - limit),
    },
  });
}

function searchEntries(runtime, command, commandIndex) {
  assertCommandFields(command, [
    "type",
    "query",
    "sectionId",
    "sectionType",
    "tags",
    "includeSamples",
    "limit",
  ], commandIndex);
  const query = normalizeOptionalFilter(command.query, MAXIMUM_QUERY_LENGTH, commandIndex)
    .toLocaleLowerCase();
  const sectionId = normalizeOptionalFilter(command.sectionId, MAXIMUM_IDENTIFIER_LENGTH, commandIndex);
  const sectionType = normalizeOptionalFilter(command.sectionType, 80, commandIndex);
  const tags = command.tags === undefined
    ? []
    : normalizeStringList(command.tags, {
      fieldName: "tags",
      maximumItems: MAXIMUM_TAGS,
      maximumLength: MAXIMUM_TAG_LENGTH,
      lowercase: true,
      commandIndex,
    });
  const includeSamples = command.includeSamples === undefined
    ? true
    : normalizeBoolean(command.includeSamples, "includeSamples", commandIndex);
  const limit = clampInteger(command.limit, 1, MAXIMUM_SEARCH_RESULTS, 25, commandIndex);
  const matches = [];

  runtime.workspace.sections.forEach((section) => {
    if (sectionId && section.id !== sectionId) return;
    if (sectionType && section.type !== sectionType) return;
    section.items.forEach((item) => {
      if (!includeSamples && item.isSample) return;
      const itemTags = Array.isArray(item.tags)
        ? item.tags.map((tag) => String(tag).trim().toLocaleLowerCase())
        : [];
      if (tags.some((tag) => !itemTags.includes(tag))) return;
      if (query && !JSON.stringify(item).toLocaleLowerCase().includes(query)) return;
      matches.push(summarizeEntry(section, item));
    });
  });

  runtime.operations.push({
    commandIndex,
    type: command.type,
    result: {
      entries: matches.slice(0, limit),
      totalMatches: matches.length,
      omittedCount: Math.max(0, matches.length - limit),
    },
  });
}

function getEntry(runtime, command, commandIndex) {
  assertCommandFields(command, ["type", "sectionId", "itemId"], commandIndex);
  const section = requireSection(runtime.workspace, command.sectionId, commandIndex);
  const itemId = normalizeRequiredIdentifier(command.itemId, "itemId", commandIndex);
  const item = section.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw commandError(`Entry ${itemId} does not exist in ${section.id}.`, "entry-not-found", commandIndex);
  }
  runtime.operations.push({
    commandIndex,
    type: command.type,
    result: {
      section: summarizeSection(section),
      entry: cloneJson(item),
    },
  });
}

function createEntry(runtime, command, commandIndex) {
  assertCommandFields(command, ["type", "sectionId", "item", "clientKey"], commandIndex);
  const section = requireSection(runtime.workspace, command.sectionId, commandIndex);
  const clientKey = normalizeClientKey(command.clientKey, runtime, commandIndex);
  const itemFields = normalizeEntryFields({
    section,
    workspace: runtime.workspace,
    value: command.item,
    existingItem: null,
    commandIndex,
  });
  const itemId = createUniqueItemId(runtime, commandIndex);
  const item = {
    ...itemFields,
    id: itemId,
    createdAt: runtime.timestamp,
    updatedAt: runtime.timestamp,
  };
  section.items.push(item);
  runtime.createdIds.push(itemId);
  runtime.mutated = true;
  if (clientKey) {
    runtime.clientKeyMap.set(clientKey, { sectionId: section.id, itemId });
  }
  runtime.operations.push({
    commandIndex,
    type: command.type,
    result: { sectionId: section.id, itemId, clientKey },
  });
}

function updateEntry(runtime, command, commandIndex) {
  assertCommandFields(command, [
    "type",
    "sectionId",
    "itemId",
    "clientKey",
    "patch",
  ], commandIndex);
  const section = requireSection(runtime.workspace, command.sectionId, commandIndex);
  const reference = resolveEntryReference(runtime, section, command, commandIndex);
  const itemIndex = section.items.findIndex((item) => item.id === reference.itemId);
  if (itemIndex < 0) {
    throw commandError(
      `Entry ${reference.itemId} does not exist in ${section.id}.`,
      "entry-not-found",
      commandIndex,
    );
  }
  if (!isRecord(command.patch) || Object.keys(command.patch).length === 0) {
    throw commandError("entries.update requires a non-empty patch.", "invalid-patch", commandIndex);
  }
  const existingItem = section.items[itemIndex];
  const patch = normalizeEntryFields({
    section,
    workspace: runtime.workspace,
    value: command.patch,
    existingItem,
    commandIndex,
  });
  section.items[itemIndex] = {
    ...existingItem,
    ...patch,
    id: existingItem.id,
    updatedAt: runtime.timestamp,
  };
  runtime.updatedIds.add(existingItem.id);
  runtime.mutated = true;
  runtime.operations.push({
    commandIndex,
    type: command.type,
    result: {
      sectionId: section.id,
      itemId: existingItem.id,
      changedFields: Object.keys(patch),
    },
  });
}

function deleteEntry(runtime, command, commandIndex) {
  assertCommandFields(command, [
    "type",
    "sectionId",
    "itemId",
    "clientKey",
  ], commandIndex);
  const section = requireSection(runtime.workspace, command.sectionId, commandIndex);
  const reference = resolveEntryReference(runtime, section, command, commandIndex);
  const itemIndex = section.items.findIndex((item) => item.id === reference.itemId);
  if (itemIndex < 0) {
    throw commandError(
      `Entry ${reference.itemId} does not exist in ${section.id}.`,
      "entry-not-found",
      commandIndex,
    );
  }
  section.items.splice(itemIndex, 1);
  runtime.deletedIds.add(reference.itemId);
  runtime.mutated = true;
  runtime.operations.push({
    commandIndex,
    type: command.type,
    result: { sectionId: section.id, itemId: reference.itemId },
  });
}

function normalizeEntryFields({
  section,
  workspace,
  value,
  existingItem,
  commandIndex,
}) {
  if (!isRecord(value)) {
    throw commandError("Entry fields must be a JSON object.", "invalid-entry", commandIndex);
  }
  const schema = SECTION_SCHEMAS[section.type] ?? SECTION_SCHEMAS.custom;
  const unknownField = Object.keys(value).find((name) => !schema.fields[name]);
  if (unknownField) {
    throw commandError(
      `Unsupported ${section.type} field: ${unknownField}.`,
      "unsupported-entry-field",
      commandIndex,
      `$.commands[${commandIndex}].${existingItem ? "patch" : "item"}.${unknownField}`,
    );
  }

  const normalized = {};
  Object.entries(value).forEach(([name, fieldValue]) => {
    normalized[name] = normalizeFieldValue(
      name,
      fieldValue,
      schema.fields[name],
      commandIndex,
    );
  });
  if (!existingItem) {
    Object.entries(schema.fields).forEach(([name, definition]) => {
      if (normalized[name] === undefined && definition.defaultValue !== undefined) {
        normalized[name] = cloneJson(definition.defaultValue);
      }
    });
  }

  const complete = { ...(existingItem ?? {}), ...normalized };
  if (complete.format === "lesson") {
    if (!isRecord(complete.lesson)) {
      throw commandError(
        "A lesson-format Study requires a lesson object.",
        "invalid-lesson",
        commandIndex,
      );
    }
    if (normalized.lesson || !existingItem) {
      normalized.lesson = normalizeLesson(complete.lesson, commandIndex);
      complete.lesson = normalized.lesson;
      if (value.title === undefined && !complete.title) {
        normalized.title = complete.lesson.title;
        complete.title = normalized.title;
      }
      if (value.summary === undefined && !complete.summary) {
        normalized.summary = complete.lesson.overview || complete.lesson.recap;
        complete.summary = normalized.summary;
      }
      if (value.sourceTitle === undefined) {
        normalized.sourceTitle = complete.lesson.sourceTitle;
      }
      if (value.sourcePages === undefined) {
        normalized.sourcePages = [...complete.lesson.sourcePages];
      }
    }
  } else if (value.lesson !== undefined) {
    throw commandError(
      'Set format to "lesson" when providing lesson content.',
      "invalid-study-format",
      commandIndex,
    );
  }

  if (typeof complete.title !== "string" || !complete.title.trim()) {
    throw commandError("Every Workspace entry needs a title.", "missing-title", commandIndex);
  }
  if (normalized.algorithmIds) {
    validateAlgorithmReferences(workspace, normalized.algorithmIds, commandIndex);
  }
  if (normalized.studyIds || normalized.linkedStudyIds || normalized.parentStudyId) {
    validateStudyReferences(workspace, [
      ...(normalized.studyIds ?? []),
      ...(normalized.linkedStudyIds ?? []),
      ...(normalized.parentStudyId ? [normalized.parentStudyId] : []),
    ], commandIndex);
  }
  return normalized;
}

function normalizeFieldValue(name, value, definition, commandIndex) {
  switch (definition.kind) {
    case "string":
      return normalizeText(value, name, definition.maximumLength, commandIndex);
    case "identifier":
      return normalizeText(value, name, MAXIMUM_IDENTIFIER_LENGTH, commandIndex);
    case "enum":
      if (!definition.values.includes(value)) {
        throw commandError(
          `${name} must be one of: ${definition.values.join(", ")}.`,
          "invalid-entry-field",
          commandIndex,
        );
      }
      return value;
    case "string-list":
      return normalizeStringList(value, { fieldName: name, commandIndex });
    case "identifier-list":
      return normalizeStringList(value, {
        fieldName: name,
        maximumLength: MAXIMUM_IDENTIFIER_LENGTH,
        commandIndex,
      });
    case "tags":
      return normalizeStringList(value, {
        fieldName: name,
        maximumItems: MAXIMUM_TAGS,
        maximumLength: MAXIMUM_TAG_LENGTH,
        lowercase: definition.lowercase,
        unique: true,
        commandIndex,
      });
    case "page-list":
      return normalizePageList(value, name, commandIndex);
    case "lesson":
      return normalizeLesson(value, commandIndex);
    default:
      throw commandError(`Unsupported field rule for ${name}.`, "invalid-entry-field", commandIndex);
  }
}

function normalizeLesson(value, commandIndex) {
  if (!isRecord(value)) {
    throw commandError("lesson must be a JSON object.", "invalid-lesson", commandIndex);
  }
  const allowedFields = new Set([
    "title",
    "subtitle",
    "sourceTitle",
    "chapter",
    "subchapter",
    "overview",
    "learningObjectives",
    "prerequisites",
    "keyConcepts",
    "sections",
    "workedExamples",
    "commonMisconceptions",
    "reviewQuestions",
    "flashcards",
    "recap",
    "sourcePages",
  ]);
  const unknownField = Object.keys(value).find((name) => !allowedFields.has(name));
  if (unknownField) {
    throw commandError(
      `Unsupported lesson field: ${unknownField}.`,
      "unsupported-lesson-field",
      commandIndex,
    );
  }
  const lesson = {
    title: normalizeText(value.title ?? "Untitled lesson", "lesson.title", MAXIMUM_TITLE_LENGTH, commandIndex),
    subtitle: normalizeText(value.subtitle ?? "", "lesson.subtitle", MAXIMUM_TEXT_LENGTH, commandIndex),
    sourceTitle: normalizeText(value.sourceTitle ?? "", "lesson.sourceTitle", MAXIMUM_TEXT_LENGTH, commandIndex),
    chapter: normalizeText(value.chapter ?? "", "lesson.chapter", MAXIMUM_TEXT_LENGTH, commandIndex),
    subchapter: normalizeText(value.subchapter ?? "", "lesson.subchapter", MAXIMUM_TEXT_LENGTH, commandIndex),
    overview: normalizeText(value.overview ?? "", "lesson.overview", MAXIMUM_TEXT_LENGTH, commandIndex),
    learningObjectives: normalizeStringList(value.learningObjectives ?? [], {
      fieldName: "lesson.learningObjectives",
      commandIndex,
    }),
    prerequisites: normalizeStringList(value.prerequisites ?? [], {
      fieldName: "lesson.prerequisites",
      commandIndex,
    }),
    keyConcepts: normalizeLessonPairs(
      value.keyConcepts,
      ["term", "explanation"],
      "lesson.keyConcepts",
      commandIndex,
    ),
    sections: normalizeLessonSections(value.sections, commandIndex),
    workedExamples: normalizeStringList(value.workedExamples ?? [], {
      fieldName: "lesson.workedExamples",
      commandIndex,
    }),
    commonMisconceptions: normalizeStringList(value.commonMisconceptions ?? [], {
      fieldName: "lesson.commonMisconceptions",
      commandIndex,
    }),
    reviewQuestions: normalizeStringList(value.reviewQuestions ?? [], {
      fieldName: "lesson.reviewQuestions",
      commandIndex,
    }),
    flashcards: normalizeLessonPairs(
      value.flashcards,
      ["question", "answer"],
      "lesson.flashcards",
      commandIndex,
    ),
    recap: normalizeText(value.recap ?? "", "lesson.recap", MAXIMUM_TEXT_LENGTH, commandIndex),
    sourcePages: normalizePageList(value.sourcePages ?? [], "lesson.sourcePages", commandIndex),
  };
  if (!lesson.title) {
    throw commandError("A lesson needs a title.", "missing-title", commandIndex);
  }
  return lesson;
}

function normalizeLessonPairs(value = [], keys, fieldName, commandIndex) {
  if (!Array.isArray(value) || value.length > MAXIMUM_LESSON_PAIRS) {
    throw commandError(
      `${fieldName} must be an array with at most ${MAXIMUM_LESSON_PAIRS} items.`,
      "invalid-lesson",
      commandIndex,
    );
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw commandError(`${fieldName}[${index}] must be an object.`, "invalid-lesson", commandIndex);
    }
    const unknownField = Object.keys(entry).find((name) => !keys.includes(name));
    if (unknownField) {
      throw commandError(
        `Unsupported ${fieldName} field: ${unknownField}.`,
        "unsupported-lesson-field",
        commandIndex,
      );
    }
    return Object.fromEntries(keys.map((key) => [
      key,
      normalizeText(entry[key] ?? "", `${fieldName}.${key}`, MAXIMUM_TEXT_LENGTH, commandIndex),
    ]));
  });
}

function normalizeLessonSections(value = [], commandIndex) {
  if (!Array.isArray(value) || value.length > MAXIMUM_LESSON_SECTIONS) {
    throw commandError(
      `lesson.sections must contain at most ${MAXIMUM_LESSON_SECTIONS} sections.`,
      "invalid-lesson",
      commandIndex,
    );
  }
  return value.map((section, sectionIndex) => {
    if (!isRecord(section)) {
      throw commandError(
        `lesson.sections[${sectionIndex}] must be an object.`,
        "invalid-lesson",
        commandIndex,
      );
    }
    const unknownField = Object.keys(section)
      .find((name) => !["heading", "content", "citations"].includes(name));
    if (unknownField) {
      throw commandError(
        `Unsupported lesson section field: ${unknownField}.`,
        "unsupported-lesson-field",
        commandIndex,
      );
    }
    const citations = Array.isArray(section.citations) ? section.citations : [];
    if (citations.length > MAXIMUM_CITATIONS) {
      throw commandError("A lesson section has too many citations.", "invalid-lesson", commandIndex);
    }
    return {
      heading: normalizeText(
        section.heading ?? `Lesson section ${sectionIndex + 1}`,
        "lesson.sections.heading",
        MAXIMUM_TITLE_LENGTH,
        commandIndex,
      ),
      content: normalizeText(
        section.content ?? "",
        "lesson.sections.content",
        MAXIMUM_TEXT_LENGTH,
        commandIndex,
      ),
      citations: citations.map((citation, citationIndex) => (
        normalizeCitation(citation, sectionIndex, citationIndex, commandIndex)
      )),
    };
  });
}

function normalizeCitation(value, sectionIndex, citationIndex, commandIndex) {
  if (!isRecord(value)) {
    throw commandError(
      `lesson.sections[${sectionIndex}].citations[${citationIndex}] must be an object.`,
      "invalid-lesson",
      commandIndex,
    );
  }
  const unknownField = Object.keys(value).find((name) => !["page", "chunkId"].includes(name));
  if (unknownField) {
    throw commandError(
      `Unsupported citation field: ${unknownField}.`,
      "unsupported-lesson-field",
      commandIndex,
    );
  }
  const page = Number(value.page);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw commandError("Citation pages must be positive integers.", "invalid-lesson", commandIndex);
  }
  return {
    page,
    chunkId: normalizeText(
      value.chunkId ?? "",
      "citation.chunkId",
      MAXIMUM_IDENTIFIER_LENGTH,
      commandIndex,
    ),
  };
}

function validateAlgorithmReferences(workspace, algorithmIds, commandIndex) {
  const availableIds = new Set(
    workspace.sections
      .filter((section) => section.type === "algorithm")
      .flatMap((section) => section.items)
      .filter((item) => item.category !== "analysis")
      .map((item) => item.id),
  );
  const missing = algorithmIds.find((algorithmId) => !availableIds.has(algorithmId));
  if (missing) {
    throw commandError(
      `Project relationship references an unavailable algorithm: ${missing}.`,
      "invalid-algorithm-reference",
      commandIndex,
    );
  }
}

function validateStudyReferences(workspace, studyIds, commandIndex) {
  const availableIds = new Set(
    workspace.sections
      .filter((section) => section.type === "study")
      .flatMap((section) => section.items.map((item) => item.id)),
  );
  const missing = studyIds.find((studyId) => studyId && !availableIds.has(studyId));
  if (missing) {
    throw commandError(
      `Study relationship references an unavailable study: ${missing}.`,
      "invalid-study-reference",
      commandIndex,
    );
  }
}

function createExecutionResult(execution, { receiptRevision, isPreview }) {
  const warnings = isPreview && execution.createdIds.length
    ? ["Preview identifiers are provisional; use clientKey references within a batch."]
    : [];
  return {
    revision: receiptRevision,
    createdIds: execution.createdIds,
    updatedIds: execution.updatedIds,
    deletedIds: execution.deletedIds,
    clientKeyMap: execution.clientKeyMap,
    warnings,
    result: {
      summary: {
        commandCount: execution.operations.length,
        createdCount: execution.createdIds.length,
        updatedCount: execution.updatedIds.length,
        deletedCount: execution.deletedIds.length,
        wouldPersist: execution.mutated,
      },
      operations: execution.operations,
      resultingRevision: calculateWorkspaceRevision(execution.workspace),
    },
  };
}

function readWorkspace(dependencies) {
  return normalizeWorkspaceSnapshot(dependencies.readWorkspace());
}

function normalizeWorkspaceSnapshot(value) {
  if (!isRecord(value) || !Array.isArray(value.sections)) {
    throw new AiCommandError("Workspace storage is unavailable or malformed.", {
      code: "invalid-workspace",
      recoverable: false,
    });
  }
  const workspace = cloneJson(value);
  workspace.sections.forEach((section, sectionIndex) => {
    if (
      !isRecord(section)
      || typeof section.id !== "string"
      || !section.id
      || typeof section.type !== "string"
      || !Array.isArray(section.items)
    ) {
      throw new AiCommandError(`Workspace section ${sectionIndex} is malformed.`, {
        code: "invalid-workspace",
        recoverable: false,
      });
    }
    section.items.forEach((item, itemIndex) => {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id) {
        throw new AiCommandError(
          `Workspace entry ${sectionIndex}:${itemIndex} is malformed.`,
          { code: "invalid-workspace", recoverable: false },
        );
      }
    });
  });
  return workspace;
}

function requireSection(workspace, value, commandIndex) {
  const sectionId = normalizeRequiredIdentifier(value, "sectionId", commandIndex);
  const section = workspace.sections.find((candidate) => candidate.id === sectionId);
  if (!section) {
    throw commandError(`Workspace section ${sectionId} does not exist.`, "section-not-found", commandIndex);
  }
  return section;
}

function resolveEntryReference(runtime, section, command, commandIndex) {
  const hasItemId = command.itemId !== undefined;
  const hasClientKey = command.clientKey !== undefined;
  if (hasItemId === hasClientKey) {
    throw commandError(
      "Specify exactly one of itemId or clientKey.",
      "invalid-entry-reference",
      commandIndex,
    );
  }
  if (hasItemId) {
    return {
      sectionId: section.id,
      itemId: normalizeRequiredIdentifier(command.itemId, "itemId", commandIndex),
    };
  }
  const clientKey = normalizeRequiredIdentifier(command.clientKey, "clientKey", commandIndex);
  const reference = runtime.clientKeyMap.get(clientKey);
  if (!reference) {
    throw commandError(`Unknown clientKey: ${clientKey}.`, "unknown-client-key", commandIndex);
  }
  if (reference.sectionId !== section.id) {
    throw commandError(
      `clientKey ${clientKey} belongs to ${reference.sectionId}, not ${section.id}.`,
      "entry-section-mismatch",
      commandIndex,
    );
  }
  return reference;
}

function normalizeClientKey(value, runtime, commandIndex) {
  if (value === undefined) return null;
  const clientKey = normalizeRequiredIdentifier(value, "clientKey", commandIndex);
  if (runtime.clientKeyMap.has(clientKey)) {
    throw commandError(`Duplicate clientKey: ${clientKey}.`, "duplicate-client-key", commandIndex);
  }
  return clientKey;
}

function createUniqueItemId(runtime, commandIndex) {
  const existingIds = new Set(
    runtime.workspace.sections.flatMap((section) => section.items.map((item) => item.id)),
  );
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const itemId = normalizeRequiredIdentifier(runtime.createId(), "generated itemId", commandIndex);
    if (!existingIds.has(itemId)) return itemId;
  }
  throw commandError(
    "Unable to generate a unique Workspace entry identifier.",
    "identifier-collision",
    commandIndex,
  );
}

function summarizeSection(section) {
  return {
    id: section.id,
    title: String(section.title ?? section.id),
    type: section.type,
    area: normalizeArea(section),
    itemCount: section.items.length,
  };
}

function summarizeEntry(section, item) {
  return {
    id: item.id,
    sectionId: section.id,
    sectionType: section.type,
    title: String(item.title ?? ""),
    summary: String(item.summary ?? ""),
    tags: Array.isArray(item.tags)
      ? item.tags.map(String).slice(0, MAXIMUM_TAGS)
      : [],
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
    isSample: Boolean(item.isSample),
  };
}

function normalizeArea(section) {
  return section.area === "everyday" ? "everyday" : "studies";
}

function normalizeText(value, fieldName, maximumLength = MAXIMUM_TEXT_LENGTH, commandIndex = null) {
  if (typeof value !== "string") {
    throw commandError(`${fieldName} must be text.`, "invalid-entry-field", commandIndex);
  }
  const normalized = value.replace(/\u0000/g, "").trim();
  if (normalized.length > maximumLength) {
    throw commandError(
      `${fieldName} exceeds ${maximumLength} characters.`,
      "entry-field-too-large",
      commandIndex,
    );
  }
  return normalized;
}

function normalizeStringList(value, options) {
  const {
    fieldName,
    maximumItems = MAXIMUM_LIST_ITEMS,
    maximumLength = MAXIMUM_LIST_ITEM_LENGTH,
    lowercase = false,
    unique = false,
    commandIndex = null,
  } = options;
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw commandError(
      `${fieldName} must be an array with at most ${maximumItems} items.`,
      "invalid-entry-field",
      commandIndex,
    );
  }
  const normalized = value.map((entry, index) => {
    const item = normalizeText(
      entry,
      `${fieldName}[${index}]`,
      maximumLength,
      commandIndex,
    );
    return lowercase ? item.toLocaleLowerCase() : item;
  }).filter(Boolean);
  return unique ? [...new Set(normalized)] : normalized;
}

function normalizePageList(value, fieldName, commandIndex) {
  if (!Array.isArray(value) || value.length > MAXIMUM_LIST_ITEMS) {
    throw commandError(
      `${fieldName} must be an array with at most ${MAXIMUM_LIST_ITEMS} pages.`,
      "invalid-entry-field",
      commandIndex,
    );
  }
  const pages = value.map(Number);
  if (pages.some((page) => !Number.isSafeInteger(page) || page < 1)) {
    throw commandError(
      `${fieldName} may contain only positive integer page numbers.`,
      "invalid-entry-field",
      commandIndex,
    );
  }
  return [...new Set(pages)].sort((left, right) => left - right);
}

function normalizeBoolean(value, fieldName, commandIndex) {
  if (typeof value !== "boolean") {
    throw commandError(`${fieldName} must be true or false.`, "invalid-command-field", commandIndex);
  }
  return value;
}

function normalizeRequiredIdentifier(value, fieldName, commandIndex) {
  const identifier = normalizeText(
    value,
    fieldName,
    MAXIMUM_IDENTIFIER_LENGTH,
    commandIndex,
  );
  if (!identifier || !/^[a-zA-Z0-9._:/-]+$/.test(identifier)) {
    throw commandError(
      `${fieldName} must be a non-empty identifier.`,
      "invalid-identifier",
      commandIndex,
    );
  }
  return identifier;
}

function normalizeOptionalFilter(value, maximumLength, commandIndex = null) {
  if (value === undefined || value === null || value === "") return "";
  return normalizeText(value, "filter", maximumLength, commandIndex);
}

function normalizeTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("The Workspace AI adapter clock returned an invalid time.");
  }
  return date.toISOString();
}

function clampInteger(value, minimum, maximum, fallback, commandIndex = null) {
  if (value === undefined) return fallback;
  const numericValue = Number(value);
  if (!Number.isSafeInteger(numericValue) || numericValue < minimum || numericValue > maximum) {
    throw commandError(
      `limit must be an integer from ${minimum} to ${maximum}.`,
      "invalid-limit",
      commandIndex,
    );
  }
  return numericValue;
}

function assertCommandFields(commandValue, allowedFields, commandIndex) {
  const allowed = new Set(allowedFields);
  const unknownField = Object.keys(commandValue).find((fieldName) => !allowed.has(fieldName));
  if (unknownField) {
    throw commandError(
      `Unsupported ${commandValue.type} field: ${unknownField}.`,
      "unsupported-command-field",
      commandIndex,
      `$.commands[${commandIndex}].${unknownField}`,
    );
  }
}

function command(
  type,
  permissions,
  description,
  fields,
  requiredFields = [],
  constraint = null,
) {
  return Object.freeze({
    type,
    permissions: Object.freeze([...permissions]),
    description,
    fields: Object.freeze([...fields]),
    requiredFields: Object.freeze([...requiredFields]),
    ...(constraint ? { constraint } : {}),
  });
}

function field(kind, options = {}) {
  return Object.freeze({ kind, ...options });
}

function sectionSchema(fields) {
  return Object.freeze({
    fields: Object.freeze({ ...BASE_FIELDS, ...fields }),
  });
}

function validateDependencies(dependencies) {
  if (!isRecord(dependencies)) {
    throw new TypeError("Workspace AI adapter dependencies must be an object.");
  }
  ["readWorkspace", "commitWorkspace", "createId"].forEach((name) => {
    if (typeof dependencies[name] !== "function") {
      throw new TypeError(`Workspace AI adapter requires ${name}().`);
    }
  });
}

function commandError(message, code, commandIndex, path = null) {
  return new AiCommandError(message, {
    code,
    commandIndex: Number.isInteger(commandIndex) ? commandIndex : null,
    path,
  });
}
