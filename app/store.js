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

import { ALGORITHM_ANALYSIS_SAMPLES } from "./algorithm-analysis-samples.mjs?v=1";
import { ALGORITHM_SAMPLES } from "./algorithm-samples.mjs?v=2";

const WORKSPACE_KEY = "artificially-neuroscience-workspace-v1";
const CURRENT_WORKSPACE_VERSION = 14;
const EVERYDAY_AREA = "everyday";
const SAMPLE_DATE = "2026-07-28T12:00:00.000Z";
const LEGACY_WORKOUT_SAMPLE_IDS = new Set([
  "sample-workout-full-body",
  "sample-workout-zone-two",
]);
const LEGACY_CLEANING_SAMPLE_IDS = new Set([
  "sample-clean-kitchen-reset",
  "sample-clean-bathroom",
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

const COOKING_GUIDE_SAMPLES = [
  createSample("sample-cook-knife-prep", {
    title: "Set up a clean cutting station",
    summary: "Work faster and safer by stabilizing the board, organizing bowls, and cutting ingredients in the right order.",
    heat: "No heat; this is about control before the stove turns on.",
    signals: "The board does not slide, scraps have a place, and each ingredient is cut to a size that matches its cooking time.",
    principles: "Good cooking starts with mise en place. Uniform pieces cook evenly, a sharp knife is safer than a dull one, and separating raw meat from ready-to-eat foods prevents cross-contamination.",
    essentials: "Sharp chef's knife, stable cutting board, towel under the board, scrap bowl, clean towel, and separate plates for raw and cooked foods.",
    steps: [
      "Read the whole method and pull out every ingredient and tool before cutting.",
      "Place a damp towel under the cutting board so it cannot slide.",
      "Wash produce, dry it, and cut low-risk ingredients before raw meat or seafood.",
      "Use a claw grip: fingertips curled back, knuckles guiding the side of the knife.",
      "Keep pieces similar in size when they need to finish cooking together.",
      "Clear scraps as you go and sanitize anything that touched raw meat.",
    ],
    mistakes: "Rushing with a dull knife causes slips. Mixing raw and cooked tools spreads bacteria. Tiny garlic, large carrots, and thin onions in the same pan will not cook evenly.",
    tags: ["prep", "knife skills", "safety", "mise en place", "beginner"],
  }),
  createSample("sample-cook-seasoning-balance", {
    title: "Season food so it tastes complete",
    summary: "Use salt, acid, fat, sweetness, bitterness, and aroma as adjustable controls instead of guessing.",
    heat: "Season early when salt needs to penetrate; finish off heat when adjusting acid, herbs, and delicate oils.",
    signals: "Flat food needs salt or acid; harsh food needs fat, dilution, or sweetness; heavy food needs acid, herbs, or crunch.",
    principles: "Salt strengthens flavor, acid brightens, fat carries aroma and softens edges, sweetness rounds bitterness, and bitterness keeps rich food from feeling dull.",
    essentials: "Kosher salt, black pepper, vinegar or citrus, olive oil or butter, a tasting spoon, and one clean spoon per taste.",
    steps: [
      "Taste the food plain before changing it.",
      "Add salt in small pinches, stir well, and wait a moment before tasting again.",
      "If it is salty enough but still dull, add a few drops of acid.",
      "If it is sharp or thin, add fat, stock, dairy, or a small amount of sweetness.",
      "Finish with fresh herbs, zest, spice, or crunch when the base tastes balanced.",
    ],
    mistakes: "Adding more spice when the issue is salt makes food loud but still flat. Seasoning only at the end leaves thick foods bland inside. Acid can curdle dairy if boiled hard.",
    tags: ["seasoning", "salt", "acid", "flavor", "beginner"],
  }),
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
    tags: ["heat control", "searing", "meat", "vegetables", "pan work"],
  }),
  createSample("sample-cook-sweating-sauteing", {
    title: "Sweat, saute, and soften aromatics",
    summary: "Choose whether onions, garlic, celery, carrots, and peppers should melt gently or brown quickly.",
    heat: "Low to medium-low for sweating; medium to medium-high for sauteing.",
    signals: "Sweated aromatics look glossy and translucent; sauteed aromatics smell toasted and show light golden edges.",
    principles: "Moisture release, fat coverage, salt, and pan temperature decide whether vegetables soften without color or brown for deeper flavor.",
    essentials: "Wide pan, oil or butter, salt, wooden spoon, and chopped aromatics of similar size.",
    steps: [
      "Warm fat until it shimmers gently or butter foams.",
      "Add aromatics with a small pinch of salt.",
      "For sweating, lower the heat and stir often so moisture escapes without browning.",
      "For sauteing, use more heat, a wider pan, and less stirring so edges take color.",
      "Add garlic late because it burns faster than onions, carrots, or celery.",
    ],
    mistakes: "High heat burns garlic before onions soften. Too little fat scorches dry edges. A crowded pan sweats even when you wanted browning.",
    tags: ["aromatics", "vegetables", "heat control", "soups", "sauces"],
  }),
  createSample("sample-cook-boiling-simmering", {
    title: "Boil, simmer, poach, and blanch",
    summary: "Use water temperature intentionally for pasta, eggs, vegetables, beans, stock, and delicate proteins.",
    heat: "Full boil for pasta and blanching; gentle simmer for soups and beans; bare simmer for poaching.",
    signals: "A boil rolls hard, a simmer bubbles steadily, and a poach barely trembles at the surface.",
    principles: "Water transfers heat evenly, but agitation changes texture. Salt seasons from the outside in, and shocking stops carryover cooking.",
    essentials: "Large pot, salt, spider or tongs, timer, ice bath for blanching, and enough water that temperature recovers quickly.",
    steps: [
      "Choose a pot large enough for the food to move freely.",
      "Salt water for pasta and vegetables; keep beans more gently seasoned until they soften.",
      "Use a rolling boil for pasta or green vegetables that need speed.",
      "Lower to a simmer for foods that toughen, burst, or cloud when boiled hard.",
      "Shock blanched vegetables in ice water when you need bright color and crisp texture.",
    ],
    mistakes: "Boiling stock makes it cloudy. Hard-boiling eggs or fish can make them rubbery. Undersalted pasta water leaves pasta bland no matter how good the sauce is.",
    tags: ["water cooking", "pasta", "vegetables", "eggs", "basics"],
  }),
  createSample("sample-cook-roasting", {
    title: "Roast vegetables and proteins without steaming them",
    summary: "Use dry heat, spacing, oil, and timing to get browned edges and tender centers.",
    heat: "200-230 C for most vegetables and chicken pieces; lower for large roasts that need time.",
    signals: "Edges brown, surfaces look dry and blistered, and the tray sizzles instead of pooling liquid.",
    principles: "Roasting is evaporation plus browning. Pieces need space, oil contact, and enough heat for moisture to leave before the inside overcooks.",
    essentials: "Rimmed sheet pan, parchment if useful, oil, salt, thermometer for meat, and a spatula.",
    steps: [
      "Preheat the oven fully and preheat the pan when stronger browning matters.",
      "Dry the food and cut pieces to a thickness that matches their cooking speed.",
      "Coat lightly with oil and salt, then spread in a single layer.",
      "Turn only when the first side has color.",
      "Pull vegetables when browned and tender; pull meat by internal temperature and rest it.",
    ],
    mistakes: "Overcrowding causes steam. Wet marinades delay browning. Sugar-heavy glazes should go on late so they do not burn.",
    tags: ["roasting", "oven", "vegetables", "meat", "meal prep"],
  }),
  createSample("sample-cook-braising", {
    title: "Braise tough cuts until tender",
    summary: "Brown, partially cover, and cook low until collagen-rich meat or firm vegetables become spoon-tender.",
    heat: "Sear over medium-high; braise covered at a gentle oven or stovetop simmer.",
    signals: "The liquid barely bubbles, meat yields to a fork, and the sauce tastes concentrated but not scorched.",
    principles: "Braising uses moisture and time to convert collagen into gelatin while browned surfaces and aromatics build depth.",
    essentials: "Dutch oven or heavy pot with lid, stock or wine, aromatics, tongs, and time.",
    steps: [
      "Salt and dry the main ingredient, then brown it in batches.",
      "Soften aromatics in the same pot and scrape up browned bits.",
      "Add liquid to come partway up the food, not fully submerge it.",
      "Cover and cook gently until tender, checking that the liquid never boils violently.",
      "Rest the meat, skim excess fat, and reduce or season the sauce.",
    ],
    mistakes: "Too much liquid turns braising into boiling. Hard boiling dries meat fibers even in liquid. Skipping browning makes the final sauce taste thin.",
    tags: ["braising", "meat", "stews", "low and slow", "sauces"],
  }),
  createSample("sample-cook-pan-sauce", {
    title: "Turn fond into a pan sauce",
    summary: "Convert the browned layer left after searing into a balanced sauce in the same pan.",
    heat: "Medium after the protein leaves the pan; low while finishing with butter.",
    signals: "The liquid loosens the fond, reduces to a glossy film, and coats the back of a spoon.",
    principles: "Fond is concentrated flavor. Deglazing dissolves it, reduction concentrates it, and cold fat emulsifies it into a smooth finish.",
    essentials: "Aromatic, 120-180 ml stock or wine, wooden spoon, acid, and 1-2 tablespoons cold butter.",
    steps: [
      "Remove the cooked protein and pour off excess fat, leaving the browned fond.",
      "Soften a minced shallot or garlic for 30-60 seconds.",
      "Add wine or stock and scrape every browned patch into the liquid.",
      "Reduce until the liquid coats a spoon instead of running like water.",
      "Turn off the heat; whisk in cold butter and adjust with salt and a small amount of acid.",
    ],
    mistakes: "Black fond tastes burnt and cannot be rescued. Boiling after adding butter breaks the emulsion. Season only after reducing because salt concentrates.",
    tags: ["sauces", "pan work", "searing", "reduction", "meat"],
  }),
  createSample("sample-cook-emulsions-dressings", {
    title: "Make vinaigrettes, mayo, and creamy emulsions",
    summary: "Suspend fat and water together with ratio, agitation, and stabilizers.",
    heat: "Usually no heat; use low heat for warm butter sauces and remove before they split.",
    signals: "The sauce looks glossy and unified, clings lightly, and does not leak oil at the edges.",
    principles: "Oil and water separate unless droplets are broken small and held with mustard, egg yolk, garlic, starch, or steady whisking.",
    essentials: "Whisk or jar, bowl, mustard or yolk when needed, oil, vinegar or citrus, salt, and water for thinning.",
    steps: [
      "Start with acid, salt, and any stabilizer.",
      "Whisk or shake while adding oil slowly at first.",
      "Taste and adjust with salt, acid, sweetness, or water.",
      "For broken sauces, whisk a spoonful into a clean bowl with a few drops of water or mustard.",
      "Store chilled and re-whisk before serving.",
    ],
    mistakes: "Adding oil too quickly overwhelms the emulsion. Too much fat makes dressing heavy. Heat breaks butter sauces if they boil.",
    tags: ["sauces", "salads", "emulsion", "no-cook", "flavor"],
  }),
  createSample("sample-cook-grains-rice", {
    title: "Cook rice, grains, and legumes reliably",
    summary: "Control rinsing, soaking, water ratio, salt, and resting for fluffy grains and tender beans.",
    heat: "Bring to a boil, then cover and reduce to low; beans should simmer gently.",
    signals: "Rice surface shows steam holes before resting; grains are tender but separate; beans are creamy inside without splitting apart.",
    principles: "Starch, water absorption, and carryover steam determine texture. Resting lets moisture redistribute instead of leaving a wet bottom and dry top.",
    essentials: "Lidded pot, measuring cup or scale, fine strainer, salt, and a fork or rice paddle.",
    steps: [
      "Rinse rice until the water is less cloudy when separate grains matter.",
      "Use the right water ratio for the grain and pot, then season the water.",
      "Bring to a boil, cover tightly, and lower the heat.",
      "Do not stir rice while it steams; stir grains like farro only when the method calls for it.",
      "Rest covered off heat before fluffing.",
    ],
    mistakes: "Peeking releases steam. Stirring rice activates surface starch and makes it gummy. Old beans may need much longer than the package says.",
    tags: ["rice", "grains", "beans", "meal prep", "basics"],
  }),
  createSample("sample-cook-eggs", {
    title: "Cook eggs by texture, not habit",
    summary: "Scramble, fry, poach, and boil eggs by controlling heat, carryover, and coagulation.",
    heat: "Low for creamy scrambled eggs; medium for fried eggs; gentle simmer for poaching; boil then manage time for boiled eggs.",
    signals: "Eggs shift from glossy and fluid to softly set; remove them before they look fully done because carryover continues.",
    principles: "Egg proteins set with heat and tighten when overheated. Gentle heat gives tender curds; high heat gives crisp edges but can toughen whites.",
    essentials: "Nonstick or well-seasoned pan, butter or oil, spatula, timer, slotted spoon, and ice bath for boiled eggs.",
    steps: [
      "Salt beaten eggs shortly before cooking unless following a long-rest scramble method.",
      "Use lower heat and steady movement for creamy curds.",
      "For fried eggs, heat fat first and control browning by adjusting the flame.",
      "For poached eggs, use fresh eggs and barely simmering water.",
      "Cool boiled eggs quickly when you want the yolk to stop at a specific doneness.",
    ],
    mistakes: "High heat makes scrambled eggs rubbery. Violent boiling shreds poached eggs. Leaving boiled eggs hot creates overcooked yolks.",
    tags: ["eggs", "breakfast", "protein", "heat control", "basics"],
  }),
  createSample("sample-cook-meat-temperature", {
    title: "Cook meat with temperature and resting",
    summary: "Use internal temperature, thickness, carryover, and resting instead of cutting meat open repeatedly.",
    heat: "Hot enough to brown the outside, then lower or indirect heat for thick pieces.",
    signals: "The surface browns, juices settle during rest, and a thermometer confirms the center.",
    principles: "Thickness controls timing more than weight. Carryover heat keeps cooking after removal, and resting reduces juice loss.",
    essentials: "Instant-read thermometer, tongs, paper towel, salt, and a resting plate.",
    steps: [
      "Dry and season meat before cooking.",
      "Brown the exterior without burning the surface.",
      "Move thick cuts to lower heat so the center catches up.",
      "Check temperature in the thickest part, away from bone.",
      "Rest before slicing across the grain when the cut has visible muscle fibers.",
    ],
    mistakes: "Guessing by color alone is unreliable. Cutting immediately spills juices. Cooking cold thick meat over high heat can burn the outside before the middle is done.",
    tags: ["meat", "temperature", "safety", "searing", "roasting"],
  }),
  createSample("sample-cook-fish-seafood", {
    title: "Cook fish and seafood gently",
    summary: "Avoid dry fish and rubbery seafood by using short cooking, careful heat, and visual doneness cues.",
    heat: "Medium to medium-high for searing fillets; low to gentle simmer for poaching; fast high heat for shrimp only when watched closely.",
    signals: "Fish turns opaque and flakes at the thickest point; shrimp curl into a loose C, not a tight O.",
    principles: "Seafood has little connective tissue, so it cooks quickly and toughens fast. Residual heat finishes delicate pieces.",
    essentials: "Dry towel, fish spatula, nonstick or well-seasoned pan, oil, salt, lemon, and thermometer for thick fillets.",
    steps: [
      "Pat seafood dry and season shortly before cooking.",
      "Preheat the pan and add enough oil to prevent sticking.",
      "Start skin-side down for skin-on fillets and press gently for the first seconds.",
      "Flip when the cooked color has climbed most of the way up the side.",
      "Remove slightly early and finish with acid, herbs, or butter.",
    ],
    mistakes: "Moving fish too early tears it. Overcooked shrimp get springy and tight. Wet scallops steam instead of sear.",
    tags: ["fish", "seafood", "protein", "pan work", "quick"],
  }),
  createSample("sample-cook-stir-fry", {
    title: "Stir-fry without making the pan watery",
    summary: "Prep everything first, cook in batches, and move quickly with high heat.",
    heat: "High heat with brief cooking; let the pan recover between batches.",
    signals: "Food sizzles sharply, vegetables stay bright, and sauce glazes instead of pooling.",
    principles: "Stir-frying depends on small cuts, dry surfaces, batch size, and speed. The sauce should reduce around cooked food, not boil raw ingredients.",
    essentials: "Wok or wide skillet, neutral oil, cut vegetables, protein, aromatics, sauce mixed before cooking, and a landing plate.",
    steps: [
      "Cut everything before turning on the stove and mix the sauce in a small bowl.",
      "Dry protein and vegetables well.",
      "Cook protein in a thin layer, remove it, then cook vegetables by hardness.",
      "Add aromatics briefly so they do not burn.",
      "Return everything to the pan, add sauce, and toss until glossy.",
    ],
    mistakes: "Cooking too much at once drops heat and makes liquid collect. Adding sauce too early steams the food. Unprepared ingredients make stir-fry stall.",
    tags: ["stir-fry", "vegetables", "quick", "high heat", "meal prep"],
  }),
  createSample("sample-cook-soups-stocks", {
    title: "Build soups and stocks in layers",
    summary: "Create depth through aromatics, liquid choice, simmering, texture, and final seasoning.",
    heat: "Sweat aromatics gently, simmer steadily, and avoid hard boiling stock.",
    signals: "Aromatics smell sweet, broth tastes rounded, and each ingredient is tender without falling apart unless intended.",
    principles: "Soup is staged extraction. Fat carries aroma, liquid extracts flavor, starch or puree changes body, and final acid wakes everything up.",
    essentials: "Soup pot, aromatics, stock or water, salt, ladle, and an acid or fresh garnish for finishing.",
    steps: [
      "Start with fat and aromatics, sweating or browning depending on the soup.",
      "Add spices or tomato paste briefly when using them.",
      "Add liquid and long-cooking ingredients first.",
      "Simmer until the main ingredient is tender.",
      "Adjust body with reduction, puree, starch, cream, or more liquid.",
      "Finish with salt, acid, herbs, and texture.",
    ],
    mistakes: "Boiling delicate soups turns ingredients ragged. Adding all vegetables together overcooks the quick ones. Forgetting acid makes rich soups taste heavy.",
    tags: ["soups", "stocks", "aromatics", "comfort", "batch cooking"],
  }),
  createSample("sample-cook-baking-basics", {
    title: "Bake with measurement, mixing, and doneness cues",
    summary: "Treat baking as controlled structure: ratio, temperature, mixing, and carryover all matter.",
    heat: "Preheat fully; bake at the recipe temperature unless you know what change you are making.",
    signals: "Edges set first, centers spring back or test clean depending on the item, and browning matches the expected style.",
    principles: "Flour, fat, sugar, eggs, and leavening create structure. Mixing develops or limits gluten, and oven heat sets the shape.",
    essentials: "Scale, measuring spoons, oven thermometer if possible, mixing bowls, spatula, timer, and cooling rack.",
    steps: [
      "Read the recipe and bring ingredients to the temperature it asks for.",
      "Measure accurately, preferably by weight.",
      "Mix only to the texture the recipe describes.",
      "Preheat fully and avoid opening the oven early.",
      "Check doneness with visual cues, touch, temperature, or a tester as appropriate.",
      "Cool as directed so the structure finishes setting.",
    ],
    mistakes: "Scooped flour can add too much dry matter. Overmixing toughens cakes and muffins. Cutting hot baked goods too early can make them collapse or seem gummy.",
    tags: ["baking", "measurement", "oven", "dessert", "basics"],
  }),
  createSample("sample-cook-food-safety-storage", {
    title: "Handle food safely and store leftovers well",
    summary: "Prevent contamination and preserve quality with clean workflow, temperature control, and smart storage.",
    heat: "Cook risky foods to safe internal temperatures; cool leftovers quickly before refrigeration.",
    signals: "Raw and cooked foods stay separate, hot food does not sit out for long, and leftovers are labeled and cooled in shallow containers.",
    principles: "Safety is time, temperature, and separation. Bacteria grow fastest in warm conditions, and cross-contamination can happen before food ever reaches heat.",
    essentials: "Thermometer, clean boards, soap, sanitizer or dishwasher, shallow containers, labels, and refrigerator space.",
    steps: [
      "Wash hands before cooking and after touching raw meat, seafood, eggs, or trash.",
      "Use separate boards or clean thoroughly between raw and ready-to-eat foods.",
      "Cook proteins to appropriate internal temperatures.",
      "Cool leftovers in shallow containers and refrigerate promptly.",
      "Reheat leftovers until steaming hot when safety matters.",
      "Discard food with unsafe time, smell, mold, or storage history.",
    ],
    mistakes: "Rinsing raw poultry can spread contamination. A warm deep pot cools too slowly. Smell alone cannot prove food is safe.",
    tags: ["safety", "storage", "leftovers", "meal prep", "temperature"],
  }),
];

