# Project Structure

## Structure at a Glance

```text
vital-pancakes/
├── .gitignore — Excludes local operating-system, editor, log, temporary, and artwork-iteration files.
├── .hintrc — Configures webhint for local HTML development.
├── .vscode/
│   └── settings.json — Stores shared VS Code and Live Server settings.
├── README.md — Explains the public site, workspace, tools, and deployment.
├── TODO.md — Tracks pressing and eventual work.
├── STRUCTURE.md — Maps the maintained repository.
├── index.html — Serves as the public homepage and project entry point.
├── style.css — Defines the public site's archival visual system.
├── site-navigation.css — Styles the shared header, page path, and history controls.
├── site-navigation.js — Builds the file-like page path and browser-history controls.
├── research-literature.html — Unifies research, publications, and reading analysis.
├── download-app.html — Presents phone previews and the install guide.
├── download-app.css — Styles app previews and archival motion accents.
├── workspace.html — Routes Everyday Life, Studies & Projects, and tools.
├── workspace.css — Defines the workspace and tool visual system.
├── manifest.webmanifest — Describes the installable workspace app.
├── sw.js — Caches the workspace, public archive, and tools for offline use.
├── genericListLoader.js — Renders repository-managed text lists.
├── app/
│   ├── main.js — Renders workspace routes, libraries, and editors.
│   ├── download-app.js — Connects the install page to supported PWA prompts.
│   ├── store.test.mjs — Verifies permanent libraries, one-time samples, and safe legacy migration.
│   └── store.js — Owns browser-local data, persistence, and deletion policy.
├── assets/
│   ├── vital-pancakes-logo-transparent-black.png — Active black transparent site mark and light-mode favicon.
│   ├── vital-pancakes-logo-transparent-white.png — White transparent dark-mode favicon.
│   ├── vital-pancakes-logo-v2.png — Flat black-on-white source artwork for the active logo.
│   ├── pinakes-vitae-logo-final-light.png — Canonical black-ink logo on white.
│   ├── pinakes-vitae-logo-final.png — Companion white-ink logo on charcoal.
│   ├── app-icon-192.png — Small install and shortcut icon derived from the logo.
│   ├── app-icon-512.png — Large maskable install icon derived from the logo.
│   ├── app-preview-workspace.svg — Phone preview of workspace tools.
│   └── app-preview-studies.svg — Phone preview of study libraries.
├── tools/
│   ├── tool.css — Shares full-screen and windowed tool layouts and controls.
│   ├── visual-board.html — Hosts diagramming and painting.
│   ├── visual-board.js — Coordinates the infinite canvas, tools, persistence, and export.
│   ├── visual-board-clipboard.mjs — Duplicates selected board objects while preserving internal relationships.
│   ├── visual-board-clipboard.test.mjs — Verifies multi-object clipboard duplication and identifier remapping.
│   ├── visual-board-geometry.mjs — Provides pure hit-testing, bounds, rotation, and resizing math.
│   ├── visual-board-geometry.test.mjs — Verifies Visual Board geometry with Node's test runner.
│   ├── visual-board-rich-text.mjs — Stores, edits, and renders per-range textbox colors.
│   ├── visual-board-rich-text.test.mjs — Verifies highlighted color ranges and edit preservation.
│   ├── visual-board-shape-tools.mjs — Retains the independent 2D and 3D split-button choices.
│   ├── visual-board-shape-tools.test.mjs — Verifies shape families and retained-option behavior.
│   ├── visual-board-text.mjs — Keeps declared font sizes readable at overview zoom.
│   ├── visual-board-text.test.mjs — Verifies zoom-aware text rendering and click-created dimensions.
│   ├── visual-board-vertices.mjs — Builds and reshapes grouped line networks with shared editable vertices.
│   ├── visual-board-vertices.test.mjs — Verifies vertex merging, preservation, and connected-line reshaping.
│   ├── pdf-signer.html — Hosts local PDF viewing and signing.
│   ├── pdf-signer.js — Renders PDFs and embeds placed signatures and dates.
│   ├── pdf-signer-placements.mjs — Owns immutable deletion of placed PDF fields.
│   ├── pdf-signer-placements.test.mjs — Verifies placed-field deletion behavior.
│   ├── literature-analyzer.html — Hosts PDF and website reading, highlighting, and comments.
│   ├── literature-analyzer.css — Styles the split reading and annotation workspace.
│   ├── literature-analyzer.js — Owns source loading, persistence, comments, and exports.
│   ├── literature-analyzer-model.mjs — Provides highlight geometry, stored-data validation, and bounded history.
│   ├── literature-analyzer-model.test.mjs — Verifies highlighting, PDF coordinates, and undo/redo history.
│   ├── literature-curator.html — Hosts idea, claim, and hypothesis evidence curation.
│   ├── literature-curator.css — Styles the curation index and evidence matrix.
│   ├── literature-curator.js — Owns local curation editing, persistence, and Markdown export.
│   ├── literature-curator-model.mjs — Validates curations and immutable analysis updates.
│   ├── literature-curator-model.test.mjs — Verifies validation, evidence categories, and updates.
│   ├── travel-planner.html — Hosts overhead tools, month selection, day pages, and the anchored event editor.
│   ├── travel-planner.css — Styles the month grid, 24-hour timeline, place results, and event popover.
│   ├── travel-planner.js — Renders multi-day selection, editing, place search, and local persistence.
│   ├── travel-planner-config.json — Selects the replaceable Nominatim-compatible place-search endpoint.
│   ├── travel-planner-model.mjs — Owns calendar dates, selection, 24-hour times, and saved-plan validation.
│   ├── travel-planner-model.test.mjs — Verifies Travel Planner model behavior.
│   ├── travel-place-search.mjs — Builds explicit search requests and validates returned places.
│   ├── travel-place-search.test.mjs — Verifies place-query and result trust boundaries.
│   ├── architecture.html — Hosts the permanent-root folder structure and aligned notes.
│   ├── architecture.js — Renders and persists editable tree interactions.
│   ├── architecture-model.mjs — Owns migration, nesting, movement, and deletion policies.
│   └── architecture-model.test.mjs — Verifies Software Architect model behavior.
├── vendor/
│   ├── pdf.min.js — Bundled PDF.js viewer runtime.
│   ├── pdf.worker.min.js — Bundled PDF.js worker.
│   └── pdf-lib.min.js — Bundled PDF-Lib editing runtime.
├── CheatSheets/
│   ├── Algebra-MasterSheet.pdf — Algebra reference sheet.
│   ├── Calculus-MasterSheet.pdf — Calculus reference sheet.
│   └── Trigonometry-MasterSheet.pdf — Trigonometry reference sheet.
├── educational_resources/
│   ├── flashcards.css — Shares the compact archival notecard interface.
│   ├── index.html — Introduces the four learning disciplines.
│   ├── arts/
│   │   ├── index.html — Presents arts notes and practice.
│   │   ├── arts_notes_list.txt — Lists arts notes and resources.
│   │   ├── flashcard-practice.html — Runs arts flashcard practice.
│   │   └── flashcards.json — Stores arts cards and categories.
│   ├── compsci/
│   │   ├── index.html — Presents computer-science resources.
│   │   └── compsci_notes_list.txt — Lists computer-science resources.
│   ├── mathematics/
│   │   ├── index.html — Presents mathematics references and practice.
│   │   ├── mathematics_notes_list.txt — Lists mathematics references.
│   │   ├── flashcard-practice.html — Runs mathematics flashcard practice.
│   │   └── flashcards.json — Stores mathematics cards and categories.
│   └── neurosci/
│       ├── index.html — Presents neuroscience resources.
│       └── neurosci_notes_list.txt — Lists neuroscience resources.
├── literature_analysis/
│   ├── index.html — Presents critical-reading analyses.
│   └── lit_analysis_list.txt — Lists analysis documents.
└── research_publications/
    ├── index.html — Presents original and selected publications.
    ├── publications.txt — Lists original publications.
    ├── extra-publications.txt — Lists selected external publications.
    └── pdfs/
        ├── dobotpub.pdf — Original DOBOT education publication.
        └── synaptic-info-storage-pub.pdf — Selected synaptic information paper.
```

