import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { registerOfflineShell } from "./offline-shell.mjs";

function createServiceWorker({ controlled = false } = {}) {
  const listeners = new Map();
  const calls = [];
  let updateCount = 0;
  return {
    controller: controlled ? {} : null,
    calls,
    get updateCount() {
      return updateCount;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type) {
      listeners.get(type)?.();
    },
    async register(scriptUrl, options) {
      calls.push({ scriptUrl, options });
      return {
        async update() {
          updateCount += 1;
        },
      };
    },
  };
}

test("registration bypasses HTTP caches and requests an immediate update check", async () => {
  const serviceWorker = createServiceWorker();

  const registration = await registerOfflineShell({ serviceWorker });

  assert.ok(registration);
  assert.deepEqual(serviceWorker.calls, [{
    scriptUrl: "./sw.js",
    options: { updateViaCache: "none" },
  }]);
  assert.equal(serviceWorker.updateCount, 1);
});

test("an existing controlled Workspace reloads once when a new worker takes over", async () => {
  const serviceWorker = createServiceWorker({ controlled: true });
  let reloadCount = 0;
  await registerOfflineShell({
    serviceWorker,
    locationRef: {
      reload() {
        reloadCount += 1;
      },
    },
  });

  serviceWorker.dispatch("controllerchange");
  serviceWorker.dispatch("controllerchange");

  assert.equal(reloadCount, 1);
});

test("a first-time service worker install does not force a reload", async () => {
  const serviceWorker = createServiceWorker();
  let reloadCount = 0;
  await registerOfflineShell({
    serviceWorker,
    locationRef: {
      reload() {
        reloadCount += 1;
      },
    },
  });

  serviceWorker.dispatch("controllerchange");

  assert.equal(reloadCount, 0);
});

test("document navigations use the network before the offline cache fallback", async () => {
  const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const navigationBranch = source.match(
    /if \(event\.request\.mode === "navigate"\) \{([\s\S]*?)\n  \}/,
  )?.[1] ?? "";

  assert.match(navigationBranch, /fetch\(event\.request\)/);
  assert.match(navigationBranch, /caches\.match\(event\.request, \{ ignoreSearch: true \}\)/);
  assert.ok(
    navigationBranch.indexOf("fetch(event.request)")
      < navigationBranch.indexOf("caches.match(event.request"),
  );
});
