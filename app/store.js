/**
 * Overview & Purpose
 * Owns the local-first workspace data model and all persistence mutations.
 *
 * Architectural Relationships
 * Called by: The workspace dashboard and Software Architect.
 * Calls: Browser localStorage and workspace change events.
 *
 * External Resources
 * localStorage key "artificially-neuroscience-workspace-v1".
 *
 * Notes
 * State is intentionally device-local.
 */

const WORKSPACE_KEY = "artificially-neuroscience-workspace-v1";
const CURRENT_WORKSPACE_VERSION = 7;
const EVERYDAY_AREA = "everyday";
const SAMPLE_DATE = "2026-07-28T12:00:00.000Z";

/**
 * Marks a deterministic, fully editable starter entry.
 *
 * @param {string} id Stable sample identifier.
 * @param {object} fields Subject-specific entry fields.
 * @returns {object} Starter entry.
 */
function createSample(id, fields) {
  return {
    id,
    isSample: true,
    createdAt: SAMPLE_DATE,
    updatedAt: SAMPLE_DATE,
    ...fields,
  };
}

const DEFAULT_SECTIONS = [
  {
    id: "how-to-cook",
    title: "How to Cook",
    description: "Techniques, methods, tools, and repeatable steps for becoming a capable cook.",
    icon: "⌁",
    type: "cooking-guide",
    area: EVERYDAY_AREA,
    items: [
      createSample("sample-cook-browning", {
        title: "Control heat and build a real sear",
        summary: "Use surface dryness, pan temperature, and patience to create browning instead of steaming.",
        heat: "Medium-high to start; reduce when the fond turns deep brown rather than black.",
        signals: "A steady sizzle, food releasing cleanly, and a toasted—not acrid—smell.",
        principles: "Browning needs a dry surface, enough stored heat, direct contact, and room for steam to escape. Color is information: pale means more heat or time; black specks mean pull back.",
        essentials: "Heavy skillet, neutral high-heat oil, paper towel, tongs, and enough space to avoid crowding.",
        steps: [
          "Pat the ingredient thoroughly dry and season just before cooking.",
          "Preheat the empty pan until a water droplet skitters, then add a thin film of oil.",
          "Lay food away from you and leave space between pieces.",
          "Do not move it until the edge is visibly browned and it releases with little resistance.",
          "Flip once, lower the heat if the fond darkens too quickly, and finish to the correct internal temperature.",
        ],
        mistakes: "Crowding traps steam; moving too early tears the crust; adding wet marinades at the start burns their sugars before the center cooks.",
      }),
      createSample("sample-cook-pan-sauce", {
        title: "Turn fond into a pan sauce",
        summary: "Convert the browned layer left after searing into a balanced sauce in the same pan.",
        heat: "Medium after the protein leaves the pan; low while finishing with butter.",
        signals: "The liquid loosens the fond, reduces to a glossy film, and coats the back of a spoon.",
        principles: "Fond is concentrated flavor. Deglazing dissolves it, reduction concentrates it, and cold fat emulsifies it into a smooth finish.",
        essentials: "Aromatic, 120–180 ml stock or wine, wooden spoon, acid, and 1–2 tablespoons cold butter.",
        steps: [
          "Remove the cooked protein and pour off excess fat, leaving the browned fond.",
          "Soften a minced shallot or garlic for 30–60 seconds.",
          "Add wine or stock and scrape every browned patch into the liquid.",
          "Reduce until the liquid coats a spoon instead of running like water.",
          "Turn off the heat; whisk in cold butter and adjust with salt and a small amount of acid.",
        ],
        mistakes: "Black fond tastes burnt and cannot be rescued. Boiling after adding butter breaks the emulsion. Season only after reducing because salt concentrates.",
      }),
    ],
  },
  {
    id: "recipes",
    title: "Recipes",
    description: "Ingredients, timing, method, and practical notes for meals worth making again.",
    icon: "◫",
    type: "recipe",
    area: EVERYDAY_AREA,
    items: [
      createSample("sample-recipe-tomato-pasta", {
        title: "Weeknight tomato pasta",
        summary: "A fast pantry pasta built around properly reduced tomato and starchy pasta water.",
        servings: "2 generous servings",
        timing: "10 min prep · 25 min cook",
        ingredients: [
          "200 g spaghetti or rigatoni",
          "2 tbsp olive oil",
          "3 garlic cloves, thinly sliced",
          "400 g canned whole tomatoes, crushed by hand",
          "½ tsp chili flakes",
          "25 g finely grated parmesan",
          "Salt, black pepper, and a small handful of basil",
        ],
        steps: [
          "Bring well-salted water to a boil and begin the pasta.",
          "Bloom garlic and chili flakes in olive oil over medium-low heat without browning the garlic.",
          "Add tomatoes; simmer hard enough to reduce until the oil begins to reappear at the edges.",
          "Move pasta to the sauce two minutes before al dente with 120 ml pasta water.",
          "Toss vigorously until glossy, then finish off heat with parmesan, basil, and black pepper.",
        ],
        notes: "If the sauce looks watery, keep tossing over heat. If it looks tight or greasy, add pasta water one tablespoon at a time.",
      }),
      createSample("sample-recipe-sheet-pan-chicken", {
        title: "Crisp chicken and vegetables",
        summary: "One-pan chicken thighs with vegetables arranged by cooking speed rather than dumped together.",
        servings: "4 servings",
        timing: "15 min prep · 40 min cook",
        ingredients: [
          "6 bone-in, skin-on chicken thighs",
          "450 g small potatoes, halved",
          "2 bell peppers, cut into wide strips",
          "1 red onion, cut into wedges",
          "2 tbsp olive oil",
          "1 tsp smoked paprika",
          "1 lemon",
          "Salt and black pepper",
        ],
        steps: [
          "Heat the oven to 220°C and preheat the sheet pan for five minutes.",
          "Dry and season the chicken; toss potatoes with oil, salt, pepper, and paprika.",
          "Start chicken skin-side down with potatoes on the hot pan for 20 minutes.",
          "Turn the chicken, add peppers and onion, then roast until the skin is crisp and the center reaches 74°C.",
          "Rest five minutes and finish with lemon juice and pan drippings.",
        ],
        notes: "Preheating the tray improves browning. Add faster-cooking vegetables later so they roast instead of collapse.",
      }),
    ],
  },
  {
    id: "workouts",
    title: "Workout Types",
    description: "Different kinds of training organized by purpose, structure, exercises, and frequency.",
    icon: "⌇",
    type: "workout",
    area: EVERYDAY_AREA,
    items: [
      createSample("sample-workout-full-body", {
        title: "Full-body strength A",
        summary: "A repeatable squat, push, pull, hinge, and carry session with simple progression.",
        goal: "Build general strength while practicing the major movement patterns.",
        frequency: "2–3 sessions weekly · 50–65 minutes · leave at least one recovery day",
        duration: "About 60 minutes including warm-up",
        equipment: "Barbell or dumbbells, bench, pull-up bar, and a heavy carry implement.",
        exercises: [
          "Goblet or back squat · 3 × 5–8",
          "Bench press or push-up · 3 × 6–10",
          "Romanian deadlift · 3 × 6–10",
          "Pull-up or cable row · 3 × 6–12",
          "Farmer carry · 3 × 30–45 seconds",
        ],
        progression: "When every set reaches the top of its range with two clean reps in reserve, add the smallest available load next session.",
        notes: "Warm up the movement, not fatigue: two to four increasingly heavy practice sets before the first work set.",
      }),
      createSample("sample-workout-zone-two", {
        title: "Aerobic base session",
        summary: "Low-intensity cardiovascular work that is easy enough to repeat and hard enough to build capacity.",
        goal: "Improve aerobic efficiency, recovery, and the ability to sustain work without accumulating excessive fatigue.",
        frequency: "2–4 sessions weekly · 30–60 minutes",
        duration: "Start at 30 minutes and build by five minutes per week",
        equipment: "Incline treadmill, bike, rower, or an outdoor route with steady terrain.",
        exercises: [
          "5 minutes easy warm-up",
          "25–50 minutes at conversational pace",
          "5 minutes progressively easier cool-down",
        ],
        progression: "Increase duration before intensity. Once 45–60 minutes feels stable, add one separate short interval day rather than turning every session hard.",
        notes: "The talk test is more useful than chasing a universal heart-rate number: speak a full sentence without gasping.",
      }),
    ],
  },
  {
    id: "cleaning",
    title: "House Cleaning",
    description: "Break the house into manageable parts with supplies, order, and repeatable cleaning steps.",
    icon: "⌂",
    type: "cleaning",
    area: EVERYDAY_AREA,
    items: [
      createSample("sample-clean-kitchen-reset", {
        title: "Kitchen closing reset",
        summary: "A top-to-bottom fifteen-minute route that leaves the kitchen ready for the next meal.",
        frequency: "Nightly or after the final cooked meal",
        zone: "Counters, cooktop, sink, table, and floor",
        supplies: [
          "Dish soap and dishwasher detergent",
          "Microfiber cloth",
          "Food-safe all-purpose cleaner",
          "Small broom or vacuum",
        ],
        steps: [
          "Return ingredients and discard food waste.",
          "Load the dishwasher or wash the largest cookware first.",
          "Wipe upper surfaces, then counters and cooktop so debris falls downward.",
          "Clean and dry the sink; leave the cloth open to air-dry.",
          "Sweep the floor last and set out anything needed for breakfast.",
        ],
        warnings: "Do not mix cleaning chemicals. Let a hot glass cooktop cool before applying liquid.",
        notes: "Keep the route short enough to do consistently; save the oven, cabinet fronts, and refrigerator shelves for weekly rotation.",
      }),
      createSample("sample-clean-bathroom", {
        title: "Weekly bathroom clean",
        summary: "Use dwell time and a clean-to-dirty route instead of scrubbing every surface at once.",
        frequency: "Weekly · 25–35 minutes",
        zone: "Mirror, vanity, shower, tub, toilet, and floor",
        supplies: [
          "Bathroom cleaner suitable for the surface",
          "Glass cloth and general microfiber cloth",
          "Toilet brush",
          "Small scrub brush",
          "Mop or floor cloth",
        ],
        steps: [
          "Remove towels and loose objects; ventilate the room.",
          "Apply cleaner to shower, tub, sink, and toilet so it can dwell.",
          "Clean the mirror and upper fixtures while the product works.",
          "Scrub and rinse the shower and sink, then clean the toilet last.",
          "Mop from the far corner toward the door and replace dry linens.",
        ],
        warnings: "Never combine bleach with ammonia, acids, or other cleaners. Check natural stone before using acidic products.",
        notes: "A squeegee after showers reduces the weekly mineral and soap buildup more than extra scrubbing does.",
      }),
    ],
  },
  {
    id: "studies",
    title: "Studies",
    description: "Structured inquiries with a question, evidence, findings, limitations, and a next test.",
    icon: "◉",
    type: "study",
    items: [
      createSample("sample-study-retrieval", {
        title: "Retrieval practice versus rereading",
        summary: "A small self-study on whether active recall produces more durable learning than repeated exposure.",
        researchQuestion: "After one week, do short closed-book retrieval sessions preserve more usable knowledge than rereading the same notes?",
        hypothesis: "Retrieval will feel harder during practice but produce higher delayed recall and better transfer to novel questions.",
        method: "Choose two comparable chapters. For one, reread for 20 minutes; for the other, answer prompts from memory for 20 minutes. Test both immediately, after 48 hours, and after seven days with parallel questions.",
        evidence: [
          "Immediate score for each condition",
          "48-hour delayed score",
          "Seven-day delayed score",
          "Confidence before answering each question",
          "Time spent reviewing errors",
        ],
        findings: "Sample entry: no result yet. Record scores before interpreting the experience.",
        limitations: "One learner, two topics, imperfectly matched question difficulty, and a likely novelty effect.",
        nextSteps: "Repeat across three subjects and add a mixed condition that combines brief rereading with retrieval.",
      }),
      createSample("sample-study-forgetting", {
        title: "What makes knowledge retrievable?",
        summary: "An inquiry into why familiar material often becomes inaccessible when its original context is absent.",
        researchQuestion: "Which retrieval cues make a learned idea easiest to recover months later: topic labels, questions, examples, or use cases?",
        hypothesis: "Concrete use cases and self-authored questions will outperform broad topic labels because they recreate the conditions in which the knowledge is needed.",
        method: "Create four cue types for twelve ideas, rotate cue assignments, and test unaided recall monthly. Record whether each cue recovers a definition, an example, and an application.",
        evidence: [
          "Recall rate by cue type",
          "Time until first correct statement",
          "Quality of recovered example",
          "Whether the idea could be applied without reopening notes",
        ],
        findings: "Sample entry: this is a study design, not a conclusion.",
        limitations: "Cue quality varies, prior familiarity differs, and repeated testing itself strengthens memory.",
        nextSteps: "Define a simple scoring rubric and pilot the method with three ideas before expanding it.",
      }),
    ],
  },
  {
    id: "questions-ideas",
    title: "Questions & Ideas",
    description: "Open questions, emerging ideas, possible explanations, and directions worth pursuing.",
    icon: "?",
    type: "question",
    items: [
      createSample("sample-question-note-worth", {
        title: "What makes a note worth preserving?",
        summary: "A design question for keeping the archive selective without losing useful context.",
        kind: "Question",
        status: "Exploring",
        context: "Saving everything recreates the original information overload; saving only conclusions hides the reasoning needed to trust or reuse them.",
        directions: [
          "Compare notes that were reused with notes that were never reopened.",
          "Test a required use-case field before an entry can be saved.",
          "Separate temporary working notes from durable reference notes.",
        ],
        currentPosition: "A durable note should answer a future question, support a decision, or preserve a method that would be expensive to reconstruct.",
      }),
      createSample("sample-idea-expiring-notes", {
        title: "Let uncertain notes expire unless revisited",
        summary: "A possible way to prevent tentative fragments from silently becoming permanent clutter.",
        kind: "Idea",
        status: "Open",
        context: "Open questions and provisional claims need different treatment from trusted reference material.",
        directions: [
          "Add a review date only to tentative material.",
          "Archive rather than delete entries that expire.",
          "Track the last time an entry supported another note or project.",
        ],
        currentPosition: "Expiration should be a review prompt, not automatic deletion; uncertainty must remain visible.",
      }),
    ],
  },
  {
    id: "programming-languages",
    title: "Programming Languages",
    description: "Fast, personal refreshers for returning to a language.",
    icon: "⌘",
    type: "language",
    items: [
      createSample("sample-language-javascript", {
        title: "JavaScript refresher",
        summary: "The language model and syntax I need when returning to browser or Node work.",
        useWhen: "Interactive browser interfaces, small servers, build tooling, and code that benefits from sharing one language across the stack.",
        mentalModel: "Values flow through a single-threaded event loop. Synchronous code runs to completion; queued tasks and promise callbacks resume later. Objects are reference values and functions close over their lexical scope.",
        syntax: "const unique = [...new Set(values)];\nconst names = records.filter(Boolean).map(({ name }) => name);\nconst result = await fetch(url).then((response) => response.json());\n\ntry {\n  await save(result);\n} catch (error) {\n  console.error(\"Save failed\", error);\n}",
        patterns: [
          "Prefer const; use let only when reassignment is part of the design.",
          "Normalize data at boundaries rather than scattering null checks.",
          "Use async/await for sequencing and Promise.all for independent work.",
        ],
        gotchas: "Array and object equality is by identity. sort() mutates and sorts strings by default. await inside a loop is serial. Date parsing and time zones need explicit tests.",
      }),
      createSample("sample-language-python", {
        title: "Python refresher",
        summary: "A compact reference for readable scripts, data work, and small automation.",
        useWhen: "Data transformation, scientific work, automation, command-line tools, and services where clarity matters more than browser delivery.",
        mentalModel: "Everything is an object bound to a name. Mutability belongs to the object, not the variable. Iteration protocols and context managers hide resource-handling machinery behind concise syntax.",
        syntax: "from collections import Counter\nfrom pathlib import Path\n\ntext = Path(\"data.txt\").read_text(encoding=\"utf-8\")\nrows = [line.strip() for line in text.splitlines() if line.strip()]\ncounts = Counter(rows)\n\nPath(\"output.txt\").write_text(\"\\n\".join(sorted(rows)), encoding=\"utf-8\")",
        patterns: [
          "Use pathlib for paths and context managers for resources.",
          "Prefer comprehensions for simple transforms, ordinary loops for branching logic.",
          "Add type hints at module boundaries and dataclasses for stable records.",
        ],
        gotchas: "Mutable default arguments persist between calls. is tests identity, not value equality. A broad except hides programming errors. Local naive datetimes are ambiguous.",
      }),
    ],
  },
  {
    id: "algorithms",
    title: "Algorithms",
    description: "Use cases, reasoning, complexity, and animated visual explanations.",
    icon: "⌬",
    type: "algorithm",
    items: [
      createSample("sample-algorithm-binary-search", {
        title: "Binary search",
        summary: "Discard half of an ordered search space after every comparison.",
        useCases: "Finding a boundary in sorted data, locating insertion points, or searching any monotonic true/false condition.",
        invariant: "If the target exists, it remains inside the active interval after every update.",
        explanation: "Compare the middle element with the target. Keep only the half that can still contain the answer. For boundary searches, define precisely whether the interval is closed or half-open and what happens on equality.",
        pseudocode: "lo = 0; hi = length\nwhile lo < hi:\n  mid = lo + floor((hi - lo) / 2)\n  if values[mid] < target: lo = mid + 1\n  else: hi = mid\nreturn lo",
        complexity: "Time O(log n) · Space O(1) iteratively",
        visualFrames: [
          "[1 3 5 7 9 11 13] > mid=7 > target=11",
          "[9 11 13] > mid=11 > match",
          "index 5 > done",
        ],
      }),
      createSample("sample-algorithm-breadth-first-search", {
        title: "Breadth-first search",
        summary: "Explore a graph one distance layer at a time using a queue.",
        useCases: "Shortest paths in unweighted graphs, degrees of separation, flood fill, and level-order tree traversal.",
        invariant: "When a node leaves the queue, its recorded distance is the shortest number of edges from the start.",
        explanation: "Mark the start visited and enqueue it. Repeatedly remove the oldest node, then enqueue each unseen neighbor. Mark neighbors when enqueuing—not when removing—to prevent duplicates.",
        pseudocode: "queue = [start]\nvisited = {start}\nwhile queue not empty:\n  node = queue.pop_front()\n  for neighbor in graph[node]:\n    if neighbor not in visited:\n      visited.add(neighbor)\n      queue.push_back(neighbor)",
        complexity: "Time O(V + E) · Space O(V)",
        visualFrames: [
          "A > frontier: B C",
          "B C > frontier: D E",
          "D E > goal E found",
        ],
      }),
    ],
  },
  {
    id: "projects",
    title: "Projects",
    description: "Problems worth remembering, how you solved them, and what you used.",
    icon: "◇",
    type: "project",
    items: [
      createSample("sample-project-vital-pancakes", {
        title: "Vital Pancakes knowledge archive",
        summary: "A local-first catalogue designed to preserve learned methods, questions, and working tools.",
        status: "Active",
        problem: "Useful knowledge was scattered across school files, browser tabs, notes, and memory, then became difficult to retrieve when its original context disappeared.",
        solution: "Organize knowledge by the way it is used, store editable personal entries locally, and give specialized work—diagramming, literature analysis, planning—its own tool.",
        outcome: "A static, installable site with durable libraries, offline support, and no account dependency.",
        nextStep: "Use the sample libraries long enough to learn which fields actually improve retrieval, then remove anything ornamental.",
        languages: ["JavaScript", "HTML", "CSS"],
        algorithmIds: ["sample-algorithm-breadth-first-search"],
      }),
      createSample("sample-project-route-explorer", {
        title: "Walkable route explorer",
        summary: "A project sketch for comparing nearby destinations by actual route cost rather than straight-line distance.",
        status: "Concept",
        problem: "The closest place on a map is not always the quickest or most pleasant place to reach because crossings, barriers, and street topology matter.",
        solution: "Represent intersections and paths as a weighted graph, geocode candidate destinations, then compare routes using distance, crossings, incline, and preference penalties.",
        outcome: "Not built yet; the useful artifact is the problem model and its measurable trade-offs.",
        nextStep: "Prototype with one neighborhood and compare graph results against five routes walked in person.",
        languages: ["Python", "JavaScript"],
        algorithmIds: ["sample-algorithm-breadth-first-search"],
      }),
    ],
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
 * Returns an isolated initial workspace with editable starter content.
 *
 * @returns {{version: number, sections: Array<object>}} A new workspace.
 */
function createInitialWorkspace() {
  return {
    version: CURRENT_WORKSPACE_VERSION,
    sections: DEFAULT_SECTIONS.map(cloneDefaultSection),
  };
}

/**
 * Deep-clones a default section so persisted edits never mutate the defaults.
 *
 * @param {object} section Default section.
 * @returns {object} Isolated section copy.
 */
function cloneDefaultSection(section) {
  return JSON.parse(JSON.stringify(section));
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
    const shouldSeedSamples = (workspace.version ?? 1) < CURRENT_WORKSPACE_VERSION;
    const coreSections = DEFAULT_SECTIONS.map((section) => {
      const existingSection = existingSections.get(section.id);
      if (!existingSection) {
        return cloneDefaultSection(section);
      }

      return {
        ...section,
        ...existingSection,
        id: section.id,
        type: section.type,
        area: section.area,
        items: shouldSeedSamples && !(existingSection.items?.length)
          ? cloneDefaultSection(section).items
          : (existingSection.items ?? []),
      };
    });
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
