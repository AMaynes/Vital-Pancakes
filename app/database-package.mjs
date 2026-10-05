/** Portable database.json + assets/ packages. Folder access requires a gesture. */
import { validateDatabase, createDatabase } from "./database-model.mjs";
import { getDatabase, getAsset, getDeviceValue, setDeviceValue, flushDatabase, replaceImportedDatabase } from "./database-store.mjs";

export const PACKAGE_README = `Vital Pancakes personal database\n\n database.json — hierarchy, entries, glossary, cards and saved graph views.\n assets/ — binary attachments, referenced by stable IDs.\n cloud-config.json — public Google OAuth client configuration; no secrets.\n README.md — this guide.\n\nLogical subjects and subdirectories live in database.json, not extra disk folders.\nKeep the whole package when moving or backing up your data.\nSharedVP publishing is a future feature.\n`;
let zipReady;

export async function loadCloudConfig() {
  const response = await fetch(new URL("../cloud-config.json", import.meta.url));
  if (!response.ok) throw new Error("Unable to load cloud-config.json.");
  return normalizeCloudConfig(await response.json());
}

export function normalizeCloudConfig(value) {
  if (!value || typeof value.clientId !== "string") throw new TypeError("Cloud configuration needs a public clientId string (empty until configured).");
  const scope = "https://www.googleapis.com/auth/drive.file";
  if (value.scope && value.scope !== scope) throw new TypeError("Use only the limited drive.file scope.");
  return { version: 1, provider: "google-drive", clientId: value.clientId, scope, folderName: String(value.folderName ?? "Vital Pancakes").slice(0, 100), defaultLocalDirectory: "documents" };
}

export async function chooseLocalDirectory() {
  if (!globalThis.showDirectoryPicker) throw new Error("This browser uses package downloads instead. Folder access is available in supported desktop browsers.");
  const handle = await showDirectoryPicker({ id: "vp-database", startIn: "documents", mode: "readwrite" });
  await setDeviceValue("directory-handle", handle);
  await setDeviceValue("directory-base", null);
  return handle;
}

