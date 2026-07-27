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
 * User-created localStorage data is outside service-worker storage and remains local.
 */

const CACHE_NAME = "vital-pancakes-app-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=17",
  "./site-navigation.css?v=17",
  "./site-navigation.js?v=6",
  "./research-literature.html",
  "./download-app.html",
  "./download-app.css?v=16",
  "./workspace.html",
  "./workspace.css?v=17",
  "./manifest.webmanifest",
  "./assets/pinakes-vitae-logo-final-light.png",
  "./assets/app-icon-192.png",
  "./assets/app-icon-512.png",
  "./assets/app-preview-workspace.svg?v=4",
  "./assets/app-preview-studies.svg?v=2",
  "./app/main.js?v=4",
  "./app/store.js",
  "./app/download-app.js",
  "./tools/tool.css?v=24",
  "./tools/visual-board.html",
  "./tools/visual-board.js?v=10",
  "./tools/visual-board-clipboard.mjs?v=2",
  "./tools/visual-board-geometry.mjs?v=6",
  "./tools/visual-board-vertices.mjs?v=1",
  "./tools/pdf-signer.html",
  "./tools/pdf-signer.js?v=3",
  "./tools/pdf-signer-placements.mjs",
  "./tools/literature-analyzer.html",
  "./tools/literature-analyzer.css?v=2",
  "./tools/literature-analyzer.js?v=3",
  "./tools/literature-analyzer-model.mjs",
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
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
