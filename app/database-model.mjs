/**
 * Versioned personal content model shared by browser, folder packages and Drive.
 * Logical directories are records; binary files live in assets/. No credentials
 * or device permissions belong in this portable document.
 */
export const DATABASE_FORMAT = "vital-pancakes-database";
export const DATABASE_VERSION = 1;
export const STORAGE_POLICIES = ["inherit", "local", "cloud", "both"];
export const ENTRY_TYPES = ["blog", "text", "image", "document", "notecard", "deck", "glossary", "graph", "interactable"];
export const BLOCK_TYPES = ["markdown", "equation", "image", "document", "link", "notecard", "glossary", "interactable", "diagram"];
export const clone = (value) => structuredClone(value);
export const newId = (prefix = "entry") => `${prefix}-${globalThis.crypto.randomUUID()}`;
export function sameRecord(left, right) {
  const stable = value => value && typeof value === "object" ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])])) : value;
  return JSON.stringify(stable(left ?? null)) === JSON.stringify(stable(right ?? null));
}

export function createDatabase(id = newId("database")) {
  const folders = {};
  const add = (id, parentId, title, role = null) => {
    folders[id] = { id, parentId, title, storage: parentId ? "inherit" : "local", ...(role ? { role } : {}) };
  };
  add("sharedvp", null, "SharedVP", "shared");
  add("everyday", null, "Everyday Life");
  add("research", null, "Research & Literature");
  add("studies-projects", null, "Studies & Projects");
  add("library", null, "Library");
  add("cooking", "everyday", "Cooking");
  add("gym", "everyday", "Gym");
  add("notecards", "studies-projects", "Notecards", "notecards");
  add("knowledge-graphs", "library", "Knowledge Graphs", "graphs");
  add("documents", "library", "Documents", "documents");
  add("glossary", "library", "Glossary", "glossary");
  return { format: DATABASE_FORMAT, schemaVersion: DATABASE_VERSION, datasetId: id, revision: 0,
    folders, entries: {}, assets: {}, links: {}, tombstones: {}, settings: { defaultStorage: "local" }, migrations: {} };
}