Generated Git internals and machine-local files are not architectural components and are not expanded here.

---

## Root Files

### `README.md`

Introduces the project, its supported local run path, persistence boundaries, tool capabilities, installation, dependencies, and deployment.

### `TODO.md`

Tracks actionable work in two priority groups. Completed work is removed; reprioritized work moves between groups.

### `STRUCTURE.md`

This authoritative human-readable repository map. Update it when a maintained path or ownership boundary changes.

### `index.html`

The public entry point. It introduces and links exactly five top-level sections: Everyday Life, Research & Literature, Studies & Projects, Workspace, and Download App.

### `style.css`

The public site's archival design language: warm paper, black ink, oxblood annotations, antique-brass details, engraved typography, information-dense responsive layouts, content cards, and list states.

### `site-navigation.css` and `site-navigation.js`

The canonical Vital Pancakes header, anatomical brand mark, and primary Everyday Life, Research & Literature, Studies & Projects, Workspace, and Download App navigation used by every public page and tool. The script also inserts an always-present, file-like page path with back and forward history controls directly beneath the header.

### `research-literature.html`

The single top-level home for research publications, selected research, and analysis of every literature type. It routes into the existing focused collections.

### `download-app.html` and `download-app.css`

The compact install destination with animated archival diagrams, phone preview screens, offline guidance, and responsive installation steps.

