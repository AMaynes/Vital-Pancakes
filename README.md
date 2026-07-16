# Artificially Neuroscience

[View the live website](https://amaynes.github.io/artificially-neuroscience/)

Artificially Neuroscience is Alex Maynes's public interdisciplinary learning laboratory. It preserves research, critical reading notes, academic reference material, and interactive study tools across neuroscience, artificial intelligence, mathematics, computer science, and art.

The project is intentionally built as a small static website. Its purpose is to make accumulated learning durable, navigable, and useful without requiring a server, database, account, or paid hosting platform.

## Running the Project

The site runs on Windows, macOS, and Linux in any modern browser.

From the repository root, start a local web server:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

Opening files directly from disk is not supported because browser security rules prevent the content loader from fetching local text and JSON files.

## System Overview

GitHub Pages serves the repository as a static website. Each major section has its own HTML entry page, while `style.css` provides the shared visual system.

Repository-managed lists use small text files containing `<Entry>` blocks. `genericListLoader.js` fetches those files, parses their metadata, sorts entries alphabetically, and renders safe links into the page.

The mathematics and arts flashcard applications load their subject-specific `flashcards.json` files. Quiz scores, missed-answer queues, and drafted submissions remain in the visitor's browser through `localStorage`.

See [STRUCTURE.md](STRUCTURE.md) for the complete annotated repository map.

## Homepage

`index.html` introduces the project's purpose and directs visitors toward research, analysis, and active learning. It highlights the connection between the site's disciplines and surfaces the mathematics flashcard laboratory as a major feature.

## Research Publications

`research_publications/` separates original work from selected external publications. Metadata lives in text files so a paper can be added without editing page markup.

## Literature Analysis

`literature_analysis/` is the future home of durable critical-reading notes. It is designed to preserve arguments, methods, limitations, and open questions after a paper or book has been read.

## Educational Resources

`educational_resources/` organizes learning materials into mathematics, neuroscience, computer science, and arts. Each discipline can contain long-form notes, external references, downloadable material, and interactive tools.

## Flashcard Laboratories

Mathematics and arts each include a browser-based flashcard application. Features include topic selection, mixed practice, master modes, knowledge tests, daily statistics, missed-answer review, LaTeX rendering, and locally drafted card submissions.

The applications currently share duplicated implementation code. Consolidating them into one reusable engine is tracked in [TODO.md](TODO.md).

## Adding List Content

Content lists use this format:

```text
<Entry>
Name: "Document Title"
PDF-Path: "relative/path/to/document.pdf"
Description: "Optional short explanation."
<Entry-End>
```

Add entries to the appropriate text file:

- `research_publications/publications.txt`
- `research_publications/extra-publications.txt`
- `literature_analysis/lit_analysis_list.txt`
- A discipline's `*_notes_list.txt`

Paths are resolved relative to the page that loads the list.

## Adding Flashcards

Flashcards live in each discipline's `flashcards.json`. Cards are grouped into categories and subcategories:

```json
{
  "question": "What is the derivative of $x^2$?",
  "answer": "$2x$"
}
```

Mathematics cards support KaTeX using `$...$` for inline expressions and `$$...$$` for display expressions.

## Deployment

The production site is hosted from the `main` branch with GitHub Pages. Publishing an update requires committing and pushing the verified static files; no separate build step is required.

## Additional Information

- `TODO.md` tracks immediate and eventual work.
- `STRUCTURE.md` documents the responsibility of every maintained folder and file.
- Content submitted through the flashcard interface remains on the current device until manually copied into the repository.
- The repository intentionally avoids analytics, accounts, and remote persistence.

## Dependencies

- A modern web browser
- Python 3 for the documented local server command
- GitHub Pages for production hosting
- KaTeX 0.16.9 from jsDelivr for mathematical expression rendering
