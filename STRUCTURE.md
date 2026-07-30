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
├── index.html — Serves as the public homepage, Knowledge Center, and Unified Vault interface.
├── style.css — Defines the public site and Knowledge Center archival visual system.
├── site-navigation.css — Styles the shared header, page path, history controls, and global glossary.
├── site-navigation.js — Builds page paths, browser-history controls, glossary access, and background indexing.
├── research-literature.html — Unifies research, publications, and reading analysis.
├── download-app.html — Presents phone previews and the install guide.
├── download-app.css — Styles app previews and archival motion accents.
├── workspace.html — Routes Everyday Life, Studies & Projects, and tools.
├── workspace.css — Defines the workspace and tool visual system.
├── manifest.webmanifest — Describes the installable workspace app.
├── sw.js — Caches the workspace, public archive, and tools for offline use.
├── genericListLoader.js — Renders repository-managed text lists.
├── app/
│   ├── ai-command-protocol.mjs — Validates provider-independent semantic command envelopes and permissions.
│   ├── ai-command-registry.mjs — Routes previewed and applied commands through registered tool adapters.
│   ├── ai-page-host.mjs — Exposes the shared versioned AI page API and message bridge.
│   ├── ai-tool-catalog.mjs — Registers AI-addressable tools and their adapter modules.
│   ├── home-knowledge.js — Coordinates homepage search, graph, glossary, local AI suggestions, and encrypted vault workflows.
│   ├── home-knowledge-ai-adapter.mjs — Exposes bounded search, glossary, relationship, and vault-summary commands.
│   ├── glossary-ui.mjs — Installs the global glossary editor and reference inserter.
│   ├── knowledge-db.mjs — Stores documents, relationships, glossary entries, and index metadata.
│   ├── knowledge-model.mjs — Owns search ranking, references, backlinks, related entries, suggestions, and graph projection.
│   ├── knowledge-sync.mjs — Indexes Workspace, tools, lessons, annotations, text files, and PDF records locally.
│   ├── vault-archive.mjs — Frames chunked PBKDF2/AES-GCM encrypted archives with authenticated ordering.
│   ├── vault-codec.mjs — Preserves structured-clone values through binary attachments.
│   ├── vault-storage.mjs — Discovers, captures, validates, and restores localStorage, IndexedDB, and OPFS data.
│   ├── workspace-ai-adapter.mjs — Provides bounded semantic commands for Workspace libraries and entries.
│   ├── offline-shell.mjs — Registers cache-bypassed update checks and refreshes stale controlled Workspace views once.
│   ├── content-view.mjs — Normalizes retained List/Grid preferences and creates collection deep links.
│   ├── content-view.test.mjs — Verifies collection view preferences and encoded entry routes.
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
│   ├── current-tool-ai-adapter.mjs — Provides validated page-local command contracts for maintained tools.
│   ├── visual-board-ai-adapter.mjs — Validates exact Board, diagram, floor-plan, and architectural AI commands.
│   ├── ai-command-center.* — Hosts local command drafting, preview, permissions, and explicit apply workflows.
│   ├── workspace-suite.css — Shares the dense archival shell used by the newer local-first tools.
│   ├── local-toolkit.mjs — Provides shared IndexedDB repositories, backups, downloads, imports, IDs, and undo.
│   ├── suite-ui.mjs — Provides accessible tabs, dialogs, toasts, and compact DOM helpers.
│   ├── local-webllm-client.mjs — Coordinates explicit local model loading, streaming, cancellation, and cleanup.
│   ├── local-webllm-worker.js — Runs lazy-loaded WebLLM inference away from the interface.
│   ├── overhead.html / overhead.js — Hosts and coordinates the personal command center.
│   ├── overhead-model.mjs — Owns recurrence, tracker, inventory, validation, migration, and Web Crypto envelopes.
│   ├── overhead-model.test.mjs — Verifies due states, recurrence, trackers, inventory, encryption, and migration.
│   ├── file-drop.html / file-drop.js — Hosts and coordinates the browser-local file vault.
│   ├── file-drop-model.mjs — Owns safe filenames, folders, duplicate detection, preview policy, trash, and manifests.
│   ├── file-drop-hash-worker.js — Fingerprints imported files with progress and cancellation.
│   ├── file-drop-model.test.mjs — Verifies folders, duplicates, manifests, filenames, trash, and preview safety.
│   ├── graphing.html / graphing.js — Hosts data entry, chart configuration, summaries, and exports.
│   ├── graphing-model.mjs — Parses, types, filters, aggregates, bins, validates, and migrates graph projects.
│   ├── graphing-renderer.mjs — Builds accessible SVG specifications for every supported chart.
│   ├── graphing-worker.js — Parses and transforms larger datasets off the main thread.
│   ├── graphing-*.test.mjs — Verifies parsing, transformations, statistics, chart validation, rendering, and migration.
│   ├── inference.html / inference.js — Hosts selected-backup indexing and cited local-model analyses.
│   ├── inference-model.mjs — Owns backup exclusion, provenance, chunking, retrieval, citations, and conversion.
│   ├── inference-index-worker.js — Builds checkpointable local search indexes with cancellation.
│   ├── inference-model.test.mjs — Verifies exclusions, provenance, retrieval, citation enforcement, and conversion.
│   ├── markdown-studio.html / markdown-studio.js — Hosts local Markdown, math, and LaTeX-source editing.
│   ├── markdown-studio-model.mjs — Owns safe rendering, outlines, versions, diffs, statistics, and backup validation.
│   ├── markdown-studio-model.test.mjs — Verifies sanitization, parsing boundaries, outlines, diffs, and backups.
│   ├── tool-designer.html / tool-designer.js — Hosts the guided tool-design and implementation-prompt workshop.
│   ├── tool-designer-model.mjs — Normalizes requirements, merges templates, reviews scope, versions, and exports.
│   ├── tool-designer-model.test.mjs — Verifies normalization, templates, history, validation, and prompt completeness.
│   ├── color-aesthetic.html / color-aesthetic.js — Hosts perceptual palette generation, previews, and exports.
│   ├── color-aesthetic-model.mjs — Owns color conversions, harmonies, roles, contrast, seeds, and migration.
│   ├── color-aesthetic-worker.js — Extracts image palettes locally without blocking the interface.
│   ├── color-aesthetic-model.test.mjs — Verifies conversions, harmonies, seeds, roles, contrast, and clustering.
│   ├── bracket-generator.html / bracket-generator.js — Hosts tournament setup, scoring, bracket views, and exports.
│   ├── bracket-model.mjs — Owns seeding, byes, advancement, loser routing, finals reset, and standings.
│   ├── bracket-renderer.mjs — Renders scalable brackets and compact match lists.
│   ├── bracket-*.test.mjs — Verifies every tournament mode, invalidation, routing, ties, rendering, and migration.
│   ├── randomized-picker.html / randomized-picker.js — Hosts weighted draws, ordering, grouping, elimination, and wheel mode.
│   ├── randomized-picker-model.mjs — Owns parsing, probabilities, seeded randomness, sampling, grouping, and history.
│   ├── randomized-picker-model.test.mjs — Verifies deterministic draws, weights, duplicates, grouping, undo, and imports.
│   ├── budget-finance.html — Hosts recurring budgets, investment and loan analysis, and tax search.
│   ├── budget-finance.css — Styles the tabbed finance workspace, tables, metrics, and tax results.
│   ├── budget-finance.js — Coordinates local finance state, form editing, schedules, and tax filtering.
│   ├── budget-finance-model.mjs — Calculates date-based budgets, investment growth, and loan amortization.
│   ├── budget-finance-model.test.mjs — Verifies cash-flow timing and financial schedule behavior.
│   ├── tax-directory.mjs — Indexes federal and state tax categories against official IRS sources.
│   ├── tax-directory.test.mjs — Verifies jurisdiction coverage, categories, search, and source safety.
│   ├── scientific-calculator.html — Hosts the scientific expression keypad, display, memory, and history.
│   ├── scientific-calculator.css — Styles the responsive calculator and calculation history.
│   ├── scientific-calculator.js — Coordinates calculator input, angle modes, memory, persistence, and history.
│   ├── scientific-calculator-engine.mjs — Safely validates and evaluates scalar math.js expressions.
│   ├── scientific-calculator-engine.test.mjs — Verifies precedence, precision, functions, angle modes, and rejected syntax.
│   ├── visual-board.html — Hosts diagramming and painting.
│   ├── visual-board.js — Coordinates the infinite canvas, architectural renderer, tools, persistence, and export.
│   ├── visual-board-advanced.css — Styles image controls and the Floor Plan panel.
│   ├── visual-board-architecture.mjs — Defines deterministic materials, layers, vector symbols, ordering, and geometry reports.
│   ├── visual-board-architecture.test.mjs — Verifies the architecture catalog, ordering, materials, and non-mutating inspection.
│   ├── visual-board-static-export.mjs — Serializes visible Board artwork to standalone SVG for SVG, PNG, and PDF output.
│   ├── visual-board-static-export.test.mjs — Verifies deterministic vector export, layers, patterns, symbols, text, and images.
│   ├── visual-board-image.mjs — Owns non-destructive source-coordinate crop geometry.
│   ├── visual-board-transform.mjs — Flips selections and calculates alignment guides without breaking relationships.
│   ├── visual-board-floor-plan.mjs — Creates ordinary editable floor-plan symbols and starter rooms.
│   ├── visual-board-{image,transform,floor-plan}.test.mjs — Verifies crop, flip, joint, dimension, snapping, and migration geometry.
│   ├── visual-board-animation.mjs — Normalizes animation frames and playback timing.
│   ├── visual-board-animation.test.mjs — Verifies animation state, timing, and playable frames.
│   ├── visual-board-character.mjs — Exports and restores portable characters with embedded assets and rig settings.
│   ├── visual-board-character.test.mjs — Verifies character relationship remapping and placement.
│   ├── visual-board-clipboard.mjs — Duplicates selected board objects while preserving internal relationships.
│   ├── visual-board-clipboard.test.mjs — Verifies multi-object clipboard duplication and identifier remapping.
│   ├── visual-board-export.mjs — Encodes local animation frames into MP4 or WebM video.
│   ├── visual-board-export.test.mjs — Verifies export formats, frame ordering, timing, and cancellation.
│   ├── visual-board-geometry.mjs — Provides pure hit-testing, bounds, rotation, and resizing math.
│   ├── visual-board-geometry.test.mjs — Verifies Visual Board geometry with Node's test runner.
│   ├── visual-board-history.mjs — Snapshots board content together with selection state for undo and redo.
│   ├── visual-board-history.test.mjs — Verifies selection-aware history snapshots and restoration.
│   ├── visual-board-library.mjs — Normalizes reusable local Board assets while preserving complete character packages.
│   ├── visual-board-library.test.mjs — Verifies saved groups, vertices, joints, locks, assets, filtering, and removal.
│   ├── visual-board-rich-text.mjs — Stores, edits, and renders per-range textbox colors.
│   ├── visual-board-rich-text.test.mjs — Verifies highlighted color ranges and edit preservation.
│   ├── visual-board-rigging.mjs — Detects shared group joints and solves dimension-locked joint movement.
│   ├── visual-board-rigging.test.mjs — Verifies external joints, exact constraints, and rigid transforms.
│   ├── visual-board-shape-tools.mjs — Retains the independent 2D and 3D split-button choices.
│   ├── visual-board-shape-tools.test.mjs — Verifies shape families and retained-option behavior.
│   ├── visual-board-strokes.mjs — Defines stable, width-aware Canvas dash and dot patterns.
│   ├── visual-board-strokes.test.mjs — Verifies finite dotted ink and established dash spacing.
│   ├── visual-board-text.mjs — Defines world-scaled text and explicit screen-scaled annotation sizing.
│   ├── visual-board-text.test.mjs — Verifies zoom-stable world text and opt-in screen annotations.
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
│   ├── master-lesson-builder.html — Hosts local textbook upload, lesson creation, and Adaptive Review Studio.
│   ├── master-lesson-builder.css — Styles the responsive lesson and review workspace.
│   ├── master-lesson-builder.js — Coordinates extraction, generation, editing, review, export, and Studies saves.
│   ├── master-lesson-review.mjs — Owns deterministic card generation, quiz choices, FSRS scheduling, statistics, and undo.
│   ├── master-lesson-review-ui.mjs — Coordinates due queues, ratings, card editing, settings, and review persistence.
│   ├── master-lesson-worker.js — Lazy-loads WebLLM and runs model inference away from the interface.
│   ├── master-lesson-extraction.mjs — Extracts numbered PDF, TXT, and Markdown pages.
│   ├── master-lesson-text.mjs — Normalizes page text and repeated page furniture.
│   ├── master-lesson-outline.mjs — Detects and validates editable chapter and lesson hierarchies.
│   ├── master-lesson-chunking.mjs — Creates bounded overlapping chunks with page citations.
│   ├── master-lesson-retrieval.mjs — Provides deterministic local BM25 textbook retrieval.
│   ├── master-lesson-prompts.mjs — Builds source-grounded prompts with untrusted-source boundaries.
│   ├── master-lesson-validation.mjs — Repairs structured JSON and rejects invented citations.
│   ├── master-lesson-queue.mjs — Owns resumable generation, pause, retry, and cancellation state.
│   ├── master-lesson-db.mjs — Stores books, pages, chunks, summaries, lessons, and jobs in IndexedDB.
│   ├── master-lesson-study.mjs — Converts approved lessons into compatible Studies entries.
│   ├── master-lesson-core.test.mjs — Verifies chunking, citations, outline, retrieval, queues, prompts, and Study conversion.
│   ├── caption-relay.html — Hosts the integrated Capture, Translate, and Display pipeline.
│   ├── caption-relay.css — Styles the archival three-stage caption workspace and mirror player.
│   ├── caption-relay.js — Coordinates projects, workers, editing, translation, synchronization, overlays, and exports.
│   ├── caption-relay-ai-adapter.mjs — Exposes the validated, permission-gated semantic AI command contract.
│   ├── caption-capture.mjs — Owns shared-tab capture, sample-count timing, wake lock, and media cleanup.
│   ├── caption-audio-worklet.js — Downsamples audio and emits bounded overlapping chunks off the main thread.
│   ├── caption-transcription-worker.js — Lazy-loads pinned local Whisper speech recognition.
│   ├── caption-transcript.mjs — Deduplicates overlaps, constructs cues, and bounds queued transcription.
│   ├── caption-translation-worker.js — Lazy-loads the pinned local English-to-Vietnamese fallback.
│   ├── caption-translation.mjs — Preserves cues, punctuation, failures, glossary terms, and translation progress.
│   ├── caption-fingerprint-worker.js — Generates and matches same-speed compact audio fingerprints.
│   ├── caption-fingerprint.mjs — Implements deterministic spectral same-source hashes and confidence matching.
│   ├── caption-text-sync.mjs — Normalizes and fuzzy-matches rolling English transcript windows.
│   ├── caption-sync.mjs — Owns confidence-gated lock, drift, seek, pause, and rejection states.
│   ├── caption-overlay.mjs — Renders safe captions in Document Picture-in-Picture or a popup.
│   ├── caption-mirror.mjs — Renders captured video and subtitles together for fullscreen fallback.
│   ├── caption-package.mjs — Validates and migrates versioned `.vpcaptions.json` packages.
│   ├── caption-formats.mjs — Parses and exports millisecond-accurate SRT and WebVTT.
│   ├── caption-timing.mjs — Maps capture speed to original movie time and applies corrections.
│   ├── caption-storage.mjs — Persists projects and checkpoints in a separate IndexedDB namespace.
│   ├── caption-*.test.mjs — Verifies formats, timing, packages, recovery, translation, fingerprints, and synchronization.
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
│   ├── mathjs-15.2.0.min.js — Pinned math.js scientific expression and high-precision arithmetic runtime.
│   ├── mathjs-15.2.0-LICENSE.txt — Apache-2.0 license for bundled math.js.
│   ├── mathjs-15.2.0-NOTICE.txt — Upstream math.js attribution notice.
│   ├── mediabunny-1.51.0.min.mjs — Pinned browser-native MP4 and WebM encoding runtime.
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

