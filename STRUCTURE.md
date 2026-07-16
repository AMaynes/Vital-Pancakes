# Project Structure

## Structure at a Glance

```text
artificially-neuroscience/
├── .gitignore — Excludes operating-system, editor, log, and temporary output.
├── .hintrc — Configures webhint for local HTML development checks.
├── .vscode/
│   └── settings.json — Stores shared VS Code and Live Server workspace settings.
├── CheatSheets/ — Stores downloadable mathematics reference sheets.
│   ├── Algebra-MasterSheet.pdf — Compact algebra reference.
│   ├── Calculus-MasterSheet.pdf — Compact calculus reference.
│   └── Trigonometry-MasterSheet.pdf — Compact trigonometry reference.
├── README.md — Introduces the project and explains operation and maintenance.
├── TODO.md — Tracks pressing and eventual project work.
├── STRUCTURE.md — Maps and explains every maintained repository path.
├── index.html — Serves as the public homepage and project entry point.
├── style.css — Defines the shared visual system and responsive layouts.
├── genericListLoader.js — Loads repository-managed text lists into HTML pages.
├── educational_resources/ — Contains discipline-specific learning material.
│   ├── index.html — Introduces the four learning disciplines.
│   ├── arts/
│   │   ├── index.html — Presents arts notes and interactive practice.
│   │   ├── arts_notes_list.txt — Lists arts notes and external resources.
│   │   ├── flashcard-practice.html — Runs the arts flashcard application.
│   │   └── flashcards.json — Stores arts flashcard categories and cards.
│   ├── compsci/
│   │   ├── index.html — Presents computer-science learning resources.
│   │   └── compsci_notes_list.txt — Lists computer-science notes and resources.
│   ├── mathematics/
│   │   ├── index.html — Presents mathematics references and interactive practice.
│   │   ├── mathematics_notes_list.txt — Lists downloadable mathematics references.
│   │   ├── flashcard-practice.html — Runs the mathematics flashcard application.
│   │   └── flashcards.json — Stores mathematics cards and problem metadata.
│   └── neurosci/
│       ├── index.html — Presents neuroscience learning resources.
│       └── neurosci_notes_list.txt — Lists neuroscience notes and resources.
├── literature_analysis/
│   ├── index.html — Presents critical-reading analyses.
│   └── lit_analysis_list.txt — Lists analysis documents.
└── research_publications/
    ├── index.html — Presents original and selected publications.
    ├── publications.txt — Lists original publications.
    ├── extra-publications.txt — Lists selected external publications.
    └── pdfs/ — Stores publication PDF files served by the site.
        ├── dobotpub.pdf — Original DOBOT education publication.
        └── synaptic-info-storage-pub.pdf — Selected synaptic information paper.
```

Generated Git internals and the tracked legacy `.DS_Store` file are not architectural project components and are not expanded in this map.

---

# Detailed Reference

## `artificially-neuroscience/`

The repository root owns project-wide documentation, configuration, shared assets, and the three primary content areas. New top-level folders should represent a durable public capability rather than a temporary experiment or technical category.

## `.gitignore`

Prevents common local and machine-generated artifacts from being added to version control. It must not hide source, academic content, configuration required for reproduction, or production assets.

## `.hintrc`

Configures the webhint development extension. It currently uses the development preset while disabling its redundant viewport warning because every page supplies an explicit responsive viewport.

## `.vscode/`

Contains shared editor settings that improve consistency for contributors using Visual Studio Code. It must not contain personal credentials, absolute machine paths, or private editor state.

## `.vscode/settings.json`

Selects the local Python environment defaults and assigns Live Server port `5501`. These settings affect development convenience only and are not required by the deployed website.

## `CheatSheets/`

Stores downloadable, subject-focused reference documents. Files placed here should be stable resources intended for public access and should be linked from the relevant educational discipline.

## `CheatSheets/Algebra-MasterSheet.pdf`

Provides a condensed algebra reference. The mathematics resource list links to this file using a repository-relative path.

## `CheatSheets/Calculus-MasterSheet.pdf`

Provides a consolidated calculus reference. Keep the filename stable unless its list entry is updated in the same change.

## `CheatSheets/Trigonometry-MasterSheet.pdf`

Provides a condensed trigonometry reference. It is distributed as a static download through GitHub Pages.

## `README.md`

Introduces the project, documents the supported local run path, explains the system at a high level, and records dependencies. It should remain concise enough to orient a new contributor before directing them here for detailed structure.

## `TODO.md`

Tracks actionable work in exactly two priority groups. Completed entries are removed, while reprioritized work moves between `Pressing` and `Eventual`.

## `STRUCTURE.md`

Acts as the authoritative human-readable repository map. Update both its annotated tree and detailed reference whenever a maintained path is added, moved, renamed, deleted, or assigned a materially different responsibility.

## `index.html`

