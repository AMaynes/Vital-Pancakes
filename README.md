# Vital Pancakes

[View the live website](https://amaynes.github.io/Vital-Pancakes/) · [Open the workspace](https://amaynes.github.io/Vital-Pancakes/workspace.html#area=tools) · [Download the app](https://amaynes.github.io/Vital-Pancakes/download-app.html)

**Vital Pancakes**—*Pinakes Vitae*, comically renamed—is Alex Maynes's living, local-first index of knowledge. It gathers research, literature, studies, everyday-life guides, and working tools into a single enduring catalogue so that what was learned can be found and used again. The project carries forward the spirit of the lost *Pinakes* by *Callimachus*, which catalogued the works of the Library of Alexandria; this version records personally learned knowledge that Alex hopes not to lose, even as forgetting remains inevitable.

The project remains a static website: it needs no server-side application, database, account, or paid hosting platform.

## Running the Project

The site runs on Windows, macOS, and Linux in any current browser. From the repository root, start a local web server:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). Opening files directly from disk is not supported because browser security rules prevent the content and PDF loaders from fetching local files.

## System Overview

GitHub Pages serves the repository as a static website. `index.html` is the public homepage, while `workspace.html` routes the editable Everyday Life, Studies & Projects, and tools-only Workspace areas. `research-literature.html` unifies the research and reading collections, and `download-app.html` provides app previews and installation guidance. `site-navigation.css` and `site-navigation.js` keep the five-section header, file-like page path, and browser-history controls consistent across every page and tool.

Repository-managed lists use small text files containing `<Entry>` blocks. `genericListLoader.js` fetches those files, parses their metadata, sorts entries alphabetically, and renders safe links.

The mathematics and arts flashcard applications load subject-specific `flashcards.json` files. Quiz scores, missed-answer queues, and drafted submissions remain in the visitor's browser through `localStorage`.

The homepage also hosts the shared local Knowledge Center: universal text search, backlinks, related entries, an interactive relationship graph, the global glossary, and the Unified Vault. The workspace uses `app/main.js` for routes and editors and `app/store.js` for its browser-local data model. Each tool under `tools/` is a standalone workspace module. A service worker pre-caches only the bounded homepage and Workspace startup shell; tools, PDF dependencies, and public-archive files are cached after they are used.

Every editable content collection shares one predictable interior structure without flattening its subject matter. The collection index can switch between a compact list and a visual grid, remembers that choice per collection, and opens each item as a dedicated page. Entry pages pair a subject animation and concise orientation with the complete type-specific record—for example, stove-readable recipe steps, training prescriptions, study evidence, runnable language notes, or algorithm traces.

See [STRUCTURE.md](STRUCTURE.md) for the annotated repository map.

## Five Top-Level Sections

- **Everyday Life** — Separate Cooking, Gym, and Cleaning areas for practical knowledge used at home.
- **Research & Literature** — My research manuscripts, selected papers, and literature reviews.
- **Studies & Projects** — Subject-specific working libraries for questions and ideas, structured studies, programming-language refreshers, algorithm labs, and project case studies, plus the existing notecard and educational collections.
- **Workspace** — A browser-local tool shelf spanning planning, files, graphing, knowledge inference, writing, visual design, tournaments, random selection, lessons, captions, finance, conversion, and the Visual Board.
- **Download App** — Animated previews, phone screens, installation instructions, and the supported browser install action.

The interface uses an archival visual system based on warm paper, black ink, oxblood annotations, antique-brass details, sharp rules, engraved typography, and the forest-and-circuit *Vital Pancakes* skull.

## Brand Identity

The public project, navigation, app, repository, and website name is **Vital Pancakes**. The historical **Pinakes Vitae — In Perpetuum** identity remains the project's origin and inspiration.

The canonical logo files are:

- `assets/vital-pancakes-logo-transparent-black.png` — Primary black website mark and light-browser favicon.
- `assets/vital-pancakes-logo-transparent-white.png` — White favicon selected by browsers in dark mode.
- `assets/vital-pancakes-logo-v2.png` — Original flat black-on-white source artwork.
- `assets/pinakes-vitae-logo-final-light.png` — Preserved historical black-ink *Pinakes Vitae* artwork.
- `assets/pinakes-vitae-logo-final.png` — Preserved historical inverted artwork.