The accessible application shell for three hash-routed areas. Everyday Life owns separate Cooking, Gym, and Cleaning libraries; Studies & Projects owns editable knowledge libraries and notecards; Workspace displays tools only. Its area dashboards remain compact overviews, while every content collection opens into a retained List/Grid index and every item has a deep-linked subject page.

### `workspace.css`

The public-site-aligned archival workspace tokens, full-width responsive shell, ruled cards, editors, dialogs, toasts, and tool-compatible styles. It defines the shared responsive List/Grid indexes, animated subject previews, dedicated entry-page composition, and distinct technique-atlas, recipe-book, training-log, care-manual, study-dossier, idea-board, language-reference, algorithm-lab, and project-casebook layouts.

### `manifest.webmanifest`

Defines standalone display behavior, theme colors, app identity, install icons, and area shortcuts. Its start URL opens the tools Workspace.

### `sw.js`

Pre-caches the workspace, tool code, public pages, data files, PDF libraries, repository PDFs, and mathematics reference sheets. It serves same-origin GET requests cache-first and removes older app-shell caches.

### `genericListLoader.js`

Fetches files selected by `data-list-source`, parses valid `<Entry>` blocks, sorts entries, renders safe links, and owns loading, empty, and failure states.

## Workspace Application

### `app/main.js`

