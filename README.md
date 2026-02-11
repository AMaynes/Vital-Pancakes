# Artificially Neuroscience

🌐 **Live Site**: [https://amaynes.github.io/artificially-neuroscience/](https://amaynes.github.io/artificially-neuroscience/)

A personal academic website hosting research publications, literature analysis, and educational resources spanning Computer Science, Neuroscience, and Mathematics.

## 📋 Overview

This static website serves as a centralized repository for:
- **Research Publications**: Original research papers and curated publications
- **Literature Analysis**: Critical analyses and reflections on academic works
- **Educational Resources**: Notes, models, and learning materials organized by discipline

## 🗂️ Structure

```
artificially-neuroscience/
├── index.html                 # Homepage
├── style.css                  # Global styles
├── genericListLoader.js       # Dynamic content loader
├── research_publications/
│   ├── index.html
│   ├── publications.txt       # Personal publications
│   ├── extra-publications.txt # Curated publications
│   └── pdfs/                  # PDF storage
├── literature_analysis/
│   ├── index.html
│   └── lit_analysis_list.txt  # Analysis documents
└── educational_resources/
    ├── index.html
    ├── compsci/
    │   ├── index.html
    │   └── compsci_notes_list.txt
    ├── mathematics/
    │   ├── index.html
    │   ├── mathematics_notes_list.txt
    │   ├── flashcard-practice.html  # Interactive flashcard app
    │   └── flashcards.json          # Flashcard data with LaTeX
    └── neurosci/
        ├── index.html
        └── neurosci_notes_list.txt
```

## ✨ Features

- **Dynamic Content Loading**: Uses a custom JavaScript loader to parse and display content from text files
- **Responsive Navigation**: Consistent header navigation across all pages
- **Organized by Discipline**: Educational resources separated into CS, Neuroscience, and Mathematics
- **Alphabetical Sorting**: All lists are automatically sorted alphabetically
- **Clean Design**: Minimalist CSS with professional styling
- **Interactive Flashcards**: Mathematics flashcard practice with:
  - **Topic Tree Selection**: Browse by category (Foundations, Calculus, Linear Algebra)
  - **Subcategory Practice**: Focus on specific topics (Limits, Derivatives, Matrices, etc.)
  - **Master Mode**: Practice all cards within a category branch
  - **Mixed Mode**: Random cards from all topics
  - **LaTeX Rendering**: Full support for equations, integrals, matrices, and vectors

## 🔧 Technical Implementation

### Content Format

The site uses a custom `<Entry>` block format for listing documents:

```
<Entry>
Name: "Document Title - Author Name"
PDF-Path: "path/to/document.pdf"
<Entry-End>
```

### Generic List Loader

The `genericListLoader.js` script:
1. Fetches content from specified text files
2. Parses `<Entry>` blocks to extract names and paths
3. Sorts entries alphabetically by name
4. Dynamically generates HTML lists with links

### Usage Example

```javascript
loadList("publications.txt", "research-pub-list");
```

## 📝 Adding Content

### Adding a Publication

1. Navigate to `research_publications/publications.txt` (or `extra-publications.txt`)
2. Add a new entry:
   ```
   <Entry>
   Name: "Your Paper Title - Your Name"
   PDF-Path: "pdfs/your-paper.pdf"
   <Entry-End>
   ```
3. Place the PDF in `research_publications/pdfs/`

### Adding Educational Resources

1. Navigate to the appropriate category folder (e.g., `educational_resources/compsci/`)
2. Add an entry to the category's text file (e.g., `compsci_notes_list.txt`)
3. Follow the same `<Entry>` block format

### Adding Literature Analysis

1. Edit `literature_analysis/lit_analysis_list.txt`
2. Add your analysis document following the entry format

### Adding Math Flashcards

The flashcards use a hierarchical JSON structure with categories and subcategories.

1. Edit `educational_resources/mathematics/flashcards.json`
2. Find the appropriate category and subcategory, then add a card:
   ```json
   {
     "question": "Your question (supports $inline$ and $$display$$ math)",
     "answer": "The answer (also supports LaTeX)"
   }
   ```
3. To add a new subcategory under an existing category:
   ```json
   "newsubcategory": {
     "name": "Display Name",
     "cards": [ ... ]
   }
   ```

**Current Categories:**
- **Foundations**: Algebra, Trigonometry, Vector Math
- **Calculus**: Limits, Derivatives, Integrals, Series, Differential Equations, Multivariable
- **Linear Algebra**: Matrices, Eigenvalues, Linear Systems

**LaTeX Tips:**
- Use `$...$` for inline math
- Use `$$...$$` for display math
- Supports integrals, limits, matrices, vectors, and all standard LaTeX notation

## 🚀 Deployment

This is a static website that can be deployed to any web hosting service:

- **GitHub Pages**: Push to a repository and enable GitHub Pages
- **Netlify**: Drag and drop the folder or connect to a Git repository
- **Vercel**: Import the project from Git
- **Traditional Hosting**: Upload files via FTP to any web server

No build process or server-side rendering required.

## 🎨 Customization

### Styling

Edit `style.css` to customize:
- Color scheme (currently uses `rgb(43,59,116)` for links)
- Layout and spacing
- Typography and fonts
- Header and navigation appearance

### Navigation

Update the navigation links in each `index.html` file's `<nav>` section to add or remove pages.

## 📄 License

This is a personal academic website. Content and code structure are available for reference.

## 👤 Author

Alex Maynes

---

*Last updated: February 2026*
