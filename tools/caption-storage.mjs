/**
 * Caption Relay IndexedDB persistence. Raw audio and video are intentionally
 * absent from every store and project validator.
 */

import { validateCaptionPackage } from "./caption-package.mjs";

export const CAPTION_RELAY_DATABASE = "vital-pancakes-caption-relay";
export const CAPTION_RELAY_DATABASE_VERSION = 1;
export const CAPTION_RELAY_STORES = Object.freeze([
  "projects",
  "checkpoints",
  "syncIndexes",
  "glossaries",
  "settings",
]);

const PROJECT_STATUSES = new Set([
  "draft", "capturing", "interrupted", "transcribing", "ready", "translated",
]);
const RAW_MEDIA_DATA_URI = /^data:(?:audio|video)\//i;
const RAW_MEDIA_ENCODING = /^(?:audio|video|media)\/base64$/i;
const RAW_MEDIA_CONTAINER_KEYS = new Set(["audio", "video", "media"]);
const RAW_MEDIA_PAYLOAD_KEYS = new Set([
  "base64", "blob", "buffer", "byte", "bytes", "bytearray", "chunk", "chunks",
  "data", "frame", "frames", "payload", "pcm", "sample", "samples", "stream",
]);
const RAW_MEDIA_PAYLOAD_SUFFIX = /(?:base64|blob|buffers?|bytes?|bytearray|chunks?|data|frames?|payload|samples?|streams?)$/;
const RAW_WAVEFORM_OR_SAMPLE_KEY = /(?:waveform(?:arrays?|buffers?|chunks?|data|frames?|points?|samples?|values?)?|samples?(?:arrays?|buffers?|chunks?|data|frames?|values?)?)$/;
const MEDIA_METADATA_SUFFIX = /(?:metadata|codec|format|type|version|language|samplerate|channels|duration)$/;