Renders the Everyday Life, Studies & Projects, and Workspace routes beneath the permanent top navigation; preserves the overview dashboards; and owns shared collection indexes, dedicated entry pages, subject animations, the nine type-aware record layouts and editors, Questions & Ideas records, relationships, dialogs, and local notices.

### `app/content-view.mjs`

Provides pure collection-view normalization, per-collection preference keys, and encoded section or entry hash routes. Its adjacent Node test verifies safe fallback behavior and stable deep links.

### `app/store.js`

Defines the browser-local data schema, nine permanent core libraries, deterministic editable starter entries, versioned additive content migrations, Questions & Ideas migration, Protocols-to-Personal-Routines migration, persistence, identifiers, and entry operations. User-authored content is preserved during migrations. Its legacy `artificially-neuroscience-*` storage key is retained deliberately so the rebrand does not orphan existing browser data.

### `app/algorithm-samples.mjs`

Contains the editable Traditional and Advanced algorithm curriculum and joins each subject to its C and Java reference implementations.

### `app/algorithm-code-examples.mjs`

Keeps compact C and Java implementations for every bundled Traditional and Advanced algorithm separate from the conceptual curriculum.

### `app/algorithm-analysis-samples.mjs`

Defines the special Algorithm Analysis subject library, including comparison, time, space, case analysis, recurrences, and responsible benchmarking. `store.js` adds stable sample metadata and migrates older user-authored algorithm records into the Personal subsection.

