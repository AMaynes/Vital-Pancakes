/**
 * Builds the shared text index from existing Vital Pancakes browser storage.
 */

import {
  listGlossaryEntries,
  replaceKnowledgeIndex,
} from "./knowledge-db.mjs";
import {
  buildAutomaticKnowledgeLinks,
  collectIndexableText,
  extractRecordReferences,
  normalizeKnowledgeDocument,
} from "./knowledge-model.mjs?v=2";

const WORKSPACE_KEY = "artificially-neuroscience-workspace-v1";
const LOCAL_TOOLS_DATABASE = "vital-pancakes-local-tools";
const MASTER_LESSON_DATABASE = "vital-pancakes-master-lessons";
let activeSync = null;
let scheduledSync = null;

export function scheduleKnowledgeSync(options = {}) {
  if (scheduledSync) return;
  const run = () => {
    scheduledSync = null;
    syncKnowledgeIndex(options).catch((error) => {
      console.warn("Vital Pancakes knowledge indexing was not completed.", error);
    });
  };
  scheduledSync = globalThis.requestIdleCallback
    ? requestIdleCallback(run, { timeout: 4_000 })
    : setTimeout(run, 750);
}

export function syncKnowledgeIndex(options = {}) {
  if (activeSync) return activeSync;
  activeSync = performSync(options).finally(() => {
    activeSync = null;
  });
  return activeSync;
}

async function performSync(options) {
  const warnings = [];
  const documents = [];
  documents.push(...readWorkspaceDocuments(options.localStorageRef));
  documents.push(...readOtherLocalStorageDocuments(options.localStorageRef));
  try {
    documents.push(...await readLocalToolDocuments(options));
  } catch (error) {
    warnings.push(`Local tools: ${error.message}`);
  }
  try {
    documents.push(...await readMasterLessonDocuments(options.indexedDBRef));
  } catch (error) {
    warnings.push(`Master Lesson Builder: ${error.message}`);
  }
  const glossary = await listGlossaryEntries();
  const normalized = deduplicateDocuments(documents);
  const links = buildAutomaticKnowledgeLinks(normalized, glossary);
  return replaceKnowledgeIndex(normalized, links, { warnings });
}

export function readWorkspaceDocuments(storage = globalThis.localStorage) {
  const workspace = parseStorageJson(storage, WORKSPACE_KEY);
  if (!Array.isArray(workspace?.sections)) return [];
  return workspace.sections.flatMap((section) => (
    (Array.isArray(section.items) ? section.items : []).map((item, index) => createDocument({
      id: `workspace:${section.id}:${item.id ?? index}`,
      title: item.title ?? item.name ?? `${section.title} entry ${index + 1}`,
      value: item,
      kind: section.type ?? section.id ?? "entry",
      source: "workspace",
      recordId: item.id ?? "",
      tags: item.tags,
      url: `workspace.html#section=${encodeURIComponent(section.id)}&item=${encodeURIComponent(item.id ?? "")}`,
      updatedAt: item.updatedAt ?? workspace.updatedAt,
    }))
  ));
}

export function readOtherLocalStorageDocuments(storage = globalThis.localStorage) {
  if (!storage) return [];
  const documents = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || key === WORKSPACE_KEY || /(?:settings|history|view|cache|last-|session)/i.test(key)) continue;
    const value = parseStorageJson(storage, key);
    if (!value || typeof value !== "object") continue;
    if (key === "pinakes-vitae-literature-analyzer-v1") {
      Object.entries(value.sources ?? {}).forEach(([sourceId, source]) => {
        documents.push(createDocument({
          id: `literature-annotations:${sourceId}`,
          title: source.name ?? "Literature annotations",
          value: { annotations: source.annotations },
          kind: "highlight",
          source: "literature-analyzer",
          recordId: sourceId,
          url: "tools/literature-analyzer.html",
          updatedAt: source.updatedAt,
        }));
      });
      continue;
    }
    if (/visual-board/i.test(key)) {
      documents.push(...readVisualBoardDocuments(value, key));
      continue;
    }
    documents.push(...documentsFromStoredValue(value, {
      idPrefix: `local-storage:${key}`,
      source: key,
      kind: kindForStorageKey(key),
      url: routeForStorageKey(key),
    }));
  }
  return documents;
}

