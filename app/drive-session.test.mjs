import assert from "node:assert/strict";
import test from "node:test";
import { createDriveSession, DRIVE_SESSION_KEY } from "./drive-session.mjs";
import { createDriveAutoSync } from "./drive-autosync.mjs";
import { createDriveClient } from "./database-drive.mjs";
import { createDatabaseFilesAiAdapter } from "./database-files-ai-adapter.mjs";

function fixture() {
  const device = new Map(), tab = new Map(); let time = 1000, account = { id: "alice", email: "alice@example.test" };
  const config = { clientId: "public-client" };
  const storage = { getItem: key => tab.get(key) ?? null, setItem: (key, value) => tab.set(key, value), removeItem: key => tab.delete(key) };
  const deps = {
    read: async key => device.get(key) ?? null, write: async (key, value) => device.set(key, structuredClone(value)),
    storage, now: () => time, identify: async () => account,
    bindAccount: async user => {
      const owner = device.get("drive-account");
      if (owner && owner.id !== user.id) throw new Error("Different Google account");
      device.set("drive-account", structuredClone(user));
    },
  };
  const response = { access_token: "fake-short-lived-token", expires_in: 3600 };
  return { device, tab, config, deps, response, create: () => createDriveSession(deps), expire: () => { time += 3600000; }, switchUser: () => { account = { id: "bob" }; } };
}

test("default session is memory-only; remember restores same-tab reload but not another device", async () => {
  const f = fixture(); const session = f.create(); await session.initialize(f.config); await session.accept(f.response);
  assert.equal(session.connected(), true); assert.equal(f.tab.size, 0);
  await session.settings({ remember: true });
  assert.ok(f.tab.has(DRIVE_SESSION_KEY));
  assert.equal(JSON.stringify([...f.device]).includes(f.response.access_token), false);
  const reload = f.create(); await reload.initialize(f.config); assert.equal(reload.connected(), true);
  const anotherDevice = fixture().create(); await anotherDevice.initialize(f.config); assert.equal(anotherDevice.connected(), false);
  const anotherTab = createDriveSession({ ...f.deps, storage: undefined }); await anotherTab.initialize(f.config); assert.equal(anotherTab.connected(), false);
});

test("remember never extends expiry; invalid client IDs and expired tokens cannot restore", async () => {
  const f = fixture(), session = f.create(); await session.initialize(f.config); await session.settings({ remember: true }); await session.accept(f.response);
  const wrongClient = f.create(); await wrongClient.initialize({ clientId: "different-app" }); assert.equal(wrongClient.connected(), false);
  await session.settings({ remember: true }); f.expire();
  const reload = f.create(); await reload.initialize(f.config); assert.equal(reload.connected(), false); assert.equal(f.tab.size, 0);
  await assert.rejects(session.credentials(), /expired/);
});

test("different account is rejected without retaining its credentials, even after Forget", async () => {
  const f = fixture(), session = f.create(); await session.initialize(f.config); await session.settings({ remember: true }); await session.accept(f.response);
  await session.disconnect({ forget: true }); f.switchUser();
  await assert.rejects(session.accept(f.response), /Different Google account/);
  assert.equal(session.connected(), false); assert.equal(f.tab.size, 0);
  assert.equal(f.device.get("drive-account").id, "alice");
});

test("incomplete remembered session is discarded rather than claiming a connection", async () => {
  const f = fixture(); f.device.set("drive-preferences", { remember: true });
  f.tab.set(DRIVE_SESSION_KEY, JSON.stringify({ clientId: f.config.clientId, expiresAt: 9999999, epoch: null }));
  const session = f.create(); await session.initialize(f.config);
  assert.equal(session.connected(), false); assert.equal(f.tab.size, 0);
});

test("disconnect aborts requests and invalidates other/restored tabs while retaining local account binding", async () => {
  const f = fixture(), session = f.create(); await session.initialize(f.config); await session.settings({ remember: true }); await session.accept(f.response); await session.settings({ autoSync: true });
  const other = f.create(); await other.initialize(f.config);
  const { signal } = await session.credentials();
  await session.disconnect({ forget: true });
  assert.equal(signal.aborted, true); assert.deepEqual(session.state(), { connected: false, remember: false, autoSync: false });
  await assert.rejects(other.credentials(), /disconnected/);
  assert.equal(f.device.get("drive-account").id, "alice"); assert.equal(f.tab.size, 0);
});

test("late account response cannot reconnect after disconnect", async () => {
  const f = fixture(); let identify;
  const session = createDriveSession({ ...f.deps, identify: () => new Promise(resolve => { identify = resolve; }) });
  await session.initialize(f.config); const connection = session.accept(f.response);
  await new Promise(resolve => setImmediate(resolve));
  await session.disconnect(); identify({ id: "alice" });
  await assert.rejects(connection, /cancelled/); assert.equal(session.connected(), false);
});