### `assets/`

Contains the transparent black and white variants of the forest-and-circuit *Vital Pancakes* skull, its original flat source, the earlier light and dark *Pinakes Vitae* artwork retained as historical assets, install icons, and the two phone preview screens used by Download App. The website uses the black transparent mark; browser tabs select the black or white favicon according to the browser color scheme.

## Tools

### `tools/tool.css`

Shares responsive full-screen and windowed layouts, controls, panels, canvas surfaces, signature controls, annotation surfaces, calendar controls, and editable file-tree interfaces.

### Visual Board

`visual-board.html` hosts the organized creation, selection, view, history, and style controls, including persistent 2D and 3D shape menus, copy and paste tools, contextual textbox typography, grouping, rigging, a reusable local Board library, and character export actions. `visual-board.js` owns the unbounded world-coordinate camera, mouse and trackpad navigation, repeated line, arrow, and shape placement, Escape-to-Select behavior, freehand drawing, brush erasing, straight lines, arrows with editable start and tip handles, inline textboxes, tight per-object selection outlines, marquee selection, multi-object copy and paste, locking, stroke patterns, rigid grouping, editable shared-vertex networks, external group joints, dimension-locked joint dragging, shape division and reassembly, grid snapping, 300-action undo and redo history, local autosave, reusable-asset thumbnails and placement, animation, and local video export. Dropped images and portable character files remain on the device.

