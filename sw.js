/**
 * Overview & Purpose
 * Provides the offline application shell for the installable workspace.
 *
 * Architectural Relationships
 * Called by: The browser service-worker lifecycle registered from app/main.js.
 * Calls: Cache Storage and Fetch APIs.
 *
 * External Resources
 * Static files listed in APP_SHELL.
 *
 * Notes
 * Same-origin GET requests use cache-first behavior with background cache fill.
 * User-created localStorage, IndexedDB, and model-cache data stays outside the
 * application shell. Caption Relay's large model weights are never pre-cached.
 */

const CACHE_NAME = "vital-pancakes-app-v44";
const RETAINED_CACHE_NAMES = new Set([
  CACHE_NAME,
  "vital-pancakes-rife-v1",
]);
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=18",
  "./site-navigation.css?v=20",
  "./site-navigation.js?v=12",
  "./research-literature.html",
  "./download-app.html",
  "./download-app.css?v=16",
  "./workspace.html",
  "./workspace.css?v=25",
  "./manifest.webmanifest",
  "./assets/vital-pancakes-logo-transparent-black.png?v=1",
  "./assets/vital-pancakes-logo-transparent-white.png?v=1",
  "./assets/app-icon-192.png",
  "./assets/app-icon-512.png",
  "./assets/app-preview-workspace.svg?v=4",
  "./assets/app-preview-studies.svg?v=2",
  "./app/main.js?v=16",
  "./app/ai-command-protocol.mjs",
  "./app/ai-command-registry.mjs",
  "./app/ai-page-host.mjs",
  "./app/ai-tool-catalog.mjs",
  "./app/content-view.mjs",
  "./app/tag-filter.mjs?v=1",
  "./app/store.js?v=14",
  "./app/algorithm-samples.mjs?v=2",
  "./app/algorithm-analysis-samples.mjs?v=1",
  "./app/algorithm-code-examples.mjs?v=1",
  "./app/download-app.js",
  "./tools/tool.css?v=33",
  "./tools/visual-board.html",
  "./tools/visual-board.js?v=29",
  "./tools/visual-board-animation.mjs?v=1",
  "./tools/visual-board-character.mjs?v=1",
  "./tools/visual-board-clipboard.mjs?v=2",
  "./tools/visual-board-curves.mjs?v=1",
  "./tools/visual-board-export.mjs?v=2",
  "./tools/visual-board-geometry.mjs?v=8",
  "./tools/visual-board-groups.mjs?v=2",
  "./tools/visual-board-history.mjs?v=2",
  "./tools/visual-board-interpolation.mjs?v=1",
  "./tools/visual-board-library.mjs?v=1",
  "./tools/visual-board-rich-text.mjs?v=1",
  "./tools/visual-board-rigging.mjs?v=1",
  "./tools/visual-board-rife.mjs?v=1",
  "./tools/visual-board-shape-tools.mjs?v=1",
  "./tools/visual-board-strokes.mjs?v=1",
  "./tools/visual-board-text.mjs?v=1",
  "./tools/visual-board-tracing.mjs?v=1",
  "./tools/visual-board-vertices.mjs?v=2",
  "./tools/pdf-signer.html",
  "./tools/pdf-signer.js?v=3",
  "./tools/pdf-signer-placements.mjs",
  "./tools/literature-analyzer.html",
  "./tools/literature-analyzer.css?v=2",
  "./tools/literature-analyzer.js?v=3",
  "./tools/literature-analyzer-model.mjs",
  "./tools/master-lesson-builder.html",
  "./tools/master-lesson-builder.css?v=2",
  "./tools/master-lesson-builder.js?v=6",
  "./tools/master-lesson-chunking.mjs",
  "./tools/master-lesson-db.mjs",
  "./tools/master-lesson-extraction.mjs?v=2",
  "./tools/master-lesson-outline.mjs?v=3",
  "./tools/master-lesson-prompts.mjs",
  "./tools/master-lesson-queue.mjs",
  "./tools/master-lesson-retrieval.mjs",
  "./tools/master-lesson-study.mjs",
  "./tools/master-lesson-text.mjs?v=2",
  "./tools/master-lesson-validation.mjs",
  "./tools/master-lesson-worker.js?v=1",
  "./tools/caption-relay.html",
  "./tools/caption-relay.css?v=2",
  "./tools/caption-relay.js?v=4",
  "./tools/caption-relay-ai-adapter.mjs",
  "./tools/caption-audio-worklet.js?v=2",
  "./tools/caption-capture.mjs",
  "./tools/caption-fingerprint-worker.js",
  "./tools/caption-fingerprint.mjs",
  "./tools/caption-formats.mjs",
  "./tools/caption-mirror.mjs",
  "./tools/caption-overlay.mjs",
  "./tools/caption-package.mjs",
  "./tools/caption-storage.mjs",
  "./tools/caption-sync.mjs",
  "./tools/caption-text-sync.mjs",
  "./tools/caption-timing.mjs",
  "./tools/caption-transcript.mjs",
  "./tools/caption-transcription-worker.js",
  "./tools/caption-translation-worker.js",
  "./tools/caption-translation.mjs",
  "./tools/literature-curator.html",
  "./tools/literature-curator.css?v=1",
  "./tools/literature-curator.js?v=1",
  "./tools/literature-curator-model.mjs",
  "./tools/travel-planner.html",
  "./tools/travel-planner.css?v=2",
  "./tools/travel-planner.js?v=2",
  "./tools/travel-planner-config.json",
  "./tools/travel-planner-model.mjs",
  "./tools/travel-place-search.mjs",
  "./tools/architecture.html",
  "./tools/architecture.js?v=5",
  "./tools/architecture-model.mjs",
  "./tools/file-converter.html",
  "./tools/file-converter.css?v=2",
  "./tools/file-converter.js?v=2",
  "./tools/file-converter-state.mjs",
  "./tools/budget-finance.html",
  "./tools/budget-finance.css?v=2",
  "./tools/budget-finance.js?v=2",
  "./tools/budget-finance-model.mjs?v=1",
  "./tools/tax-directory.mjs?v=1",
  "./tools/scientific-calculator.html",
  "./tools/scientific-calculator.css?v=2",
  "./tools/scientific-calculator.js?v=2",
  "./tools/scientific-calculator-engine.mjs?v=1",
  "./tools/file-converter-app/index.html",
  "./tools/file-converter-app/cache.json",
  "./tools/file-converter-app/assets/index-VitalPancakes.css",
  "./tools/file-converter-app/assets/index-CqjCqN4s.js",
  "./tools/file-converter-app/assets/jszip-3.11.1.min.js",
  "./vendor/mediabunny-1.51.0.min.mjs",
  "./vendor/mathjs-15.2.0.min.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/pdf-lib.min.js",
  "./genericListLoader.js",
  "./research_publications/index.html",
  "./research_publications/publications.txt",
  "./research_publications/extra-publications.txt",
  "./research_publications/pdfs/dobotpub.pdf",
  "./research_publications/pdfs/synaptic-info-storage-pub.pdf",
  "./literature_analysis/index.html",
  "./literature_analysis/lit_analysis_list.txt",
  "./educational_resources/index.html",
  "./educational_resources/flashcards.css?v=16",
  "./educational_resources/compsci/index.html",
  "./educational_resources/compsci/compsci_notes_list.txt",
  "./educational_resources/neurosci/index.html",
  "./educational_resources/neurosci/neurosci_notes_list.txt",
  "./educational_resources/mathematics/index.html",
  "./educational_resources/mathematics/mathematics_notes_list.txt",
  "./educational_resources/mathematics/flashcard-practice.html",
  "./educational_resources/mathematics/flashcards.json",
  "./educational_resources/arts/index.html",
  "./educational_resources/arts/arts_notes_list.txt",
  "./educational_resources/arts/flashcard-practice.html",
  "./educational_resources/arts/flashcards.json",
  "./CheatSheets/Algebra-MasterSheet.pdf",
  "./CheatSheets/Calculus-MasterSheet.pdf",
  "./CheatSheets/Trigonometry-MasterSheet.pdf"
];

/**
 * Pre-caches the complete interactive application shell.
 *
 * @param {ExtendableEvent} event Install lifecycle event.
 */
function handleInstall(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
}

/**
 * Removes application-shell caches from older releases.
 *
 * @param {ExtendableEvent} event Activate lifecycle event.
 */
function handleActivate(event) {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => !RETAINED_CACHE_NAMES.has(key))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
}

/**
 * Serves same-origin GET requests cache-first and stores successful misses.
 *
 * @param {FetchEvent} event Fetch event.
 */
function handleFetch(event) {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse.ok) {
          const responseCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
        }
        return networkResponse;
      });
    }),
  );
}

self.addEventListener("install", handleInstall);
self.addEventListener("activate", handleActivate);
self.addEventListener("fetch", handleFetch);