/** Validates imported JSON before any writes, including references and cycles. */
export function validateDatabase(value) {
  const has = (table, id) => Object.hasOwn(table, id);
  if (!value || value.format !== DATABASE_FORMAT || value.schemaVersion !== DATABASE_VERSION) {
    throw new TypeError("Choose a supported Vital Pancakes database.json (schema version 1).");
  }
  if (typeof value.datasetId !== "string" || !value.datasetId || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new TypeError("Invalid database identity or revision.");
  for (const field of ["settings", "migrations"]) if (value[field] != null && (typeof value[field] !== "object" || Array.isArray(value[field]))) throw new TypeError(`Invalid ${field}.`);
  for (const field of ["folders", "entries", "assets", "links", "tombstones"]) {
    if (!value[field] || typeof value[field] !== "object" || Array.isArray(value[field])) throw new TypeError(`Invalid ${field} table.`);
    for (const [id, record] of Object.entries(value[field])) {
      if (Object.hasOwn(Object.prototype, id) || id === "prototype" || !record || record.id !== id) throw new TypeError(`Invalid ${field} record: ${id}.`);
    }
  }
  if (value.settings?.defaultStorage && !["local", "cloud", "both"].includes(value.settings.defaultStorage)) throw new TypeError("Invalid default storage policy.");
  for (const deleted of Object.values(value.tombstones)) {
    if (!["entries", "folders"].includes(deleted.table) || !["local", "cloud", "both"].includes(deleted.storage) || typeof deleted.deletedAt !== "string") throw new TypeError("Invalid deleted record metadata.");
    if (value.entries[deleted.id] || value.folders[deleted.id]) throw new TypeError("A record cannot be both active and deleted.");
  }
  const ids = [...Object.keys(value.folders), ...Object.keys(value.entries), ...Object.keys(value.assets), ...Object.keys(value.links)];
  if (new Set(ids).size !== ids.length) throw new TypeError("Record IDs must be unique across tables.");
  for (const record of [...Object.values(value.folders), ...Object.values(value.entries)]) {
    if (typeof record.title !== "string" || !record.title.trim()) throw new TypeError("Every directory and entry needs a title.");
    if (!STORAGE_POLICIES.includes(record.storage ?? "inherit")) throw new TypeError("Invalid storage policy.");
    if (record.parentId !== null && !has(value.folders, record.parentId)) throw new TypeError(`Missing parent directory for ${record.id}.`);
    const visited = new Set([record.id]);
    let parent = record.parentId;
    while (parent) {
      if (visited.has(parent)) throw new TypeError("Directories cannot contain cycles.");
      visited.add(parent); parent = value.folders[parent].parentId;
    }
  }
  for (const entry of Object.values(value.entries)) {
    if (typeof entry.type !== "string" || !entry.type || !entry.parentId || !Array.isArray(entry.content)) throw new TypeError("Invalid entry type, directory or content.");
    for (const block of entry.content) {
      if (!block || !BLOCK_TYPES.includes(block.type)) throw new TypeError("Unsupported content block.");
      if (["image", "document"].includes(block.type) && !has(value.assets, block.assetId)) throw new TypeError("An attachment is missing from the asset table.");
      if (["notecard", "glossary"].includes(block.type) && !has(value.entries, block.entryId)) throw new TypeError("A referenced entry is missing.");
      if (block.url) safeUrl(block.url);
      if (["link", "interactable"].includes(block.type) && (typeof block.url !== "string" || !block.url.trim())) throw new TypeError("A link or interactable needs a URL.");
      if (["markdown", "equation", "diagram"].includes(block.type) && typeof block.text !== "string") throw new TypeError("Text blocks need text content.");
      if (block.type === "notecard" && value.entries[block.entryId]?.type !== "notecard") throw new TypeError("Notecard references must point to a notecard.");
      if (block.type === "glossary" && value.entries[block.entryId]?.type !== "glossary") throw new TypeError("Glossary references must point to a definition.");
    }
    if (!entry.data || typeof entry.data !== "object" || Array.isArray(entry.data)) throw new TypeError("Entry data must be an object.");
    if (entry.type === "notecard" && (typeof entry.data.front !== "string" || typeof entry.data.back !== "string")) throw new TypeError("Notecards need a front and a back.");
    if (["notecard", "glossary"].includes(entry.type)) {
      const expectedRole = entry.type === "notecard" ? "notecards" : "glossary";
      let folder = value.folders[entry.parentId]; let found = false;
      while (folder) { if (folder.role === expectedRole) { found = true; break; } folder = value.folders[folder.parentId]; }
      if (!found) throw new TypeError(`Keep ${entry.type === "notecard" ? "notecards in the Notecards library" : "definitions in the Glossary"}, then reference them from other entries.`);
    }
    if (entry.type === "notecard" && entry.data.review && (!Number.isSafeInteger(entry.data.review.count) || entry.data.review.count < 0)) throw new TypeError("Invalid notecard review count.");
    if (entry.type === "glossary" && (!entry.id.startsWith("glossary:") || typeof entry.data.definition !== "string" || !Array.isArray(entry.data.aliases))) throw new TypeError("Glossary entries need a glossary: ID, definition and aliases.");
    if (entry.type === "glossary" && (entry.data.aliases.some(alias => typeof alias !== "string") || (entry.data.id && entry.data.id !== entry.id.slice(9)))) throw new TypeError("Invalid glossary identity or aliases.");
    if (entry.type === "deck" && !Array.isArray(entry.data.cardIds)) throw new TypeError("Decks need a list of card IDs.");
    if (entry.type === "deck" && (entry.data?.cardIds ?? []).some(id => value.entries[id]?.type !== "notecard")) throw new TypeError("Decks must reference existing notecards.");
    if (entry.type === "graph" && (!Number.isInteger(entry.data.depth) || entry.data.depth < 0 || entry.data.depth > 6)) throw new TypeError("Saved graph depth must be between 0 and 6.");
    if (entry.type === "graph" && entry.data?.rootId && !has(value.folders, entry.data.rootId) && !has(value.entries, entry.data.rootId)) throw new TypeError("A saved graph root is missing.");
  }
  const terms = new Set();
  for (const entry of Object.values(value.entries).filter(entry => entry.type === "glossary")) {
    for (const term of new Set([entry.title, ...entry.data.aliases].map(term => String(term).trim().toLowerCase()))) {
      if (terms.has(term)) throw new TypeError(`Duplicate glossary term or alias: ${term}.`); terms.add(term);
    }
  }
  for (const asset of Object.values(value.assets)) {
    if (!/^assets\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(asset.path) || !Number.isSafeInteger(asset.size) || asset.size < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new TypeError("Invalid asset path, hash or size.");
  }
  for (const link of Object.values(value.links)) {
    if (![link.sourceId, link.targetId].every(id => has(value.folders, id) || has(value.entries, id))) throw new TypeError("A relationship endpoint is missing.");
  }
  const normalized = clone(value); normalized.settings ??= { defaultStorage: "local" }; normalized.migrations ??= {}; return normalized;
}

export function safeUrl(value) {
  const url = new URL(value, "https://vital-pancakes.invalid/");
  if (!["http:", "https:"].includes(url.protocol)) throw new TypeError("Links must use HTTP or HTTPS.");
  return value;
}

export function storagePolicy(db, id) {
  let record = db.entries[id] ?? db.folders[id];
  while (record) {
    if (record.storage && record.storage !== "inherit") return record.storage;
    record = db.folders[record.parentId];
  }
  return db.settings?.defaultStorage ?? "local";
}

export function migrateWorkspace(db, workspace) {
  const next = clone(db);
  const parents = { "how-to-cook": "cooking", recipes: "cooking", workouts: "gym", cleaning: "everyday" };
  for (const section of workspace.sections) {
    const folderId = `section:${section.id}`;
    next.folders[folderId] ??= { id: folderId, title: section.title, parentId: parents[section.id] ?? (section.area === "everyday" ? "everyday" : "studies-projects"), storage: "inherit", legacySection: { ...section, items: [] } };
    const folders = workspaceFolders(next, section, folderId);
    for (const item of section.items ?? []) {
      const id = `workspace:${section.id}:${item.id}`;
      next.entries[id] ??= { id, parentId: folders.get(normalizeWorkspacePath(item.folderPath)) ?? folderId, type: section.type, title: item.title, storage: "inherit", content: workspaceMediaBlocks(next, item), data: clone(item), createdAt: item.createdAt, updatedAt: item.updatedAt };
    }
  }
  next.migrations.workspace = { version: workspace.version, completedAt: new Date().toISOString() };
  return next;
}

export function workspaceProjection(db) {
  return { version: db.migrations.workspace?.version ?? 14, sections: Object.values(db.folders)
    .filter(folder => folder.legacySection).map(folder => ({ ...clone(folder.legacySection), items: Object.values(db.entries)
      .filter(entry => entry.id.startsWith(`workspace:${folder.legacySection.id}:`)).map(entry => clone(entry.data)) })) };
}

const normalizeWorkspacePath = value => String(value ?? "").replace(/\\/g, "/").split("/").map(part => part.trim()).filter(part => part && part !== "." && part !== "..").join(" / ");

/** Mirrors existing editor folders into the canonical hierarchy. */
function workspaceFolders(db, section, rootId) {
  const paths = new Set();
  for (const value of [...(section.folders ?? []), ...(section.items ?? []).map(item => item.folderPath)]) {
    const parts = normalizeWorkspacePath(value).split(" / ").filter(Boolean);
    parts.forEach((_, index) => paths.add(parts.slice(0, index + 1).join(" / ")));
  }
  const ids = new Map();
  for (const path of [...paths].sort((a, b) => a.split(" / ").length - b.split(" / ").length)) {
    const parts = path.split(" / ");
    const id = `workspace-folder:${section.id}:${encodeURIComponent(path)}`;
    db.folders[id] ??= { id, parentId: ids.get(parts.slice(0, -1).join(" / ")) ?? rootId, title: parts.at(-1), storage: "inherit", workspaceSectionId: section.id, workspacePath: path };
    delete db.tombstones[id];
    ids.set(path, id);
  }
  return ids;
}

/** Specialized editor media references must also travel with the package. */
function workspaceMediaBlocks(db, item) {
  const ids = new Set([...JSON.stringify(item).matchAll(/vp-media:([a-zA-Z0-9_-]+)/g)].map(match => match[1]));
  return [...ids].filter(id => db.assets[id]).map(id => ({ type: db.assets[id].mime.startsWith("image/") ? "image" : "document", assetId: id, source: "workspace-media" }));
}

export function replaceWorkspace(db, workspace) {
  const next = clone(db);
  const incoming = new Set(workspace.sections.flatMap(section => section.items.map(item => `workspace:${section.id}:${item.id}`)));
  for (const entry of Object.values(next.entries)) {
    if (entry.id.startsWith("workspace:") && !incoming.has(entry.id)) removeRecord(next, entry.id);
  }
  for (const section of workspace.sections) {
    const id = `section:${section.id}`;
    if (!next.folders[id]) next.folders[id] = { id, parentId: section.area === "everyday" ? "everyday" : "studies-projects", storage: "inherit", title: section.title };
    next.folders[id].legacySection = { ...clone(section), items: [] };
    next.folders[id].title = section.title;
    const folders = workspaceFolders(next, section, id);
    for (const item of section.items) {
      const entryId = `workspace:${section.id}:${item.id}`;
      next.entries[entryId] = { ...next.entries[entryId], id: entryId, parentId: folders.get(normalizeWorkspacePath(item.folderPath)) ?? id, type: section.type, title: item.title, content: [...(next.entries[entryId]?.content ?? []).filter(block => block.source !== "workspace-media"), ...workspaceMediaBlocks(next, item)], storage: next.entries[entryId]?.storage ?? "inherit", data: clone(item), updatedAt: item.updatedAt };
      delete next.tombstones[entryId];
    }
    for (const folder of Object.values(next.folders).filter(folder => folder.workspaceSectionId === section.id && !folders.has(folder.workspacePath)).sort((a, b) => b.workspacePath.split(" / ").length - a.workspacePath.split(" / ").length)) {
      if (!Object.values(next.folders).concat(Object.values(next.entries)).some(record => record.parentId === folder.id)) removeRecord(next, folder.id);
    }
  }
  next.migrations.workspace = { ...next.migrations.workspace, version: workspace.version };
  return next;
}

export function removeRecord(db, id) {
  const record = db.entries[id] ?? db.folders[id];
  if (!record) throw new TypeError("The record no longer exists.");
  if (db.folders[id] && Object.values(db.folders).concat(Object.values(db.entries)).some(item => item.parentId === id)) throw new TypeError("Move or remove the directory contents first.");
  if (Object.values(db.entries).some(entry => entry.id !== id && (entry.content.some(block => block.entryId === id) || entry.data?.cardIds?.includes(id) || entry.data?.rootId === id))) throw new TypeError("This entry is referenced elsewhere. Remove those references first.");
  db.tombstones[id] = { id, table: db.entries[id] ? "entries" : "folders", storage: storagePolicy(db, id), deletedAt: new Date().toISOString() };
  delete db.entries[id]; delete db.folders[id];
  for (const link of Object.values(db.links)) if (link.sourceId === id || link.targetId === id) delete db.links[link.id];
}

export function reviewNotecard(db, id, remembered, now = Date.now()) {
  if (db.entries[id]?.type !== "notecard" || typeof remembered !== "boolean") throw new TypeError("Choose a notecard and a valid review rating.");
  const card = db.entries[id]; const previous = card.data.review ?? { count: 0 };
  card.data.review = { ...previous, count: previous.count + 1, remembered, lastReviewedAt: new Date(now).toISOString(), dueAt: new Date(now + (remembered ? 86400000 * Math.min(30, 2 ** Math.min(previous.count, 5)) : 600000)).toISOString() };
  return card;
}

/** Imports authored cards once; paths yield stable IDs across devices. */
export function importNotecards(db, subject, source) {
  const next = clone(db);
  const visit = (node, path, parentId) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        if (typeof item.question === "string" && typeof item.answer === "string") {
          const id = `notecard:${subject}:${path}:${index}`;
          if (next.tombstones[id]) return;
          next.entries[id] ??= { id, parentId, type: "notecard", title: item.question, storage: "inherit", content: [], data: { ...clone(item), front: item.question, back: item.answer, review: { count: 0 } } };
        } else visit(item, `${path}/${index}`, parentId);
      }); return;
    }
    if (!node || typeof node !== "object") return;
    let folder = parentId;
    if (node.name && path) {
      folder = `cards-folder:${subject}:${path}`;
      next.folders[folder] ??= { id: folder, parentId, title: node.name, storage: "inherit" };
    }
    for (const [key, value] of Object.entries(node)) if (value && typeof value === "object") visit(value, `${path}/${key}`, folder);
  };
  const id = `cards-folder:${subject}`;
  next.folders[id] ??= { id, parentId: "notecards", title: subject, storage: "inherit" };
  visit(source, "", id);
  next.migrations[`notecards:${subject}`] = true;
  return next;
}