`visual-board-clipboard.mjs` deep-copies selected objects, offsets pasted copies, and remaps group, divided-shape, and vertex-network identifiers without mutating the originals. `visual-board-character.mjs` packages selected connected artwork, embedded images, groups, internal vertices, external joints, and both lock types into a remapped `.vp-character.json` file that can be dropped back onto the board. `visual-board-library.mjs` stores those complete packages as named, searchable local assets so inserting a library item remaps every identifier without flattening its structure. `visual-board-rigging.mjs` creates only the contact joint shared by selected rigid groups and solves the closest exact position allowed by locked distances. `visual-board-geometry.mjs` isolates reusable geometry, while `visual-board-vertices.mjs` retains the internal editable-line network used after a group is released.

`visual-board-image.mjs` stores crop rectangles in source-image coordinates and supplies fit, fill, reset, replacement, and draw geometry without iterative recompression. `visual-board-transform.mjs` mirrors complete selections and only their fully selected rig joints while preserving IDs, locks, vertices, arrows, architectural areas and symbols, crop state, and readable text. `visual-board-floor-plan.mjs` creates walls, doors, swing arcs, windows, dimensions, room symbols, and starter rooms through the existing object and group schema. The Board UI adds numeric and handle image controls, alignment guides, configurable floor-plan scale/units/grid/wall thickness, and library-compatible templates; version 13 migrates prior boards without flattening them.

