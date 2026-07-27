# Vital Pancakes

[View the live website](https://amaynes.github.io/vital-pancakes/) · [Open the workspace](https://amaynes.github.io/vital-pancakes/workspace.html#area=tools) · [Download the app](https://amaynes.github.io/vital-pancakes/download-app.html)

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

The workspace uses `app/main.js` for routes and editors and `app/store.js` for its browser-local data model. Each tool under `tools/` is a standalone workspace module. A service worker pre-caches the workspace, tools, PDF dependencies, and public archive for offline use.

See [STRUCTURE.md](STRUCTURE.md) for the annotated repository map.

## Five Top-Level Sections

- **Everyday Life** — Separate Cooking, Gym, and Cleaning areas for practical knowledge used at home.
- **Research & Literature** — My research manuscripts, selected papers, and literature reviews.
- **Studies & Projects** — Empty personal libraries for studies, programming languages, algorithms, and projects, plus the existing notecard and educational collections.
- **Workspace** — The Visual Board, PDF Signer, Literature Analyzer, Travel Planner, and Software Architect without unrelated library content.
- **Download App** — Animated previews, phone screens, installation instructions, and the supported browser install action.

The interface uses an archival visual system based on warm paper, black ink, oxblood annotations, antique-brass details, sharp rules, engraved typography, and the original anatomical *Pinakes Vitae* emblem.

## Brand Identity

The public project, navigation, app, repository, and website name is **Vital Pancakes**. The homepage preserves **Pinakes Vitae — In Perpetuum** as the project's original identity and historical inspiration.

The canonical logo files are:

- `assets/pinakes-vitae-logo-final-light.png` — Primary website mark, drawn in black on white.
- `assets/pinakes-vitae-logo-final.png` — Inverted companion mark, drawn in white on charcoal.

The logo combines an anatomical skull and brain with a neural chip and circuitry, representing biological memory joined to a durable external index. The light version is the default throughout the website and is the source for the install icons.

## Personal Libraries

The editable areas use eight empty, permanent core libraries:

- **How to Cook** — Cooking methods, principles, tools, steps, and common mistakes.
- **Recipes** — Ingredients, timing, method, and notes for meals worth repeating.
- **Workout Types** — Training organized by purpose, frequency, exercises, and form notes.
- **House Cleaning** — Rooms and surfaces divided into supplies, frequency, and ordered cleaning steps.
- **Studies** — Concept breakdowns, visual explanations, essays, and developing notes.
- **Programming Languages** — Mental models, syntax refreshers, and personal gotchas.
- **Algorithms** — Use cases, explanations, complexity notes, and user-authored animated frames.
- **Projects** — Problems, solutions, languages, and live relationships to Algorithm entries.

These eight core libraries cannot be added, renamed, or deleted. Their entries remain editable and can be deleted after a standard confirmation, with no password requirement. Saved entries from the former Protocols area migrate into an optional Personal Routines library instead of being discarded.

User-created entries, boards, travel plans, and software architecture models stay in the current browser. They are not uploaded or synchronized. Clearing site data removes them, so important content should be backed up first.

Existing `localStorage` namespaces retain their earlier `pinakes-vitae-*` and `artificially-neuroscience-*` identifiers. They are implementation-level compatibility keys, not public branding, and must remain unchanged unless a migration preserves previously saved user data.

## Workspace Tools

### Visual Board

Provides an infinite white workspace for freehand markup, straight lines, arrows with editable start and tip handles, inline textboxes, and resizable or rotatable outlined shapes. Selection outlines and marquee hit-testing stay tight to each object, including narrow rotated geometry around diagonal lines and arrows. Compact menus create rectangles, ellipses, triangles, diamonds, hexagons, cubes, triangular prisms, pyramids, cylinders, and cones. Line, Arrow, and shape tools remain active after drawing so several items can be placed without choosing the tool again; Escape clears the current selection and returns to Select.

Every supported line or shape can use solid, dashed, dotted, dash–dot, or long-dash ink. Marquee-selected objects can be copied and pasted together, grouped into one movable piece, and released later; Group disables once the current selection is already grouped. Selected outlines can also be rebuilt as one editable vertex network: touching endpoints become a shared control, distinct vertices remain available, dragging a shared vertex reshapes every connected line, and clicking any segment selects the whole network. Outlined shapes can additionally be divided into independently selectable line segments and reassembled into their original form. Textboxes have contextual font-family, font-size, and text-color controls. The board supports locking, post-draw color and line-thickness changes, brush-style erasing, optional grid snapping, deep undo and redo, mouse or trackpad panning, pinch zooming, and PNG export of the current view.

Image files can be dropped directly onto the board without an upload control. They are compressed and stored locally as movable, resizable, rotatable board objects so annotations can be drawn over them without sending the source image to a server.

### PDF Signer

Opens PDFs locally with bundled PDF.js, supports page navigation, creates signatures in three visual styles, adds selectable dates, and allows every placed field to be moved, resized, or deleted before export. Select a signature or date to use its visible trash control, the toolbar action, or Delete/Backspace; Escape clears the selection. The finished file downloads as a genuinely signed PDF with PDF-Lib, and documents never leave the browser.

### Literature Analyzer

Opens local PDFs or a live embedded website, supports click-and-drag highlights with a comment attached to every mark, restores annotations by source, and exports annotated records as PNG or PDF. Comments appear in compact cards directly above their highlights by default and can be moved into a dedicated right-side rail with one toolbar toggle. A 300-step undo and redo history covers highlight creation, recoloring, comment edits, deletion, and complete clearing, with buttons plus standard Command/Ctrl keyboard shortcuts. PDF export writes highlights into the original pages and adds numbered comment pages.

Websites remain governed by their own embedding policies. Because browsers prevent one website from reading another website's rendered pixels, webpage exports preserve the source URL, highlight map, and comments rather than copying the remote page itself.

### Travel Planner

Provides a month calendar with overhead Select and Add Event tools. Multiple selected dates become paged, arrow-controlled 24-hour day timelines on the right. Add Event keeps the tool active and opens a compact editor above the clicked calendar day; existing events can be reopened there for editing or deletion.

Event titles, strict `HH:MM` 24-hour times, places, and notes stay in the current browser. Address and business searches run only after the Search button is pressed, use a rate-limited configurable Nominatim-compatible endpoint with local result caching and OpenStreetMap attribution, and fill the event's map-ready place field. Search queries leave the browser; saved travel plans do not. The tool has no reminders, notifications, accounts, synchronization, or external calendar integration.

### Software Architect

Provides a permanent `root/` folder and an editable file-tree workspace with aligned notes for every item. Folders and files spawn with blank placeholder names, can be renamed inline, and can be dragged into other folders. Individual nodes and the complete workspace can be cleared after a standard confirmation, with no password requirement.

Software architecture data saves locally, preserves legacy file nodes and system scopes through migration, and can be exported as JSON.

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

The app shell, tools, public pages, data files, and repository PDFs are cached for offline access. Remote KaTeX assets used by the legacy flashcard pages may still require a previously populated browser cache for full equation rendering.

## Testing and Deployment

Serve the repository locally and run browser acceptance checks against `http://localhost:8000`. JavaScript source can also be syntax-checked with Node.js.

Run every maintained model and geometry test from the repository root:

```bash
node --test tools/*.test.mjs
```

Production is hosted from the `main` branch with GitHub Pages. Publishing requires committing and pushing the verified static files; there is no build step.

## Dependencies

- A current browser with ES modules, Canvas 2D, service workers, localStorage, and dialog support
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
