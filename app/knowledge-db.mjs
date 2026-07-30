/**
 * Shared browser-local knowledge index, relationship, and glossary storage.
 */

import {
  deduplicateLinks,
  normalizeGlossaryEntry,
  normalizeKnowledgeDocument,
  normalizeKnowledgeLink,
} from "./knowledge-model.mjs";

const DATABASE_NAME = "vital-pancakes-knowledge";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const LINK_STORE = "links";
const GLOSSARY_STORE = "glossary";
const META_STORE = "meta";

export function openKnowledgeDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Vital Pancakes tabs to update the knowledge database."));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        const documents = database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
        documents.createIndex("kind", "kind", { unique: false });
        documents.createIndex("source", "source", { unique: false });
        documents.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(LINK_STORE)) {
        const links = database.createObjectStore(LINK_STORE, { keyPath: "id" });
        links.createIndex("sourceId", "sourceId", { unique: false });
        links.createIndex("targetId", "targetId", { unique: false });
        links.createIndex("origin", "origin", { unique: false });
        links.createIndex("status", "status", { unique: false });
      }
      if (!database.objectStoreNames.contains(GLOSSARY_STORE)) {
        const glossary = database.createObjectStore(GLOSSARY_STORE, { keyPath: "id" });
        glossary.createIndex("term", "term", { unique: false });
        glossary.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function getKnowledgeState() {
  const [documents, links, glossary, meta] = await Promise.all([
    listStore(DOCUMENT_STORE),
    listStore(LINK_STORE),
    listStore(GLOSSARY_STORE),
    getStoreValue(META_STORE, "index"),
  ]);
  return {
    documents,
    links,
    glossary,
    lastIndexedAt: meta?.value?.lastIndexedAt ?? null,
    indexWarnings: meta?.value?.warnings ?? [],
  };
}

export async function replaceKnowledgeIndex(documents, automaticLinks, metadata = {}) {
  const normalizedDocuments = documents.map(normalizeKnowledgeDocument);
  const normalizedAutomatic = deduplicateLinks(
    automaticLinks.map(normalizeKnowledgeLink).filter((link) => (
      link.origin === "reference" || link.origin === "record"
    )),
  );
  const existingLinks = await listKnowledgeLinks();
  const documentIds = new Set(normalizedDocuments.map((document) => document.id));
  const preservedLinks = existingLinks.filter((link) => (
    !["reference", "record"].includes(link.origin)
    && (documentIds.has(link.sourceId) || link.sourceId.startsWith("glossary:"))
    && (documentIds.has(link.targetId) || link.targetId.startsWith("glossary:"))
  ));
  const database = await openKnowledgeDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        [DOCUMENT_STORE, LINK_STORE, META_STORE],
        "readwrite",
      );
      const documentStore = transaction.objectStore(DOCUMENT_STORE);
      const linkStore = transaction.objectStore(LINK_STORE);
      documentStore.clear();
      linkStore.clear();
      normalizedDocuments.forEach((document) => documentStore.put(document));
      deduplicateLinks([...preservedLinks, ...normalizedAutomatic]).forEach((link) => linkStore.put(link));
      transaction.objectStore(META_STORE).put({
        key: "index",
        value: {
          lastIndexedAt: new Date().toISOString(),
          warnings: Array.isArray(metadata.warnings) ? metadata.warnings.slice(0, 100) : [],
          documentCount: normalizedDocuments.length,
        },
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Knowledge indexing was cancelled."));
    });
  } finally {
    database.close();
  }
  dispatchKnowledgeChanged();
  return { documents: normalizedDocuments.length, links: normalizedAutomatic.length };
}

export function listKnowledgeDocuments() {
  return listStore(DOCUMENT_STORE);
}

export function listKnowledgeLinks() {
  return listStore(LINK_STORE);
}

export function listGlossaryEntries() {
  return listStore(GLOSSARY_STORE).then((entries) => entries.sort((left, right) => (
    left.term.localeCompare(right.term)
  )));
}

export async function saveGlossaryEntry(value) {
  const now = new Date().toISOString();
  const entry = normalizeGlossaryEntry({
    ...value,
    createdAt: value.createdAt ?? now,
    updatedAt: now,
  });
  const entries = await listGlossaryEntries();
  const terms = new Set([entry.term, ...entry.aliases].map(normalizeTerm));
  const collision = entries.find((candidate) => (
    candidate.id !== entry.id
    && [candidate.term, ...candidate.aliases].some((term) => terms.has(normalizeTerm(term)))
  ));
  if (collision) {
    throw new TypeError(`“${entry.term}” conflicts with glossary entry “${collision.term}”.`);
  }
  await putStoreValue(GLOSSARY_STORE, entry);
  dispatchKnowledgeChanged();
  return entry;
}

export async function deleteGlossaryEntry(id) {
  await deleteStoreValue(GLOSSARY_STORE, String(id));
  const links = await listKnowledgeLinks();
  const target = `glossary:${id}`;
  await Promise.all(
    links.filter((link) => link.sourceId === target || link.targetId === target)
      .map((link) => deleteStoreValue(LINK_STORE, link.id)),
  );
  dispatchKnowledgeChanged();
}

export async function saveKnowledgeLink(value) {
  const now = new Date().toISOString();
  const link = normalizeKnowledgeLink({
    ...value,
    createdAt: value.createdAt ?? now,
    updatedAt: now,
  });
  await putStoreValue(LINK_STORE, link);
  dispatchKnowledgeChanged();
  return link;
}

export async function setKnowledgeLinkStatus(id, status) {
  const link = await getStoreValue(LINK_STORE, String(id));
  if (!link) throw new TypeError("Knowledge relationship not found.");
  return saveKnowledgeLink({ ...link, status });
}

export async function deleteKnowledgeLink(id) {
  await deleteStoreValue(LINK_STORE, String(id));
  dispatchKnowledgeChanged();
}

async function listStore(storeName) {
  const database = await openKnowledgeDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function getStoreValue(storeName, key) {
  const database = await openKnowledgeDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function putStoreValue(storeName, value) {
  const database = await openKnowledgeDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(value);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Knowledge storage was cancelled."));
    });
  } finally {
    database.close();
  }
}

async function deleteStoreValue(storeName, key) {
  const database = await openKnowledgeDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function normalizeTerm(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function dispatchKnowledgeChanged() {
  globalThis.dispatchEvent?.(new CustomEvent("knowledge:changed"));
}