export function graphNeighborhood(db, rootId, depth = 2, limit = 120) {
  if (!Object.hasOwn(db.folders, rootId) && !Object.hasOwn(db.entries, rootId)) throw new TypeError("Choose an existing graph root.");
  if (!Number.isInteger(depth) || depth < 0 || depth > 6) throw new TypeError("Graph depth must be between 0 and 6.");
  const edges = [];
  for (const item of Object.values(db.folders).concat(Object.values(db.entries))) {
    if (item.parentId) edges.push({ sourceId: item.parentId, targetId: item.id, type: "contains" });
    for (const block of item.content ?? []) if (block.entryId) edges.push({ sourceId: item.id, targetId: block.entryId, type: block.type });
    for (const id of item.data?.cardIds ?? []) edges.push({ sourceId: item.id, targetId: id, type: "notecard" });
  }
  edges.push(...Object.values(db.links).filter(link => !link.status || link.status === "accepted"));
  const neighbors = new Map();
  for (const edge of edges) {
    for (const [from, to] of [[edge.sourceId, edge.targetId], [edge.targetId, edge.sourceId]]) {
      if (!neighbors.has(from)) neighbors.set(from, new Set()); neighbors.get(from).add(to);
    }
  }
  const levels = new Map([[rootId, 0]]); const queue = [rootId]; let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]; if (levels.get(current) >= depth) continue;
    for (const id of neighbors.get(current) ?? []) {
      if (levels.has(id)) continue;
      if (levels.size >= Math.max(1, Math.min(500, limit))) { truncated = true; continue; }
      levels.set(id, levels.get(current) + 1); queue.push(id);
    }
  }
  return { nodes: queue.map(id => ({ id, title: (db.folders[id] ?? db.entries[id]).title, level: levels.get(id), kind: db.folders[id] ? "directory" : db.entries[id].type })), edges: edges.filter(edge => levels.has(edge.sourceId) && levels.has(edge.targetId)), truncated };
}