The primary logo combines a skull with a forest-like brain, neural-chip circuitry, branching roots, and a bee. Both active variants have true transparent backgrounds: the website always renders the black version, while browser tabs can select black ink in light mode and white ink in dark mode.

## Personal Libraries

The editable areas use nine permanent core libraries. A new or previously empty library receives a small set of fully editable starter entries once; those examples can be rewritten or deleted and do not return after deletion.

- **How to Cook** — A technique atlas organized around heat, sensory signals, underlying principles, ordered methods, and failure recovery.
- **Recipes** — Stove-readable recipe spreads with timing, yield, ingredient preparation, method, and post-cook adjustment notes.
- **Workout Types** — Reusable training prescriptions with purpose, dose, equipment, movement order, coaching notes, and explicit progression rules.
- **Cleaning** — Separate House Cleaning and Self Care libraries with practical routines, blank visual panels, and toggleable tags for quickly filtering by task, area, frequency, or supply.
- **Studies** — Inquiry dossiers that keep the research question, prediction, method, evidence, findings, limitations, and next test distinct.
- **Questions & Ideas** — An investigation board for prompts, possible directions, provisional positions, and development status.
- **Programming Languages** — One field guide per language with Quick Facts, a core-function mindmap, a runnable syntax reference sheet, and specific lessons with explanations.
- **Algorithms** — Personal, Traditional, Advanced, and special Algorithm Analysis libraries with clickable topic filters. Algorithm pages progress from purpose and reasoning through explained step diagrams, English pseudocode, complexity, and real C and Java implementations. The starter curriculum includes seventeen traditional algorithms, five advanced algorithms, and six analysis subjects.
- **Projects** — System blueprints organized around the Main Idea, an explained visual overview, architecture, code and function maps, implementation specifics, deep-linked algorithms, languages, dependencies, outcomes, and next moves.

These nine core libraries cannot be added, renamed, or deleted. Their entries—including every starter example—remain editable and can be deleted after a standard confirmation, with no password requirement. Saved entries from the former Protocols area migrate into an optional Personal Routines library, while existing user-authored algorithms migrate into Personal Algorithms without being discarded.

User-created entries, boards, caption projects, tool projects, literature curations, travel plans, and software architecture models stay in the current browser. They are not uploaded or synchronized. Clearing site data removes them, so important content should be backed up first.

Existing `localStorage` namespaces retain their earlier `pinakes-vitae-*` and `artificially-neuroscience-*` identifiers. They are implementation-level compatibility keys, not public branding, and must remain unchanged unless a migration preserves previously saved user data.

## Knowledge Center and Unified Vault

The homepage builds one browser-local text index across Workspace entries, Studies, generated lessons, literature annotations, algorithms, recipes, projects, tool records, File Drop metadata, supported text files, and extractable PDF text. Searches return bounded snippets and source links. `[[Term]]` references and existing record IDs create automatic relationships; every entry can show backlinks and related records. The graph adds accepted manual links and review-before-accept local WebLLM suggestions without uploading records.

The shared glossary stores definitions, aliases, examples, links, and tags in IndexedDB. Its editor is available from every page, and **Insert** writes a `[[Term]]` reference into the most recently focused text editor or copies it when no editor is active.

Unified Vault exports local settings, discovered user IndexedDB schemas and records, binary values, File Drop bytes, lesson data, annotations, boards, plans, and OPFS files into one chunked `.vpvault` archive. PBKDF2-SHA-256 derives a key from the chosen password and every frame uses authenticated AES-GCM encryption. Entry names and metadata are encrypted along with content. Restore verifies the complete archive before changing storage, supports merge or replace behavior, preserves database keys and indexes, and can be cancelled. Regenerable runtime/model caches and temporary session state are excluded. The password is never stored and cannot be recovered.

## Workspace Tools

### Visual Board

Provides an infinite white workspace for freehand markup, straight lines, arrows with editable start and tip handles, inline textboxes, and resizable or rotatable outlined shapes. Selection outlines and marquee hit-testing stay tight to each object, including narrow rotated geometry around diagonal lines and arrows. Retentive split buttons create rectangles, ellipses, triangles, diamonds, hexagons, cubes, triangular prisms, pyramids, cylinders, and cones: the main button reuses the displayed shape, while only its arrow opens the option menu. Line, Arrow, and shape tools remain active after drawing so several items can be placed without choosing the tool again; Escape clears the current selection and returns to Select.

