import { chunkKnowledgeDocuments } from "./knowledge-inference.mjs";

self.addEventListener("message", (event) => {
  const { type, id, documents } = event.data ?? {};
  if (type !== "index") return;
  try {
    self.postMessage({ type: "progress", id, progress: 0.2, text: "Preparing local knowledge" });
    const chunks = chunkKnowledgeDocuments(documents);
    self.postMessage({ type: "complete", id, chunks });
  } catch (error) {
    self.postMessage({ type: "error", id, error: error.message });
  }
});
