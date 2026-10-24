/**
 * Durable browser cache for database.json and assets. Writes are serialized and
 * compare the stored revision inside one IndexedDB transaction. A stale tab
 * fails visibly rather than overwriting another tab. Device handles and sync
 * receipts are kept separately from the portable personal database.
 */
import { createDatabase, validateDatabase, clone, newId } from "./database-model.mjs";

const NAME = "vital-pancakes-database";
let connection;
let snapshot;
let initialization;
let writeQueue = Promise.resolve();
let pendingWrites = 0;
const channel = typeof window !== "undefined" && globalThis.BroadcastChannel ? new BroadcastChannel("vp-database") : null;

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("state");
      request.result.createObjectStore("assets");
      request.result.createObjectStore("device");
    };
    request.onsuccess = () => { connection = request.result; connection.onversionchange = () => connection.close(); resolve(connection); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close the other VP tab to finish opening your database."));
  });
}

export function initializeDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return initialization ??= (async () => {
    await open();
    const existing = await read("state", "database");
    if (existing) { snapshot = validateDatabase(existing); await migrateLegacyMedia(); return getDatabase(); }
    const glossary = await readLegacyValues("glossary"); const recovery = {};
    for (const key of ["artificially-neuroscience-workspace-v1", "flashcard_wrong_queue", "flashcard_pending_reviews", "flashcard_quiz_daily_stats"]) {
      try { const value = localStorage.getItem(key); if (value) recovery[key] = value; } catch { /* Browser-local recovery is optional when storage is blocked. */ }
    }
    // Recheck inside the write transaction: two first-time tabs must adopt the
    // same identity, even if both previously observed an empty store.
    await new Promise((resolve, reject) => {
      const tx = connection.transaction(["state", "device"], "readwrite"); const state = tx.objectStore("state"); const current = state.get("database");
      current.onsuccess = () => {
        if (current.result) { snapshot = validateDatabase(current.result); return; }
        snapshot = createDatabase();
        for (const entry of glossary) {
          const id = `glossary:${entry.id}`;
          snapshot.entries[id] = { id, parentId: "glossary", type: "glossary", title: entry.term, content: [], storage: "inherit", data: entry };
        }
        snapshot.migrations.glossary = true;
        state.put(validateDatabase(snapshot), "database"); tx.objectStore("device").put(recovery, "migration-recovery");
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("Database initialization cancelled."));
    });
    await migrateLegacyMedia();
    return getDatabase();
  })();
}

export function databaseReady() { return Boolean(snapshot); }
export function getDatabase() {
  if (!snapshot) throw new Error("The personal database has not finished opening.");
  return clone(snapshot);
}

/** Commits a validated snapshot. Optimistic callers receive explicit failures. */
export function saveDatabase(value, options = {}) {
  const next = validateDatabase(value);
  const expectedRevision = options.expectedRevision ?? next.revision;
  if (expectedRevision !== snapshot.revision) return Promise.reject(new Error("The database changed. Refresh and retry this edit."));
  const previous = snapshot;
  next.revision = expectedRevision + 1;
  snapshot = next;
  pendingWrites++;
  const job = writeQueue.then(() => new Promise((resolve, reject) => {
    const transaction = connection.transaction(["state", "assets"], "readwrite");
    const state = transaction.objectStore("state");
    const current = state.get("database");
    let conflict = false;
    current.onsuccess = () => {
      if (current.result?.datasetId !== previous.datasetId || current.result?.revision !== expectedRevision) { conflict = true; transaction.abort(); return; }
      state.put(next, "database");
      for (const [id, blob] of Object.entries(options.blobs ?? {})) transaction.objectStore("assets").put(blob, next.assets[id].sha256);
    };
    transaction.oncomplete = () => { publishChange(next.revision); resolve(clone(next)); };
    transaction.onabort = () => reject(conflict ? new Error("Another tab changed your database. Reload before editing again.") : transaction.error ?? new Error("The save was cancelled."));
    transaction.onerror = () => reject(transaction.error);
  }));
  writeQueue = job.catch(async error => {
    snapshot = await read("state", "database");
    window.dispatchEvent(new CustomEvent("database:error", { detail: error.message }));
    publishChange(snapshot.revision);
  }).finally(() => { pendingWrites--; });
  return job;
}

export async function flushDatabase() { await writeQueue; }
export async function getAsset(id) {
  await initializeDatabase(); const asset = snapshot.assets[id];
  return asset ? (await read("assets", asset.sha256) ?? await read("assets", id)) : null;
}
export async function getDeviceValue(key) { await initializeDatabase(); return read("device", key); }
export async function setDeviceValue(key, value) { await initializeDatabase(); return write("device", key, value); }

/** First connection binds this browser library, atomically across tabs. Signing
 * out does not remove this guard or move existing personal data to another user. */