const DEFAULT_SECTIONS = [
  {
    id: "how-to-cook",
    title: "How to Cook",
    description: "Techniques, methods, tools, and repeatable steps for becoming a capable cook.",
    icon: "⌁",
    type: "cooking-guide",
    area: EVERYDAY_AREA,
    items: COOKING_GUIDE_SAMPLES,
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
      createSample("sample-pull-pull-up", {
        category: "pull",
        title: "Pull-up",
        summary: "A vertical pull for building the lats, upper back, biceps, and grip with bodyweight loading.",
        goal: "Lats · upper back · biceps · forearms",
        frequency: "3-5 working sets · 4-10 reps",
        duration: "Rest 2-3 minutes",
        equipment: "Pull-up bar; assistance band or weight belt as needed.",
        exercises: [
          "Start from a controlled hang with ribs down and shoulder blades slightly active.",
          "Drive elbows down toward the ribs instead of reaching with the chin.",
          "Pull until the upper chest approaches the bar without kicking.",
          "Lower under control to a full stretch before the next rep.",
        ],
        progression: "Reduce assistance or add small external load once all sets reach the top of the rep range.",
        notes: "Use a grip width that lets the shoulders move freely. Stop sets before swinging replaces pulling.",
      }),
      createSample("sample-pull-lat-pulldown", {
        category: "pull",
        title: "Lat pulldown",
        summary: "A stable vertical pull that lets the lats and biceps train through a controlled full range.",
        goal: "Lats · biceps · upper back",
        frequency: "3-4 working sets · 8-12 reps",
        duration: "Rest 90-150 seconds",
        equipment: "Pulldown station with bar or neutral handles.",
        exercises: [
          "Set the thigh pad firmly and begin with arms long.",
          "Pull the elbows down and slightly forward of the torso.",
          "Bring the handle to the upper chest without leaning far back.",
          "Return slowly until the lats are stretched.",
        ],
        progression: "Add reps first, then increase the stack when every rep reaches the same depth.",
        notes: "Do not turn the movement into a row by reclining. Keep the torso angle mostly fixed.",
      }),
      createSample("sample-pull-barbell-row", {
        category: "pull",
        title: "Barbell row",
        summary: "A heavy horizontal pull for the upper back, lats, traps, biceps, and trunk bracing.",
        goal: "Upper back · lats · traps · biceps",
        frequency: "3-5 working sets · 5-10 reps",
        duration: "Rest 2-3 minutes",
        equipment: "Barbell and plates.",
        exercises: [
          "Hinge until the torso is angled forward and brace hard.",
          "Let the bar hang under the shoulders with long arms.",
          "Row toward the lower ribs while keeping the torso still.",
          "Lower to a full reach without losing the hinge.",
        ],
        progression: "Add load when the torso angle and bar path stay consistent across all sets.",
        notes: "A stricter row uses less weight but gives clearer back loading. Avoid bouncing every rep from the hips.",
      }),
      createSample("sample-pull-chest-supported-row", {
        category: "pull",
        title: "Chest-supported row",
        summary: "A horizontal row that removes lower-back fatigue and focuses tension on the upper back and lats.",
        goal: "Upper back · lats · rear deltoids · biceps",
        frequency: "3-4 working sets · 8-12 reps",
        duration: "Rest 90-150 seconds",
        equipment: "Incline bench and dumbbells, machine, or seal-row setup.",
        exercises: [
          "Set the chest firmly against the pad and let the shoulders reach forward.",
          "Pull elbows back without lifting the chest off support.",
          "Pause briefly when the shoulder blades move together.",
          "Lower slowly until the upper back opens again.",
        ],
        progression: "Reach the top of the rep range with clean pauses before adding weight.",
        notes: "Use elbow angle to bias the target: tucked for more lats, wider for more upper back and rear delts.",
      }),
      createSample("sample-pull-seated-cable-row", {
        category: "pull",
        title: "Seated cable row",
        summary: "A repeatable row with constant tension for training the lats, mid-back, traps, and biceps.",
        goal: "Lats · upper back · traps · biceps",
        frequency: "3-4 working sets · 8-15 reps",
        duration: "Rest 90-150 seconds",
        equipment: "Cable row station and neutral, wide, or single handles.",
        exercises: [
          "Sit tall with knees soft and torso fixed.",
          "Reach the shoulders forward without rounding aggressively.",
          "Pull handles toward the lower ribs or waist.",
          "Return under control without letting the stack slam.",
        ],
        progression: "Add reps across all sets before increasing the cable stack.",
        notes: "Keep the lean small and repeatable. Momentum should not create the range of motion.",
      }),
      createSample("sample-pull-single-arm-dumbbell-row", {
        category: "pull",
        title: "Single-arm dumbbell row",
        summary: "A unilateral row that trains the lats and upper back while exposing side-to-side differences.",
        goal: "Lats · upper back · biceps · forearms",
        frequency: "3-4 working sets · 8-15 reps per side",
        duration: "Rest 60-90 seconds between sides",
        equipment: "Dumbbell and bench or stable support.",
        exercises: [
          "Support the free hand and keep the hips square.",
          "Let the shoulder blade reach at the bottom.",
          "Row the elbow toward the hip for a lat bias.",
          "Lower slowly and keep the torso from twisting.",
        ],
        progression: "Add controlled reps per side, then move to the next dumbbell.",
        notes: "Use straps if grip limits the back work before the target muscles are challenged.",
      }),
      createSample("sample-pull-face-pull", {
        category: "pull",
        title: "Cable face pull",
        summary: "A rear-delt and upper-back movement that supports shoulder balance and pressing volume.",
        goal: "Rear deltoids · traps · upper back",
        frequency: "2-4 working sets · 12-25 reps",
        duration: "Rest 45-90 seconds",
        equipment: "Cable station with rope attachment.",
        exercises: [
          "Set the cable around face height and hold the rope with thumbs back.",
          "Pull toward the forehead while elbows travel wide.",
          "Rotate slightly so the hands finish beside the temples.",
          "Return slowly with the shoulders controlled.",
        ],
        progression: "Add reps and cleaner pauses before increasing weight.",
        notes: "Keep this light enough that the neck and lower back stay quiet.",
      }),
      createSample("sample-pull-rear-delt-fly", {
        category: "pull",
        title: "Rear-delt fly",
        summary: "An isolation movement for the rear delts and upper back with minimal elbow flexion.",
        goal: "Rear deltoids · upper back · traps",
        frequency: "3-4 working sets · 12-25 reps",
        duration: "Rest 45-90 seconds",
        equipment: "Dumbbells, cables, or reverse pec-deck.",
        exercises: [
          "Hinge or set up on the machine with arms slightly bent.",
          "Sweep the upper arms out and back without turning it into a row.",
          "Pause when the rear delts contract.",
          "Lower slowly and keep tension between reps.",
        ],
        progression: "Add strict reps before adding load.",
        notes: "Small weights are normal. If the elbows bend hard, the biceps and back are taking over.",
      }),
      createSample("sample-pull-barbell-curl", {
        category: "pull",
        title: "Barbell curl",
        summary: "A basic biceps builder that allows both arms to load together with a stable progression path.",
        goal: "Biceps · forearms",
        frequency: "3-4 working sets · 6-12 reps",
        duration: "Rest 60-120 seconds",
        equipment: "Straight barbell or EZ-curl bar.",
        exercises: [
          "Stand tall with elbows near the sides.",
          "Curl without swinging the hips or shoulders.",
          "Squeeze near the top while keeping wrists neutral.",
          "Lower fully under control.",
        ],
        progression: "Use small increases only after every rep stays strict.",
        notes: "An EZ bar is often easier on wrists and elbows than a straight bar.",
      }),
      createSample("sample-pull-incline-dumbbell-curl", {
        category: "pull",
        title: "Incline dumbbell curl",
        summary: "A lengthened-position curl that trains the biceps through a deep stretch.",
        goal: "Biceps · forearms",
        frequency: "3-4 working sets · 8-15 reps",
        duration: "Rest 60-90 seconds",
        equipment: "Incline bench and matched dumbbells.",
        exercises: [
          "Set the bench low enough for the arms to hang behind the torso.",
          "Keep shoulders back against the pad.",
          "Curl without letting elbows drift forward early.",
          "Lower until the biceps are fully stretched.",
        ],
        progression: "Add reps first, then use the next dumbbell pair.",
        notes: "Reduce load if the shoulder rolls forward at the bottom.",
      }),
      createSample("sample-pull-hammer-curl", {
        category: "pull",
        title: "Hammer curl",
        summary: "A neutral-grip curl that trains the biceps, brachialis, and forearms.",
        goal: "Biceps · brachialis · forearms",
        frequency: "3-4 working sets · 8-15 reps",
        duration: "Rest 60-90 seconds",
        equipment: "Dumbbells or rope cable.",
        exercises: [
          "Hold the weights with thumbs up and elbows by the sides.",
          "Curl without rotating the wrists.",
          "Stop near shoulder height without letting elbows swing forward.",
          "Lower slowly to full extension.",
        ],
        progression: "Add reps across both arms before increasing dumbbell weight.",
        notes: "This is useful when straight curls irritate the wrist or elbow.",
      }),
      createSample("sample-pull-shrug", {
        category: "pull",
        title: "Dumbbell shrug",
        summary: "A direct trap and grip exercise with simple loading and minimal technical complexity.",
        goal: "Traps · forearms",
        frequency: "2-4 working sets · 8-15 reps",
        duration: "Rest 60-120 seconds",
        equipment: "Dumbbells, trap bar, or barbell.",
        exercises: [
          "Stand tall with the weights hanging at the sides.",
          "Raise the shoulders straight up without rolling them.",
          "Pause briefly at the top.",
          "Lower until the traps are stretched.",
        ],
        progression: "Increase reps with a real pause before adding weight.",
        notes: "Straps are acceptable if grip fails before the traps receive enough work.",
      }),
      createSample("sample-legs-back-squat", {
        category: "legs",
        title: "Barbell back squat",
        summary: "The primary squat pattern for loading the quads, glutes, adductors, and trunk with heavy weights.",
        goal: "Quads · glutes · adductors",
        frequency: "3-5 working sets · 3-8 reps",
        duration: "Rest 2-4 minutes",
        equipment: "Barbell, rack, plates, and safeties.",
        exercises: [
          "Set the bar firmly on the upper back and brace before unracking.",
          "Step out with a stable stance and keep pressure through the whole foot.",
          "Squat down until depth is controlled and repeatable.",
          "Drive up with hips and chest rising together.",
        ],
        progression: "Add 1-2.5 kg when every set reaches depth with stable bracing.",
        notes: "Choose high-bar or low-bar based on comfort and goal. Do not chase depth by relaxing the lower back.",
      }),
      createSample("sample-legs-front-squat", {
        category: "legs",
        title: "Front squat",
        summary: "A quad-focused squat variation that rewards upright posture and strong trunk bracing.",
        goal: "Quads · glutes · upper back",
        frequency: "3-4 working sets · 4-8 reps",
        duration: "Rest 2-3 minutes",
        equipment: "Barbell, rack, and plates.",
        exercises: [
          "Rack the bar on the shoulders with elbows high.",
          "Brace and descend between the hips while staying tall.",
          "Keep knees tracking with the toes.",
          "Drive upward without letting the elbows collapse.",
        ],
        progression: "Add small loads only when the rack position and torso stay solid.",
        notes: "Use straps or a cross-arm grip if wrist mobility limits the clean rack.",
      }),
      createSample("sample-legs-leg-press", {
        category: "legs",
        title: "Leg press",
        summary: "A machine squat pattern that loads the quads and glutes without as much balance demand.",
        goal: "Quads · glutes · adductors",
        frequency: "3-4 working sets · 8-15 reps",
        duration: "Rest 90-180 seconds",
        equipment: "Leg press machine.",
        exercises: [
          "Set feet where knees can bend deeply without the hips rolling off the pad.",
          "Unlock the sled and lower under control.",
          "Press through the mid-foot without locking the knees violently.",
          "Keep the pelvis and ribs pinned to the seat.",
        ],
        progression: "Add reps through the full range, then increase plates conservatively.",
        notes: "Depth counts only while the lower back stays anchored.",
      }),
      createSample("sample-legs-romanian-deadlift", {
        category: "legs",
        title: "Romanian deadlift",
        summary: "A hip hinge for building hamstrings, glutes, spinal erectors, and loaded stretch tolerance.",
        goal: "Hamstrings · glutes",
        frequency: "3-4 working sets · 6-10 reps",
        duration: "Rest 2-3 minutes",
        equipment: "Barbell or dumbbells.",
        exercises: [
          "Start tall with soft knees and the weight close to the thighs.",
          "Push the hips back while keeping the spine braced.",
          "Lower until the hamstrings are deeply stretched.",
          "Drive the hips forward without leaning back at the top.",
        ],
        progression: "Add reps or load only when the same hinge depth stays controlled.",
        notes: "This is not a squat. The knees bend slightly, but the hips move back.",
      }),
      createSample("sample-legs-deadlift", {
        category: "legs",
        title: "Conventional deadlift",
        summary: "A heavy pull from the floor that trains the glutes, hamstrings, back, and grip.",
        goal: "Glutes · hamstrings · traps · forearms",
        frequency: "2-4 working sets · 3-6 reps",
        duration: "Rest 2-4 minutes",
        equipment: "Barbell and plates.",
        exercises: [
          "Set the bar over mid-foot and grip just outside the legs.",
          "Bring shins to the bar, brace, and pull slack from the bar.",
          "Push the floor away while keeping the bar close.",
          "Lock out with hips through, then lower with control.",
        ],
        progression: "Add small loads when every rep leaves the floor with the same start position.",
        notes: "Stop before technique degrades. Heavy deadlifts usually need less volume than squats or machine work.",
      }),
      createSample("sample-legs-bulgarian-split-squat", {
        category: "legs",
        title: "Bulgarian split squat",
        summary: "A unilateral squat that heavily trains quads, glutes, adductors, and balance.",
        goal: "Quads · glutes · adductors",
        frequency: "3-4 working sets · 8-12 reps per side",
        duration: "Rest 60-120 seconds between sides",
        equipment: "Bench and dumbbells or bodyweight.",
        exercises: [
          "Place the rear foot on a bench and find a front-foot distance that allows depth.",
          "Descend under control with the front knee tracking over the toes.",
          "Keep most pressure through the front foot.",
          "Drive up without bouncing from the bottom.",
        ],
        progression: "Build reps per side before adding dumbbells.",
        notes: "A slight forward torso lean can make the glute contribution clearer.",
      }),
      createSample("sample-legs-walking-lunge", {
        category: "legs",
        title: "Walking lunge",
        summary: "A loaded locomotion pattern for quads, glutes, adductors, and conditioning tolerance.",
        goal: "Quads · glutes · adductors",
        frequency: "2-4 working sets · 8-16 steps per side",
        duration: "Rest 90-150 seconds",
        equipment: "Dumbbells, kettlebells, barbell, or bodyweight.",
        exercises: [
          "Take a long enough step that the front foot stays planted.",
          "Lower until both knees bend under control.",
          "Push through the front foot and bring the back leg forward.",
          "Keep steps smooth and consistent.",
        ],
        progression: "Add steps first, then increase load once stride quality is stable.",
        notes: "Use reverse lunges if walking lunges bother the knees or require too much space.",
      }),
      createSample("sample-legs-leg-extension", {
        category: "legs",
        title: "Leg extension",
        summary: "A quad isolation movement that loads knee extension without hip or balance demands.",
        goal: "Quads",
        frequency: "3-4 working sets · 10-20 reps",
        duration: "Rest 60-90 seconds",
        equipment: "Leg extension machine.",
        exercises: [
          "Set the pad just above the ankles and align the knee with the machine pivot.",
          "Extend until the quads contract hard.",
          "Pause briefly at the top.",
          "Lower slowly without dropping the stack.",
        ],
        progression: "Add reps and top-position control before increasing the stack.",
        notes: "Use a controlled range that feels productive at the knee rather than sharp or pinchy.",
      }),
      createSample("sample-legs-lying-leg-curl", {
        category: "legs",
        title: "Lying leg curl",
        summary: "A hamstring isolation exercise that trains knee flexion with stable body support.",
        goal: "Hamstrings",
        frequency: "3-4 working sets · 10-20 reps",
        duration: "Rest 60-90 seconds",
        equipment: "Lying or seated leg curl machine.",
        exercises: [
          "Align the knees with the machine pivot and keep hips down.",
          "Curl the pad toward the body without arching the lower back.",
          "Pause when the hamstrings contract.",
          "Lower slowly to a full stretch.",
        ],
        progression: "Add controlled reps before raising the weight.",
        notes: "Seated curls bias a longer hamstring position; either variation works if controlled.",
      }),
      createSample("sample-legs-hip-thrust", {
        category: "legs",
        title: "Barbell hip thrust",
        summary: "A glute-focused hip extension movement with high loading and low balance demand.",
        goal: "Glutes · hamstrings",
        frequency: "3-4 working sets · 6-12 reps",
        duration: "Rest 90-180 seconds",
        equipment: "Bench, barbell, plates, and pad.",
        exercises: [
          "Set the upper back against the bench and bar over the hips.",
          "Plant feet where shins are near vertical at the top.",
          "Drive hips upward while keeping ribs down.",
          "Pause in full hip extension, then lower under control.",
        ],
        progression: "Add reps with a clear top pause before increasing load.",
        notes: "Do not turn the top into a lower-back arch. The motion should come from hip extension.",
      }),
      createSample("sample-legs-standing-calf-raise", {
        category: "legs",
        title: "Standing calf raise",
        summary: "A calf movement that emphasizes the gastrocnemius through loaded ankle extension.",
        goal: "Calves · gastrocnemius",
        frequency: "3-5 working sets · 8-15 reps",
        duration: "Rest 45-90 seconds",
        equipment: "Standing calf machine, Smith machine, or dumbbells and a step.",
        exercises: [
          "Set the balls of the feet on the edge with heels free.",
          "Lower until the calves stretch.",
          "Rise as high as possible without bending the knees.",
          "Pause briefly at the top and repeat.",
        ],
        progression: "Add reps with full stretch and top height before adding load.",
        notes: "Calves respond poorly to half reps. Let the ankle move through the full available range.",
      }),
      createSample("sample-legs-seated-calf-raise", {
        category: "legs",
        title: "Seated calf raise",
        summary: "A bent-knee calf raise that emphasizes the soleus and complements standing calf work.",
        goal: "Calves · soleus",
        frequency: "3-5 working sets · 10-20 reps",
        duration: "Rest 45-90 seconds",
        equipment: "Seated calf raise machine or dumbbell setup.",
        exercises: [
          "Set the pad above the knees and place the balls of the feet on the platform.",
          "Lower the heels until the calves stretch.",
          "Press through the big-toe side and rise fully.",
          "Control the descent instead of bouncing.",
        ],
        progression: "Add reps first, then increase load while keeping the same ankle range.",
        notes: "Use both straight-knee and bent-knee calf work if calves are a priority.",
      }),
      createSample("sample-legs-hip-abduction", {
        category: "legs",
        title: "Machine hip abduction",
        summary: "A glute medius and abductor exercise that supports hip stability and side-glute development.",
        goal: "Glutes · abductors",
        frequency: "2-4 working sets · 12-25 reps",
        duration: "Rest 45-90 seconds",
        equipment: "Hip abduction machine or cable cuff.",
        exercises: [
          "Set the machine so the hips stay planted and the range feels controlled.",
          "Open the knees or legs outward without leaning excessively.",
          "Pause at the outer range.",
          "Return slowly without letting the stack crash.",
        ],
        progression: "Add reps and pauses before increasing weight.",
        notes: "A slight forward torso angle can make the side glutes easier to feel.",
      }),
      createSample("sample-legs-hip-adduction", {
        category: "legs",
        title: "Machine hip adduction",
        summary: "An adductor isolation exercise that trains the inner thigh through a stable range.",
        goal: "Adductors",
        frequency: "2-4 working sets · 12-25 reps",
        duration: "Rest 45-90 seconds",
        equipment: "Hip adduction machine or cable cuff.",
        exercises: [
          "Set the starting range wide enough to stretch without discomfort.",
          "Squeeze the legs inward under control.",
          "Pause briefly near the midline.",
          "Return slowly and keep the hips anchored.",
        ],
        progression: "Increase reps with control before adding weight.",
        notes: "Adductors also work in squats and lunges, but direct work can fill gaps cleanly.",
      }),
    ],
  },
  {
    id: "cleaning",
    title: "Cleaning",
    description: "House care and personal hygiene organized into repeatable, searchable routines.",
    icon: "⌂",
    type: "cleaning",
    area: EVERYDAY_AREA,
    items: [
      createSample("sample-clean-kitchen-reset", {
        category: "house",
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
        tags: ["daily", "kitchen", "dishes", "surfaces"],
      }),
      createSample("sample-clean-bathroom", {
        category: "house",
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
        tags: ["weekly", "bathroom", "disinfecting", "hard water"],
      }),
      createSample("sample-clean-floors", {
        category: "house",
        title: "Vacuum and mop floors",
        summary: "Remove dry debris first, then wet-clean only with a product suitable for the floor material.",
        frequency: "Vacuum weekly; spot-clean as needed; mop every 1–2 weeks",
        zone: "Hard floors, rugs, carpet edges, thresholds, and under movable furniture",
        supplies: ["Vacuum with attachments", "Microfiber mop", "Floor-specific cleaner", "Bucket or spray bottle"],
        steps: [
          "Pick up objects and move light furniture before beginning.",
          "Vacuum edges, corners, rugs, and the full floor so grit is not dragged through the mop water.",
          "Test the cleaner on the floor type and use the minimum liquid required.",
          "Mop from the far side toward the exit with overlapping passes.",
          "Let the floor dry before replacing rugs or furniture.",
        ],
        warnings: "Do not soak hardwood or laminate. Never use a product unless it is approved for the installed floor.",
        notes: "Separate vacuum attachments used near food areas from those used in bathrooms when practical.",
        tags: ["weekly", "floors", "vacuuming", "mopping", "dust"],
      }),
      createSample("sample-clean-bedroom", {
        category: "house",
        title: "Bedroom reset",
        summary: "Keep the sleeping area clear, low-dust, and easy to maintain with a short ordered route.",
        frequency: "Five-minute daily reset; fuller clean weekly",
        zone: "Bed, nightstands, dresser, mirrors, floor, and frequently handled surfaces",
        supplies: ["Laundry basket", "Microfiber cloth", "Vacuum", "Glass cleaner if needed"],
        steps: [
          "Open the curtains and air the room if outdoor conditions permit.",
          "Make the bed and move worn clothing to the laundry basket.",
          "Return objects to their homes and clear the floor.",
          "Dust high surfaces before lower furniture.",
          "Vacuum or mop last, including under the bed when accessible.",
        ],
        warnings: "Avoid spraying cleaner directly over bedding or electronics.",
        notes: "Keep the daily reset small; rotate drawers, closet shelves, and under-bed storage into monthly work.",
        tags: ["daily", "weekly", "bedroom", "dust", "decluttering"],
      }),
      createSample("sample-clean-living-area", {
        category: "house",
        title: "Living and common areas",
        summary: "Reset high-use rooms by clearing clutter, dusting top to bottom, and finishing with upholstery and floors.",
        frequency: "Weekly · 25–40 minutes",
        zone: "Living room, dining area, entryway, shelves, electronics, upholstery, and floors",
        supplies: ["Microfiber cloths", "Vacuum with upholstery attachment", "Surface-safe cleaner", "Basket for misplaced objects"],
        steps: [
          "Collect trash, dishes, and objects that belong elsewhere.",
          "Dust shelves, frames, lamps, and furniture from high to low.",
          "Wipe switches, handles, tables, and remote controls.",
          "Vacuum upholstery and beneath removable cushions.",
          "Vacuum or mop the floor and reset pillows and throws.",
        ],
        warnings: "Apply electronics-safe cleaner to the cloth, never directly into screens or openings.",
        notes: "Use one catch-all basket during the route, then empty it immediately so clutter is not merely relocated.",
        tags: ["weekly", "living room", "dust", "upholstery", "decluttering"],
      }),
      createSample("sample-clean-refrigerator", {
        category: "house",
        title: "Refrigerator cleanout",
        summary: "Remove expired food, wash spills, and restore clear zones before odor and residue accumulate.",
        frequency: "Quick check weekly; shelf clean monthly",
        zone: "Shelves, drawers, door bins, seals, handles, and exterior",
        supplies: ["Cooler or insulated bag", "Dish soap", "Warm water", "Microfiber cloth", "Small brush"],
        steps: [
          "Discard spoiled or expired food and move temperature-sensitive items to a cooler.",
          "Remove one shelf or drawer at a time and let cold glass warm before washing.",
          "Wash removable parts with dish soap and dry completely.",
          "Wipe interior walls, seals, handles, and spills.",
          "Return food by category with soonest-to-use items visible at the front.",
        ],
        warnings: "Do not put cold glass directly into hot water. Follow the appliance manual for removable parts and drain openings.",
        notes: "Cleaning small spills when they happen prevents most monthly scrubbing.",
        tags: ["weekly", "monthly", "kitchen", "refrigerator", "food safety"],
      }),
      createSample("sample-clean-oven-cooktop", {
        category: "house",
        title: "Cooktop and oven deep clean",
        summary: "Remove grease and cooked-on residue without damaging heating elements or surface coatings.",
        frequency: "Cooktop weekly; oven every 1–3 months or after major spills",
        zone: "Burners, grates, knobs, cooktop, oven racks, door glass, and interior",
        supplies: ["Degreasing dish soap", "Non-scratch pad", "Baking tray for soaking racks", "Appliance-approved oven cleaner"],
        steps: [
          "Turn the appliance off and let every surface cool.",
          "Remove grates, caps, knobs, and racks only where the manual permits.",
          "Soak removable greasy parts while wiping loose debris from the appliance.",
          "Apply the correct cleaner and allow its labeled dwell time.",
          "Scrub gently, rinse residues thoroughly, dry parts, and reassemble.",
        ],
        warnings: "Do not mix cleaners or apply chemicals to heating elements, ignition ports, or self-cleaning surfaces unless the manual allows it.",
        notes: "Wipe fresh spills after the appliance cools; old carbonized residue takes far longer to remove.",
        tags: ["monthly", "kitchen", "oven", "cooktop", "degreasing"],
      }),
      createSample("sample-clean-glass-windows", {
        category: "house",
        title: "Windows, mirrors, and glass",
        summary: "Clean frames and edges before the glass so the final pass stays streak-free.",
        frequency: "Mirrors weekly; interior windows every 1–3 months",
        zone: "Mirrors, interior window glass, tracks, sills, and glass doors",
        supplies: ["Dry microfiber cloth", "Glass cleaner", "Detail brush", "Squeegee for large panes"],
        steps: [
          "Dust frames, tracks, sills, and the top edge first.",
          "Apply a small amount of cleaner to the cloth or glass.",
          "Wipe the full pane in overlapping strokes.",
          "Dry the perimeter and inspect from an angle for remaining streaks.",
          "Wash reusable cloths without fabric softener.",
        ],
        warnings: "Use stable access equipment; do not lean from windows or mix ammonia-based products with bleach.",
        notes: "Too much product usually creates streaks rather than preventing them.",
        tags: ["weekly", "monthly", "glass", "windows", "mirrors"],
      }),
      createSample("sample-clean-trash-recycling", {
        category: "house",
        title: "Trash and recycling reset",
        summary: "Empty waste before overflow, clean the containers, and prevent odor at the source.",
        frequency: "As needed; inspect on collection day",
        zone: "Kitchen, bathroom, office, bedroom, recycling, and compost containers",
        supplies: ["Replacement liners", "Dish soap or surface cleaner", "Gloves", "Small brush"],
        steps: [
          "Collect every bin and separate recycling according to local rules.",
          "Tie waste bags and take them directly to the collection area.",
          "Remove loose residue and wash any dirty container.",
          "Dry bins completely before adding fresh liners.",
          "Wipe lids, pedals, and nearby wall or floor splashes.",
        ],
        warnings: "Handle broken glass, sharps, batteries, chemicals, and electronics through their correct local disposal streams.",
        notes: "Odor usually means residue remains in the container, not that more fragrance is needed.",
        tags: ["weekly", "waste", "recycling", "odor", "kitchen"],
      }),
      createSample("sample-clean-seasonal-deep-clean", {
        category: "house",
        title: "Seasonal whole-home deep clean",
        summary: "Rotate neglected areas into a bounded project instead of attempting every deep-cleaning task at once.",
        frequency: "Quarterly or at a seasonal change",
        zone: "Behind appliances, vents, baseboards, high shelves, storage, soft furnishings, and overlooked surfaces",
        supplies: ["Vacuum attachments", "Microfiber cloths", "Step stool", "Boxes for keep, donate, and discard"],
        steps: [
          "Choose one room or system rather than opening the whole house at once.",
          "Remove items, decide what stays, and contain donations immediately.",
          "Dust ceiling-level surfaces, vents, walls, and baseboards from high to low.",
          "Move safe, manageable furniture and appliances to clean behind them.",
          "Wash textiles or covers as their care labels permit and restore the room.",
        ],
        warnings: "Do not move heavy appliances alone or disturb suspected mold, asbestos, pests, or damaged wiring.",
        notes: "Keep a rotation list so each season covers different neglected zones.",
        tags: ["seasonal", "whole home", "deep clean", "decluttering", "dust"],
      }),
      createSample("sample-self-shower", {
        category: "self-care",
        title: "Daily shower and body wash",
        summary: "Clean sweat, odor-prone areas, and visible soil without over-scrubbing or stripping the skin.",
        frequency: "As needed; commonly daily and after heavy sweating",
        zone: "Body, skin folds, underarms, feet, and external genital skin",
        supplies: ["Lukewarm water", "Gentle body cleanser", "Clean towel", "Moisturizer if needed"],
        steps: [
          "Use comfortably warm rather than very hot water.",
          "Wash odor-prone and visibly dirty areas with the hands or a clean soft cloth.",
          "Rinse cleanser completely, including skin folds and feet.",
          "Pat dry with a clean towel rather than rubbing aggressively.",
          "Apply moisturizer to damp skin when dryness is a problem.",
        ],
        warnings: "Clean external skin only; avoid fragranced internal cleansing products. Persistent irritation, rash, sores, or unusual discharge needs professional care.",
        notes: "More scrubbing is not always cleaner. Adjust frequency and cleanser strength to activity, climate, and skin response.",
        tags: ["daily", "shower", "body", "skin", "hygiene"],
      }),
      createSample("sample-self-hair-scalp", {
        category: "self-care",
        title: "Hair and scalp wash",
        summary: "Clean the scalp according to oil, sweat, hair texture, styling products, and irritation—not a universal calendar.",
        frequency: "As needed; increase after sweating or visible oil and buildup",
        zone: "Scalp, hair roots, lengths, hairline, and reusable styling tools",
        supplies: ["Shampoo suited to the scalp", "Conditioner suited to the hair", "Wide-tooth comb", "Clean towel"],
        steps: [
          "Thoroughly wet the scalp and hair.",
          "Massage shampoo into the scalp with fingertips rather than scratching with nails.",
          "Rinse completely and repeat only when buildup remains.",
          "Apply conditioner mainly to lengths and ends, then rinse as directed.",
          "Dry gently and clean brushes or combs when product and hair accumulate.",
        ],
        warnings: "Stop products that cause burning or swelling. Persistent severe flaking, pain, sores, or sudden hair loss needs professional evaluation.",
        notes: "Dry shampoo can delay a wash but does not remove oil, dead skin, and product buildup from the scalp.",
        tags: ["hair", "scalp", "shower", "grooming", "as needed"],
      }),
      createSample("sample-self-oral-care", {
        category: "self-care",
        title: "Oral hygiene",
        summary: "Use a consistent brushing and interdental-cleaning routine to remove plaque from teeth and the gumline.",
        frequency: "Brush twice daily for two minutes; clean between teeth daily",
        zone: "Teeth, gumline, tongue, retainers, and reusable oral-care tools",
        supplies: ["Soft-bristled toothbrush", "Fluoride toothpaste", "Floss or interdental cleaner", "Retainer cleaner if applicable"],
        steps: [
          "Brush every tooth surface and the gumline gently for two minutes.",
          "Spit out excess toothpaste and follow product or dental guidance about rinsing.",
          "Clean between teeth with floss or another appropriate interdental cleaner.",
          "Gently clean the tongue and rinse the toothbrush.",
          "Clean retainers or guards according to their instructions and let them dry.",
        ],
        warnings: "Bleeding, pain, swelling, loose teeth, or sores that persist should be assessed by a dental professional.",
        notes: "Replace a frayed toothbrush or brush head; forceful scrubbing does not compensate for missed surfaces.",
        tags: ["daily", "oral care", "teeth", "gums", "hygiene"],
      }),
      createSample("sample-self-face", {
        category: "self-care",
        title: "Face cleansing",
        summary: "Remove sweat, sunscreen, makeup, and debris with a gentle routine that avoids unnecessary friction.",
        frequency: "Up to twice daily and after heavy sweating, adjusted for skin tolerance",
        zone: "Face, hairline, jawline, and neck",
        supplies: ["Gentle non-abrasive cleanser", "Lukewarm water", "Clean soft towel", "Moisturizer"],
        steps: [
          "Wash hands before touching the face.",
          "Wet the face with lukewarm water.",
          "Massage cleanser gently with fingertips without scrubbing.",
          "Rinse completely and pat dry.",
          "Apply moisturizer if the skin feels dry or tight.",
        ],
        warnings: "Stop products that cause persistent burning, swelling, or rash. Avoid abrasive tools and aggressive exfoliation on irritated skin.",
        notes: "Clean pillowcases, phones, glasses, and makeup tools regularly because they repeatedly contact the face.",
        tags: ["daily", "face", "skin", "skincare", "hygiene"],
      }),
      createSample("sample-self-hands-nails", {
        category: "self-care",
        title: "Hands and nails",
        summary: "Keep hands visibly clean and nails short enough that the edges and undersides are easy to maintain.",
        frequency: "Wash at key moments; inspect and trim nails weekly or as needed",
        zone: "Palms, backs of hands, between fingers, thumbs, fingertips, and beneath nails",
        supplies: ["Soap", "Clean running water", "Nail clippers", "Nail file", "Hand moisturizer"],
        steps: [
          "Wet hands, lather with soap, and scrub every surface for about 20 seconds.",
          "Rinse under clean running water and dry thoroughly.",
          "Trim clean nails straight across and smooth sharp edges with a file.",
          "Clean beneath nails without cutting or aggressively pushing the cuticle.",
          "Moisturize when repeated washing causes dryness.",
        ],
        warnings: "Do not share nail tools without cleaning them. Redness, warmth, swelling, pus, or worsening pain can indicate infection.",
        notes: "Wash after bathroom use, before food preparation or eating, after handling waste or dirty laundry, and whenever hands are visibly dirty.",
        tags: ["daily", "weekly", "hands", "nails", "hygiene"],
      }),
      createSample("sample-self-shaving", {
        category: "self-care",
        title: "Shaving and grooming",
        summary: "Reduce irritation by softening hair, using clean tools, and shaving with controlled pressure.",
        frequency: "As needed",
        zone: "Face or body areas being shaved; razor and grooming tools",
        supplies: ["Clean sharp razor", "Shaving cream or gel", "Warm water", "Moisturizer", "Tool disinfectant where appropriate"],
        steps: [
          "Wash the area and soften the hair with warm water.",
          "Apply a lubricating shaving product and allow it to sit briefly.",
          "Shave with light pressure in the direction that causes the least irritation.",
          "Rinse the skin and razor frequently.",
          "Pat dry, moisturize, and let the tool dry completely.",
        ],
        warnings: "Do not share razors. Stop over cuts, inflamed follicles, or broken skin and replace dull or rusting blades.",
        notes: "Fewer passes and a sharper clean blade usually reduce irritation more than pressing harder.",
        tags: ["grooming", "shaving", "skin", "as needed"],
      }),
      createSample("sample-self-laundry", {
        category: "self-care",
        title: "Personal laundry",
        summary: "Sort, wash, dry, and put away clothing without damaging fabrics or leaving damp loads to develop odor.",
        frequency: "Weekly or when a full practical load is ready",
        zone: "Everyday clothing, underwear, socks, activewear, delicates, and hampers",
        supplies: ["Laundry detergent", "Stain treatment", "Mesh bags for delicates", "Drying rack", "Clean hamper"],
        steps: [
          "Check care labels, empty pockets, close fasteners, and pretreat stains.",
          "Separate by color, fabric weight, soil level, and special care needs.",
          "Use the measured detergent amount and the warmest water allowed by the care label.",
          "Dry according to the label and remove items promptly.",
          "Fold or hang clothing and return it to storage; leave the washer and hamper dry.",
        ],
        warnings: "Never mix household chemicals into laundry unless the product label explicitly permits it. Wash hands after handling heavily soiled laundry.",
        notes: "Overloading prevents effective washing and rinsing; excess detergent can leave residue and trap odor.",
        tags: ["weekly", "laundry", "clothing", "activewear", "stains"],
      }),
      createSample("sample-self-linens", {
        category: "self-care",
        title: "Bedding and towels",
        summary: "Rotate linens often enough that sleep and bathing begin with dry, clean fabric.",
        frequency: "Sheets weekly or every 1–2 weeks; towels every 3–4 uses; sooner when soiled or damp",
        zone: "Sheets, pillowcases, duvet covers, bath towels, hand towels, washcloths, and bath mats",
        supplies: ["Laundry detergent", "Spare linen set", "Drying rack or dryer"],
        steps: [
          "Strip the bed and collect towels without shaking heavily so dust stays contained.",
          "Check labels and separate bulky items so they can move freely.",
          "Wash with appropriate detergent and water temperature.",
          "Dry completely before folding or remaking the bed.",
          "Store spare linens only when fully dry and air towels between uses.",
        ],
        warnings: "Never store damp linens. Follow fabric labels for bleach, heat, and specialty fills.",
        notes: "Pillowcases may need more frequent changes when skin is oily, sweating is heavy, or hair products transfer to fabric.",
        tags: ["weekly", "laundry", "bedding", "towels", "bedroom"],
      }),
      createSample("sample-self-footwear", {
        category: "self-care",
        title: "Footwear and odor control",
        summary: "Let shoes dry between uses and clean them according to their materials rather than masking moisture with fragrance.",
        frequency: "Air after every wear; clean as needed",
        zone: "Shoes, insoles, socks, gym bag, and entry storage",
        supplies: ["Soft brush", "Material-appropriate cleaner", "Clean socks", "Drying space"],
        steps: [
          "Remove shoes and allow them to air in a ventilated place.",
          "Take out removable insoles when they are damp.",
          "Brush away dry dirt before applying any cleaner.",
          "Clean according to the shoe material and dry away from damaging direct heat.",
          "Wash socks after each wear and clean the gym bag periodically.",
        ],
        warnings: "Do not place footwear in a washer or dryer unless the manufacturer allows it. Persistent skin cracking, pain, or infection needs professional care.",
        notes: "Alternating pairs gives moisture more time to evaporate and helps prevent odor buildup.",
        tags: ["footwear", "odor", "feet", "gym", "as needed"],
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
    description: "Language-by-language quick facts, core-function mindmaps, syntax sheets, and explained lessons.",
    icon: "⌘",
    type: "language",
    items: [
      createSample("sample-language-javascript", {
        title: "JavaScript refresher",
        summary: "The language model and syntax I need when returning to browser or Node work.",
        quickFacts: [
          "Primary use | Interactive web interfaces, Node.js services, automation, and shared full-stack code.",
          "Typing | Dynamic and weakly typed; TypeScript adds static analysis without changing the runtime.",
          "Execution | A run-to-completion call stack coordinated with task and microtask queues.",
          "Data model | Primitives are copied by value; objects and functions are reference values.",
          "Package ecosystem | npm packages use ES modules or the older CommonJS module system.",
        ],
        coreConcepts: [
          "Values & types | Primitives, objects, arrays, maps, sets, and coercion rules.",
          "Functions & scope | First-class functions, lexical scope, closures, and this binding.",
          "Objects | Prototype delegation, classes, property descriptors, and composition.",
          "Async runtime | Promises, async/await, tasks, microtasks, timers, and cancellation.",
          "Modules | Explicit imports and exports create reusable dependency boundaries.",
          "Web platform | DOM events, fetch, storage, workers, and browser security boundaries.",
        ],
        useWhen: "Interactive browser interfaces, small servers, build tooling, and code that benefits from sharing one language across the stack.",
        mentalModel: "Values flow through a single-threaded event loop. Synchronous code runs to completion; queued tasks and promise callbacks resume later. Objects are reference values and functions close over their lexical scope.",
        syntax: "const unique = [...new Set(values)];\nconst names = records.filter(Boolean).map(({ name }) => name);\nconst result = await fetch(url).then((response) => response.json());\n\ntry {\n  await save(result);\n} catch (error) {\n  console.error(\"Save failed\", error);\n}",
        syntaxReference: "const total = values.reduce((sum, value) => sum + value, 0);\nconst activeNames = records\n  .filter(({ active }) => active)\n  .map(({ name }) => name);\n\nexport async function loadRecord(id, { signal } = {}) {\n  const response = await fetch(`/api/records/${id}`, { signal });\n  if (!response.ok) throw new Error(`Request failed: ${response.status}`);\n  return response.json();\n}\n\ntry {\n  const record = await loadRecord(\"example\");\n  console.log(record);\n} catch (error) {\n  console.error(\"Unable to load record\", error);\n}",
        patterns: [
          "Prefer const; use let only when reassignment is part of the design.",
          "Normalize data at boundaries rather than scattering null checks.",
          "Use async/await for sequencing and Promise.all for independent work.",
        ],
        lessons: [
          "Closures | A function retains access to the lexical bindings that existed where it was created, enabling private state and callbacks that remember context.",
          "Reference values | Assigning an object copies its reference, so mutations are shared; use intentional copying when independent state is required.",
          "Promises and the event loop | Promise continuations run as microtasks after the current stack, before the browser takes the next ordinary task.",
          "Modules as boundaries | Keep side effects at the edges and export small contracts so dependencies remain understandable and testable.",
        ],
        gotchas: "Array and object equality is by identity. sort() mutates and sorts strings by default. await inside a loop is serial. Date parsing and time zones need explicit tests.",
      }),
      createSample("sample-language-python", {
        title: "Python refresher",
        summary: "A compact reference for readable scripts, data work, and small automation.",
        quickFacts: [
          "Primary use | Automation, data and scientific work, backend services, command-line tools, and education.",
          "Typing | Dynamic and strongly typed; optional type hints support static checking and clearer contracts.",
          "Execution | Source compiles to bytecode executed by an interpreter such as CPython.",
          "Data model | Every value is an object; names are bindings and mutability belongs to the object.",
          "Package ecosystem | PyPI packages are installed into isolated virtual environments.",
        ],
        coreConcepts: [
          "Objects & names | Assignment binds a name to an object rather than copying a typed storage slot.",
          "Collections | Lists, tuples, dictionaries, sets, slicing, comprehensions, and iteration protocols.",
          "Functions | First-class callables, positional and keyword arguments, closures, and decorators.",
          "Resource safety | Context managers guarantee cleanup around files, locks, and transactions.",
          "Data modeling | Dataclasses, protocols, type hints, and explicit validation at boundaries.",
          "Concurrency | Threads, processes, asyncio tasks, cancellation, and the limits of the GIL.",
        ],
        useWhen: "Data transformation, scientific work, automation, command-line tools, and services where clarity matters more than browser delivery.",
        mentalModel: "Everything is an object bound to a name. Mutability belongs to the object, not the variable. Iteration protocols and context managers hide resource-handling machinery behind concise syntax.",
        syntax: "from collections import Counter\nfrom pathlib import Path\n\ntext = Path(\"data.txt\").read_text(encoding=\"utf-8\")\nrows = [line.strip() for line in text.splitlines() if line.strip()]\ncounts = Counter(rows)\n\nPath(\"output.txt\").write_text(\"\\n\".join(sorted(rows)), encoding=\"utf-8\")",
        syntaxReference: "from collections import Counter\nfrom dataclasses import dataclass\nfrom pathlib import Path\n\n@dataclass(frozen=True)\nclass Record:\n    name: str\n    score: int\n\nrows = [\n    line.strip()\n    for line in Path(\"data.txt\").read_text(encoding=\"utf-8\").splitlines()\n    if line.strip()\n]\ncounts = Counter(rows)\nrecords = [Record(name, score) for name, score in counts.items()]\n\nwith Path(\"output.txt\").open(\"w\", encoding=\"utf-8\") as output:\n    output.write(\"\\n\".join(record.name for record in records))",
        patterns: [
          "Use pathlib for paths and context managers for resources.",
          "Prefer comprehensions for simple transforms, ordinary loops for branching logic.",
          "Add type hints at module boundaries and dataclasses for stable records.",
        ],
        lessons: [
          "Names and mutability | Rebinding a name does not alter an object, but mutating a shared list or dictionary is visible through every name bound to it.",
          "Iteration protocols | for loops consume iterators, letting lists, files, generators, and custom objects share one traversal model.",
          "Context managers | with pairs acquisition and cleanup so resources close correctly even when the protected block raises.",
          "Type hints as design | Annotations document boundaries and enable tools, but runtime validation remains a separate responsibility.",
        ],
        gotchas: "Mutable default arguments persist between calls. is tests identity, not value equality. A broad except hides programming errors. Local naive datetimes are ambiguous.",
      }),
    ],
  },
  {
    id: "algorithms",
    title: "Algorithms",
    description: "Personal methods, traditional foundations, advanced techniques, and special analysis lessons with clickable topic tags.",
    icon: "⌬",
    type: "algorithm",
    items: [...ALGORITHM_SAMPLES, ...ALGORITHM_ANALYSIS_SAMPLES]
      .map(({ id, ...fields }) => createSample(id, fields)),
  },
  {
    id: "projects",
    title: "Projects",
    description: "Project ideas, animated overviews, architecture, code maps, implementation details, and dependencies.",
    icon: "◇",
    type: "project",
    items: [
      createSample("sample-project-vital-pancakes", {
        title: "Vital Pancakes knowledge archive",
        summary: "A local-first catalogue designed to preserve learned methods, questions, and working tools.",
        status: "Active",
        mainIdea: "Build a durable personal knowledge archive that keeps learning material, practical life systems, and focused work tools understandable without requiring an account or server.",
        overview: "Vital Pancakes is a static installable website. Public archival pages lead into a local-first workspace whose specialized libraries keep subject-specific records in the browser. Dedicated tools handle visual thinking, literature, planning, signing, and software architecture.",
        visualFrames: [
          "public archive > workspace libraries > focused entry",
          "edit locally > save in browser > reopen offline",
          "specialized task > dedicated tool > exported result",
        ],
        frameExplanations: [
          "The public site routes each kind of knowledge into a focused editable library.",
          "Changes remain on the device and the service worker keeps the application shell available offline.",
          "Complex work receives a purpose-built tool instead of being flattened into generic notes.",
        ],
        architecture: "Static HTML pages form the public shell. workspace.html loads a module-based renderer and versioned localStorage store. Subject renderers translate records into specialized layouts. A service worker caches the application shell, while isolated tools own their own pure models and local persistence.",
        codeMap: [
          "app/store.js | Owns schema versions, starter records, migrations, and atomic local persistence.",
          "app/main.js | Routes workspace hashes and renders each subject-specific library, detail page, and editor.",
          "site-navigation.js | Keeps primary navigation, page paths, and history controls consistent.",
          "sw.js | Pre-caches the offline application shell and retires older caches.",
          "tools/*.mjs | Isolate testable models for geometry, planning, annotation, and architecture behavior.",
        ],
        specifics: "Every user value is written through textContent rather than parsed HTML. Core libraries have stable IDs, while entries keep collision-resistant IDs and timestamps. Migrations add new fields and samples without dropping existing user records. Each tool separates DOM orchestration from pure model functions where behavior needs focused tests.",
        dependencies: ["Browser ES modules", "localStorage", "Service Worker API", "Canvas 2D", "PDF.js", "PDF-Lib"],
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
        mainIdea: "Compare nearby destinations by the real effort and experience of reaching them, not only by straight-line distance.",
        overview: "The explorer turns intersections and walkable segments into a weighted graph. Candidate destinations are connected to nearby graph nodes, route costs are calculated, and results are ranked by a configurable mix of distance, crossings, incline, shade, and personal preference.",
        visualFrames: [
          "destination candidates > geocode coordinates > attach to graph",
          "start node > weighted route search > candidate paths",
          "distance + crossings + incline > preference score > ranked routes",
        ],
        frameExplanations: [
          "Places first become coordinates connected to the local walking network.",
          "A shortest-path search produces feasible routes from the user's start.",
          "A transparent scoring layer turns route attributes into a personal ranking.",
        ],
        architecture: "A place-search adapter supplies coordinates, a graph builder normalizes intersections and walkable edges, a routing engine finds candidate paths, and a scoring layer applies user preferences. The interface displays the ranked choices and explains each score.",
        codeMap: [
          "searchPlaces(query) | Resolves an explicit place query into bounded candidate coordinates.",
          "buildWalkingGraph(segments) | Converts map segments into nodes, weighted edges, and route attributes.",
          "findRoute(start, goal) | Runs the selected shortest-path algorithm and reconstructs the path.",
          "scoreRoute(route, weights) | Combines distance, crossings, incline, and preference penalties.",
          "rankDestinations(candidates) | Sorts candidates while retaining a readable score breakdown.",
        ],
        specifics: "Edge weights must never be negative for Dijkstra or A*. Preference scoring should remain separate from graph construction so users can change weights without rebuilding topology. Place-search results need caching and attribution, while every route result should retain predecessor data for reconstruction and explanation.",
        dependencies: ["Map or OpenStreetMap data", "Geocoding/search endpoint", "Priority queue", "Geospatial distance utilities"],
        problem: "The closest place on a map is not always the quickest or most pleasant place to reach because crossings, barriers, and street topology matter.",
        solution: "Represent intersections and paths as a weighted graph, geocode candidate destinations, then compare routes using distance, crossings, incline, and preference penalties.",
        outcome: "Not built yet; the useful artifact is the problem model and its measurable trade-offs.",
        nextStep: "Prototype with one neighborhood and compare graph results against five routes walked in person.",
        languages: ["Python", "JavaScript"],
        algorithmIds: ["sample-algorithm-dijkstra", "sample-algorithm-a-star"],
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
 * Assigns older cleaning records to one of the two permanent cleaning
 * libraries without hiding user-authored entries during migration.
 *
 * @param {object} item Cleaning entry.
 * @returns {"house"|"self-care"} Supported cleaning category.
 */
function getCleaningCategory(item) {
  if (["house", "self-care"].includes(item.category)) {
    return item.category;
  }

  const searchableText = [
    item.title,
    item.summary,
    item.zone,
    ...(item.steps ?? []),
  ].join(" ").toLocaleLowerCase();
  const selfCareTerms = [
    "shower", "body", "hair", "scalp", "oral", "teeth", "face", "skin",
    "hand", "nail", "shav", "groom", "laundry", "clothing", "bedding",
    "towel", "footwear", "shoe", "hygiene",
  ];
  return selfCareTerms.some((term) => searchableText.includes(term)) ? "self-care" : "house";
}

/**
 * Preserves explicit tags and derives a small searchable fallback for older
 * cleaning entries that predate tag filtering.
 *
 * @param {object} item Cleaning entry.
 * @param {"house"|"self-care"} category Cleaning category.
 * @returns {Array<string>} Normalized tags.
 */
function getCleaningTags(item, category) {
  if (Array.isArray(item.tags) && item.tags.length) {
    return [...new Set(item.tags.map((tag) => String(tag).trim().toLocaleLowerCase()).filter(Boolean))];
  }

  const searchableText = [
    item.title,
    item.summary,
    item.frequency,
    item.zone,
  ].join(" ").toLocaleLowerCase();
  const knownTags = [
    "daily", "weekly", "monthly", "seasonal", "kitchen", "bathroom",
    "bedroom", "floors", "laundry", "bedding", "towels", "skin", "hair",
    "hygiene", "grooming", "dust", "decluttering",
  ];
  const inferredTags = knownTags.filter((tag) => searchableText.includes(tag));
  return inferredTags.length ? inferredTags : [category === "house" ? "house care" : "self care"];
}

/**
 * Places older algorithm records into the new three-part library. User-created
 * records become Personal; bundled examples remain part of the curriculum.
 *
 * @param {object} item Algorithm entry.
 * @returns {"personal"|"traditional"|"advanced"|"analysis"} Supported category.
 */
function getAlgorithmCategory(item) {
  if (["personal", "traditional", "advanced", "analysis"].includes(item.category)) {
    return item.category;
  }
  return item.isSample ? "traditional" : "personal";
}

/**
 * Normalizes saved algorithm tags and restores tags for legacy starter records.
 *
 * @param {object} item Algorithm entry.
 * @param {"personal"|"traditional"|"advanced"|"analysis"} category Algorithm category.
 * @param {Map<string, object>} defaultItems Bundled algorithms by identifier.
 * @returns {Array<string>} Clickable filter tags.
 */
function getAlgorithmTags(item, category, defaultItems) {
  if (Array.isArray(item.tags) && item.tags.length) {
    return [...new Set(item.tags.map((tag) => String(tag).trim().toLocaleLowerCase()).filter(Boolean))];
  }
  return [...(defaultItems.get(item.id)?.tags ?? [category])];
}

/**
 * Adds newly bundled fields to an editable starter record without replacing
 * any value the user has already changed.
 *
 * @param {object} item Saved record.
 * @param {object|undefined} defaultItem Current bundled record.
 * @returns {object} Record with only missing default fields added.
 */
function addMissingDefaultFields(item, defaultItem) {
  if (!defaultItem) return { ...item };
  const additions = Object.fromEntries(
    Object.entries(defaultItem)
      .filter(([key]) => item[key] === undefined)
      .map(([key, value]) => [
        key,
        value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
      ]),
  );
  return { ...additions, ...item };
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
      const newWorkoutSamples = cloneDefaultSection(defaultWorkoutSection).items
        .filter((item) => !existingIds.has(item.id));
      workoutSection.items = [...preservedItems, ...newWorkoutSamples];
      changed = true;
    }
  }

  if (previousVersion < 10) {
    const workoutSection = workspace.sections.find((section) => section.id === "workouts");
    const defaultWorkoutSection = DEFAULT_SECTIONS.find((section) => section.id === "workouts");
    if (workoutSection && defaultWorkoutSection) {
      const preservedItems = workoutSection.items ?? [];
      const existingIds = new Set(preservedItems.map((item) => item.id));
      const newWorkoutSamples = cloneDefaultSection(defaultWorkoutSection).items
        .filter((item) => !existingIds.has(item.id));
      workoutSection.items = [...preservedItems, ...newWorkoutSamples];
      changed = true;
    }
  }

  if (previousVersion < 11) {
    const cleaningSection = workspace.sections.find((section) => section.id === "cleaning");
    const defaultCleaningSection = DEFAULT_SECTIONS.find((section) => section.id === "cleaning");
    if (cleaningSection && defaultCleaningSection) {
      cleaningSection.title = defaultCleaningSection.title;
      cleaningSection.description = defaultCleaningSection.description;
      const preservedItems = (cleaningSection.items ?? [])
        .filter((item) => !LEGACY_CLEANING_SAMPLE_IDS.has(item.id))
        .map((item) => {
          const category = getCleaningCategory(item);
          return {
            ...item,
            category,
            tags: getCleaningTags(item, category),
          };
        });
      const existingIds = new Set(preservedItems.map((item) => item.id));
      const newCleaningSamples = cloneDefaultSection(defaultCleaningSection).items
        .filter((item) => !existingIds.has(item.id));
      cleaningSection.items = [...preservedItems, ...newCleaningSamples];
      changed = true;
    }
  }

  if (previousVersion < 12) {
    const cookingSection = workspace.sections.find((section) => section.id === "how-to-cook");
    const defaultCookingSection = DEFAULT_SECTIONS.find((section) => section.id === "how-to-cook");
    if (cookingSection && defaultCookingSection) {
      const preservedItems = cookingSection.items ?? [];
      const existingIds = new Set(preservedItems.map((item) => item.id));
      const newCookingSamples = cloneDefaultSection(defaultCookingSection).items
        .filter((item) => !existingIds.has(item.id));
      cookingSection.items = [...preservedItems, ...newCookingSamples];
      changed = true;
    }
  }

  if (previousVersion < 13) {
    const algorithmSection = workspace.sections.find((section) => section.id === "algorithms");
    const defaultAlgorithmSection = DEFAULT_SECTIONS.find((section) => section.id === "algorithms");
    if (algorithmSection && defaultAlgorithmSection) {
      algorithmSection.title = defaultAlgorithmSection.title;
      algorithmSection.description = defaultAlgorithmSection.description;
      const defaultItems = new Map(
        defaultAlgorithmSection.items.map((item) => [item.id, item]),
      );
      const preservedItems = (algorithmSection.items ?? []).map((item) => {
        const category = getAlgorithmCategory(item);
        return {
          ...item,
          category,
          tags: getAlgorithmTags(item, category, defaultItems),
        };
      });
      const existingIds = new Set(preservedItems.map((item) => item.id));
      const newAlgorithmSamples = cloneDefaultSection(defaultAlgorithmSection).items
        .filter((item) => !existingIds.has(item.id));
      algorithmSection.items = [...preservedItems, ...newAlgorithmSamples];
      changed = true;
    }
  }

  if (previousVersion < 14) {
    const languageSection = workspace.sections.find((section) => section.id === "programming-languages");
    const defaultLanguageSection = DEFAULT_SECTIONS.find((section) => section.id === "programming-languages");
    if (languageSection && defaultLanguageSection) {
      const defaultItems = new Map(defaultLanguageSection.items.map((item) => [item.id, item]));
      languageSection.title = defaultLanguageSection.title;
      languageSection.description = defaultLanguageSection.description;
      languageSection.items = (languageSection.items ?? []).map((savedItem) => {
        const defaultItem = savedItem.isSample ? defaultItems.get(savedItem.id) : undefined;
        const changedUseWhen = savedItem.useWhen && savedItem.useWhen !== defaultItem?.useWhen;
        const changedGotchas = savedItem.gotchas && savedItem.gotchas !== defaultItem?.gotchas;
        const changedMentalModel = savedItem.mentalModel && savedItem.mentalModel !== defaultItem?.mentalModel;
        const changedSyntax = savedItem.syntax && savedItem.syntax !== defaultItem?.syntax;
        const changedPatterns = savedItem.patterns
          && JSON.stringify(savedItem.patterns) !== JSON.stringify(defaultItem?.patterns);
        const normalizedSavedItem = {
          ...savedItem,
          coreConcepts: savedItem.coreConcepts
            ?? (changedMentalModel ? [`Personal mental model | ${savedItem.mentalModel}`] : undefined),
          syntaxReference: savedItem.syntaxReference
            ?? (changedSyntax ? savedItem.syntax : undefined),
          lessons: savedItem.lessons
            ?? (changedPatterns ? savedItem.patterns.map((pattern) => `Practice | ${pattern}`) : undefined),
        };
        const item = addMissingDefaultFields(normalizedSavedItem, defaultItem);
        const personalFacts = [
          defaultItem && changedUseWhen ? `Personal use | ${savedItem.useWhen}` : "",
          defaultItem && changedGotchas ? `Personal warning | ${savedItem.gotchas}` : "",
        ].filter(Boolean);
        return {
          ...item,
          quickFacts: [...personalFacts, ...(item.quickFacts ?? [
            item.useWhen ? `Best for | ${item.useWhen}` : "",
            item.gotchas ? `Watch for | ${item.gotchas}` : "",
          ].filter(Boolean))],
          coreConcepts: item.coreConcepts
            ?? (item.mentalModel ? [`Mental model | ${item.mentalModel}`] : []),
          syntaxReference: item.syntaxReference ?? item.syntax ?? "",
          lessons: item.lessons
            ?? (item.patterns ?? []).map((pattern) => `Practice | ${pattern}`),
        };
      });
      changed = true;
    }

    const algorithmSection = workspace.sections.find((section) => section.id === "algorithms");
    const defaultAlgorithmSection = DEFAULT_SECTIONS.find((section) => section.id === "algorithms");
    if (algorithmSection && defaultAlgorithmSection) {
      const defaultItems = new Map(defaultAlgorithmSection.items.map((item) => [item.id, item]));
      algorithmSection.title = defaultAlgorithmSection.title;
      algorithmSection.description = defaultAlgorithmSection.description;
      const preservedItems = (algorithmSection.items ?? []).map((savedItem) => {
        const defaultItem = savedItem.isSample ? defaultItems.get(savedItem.id) : undefined;
        const changedUseCases = savedItem.useCases && savedItem.useCases !== defaultItem?.useCases;
        const item = addMissingDefaultFields({
          ...savedItem,
          purpose: savedItem.purpose ?? (changedUseCases ? savedItem.useCases : undefined),
        }, defaultItem);
        const category = getAlgorithmCategory(item);
        return {
          ...item,
          category,
          purpose: item.purpose ?? item.useCases ?? "",
          keyIdeas: item.keyIdeas ?? [],
          workedExample: item.workedExample ?? "",
          cCode: item.cCode ?? "",
          javaCode: item.javaCode ?? "",
          frameExplanations: item.frameExplanations ?? [],
          tags: getAlgorithmTags(item, category, defaultItems),
        };
      });
      const existingIds = new Set(preservedItems.map((item) => item.id));
      const newSamples = cloneDefaultSection(defaultAlgorithmSection).items
        .filter((item) => !existingIds.has(item.id));
      algorithmSection.items = [...preservedItems, ...newSamples];
      changed = true;
    }

    const projectSection = workspace.sections.find((section) => section.id === "projects");
    const defaultProjectSection = DEFAULT_SECTIONS.find((section) => section.id === "projects");
    if (projectSection && defaultProjectSection) {
      const defaultItems = new Map(defaultProjectSection.items.map((item) => [item.id, item]));
      projectSection.title = defaultProjectSection.title;
      projectSection.description = defaultProjectSection.description;
      projectSection.items = (projectSection.items ?? []).map((savedItem) => {
        const defaultItem = savedItem.isSample ? defaultItems.get(savedItem.id) : undefined;
        const changedProblem = savedItem.problem && savedItem.problem !== defaultItem?.problem;
        const changedSolution = savedItem.solution && savedItem.solution !== defaultItem?.solution;
        const changedOutcome = savedItem.outcome && savedItem.outcome !== defaultItem?.outcome;
        const item = addMissingDefaultFields({
          ...savedItem,
          mainIdea: savedItem.mainIdea ?? (changedProblem ? savedItem.problem : undefined),
          overview: savedItem.overview ?? (changedOutcome ? savedItem.outcome : undefined),
          specifics: savedItem.specifics ?? (changedSolution ? savedItem.solution : undefined),
        }, defaultItem);
        return {
          ...item,
          mainIdea: item.mainIdea ?? item.problem ?? "",
          overview: item.overview ?? item.outcome ?? "",
          visualFrames: item.visualFrames ?? [],
          frameExplanations: item.frameExplanations ?? [],
          architecture: item.architecture ?? "",
          codeMap: item.codeMap ?? [],
          specifics: item.specifics ?? item.solution ?? "",
          dependencies: item.dependencies ?? [],
        };
      });
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