### `workspace.html`

The accessible application shell for three hash-routed areas. Everyday Life owns separate Cooking, Gym, and Cleaning libraries; Studies & Projects owns editable knowledge libraries and notecards; Workspace displays tools only. Every core library opens into a subject-specific working surface instead of a generic list.

### `workspace.css`

The public-site-aligned archival workspace tokens, full-width responsive shell, ruled cards, editors, dialogs, toasts, and tool-compatible styles. It also defines distinct technique-atlas, recipe-book, training-log, care-manual, study-dossier, idea-board, language-reference, algorithm-lab, and project-casebook layouts.

### `manifest.webmanifest`

Defines standalone display behavior, theme colors, app identity, install icons, and area shortcuts. Its start URL opens the tools Workspace.

### `sw.js`

Pre-caches the workspace, tool code, public pages, data files, PDF libraries, repository PDFs, and mathematics reference sheets. It serves same-origin GET requests cache-first and removes older app-shell caches.

### `genericListLoader.js`

Fetches files selected by `data-list-source`, parses valid `<Entry>` blocks, sorts entries, renders safe links, and owns loading, empty, and failure states.

## Workspace Application

### `app/main.js`

Renders the Everyday Life, Studies & Projects, and Workspace routes beneath the permanent top navigation; owns the nine subject-specific library presentations, type-aware records and editors, Questions & Ideas records, relationships, dialogs, and local notices.

### `app/store.js`

Defines the browser-local data schema, nine permanent core libraries, deterministic editable starter entries, the one-time version 7 empty-library seeding migration, Questions & Ideas migration, Protocols-to-Personal-Routines migration, persistence, identifiers, and entry operations. Populated libraries are never overwritten, and examples remain deleted after the migrated workspace is saved. Its legacy `artificially-neuroscience-*` storage key is retained deliberately so the rebrand does not orphan existing browser data.

### `assets/`

Contains the transparent black and white variants of the forest-and-circuit *Vital Pancakes* skull, its original flat source, the earlier light and dark *Pinakes Vitae* artwork retained as historical assets, install icons, and the two phone preview screens used by Download App. The website uses the black transparent mark; browser tabs select the black or white favicon according to the browser color scheme.

## Tools

### `tools/tool.css`

Shares responsive full-screen and windowed layouts, controls, panels, canvas surfaces, signature controls, annotation surfaces, calendar controls, and editable file-tree interfaces.

### Visual Board

`visual-board.html` hosts the organized creation, selection, view, history, and style controls, including persistent 2D and 3D shape menus, copy and paste tools, contextual textbox typography, and grouping actions. `visual-board.js` owns the unbounded world-coordinate camera, mouse and trackpad navigation, repeated line, arrow, and shape placement, Escape-to-Select behavior, freehand drawing, brush erasing, straight lines, arrows with editable start and tip handles, inline textboxes, tight per-object selection outlines, marquee selection, multi-object copy and paste, locking, stroke patterns, guarded object grouping, editable shared-vertex networks, shape division and reassembly, grid snapping, 300-action undo and redo history, local autosave, and PNG export. Dropped images are compressed and retained as local board assets; they are never uploaded.

`visual-board-clipboard.mjs` deep-copies selected objects, offsets pasted copies, and remaps group, divided-shape, and vertex-network identifiers without mutating the originals. Its adjacent test file verifies those relationships. `visual-board-geometry.mjs` isolates the pure geometry used for reusable 2D and 3D segment outlines, world bounds, tight rotated line selections, rotated handles, hit testing, outline-aware marquee intersection, grid snapping, corner-based resizing, and shape division. `visual-board-geometry.test.mjs` exercises those contracts with Node's built-in test runner. `visual-board-vertices.mjs` merges touching endpoints into shared controls and applies vertex movement to every incident line; its test file covers both merged and independent vertices.

