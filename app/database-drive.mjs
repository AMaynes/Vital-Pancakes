/**
 * Selective Drive package sync. Remembering is opt-in and browser-profile local.
 * Drive v2 exposes the file ETag in its JSON metadata, allowing conditional
 * writes even when CORS does not expose response headers.
 */
import { cloudSubset, mergeDatabases, validateDatabase, clone, sameRecord } from "./database-model.mjs";
import { getDatabase, getAsset, saveDatabase, flushDatabase, getDeviceValue, setDeviceValue, bindDriveAccount } from "./database-store.mjs";
import { verifyAsset, PACKAGE_README } from "./database-package.mjs";
import { createDriveSession } from "./drive-session.mjs";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
let identityReady;
let syncing = false;
let session;
let initialization;
let connectionAttempt = 0;
const authChannel = typeof window !== "undefined" && globalThis.BroadcastChannel ? new BroadcastChannel("vp-drive-auth") : null;
export function initializeDrive(config) {
  return initialization ??= (async () => {
    let storage; try { storage = globalThis.sessionStorage; } catch { /* Memory-only fallback. */ }
    session = createDriveSession({ read: getDeviceValue, write: setDeviceValue, bindAccount: bindDriveAccount, storage,
      identify: async (accessToken, signal) => {
        const account = await createDriveClient(accessToken, globalThis.fetch, { signal }).account();
        return account;
      } });
    await session.initialize(config);
  })().catch(error => { initialization = null; throw error; });
}
export function driveState() { return session?.state() ?? { connected: false, remember: false, autoSync: false }; }
export async function driveAccount() { return session?.account() ?? null; }
export async function setDriveSettings(changes) {
  if (changes.autoSync === true && !globalThis.navigator?.locks) throw new Error("Automatic sync needs safe cross-tab locking. Use manual sync in this browser.");
  await session.settings(changes); notifyDriveState();
}
export async function refreshDriveSettings() { await session.refresh(); }
export function notifyDriveState() { globalThis.window?.dispatchEvent(new Event("drive:state")); }
export function driveConnected() { return session?.connected() ?? false; }
export async function disconnectDrive(options) {
  connectionAttempt++;
  await session.disconnect(options); authChannel?.postMessage("disconnect"); notifyDriveState();
}
if (authChannel) authChannel.onmessage = () => { connectionAttempt++; session?.invalidate(); notifyDriveState(); };

export function prepareDriveIdentity(config) {
  if (!config.clientId) return Promise.resolve(false);
  return identityReady ??= new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.oauth2) { resolve(true); return; }
    const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true;
    script.onload = () => resolve(true); script.onerror = () => { identityReady = null; reject(new Error("Google sign-in could not load. Check your connection.")); }; document.head.append(script);
  });
}
export async function connectDrive(config) {
  const attempt = ++connectionAttempt;
  if (!config.clientId) throw new Error("Google Drive is not configured. Set the public OAuth client ID in cloud-config.json and authorize this website origin in Google Cloud.");
  if (config.scope !== DRIVE_SCOPE) throw new Error("Cloud configuration must use the limited drive.file scope.");
  await initializeDrive(config); await prepareDriveIdentity(config);
  const account = await driveAccount();
  await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({ client_id: config.clientId, scope: DRIVE_SCOPE,
      callback: async response => {
        if (attempt !== connectionAttempt) { reject(new Error("Connection cancelled.")); return; }
        if (response.error || !response.access_token || !google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) { reject(new Error(response.error_description ?? "Drive access was not granted.")); return; }
        try { await session.accept(response); notifyDriveState(); resolve(); } catch (error) { reject(error); }
      }, error_callback: error => reject(new Error(error.type ?? "Google sign-in was cancelled.")) });
    client.requestAccessToken({ prompt: account && driveState().remember ? "" : "select_account", ...(account?.email && driveState().remember ? { login_hint: account.email } : {}) });
  });
}

