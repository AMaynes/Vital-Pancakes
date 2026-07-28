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
const CURRENT_WORKSPACE_VERSION = 8;
const EVERYDAY_AREA = "everyday";
const SAMPLE_DATE = "2026-07-28T12:00:00.000Z";
const LEGACY_WORKOUT_SAMPLE_IDS = new Set([
  "sample-workout-full-body",
  "sample-workout-zone-two",
]);

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
    description: "Push, pull, and legs exercise libraries organized by movement pattern and target muscle.",
    icon: "⌇",
    type: "workout",
    area: EVERYDAY_AREA,
    items: [
      createSample("sample-push-barbell-bench-press", {
        category: "push",
        title: "Barbell bench press",
        summary: "The primary horizontal press for building the chest, front delts, and triceps with heavy, repeatable loading.",
        goal: "Chest · anterior deltoids · triceps",
        frequency: "3–5 working sets · 3–8 reps",
        duration: "Rest 2–4 minutes between hard sets",
        equipment: "Barbell, flat bench, rack, plates, and safeties or a spotter.",
        exercises: [
          "Set eyes under the bar, plant the feet, and pull the shoulder blades down and together.",
          "Unrack over the shoulders with straight wrists and locked elbows.",
          "Lower under control to the lower chest while keeping forearms nearly vertical.",
          "Press up and slightly back until the bar is stacked over the shoulders.",
        ],
        progression: "Add 1–2.5 kg when every prescribed rep is clean with one or two reps still available.",
        notes: "Keep the upper back fixed to the bench. Do not bounce the bar or let the elbows flare directly sideways.",
      }),
      createSample("sample-push-incline-barbell-press", {
        category: "push",
        title: "Incline barbell bench press",
        summary: "A stable upper-chest press that also loads the front delts without becoming a full overhead press.",
        goal: "Upper chest · anterior deltoids · triceps",
        frequency: "3–4 working sets · 5–10 reps",
        duration: "Rest 2–3 minutes",
        equipment: "Barbell, adjustable bench set around 20–35°, rack, and plates.",
        exercises: [
          "Set the bench low enough that the chest remains the main driver.",
          "Pin the shoulder blades to the pad and keep the feet firmly planted.",
          "Lower toward the upper chest with wrists stacked above elbows.",
          "Press upward and slightly back without lifting the shoulders.",
        ],
        progression: "Reach the top of the rep range across all sets before adding the smallest load.",
        notes: "A steep incline shifts the exercise toward the shoulders. Avoid turning it into a 60–75° press.",
      }),
      createSample("sample-push-dumbbell-bench-press", {
        category: "push",
        title: "Dumbbell bench press",
        summary: "A horizontal press with independent arms, a long range of motion, and easier joint positioning than a fixed bar.",
        goal: "Chest · anterior deltoids · triceps",
        frequency: "3–4 working sets · 6–12 reps",
        duration: "Rest 90–150 seconds",
        equipment: "Flat bench and matched dumbbells.",
        exercises: [
          "Kick the dumbbells into position and anchor the shoulder blades.",
          "Lower beside the chest with the elbows slightly tucked.",
          "Keep the forearms vertical and wrists neutral.",
          "Press the dumbbells up without crashing them together.",
        ],
        progression: "Add reps until all sets reach the upper limit, then move to the next dumbbell pair.",
        notes: "Stop the descent before the shoulder rolls forward. A neutral or semi-neutral grip is often more comfortable.",
      }),
      createSample("sample-push-incline-dumbbell-press", {
        category: "push",
        title: "Incline dumbbell press",
        summary: "An upper-chest press with independent arm paths and a larger stretch than the barbell variation.",
        goal: "Upper chest · anterior deltoids · triceps",
        frequency: "3–4 working sets · 8–12 reps",
        duration: "Rest 90–150 seconds",
        equipment: "Adjustable bench set around 20–35° and matched dumbbells.",
        exercises: [
          "Set the shoulders down and back before the first repetition.",
          "Lower the dumbbells outside the upper chest with a slight elbow tuck.",
          "Pause briefly in the stretched position without relaxing.",
          "Drive upward while preserving the same forearm angle.",
        ],
        progression: "Use double progression: add reps within the range, then increase both dumbbells.",
        notes: "Keep the incline modest and the lower back controlled against excessive arching.",
      }),
      createSample("sample-push-overhead-press", {
        category: "push",
        title: "Standing overhead press",
        summary: "The main vertical press for shoulder strength, triceps strength, and whole-body bracing.",
        goal: "Anterior and lateral deltoids · triceps · upper chest",
        frequency: "3–5 working sets · 3–8 reps",
        duration: "Rest 2–4 minutes",
        equipment: "Barbell, rack, and plates.",
        exercises: [
          "Set the bar on the upper chest with wrists stacked over elbows.",
          "Brace the glutes and abdomen before every repetition.",
          "Move the head back just enough for a straight bar path.",
          "Press overhead, then finish with the head through and bar over mid-foot.",
        ],
        progression: "Add the smallest available load after completing all reps without leaning back or using leg drive.",
        notes: "Squeeze the glutes to prevent the ribs and pelvis from opening into a standing incline press.",
      }),
      createSample("sample-push-dumbbell-shoulder-press", {
        category: "push",
        title: "Seated dumbbell shoulder press",
        summary: "A shoulder-focused vertical press with independent arms and less balance demand than standing work.",
        goal: "Anterior and lateral deltoids · triceps",
        frequency: "3–4 working sets · 6–12 reps",
        duration: "Rest 90–150 seconds",
        equipment: "High-backed adjustable bench and matched dumbbells.",
        exercises: [
          "Brace against the back pad with feet planted.",
          "Start with forearms vertical and elbows slightly forward of the torso.",
          "Press upward without shrugging early.",
          "Lower until the upper arms reach a comfortable depth.",
        ],
        progression: "Add repetitions first; increase weight only when the last reps remain controlled.",
        notes: "Do not force the dumbbells to touch overhead. Preserve a natural arm path.",
      }),
      createSample("sample-push-dips", {
        category: "push",
        title: "Parallel-bar dip",
        summary: "A closed-chain press that heavily loads the lower chest and triceps through a deep range.",
        goal: "Chest · triceps · anterior deltoids",
        frequency: "3–4 working sets · 5–12 reps",
        duration: "Rest 2–3 minutes",
        equipment: "Stable dip bars; belt and plates for weighted work.",
        exercises: [
          "Support the body with shoulders held down away from the ears.",
          "Lean slightly forward for more chest or stay upright for more triceps.",
          "Descend only as far as the shoulder remains controlled.",
          "Drive the bars down and finish with locked elbows.",
        ],
        progression: "Build to clean sets of 10–12, then add a small external load.",
        notes: "Use assistance if needed. Avoid sinking passively into the bottom or letting the shoulders roll forward.",
      }),
      createSample("sample-push-push-up", {
        category: "push",
        title: "Push-up",
        summary: "A scalable horizontal press that trains the chest, triceps, serratus, and trunk without equipment.",
        goal: "Chest · triceps · anterior deltoids · serratus anterior",
        frequency: "3–5 working sets · 8–25 reps",
        duration: "Rest 60–120 seconds",
        equipment: "Floor; handles, rings, a vest, or plates are optional.",
        exercises: [
          "Set hands just outside shoulder width and make a rigid line from head to heel.",
          "Lower the chest between the hands while keeping elbows roughly 30–60° from the torso.",
          "Reach a controlled bottom position without the hips sagging.",
          "Press the floor away and allow the shoulder blades to move naturally at the top.",
        ],
        progression: "Move from incline to floor to feet-elevated or externally loaded variations as the rep range becomes easy.",
        notes: "Count only repetitions that preserve trunk position and reach the same depth.",
      }),
      createSample("sample-push-cable-fly", {
        category: "push",
        title: "Cable chest fly",
        summary: "A chest isolation movement with continuous tension and an adjustable line of pull.",
        goal: "Pectoralis major",
        frequency: "2–4 working sets · 10–20 reps",
        duration: "Rest 60–90 seconds",
        equipment: "Dual adjustable cable station and handles.",
        exercises: [
          "Take a staggered stance and set the shoulder blades gently back.",
          "Keep a small, fixed bend in the elbows.",
          "Sweep the upper arms across the chest rather than pressing with the hands.",
          "Return slowly until the chest is stretched without the shoulders rolling forward.",
        ],
        progression: "Increase repetitions before adding one cable increment.",
        notes: "Do not turn the movement into a press by repeatedly bending and straightening the elbows.",
      }),
      createSample("sample-push-lateral-raise", {
        category: "push",
        title: "Dumbbell lateral raise",
        summary: "The standard isolation movement for building the side delts and shoulder width.",
        goal: "Lateral deltoids",
        frequency: "3–5 working sets · 12–25 reps",
        duration: "Rest 45–90 seconds",
        equipment: "Light dumbbells.",
        exercises: [
          "Stand tall with the weights slightly in front of the thighs.",
          "Lead the elbows outward in the scapular plane.",
          "Raise to roughly shoulder height without aggressively shrugging.",
          "Lower under control and keep tension between repetitions.",
        ],
        progression: "Add reps with consistent height and tempo before using heavier dumbbells.",
        notes: "Use less weight than expected. Momentum should not replace delt tension.",
      }),
      createSample("sample-push-cable-lateral-raise", {
        category: "push",
        title: "Single-arm cable lateral raise",
        summary: "A side-delt isolation exercise that stays loaded near the bottom where dumbbells are easiest.",
        goal: "Lateral deltoids",
        frequency: "3–4 working sets · 12–20 reps per side",
        duration: "Rest 30–60 seconds between sides",
        equipment: "Low cable and single handle or cuff.",
        exercises: [
          "Stand side-on with the cable crossing slightly behind the body.",
          "Keep the torso still and elbow softly bent.",
          "Lead the elbow outward until the arm approaches shoulder height.",
          "Return slowly without letting the stack slam.",
        ],
        progression: "Add controlled reps, then use the smallest cable increase.",
        notes: "A cuff removes grip from the exercise and often improves the line of pull.",
      }),
      createSample("sample-push-triceps-pushdown", {
        category: "push",
        title: "Cable triceps pushdown",
        summary: "A stable triceps isolation exercise that is easy to load, control, and recover from.",
        goal: "Triceps, especially lateral and medial heads",
        frequency: "3–4 working sets · 10–20 reps",
        duration: "Rest 60–90 seconds",
        equipment: "High cable with rope, straight bar, or angled attachment.",
        exercises: [
          "Pin the upper arms beside the torso.",
          "Extend the elbows without rocking the shoulders.",
          "Reach full extension and briefly contract the triceps.",
          "Let the forearms return while the upper arms remain still.",
        ],
        progression: "Reach the top of the range with strict elbows before increasing the stack.",
        notes: "Choose the attachment that keeps wrists comfortable; the elbow motion matters more than the handle.",
      }),
      createSample("sample-push-overhead-triceps-extension", {
        category: "push",
        title: "Overhead cable triceps extension",
        summary: "A lengthened-position triceps exercise that emphasizes the long head.",
        goal: "Triceps long head",
        frequency: "3–4 working sets · 10–20 reps",
        duration: "Rest 60–90 seconds",
        equipment: "Cable station with rope or two handles.",
        exercises: [
          "Face away from the cable and brace in a staggered stance.",
          "Keep the upper arms angled overhead and ribs down.",
          "Bend only at the elbows until the triceps are fully stretched.",
          "Extend to straight arms without moving the shoulders.",
        ],
        progression: "Add reps while preserving the stretched bottom position, then raise the load slightly.",
        notes: "Lower the weight if the elbows drift or the lower back arches to finish repetitions.",
      }),
      createSample("sample-push-skull-crusher", {
        category: "push",
        title: "EZ-bar skull crusher",
        summary: "A free-weight triceps extension that combines heavy loading with a long eccentric range.",
        goal: "Triceps, with strong long-head involvement",
        frequency: "2–4 working sets · 8–15 reps",
        duration: "Rest 90–120 seconds",
        equipment: "Flat bench and EZ-curl bar or dumbbells.",
        exercises: [
          "Start with the arms angled slightly behind vertical.",
          "Keep the upper arms fixed while bending the elbows.",
          "Lower the bar behind the forehead toward the top of the head.",
          "Extend the elbows without letting the shoulders turn the rep into a pullover.",
        ],
        progression: "Add repetitions first, then use small weight increases to protect the elbows.",
        notes: "An EZ bar or dumbbells usually permits a friendlier wrist angle than a straight bar.",
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
 * Places older user-authored workout entries into one of the three training
 * libraries. Explicit categories win; the fallback keeps every entry visible
 * and editable instead of dropping it during migration.
 *
 * @param {object} item Workout entry.
 * @returns {"push"|"pull"|"legs"} Supported workout category.
 */
function getWorkoutCategory(item) {
  if (["push", "pull", "legs"].includes(item.category)) {
    return item.category;
  }

  const searchableText = [
    item.title,
    item.summary,
    item.goal,
    ...(item.exercises ?? []),
  ].join(" ").toLocaleLowerCase();
  const categoryTerms = {
    pull: ["pull", "row", "curl", "lat", "back", "biceps", "rear delt"],
    legs: ["squat", "deadlift", "hinge", "leg", "quad", "hamstring", "glute", "calf", "lunge"],
  };
  const scores = Object.fromEntries(
    Object.entries(categoryTerms).map(([category, terms]) => [
      category,
      terms.filter((term) => searchableText.includes(term)).length,
    ]),
  );
  if (scores.legs > scores.pull && scores.legs > 0) return "legs";
  if (scores.pull > 0) return "pull";
  return "push";
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
  const previousVersion = workspace.version ?? 1;
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
    previousVersion < CURRENT_WORKSPACE_VERSION
    || DEFAULT_SECTIONS.some((section) => !sections.some((candidate) => candidate.id === section.id))
  );
  if (shouldRestoreCoreSections) {
    const existingSections = new Map(sections.map((section) => [section.id, section]));
    const shouldSeedSamples = previousVersion < 7;
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

  if (previousVersion < 8) {
    const workoutSection = workspace.sections.find((section) => section.id === "workouts");
    const defaultWorkoutSection = DEFAULT_SECTIONS.find((section) => section.id === "workouts");
    if (workoutSection && defaultWorkoutSection) {
      const preservedItems = (workoutSection.items ?? [])
        .filter((item) => !LEGACY_WORKOUT_SAMPLE_IDS.has(item.id))
        .map((item) => ({ ...item, category: getWorkoutCategory(item) }));
      const existingIds = new Set(preservedItems.map((item) => item.id));
      const newPushSamples = cloneDefaultSection(defaultWorkoutSection).items
        .filter((item) => !existingIds.has(item.id));
      workoutSection.items = [...preservedItems, ...newPushSamples];
      changed = true;
    }
  }

  if (previousVersion < CURRENT_WORKSPACE_VERSION) {
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