Every supported line or shape can use solid, dashed, dotted, dash–dot, or long-dash ink. Selected curves expose an Add curve point action: click the path to insert an exact movable on-curve vertex without changing the existing outline, then drag any displayed point to build multiple bends. Moved points recalculate restrained smooth handles so the path stays direct instead of developing hidden loops. Create vertices preserves the exact arc while joining shared endpoints and detected line/curve or curve/curve crossings into common draggable joints. It also expands selected groups, creates all supported internal path vertices, and retains that group beneath the resulting vertex network. Groups can be nested to any practical depth; each Ungroup removes only the current level and restores the smaller groups below it. Lock size makes joint dragging choose the closest cursor position that preserves every attached locked distance exactly. Connected rigged groups move together as a character. The local Board library saves named selections with visual previews and preserves embedded images, nested groups, internal vertices, shared joints, object locks, and size locks when a saved asset is inserted again. Download character exports the same relationship-preserving package as a `.vp-character.json` file that can be dropped back onto the board.

Image and Visual Board character files can be dropped directly onto the board without an upload control. Images are compressed and stored locally as movable, resizable, rotatable board objects. Nothing is uploaded.

Selected images now support non-destructive source-coordinate crops, aspect presets, fit/fill/original-size actions, numeric and handle rotation, replacement, and horizontal or vertical flips. Complete selections and rigged groups flip around their collective center while retaining groups, vertices, joints, locks, arrow direction, and crop state; text remains readable unless glyph mirroring is explicitly enabled. Floor Plan mode organizes modular Structures, Maintenance, Furniture, and Rooms catalogs, with utilities and appliances, two-point dimensions, editable hover labelers, signed non-wrapping levels, snapping, alignment guides, and starter rooms. Labelers combine an editable detection box, vertex-controlled arrow, and boxed text. Dimensions and hover labels have board-wide visibility controls. Selected vector artwork can be saved, inserted, renamed, replaced, removed with the configured password, or used to override a built-in item; hidden or customized defaults can be restored. The general toolbar also includes a persistent-color vector bucket that fills clicked closed objects or connected line-and-curve regions without selecting them, fill removal, a combined Line/Arrow chooser, optional double-ended arrows, brush-local vector erasing that never changes locked objects, and editable grouped joints that merge identities when dropped together. Every inserted building block remains ordinary editable Board geometry. Image-backed assemblies continue to use the general Board library.

AI-directed architectural work uses exact, provider-independent commands for curved material areas, connected wall paths with genuine opening cuts, proportion-preserving vector symbols, world-scaled labels, dimensions, reference overlays, drawing-wide style presets, and non-mutating quality checks. The published catalog includes 10 default layers, 25 materials, 18 fill patterns, 3 architectural style systems, and 133 scalable architecture, furniture, fixture, landscape, vehicle, workshop, gym, and site symbols. Text keeps its declared size in board coordinates instead of reflowing as the camera zoom changes. Visible artwork can be saved from the same scene as editable SVG, high-resolution PNG, or a local PDF.

The Board is deliberately only the drawing instrument: it validates, previews, stores, renders, measures, and atomically applies caller-supplied geometry. It does not infer rooms, select furnishings, repair layouts, or make design decisions for the model. Manual JSON, WebLLM, and connected AI clients all use the same adapter contract described in [AI Commands](docs/AI_COMMANDS.md).

### Local-First Planning and Creation Suite

