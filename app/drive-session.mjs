/** Browser-profile preferences; only short-lived access tokens may enter tab storage.
 * No refresh tokens, passwords, or OAuth client secrets are stored here.
 * Dependency injection keeps account/expiry/sign-out behavior testable without Google.
 */
export const DRIVE_SESSION_KEY = "vp-drive-tab-session-v1";
export function createDriveSession({ read, write, bindAccount, identify, storage, now = Date.now }) {
  let config, auth = null, controller = new AbortController(), generation = 0;
  let preferences = { remember: false, autoSync: false };
  const remove = () => { try { storage?.removeItem(DRIVE_SESSION_KEY); } catch { /* Storage may be blocked. */ } };
  const persist = () => {
    remove();
    if (!preferences.remember || !auth) return;
    try { storage?.setItem(DRIVE_SESSION_KEY, JSON.stringify(auth)); } catch { /* Memory-only remains usable. */ }
  };
  const clear = () => { generation++; controller.abort(); controller = new AbortController(); auth = null; remove(); };
  const connected = () => { if (auth && auth.expiresAt <= now()) clear(); return Boolean(auth); };
  return {
    async initialize(value) {
      config = value;
      preferences = { remember: false, autoSync: false, ...await read("drive-preferences") };
      if (preferences.remember) {
        try {
          const saved = JSON.parse(storage?.getItem(DRIVE_SESSION_KEY) ?? "null");
          const owner = await read("drive-account");
          if (saved?.clientId === config.clientId && typeof saved.accessToken === "string" && saved.accessToken && Number.isFinite(saved.expiresAt) && saved.expiresAt > now() && saved.account?.id && saved.account.id === owner?.id && saved.epoch === await read("drive-session-epoch")) auth = saved;
          else remove();
        } catch { remove(); }
      } else remove();
    },
    connected,
    state: () => ({ connected: connected(), remember: preferences.remember, autoSync: preferences.autoSync }),
    async account() { return await read("drive-account"); },
    async accept(response) {
      clear(); const attempt = generation;
      const expiresAt = now() + Math.max(0, Number(response.expires_in) - 60) * 1000;
      if (!response.access_token || !Number.isFinite(expiresAt) || expiresAt <= now()) throw new Error("Google returned an expired authorization. Connect again.");
      const epoch = await read("drive-session-epoch");
      const account = await identify(response.access_token, controller.signal);
      if (attempt !== generation || epoch !== await read("drive-session-epoch")) throw new Error("Connection cancelled. Connect again.");
      await bindAccount(account);
      if (attempt !== generation || epoch !== await read("drive-session-epoch")) throw new Error("Connection cancelled. Connect again.");
      auth = { accessToken: response.access_token, expiresAt, account, epoch, clientId: config.clientId };
      persist();
    },
    async credentials() {
      if (!connected()) { clear(); throw new Error("Google connection expired or is disconnected. Reconnect in Library → Storage & backup; your edits are still in this browser."); }
      const current = auth;
      const owner = await read("drive-account");
      const epoch = await read("drive-session-epoch");
      if (current !== auth || current.epoch !== epoch || current.account.id !== owner?.id) { clear(); throw new Error("Drive was disconnected in this browser. Reconnect to continue."); }
      return { ...current, signal: controller.signal };
    },
    async refresh() { preferences = { remember: false, autoSync: false, ...await read("drive-preferences") }; if (!preferences.remember) remove(); },
    async settings(changes) {
      if (changes.autoSync === true && !connected()) throw new Error("Connect Google Drive before enabling automatic sync.");
      preferences = { ...preferences, ...changes };
      await write("drive-preferences", preferences); persist();
    },
    async disconnect({ forget = false } = {}) {
      clear(); // Abort in-flight HTTP immediately, before asynchronous storage writes.
      await write("drive-session-epoch", crypto.randomUUID());
      preferences = { ...preferences, autoSync: false, ...(forget ? { remember: false } : {}) };
      await write("drive-preferences", preferences);
    },
    invalidate: clear,
  };
}