`visual-board-architecture.mjs` owns the compact architectural object vocabulary: filled polygonal areas, wall bodies, dimensions, 15 deterministic materials, 10 Canvas fill patterns, 9 ordered visibility layers, and 37 reusable vector symbols for openings, furniture, fixtures, landscaping, and site features. It also provides stable layer/z-index sorting and bounded, non-mutating bounds and overlap reports. Architectural text uses board-coordinate font sizes, alignment, padding, and clipping, so camera zoom no longer changes its layout.

`visual-board-static-export.mjs` serializes the same stored objects, materials, symbols, layers, transforms, and embedded raster assets into a standalone SVG without DOM access or layout inference. The Board downloads that vector result directly or rasterizes it locally for high-resolution PNG and PDF output.

`visual-board-ai-adapter.mjs` exposes exact architecture commands for areas, walls, openings, symbols, labels, dimensions, material assignment, layer replacement, and read-only inspection. Commands validate nested fields, operate on cloned state, support same-batch client keys, preview without saving, and commit an approved mixed batch as one undoable change. The adapter and renderer never plan, infer, furnish, reroute, or improve a design; the calling model supplies every coordinate, dimension, style, material, symbol, layer, and z-index.

### Local-First Workspace Suite

`workspace-suite.css`, `suite-ui.mjs`, and `local-toolkit.mjs` share the responsive archival shell, accessible controls, IndexedDB records/blobs, versioned backups, conflict-safe imports, downloads, and bounded undo used by Overhead, File Drop, Graphing Tool, Inference Tool, Markdown & LaTeX Studio, Tool Designer & Planner, Color Aesthetic Generator, Bracket Generator, and Randomized Picker. Domain rules stay in adjacent pure model modules with deterministic Node tests; parsing, hashing, image clustering, graph transformation, backup indexing, and local-model inference move to workers where warranted.

`local-webllm-client.mjs` and `local-webllm-worker.js` provide explicit WebGPU compatibility checks, lazy model loading, streamed output, cancellation, and memory cleanup for Inference and Tool Designer. Imported text is wrapped as untrusted data, model output remains reviewable, large weights are never application-shell assets, and no tool adds an account, backend, analytics, or required cloud storage. File Drop bytes and Overhead private records stay outside service-worker caches; the latter uses password-derived authenticated Web Crypto envelopes and never stores plaintext passwords or decrypted records.

### PDF Signer

`pdf-signer.html` hosts the local workflow. `pdf-signer.js` loads a chosen PDF with bundled PDF.js, manages page navigation and selectable, movable, resizable, or deletable signature and date placements, and embeds the remaining fields into a downloadable PDF with PDF-Lib. Selected fields expose an inline trash control and can also be deleted from the toolbar or keyboard. `pdf-signer-placements.mjs` owns immutable removal from export state, with an adjacent Node test suite.

### Literature Analyzer

