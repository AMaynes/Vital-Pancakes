/** Opt-in sync scheduler. No login popups, uploads before consent, or closed-page jobs. */
export function createDriveAutoSync({ state, online, sync, report, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer, running = false, stopped = false, failures = 0, conflict = false;
  function schedule(delay = 1500) {
    if (stopped) return;
    clearTimer(timer); timer = setTimer(run, delay);
  }
  async function run() {
    if (running || stopped) return;
    running = true;
    try {
      const settings = await state();
      if (!settings.autoSync) { report("Automatic sync is off."); return; }
      if (!online()) { report("Offline — changes remain in this browser. Sync resumes when online while this site is open."); return; }
      if (!settings.connected) { report("Reconnect Google Drive to sync pending changes."); return; }
      if (conflict) { report("Automatic sync paused: resolve the conflict in Storage & backup, then Sync selected content."); return; }
      report("Syncing cloud-selected content…");
      await sync(); failures = 0;
      report("Cloud-selected content synced. Automatic sync is on while this site is open.");
    } catch (error) {
      failures++; conflict = Boolean(error.conflicts?.length);
      report(`Sync paused: ${error.message} Local edits are retained.`, true);
    } finally {
      running = false;
      schedule(Math.min(300000, 60000 * 2 ** Math.min(failures, 3)));
    }
  }
  return {
    schedule,
    changed() { if (!running) schedule(); },
    completed() { failures = 0; conflict = false; schedule(60000); },
    stop() { stopped = true; clearTimer(timer); },
  };
}
