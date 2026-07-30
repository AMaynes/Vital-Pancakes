/**
 * Unified browser-storage capture and restore for Vital Pancakes.
 */

import {
  encryptVaultEntries,
  readVaultEntries,
} from "./vault-archive.mjs";
import {
  decodeStructuredValue,
  encodeStructuredValue,
  parseEncodedStructuredValue,
} from "./vault-codec.mjs";

export const VAULT_MANIFEST_FORMAT = "vital-pancakes-vault-manifest";
export const VAULT_MANIFEST_VERSION = 1;

const KNOWN_DATABASES = [
  "vital-pancakes-local-tools",
  "vital-pancakes-master-lessons",
  "vital-pancakes-caption-relay",
  "vital-pancakes-knowledge",
];
const REGENERABLE_DATABASE = /(?:webllm|mlc[-_/ ]?cache|tvmjs|transformers-cache)/i;

export async function inspectLocalVaultContents(options = {}) {
  const databaseSchemas = await inspectDatabaseSchemas(options.indexedDBRef);
  const opfsFiles = await inspectOpfsFiles(options.storageRef, options.signal);
  const localStorageEntries = collectLocalStorage(options.localStorageRef);
  return {
    localStorageEntries: localStorageEntries.length,
    databases: databaseSchemas.length,
    objectStores: databaseSchemas.reduce((sum, database) => sum + database.stores.length, 0),
    databaseRecords: databaseSchemas.reduce(
      (sum, database) => sum + database.stores.reduce((count, store) => count + store.count, 0),
      0,
    ),
    files: opfsFiles.length,
    fileBytes: opfsFiles.reduce((sum, file) => sum + file.size, 0),
    excludedDatabases: databaseSchemas.excludedDatabases ?? [],
  };
}

export async function exportUnifiedVault(password, options = {}) {
  const indexedDBRef = options.indexedDBRef ?? globalThis.indexedDB;
  const localStorageRef = options.localStorageRef ?? globalThis.localStorage;
  const storageRef = options.storageRef ?? globalThis.navigator?.storage;
  const databaseSchemas = await inspectDatabaseSchemas(indexedDBRef);
  const opfsFiles = await inspectOpfsFiles(storageRef, options.signal);
  const manifest = buildManifest({
    localStorageEntries: collectLocalStorage(localStorageRef),
    databases: databaseSchemas,
    opfsFiles,
    excludedDatabases: databaseSchemas.excludedDatabases ?? [],
  });

  return encryptVaultEntries(
    createVaultEntryStream({
      manifest,
      databaseSchemas,
      opfsFiles,
      indexedDBRef,
      storageRef,
      signal: options.signal,
      onProgress: options.onProgress,
    }),
    password,
    {
      signal: options.signal,
      onProgress: options.onProgress,
      iterations: options.iterations,
      chunkSize: options.chunkSize,
      cryptoRef: options.cryptoRef,
    },
  );
}

export async function inspectUnifiedVault(file, password, options = {}) {
  let manifest = null;
  const jsonParts = new Map();
  const summary = await readVaultEntries(file, password, {
    signal: options.signal,
    cryptoRef: options.cryptoRef,
    onProgress: options.onProgress,
    async onChunk(chunk) {
      if (!["manifest", "database-record"].includes(chunk.kind)) return;
      const parts = jsonParts.get(chunk.id) ?? [];
      parts.push(chunk.data);
      jsonParts.set(chunk.id, parts);
      if (!chunk.final) return;
      const value = parseJsonBlob(new Blob(parts));
      jsonParts.delete(chunk.id);
      if (chunk.kind === "manifest") {
        if (manifest) throw new TypeError("The vault contains more than one manifest.");
        manifest = validateVaultManifest(await value);
        return;
      }
      const record = await value;
      validateDatabaseRecord(record, manifest);
    },
  });
  if (!manifest) throw new TypeError("The vault manifest is missing.");
  return {
    ...summary,
    manifest,
    localStorageEntries: manifest.localStorage.length,
    databases: manifest.databases.length,
    databaseRecords: manifest.databases.reduce(
      (sum, database) => sum + database.stores.reduce((count, store) => count + store.count, 0),
      0,
    ),
    files: manifest.opfsFiles.length,
    fileBytes: manifest.opfsFiles.reduce((sum, file) => sum + file.size, 0),
  };
}