function readVisualBoardDocuments(value, storageKey) {
  const source = String(storageKey);
  const url = "tools/visual-board.html";
  if (Array.isArray(value?.items)) {
    return value.items.map((item, index) => createDocument({
      id: `local-storage:${source}:library:${item?.id ?? index}`,
      title: item?.name ?? item?.character?.name ?? `Board library item ${index + 1}`,
      value: {
        name: item?.name,
        characterName: item?.character?.name,
        text: collectVisualBoardText(item?.character?.objects),
      },
      kind: "board asset",
      source,
      recordId: item?.id ?? "",
      url,
      updatedAt: item?.updatedAt ?? item?.createdAt,
    }));
  }

  return [createDocument({
    id: `local-storage:${source}:board`,
    title: "Visual Board",
    value: {
      text: collectVisualBoardText(value?.objects),
      assetNames: Object.values(value?.assets ?? {}).map((asset) => asset?.name).filter(Boolean),
      animationFrames: (value?.animation?.frames ?? []).map((frame) => frame?.name).filter(Boolean),
    },
    kind: "board",
    source,
    recordId: "board",
    url,
    updatedAt: value?.updatedAt,
  })];
}

function collectVisualBoardText(objects) {
  if (!Array.isArray(objects)) return [];
  return objects.flatMap((object) => [
    object?.text,
    object?.name,
    object?.label,
    object?.semantic?.label,
    object?.semantic?.role,
    ...(Array.isArray(object?.semantic?.tags) ? object.semantic.tags : []),
  ]).filter((entry) => typeof entry === "string" && entry.trim());
}

async function readLocalToolDocuments(options) {
  const indexedDBRef = options.indexedDBRef ?? globalThis.indexedDB;
  if (!await databaseExists(indexedDBRef, LOCAL_TOOLS_DATABASE)) return [];
  const records = await readDatabaseStore(indexedDBRef, LOCAL_TOOLS_DATABASE, "records");
  const documents = [];

  records.forEach((wrapper) => {
    const namespace = String(wrapper?.namespace ?? "");
    const value = wrapper?.value;
    if (!namespace || value === undefined) return;
    // Retain legacy records for backup compatibility without linking to removed tools.
    if (["file-drop", "inference", "inference-sessions"].includes(namespace)) return;
    if (namespace === "overhead") {
      const safeValue = value && typeof value === "object"
        ? { ...value, privateSections: [] }
        : value;
      documents.push(...documentsFromStoredValue(safeValue, {
        idPrefix: `local-tools:${namespace}:${wrapper.key}`,
        source: namespace,
        kind: "overhead",
        url: "tools/overhead.html",
      }));
      return;
    }
    documents.push(...documentsFromStoredValue(value, {
      idPrefix: `local-tools:${namespace}:${wrapper.key}`,
      source: namespace,
      kind: kindForNamespace(namespace),
      url: routeForNamespace(namespace),
    }));
  });

  return documents;
}

async function readMasterLessonDocuments(indexedDBRef = globalThis.indexedDB) {
  if (!await databaseExists(indexedDBRef, MASTER_LESSON_DATABASE)) return [];
  const [books, lessons] = await Promise.all([
    readDatabaseStore(indexedDBRef, MASTER_LESSON_DATABASE, "books"),
    readDatabaseStore(indexedDBRef, MASTER_LESSON_DATABASE, "lessons"),
  ]);
  const documents = books.map((wrapper) => createDocument({
    id: `master-lesson-book:${wrapper.value?.id ?? wrapper.key}`,
    title: wrapper.value?.title ?? "Textbook",
    value: {
      title: wrapper.value?.title,
      outline: wrapper.value?.outline,
      summaries: wrapper.value?.summaries,
    },
    kind: "lesson source",
    source: "master-lesson-builder",
    recordId: wrapper.value?.id ?? wrapper.key,
    url: "tools/master-lesson-builder.html",
    updatedAt: wrapper.value?.updatedAt,
  }));
  lessons.forEach((wrapper) => {
    documents.push(createDocument({
      id: `master-lesson:${wrapper.key}`,
      title: wrapper.value?.title ?? "Generated lesson",
      value: wrapper.value,
      kind: "lesson",
      source: "master-lesson-builder",
      recordId: wrapper.key,
      tags: [
        wrapper.value?.sourceTitle,
        wrapper.value?.chapter,
        wrapper.value?.subchapter,
      ],
      url: "tools/master-lesson-builder.html",
      updatedAt: wrapper.value?.updatedAt,
    }));
  });
  return documents;
}