Serves as the public entry point. It explains the project's interdisciplinary identity, directs visitors to research, analysis, and learning, and highlights the interactive mathematics laboratory.

## `style.css`

Defines the shared design language, responsive layout, navigation, content cards, publication lists, and compatibility styling used by the flashcard applications. Page-specific flashcard styles currently remain inline and are scheduled for consolidation.

## `genericListLoader.js`

Finds elements with `data-list-source`, fetches their text files, parses valid `<Entry>` blocks, sorts them, and renders safe links. It owns loading, empty, and failure states for all list-driven pages.

## `educational_resources/`

Owns learning material grouped by discipline. New disciplines require an intentional navigation and structure decision; ordinary resources should remain inside the discipline they support.

## `educational_resources/index.html`

Introduces mathematics, neuroscience, computer science, and arts. It also explains the active-learning purpose of the site's flashcard laboratories.

## `educational_resources/arts/`

Owns visual-art learning content and practice data. Arts-specific notes, references, and flashcards belong here.

## `educational_resources/arts/index.html`

Presents the arts resource list and links to interactive practice. It loads list content from `arts_notes_list.txt`.

## `educational_resources/arts/arts_notes_list.txt`

Stores arts resources using `<Entry>` blocks. It is currently empty and displays a deliberate empty state on the public page.

## `educational_resources/arts/flashcard-practice.html`

Runs the complete arts practice, quiz, missed-answer, and submission interface. Its implementation is currently duplicated from the mathematics application and should eventually become a thin subject configuration over a shared engine.

## `educational_resources/arts/flashcards.json`

Stores the arts category hierarchy and approximately 135 study cards. It is the source of truth for arts practice content.

## `educational_resources/compsci/`

Owns durable computer-science, programming, and artificial-intelligence learning resources. Project-specific development documentation belongs with its project rather than here.

## `educational_resources/compsci/index.html`

Introduces the technical-learning scope and renders the computer-science resource list.

## `educational_resources/compsci/compsci_notes_list.txt`

Stores computer-science resources using `<Entry>` blocks. It is currently empty and prepared for future notes.

## `educational_resources/mathematics/`

Owns mathematics reference material, flashcard data, generated problem behavior, and the interactive practice interface.

## `educational_resources/mathematics/index.html`

Introduces the mathematics collection, renders downloadable reference sheets, and directs visitors to the flashcard laboratory.

## `educational_resources/mathematics/mathematics_notes_list.txt`

Lists the algebra, calculus, and trigonometry master sheets. New long-form mathematics resources can be added through the same entry format.

## `educational_resources/mathematics/flashcard-practice.html`

Runs the mathematics practice system. In addition to static flashcards, it contains seeded problem generators, category selection, mixed practice, quizzes, missed-answer review, and locally stored submissions.

## `educational_resources/mathematics/flashcards.json`

Stores the mathematics category hierarchy and approximately 716 study cards. The application fetches this file at runtime, so it must remain valid JSON and preserve the expected category schema.

## `educational_resources/neurosci/`

Owns neuroscience learning content and future interactive models. It should become the central subject area without absorbing unrelated mathematics or general software material.

## `educational_resources/neurosci/index.html`

Introduces neuroscience as the study of biological intelligence and renders the neuroscience resource list.

## `educational_resources/neurosci/neurosci_notes_list.txt`

Stores neuroscience resources using `<Entry>` blocks. It is currently empty and identified as pressing content work.

## `literature_analysis/`

Owns critical-reading documents distinct from original publications and general educational notes. Analyses should preserve arguments, evidence, methods, limitations, and open questions.

## `literature_analysis/index.html`

Introduces the purpose of cumulative reading notes and renders the analysis library.

## `literature_analysis/lit_analysis_list.txt`

Stores links to literature analyses using `<Entry>` blocks. It is currently empty and displays an intentional growth-state message.

## `research_publications/`

Owns publication metadata and served PDF files. Original and selected external works remain separated so authorship is clear.

## `research_publications/index.html`

Presents original research beside a selected reading shelf. Both lists are loaded dynamically from repository-managed metadata.

## `research_publications/publications.txt`

Lists original or co-authored publications. Each entry should include a precise title, author attribution, relative path, and useful description.

## `research_publications/extra-publications.txt`

Lists external work selected for its importance to the site's research direction. Selection does not imply authorship.

## `research_publications/pdfs/`

Stores PDFs served by the publication lists. Before adding external publications, confirm that public redistribution is permitted; otherwise link to the publisher, DOI, or an authorized open-access copy.

## `research_publications/pdfs/dobotpub.pdf`

Contains the original AI-enhanced DOBOT Magician classroom-education publication listed under My Publications.

## `research_publications/pdfs/synaptic-info-storage-pub.pdf`

Contains the selected synaptic information-storage publication. Its redistribution status should be confirmed before long-term public hosting.