export async function localDirectory() {
  const handle = await getDeviceValue("directory-handle");
  if (!handle) throw new Error("Choose your local database folder first.");
  if (await handle.queryPermission({ mode: "readwrite" }) !== "granted" && await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("Folder access was not granted.");
  return handle;
}

/** Writes assets before the manifest; refuses to overwrite divergent disk data. */
export async function writeFolderPackage(handle, config, database = null) {
  await flushDatabase(); const db = validateDatabase(database ?? getDatabase());
  const existing = await readOptionalJson(handle, "database.json");
  const baseline = await getDeviceValue("directory-base");
  if (existing && JSON.stringify(existing) !== JSON.stringify(db) && JSON.stringify(existing) !== JSON.stringify(baseline)) {
    throw new Error("This folder contains a different or newer database. Import it first, or choose an empty folder. Nothing was overwritten.");
  }
  const assets = await handle.getDirectoryHandle("assets", { create: true });
  for (const asset of Object.values(db.assets)) {
    const blob = await getAsset(asset.id);
    if (!blob) throw new Error(`Attachment “${asset.name}” is unavailable on this device. Restore the complete package before saving.`);
    await verifyAsset(asset, blob);
    const name = asset.path.slice(7);
    let identical = false;
    try { await verifyAsset(asset, await (await assets.getFileHandle(name)).getFile()); identical = true; } catch (error) { if (error.name !== "NotFoundError" && !/Attachment/.test(error.message)) throw error; }
    if (!identical) await writeFile(assets, name, blob);
  }
  await writeFile(handle, "cloud-config.json", JSON.stringify(normalizeCloudConfig(config), null, 2));
  await writeFile(handle, "README.md", PACKAGE_README);
  await writeFile(handle, "database.json", JSON.stringify(db, null, 2));
  await setDeviceValue("directory-base", db);
  return db;
}

export async function readFolderPackage(handle) {
  const db = validateDatabase(await readOptionalJson(handle, "database.json"));
  const blobs = {};
  if (Object.keys(db.assets).length) {
    const directory = await handle.getDirectoryHandle("assets");
    for (const asset of Object.values(db.assets)) {
      const file = await (await directory.getFileHandle(asset.path.slice(7))).getFile();
      await verifyAsset(asset, file); blobs[asset.id] = file;
    }
  }
  return { database: db, blobs };
}

export async function downloadPackage(config) {
  await flushDatabase(); const db = getDatabase(); const JSZip = await loadZip();
  const blob = await buildPackageZip(db, config, getAsset, JSZip);
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "Vital-Pancakes.zip"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function buildPackageZip(database, config, assetReader, JSZip) {
  const db = validateDatabase(database); const zip = new JSZip();
  zip.file("database.json", JSON.stringify(db, null, 2));
  zip.file("cloud-config.json", JSON.stringify(normalizeCloudConfig(config), null, 2)); zip.file("README.md", PACKAGE_README);
  for (const asset of Object.values(db.assets)) {
    const blob = await assetReader(asset.id);
    if (!blob) throw new Error(`Missing attachment: ${asset.name}. Export cancelled so the backup is complete.`);
    await verifyAsset(asset, blob); zip.file(asset.path, await blob.arrayBuffer());
  }
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

export async function readPackageFile(file) {
  if (file.size > 512 * 1024 * 1024) throw new Error("Import packages smaller than 512 MB; use folder import for larger libraries.");
  if (file.name.endsWith(".json")) {
    const db = validateDatabase(JSON.parse(await file.text()));
    if (Object.keys(db.assets).length) throw new Error("This database has attachments. Import its complete ZIP package or folder.");
    return { database: db, blobs: {} };
  }
  const JSZip = await loadZip(); const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const inflatedSize = Object.values(zip.files).reduce((total, item) => total + (item._data?.uncompressedSize ?? 0), 0);
  if (inflatedSize > 1024 * 1024 * 1024) throw new Error("This ZIP expands beyond 1 GB. Import its folder instead.");
  const manifest = zip.file("database.json"); if (!manifest) throw new Error("The ZIP must contain database.json at its root.");
  if (manifest._data?.uncompressedSize > 50 * 1024 * 1024) throw new Error("The database manifest exceeds the 50 MB import limit.");
  const db = validateDatabase(JSON.parse(await manifest.async("string"))); const blobs = {};
  for (const asset of Object.values(db.assets)) {
    const item = zip.file(asset.path); if (!item) throw new Error(`Missing attachment: ${asset.name}.`);
    const blob = new Blob([await item.async("uint8array")], { type: asset.mime }); await verifyAsset(asset, blob); blobs[asset.id] = blob;
  }
  return { database: db, blobs };
}

export async function importPackage(packageData) {
  const complete = createDatabase(packageData.database.datasetId);
  const database = { ...complete, ...packageData.database, folders: { ...complete.folders, ...packageData.database.folders }, settings: { ...complete.settings, ...packageData.database.settings } };
  await replaceImportedDatabase(database, packageData.blobs);
}

export async function verifyAsset(asset, blob) {
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (blob.size !== asset.size || hash !== asset.sha256) throw new Error(`Attachment “${asset.name}” failed its integrity check.`);
}

async function readOptionalJson(handle, name) {
  try { return JSON.parse(await (await (await handle.getFileHandle(name)).getFile()).text()); }
  catch (error) { if (error.name === "NotFoundError") return null; throw error; }
}
async function writeFile(handle, name, contents) {
  const file = await handle.getFileHandle(name, { create: true }); const writer = await file.createWritable();
  try { await writer.write(contents); await writer.close(); } catch (error) { await writer.abort().catch(() => {}); throw error; }
}
function loadZip() {
  if (globalThis.JSZip) return Promise.resolve(globalThis.JSZip);
  return zipReady ??= new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.src = new URL("../tools/file-converter-app/assets/jszip-3.11.1.min.js", import.meta.url).href;
    script.onload = () => resolve(globalThis.JSZip); script.onerror = () => { zipReady = null; reject(new Error("Package download is unavailable. Retry online once to cache its file.")); }; document.head.append(script);
  });
}
