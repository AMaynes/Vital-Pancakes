import { chunkDocuments, normalizeSelectedRecords } from "./inference-model.mjs";

const cancelled = new Set();

self.addEventListener("message", (event) => {
  const { type, id, collections, selectedIds } = event.data ?? {};
  if (type === "cancel") {
    cancelled.add(id);
    return;
  }
  if (type !== "index") return;
  try {
    self.postMessage({ type: "progress", id, progress: 0.2, text: "Normalizing selected records" });
    if (cancelled.has(id)) throw new DOMException("Indexing cancelled.", "AbortError");
    const documents = normalizeSelectedRecords(collections, selectedIds);
    self.postMessage({ type: "progress", id, progress: 0.55, text: "Chunking long records with provenance" });
    if (cancelled.has(id)) throw new DOMException("Indexing cancelled.", "AbortError");
    const chunks = chunkDocuments(documents);
    self.postMessage({ type: "progress", id, progress: 0.9, text: "Preparing searchable evidence index" });
    if (cancelled.has(id)) throw new DOMException("Indexing cancelled.", "AbortError");
    self.postMessage({ type: "complete", id, documents, chunks });
  } catch (error) {
    self.postMessage({ type: "error", id, error: error.message, cancelled: error.name === "AbortError" });
  } finally {
    cancelled.delete(id);
  }
});