/** Injectable HTTP boundary used by sync contract tests. */
export function createDriveClient(accessToken, fetchRef = globalThis.fetch, { signal, guard } = {}) {
  const request = async (path, options = {}) => {
    await guard?.();
    const response = await fetchRef(`https://www.googleapis.com/${path}`, { ...options, signal, headers: { Authorization: `Bearer ${accessToken}`, ...options.headers } });
    if (!response.ok) {
      const message = response.status === 412 ? "Drive changed during sync. Retry to merge the newest copy." : response.status === 401 ? "Drive authorization expired. Connect again." : `Drive request failed (${response.status}). Your local database is intact.`;
      const error = new Error(message); error.status = response.status; throw error;
    }
    return response;
  };
  const escape = value => String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const fields = "id,title,etag,mimeType";
  return {
    async account() {
      const about = await (await request("drive/v2/about?fields=permissionId,user(emailAddress)")).json();
      if (!about.permissionId) throw new Error("Google did not identify the Drive account. Nothing was uploaded.");
      return { id: about.permissionId, email: about.user?.emailAddress ?? "" };
    },
    async find(parentId, title) {
      const query = `trashed = false and title = '${escape(title)}'${parentId ? ` and '${escape(parentId)}' in parents` : ""}`;
      const result = await (await request(`drive/v2/files?q=${encodeURIComponent(query)}&maxResults=1000&fields=${encodeURIComponent(`items(${fields}),nextPageToken`)}`)).json();
      if (result.nextPageToken) throw new Error("Too many matching Drive files; choose a dedicated VP folder.");
      if (result.items.length > 1) throw new Error(`Drive contains duplicate “${title}” files. Resolve them before syncing.`);
      return result.items[0] ?? null;
    },
    async metadata(id) { return (await request(`drive/v2/files/${encodeURIComponent(id)}?fields=${fields}`)).json(); },
    async folder(title, parentId = null) {
      const existing = await this.find(parentId, title);
      if (existing) {
        if (existing.mimeType !== "application/vnd.google-apps.folder") throw new Error(`“${title}” is not a Drive folder.`);
        return existing;
      }
      return (await request("drive/v2/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [{ id: parentId }] } : {}) }) })).json();
    },
    async read(id) { return (await request(`drive/v2/files/${encodeURIComponent(id)}?alt=media`)).blob(); },
    async put(parentId, title, blob, existing = null) {
      if (existing) {
        if (!existing.etag) throw new Error("Drive did not return a revision token; refusing an unsafe overwrite.");
        return (await request(`upload/drive/v2/files/${encodeURIComponent(existing.id)}?uploadType=media`, { method: "PUT", headers: { "Content-Type": blob.type || "application/octet-stream", "If-Match": existing.etag }, body: blob })).json();
      }
      const boundary = `vp-${crypto.randomUUID()}`;
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify({ title, parents: [{ id: parentId }], mimeType: blob.type || "application/octet-stream" }), `\r\n--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`, blob, `\r\n--${boundary}--`], { type: `multipart/related; boundary=${boundary}` });
      return (await request("upload/drive/v2/files?uploadType=multipart", { method: "POST", headers: { "Content-Type": body.type }, body })).json();
    },
  };
}

async function authorizedClient() {
  const credentials = await session.credentials();
  const client = createDriveClient(credentials.accessToken, globalThis.fetch, { signal: credentials.signal, guard: async () => {
    const current = await session.credentials();
    if (current.accessToken !== credentials.accessToken) throw new Error("Drive connection changed. Retry sync.");
  } });
  // Recheck with Google before any package IO, including restored tab sessions.
  const account = await client.account();
  if (account.id !== credentials.account.id) { await disconnectDrive(); throw new Error("Google account changed. Nothing was uploaded."); }
  return client;
}

export async function readDrivePackage(folderId) {
  if (!driveConnected()) throw new Error("Connect Google Drive first.");
  const client = await authorizedClient(); const file = await client.find(folderId, "database.json");
  if (!file) throw new Error("No database.json was found in that Drive folder. The app can access only files it created or was granted access to.");
  const database = validateDatabase(JSON.parse(await (await client.read(file.id)).text())); const blobs = {};
  const assets = Object.keys(database.assets).length ? await client.find(folderId, "assets") : null;
  for (const asset of Object.values(database.assets)) {
    const attachment = assets && await client.find(assets.id, asset.path.slice(7));
    if (!attachment) throw new Error(`Drive attachment missing: ${asset.name}.`);
    const blob = await client.read(attachment.id); await verifyAsset(asset, blob); blobs[asset.id] = blob;
  }
  return { database, blobs, folderId };
}