test("blocked tab storage falls back to memory and autosync requires a connection", async () => {
  const f = fixture(); const session = createDriveSession({ ...f.deps, storage: { getItem() { throw new Error(); }, removeItem() { throw new Error(); }, setItem() { throw new Error(); } } });
  await session.initialize(f.config); await assert.rejects(session.settings({ autoSync: true }), /Connect/);
  await session.settings({ remember: true }); await session.accept(f.response); assert.equal(session.connected(), true);
  await assert.rejects(session.accept({ access_token: "bad", expires_in: "invalid" }), /expired/); assert.equal(session.connected(), false);
});

test("Drive identifies the authenticated user with the existing scope; guard prevents HTTP after signout", async () => {
  let requests = 0, permitted = true;
  const client = createDriveClient("fake", async url => {
    requests++; assert.match(url, /drive\/v2\/about\?fields=permissionId,user\(emailAddress\)/);
    return Response.json({ permissionId: "alice", user: { emailAddress: "alice@example.test" } });
  }, { guard: () => { if (!permitted) throw new Error("Disconnected"); } });
  assert.deepEqual(await client.account(), { id: "alice", email: "alice@example.test" });
  permitted = false; await assert.rejects(client.put("folder", "file", new Blob(["x"])), /Disconnected/); assert.equal(requests, 1);
});

function schedulerFixture() {
  let job, delay, calls = 0, online = true, failure, settings = { autoSync: false, connected: true };
  const reports = [];
  const scheduler = createDriveAutoSync({ state: async () => settings, online: () => online,
    sync: async () => { calls++; if (failure) throw failure; }, report: text => reports.push(text),
    setTimer: (fn, ms) => { job = fn; delay = ms; return 1; }, clearTimer: () => { job = null; },
  });
  scheduler.schedule();
  return { scheduler, reports, run: () => job(), calls: () => calls, delay: () => delay,
    settings: value => { settings = { ...settings, ...value }; }, offline: value => { online = !value; }, fail: value => { failure = value; } };
}

test("autosync requires opt-in, valid authorization, and connectivity; offline work retries when online", async () => {
  const f = schedulerFixture(); await f.run(); assert.equal(f.calls(), 0);
  f.settings({ autoSync: true, connected: false }); await f.run(); assert.equal(f.calls(), 0); assert.match(f.reports.at(-1), /Reconnect/);
  f.settings({ connected: true }); f.offline(true); await f.run(); assert.equal(f.calls(), 0);
  f.offline(false); f.scheduler.schedule(0); await f.run(); assert.equal(f.calls(), 1); assert.equal(f.delay(), 60000);
  f.scheduler.stop();
});

test("autosync backs off on failure and pauses conflicts until a successful manual sync", async () => {
  const f = schedulerFixture(); f.settings({ autoSync: true }); f.fail(new Error("Offline"));
  await f.run(); assert.equal(f.delay(), 120000); await f.run(); assert.equal(f.delay(), 240000); await f.run(); assert.equal(f.delay(), 300000);
  f.fail(Object.assign(new Error("Conflict"), { conflicts: [{}] })); await f.run(); const calls = f.calls(); await f.run(); assert.equal(f.calls(), calls);
  f.fail(null); f.scheduler.completed(); await f.run(); assert.equal(f.calls(), calls + 1); f.scheduler.stop();
});

test("new AI connection commands have schemas/examples and need individual grants; previews do not mutate", async () => {
  let calls = 0; const grants = new Set();
  const types = ["drive.remember", "drive.auto-sync.enable", "drive.auto-sync.disable", "drive.disconnect", "drive.forget"];
  const adapter = createDatabaseFilesAiAdapter({ getRevision: () => 1, getSummary: () => ({ driveConnected: true }), grants, actions: Object.fromEntries(types.map(type => [type, async () => { calls++; return {}; }])) });
  for (const type of types) {
    const capability = adapter.getCapabilities().commands.find(item => item.type === type);
    assert.equal(capability.schema.properties.type.const, type); assert.deepEqual(capability.example, { type }); assert.ok(capability.permissions.length);
    const envelope = { commands: [{ type }] };
    await assert.rejects(adapter.preview(envelope), /Grant this specific/); grants.add(type);
    const before = calls; await adapter.preview(envelope); assert.equal(calls, before);
    await adapter.apply(envelope); assert.equal(calls, before + 1); assert.equal(grants.has(type), false);
  }
});
