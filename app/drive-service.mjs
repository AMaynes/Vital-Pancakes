import { loadCloudConfig } from "./database-package.mjs";
import { getDeviceValue } from "./database-store.mjs";
import { initializeDrive, driveState, refreshDriveSettings, syncDrive } from "./database-drive.mjs";
import { createDriveAutoSync } from "./drive-autosync.mjs";

let initialization, scheduler;
let status = "Automatic sync is off.";
export function driveSyncStatus() { return status; }
function report(text) {
  status = text;
  window.dispatchEvent(new Event("drive:status"));
  const home = document.getElementById("home-drive-note");
  if (home) home.textContent = `Google Drive · WIP. Test accounts only. ${text}`;
}
export function startDriveService() {
  return initialization ??= (async () => {
    const config = await loadCloudConfig();
    await initializeDrive(config);
    scheduler = createDriveAutoSync({
      state: async () => { await refreshDriveSettings(); return driveState(); },
      online: () => navigator.onLine,
      sync: async () => {
        if (!navigator.locks) throw new Error("Automatic sync needs a browser with safe cross-tab locking. Use manual sync here.");
        const conflicts = await getDeviceValue("drive-conflicts");
        if (conflicts?.conflicts?.length) { const error = new Error("Resolve the listed Drive conflicts first."); error.conflicts = conflicts.conflicts; throw error; }
        await syncDrive(config);
        window.dispatchEvent(new Event("drive:synced"));
      }, report,
    });
    window.addEventListener("database:changed", () => scheduler.changed());
    window.addEventListener("online", () => scheduler.schedule(0));
    window.addEventListener("offline", () => scheduler.schedule(0));
    window.addEventListener("drive:state", () => scheduler.schedule(0));
    window.addEventListener("drive:manual-sync", () => { scheduler.completed(); report(driveState().autoSync ? "Cloud-selected content synced. Automatic sync is on while this site is open." : "Selected content synced. Automatic sync is off."); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduler.schedule(0); });
    scheduler.schedule(0);
    return config;
  })().catch(error => { initialization = null; throw error; });
}