`literature-analyzer.html` and `literature-analyzer.css` provide a split source, comment, and reading workspace with inline comment cards and a toggleable right-side comment rail. `literature-analyzer.js` opens local PDFs or sandboxed website frames, stores source-specific highlights and comments locally, owns 300-step undo and redo for annotation changes, exports annotated PDF pages with a comment appendix, and creates PNG or PDF annotation maps for webpages whose pixels remain protected by cross-origin browser security. `literature-analyzer-model.mjs` provides normalized geometry, stored-data validation, and immutable bounded annotation-history operations.

`literature-analyzer-model.mjs` owns normalized rectangle creation, persisted annotation validation, and PDF coordinate conversion. Its Node test suite covers reverse drags, clamping, minimum sizes, malformed storage, and the PDF vertical-axis transform.

### Master Lesson Builder

`master-lesson-builder.html`, `.css`, and `.js` provide the book library, drag-and-drop extraction, WebGPU status, explicit model loading, editable outline, lesson editor and preview, source-grounded chat, progress controls, exports, Studies integration, and Adaptive Review Studio. Review cards are generated from approved lesson flashcards and concepts, remain editable, preserve manual edits during lesson regeneration, and use the pinned MIT-licensed `ts-fsrs` 5.4.1 browser module for local Again/Hard/Good/Easy scheduling. Text-based PDFs use bundled PDF.js; TXT and Markdown use native file reading. Scanned PDFs are detected from insufficient extractable text and require external OCR.

The deterministic pipeline is split across extraction, normalization, outline, chunking, BM25 retrieval, prompt, validation, queue, IndexedDB, and Study-conversion modules. Source pages stay attached through chunking, and model citations survive validation only when the cited page belongs to the cited supplied chunk. WebLLM 0.2.83 is lazy-loaded inside `master-lesson-worker.js`; small and medium model artifacts use WebLLM's IndexedDB cache and are intentionally absent from the application-shell precache. Reloaded running jobs recover paused and reuse completed chunk summaries.

### Caption Relay

`caption-relay.html`, `.css`, and `.js` provide one persistent **Capture → Translate → Display** workspace. Capture uses `getDisplayMedia`, an `AudioContext`, an AudioWorklet, worker inference, a bounded queue, processed-sample timing, optional wake lock, and IndexedDB checkpoints. It never stops the required video track while assuming audio will survive, and never persists raw movie media. At 1×, a worker records compact same-source fingerprints; accelerated captures multiply every detected audio timestamp by the selected constant rate and use a normalized English cue index for later matching.

Package, format, timing, transcript, translation, fingerprint, text-match, and synchronization rules are pure modules with deterministic Node tests. The versioned `.vpcaptions.json` validator bounds size and cue counts, rejects raw media and malformed data, migrates schema 0, preserves compatible unknown fields, and keeps source cue IDs and integer timestamps stable. Imported caption text reaches the interface and overlays through form values or `textContent`, never unsafe HTML.

Speech workers lazy-load pinned Transformers.js 3.8.1 with Apache-2.0 Whisper Tiny or Small English revisions. Translation prefers Chrome's desktop local Translator API and otherwise uses the Apache-2.0 OPUS-MT English-to-Vietnamese revision in its own worker. These large model files are not application-shell assets. `caption-sync.mjs` implements the documented state machine, requires compatible matches before locking, searches near the predicted time before globally, smooths small drift, applies seek-sized jumps immediately, and hides captions on low-confidence or unrelated audio.

`caption-overlay.mjs` opens Document Picture-in-Picture only from a user gesture and falls back to a normal popup. `caption-mirror.mjs` keeps a captured video element and safe subtitle layer in the same document for fullscreen. Mirror Mode warns about latency, quality, duplicate audio, protected media, interruption, and browser limits. All project data uses the new `vital-pancakes-caption-relay` IndexedDB namespace without changing existing storage keys.

### Literature Curation

`literature-curator.html` and `literature-curator.css` provide a local curation index, editable target statement and synthesis, relationship totals, and a four-part evidence matrix for sources that support, complicate, contradict, or contextualize an idea, claim, or hypothesis. `literature-curator.js` owns creation, editing, deletion, local persistence, safe source links, and Markdown export.

