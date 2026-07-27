# Pinakes Vitae — In Perpetuum

[View the live website](https://amaynes.github.io/pinakes-vitae/) · [Open the workspace](https://amaynes.github.io/pinakes-vitae/workspace.html#area=tools) · [Download the app](https://amaynes.github.io/pinakes-vitae/download-app.html)

Pinakes Vitae—*in perpetuum*—is Alex Maynes's living, local-first index of knowledge. It preserves research, critical reading notes, everyday-life guides, reference material, projects, and interactive study tools so that what was learned can be found and used again. The name evokes the *Pinakes* of the Library of Alexandria while giving the idea a new purpose: recovering knowledge that study, time, and disuse would otherwise erase.

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

The workspace uses `app/main.js` for routes and editors and `app/store.js` for its browser-local data model. Each tool under `tools/` is a standalone full-screen module. A service worker pre-caches the workspace, tools, PDF dependencies, and public archive for offline use.

See [STRUCTURE.md](STRUCTURE.md) for the annotated repository map.

## Five Top-Level Sections

- **Everyday Life** — Separate Cooking, Gym, and Cleaning areas for practical knowledge used at home.
- **Research & Literature** — My research manuscripts, selected papers, and literature reviews.
- **Studies & Projects** — Empty personal libraries for studies, programming languages, algorithms, and projects, plus the existing notecard and educational collections.
- **Workspace** — The Visual Board, PDF Signer, Literature Analyzer, Travel Planner, and Architecture Designer without unrelated library content.
- **Download App** — Animated previews, phone screens, installation instructions, and the supported browser install action.

The interface uses an archival visual system based on warm paper, black ink, oxblood annotations, antique-brass details, sharp rules, engraved typography, and the anatomical Pinakes Vitae emblem.

## Brand Identity

The complete project name is **Pinakes Vitae — In Perpetuum**. Use **Pinakes Vitae** as the compact navigation and app name, and *In Perpetuum* as the motto.

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

These eight core libraries cannot be added, renamed, or deleted. Their entries remain editable and can be deleted using the requested password `password`. Because this is a static local-first site, the password is a convenience guard and not secure access control. Saved entries from the former Protocols area migrate into an optional Personal Routines library instead of being discarded.

User-created entries, boards, travel plans, and architecture models stay in the current browser. They are not uploaded or synchronized. Clearing site data removes them, so important content should be backed up first.

Existing `localStorage` namespaces retain their original `artificially-neuroscience-*` identifiers. They are implementation-level compatibility keys, not public branding, and must remain unchanged unless a migration preserves previously saved user data.

## Workspace Tools

### Visual Board

Provides an infinite white workspace for freehand markup, straight lines, arrows with editable start and tip handles, inline textboxes, and resizable or rotatable outlined shapes. Selection outlines and marquee hit-testing stay tight to each object, including narrow rotated geometry around diagonal lines and arrows. Compact menus create rectangles, ellipses, triangles, diamonds, hexagons, cubes, triangular prisms, pyramids, cylinders, and cones. Line, Arrow, and shape tools remain active after drawing so several items can be placed without choosing the tool again; Escape clears the current selection and returns to Select.

Every supported line or shape can use solid, dashed, dotted, dash–dot, or long-dash ink. Marquee-selected objects can be copied and pasted together, grouped into one movable piece, and released later; Group disables once the current selection is already grouped. Selected outlines can also be rebuilt as one editable vertex network: touching endpoints become a shared control, distinct vertices remain available, dragging a shared vertex reshapes every connected line, and clicking any segment selects the whole network. Outlined shapes can additionally be divided into independently selectable line segments and reassembled into their original form. Textboxes have contextual font-family, font-size, and text-color controls. The board supports locking, post-draw color and line-thickness changes, brush-style erasing, optional grid snapping, deep undo and redo, mouse or trackpad panning, pinch zooming, and PNG export of the current view.

Image files can be dropped directly onto the board without an upload control. They are compressed and stored locally as movable, resizable, rotatable board objects so annotations can be drawn over them without sending the source image to a server.

### PDF Signer

Opens PDFs locally with bundled PDF.js, supports page navigation, creates signatures in three visual styles, adds selectable dates, allows every placed field to be moved and resized on any page, and downloads a genuinely signed PDF with PDF-Lib. Documents never leave the browser.

### Literature Analyzer

Opens local PDFs or a live embedded website, supports click-and-drag highlights with a comment attached to every mark, restores annotations by source, and exports annotated records as PNG or PDF. PDF export writes highlights into the original pages and adds numbered comment pages.

Websites remain governed by their own embedding policies. Because browsers prevent one website from reading another website's rendered pixels, webpage exports preserve the source URL, highlight map, and comments rather than copying the remote page itself.

### Travel Planner

Provides a simple month calendar for flights, stays, reservations, places, and daily itinerary notes. Each plan can include an optional time, place, and notes; saved places can open directly in Google Maps.

Travel plans stay in the current browser. The tool has no reminders, notifications, accounts, synchronization, or external calendar integration.

### Architecture Designer

Provides a permanent `root/` folder and an editable file-tree workspace with aligned notes for every item. Folders and files spawn with blank placeholder names, can be renamed inline, and can be dragged into other folders. Individual nodes can be removed without a password; clearing the complete workspace retains the shared delete-password safeguard.

Architecture data saves locally, preserves legacy file nodes and system scopes through migration, and can be exported as JSON.

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