/** Cloud exports retain structural ancestors, but strip their local metadata. */
export function cloudSubset(db) {
  const next = createDatabase(db.datasetId);
  next.folders = {}; next.revision = db.revision; next.settings = {}; next.migrations = {};
  if (db.migrations.workspace) next.migrations.workspace = { version: db.migrations.workspace.version };
  for (const entry of Object.values(db.entries)) if (["cloud", "both"].includes(storagePolicy(db, entry.id))) next.entries[entry.id] = clone(entry);
  const selected = new Set(Object.values(db.folders).filter(folder => ["cloud", "both"].includes(storagePolicy(db, folder.id))).map(folder => folder.id));
  for (const entry of Object.values(next.entries)) selected.add(entry.parentId);
  for (const id of [...selected]) {
    let parent = db.folders[id]?.parentId; while (parent) { selected.add(parent); parent = db.folders[parent].parentId; }
  }
  for (const id of selected) {
    const folder = db.folders[id];
    next.folders[id] = { id, parentId: folder.parentId, title: folder.title, storage: folder.storage, ...(folder.role ? { role: folder.role } : {}) };
    if (folder.workspaceSectionId) next.folders[id].workspaceSectionId = folder.workspaceSectionId;
    if (["cloud", "both"].includes(storagePolicy(db, id)) && folder.legacySection) next.folders[id].legacySection = clone(folder.legacySection);
    else if (folder.legacySection && Object.values(next.entries).some(entry => entry.id.startsWith(`workspace:${folder.legacySection.id}:`))) {
      next.folders[id].legacySection = { id: folder.legacySection.id, title: folder.title, type: folder.legacySection.type, area: folder.legacySection.area, items: [] };
    }
  }
  // Cross-references never silently pull local-only content into the cloud.
  for (const entry of Object.values(next.entries)) {
    for (const block of entry.content) {
      if (block.entryId && !next.entries[block.entryId]) throw new TypeError(`“${entry.title}” references a local-only entry. Enable cloud storage for that reference first.`);
      if (block.assetId) next.assets[block.assetId] = clone(db.assets[block.assetId]);
    }
    if (entry.data?.cardIds?.some(id => !next.entries[id])) throw new TypeError(`“${entry.title}” references local-only notecards.`);
    if (entry.type === "graph" && entry.data?.rootId && !next.folders[entry.data.rootId] && !next.entries[entry.data.rootId]) throw new TypeError("A saved cloud graph references a local-only root.");
  }
  const selectedEndpoint = id => Boolean(next.entries[id] || (next.folders[id] && ["cloud", "both"].includes(storagePolicy(db, id))));
  for (const link of Object.values(db.links)) if (selectedEndpoint(link.sourceId) && selectedEndpoint(link.targetId)) next.links[link.id] = clone(link);
  for (const deleted of Object.values(db.tombstones)) if (["cloud", "both"].includes(deleted.storage)) next.tombstones[deleted.id] = clone(deleted);
  return validateDatabase(next);
}