- **Overhead** combines a brain dump, limited forefront priorities, recurring todo lists, Web Crypto-encrypted private sections, scheduled trackers, reminders, maintenance templates, and inventory warnings. Structured data and histories use IndexedDB; private content auto-locks and cannot be recovered without its password.
- **File Drop** stores file bytes in IndexedDB without base64, adds folders, collections, search, favorites, safe previews, duplicate fingerprints, recoverable trash, quota warnings, manifests, and full backups. Active content is never executed and user files are never pre-cached.
- **Graphing Tool** imports CSV, TSV, JSON, pasted tables, or manual data and renders line, bar, stacked, scatter, bubble, area, histogram, box, pie, donut, heatmap, and multi-series charts from a resettable transformation pipeline. Projects, clean data, SVG, PNG, and combined packages can be exported.
- **Inference Tool** validates selected Vital Pancakes backup collections, excludes sensitive and binary material by default, creates a provenance-preserving local index, retrieves bounded evidence, and asks an explicitly loaded local WebLLM model for cited observations, inferences, hypotheses, and contradictions. Original records are never changed.
- **Markdown & LaTeX Studio** provides multiple local documents, source/split/preview layouts, safe Markdown rendering, math preview, outlines, search/replace, autosave recovery, versions, backup/restore, source and sanitized HTML export, and review-before-apply local model actions. KaTeX is identified as math rendering rather than full LaTeX compilation.
- **Tool Designer & Planner** turns an unstructured idea into locked requirements, goals, workflows, data and module plans, risk review, tests, acceptance criteria, implementation prompts, Markdown handoffs, and versioned project packages with local revision history.
- **Color Aesthetic Generator** creates reproducible perceptual palettes from colors, harmonies, moods, seeds, or local image samples, then checks semantic-role contrast and color-vision simulations and exports code, data, and swatch sheets.
- **Bracket Generator** supports single elimination, double elimination, round robin with playoffs, byes, deterministic tiebreaks, result invalidation, finals reset, scalable bracket views, mobile match lists, and print/data/project exports.
- **Randomized Picker** supports weighted and unweighted draws, replacement rules, ordering, groups, elimination, seeded reproducibility, transparent probabilities, history, undo, and motion-independent wheel results.

These tools share an archival responsive shell, versioned validation, browser-local persistence, and deterministic model tests. Large local-model weights load only after an explicit action and are excluded from the offline application shell.

### PDF Signer

Opens PDFs locally with bundled PDF.js, supports page navigation, creates signatures in three visual styles, adds selectable dates, and allows every placed field to be moved, resized, or deleted before export. Select a signature or date to use its visible trash control, the toolbar action, or Delete/Backspace; Escape clears the selection. The finished file downloads as a genuinely signed PDF with PDF-Lib, and documents never leave the browser.

### Literature Analyzer

Opens local PDFs or a live embedded website, supports click-and-drag highlights with a comment attached to every mark, restores annotations by source, and exports annotated records as PNG or PDF. Comments appear in compact cards directly above their highlights by default and can be moved into a dedicated right-side rail with one toolbar toggle. A 300-step undo and redo history covers highlight creation, recoloring, comment edits, deletion, and complete clearing, with buttons plus standard Command/Ctrl keyboard shortcuts. PDF export writes highlights into the original pages and adds numbered comment pages.

Websites remain governed by their own embedding policies. Because browsers prevent one website from reading another website's rendered pixels, webpage exports preserve the source URL, highlight map, and comments rather than copying the remote page itself.

### Master Lesson Builder

Processes text-based PDF, TXT, and Markdown books entirely in the browser. It extracts numbered pages with bundled PDF.js, removes repeated page furniture, proposes an editable chapter and lesson outline, creates bounded overlapping chunks, and stores books, source text, summaries, lessons, and resumable progress in IndexedDB. Scanned PDFs with little extractable text are rejected with an OCR explanation instead of being treated as processed books.

An explicitly loaded small or medium WebLLM model runs in a dedicated Web Worker through WebGPU. Model files are downloaded from the WebLLM distribution on first use, cached by WebLLM in browser storage, and excluded from the normal service-worker precache. Deterministic BM25 retrieval limits chat to relevant source chunks; generated page citations are discarded unless they match a real retrieved chunk and page. Approved lessons remain editable, export as Markdown or JSON, and save into Studies as backward-compatible lesson entries without changing existing inquiry dossiers.

Adaptive Review Studio converts each lesson's generated flashcards and key concepts into a persistent review deck. It provides due queues, flashcard and deterministic quiz modes, editable and suspendable cards, review history, undo, retention and daily-new-card settings, and Again/Hard/Good/Easy interval previews. Scheduling uses the pinned MIT-licensed `ts-fsrs` 5.4.1 browser module locally. Regenerating a lesson refreshes source-derived text while preserving existing FSRS memory state and manual card edits; whole-book JSON exports include cards, settings, and review logs.

