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
 * Navigations use network-first behavior with an offline fallback. Versioned
 * static assets remain cache-first.
 * User-created localStorage, IndexedDB, OPFS, and model-cache data stays outside
 * the application shell. File Drop content and large model weights are never pre-cached.
 */

const CACHE_NAME = "vital-pancakes-app-v73";
const RETAINED_CACHE_NAMES = new Set([
  CACHE_NAME,
  "vital-pancakes-rife-v1",
]);
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=20",
  "./site-navigation.css?v=21",
  "./site-navigation.js?v=16",
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
  "./app/main.js?v=20",
  "./app/ai-command-protocol.mjs",
  "./app/ai-command-registry.mjs",
  "./app/ai-page-host.mjs",
  "./app/ai-tool-catalog.mjs",
  "./app/home-knowledge.js?v=1",
  "./app/home-knowledge-ai-adapter.mjs",
  "./app/glossary-ui.mjs",
  "./app/knowledge-db.mjs",
  "./app/knowledge-model.mjs",
  "./app/knowledge-sync.mjs",
  "./app/vault-archive.mjs",
  "./app/vault-codec.mjs",
  "./app/vault-storage.mjs",
  "./app/workspace-ai-adapter.mjs",
  "./app/offline-shell.mjs?v=2",
  "./app/content-view.mjs",
  "./app/tag-filter.mjs?v=1",
  "./app/store.js?v=14",
  "./app/algorithm-samples.mjs?v=2",
  "./app/algorithm-analysis-samples.mjs?v=1",
  "./app/algorithm-code-examples.mjs?v=1",
  "./app/download-app.js",
  "./tools/tool.css?v=33",
  "./tools/tool.css?v=34",
  "./tools/workspace-suite.css?v=1",
  "./tools/local-toolkit.mjs",
  "./tools/suite-ui.mjs",
  "./tools/local-webllm-client.mjs",
  "./tools/local-webllm-worker.js?v=1",
  "./tools/ai-command-center.html",
  "./tools/ai-command-center.css?v=1",
  "./tools/ai-command-center.js?v=1",
  "./tools/ai-command-center-adapter.mjs",
  "./tools/ai-command-draft.mjs",
  "./tools/ai-webllm-worker.js",
  "./tools/current-tool-ai-adapter.mjs?v=1",
  "./tools/visual-board.html",
  "./tools/visual-board.js?v=46",
  "./tools/visual-board-ai.css?v=1",
  "./tools/visual-board-advanced.css?v=6",
  "./tools/visual-board-ai-adapter.mjs?v=11",
  "./tools/visual-board-image.mjs?v=1",
  "./tools/visual-board-transform.mjs?v=3",
  "./tools/visual-board-architecture.mjs?v=2",
  "./tools/visual-board-architecture-geometry.mjs?v=1",
  "./tools/visual-board-static-export.mjs?v=6",
  "./tools/visual-board-floor-plan.mjs?v=6",
  "./tools/visual-board-floor-plan-templates.mjs?v=3",
  "./tools/visual-board-eraser.mjs?v=1",
  "./tools/visual-board-animation.mjs?v=1",
  "./tools/visual-board-character.mjs?v=2",
  "./tools/visual-board-clipboard.mjs?v=3",
  "./tools/visual-board-curves.mjs?v=2",
  "./tools/visual-board-curves.mjs?v=3",
  "./tools/visual-board-curves.mjs?v=4",
  "./tools/visual-board-export.mjs?v=2",
  "./tools/visual-board-geometry.mjs?v=10",
  "./tools/visual-board-geometry.mjs?v=11",
  "./tools/visual-board-groups.mjs?v=3",
  "./tools/visual-board-history.mjs?v=2",
  "./tools/visual-board-interpolation.mjs?v=1",
  "./tools/visual-board-library.mjs?v=1",
  "./tools/visual-board-rich-text.mjs?v=1",
  "./tools/visual-board-rigging.mjs?v=1",
  "./tools/visual-board-rife.mjs?v=1",
  "./tools/visual-board-shape-tools.mjs?v=1",
  "./tools/visual-board-strokes.mjs?v=1",
  "./tools/visual-board-text.mjs?v=2",
  "./tools/visual-board-tracing.mjs?v=1",
  "./tools/visual-board-vertices.mjs?v=3",
  "./tools/pdf-signer.html",
  "./tools/pdf-signer.js?v=3",
  "./tools/pdf-signer-placements.mjs",
  "./tools/literature-analyzer.html",
  "./tools/literature-analyzer.css?v=2",
  "./tools/literature-analyzer.js?v=3",
  "./tools/literature-analyzer-model.mjs",
  "./tools/master-lesson-builder.html",
  "./tools/master-lesson-builder.css?v=4",
  "./tools/master-lesson-builder.js?v=7",
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
  "./tools/master-lesson-review.mjs",
  "./tools/master-lesson-review-ui.mjs",
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
  "./tools/overhead.html",
  "./tools/overhead.js?v=2",
  "./tools/overhead-model.mjs",
  "./tools/file-drop.html",
  "./tools/file-drop.js?v=2",
  "./tools/file-drop-model.mjs",
  "./tools/file-drop-hash-worker.js?v=1",
  "./tools/graphing.html",
  "./tools/graphing.js?v=2",
  "./tools/graphing-model.mjs",
  "./tools/graphing-renderer.mjs",
  "./tools/graphing-worker.js?v=1",
  "./tools/inference.html",
  "./tools/inference.js?v=2",
  "./tools/inference-model.mjs",
  "./tools/inference-index-worker.js?v=1",
  "./tools/markdown-studio.html",
  "./tools/markdown-studio.js?v=2",
  "./tools/markdown-studio-model.mjs",
  "./tools/tool-designer.html",
  "./tools/tool-designer.js?v=2",
  "./tools/tool-designer-model.mjs",
  "./tools/color-aesthetic.html",
  "./tools/color-aesthetic.js?v=2",
  "./tools/color-aesthetic-model.mjs",
  "./tools/color-aesthetic-worker.js?v=1",
  "./tools/bracket-generator.html",
  "./tools/bracket-generator.js?v=2",
  "./tools/bracket-model.mjs",
  "./tools/bracket-renderer.mjs",
  "./tools/randomized-picker.html",
  "./tools/randomized-picker.js?v=3",
  "./tools/randomized-picker-model.mjs",
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
  "./vendor/ts-fsrs-5.4.1.mjs",
  "./vendor/ts-fsrs-5.4.1-LICENSE.txt",
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

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const responseCopy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true })
          .then((cachedResponse) => cachedResponse || caches.match("./index.html"))),
    );
    return;
  }

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