/** Three-way merge stops on concurrent edits/deletions; never discards a side. */
export function mergeDatabases(base, local, remote) {
  if (local.datasetId !== remote.datasetId || (base && base.datasetId !== local.datasetId)) throw new TypeError("These databases have different identities. Import separately instead of syncing.");
  const merged = clone(local); const conflicts = [];
  const equal = sameRecord;
  for (const table of ["folders", "entries", "assets", "links", "tombstones"]) {
    for (const id of new Set([...Object.keys(base?.[table] ?? {}), ...Object.keys(local[table]), ...Object.keys(remote[table])])) {
      const before = base?.[table]?.[id]; const ours = local[table][id]; const theirs = remote[table][id];
      if (equal(ours, theirs) || equal(theirs, before)) continue;
      if (!equal(ours, before)) { conflicts.push({ table, id, local: ours ?? null, remote: theirs ?? null }); continue; }
      if (theirs) merged[table][id] = clone(theirs); else delete merged[table][id];
    }
  }
  // A tombstone and an edited record are also a conflict, including when no
  // shared baseline exists on a newly connected device.
  for (const tombstone of Object.values(merged.tombstones)) {
    if (merged[tombstone.table]?.[tombstone.id]) conflicts.push({ table: tombstone.table, id: tombstone.id, reason: "deleted-on-another-device" });
  }
  return { database: merged, conflicts };
}