Books and generated content never leave the browser. The first model load requires a network connection, a WebGPU-capable browser, sufficient storage, and approximately 0.9 GB of GPU memory for the small model or 2.3 GB for the medium model. Local model output remains probabilistic and should be checked against its cited source pages.

### Caption Relay

Provides one integrated **Capture → Translate → Display** pipeline for personal accessibility. It captures shared-tab audio with `getDisplayMedia`, transcribes bounded overlapping chunks in a worker, maps accelerated captures back to the original movie timeline, and discards raw audio after local inference. Completed and interrupted projects, caption text, glossary entries, compact 1× fingerprints, and text synchronization indexes use the separate `vital-pancakes-caption-relay` IndexedDB namespace. Packages, SRT, and WebVTT can be edited and round-tripped without changing millisecond timestamps.

English speech recognition uses pinned Transformers.js 3.8.1 with Apache-2.0 `onnx-community/whisper-tiny.en` revision `2575352` or `Xenova/whisper-small.en` revision `529f2fb`. English → Vietnamese translation prefers Chrome's local Translator API, then falls back to Apache-2.0 `Xenova/opus-mt-en-vi` revision `30bcd46` through the same pinned runtime. Model runtimes and weights download only after an explicit prepare action, use browser-managed caches, and are intentionally excluded from the normal application-shell precache.

At display time, 1× packages match compact spectral fingerprints from the same source audio. Accelerated packages use rolling English transcription and fuzzy cue matching because ordinary fingerprints are not reliably speed invariant. Low-confidence or unrelated audio hides captions and reports **No matching video detected**. Supported desktop Chromium browsers can use an always-on-top Document Picture-in-Picture overlay; other desktop browsers receive a popup fallback. Mirror Mode keeps captured video and captions in one document for fullscreen, but protected media may be blank and capture can add latency, reduce quality, interrupt, or duplicate audio.

Captured movie audio, transcripts, translations, fingerprints, and packages are never uploaded by Vital Pancakes. No raw movie media is permanently stored or included in exports. Caption Relay has no DRM bypass, analytics, backend, account, or direct control over another website. Desktop Chrome and Edge are the primary targets; mobile browsers, missing tab-audio sharing, limited storage, model download failures, and browser capture restrictions are reported honestly.

### Literature Curation

Organizes literature analyses around a clearly stated idea, claim, or hypothesis. Each source can be classified as supporting, complicating, contradicting, or contextualizing the target, then recorded with its citation, source link, key finding or passage, personal analysis, and limitations.

Curations and analyses stay in the current browser. Each curation includes an evolving synthesis, relationship counts, editing and deletion controls, and a Markdown export that preserves the complete evidence trail.

### Travel Planner

Provides a month calendar with overhead Select and Add Event tools. Multiple selected dates become paged, arrow-controlled 24-hour day timelines on the right. Add Event keeps the tool active and opens a compact editor above the clicked calendar day; existing events can be reopened there for editing or deletion.

Event titles, strict `HH:MM` 24-hour times, places, and notes stay in the current browser. Address and business searches run only after the Search button is pressed, use a rate-limited configurable Nominatim-compatible endpoint with local result caching and OpenStreetMap attribution, and fill the event's map-ready place field. Search queries leave the browser; saved travel plans do not. The tool has no reminders, notifications, accounts, synchronization, or external calendar integration.

### Software Architect

Provides a permanent `root/` folder and an editable file-tree workspace with aligned notes for every item. Folders and files spawn with blank placeholder names, can be renamed inline, and can be dragged into other folders. Individual nodes and the complete workspace can be cleared after a standard confirmation, with no password requirement.

Software architecture data saves locally, preserves legacy file nodes and system scopes through migration, and can be exported as JSON.

### File Converter

