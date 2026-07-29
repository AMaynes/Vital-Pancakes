/**
 * Pure metadata, duplicate, folder, preview, trash, and manifest policies for
 * File Drop. File bytes are stored separately in IndexedDB.
 */

export const FILE_DROP_FORMAT = "vital-pancakes-file-drop";
export const FILE_DROP_VERSION = 1;

const ACTIVE_EXTENSIONS = new Set(["html", "htm", "svg", "xhtml", "js", "mjs", "cjs"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "csv", "tsv", "log", "css", "xml", "yaml", "yml"]);

export function createFileDropState() {
  return {
    format: FILE_DROP_FORMAT,
    version: FILE_DROP_VERSION,
    folders: [{ id: "folder-root", name: "All files", parentId: null, system: true }],
    collections: [],
    files: [],
  };
}

export function validateFileDropState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("File Drop metadata must be an object.");
  }
  if (value.format !== FILE_DROP_FORMAT) throw new TypeError("This is not a File Drop manifest.");
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > FILE_DROP_VERSION) {
    throw new TypeError(`Unsupported File Drop manifest version: ${value.version}.`);
  }
  ["folders", "collections", "files"].forEach((key) => {
    if (!Array.isArray(value[key])) throw new TypeError(`${key} must be an array.`);
  });
  const folderIds = new Set(value.folders.map((folder) => folder.id));
  if (!folderIds.has("folder-root")) throw new TypeError("The root folder is missing.");
  const fileIds = new Set();
  value.files.forEach((file) => {
    if (!file?.id || typeof file.id !== "string") throw new TypeError("Every file needs an id.");
    if (fileIds.has(file.id)) throw new TypeError(`Duplicate file id: ${file.id}.`);
    fileIds.add(file.id);
    if (!safeStoredFilename(file.name)) throw new TypeError(`Unsafe filename: ${file.name}.`);
    if (file.folderId && !folderIds.has(file.folderId)) throw new TypeError(`Unknown folder: ${file.folderId}.`);
    if (!Number.isFinite(file.size) || file.size < 0) throw new TypeError(`Invalid file size for ${file.name}.`);
  });
  assertFolderTree(value.folders);
  return migrateFileDropState(value);
}

export function migrateFileDropState(value) {
  return {
    ...structuredCloneSafe(value),
    format: FILE_DROP_FORMAT,
    version: FILE_DROP_VERSION,
    collections: value.collections ?? [],
    files: value.files.map((file) => ({
      tags: [],
      description: "",
      favorite: false,
      trashedAt: null,
      status: "ready",
      ...file,
    })),
  };
}

export function safeStoredFilename(name) {
  const value = String(name ?? "").normalize("NFKC").trim();
  if (!value || value === "." || value === ".." || value.length > 220) return "";
  if (/[\u0000-\u001f\u007f/\\:*?"<>|]/.test(value)) return "";
  return value;
}

export function renamePreservingExtension(currentName, requestedName) {
  const current = safeStoredFilename(currentName);
  const requested = safeStoredFilename(requestedName);
  if (!requested) throw new TypeError("Enter a safe filename without path characters.");
  const currentExtension = extension(current);
  const requestedExtension = extension(requested);
  if (!currentExtension || requestedExtension) return requested;
  return `${requested}.${currentExtension}`;
}

export function findDuplicate(files, candidate) {
  if (!candidate?.fingerprint || !Number.isFinite(candidate.size)) return null;
  return files.find((file) => (
    !file.trashedAt
    && file.status === "ready"
    && file.size === candidate.size
    && file.fingerprint === candidate.fingerprint
  )) ?? null;
}

export function getPreviewKind(file) {
  const mime = String(file?.type ?? "").toLowerCase();
  const ext = extension(file?.name);
  if (ACTIVE_EXTENSIONS.has(ext) || mime.includes("html") || mime.includes("javascript") || mime === "image/svg+xml") {
    return "blocked";
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) {
    if (mime.includes("json") || ext === "json") return "json";
    if (ext === "md" || ext === "markdown") return "markdown";
    return "text";
  }
  return "unsupported";
}

export function moveFolder(folders, folderId, parentId) {
  if (folderId === "folder-root") throw new TypeError("The root folder cannot be moved.");
  if (folderId === parentId) throw new TypeError("A folder cannot contain itself.");
  const byId = new Map(folders.map((folder) => [folder.id, structuredCloneSafe(folder)]));
  if (!byId.has(folderId) || !byId.has(parentId)) throw new TypeError("Folder not found.");
  let cursor = parentId;
  while (cursor) {
    if (cursor === folderId) throw new TypeError("Moving this folder would create a cycle.");
    cursor = byId.get(cursor)?.parentId;
  }
  byId.get(folderId).parentId = parentId;
  return [...byId.values()];
}

export function removeFolder(state, folderId) {
  if (folderId === "folder-root") throw new TypeError("The root folder cannot be removed.");
  if (!state.folders.some((folder) => folder.id === folderId)) throw new TypeError("Folder not found.");
  const descendantIds = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    state.folders.forEach((folder) => {
      if (descendantIds.has(folder.parentId) && !descendantIds.has(folder.id)) {
        descendantIds.add(folder.id);
        changed = true;
      }
    });
  }
  return {
    ...structuredCloneSafe(state),
    folders: state.folders.filter((folder) => !descendantIds.has(folder.id)),
    files: state.files.map((file) => descendantIds.has(file.folderId)
      ? { ...file, folderId: "folder-root" }
      : { ...file }),
  };
}

export function trashFile(file, now = new Date()) {
  return { ...file, trashedAt: now.toISOString() };
}

export function recoverFile(file) {
  return { ...file, trashedAt: null };
}

export function buildManifest(state) {
  const valid = validateFileDropState(state);
  return {
    ...structuredCloneSafe(valid),
    exportedAt: new Date().toISOString(),
    files: valid.files.map(({ id, name, type, size, addedAt, modifiedAt, tags, description, folderId, collectionIds, favorite, trashedAt, fingerprint, fingerprintAlgorithm }) => ({
      id, name, type, size, addedAt, modifiedAt, tags, description, folderId,
      collectionIds, favorite, trashedAt, fingerprint, fingerprintAlgorithm,
    })),
  };
}

function assertFolderTree(folders) {
  const byId = new Map();
  folders.forEach((folder) => {
    if (!folder?.id || typeof folder.id !== "string") throw new TypeError("Every folder needs an id.");
    if (byId.has(folder.id)) throw new TypeError(`Duplicate folder id: ${folder.id}.`);
    if (!safeStoredFilename(folder.name)) throw new TypeError(`Unsafe folder name: ${folder.name}.`);
    byId.set(folder.id, folder);
  });
  folders.forEach((folder) => {
    if (folder.parentId !== null && !byId.has(folder.parentId)) {
      throw new TypeError(`Unknown parent folder: ${folder.parentId}.`);
    }
    const visited = new Set([folder.id]);
    let cursor = folder.parentId;
    while (cursor) {
      if (visited.has(cursor)) throw new TypeError("Folder tree contains a cycle.");
      visited.add(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
  });
}

function extension(name) {
  const match = /\.([^.]+)$/.exec(String(name ?? "").toLowerCase());
  return match?.[1] ?? "";
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