function documentsFromStoredValue(value, context, path = "root", depth = 0) {
  if (depth > 5 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => (
      documentsFromStoredValue(entry, context, `${path}:${index}`, depth + 1)
    ));
  }
  if (typeof value !== "object" || value instanceof Blob) return [];
  const documents = [];
  const candidateTitle = value.title ?? value.name ?? value.question ?? value.term ?? value.fileName;
  if (candidateTitle || (depth === 0 && collectIndexableText(value).trim())) {
    documents.push(createDocument({
      id: `${context.idPrefix}:${value.id ?? hashText(path)}`,
      title: candidateTitle ?? humanize(context.kind),
      value,
      kind: value.kind ?? value.type ?? context.kind,
      source: context.source,
      recordId: value.id ?? "",
      tags: value.tags,
      url: context.url,
      updatedAt: value.updatedAt ?? value.modifiedAt ?? value.createdAt,
    }));
  }
  Object.entries(value).forEach(([key, child]) => {
    if (!Array.isArray(child) || /private/i.test(key)) return;
    documents.push(...documentsFromStoredValue(
      child,
      context,
      `${path}:${key}`,
      depth + 1,
    ));
  });
  return documents;
}

function createDocument({ id, title, value, kind, source, recordId, tags, url, updatedAt }) {
  return normalizeKnowledgeDocument({
    id,
    title: String(title ?? "Untitled entry"),
    text: collectIndexableText(value),
    kind: String(kind ?? "entry"),
    source: String(source ?? "unknown"),
    recordId: String(recordId ?? ""),
    tags: Array.isArray(tags) ? tags : [],
    references: extractRecordReferences(value),
    url,
    updatedAt,
  });
}

async function databaseExists(indexedDBRef, name) {
  if (!indexedDBRef?.open) return false;
  if (typeof indexedDBRef.databases !== "function") return true;
  return (await indexedDBRef.databases()).some((database) => database.name === name);
}

function readDatabaseStore(indexedDBRef, databaseName, storeName) {
  return withDatabase(indexedDBRef, databaseName, (database) => {
    if (!database.objectStoreNames.contains(storeName)) return [];
    return requestResult(database.transaction(storeName, "readonly").objectStore(storeName).getAll());
  });
}

function withDatabase(indexedDBRef, name, operation) {
  return new Promise((resolve, reject) => {
    const request = indexedDBRef.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      try {
        resolve(await operation(request.result));
      } catch (error) {
        reject(error);
      } finally {
        request.result.close();
      }
    };
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function parseStorageJson(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function deduplicateDocuments(documents) {
  const byId = new Map();
  documents.forEach((document) => {
    const normalized = normalizeKnowledgeDocument(document);
    const existing = byId.get(normalized.id);
    if (!existing || normalized.text.length > existing.text.length) byId.set(normalized.id, normalized);
  });
  return [...byId.values()];
}

function kindForStorageKey(key) {
  if (/literature/i.test(key)) return "literature";
  if (/visual-board/i.test(key)) return "board";
  if (/travel/i.test(key)) return "plan";
  if (/architecture/i.test(key)) return "project";
  return "entry";
}

function routeForStorageKey(key) {
  if (/literature-curation/i.test(key)) return "tools/literature-curator.html";
  if (/visual-board/i.test(key)) return "tools/visual-board.html";
  if (/travel/i.test(key)) return "tools/travel-planner.html";
  if (/architecture/i.test(key)) return "tools/architecture.html";
  return "workspace.html";
}

function kindForNamespace(namespace) {
  if (/markdown/i.test(namespace)) return "document";
  if (/tool-designer/i.test(namespace)) return "project";
  if (/graphing/i.test(namespace)) return "project";
  return "entry";
}

function routeForNamespace(namespace) {
  if (/markdown/i.test(namespace)) return "tools/markdown-studio.html";
  if (/tool-designer/i.test(namespace)) return "tools/tool-designer.html";
  if (/graphing/i.test(namespace)) return "tools/graphing.html";
  if (/overhead/i.test(namespace)) return "tools/overhead.html";
  return "workspace.html";
}

function hashText(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function humanize(value) {
  return String(value ?? "Entry").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
