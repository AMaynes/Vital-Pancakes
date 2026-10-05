import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createDatabase, validateDatabase, migrateWorkspace, replaceWorkspace, workspaceProjection, cloudSubset, graphNeighborhood, mergeDatabases, importNotecards, removeRecord, storagePolicy } from "./database-model.mjs";
import { buildPackageZip, readPackageFile, normalizeCloudConfig } from "./database-package.mjs";
import { projectSubjectCards } from "./notecard-bridge.mjs";
import { createDriveClient, overlayCloud } from "./database-drive.mjs";
import { createDatabaseAiAdapter } from "./database-ai-adapter.mjs";
import { createDatabaseFilesAiAdapter } from "./database-files-ai-adapter.mjs";
import { createAiCommandRegistry } from "./ai-command-registry.mjs";

const require = createRequire(import.meta.url);
const JSZip = require("../tools/file-converter-app/assets/jszip-3.11.1.min.js");
function entry(db, id, parentId = "studies-projects", storage = "inherit") {
  db.entries[id] = { id, parentId, title: id, type: "blog", storage, content: [{ type: "markdown", text: id }], data: {} }; return db.entries[id];
}
function fixture() { const db = createDatabase("dataset-test"); entry(db, "local-secret"); entry(db, "cloud-note", "studies-projects", "both"); return db; }
const envelope = (tool, mode, commands, id = "request-one") => ({ protocolVersion: 1, requestId: id, tool, mode, commands });

test("workspace migration and projection preserve specialized fields, samples and identity", () => {
  const workspace = { version: 14, sections: [{ id: "recipes", type: "recipe", title: "Recipes", area: "everyday", items: [{ id: "old-id", title: "Soup", ingredients: ["Stock"], steps: ["Heat"], custom: { nested: true } }] }] };
  const db = validateDatabase(migrateWorkspace(createDatabase("test"), workspace));
  assert.deepEqual(workspaceProjection(db), workspace);
  assert.equal(db.folders["section:recipes"].parentId, "cooking");
  assert.deepEqual(migrateWorkspace(db, workspace), { ...db, migrations: migrateWorkspace(db, workspace).migrations });
  const empty = { version: 14, sections: [{ ...workspace.sections[0], items: [] }] };
  const changed = replaceWorkspace(db, empty);
  assert.deepEqual(workspaceProjection(changed), empty);
  assert.ok(changed.tombstones["workspace:recipes:old-id"]);
});

test("cloud exports inherit policy, retain ancestors and exclude local content and settings", () => {
  const db = fixture(); db.settings.privateSetting = "secret";
  const cloud = cloudSubset(db);
  assert.deepEqual(Object.keys(cloud.entries), ["cloud-note"]);
  assert.ok(cloud.folders["studies-projects"]);
  assert.equal(JSON.stringify(cloud).includes("local-secret"), false);
  assert.equal(JSON.stringify(cloud).includes("privateSetting"), false);
  db.folders["studies-projects"].storage = "cloud";
  assert.equal(storagePolicy(db, "local-secret"), "cloud");
  assert.equal(Object.keys(cloudSubset(db).entries).length, 2);
});

test("existing study folders and local media survive projection and selective backup", () => {
  const db = createDatabase("test");
  const mediaId = "aabbcc-112233";
  db.assets[mediaId] = { id: mediaId, path: `assets/${"a".repeat(64)}.png`, name: "diagram.png", mime: "image/png", size: 10, sha256: "a".repeat(64) };
  const item = { id: "study-one", title: "Geometry", folderPath: "Mathematics / Geometry", content: `[[image|Diagram|vp-media:${mediaId}]]` };
  const section = { id: "studies", title: "Studies", type: "study", area: "studies", folders: ["Mathematics", "Mathematics / Geometry", "Empty"], items: [item] };
  const workspace = { version: 16, sections: [section] };
  const migrated = validateDatabase(migrateWorkspace(db, workspace));
  const entry = migrated.entries["workspace:studies:study-one"];
  assert.equal(migrated.folders[entry.parentId].title, "Geometry");
  assert.equal(migrated.folders[migrated.folders[entry.parentId].parentId].title, "Mathematics");
  assert.deepEqual(workspaceProjection(migrated), workspace);
  assert.ok(graphNeighborhood(migrated, entry.id, 1).nodes.some(node => node.title === "Geometry"));
  entry.storage = "both";
  const cloud = cloudSubset(migrated);
  assert.ok(cloud.assets[mediaId]);
  assert.equal(cloud.folders["section:studies"].legacySection.id, "studies");
  const moved = replaceWorkspace(migrated, { version: 17, sections: [{ ...section, folders: [], items: [{ ...item, folderPath: "Algebra" }] }] });
  validateDatabase(moved);
  assert.equal(moved.migrations.workspace.version, 17);
  assert.equal(moved.folders[moved.entries[entry.id].parentId].title, "Algebra");
  assert.equal(Object.values(moved.folders).some(folder => folder.title === "Geometry"), false);
  assert.ok(cloudSubset(moved).assets[mediaId]);
});