export async function restoreUnifiedVault(file, password, options = {}) {
  const mode = normalizeRestoreMode(options.mode);
  const indexedDBRef = options.indexedDBRef ?? globalThis.indexedDB;
  const localStorageRef = options.localStorageRef ?? globalThis.localStorage;
  const storageRef = options.storageRef ?? globalThis.navigator?.storage;

  const inspection = await inspectUnifiedVault(file, password, {
    signal: options.signal,
    cryptoRef: options.cryptoRef,
    onProgress: (progress) => options.onProgress?.({ ...progress, phase: "verify" }),
  });
  throwIfCancelled(options.signal);
  const databaseHandles = await prepareDatabases(
    inspection.manifest.databases,
    indexedDBRef,
    mode,
  );
  const attachments = new Map();
  const attachmentParts = new Map();
  const jsonParts = new Map();
  const fileWriters = new Map();
  let restoredRecords = 0;
  let restoredFiles = 0;

  try {
    const opfsRoot = inspection.manifest.opfsFiles.length
      ? await storageRef?.getDirectory?.()
      : null;
    if (inspection.manifest.opfsFiles.length && !opfsRoot) {
      throw new Error("This browser cannot restore the vault's OPFS files.");
    }

    await readVaultEntries(file, password, {
      signal: options.signal,
      cryptoRef: options.cryptoRef,
      onProgress: (progress) => options.onProgress?.({
        ...progress,
        phase: "restore",
        restoredRecords,
        restoredFiles,
      }),
      async onChunk(chunk) {
        throwIfCancelled(options.signal);
        if (chunk.kind === "attachment") {
          const parts = attachmentParts.get(chunk.id) ?? [];
          parts.push(chunk.data);
          attachmentParts.set(chunk.id, parts);
          if (chunk.final) {
            attachments.set(
              chunk.id,
              new Blob(parts, { type: String(chunk.metadata?.mimeType ?? "") }),
            );
            attachmentParts.delete(chunk.id);
          }
          return;
        }
        if (chunk.kind === "opfs-file") {
          const path = String(chunk.metadata?.path ?? "");
          if (!isSafeOpfsPath(path)) throw new TypeError(`Unsafe vault file path: ${path}.`);
          let writer = fileWriters.get(chunk.id);
          if (!writer) {
            const handle = await getOpfsFileHandle(opfsRoot, path, true);
            writer = await handle.createWritable();
            fileWriters.set(chunk.id, writer);
          }
          await writer.write(chunk.data);
          if (chunk.final) {
            await writer.close();
            fileWriters.delete(chunk.id);
            restoredFiles += 1;
          }
          return;
        }
        if (!["manifest", "database-record"].includes(chunk.kind)) return;
        const parts = jsonParts.get(chunk.id) ?? [];
        parts.push(chunk.data);
        jsonParts.set(chunk.id, parts);
        if (!chunk.final) return;
        const value = await parseJsonBlob(new Blob(parts));
        jsonParts.delete(chunk.id);
        if (chunk.kind === "manifest") return;
        const record = validateDatabaseRecord(value, inspection.manifest);
        const decoded = await decodeStructuredValue(
          parseEncodedStructuredValue(record.encoded),
          attachments,
        );
        await putDatabaseRecord(
          databaseHandles.get(record.database),
          record.store,
          decoded.key,
          decoded.value,
        );
        attachments.clear();
        restoredRecords += 1;
      },
    });

    restoreLocalStorage(inspection.manifest.localStorage, localStorageRef, mode);
    return {
      mode,
      restoredRecords,
      restoredFiles,
      restoredLocalStorageEntries: inspection.manifest.localStorage.length,
      databases: inspection.manifest.databases.length,
    };
  } finally {
    await Promise.all([...fileWriters.values()].map((writer) => writer.abort?.().catch?.(() => {})));
    databaseHandles.forEach((database) => database.close());
  }
}

