# Artificially Neuroscience

[View the live website](https://amaynes.github.io/artificially-neuroscience/) · [Open the workspace](https://amaynes.github.io/artificially-neuroscience/workspace.html)

Artificially Neuroscience is Alex Maynes's public interdisciplinary learning laboratory and personal, local-first knowledge workspace. It preserves research, critical reading notes, reference material, and interactive study tools across neuroscience, artificial intelligence, mathematics, computer science, and art.

The project remains a static website: it needs no server-side application, database, account, or paid hosting platform.

## Running the Project

The site runs on Windows, macOS, and Linux in any current browser. From the repository root, start a local web server:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). Opening files directly from disk is not supported because browser security rules prevent the content and PDF loaders from fetching local files.

## System Overview

GitHub Pages serves the repository as a static website. `index.html` is the public homepage, while `workspace.html` opens the installable knowledge workspace. `site-navigation.css` keeps the original top navigation consistent across every page and tool. The public archive uses `style.css`; the workspace and its tools use `workspace.css`.

Repository-managed lists use small text files containing `<Entry>` blocks. `genericListLoader.js` fetches those files, parses their metadata, sorts entries alphabetically, and renders safe links.

The mathematics and arts flashcard applications load subject-specific `flashcards.json` files. Quiz scores, missed-answer queues, and drafted submissions remain in the visitor's browser through `localStorage`.

The workspace uses `app/main.js` for routes and editors and `app/store.js` for its browser-local data model. Each tool under `tools/` is a standalone full-screen module. A service worker pre-caches the workspace, tools, PDF dependencies, and public archive for offline use.

See [STRUCTURE.md](STRUCTURE.md) for the annotated repository map.

## Public Website

- **Homepage** — Introduces the project and directs visitors to research, analysis, learning, and the workspace.
- **Research Publications** — Separates original work from selected external publications.
- **Literature Analysis** — Preserves durable critical-reading notes.
- **Educational Resources** — Organizes mathematics, neuroscience, computer science, and arts material.
- **Flashcard Laboratories** — Provides topic selection, mixed practice, knowledge tests, daily statistics, missed-answer review, LaTeX rendering, and locally drafted submissions.

## Personal Workspace

The workspace starts with empty, modular libraries:

- **Protocols** — Repeatable triggers and checklists that reduce planning overhead.
- **Programming Languages** — Mental models, syntax refreshers, and personal gotchas.
- **Algorithms** — Use cases, explanations, complexity notes, and user-authored animated frames.
- **Projects** — Problems, solutions, languages, and live relationships to Algorithm entries.

Additional flexible or specialized sections can be added at any time. Sections and entries can also be deleted using the requested password `password`. Because this is a static local-first site, the password is a convenience guard and not secure access control.

User-created sections, entries, boards, and architecture models stay in the current browser. They are not uploaded or synchronized. Clearing site data removes them, so important content should be backed up first.

## Workspace Tools

### Visual Board

Combines freehand painting with boxes, ellipses, notes, arrow connectors, selection and movement, erasing, undo and redo, zoom, local autosave, and PNG export.

### PDF Signer

Opens PDFs locally with bundled PDF.js, supports page navigation, creates signatures in three visual styles, allows placement and resizing on any page, and downloads a genuinely signed PDF with PDF-Lib. Documents never leave the browser.

### Architecture Designer

Provides two related views:

- A recursive system-scope map where any inside part can become the new big picture.
- A file and folder skeleton with purpose notes and algorithm relationships that link to entries in the Algorithms library.

Architecture data saves locally and can be exported as JSON.

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

After the workspace is opened once over HTTPS:

- On iPhone or iPad, use Safari's Share menu and choose **Add to Home Screen**.
- On Android or a supported desktop browser, use the browser's **Install app** action. The workspace also shows an Install button when the browser exposes it.

The app shell, tools, public pages, data files, and repository PDFs are cached for offline access. Remote KaTeX assets used by the legacy flashcard pages may still require a previously populated browser cache for full equation rendering.

## Testing and Deployment

Serve the repository locally and run browser acceptance checks against `http://localhost:8000`. JavaScript source can also be syntax-checked with Node.js.

Production is hosted from the `main` branch with GitHub Pages. Publishing requires committing and pushing the verified static files; there is no build step.

## Dependencies

- A current browser with ES modules, Canvas 2D, service workers, localStorage, and dialog support
- Python 3 for the documented local server command
- GitHub Pages for production hosting
- Bundled PDF.js 3.11.174 and PDF-Lib 1.17.1
- KaTeX 0.16.9 from jsDelivr for flashcard equation rendering

## Additional Information

- [TODO.md](TODO.md) tracks immediate and eventual work.
- [STRUCTURE.md](STRUCTURE.md) documents each maintained folder and file.
- The repository intentionally avoids analytics, accounts, and remote persistence.
- This is a personal academic website by Alex Maynes. Content and code structure are available for reference.