`literature-curator-model.mjs` isolates storage-boundary validation and immutable curation and analysis updates. Its Node test suite covers malformed records, unsafe source URLs, relationship counts, and preservation of prior state during updates.

### Travel Planner

`travel-planner.html` and `travel-planner.css` provide overhead Select and Add Event tools, a six-week month calendar, a multi-selected day pager, complete 24-hour timelines, and a calendar-anchored event editor. `travel-planner.js` keeps plans in local browser storage, preserves strict `HH:MM` time display, and performs only explicit user-submitted place searches through the configured endpoint. Search results are rate-limited, cached locally, attributed to OpenStreetMap, and can populate map-ready places without adding reminders, notifications, accounts, sync, or calendar integrations.

`travel-planner-model.mjs` owns date generation, validation, multi-day selection, 24-hour time validation, sanitization, ordering, querying, updates, and removal. `travel-place-search.mjs` isolates external query construction and untrusted result validation. Their Node test suites cover calendar boundaries, leap dates, selection order, time limits, malformed persistence, deterministic ordering, the complete plan lifecycle, HTTPS request construction, and returned coordinate bounds.

### Software Architect

`architecture.html` hosts a single permanent-root file tree with notes aligned across from every row. `architecture.js` supports inline renaming and notes, folder collapsing, immediate blank file or folder creation, drag-to-nest behavior, confirmation-only deletion and complete clearing, local persistence, and JSON export.

`architecture-model.mjs` isolates model migration and tree policies so the permanent root, valid folder parents, descendant-aware movement, and recursive deletion can be tested without the browser. Legacy file nodes migrate beneath `root/`; legacy system scopes are retained inside `MigratedScopes/`.

### File Converter

`file-converter.html` hosts a same-site build of the complete upstream Convert to it! application inside the standard Workspace shell and links to its GPL-2.0 source. `file-converter-app/` contains the compiled interface, its exact upstream license and source-modification record, while large conversion engines lazy-load from the official upstream deployment. Its optional round-trip check converts each result back to the input format and performs an asynchronous exact-byte comparison before download.

`file-converter.js` owns ready, timeout, offline, and retry states without reading selected files. `file-converter-state.mjs` keeps those host states deterministic, while `file-converter-byte-verification.mjs` mirrors the bundled exact comparison policy for independent tests of matches, file-count changes, length changes, and first differing offsets.

### Scientific Calculator

`scientific-calculator.html` and `scientific-calculator.css` provide a responsive six-column scientific keypad, editable expression display, DEG/RAD/GRAD mode control, memory, and locally stored calculation history. `scientific-calculator.js` owns keyboard and button editing, live previews, answer reuse, memory operations, copy behavior, and persistence.

`scientific-calculator-engine.mjs` configures bundled math.js for 64-digit decimal arithmetic, allows only scalar operators, constants, and approved scientific functions, and rejects assignments, collections, property access, and unknown symbols before compilation. Its Node tests cover PEMDAS, nested parentheses, right-associative powers, implicit multiplication, factorials, modulo, roots, decimal precision, angle modes, answer reuse, invalid arithmetic, and unsafe syntax.

### Budget & Finance

`budget-finance.html` and `budget-finance.css` provide separate Budget, Investments, Loans, and Tax Finder tabs. `budget-finance.js` persists finance assumptions locally, renders editable recurring cash-flow rows, annual investment growth, annual or payment-level loan schedules, and bounded official-source tax search results.

`budget-finance-model.mjs` counts recurring events against inclusive calendar windows, preserves month-end recurrence anchors, amortizes investment returns and contributions monthly, and produces rounded fixed-rate loan schedules with optional extra payments. `tax-directory.mjs` covers all 50 states plus the District of Columbia across 15 broad tax categories and separates current federal IRS resources. Their tests cover financial boundaries, gross and net totals, known payment results, accelerated payoff, complete jurisdiction/category coverage, keyword search, result bounds, and HTTPS IRS sources.

### `vendor/`

Contains pinned minified math.js 15.2.0, Mediabunny 1.51.0, PDF.js 3.11.174, and PDF-Lib 1.17.1 browser assets so calculation, animation export, viewing, and signing do not depend on a network CDN.

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