export function validateVaultManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("The vault manifest is invalid.");
  }
  if (value.format !== VAULT_MANIFEST_FORMAT || value.version !== VAULT_MANIFEST_VERSION) {
    throw new TypeError(`Unsupported vault manifest version: ${value.version ?? "unknown"}.`);
  }
  if (!Array.isArray(value.localStorage) || !Array.isArray(value.databases) || !Array.isArray(value.opfsFiles)) {
    throw new TypeError("The vault manifest is incomplete.");
  }
  const localKeys = new Set();
  value.localStorage.forEach((entry) => {
    if (
      !entry
      || typeof entry.key !== "string"
      || typeof entry.value !== "string"
      || localKeys.has(entry.key)
    ) throw new TypeError("The vault contains invalid local settings.");
    localKeys.add(entry.key);
  });
  const databaseNames = new Set();
  value.databases.forEach((database) => {
    if (
      !database
      || !isSafeDatabaseName(database.name)
      || databaseNames.has(database.name)
      || !Number.isInteger(database.version)
      || database.version < 1
      || !Array.isArray(database.stores)
    ) throw new TypeError("The vault contains an invalid database schema.");
    databaseNames.add(database.name);
    const storeNames = new Set();
    database.stores.forEach((store) => {
      if (
        !store
        || !isSafeStoreName(store.name)
        || storeNames.has(store.name)
        || !Number.isSafeInteger(store.count)
        || store.count < 0
        || !Array.isArray(store.indexes)
      ) throw new TypeError("The vault contains an invalid object-store schema.");
      storeNames.add(store.name);
      store.indexes.forEach(validateIndexSchema);
    });
  });
  const paths = new Set();
  value.opfsFiles.forEach((file) => {
    if (
      !file
      || !isSafeOpfsPath(file.path)
      || paths.has(file.path)
      || !Number.isSafeInteger(file.size)
      || file.size < 0
    ) throw new TypeError("The vault contains an invalid file manifest.");
    paths.add(file.path);
  });
  return structuredClone(value);
}

export function normalizeRestoreMode(value) {
  const mode = value ?? "merge";
  if (!["merge", "replace"].includes(mode)) {
    throw new TypeError("Vault restore mode must be merge or replace.");
  }
  return mode;
}