export function openCaptionRelayDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CAPTION_RELAY_DATABASE, CAPTION_RELAY_DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Caption Relay storage is blocked by another open tab."));
    request.onupgradeneeded = () => {
      const database = request.result;
      CAPTION_RELAY_STORES.forEach((storeName) => {
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: "id" });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export function validateProjectRecord(project) {
  if (!isPlainObject(project)) throw new TypeError("Project must be an object.");
  if (typeof project.id !== "string" || !/^[a-zA-Z0-9_-]{6,100}$/.test(project.id)) {
    throw new TypeError("Project ID is invalid.");
  }
  if (typeof project.name !== "string" || !project.name.trim() || project.name.length > 500) {
    throw new TypeError("Project name is invalid.");
  }
  if (!PROJECT_STATUSES.has(project.status)) throw new TypeError("Project status is invalid.");
  if (!Number.isFinite(Date.parse(project.createdAt)) || !Number.isFinite(Date.parse(project.updatedAt))) {
    throw new TypeError("Project dates are invalid.");
  }
  if (project.package) validateCaptionPackage(project.package);
  rejectRawMedia(project);
  return clone(project);
}

export function recoverInterruptedProject(project, recoveredAt = new Date().toISOString()) {
  const record = validateProjectRecord(project);
  if (["capturing", "transcribing"].includes(record.status)) {
    record.status = "interrupted";
    record.interruptedAt = recoveredAt;
    record.recoveryMessage = "Capture was interrupted. Saved captions and synchronization data are recoverable; unprocessed audio was discarded.";
    record.updatedAt = recoveredAt;
  }
  return record;
}

export async function listCaptionProjects() {
  const records = await getAll("projects");
  return records
    .map(validateProjectRecord)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getCaptionProject(id) {
  const value = await getRecord("projects", id);
  return value ? validateProjectRecord(value) : null;
}

export async function saveCaptionProject(project) {
  const record = validateProjectRecord(project);
  await putRecord("projects", record);
  return record;
}

export async function deleteCaptionProject(id) {
  const database = await openCaptionRelayDatabase();
  await Promise.all(CAPTION_RELAY_STORES.slice(0, 3).map((storeName) => transactionPromise(
    database,
    storeName,
    "readwrite",
    (store) => store.delete(storeName === "projects" ? id : `${id}:${storeName}`),
  )));
}

export async function duplicateCaptionProject(project, {
  id = createProjectId(),
  now = new Date().toISOString(),
} = {}) {
  const source = validateProjectRecord(project);
  const copy = {
    ...clone(source),
    id,
    name: `${source.name} copy`,
    createdAt: now,
    updatedAt: now,
    status: source.status === "capturing" ? "interrupted" : source.status,
  };
  await saveCaptionProject(copy);
  return copy;
}

export async function renameCaptionProject(project, name) {
  const updated = {
    ...validateProjectRecord(project),
    name: String(name ?? "").trim(),
    updatedAt: new Date().toISOString(),
  };
  return saveCaptionProject(updated);
}

export function saveCaptureCheckpoint(projectId, checkpoint) {
  assertPersistableValue(checkpoint, "Capture checkpoint", 1_000_000);
  return putRecord("checkpoints", {
    id: `${projectId}:checkpoints`,
    projectId,
    updatedAt: new Date().toISOString(),
    ...clone(checkpoint),
  });
}

export function getCaptureCheckpoint(projectId) {
  return getRecord("checkpoints", `${projectId}:checkpoints`);
}

export function saveSynchronizationIndex(projectId, index) {
  assertPersistableValue(index, "Synchronization index", 20_000_000);
  return putRecord("syncIndexes", {
    id: `${projectId}:syncIndexes`,
    projectId,
    updatedAt: new Date().toISOString(),
    value: clone(index),
  });
}

export function getSynchronizationIndex(projectId) {
  return getRecord("syncIndexes", `${projectId}:syncIndexes`);
}

export function saveCaptionRelaySettings(settings) {
  assertPersistableValue(settings, "Caption Relay settings", 128_000);
  return putRecord("settings", { id: "caption-relay-settings", value: clone(settings) });
}

export async function getCaptionRelaySettings() {
  return (await getRecord("settings", "caption-relay-settings"))?.value ?? null;
}

export async function estimateCaptionStorage() {
  const estimate = await navigator.storage?.estimate?.();
  return {
    usage: Number(estimate?.usage ?? 0),
    quota: Number(estimate?.quota ?? 0),
  };
}

export async function clearDownloadedCaptionModels() {
  if (!globalThis.caches) return { removed: 0, supported: false };
  const modelFragments = [
    "whisper-tiny.en",
    "whisper-small.en",
    "opus-mt-en-vi",
    "@huggingface/transformers",
  ];
  let removed = 0;
  for (const cacheName of await caches.keys()) {
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      if (modelFragments.some((fragment) => request.url.includes(fragment))) {
        if (await cache.delete(request)) removed += 1;
      }
    }
  }
  return { removed, supported: true };
}

export function createProjectId() {
  if (globalThis.crypto?.randomUUID) return `caption_${crypto.randomUUID().replaceAll("-", "")}`;
  return `caption_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getRecord(storeName, id) {
  const database = await openCaptionRelayDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).get(id);
    request.onerror = () => reject(normalizeStorageError(request.error));
    request.onsuccess = () => resolve(request.result ?? null);
  });
}

async function getAll(storeName) {
  const database = await openCaptionRelayDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onerror = () => reject(normalizeStorageError(request.error));
    request.onsuccess = () => resolve(request.result);
  });
}

async function putRecord(storeName, value) {
  const database = await openCaptionRelayDatabase();
  return transactionPromise(database, storeName, "readwrite", (store) => store.put(value));
}

function transactionPromise(database, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(normalizeStorageError(transaction.error));
    transaction.onabort = () => reject(normalizeStorageError(transaction.error));
  });
}

function normalizeStorageError(error) {
  if (error?.name === "QuotaExceededError") {
    return new Error("Caption Relay storage quota was exceeded. Export the project and free browser storage.");
  }
  return error ?? new Error("Caption Relay storage operation failed.");
}

function rejectRawMedia(value, depth = 0, ancestors = []) {
  if (typeof value === "string") {
    if (RAW_MEDIA_DATA_URI.test(value.trim()) || RAW_MEDIA_ENCODING.test(value.trim())) {
      throw new TypeError("Caption Relay storage cannot retain raw movie audio or video.");
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (depth > 8) throw new TypeError("Caption Relay storage value nesting is too deep.");
  if (value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
    || (typeof Blob !== "undefined" && value instanceof Blob)) {
    throw new TypeError("Caption Relay storage cannot retain raw movie media.");
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = normalizeDataKey(key);
    if (isForbiddenRawMediaKey(normalizedKey, ancestors)) {
      throw new TypeError("Caption Relay storage cannot retain raw movie audio or video.");
    }
    rejectRawMedia(child, depth + 1, [...ancestors, normalizedKey]);
  }
}

function isForbiddenRawMediaKey(key, ancestors) {
  if (RAW_WAVEFORM_OR_SAMPLE_KEY.test(key)) return true;
  if (/^(?:raw)?(?:audio|video)(?:base64|blob|buffers?|bytes?|bytearray|chunks?|data|frames?|pcm|payload|samples?|streams?)?$/.test(key)) {
    return true;
  }
  if (/^(?:raw)?pcm(?:audio|buffers?|bytes?|chunks?|data|frames?|samples?)?$/.test(key)) {
    return true;
  }
  if (/^(?:media)(?:base64|blob|buffers?|bytes?|bytearray|chunks?|data|frames?|payload|samples?|streams?)$/.test(key)
    || /^(?:base64|blob|buffers?|bytes?|bytearray|chunks?|data|frames?|payload|samples?|streams?)(?:audio|video|media)$/.test(key)) {
    return true;
  }
  if (!MEDIA_METADATA_SUFFIX.test(key)
    && /(?:audio|video|media)/.test(key)
    && RAW_MEDIA_PAYLOAD_SUFFIX.test(key)) {
    return true;
  }
  if (!MEDIA_METADATA_SUFFIX.test(key)
    && /pcm/.test(key)
    && (RAW_MEDIA_PAYLOAD_SUFFIX.test(key)
      || /^(?:raw|captured|movie|recorded|source)?pcm$/.test(key))) {
    return true;
  }
  return RAW_MEDIA_PAYLOAD_KEYS.has(key)
    && ancestors.some(isRawMediaContainerKey);
}

function isRawMediaContainerKey(key) {
  return RAW_MEDIA_CONTAINER_KEYS.has(key)
    || /^(?:raw|captured|movie|recorded|source)+(?:audio|video|media)$/.test(key);
}

function normalizeDataKey(key) {
  return String(key).toLocaleLowerCase("en").replace(/[^a-z0-9]/g, "");
}

function assertPersistableValue(value, label, maximumBytes) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object.`);
  rejectRawMedia(value);
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} must be JSON-serializable.`);
  }
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new RangeError(`${label} exceeds its local storage size limit.`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