### PDF Signer

`pdf-signer.html` hosts the local workflow. `pdf-signer.js` loads a chosen PDF with bundled PDF.js, manages page navigation and selectable, movable, resizable, or deletable signature and date placements, and embeds the remaining fields into a downloadable PDF with PDF-Lib. Selected fields expose an inline trash control and can also be deleted from the toolbar or keyboard. `pdf-signer-placements.mjs` owns immutable removal from export state, with an adjacent Node test suite.

### Literature Analyzer

`literature-analyzer.html` and `literature-analyzer.css` provide a split source, comment, and reading workspace with inline comment cards and a toggleable right-side comment rail. `literature-analyzer.js` opens local PDFs or sandboxed website frames, stores source-specific highlights and comments locally, owns 300-step undo and redo for annotation changes, exports annotated PDF pages with a comment appendix, and creates PNG or PDF annotation maps for webpages whose pixels remain protected by cross-origin browser security. `literature-analyzer-model.mjs` provides normalized geometry, stored-data validation, and immutable bounded annotation-history operations.

`literature-analyzer-model.mjs` owns normalized rectangle creation, persisted annotation validation, and PDF coordinate conversion. Its Node test suite covers reverse drags, clamping, minimum sizes, malformed storage, and the PDF vertical-axis transform.

### Literature Curation

`literature-curator.html` and `literature-curator.css` provide a local curation index, editable target statement and synthesis, relationship totals, and a four-part evidence matrix for sources that support, complicate, contradict, or contextualize an idea, claim, or hypothesis. `literature-curator.js` owns creation, editing, deletion, local persistence, safe source links, and Markdown export.

`literature-curator-model.mjs` isolates storage-boundary validation and immutable curation and analysis updates. Its Node test suite covers malformed records, unsafe source URLs, relationship counts, and preservation of prior state during updates.

### Travel Planner

`travel-planner.html` and `travel-planner.css` provide overhead Select and Add Event tools, a six-week month calendar, a multi-selected day pager, complete 24-hour timelines, and a calendar-anchored event editor. `travel-planner.js` keeps plans in local browser storage, preserves strict `HH:MM` time display, and performs only explicit user-submitted place searches through the configured endpoint. Search results are rate-limited, cached locally, attributed to OpenStreetMap, and can populate map-ready places without adding reminders, notifications, accounts, sync, or calendar integrations.

`travel-planner-model.mjs` owns date generation, validation, multi-day selection, 24-hour time validation, sanitization, ordering, querying, updates, and removal. `travel-place-search.mjs` isolates external query construction and untrusted result validation. Their Node test suites cover calendar boundaries, leap dates, selection order, time limits, malformed persistence, deterministic ordering, the complete plan lifecycle, HTTPS request construction, and returned coordinate bounds.

### Software Architect

`architecture.html` hosts a single permanent-root file tree with notes aligned across from every row. `architecture.js` supports inline renaming and notes, folder collapsing, immediate blank file or folder creation, drag-to-nest behavior, confirmation-only deletion and complete clearing, local persistence, and JSON export.

`architecture-model.mjs` isolates model migration and tree policies so the permanent root, valid folder parents, descendant-aware movement, and recursive deletion can be tested without the browser. Legacy file nodes migrate beneath `root/`; legacy system scopes are retained inside `MigratedScopes/`.

### `vendor/`

Contains pinned minified PDF.js 3.11.174 and PDF-Lib 1.17.1 browser assets so viewing and signing do not depend on a network CDN.

## Public Archive

### `CheatSheets/`

Stores stable, downloadable mathematics reference documents linked from the mathematics resource list.

### `educational_resources/`

Owns learning material grouped by mathematics, neuroscience, computer science, and arts. Mathematics and arts contain independent flashcard applications with subject-specific JSON data and one shared archival interface in `flashcards.css`.

### `literature_analysis/`

Owns critical-reading documents distinct from original publications and general educational notes. Its list uses `<Entry>` blocks.

### `research_publications/`

Owns original and selected publication metadata plus PDFs served by the site. Original and external works remain separated so authorship is clear.

Before adding an external PDF, confirm that public redistribution is permitted; otherwise link to the publisher, DOI, or an authorized open-access copy.