export function isSafeOpfsPath(value) {
  const path = String(value ?? "");
  if (!path || path.length > 2048 || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((segment) => (
    segment
    && segment !== "."
    && segment !== ".."
    && !/[\u0000-\u001f\u007f]/.test(segment)
  ));
}

async function* createVaultEntryStream(context) {
  yield {
    kind: "manifest",
    id: "manifest",
    data: JSON.stringify(context.manifest),
  };
  let recordIndex = 0;
  for (const database of context.databaseSchemas) {
    const handle = await openExistingDatabase(context.indexedDBRef, database.name);
    try {
      for (const storeSchema of database.stores) {
        const recordKeys = await readStoreKeys(handle, storeSchema.name, context.signal);
        for (const key of recordKeys) {
          throwIfCancelled(context.signal);
          const record = {
            key,
            value: await readStoreValue(handle, storeSchema.name, key, context.signal),
          };
          const recordId = `database:${recordIndex}`;
          const { encoded, attachments } = encodeStructuredValue(record, {
            createAttachmentId: (attachmentIndex) => `${recordId}:attachment:${attachmentIndex}`,
          });
          for (const attachment of attachments) {
            yield {
              kind: "attachment",
              id: attachment.id,
              metadata: {
                attachmentType: attachment.type,
                mimeType: attachment.mimeType ?? "",
              },
              data: attachment.blob,
            };
          }
          yield {
            kind: "database-record",
            id: recordId,
            metadata: { database: database.name, store: storeSchema.name },
            data: JSON.stringify({
              database: database.name,
              store: storeSchema.name,
              encoded,
            }),
          };
          recordIndex += 1;
          context.onProgress?.({
            phase: "capture",
            current: `${database.name}/${storeSchema.name}`,
            recordCount: recordIndex,
          });
        }
      }
    } finally {
      handle.close();
    }
  }

  for (let index = 0; index < context.opfsFiles.length; index += 1) {
    const fileInfo = context.opfsFiles[index];
    const root = await context.storageRef.getDirectory();
    const handle = await getOpfsFileHandle(root, fileInfo.path, false);
    const file = await handle.getFile();
    yield {
      kind: "opfs-file",
      id: `opfs:${index}`,
      metadata: {
        path: fileInfo.path,
        type: file.type,
        lastModified: file.lastModified,
      },
      data: file,
    };
  }
}

function buildManifest({ localStorageEntries, databases, opfsFiles, excludedDatabases }) {
  return {
    format: VAULT_MANIFEST_FORMAT,
    version: VAULT_MANIFEST_VERSION,
    exportedAt: new Date().toISOString(),
    origin: globalThis.location?.origin ?? null,
    localStorage: localStorageEntries,
    databases: databases.map((database) => ({
      name: database.name,
      version: database.version,
      stores: database.stores,
    })),
    opfsFiles: opfsFiles.map(({ path, size, type, lastModified }) => ({
      path,
      size,
      type,
      lastModified,
    })),
    excluded: {
      databases: excludedDatabases,
      cacheStorage: true,
      sessionStorage: true,
      reason: "Regenerable runtime/model caches and temporary session state are not user records.",
    },
  };
}

async function inspectDatabaseSchemas(indexedDBRef = globalThis.indexedDB) {
  if (!indexedDBRef?.open) return Object.assign([], { excludedDatabases: [] });
  const listed = typeof indexedDBRef.databases === "function"
    ? await indexedDBRef.databases()
    : KNOWN_DATABASES.map((name) => ({ name }));
  const names = [...new Set(listed.map((entry) => entry?.name).filter(Boolean))];
  const excludedDatabases = names.filter((name) => REGENERABLE_DATABASE.test(name));
  const databases = [];
  for (const name of names.filter((candidate) => !REGENERABLE_DATABASE.test(candidate))) {
    const database = await openExistingDatabase(indexedDBRef, name);
    try {
      const stores = [];
      for (const storeName of database.objectStoreNames) {
        const transaction = database.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        stores.push({
          name: store.name,
          keyPath: cloneKeyPath(store.keyPath),
          autoIncrement: store.autoIncrement,
          count: await requestResult(store.count()),
          indexes: [...store.indexNames].map((indexName) => {
            const index = store.index(indexName);
            return {
              name: index.name,
              keyPath: cloneKeyPath(index.keyPath),
              unique: index.unique,
              multiEntry: index.multiEntry,
            };
          }),
        });
      }
      databases.push({ name, version: database.version, stores });
    } finally {
      database.close();
    }
  }
  return Object.assign(databases, { excludedDatabases });
}

async function inspectOpfsFiles(storageRef = globalThis.navigator?.storage, signal) {
  if (!storageRef?.getDirectory) return [];
  const root = await storageRef.getDirectory();
  const files = [];
  await walkDirectory(root, "", files, signal);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function walkDirectory(directory, prefix, output, signal) {
  for await (const [name, handle] of directory.entries()) {
    throwIfCancelled(signal);
    const path = prefix ? `${prefix}/${name}` : name;
    if (!isSafeOpfsPath(path)) continue;
    if (handle.kind === "directory") {
      await walkDirectory(handle, path, output, signal);
      continue;
    }
    const file = await handle.getFile();
    output.push({
      path,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    });
  }
}

function collectLocalStorage(storage = globalThis.localStorage) {
  if (!storage) return [];
  const entries = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) continue;
    entries.push({ key, value: storage.getItem(key) ?? "" });
  }
  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

function restoreLocalStorage(entries, storage, mode) {
  if (!storage) {
    if (entries.length) throw new Error("Local storage is unavailable in this browser.");
    return;
  }
  if (mode === "replace") storage.clear();
  entries.forEach(({ key, value }) => storage.setItem(key, value));
}

async function prepareDatabases(schemas, indexedDBRef, mode) {
  if (!indexedDBRef?.open) {
    if (schemas.length) throw new Error("IndexedDB is unavailable in this browser.");
    return new Map();
  }
  const currentVersions = new Map(
    typeof indexedDBRef.databases === "function"
      ? (await indexedDBRef.databases()).map(({ name, version }) => [name, version])
      : [],
  );
  const handles = new Map();
  for (const schema of schemas) {
    const currentVersion = Number(currentVersions.get(schema.name)) || 0;
    const desiredVersion = Math.max(schema.version, currentVersion || 1);
    let database = await openDatabaseWithSchema(indexedDBRef, schema, desiredVersion);
    const missingStore = schema.stores.some((store) => !database.objectStoreNames.contains(store.name));
    const missingIndex = !missingStore && schema.stores.some((storeSchema) => {
      const transaction = database.transaction(storeSchema.name, "readonly");
      const store = transaction.objectStore(storeSchema.name);
      return storeSchema.indexes.some((index) => !store.indexNames.contains(index.name));
    });
    if (missingStore || missingIndex) {
      database.close();
      database = await openDatabaseWithSchema(
        indexedDBRef,
        schema,
        Math.max(desiredVersion + 1, currentVersion + 1),
      );
    }
    validatePreparedDatabase(database, schema);
    if (mode === "replace") {
      await clearDatabaseStores(database, schema.stores.map((store) => store.name));
    }
    handles.set(schema.name, database);
  }
  return handles;
}

function openDatabaseWithSchema(indexedDBRef, schema, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDBRef.open(schema.name, version);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(
      `Close other Vital Pancakes tabs so ${schema.name} can be restored.`,
    ));
    request.onupgradeneeded = () => {
      const database = request.result;
      schema.stores.forEach((storeSchema) => {
        const store = database.objectStoreNames.contains(storeSchema.name)
          ? request.transaction.objectStore(storeSchema.name)
          : database.createObjectStore(storeSchema.name, {
            keyPath: storeSchema.keyPath,
            autoIncrement: storeSchema.autoIncrement,
          });
        storeSchema.indexes.forEach((indexSchema) => {
          if (store.indexNames.contains(indexSchema.name)) return;
          store.createIndex(indexSchema.name, indexSchema.keyPath, {
            unique: indexSchema.unique,
            multiEntry: indexSchema.multiEntry,
          });
        });
      });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function openExistingDatabase(indexedDBRef, name) {
  return new Promise((resolve, reject) => {
    const request = indexedDBRef.open(name);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Close other tabs using ${name} and try again.`));
    request.onsuccess = () => resolve(request.result);
  });
}

function validatePreparedDatabase(database, schema) {
  schema.stores.forEach((storeSchema) => {
    if (!database.objectStoreNames.contains(storeSchema.name)) {
      throw new Error(`Could not create the ${storeSchema.name} store in ${schema.name}.`);
    }
    const store = database.transaction(storeSchema.name, "readonly").objectStore(storeSchema.name);
    if (
      JSON.stringify(cloneKeyPath(store.keyPath)) !== JSON.stringify(storeSchema.keyPath)
      || store.autoIncrement !== storeSchema.autoIncrement
    ) {
      throw new Error(
        `The existing ${schema.name}/${storeSchema.name} schema is incompatible with this vault.`,
      );
    }
  });
}

async function clearDatabaseStores(database, storeNames) {
  if (!storeNames.length) return;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(storeNames, "readwrite");
    storeNames.forEach((name) => transaction.objectStore(name).clear());
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Database clear was cancelled."));
  });
}

function readStoreKeys(database, storeName, signal) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAllKeys();
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(
      signal?.aborted
        ? new DOMException("Vault operation cancelled.", "AbortError")
        : transaction.error,
    );
    if (signal?.aborted) transaction.abort();
  });
}

function readStoreValue(database, storeName, key, signal) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(
      signal?.aborted
        ? new DOMException("Vault operation cancelled.", "AbortError")
        : transaction.error,
    );
    if (signal?.aborted) transaction.abort();
  });
}

function putDatabaseRecord(database, storeName, key, value) {
  if (!database?.objectStoreNames.contains(storeName)) {
    throw new Error(`The restored database store is unavailable: ${storeName}.`);
  }
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    if (store.keyPath === null) store.put(value, key);
    else store.put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Database restore was cancelled."));
  });
}

function validateDatabaseRecord(value, manifest) {
  if (!manifest) throw new TypeError("The vault manifest must appear before database records.");
  if (
    !value
    || typeof value !== "object"
    || typeof value.database !== "string"
    || typeof value.store !== "string"
    || !value.encoded
  ) throw new TypeError("The vault contains an invalid database record.");
  const database = manifest.databases.find((candidate) => candidate.name === value.database);
  if (!database?.stores.some((store) => store.name === value.store)) {
    throw new TypeError("The vault record refers to an undeclared database store.");
  }
  parseEncodedStructuredValue(value.encoded);
  return value;
}

async function getOpfsFileHandle(root, path, create) {
  const segments = path.split("/");
  const filename = segments.pop();
  let directory = root;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return directory.getFileHandle(filename, { create });
}

function validateIndexSchema(index) {
  if (
    !index
    || !isSafeStoreName(index.name)
    || !isValidKeyPath(index.keyPath)
    || typeof index.unique !== "boolean"
    || typeof index.multiEntry !== "boolean"
  ) throw new TypeError("The vault contains an invalid database index.");
}

function cloneKeyPath(value) {
  return Array.isArray(value) ? [...value] : value;
}

function isValidKeyPath(value) {
  return value === null
    || typeof value === "string"
    || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function isSafeDatabaseName(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 300
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeStoreName(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 300
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function parseJsonBlob(blob) {
  try {
    return JSON.parse(await blob.text());
  } catch {
    throw new TypeError("The vault contains invalid JSON data.");
  }
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw new DOMException("Vault operation cancelled.", "AbortError");
}