Hosts a same-site build of the complete GPL-2.0 [Convert to it!](https://github.com/p2r3/convert) application as a full-height Workspace tool. Its conversion graph covers images, audio, video, documents, archives, data, fonts, code, databases, and specialist formats through browser-compatible engines including FFmpeg, ImageMagick, and Pandoc.

The optional byte-for-byte check converts each result back to its starting format and compares every returned byte with the original before download. It reports exact matches, the first changed byte or length, and unavailable reverse routes. Because metadata and encoders can produce different bytes for equivalent content, an exact failure does not automatically mean visible or audible quality was lost.

Files are processed by the converter inside the browser and are not uploaded by Vital Pancakes. The interface and format cache are available in the app shell; larger WebAssembly engines lazy-load from the official upstream deployment, so a conversion engine needs a network connection the first time it is used.

### Scientific Calculator

Evaluates nested scalar expressions with math.js, high-precision decimal arithmetic, standard operator precedence, implicit multiplication, powers, roots, factorials, logarithms, trigonometry, and DEG/RAD/GRAD modes. Results can be reused through `ans`, calculator memory, and locally saved history.

### Budget & Finance

Projects recurring income and expenses across exact calendar dates and reports gross income, gross expenses, and net cash flow. Its add-on views calculate amortized investment growth with contributions and fixed-rate loan repayment schedules with optional extra payments.

The tax finder indexes federal resources plus all 50 states and the District of Columbia across major individual, business, payroll, property, estate, sales, excise, local, and special-tax categories. It stores official IRS source links rather than frozen rates so current state and local rules can be verified at the authority.

## Adding List Content

Public archive lists use this format:

```text
<Entry>
Name: "Document Title"
PDF-Path: "relative/path/to/document.pdf"
Description: "Optional short explanation."
<Entry-End>
```

Add entries to the appropriate research, literature, or discipline-specific text file. Paths are resolved relative to the page that loads the list.

## Adding Flashcards

Flashcards live in each discipline's `flashcards.json` and are grouped into categories and subcategories:

```json
{
  "question": "What is the derivative of $x^2$?",
  "answer": "$2x$"
}
```

Mathematics cards support KaTeX using `$...$` for inline expressions and `$$...$$` for display expressions.

## Installation and Offline Use

Open the **Download App** section after the site is loaded over HTTPS:

- On iPhone or iPad, use Safari's Share menu and choose **Add to Home Screen**.
- On Android or a supported desktop browser, use the page's **Install app** button or the browser's installation action.

The app shell, tools, public pages, data files, and repository PDFs are cached for offline access. Remote KaTeX assets used by the legacy flashcard pages may still require a previously populated browser cache for full equation rendering. Caption Relay itself is cached, but its large speech and translation models are not part of the application shell; each selected model needs a first online download and works offline later only while its browser-managed cache remains available.

## Testing and Deployment

Serve the repository locally and run browser acceptance checks against `http://localhost:8000`. JavaScript source can also be syntax-checked with Node.js.

Run every maintained model and geometry test from the repository root:

```bash
node --test app/*.test.mjs tools/*.test.mjs
```

Production is hosted from the `main` branch with GitHub Pages. Publishing requires committing and pushing the verified static files; there is no build step.

## Dependencies

- A current browser with ES modules, Canvas 2D, service workers, localStorage, IndexedDB, and dialog support
- WebGPU for Master Lesson Builder model inference; WebLLM 0.2.83 lazy-loads from its documented CDN only after an explicit model-load action
- Desktop `getDisplayMedia`, Web Audio, AudioWorklet, and Web Workers for Caption Relay capture; Document Picture-in-Picture is optional
- Transformers.js 3.8.1, Whisper Tiny/Small English, and OPUS-MT English → Vietnamese lazy-load from pinned CDN/model revisions; the runtime and all three models are Apache-2.0
- Chrome 138 or newer can provide the preferred built-in local Translator API; other supported desktop browsers use the local OPUS-MT fallback
- Python 3 for the documented local server command
- Node.js 18 or newer for the maintained test suite
- GitHub Pages for production hosting
- Bundled PDF.js 3.11.174 and PDF-Lib 1.17.1
- KaTeX 0.16.9 from jsDelivr for flashcard equation rendering

## Additional Information

- [TODO.md](TODO.md) tracks immediate and eventual work.
- [STRUCTURE.md](STRUCTURE.md) documents each maintained folder and file.
- The repository intentionally avoids analytics, accounts, and remote persistence.
- This is a personal academic website by Alex Maynes. Content and code structure are available for reference.
