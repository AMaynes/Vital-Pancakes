/**
 * Computes a deterministic chunk-tree fingerprint off the main thread. It
 * reads one chunk at a time, avoiding another complete in-memory file copy.
 */

const CHUNK_BYTES = 4 * 1024 * 1024;
const cancelled = new Set();

self.addEventListener("message", async (event) => {
  const { type, id, file } = event.data ?? {};
  if (type === "cancel") {
    cancelled.add(id);
    return;
  }
  if (type !== "hash" || !id || !(file instanceof Blob)) return;
  try {
    const chunkHashes = [];
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      if (cancelled.has(id)) throw new DOMException("Import cancelled.", "AbortError");
      const bytes = await file.slice(offset, Math.min(file.size, offset + CHUNK_BYTES)).arrayBuffer();
      chunkHashes.push(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
      self.postMessage({ type: "progress", id, loaded: Math.min(file.size, offset + CHUNK_BYTES), total: file.size });
    }
    const combined = new Uint8Array(chunkHashes.length * 32);
    chunkHashes.forEach((hash, index) => combined.set(hash, index * 32));
    const finalHash = new Uint8Array(await crypto.subtle.digest("SHA-256", combined));
    self.postMessage({ type: "complete", id, fingerprint: toHex(finalHash), algorithm: "sha256-tree-v1" });
  } catch (error) {
    self.postMessage({ type: "error", id, error: error.message, cancelled: error.name === "AbortError" });
  } finally {
    cancelled.delete(id);
  }
});

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