test("cloud references never silently upload local-only cards", () => {
  const db = fixture(); entry(db, "private-card", "notecards").type = "notecard"; db.entries["private-card"].data = { front: "Private", back: "Answer" };
  db.entries["cloud-note"].content.push({ type: "notecard", entryId: "private-card" });
  assert.throws(() => cloudSubset(db), /local-only/);
});

test("graph visits parents, children, incoming/outgoing references within the selected depth and cap", () => {
  const db = fixture(); entry(db, "related", "documents"); db.links.relation = { id: "relation", sourceId: "related", targetId: "cloud-note", type: "explains" };
  const one = graphNeighborhood(db, "cloud-note", 1);
  assert.deepEqual(new Set(one.nodes.map(node => node.id)), new Set(["cloud-note", "studies-projects", "related"]));
  assert.equal(one.nodes.some(node => node.id === "documents"), false);
  assert.ok(graphNeighborhood(db, "cloud-note", 2).nodes.some(node => node.id === "documents"));
  assert.equal(graphNeighborhood(db, "cloud-note", 2, 2).nodes.length, 2);
  assert.equal(graphNeighborhood(db, "cloud-note", 2, 2).truncated, true);
});

test("three-way sync merges independent changes and blocks edits versus deletes", () => {
  const base = fixture(); const local = structuredClone(base); const remote = structuredClone(base);
  local.entries["local-secret"].title = "Local edit"; remote.entries["cloud-note"].title = "Remote edit";
  const result = mergeDatabases(base, local, remote); assert.deepEqual(result.conflicts, []);
  assert.equal(result.database.entries["local-secret"].title, "Local edit"); assert.equal(result.database.entries["cloud-note"].title, "Remote edit");
  local.entries["cloud-note"].title = "Competing edit";
  assert.equal(mergeDatabases(base, local, remote).conflicts.length, 1);
  removeRecord(remote, "cloud-note");
  assert.ok(mergeDatabases(base, local, remote).conflicts.length);
  assert.throws(() => mergeDatabases(base, local, createDatabase("different")), /identities/);
});

test("unchanged records deleted remotely disappear while shared local attachments survive", () => {
  const base = fixture(); const remote = structuredClone(base); removeRecord(remote, "cloud-note");
  const merged = mergeDatabases(base, structuredClone(base), remote);
  assert.deepEqual(merged.conflicts, []); assert.equal(merged.database.entries["cloud-note"], undefined);
  const full = fixture(); const cloud = cloudSubset(full); const synced = structuredClone(cloud); removeRecord(synced, "cloud-note");
  const applied = overlayCloud(full, cloud, synced);
  assert.ok(applied.entries["local-secret"]); assert.equal(applied.entries["cloud-note"], undefined);
});

test("cards import once with stable IDs and retain edits and review progress", () => {
  const source = { categories: { basics: { name: "Basics", subcategories: { facts: { name: "Facts", cards: [{ question: "Q?", answer: "A" }] } } } } };
  const db = importNotecards(createDatabase("test"), "Mathematics", source); const [card] = Object.values(db.entries);
  card.data.review = { count: 4 }; card.data.back = "Edited answer";
  const again = importNotecards(db, "Mathematics", source);
  assert.equal(Object.keys(again.entries).length, 1); assert.equal(again.entries[card.id].data.review.count, 4); assert.equal(again.entries[card.id].data.back, "Edited answer");
  validateDatabase(again);
});

test("imports reject hierarchy cycles, unsafe URLs, missing assets and wrong references", () => {
  const db = fixture(); db.folders.library.parentId = "documents";
  assert.throws(() => validateDatabase(db), /cycles/);
  db.folders.library.parentId = null; db.entries["cloud-note"].content = [{ type: "link", url: "javascript:alert(1)" }]; assert.throws(() => validateDatabase(db), /HTTP/);
  db.entries["cloud-note"].content = [{ type: "image", assetId: "missing" }]; assert.throws(() => validateDatabase(db), /attachment/);
  db.entries["cloud-note"].content = [{ type: "notecard", entryId: "local-secret" }]; assert.throws(() => validateDatabase(db), /notecard/);
});

test("complete ZIP round-trips binary attachments, equations, references and structured records", async () => {
  const db = fixture(); const file = new Blob(["small document"], { type: "text/plain" });
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())).toString("hex");
  db.assets.asset = { id: "asset", path: `assets/${hash}.txt`, name: "notes.txt", size: file.size, mime: file.type, sha256: hash };
  db.entries["cloud-note"].content = [{ type: "document", assetId: "asset" }, { type: "equation", text: "E=mc^2" }];
  const packageBlob = await buildPackageZip(db, { clientId: "public-id" }, async () => file, JSZip);
  globalThis.JSZip = JSZip;
  const restored = await readPackageFile(new File([packageBlob], "test.zip"));
  assert.deepEqual(restored.database, db); assert.equal(await restored.blobs.asset.text(), "small document");
  await assert.rejects(buildPackageZip(db, { clientId: "" }, async () => null, JSZip), /Missing attachment/);
  const tampered = new JSZip(); tampered.file("database.json", JSON.stringify(db)); tampered.file(db.assets.asset.path, "different bytes");
  await assert.rejects(readPackageFile(new File([await tampered.generateAsync({ type: "uint8array" })], "bad.zip")), /integrity/);
});