export async function bindDriveAccount(account) {
  if (!account?.id) throw new Error("Google did not identify the Drive account.");
  await initializeDatabase();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction("device", "readwrite"); const store = tx.objectStore("device");
    const request = store.get("drive-account"); let mismatch = false;
    request.onsuccess = () => {
      if (request.result && request.result.id !== account.id) { mismatch = true; tx.abort(); return; }
      store.put({ id: account.id, email: account.email ?? "" }, "drive-account");
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error(mismatch ? "This browser library belongs to a different Google account. Use its original account, or a separate browser profile for another person. Nothing was uploaded." : "Could not save the Drive account binding."));
  });
}

export async function addAsset(file) {
  if (!(file instanceof Blob) || file.size > 50 * 1024 * 1024) throw new TypeError("Choose an attachment smaller than 50 MB.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const db = getDatabase();
  const existing = Object.values(db.assets).find(asset => asset.sha256 === hash);
  if (existing && await getAsset(existing.id)) return existing;
  const extension = (file.name?.match(/\.([a-zA-Z0-9]{1,12})$/)?.[1] ?? "bin").toLowerCase();
  const id = existing?.id ?? newId("asset");
  const asset = { id, path: `assets/${hash}.${extension}`, name: file.name ?? "Attachment", mime: file.type || "application/octet-stream", size: file.size, sha256: hash };
  db.assets[id] = asset;
  await saveDatabase(db, { blobs: { [id]: file } });
  return asset;
}

export async function replaceImportedDatabase(value, blobs = {}) {
  const next = validateDatabase(value);
  next.migrations ??= {};
  next.migrations.knowledgeLinks = true;
  await flushDatabase();
  await setDeviceValue(`recovery:${Date.now()}`, getDatabase());
  // Explicit import may replace identity. Never reuse the previous Drive base.
  next.revision = snapshot.revision + 1;
  await new Promise((resolve, reject) => {
    const tx = connection.transaction(["state", "assets", "device"], "readwrite");
    const current = tx.objectStore("state").get("database");
    let stale = false;
    current.onsuccess = () => {
      if (current.result.revision !== snapshot.revision) { stale = true; tx.abort(); return; }
      tx.objectStore("state").put(next, "database");
      for (const [id, blob] of Object.entries(blobs)) tx.objectStore("assets").put(blob, next.assets[id].sha256);
      tx.objectStore("device").delete("drive-base"); tx.objectStore("device").delete("drive-receipt");
    };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(new Error(stale ? "Another tab changed the database. Retry the import." : "Import cancelled."));
  });
  snapshot = next; publishChange(next.revision); return getDatabase();
}

export async function listRecoveryCopies() {
  await initializeDatabase();
  const keys = await new Promise((resolve, reject) => { const request = connection.transaction("device").objectStore("device").getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  return keys.filter(key => typeof key === "string" && key.startsWith("recovery:")).sort().reverse();
}
export async function restoreRecoveryCopy(key) {
  if (!key.startsWith("recovery:")) throw new TypeError("Choose a recovery copy.");
  const db = await getDeviceValue(key); if (!db) throw new Error("That recovery copy is unavailable.");
  await replaceImportedDatabase(db);
}

function publishChange(revision) {
  channel?.postMessage(revision);
  window.dispatchEvent(new CustomEvent("database:changed", { detail: { revision } }));
}
if (channel) channel.onmessage = async () => {
  if (!initialization) return;
  await initialization;
  if (pendingWrites) return;
  snapshot = validateDatabase(await read("state", "database"));
  window.dispatchEvent(new CustomEvent("database:changed", { detail: { revision: snapshot.revision } }));
};

function read(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = connection.transaction(storeName).objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error);
  });
}
function write(storeName, key, value) {
  return new Promise((resolve, reject) => {
    const tx = connection.transaction(storeName, "readwrite"); tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("Storage write cancelled."));
  });
}
async function migrateLegacyMedia() {
  if (snapshot.migrations.media) return;
  const records = await readLegacyValues("media");
  const db = getDatabase(); const blobs = {};
  for (const record of records) {
    if (!(record.blob instanceof Blob) || db.assets[record.id]) continue;
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await record.blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const extension = (record.name?.match(/\.([a-zA-Z0-9]{1,12})$/)?.[1] ?? "bin").toLowerCase();
    db.assets[record.id] = { id: record.id, path: `assets/${hash}.${extension}`, name: record.name ?? "Local media", mime: record.mimeType || record.blob.type || "application/octet-stream", size: record.blob.size, sha256: hash };
    blobs[record.id] = record.blob;
  }
  db.migrations.media = true;
  try { await saveDatabase(db, { blobs }); }
  catch (error) {
    const current = await read("state", "database");
    if (!current?.migrations.media) throw error;
    snapshot = validateDatabase(current);
  }
}

function readLegacyValues(storeName) {
  return new Promise(resolve => {
    const request = indexedDB.open("vital-pancakes-knowledge");
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
      const read = db.transaction(storeName).objectStore(storeName).getAll();
      read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => { db.close(); resolve([]); };
    };
  });
}
