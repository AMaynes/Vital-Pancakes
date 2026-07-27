# Project Structure

## Structure at a Glance

```text
pinakes-vitae/
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
├── workspace.html — Routes Protocols, Studies & Projects, and tools.
├── workspace.css — Defines the workspace and tool visual system.
├── manifest.webmanifest — Describes the installable workspace app.
├── sw.js — Caches the workspace, public archive, and tools for offline use.
├── genericListLoader.js — Renders repository-managed text lists.
├── app/
│   ├── main.js — Renders workspace routes, libraries, and editors.
│   ├── download-app.js — Connects the install page to supported PWA prompts.
│   └── store.js — Owns browser-local data, persistence, and deletion policy.
├── assets/
│   ├── pinakes-vitae-logo-final-light.png — Canonical black-ink logo on white.
│   ├── pinakes-vitae-logo-final.png — Companion white-ink logo on charcoal.
│   ├── app-icon-192.png — Small install and shortcut icon derived from the logo.
│   ├── app-icon-512.png — Large maskable install icon derived from the logo.
│   ├── app-preview-workspace.svg — Phone preview of workspace tools.
│   └── app-preview-studies.svg — Phone preview of study libraries.
├── tools/
│   ├── tool.css — Shares full-screen tool layouts and controls.
│   ├── visual-board.html — Hosts diagramming and painting.
│   ├── visual-board.js — Coordinates the infinite canvas, tools, persistence, and export.
│   ├── visual-board-geometry.mjs — Provides pure hit-testing, bounds, rotation, and resizing math.
│   ├── visual-board-geometry.test.mjs — Verifies Visual Board geometry with Node's test runner.
│   ├── pdf-signer.html — Hosts local PDF viewing and signing.
│   ├── pdf-signer.js — Renders PDFs and embeds placed signatures and dates.
│   ├── literature-analyzer.html — Hosts PDF and website reading, highlighting, and comments.
│   ├── literature-analyzer.css — Styles the split reading and annotation workspace.
│   ├── literature-analyzer.js — Owns source loading, persistence, comments, and exports.
│   ├── literature-analyzer-model.mjs — Provides highlight geometry and stored-data validation.
│   ├── literature-analyzer-model.test.mjs — Verifies normalized highlighting and PDF coordinates.
│   ├── travel-planner.html — Hosts the simple month itinerary calendar.
│   ├── travel-planner.css — Styles the month grid, plan editor, and day itinerary.
│   ├── travel-planner.js — Renders and persists local travel plans.
│   ├── travel-planner-model.mjs — Owns calendar dates and saved-plan validation.
│   ├── travel-planner-model.test.mjs — Verifies Travel Planner model behavior.
│   ├── architecture.html — Hosts the permanent-root folder structure and aligned notes.
│   ├── architecture.js — Renders and persists editable tree interactions.
│   ├── architecture-model.mjs — Owns migration, nesting, movement, and deletion policies.
│   └── architecture-model.test.mjs — Verifies Architecture Designer model behavior.
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

The public entry point. It introduces and links exactly five top-level sections: Protocols, Research & Literature, Studies & Projects, Workspace, and Download App.

### `style.css`

The public site's archival design language: warm paper, black ink, oxblood annotations, antique-brass details, engraved typography, information-dense responsive layouts, content cards, and list states.

### `site-navigation.css` and `site-navigation.js`

The canonical Pinakes Vitae header, anatomical brand mark, and primary Protocols, Research & Literature, Studies & Projects, Workspace, and Download App navigation used by every public page and tool. The script also inserts an always-present, file-like page path with back and forward history controls directly beneath the header.

### `research-literature.html`

The single top-level home for research publications, selected research, and analysis of every literature type. It routes into the existing focused collections.

### `download-app.html` and `download-app.css`

The compact install destination with animated archival diagrams, phone preview screens, offline guidance, and responsive installation steps.

### `workspace.html`

The accessible application shell for three hash-routed areas. Protocols owns personal playbooks; Studies & Projects owns editable knowledge libraries and notecards; Workspace displays tools only.

### `workspace.css`

The public-site-aligned archival workspace tokens, full-width responsive shell, ruled cards, editors, dialogs, toasts, and tool-compatible styles.

### `manifest.webmanifest`

Defines standalone display behavior, theme colors, app identity, install icons, and area shortcuts. Its start URL opens the tools Workspace.

### `sw.js`

Pre-caches the workspace, tool code, public pages, data files, PDF libraries, repository PDFs, and mathematics reference sheets. It serves same-origin GET requests cache-first and removes older app-shell caches.

### `genericListLoader.js`

Fetches files selected by `data-list-source`, parses valid `<Entry>` blocks, sorts entries, renders safe links, and owns loading, empty, and failure states.

## Workspace Application

### `app/main.js`

Renders the Protocols, Studies & Projects, and Workspace routes beneath the permanent top navigation; owns core-library entries, relationships, dialogs, and local notices.

### `app/store.js`

Defines the browser-local data schema, permanent empty core libraries, migration-safe restoration, persistence, identifiers, entry operations, and the local delete-password policy. Its legacy `artificially-neuroscience-*` storage key is retained deliberately so the rebrand does not orphan existing browser data.

### `assets/`

Contains the canonical light and dark Pinakes Vitae logos, install icons derived from the light mark, and the two phone preview screens used by Download App. The `pinakes-vitae-logo-final-light.png` file is the primary website artwork; the charcoal version is its inverted companion.

## Tools

### `tools/tool.css`

Shares responsive full-screen layouts, controls, panels, canvas surfaces, signature controls, annotation surfaces, calendar controls, and editable file-tree interfaces.

### Visual Board

`visual-board.html` hosts the organized creation, selection, view, history, and style controls, including 2D and 3D shape menus and contextual assembly actions. `visual-board.js` owns the unbounded world-coordinate camera, mouse and trackpad navigation, freehand drawing, brush erasing, straight lines, arrows with editable start and tip handles, inline textboxes, marquee selection, locking, stroke patterns, object grouping, shape division and reassembly, grid snapping, 300-action undo and redo history, local autosave, and PNG export. Dropped images are compressed and retained as local board assets; they are never uploaded.

`visual-board-geometry.mjs` isolates the pure geometry used for reusable 2D and 3D segment outlines, world bounds, rotated handles, hit testing, marquee intersection, grid snapping, corner-based resizing, and shape division. `visual-board-geometry.test.mjs` exercises those contracts with Node's built-in test runner.

### PDF Signer

`pdf-signer.html` hosts the local workflow. `pdf-signer.js` loads a chosen PDF with bundled PDF.js, manages page navigation and movable signature or date placements, and embeds those fields into a downloadable PDF with PDF-Lib.

### Literature Analyzer

`literature-analyzer.html` and `literature-analyzer.css` provide a split source, comment, and reading workspace. `literature-analyzer.js` opens local PDFs or sandboxed website frames, stores source-specific highlights and comments locally, exports annotated PDF pages with a comment appendix, and creates PNG or PDF annotation maps for webpages whose pixels remain protected by cross-origin browser security.

`literature-analyzer-model.mjs` owns normalized rectangle creation, persisted annotation validation, and PDF coordinate conversion. Its Node test suite covers reverse drags, clamping, minimum sizes, malformed storage, and the PDF vertical-axis transform.

### Travel Planner

`travel-planner.html` and `travel-planner.css` provide a simple six-week month calendar, plan editor, and selected-day itinerary. `travel-planner.js` keeps date, time, place, and note entries in local browser storage and offers optional Google Maps search links without adding reminders, notifications, accounts, sync, or calendar integrations.

`travel-planner-model.mjs` owns date generation, validation, sanitization, ordering, querying, updates, and removal. Its Node test suite covers six-week calendar boundaries, leap dates, malformed persistence, deterministic ordering, and the complete plan lifecycle.

### Architecture Designer

`architecture.html` hosts a single permanent-root file tree with notes aligned across from every row. `architecture.js` supports inline renaming and notes, folder collapsing, immediate blank file or folder creation, drag-to-nest behavior, ungated node deletion, password-gated complete clearing, local persistence, and JSON export.

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
