# Project Structure

## Structure at a Glance

```text
artificially-neuroscience/
├── .gitignore — Excludes local operating-system, editor, log, and temporary files.
├── .hintrc — Configures webhint for local HTML development.
├── .vscode/
│   └── settings.json — Stores shared VS Code and Live Server settings.
├── README.md — Explains the public site, workspace, tools, and deployment.
├── TODO.md — Tracks pressing and eventual work.
├── STRUCTURE.md — Maps the maintained repository.
├── index.html — Serves as the public homepage and project entry point.
├── style.css — Defines the public site's shared visual system.
├── site-navigation.css — Keeps the five-section header consistent everywhere.
├── research-literature.html — Unifies research, publications, and reading analysis.
├── download-app.html — Presents phone previews and the install guide.
├── download-app.css — Styles app previews and geometric motion.
├── workspace.html — Routes Protocols, Studies & Projects, and tools.
├── workspace.css — Defines the workspace and tool visual system.
├── manifest.webmanifest — Describes the installable workspace app.
├── sw.js — Caches the workspace, public archive, and tools for offline use.
├── genericListLoader.js — Renders repository-managed text lists.
├── app/
│   ├── main.js — Renders workspace routes, libraries, editors, and install controls.
│   ├── download-app.js — Connects the install page to supported PWA prompts.
│   └── store.js — Owns browser-local data, persistence, and deletion policy.
├── assets/
│   ├── app-icon.svg — Editable source for the workspace icon.
│   ├── app-icon-192.png — Small install and shortcut icon.
│   ├── app-icon-512.png — Large maskable install icon.
│   ├── app-preview-workspace.svg — Geometric phone preview of workspace tools.
│   └── app-preview-studies.svg — Geometric phone preview of study libraries.
├── tools/
│   ├── tool.css — Shares full-screen tool layouts and controls.
│   ├── visual-board.html — Hosts diagramming and painting.
│   ├── visual-board.js — Implements drawing, history, persistence, and export.
│   ├── pdf-signer.html — Hosts local PDF viewing and signing.
│   ├── pdf-signer.js — Renders PDFs and embeds placed signatures.
│   ├── architecture.html — Hosts recursive scopes and file-skeleton design.
│   └── architecture.js — Persists architecture models and algorithm links.
├── vendor/
│   ├── pdf.min.js — Bundled PDF.js viewer runtime.
│   ├── pdf.worker.min.js — Bundled PDF.js worker.
│   └── pdf-lib.min.js — Bundled PDF-Lib editing runtime.
├── CheatSheets/
│   ├── Algebra-MasterSheet.pdf — Algebra reference sheet.
│   ├── Calculus-MasterSheet.pdf — Calculus reference sheet.
│   └── Trigonometry-MasterSheet.pdf — Trigonometry reference sheet.
├── educational_resources/
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

The public site's geometric design language, responsive layout, content cards, list states, and flashcard compatibility styling.

### `site-navigation.css`

The canonical brand header and primary Protocols, Research & Literature, Studies & Projects, Workspace, and Download App navigation used by every public page and tool.

### `research-literature.html`

The single top-level home for research publications, selected research, and analysis of every literature type. It routes into the existing focused collections.

### `download-app.html` and `download-app.css`

The install destination with animated geometric diagrams, phone preview screens, offline guidance, and responsive installation steps.

### `workspace.html`

The accessible application shell for three hash-routed areas. Protocols owns personal playbooks; Studies & Projects owns editable knowledge libraries and notecards; Workspace displays tools only.

### `workspace.css`

The public-site-aligned geometric workspace design tokens, full-width responsive shell, angular cards, editors, dialogs, toasts, and tool-compatible styles.

### `manifest.webmanifest`

Defines standalone display behavior, theme colors, app identity, install icons, and area shortcuts. Its start URL opens the tools Workspace.

### `sw.js`

Pre-caches the workspace, tool code, public pages, data files, PDF libraries, repository PDFs, and mathematics reference sheets. It serves same-origin GET requests cache-first and removes older app-shell caches.

### `genericListLoader.js`

Fetches files selected by `data-list-source`, parses valid `<Entry>` blocks, sorts entries, renders safe links, and owns loading, empty, and failure states.

## Workspace Application

### `app/main.js`

Renders the Protocols, Studies & Projects, and Workspace routes beneath the permanent top navigation; owns editable libraries, relationships, dialogs, search, installation controls, and local notices.

### `app/store.js`

Defines the browser-local data schema, default empty libraries, migration-safe loading, persistence, identifiers, section operations, and the local delete-password policy.

### `assets/`

Contains the editable app icon, generated install sizes, and the two phone preview screens used by Download App.

## Tools

### `tools/tool.css`

Shares responsive full-screen layouts, controls, panels, canvas surfaces, signature controls, file trees, and recursive scope interfaces.

### Visual Board

`visual-board.html` hosts the tool. `visual-board.js` implements freehand drawing, shapes, notes, arrows, selection, movement, erasing, history, zoom, local autosave, and PNG export.

### PDF Signer

`pdf-signer.html` hosts the local workflow. `pdf-signer.js` loads a chosen PDF with bundled PDF.js, manages page navigation and placed signatures, and embeds those signatures into a downloadable PDF with PDF-Lib.

### Architecture Designer

`architecture.html` hosts recursive system scopes and the file tree. `architecture.js` persists the model, lets any inner scope become the current big picture, annotates files and folders, and creates links to Algorithm entries in the workspace.

### `vendor/`

Contains pinned minified PDF.js 3.11.174 and PDF-Lib 1.17.1 browser assets so viewing and signing do not depend on a network CDN.

## Public Archive

### `CheatSheets/`

Stores stable, downloadable mathematics reference documents linked from the mathematics resource list.

### `educational_resources/`

Owns learning material grouped by mathematics, neuroscience, computer science, and arts. Mathematics and arts also contain independent flashcard applications with subject-specific JSON data.

### `literature_analysis/`

Owns critical-reading documents distinct from original publications and general educational notes. Its list uses `<Entry>` blocks.

### `research_publications/`

Owns original and selected publication metadata plus PDFs served by the site. Original and external works remain separated so authorship is clear.

Before adding an external PDF, confirm that public redistribution is permitted; otherwise link to the publisher, DOI, or an authorized open-access copy.
