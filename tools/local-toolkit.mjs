/**
 * Shared browser-local persistence, backup, and history primitives for the
 * newer Vital Pancakes workspace tools.
 */

const DATABASE_NAME = "vital-pancakes-local-tools";
const DATABASE_VERSION = 1;
const RECORD_STORE = "records";
const BLOB_STORE = "blobs";

export const BACKUP_FORMAT = "vital-pancakes-tool-backup";
export const BACKUP_VERSION = 1;

export function createId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function createUndoManager(limit = 100) {
  const undoStack = [];
  const redoStack = [];

  return {
    record(before, after, label = "Edit") {
      undoStack.push({ before: cloneValue(before), after: cloneValue(after), label });
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
    },
    undo(current) {
      const entry = undoStack.pop();
      if (!entry) return { value: current, label: null };
      redoStack.push({ before: cloneValue(entry.before), after: cloneValue(current), label: entry.label });
      return { value: cloneValue(entry.before), label: entry.label };
    },
    redo(current) {
      const entry = redoStack.pop();
      if (!entry) return { value: current, label: null };
      undoStack.push({ before: cloneValue(current), after: cloneValue(entry.after), label: entry.label });
      return { value: cloneValue(entry.after), label: entry.label };
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
  };
}

export function validateBackupEnvelope(value, expectedTool) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Backup must be a JSON object.");
  }
  if (value.format !== BACKUP_FORMAT) throw new TypeError("This is not a Vital Pancakes tool backup.");
  if (value.version !== BACKUP_VERSION) throw new TypeError(`Unsupported backup version: ${value.version}.`);
  if (expectedTool && value.tool !== expectedTool) {
    throw new TypeError(`Expected a ${expectedTool} backup, received ${value.tool || "an unknown tool"}.`);
  }
  if (!Array.isArray(value.records)) throw new TypeError("Backup records are missing or invalid.");
  return value;
}

export function buildBackup(tool, records, metadata = {}) {
  if (!tool || typeof tool !== "string") throw new TypeError("A tool identifier is required.");
  if (!Array.isArray(records)) throw new TypeError("Backup records must be an array.");
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    tool,
    exportedAt: new Date().toISOString(),
    metadata: cloneValue(metadata),
    records: cloneValue(records),
  };
}

export function mergeImportedRecords(existing, incoming, options = {}) {
  const getId = options.getId ?? ((record) => record.id);
  const merged = new Map(existing.map((record) => [getId(record), cloneValue(record)]));
  const conflicts = [];

  incoming.forEach((record) => {
    const id = getId(record);
    if (!id || typeof id !== "string") throw new TypeError("Every imported record needs a string id.");
    if (!merged.has(id)) {
      merged.set(id, cloneValue(record));
      return;
    }

    const current = merged.get(id);
    if (JSON.stringify(current) === JSON.stringify(record)) return;
    const importedId = `${id}-imported-${createId("copy").slice(-8)}`;
    merged.set(importedId, { ...cloneValue(record), id: importedId });
    conflicts.push({ originalId: id, importedId });
  });

  return { records: [...merged.values()], conflicts };
}

export function safeFilename(name, fallback = "download") {
  const cleaned = String(name ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.-]+|[.-]+$/g, "")
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFilename(filename);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJson(value, filename) {
  downloadBlob(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }),
    filename,
  );
}

export async function readJsonFile(file, maximumBytes = 50 * 1024 * 1024) {
  if (!(file instanceof Blob)) throw new TypeError("Choose a JSON file first.");
  if (file.size > maximumBytes) throw new RangeError("This JSON file is larger than the supported import limit.");
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new TypeError("The selected file does not contain valid JSON.");
  }
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  return { supported: true, persisted: await navigator.storage.persist() };
}

export async function estimateStorage() {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0, supported: false };
  const estimate = await navigator.storage.estimate();
  return {
    usage: Number(estimate.usage) || 0,
    quota: Number(estimate.quota) || 0,
    supported: true,
  };
}

export function openToolDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Storage upgrade is blocked by another open Vital Pancakes tab."));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORD_STORE)) {
        const records = database.createObjectStore(RECORD_STORE, { keyPath: "key" });
        records.createIndex("namespace", "namespace", { unique: false });
      }
      if (!database.objectStoreNames.contains(BLOB_STORE)) {
        const blobs = database.createObjectStore(BLOB_STORE, { keyPath: "key" });
        blobs.createIndex("namespace", "namespace", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export function createRepository(namespace, options = {}) {
  if (!namespace || typeof namespace !== "string") throw new TypeError("A storage namespace is required.");
  const storeName = options.blobs ? BLOB_STORE : RECORD_STORE;
  const makeKey = (id) => `${namespace}:${id}`;

  return {
    async get(id) {
      const record = await requestStore(storeName, "readonly", (store) => store.get(makeKey(id)));
      return record?.value ?? null;
    },
    async list() {
      const database = await openToolDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).index("namespace").getAll(namespace);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result.map((record) => record.value));
      });
    },
    async put(id, value) {
      await requestStore(storeName, "readwrite", (store) => store.put({
        key: makeKey(id),
        namespace,
        value,
        updatedAt: new Date().toISOString(),
      }));
      return value;
    },
    async delete(id) {
      await requestStore(storeName, "readwrite", (store) => store.delete(makeKey(id)));
    },
    async clear() {
      const database = await openToolDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const request = transaction.objectStore(storeName).index("namespace").openKeyCursor(namespace);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          transaction.objectStore(storeName).delete(cursor.primaryKey);
          cursor.continue();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    },
  };
}

async function requestStore(storeName, mode, operation) {
  const database = await openToolDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? new Error("Storage operation was cancelled."));
  });
}