test("public cloud configuration strips credentials and fixes the Documents default", () => {
  const config = normalizeCloudConfig({ clientId: "public-id", access_token: "secret", password: "private", defaultLocalDirectory: "desktop" });
  assert.equal(config.defaultLocalDirectory, "documents"); assert.equal(JSON.stringify(config).includes("secret"), false); assert.equal(JSON.stringify(config).includes("private"), false);
  assert.throws(() => normalizeCloudConfig({ clientId: "", scope: "https://www.googleapis.com/auth/drive" }), /limited/);
});

test("legacy practice uses edited canonical card content and respects deletions", () => {
  const source = { categories: { basic: { name: "Basic", subcategories: { first: { name: "First", cards: [{ question: "Q", answer: "A" }] } } } } };
  const db = importNotecards(createDatabase("test"), "Mathematics", source); const [card] = Object.values(db.entries); card.data.back = "Edited";
  const projected = projectSubjectCards(db, "Mathematics", source); const projectedCard = projected.categories.basic.subcategories.first.cards[0];
  assert.equal(projectedCard.answer, "Edited"); assert.equal(projectedCard.vpCardId, card.id);
  removeRecord(db, card.id); const deleted = importNotecards(db, "Mathematics", source); assert.equal(Object.keys(deleted.entries).length, 0);
  assert.equal(projectSubjectCards(deleted, "Mathematics", source).categories.basic.subcategories.first.cards.length, 0);
});

test("Drive conditional updates stop on 412 and refuse missing revision tokens", async () => {
  let request;
  const client = createDriveClient("temporary-token", async (url, options) => { request = { url, options }; return new Response("", { status: 412 }); });
  await assert.rejects(client.put("folder", "database.json", new Blob(["{}"]), { id: "file", etag: '"version-one"' }), /changed during sync/);
  assert.equal(request.options.headers["If-Match"], '"version-one"');
  assert.equal(request.options.method, "PUT");
  await assert.rejects(client.put("folder", "database.json", new Blob(["{}"]), { id: "file" }), /unsafe overwrite/);
});

test("AI commands are atomic, previewable and deny ungranted content", async () => {
  let state = fixture(); let commits = 0;
  const allowed = new Set(["studies-projects", "cloud-note"]);
  const adapter = createDatabaseAiAdapter({ getSnapshot: () => state, allowedIds: allowed, commitSnapshot: next => { state = next; commits++; } });
  await assert.rejects(adapter.preview(envelope("database", "preview", [{ type: "entries.get", id: "local-secret" }])), /Allow AI access/);
  const command = { type: "entries.save", id: "new-entry", parentId: "studies-projects", title: "New entry", entryType: "blog", content: [{ type: "markdown", text: "Content" }] };
  await adapter.preview(envelope("database", "preview", [command])); assert.equal(commits, 0);
  await assert.rejects(adapter.apply(envelope("database", "apply", [command, { type: "storage.set", id: "cloud-note", storage: "invalid" }])), /Invalid/);
  assert.equal(commits, 0); assert.equal(state.entries["new-entry"], undefined);
  const registry = createAiCommandRegistry(); registry.register(adapter);
  const denied = await registry.dispatch(envelope("database", "apply", [command])); assert.equal(denied.ok, false);
  const accepted = await registry.dispatch(envelope("database", "apply", [command], "accepted"), { grantedPermissions: ["create", "update", "sensitive-data"] }); assert.equal(accepted.ok, true); assert.equal(commits, 1);
  const capabilities = adapter.getCapabilities(); assert.ok(capabilities.commands.every(command => command.schema && command.example && command.permissions.length));
});

test("AI file operations require a specific one-time grant and preview performs no IO", async () => {
  let writes = 0; const grants = new Set(["package.save-folder"]);
  const adapter = createDatabaseFilesAiAdapter({ getRevision: () => 1, getSummary: () => ({ entryCount: 2 }), grants, actions: { "package.save-folder": async () => { writes++; return {}; } } });
  const request = envelope("database-files", "preview", [{ type: "package.save-folder" }]);
  await adapter.preview(request); assert.equal(writes, 0);
  await adapter.apply({ ...request, mode: "apply" }); assert.equal(writes, 1); assert.equal(grants.size, 0);
  await assert.rejects(adapter.apply(request), /Grant this specific/);
  grants.add("package.save-folder"); await assert.rejects(adapter.preview({ ...request, commands: [...request.commands, ...request.commands] }), /individually/);
});