export async function syncDrive(config) {
  if (globalThis.navigator?.locks) return navigator.locks.request("vp-drive-package-sync", { ifAvailable: true }, lock => {
    if (!lock) throw new Error("Another tab is syncing Drive. Try again shortly.");
    return syncDriveUnlocked(config);
  });
  return syncDriveUnlocked(config);
}
async function syncDriveUnlocked(config) {
  if (syncing) throw new Error("A Drive sync is already running.");
  if (!driveConnected()) throw new Error("Connect Google Drive first.");
  syncing = true;
  try {
    await flushDatabase();
    const full = getDatabase(); const local = cloudSubset(full); const revision = full.revision;
    const client = await authorizedClient();
    const savedFolder = await getDeviceValue(`drive-folder:${full.datasetId}`);
    const root = savedFolder ? await client.metadata(savedFolder) : await client.folder(`${config.folderName || "Vital Pancakes"} — ${full.datasetId}`);
    if (root.mimeType !== "application/vnd.google-apps.folder") throw new Error("The selected Drive package is not a folder.");
    await setDeviceValue(`drive-folder:${full.datasetId}`, root.id);
    const manifest = await client.find(root.id, "database.json");
    const remote = manifest ? validateDatabase(JSON.parse(await (await client.read(manifest.id)).text())) : null;
    // Metadata is read again after content so the conditional write guards the
    // actual downloaded version, including concurrent writes during the read.
    if (manifest && (await client.metadata(manifest.id)).etag !== manifest.etag) throw new Error("Drive changed while reading. Retry sync.");
    const baseline = await getDeviceValue(`drive-base:${root.id}`);
    const plan = remote ? mergeDatabases(baseline, local, remote) : { database: local, conflicts: [] };
    if (plan.conflicts.length) {
      await setDeviceValue("drive-conflicts", { at: new Date().toISOString(), remote, conflicts: plan.conflicts });
      const error = new Error(`${plan.conflicts.length} Drive conflict(s). Download the Drive copy to compare or resolve the listed entries before retrying. No database was overwritten.`); error.conflicts = plan.conflicts; throw error;
    }
    const merged = validateDatabase(plan.database);
    const assetFolder = await client.folder("assets", root.id); const blobs = {};
    for (const asset of Object.values(merged.assets)) {
      const existing = await client.find(assetFolder.id, asset.path.slice(7)); let blob = await getAsset(asset.id);
      if (!blob && existing) { blob = await client.read(existing.id); await verifyAsset(asset, blob); blobs[asset.id] = blob; }
      if (!blob) throw new Error(`Attachment unavailable: ${asset.name}. Sync cancelled.`);
      await verifyAsset(asset, blob);
      if (!existing) await client.put(assetFolder.id, asset.path.slice(7), blob);
    }
    if (getDatabase().revision !== revision) throw new Error("The local database changed during sync. Retry to include the latest edits.");
    const json = value => new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const publicConfig = { version: config.version, provider: config.provider, clientId: config.clientId, scope: DRIVE_SCOPE, folderName: config.folderName, defaultLocalDirectory: "documents" };
    await client.put(root.id, "cloud-config.json", json(publicConfig), await client.find(root.id, "cloud-config.json"));
    if (!await client.find(root.id, "README.md")) await client.put(root.id, "README.md", new Blob([PACKAGE_README], { type: "text/markdown" }));
    // Skip rewriting identical manifests. Repeated sync is idempotent.
    if (!remote || !sameRecord(remote, merged)) await client.put(root.id, "database.json", json(merged), manifest);
    const next = overlayCloud(full, local, merged);
    if (JSON.stringify(next) !== JSON.stringify(full) || Object.keys(blobs).length) await saveDatabase(next, { expectedRevision: revision, blobs });
    await setDeviceValue(`drive-base:${root.id}`, merged);
    await setDeviceValue("drive-receipt", { folderId: root.id, datasetId: full.datasetId, at: new Date().toISOString(), database: merged });
    await setDeviceValue("drive-conflicts", null);
    return { folderId: root.id, entryCount: Object.keys(merged.entries).length };
  } catch (error) {
    if (error.status === 401) { session.invalidate(); notifyDriveState(); }
    throw error;
  } finally { syncing = false; }
}

export function overlayCloud(full, localCloud, merged) {
  const next = clone(full);
  for (const table of ["entries", "links", "tombstones"]) {
    for (const id of Object.keys(localCloud[table])) if (!merged[table][id]) delete next[table][id];
    Object.assign(next[table], clone(merged[table]));
  }
  Object.assign(next.assets, clone(merged.assets));
  for (const folder of Object.values(merged.folders)) {
    next.folders[folder.id] = { ...next.folders[folder.id], ...folder };
  }
  for (const tombstone of Object.values(merged.tombstones)) delete next[tombstone.table]?.[tombstone.id];
  return validateDatabase(next);
}
