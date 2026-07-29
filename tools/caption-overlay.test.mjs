import assert from "node:assert/strict";
import test from "node:test";

import {
  CaptionDisplayClock,
  CaptionOverlay,
  CaptionOverlaySupersededError,
} from "./caption-overlay.mjs";

class FakeOverlayWindow {
  constructor() {
    this.closed = false;
    this.closeCount = 0;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  close() {
    this.closeCount += 1;
    this.closed = true;
  }
}

class TestCaptionOverlay extends CaptionOverlay {
  buildDocument() {
    this.elements = {};
  }
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("display clock cancels its pending frame, resets, and can restart", () => {
  const callbacks = new Map();
  const canceled = [];
  const ticks = [];
  let nextFrameId = 0;
  let now = 10;
  const clock = new CaptionDisplayClock({
    tick: (timestamp) => ticks.push(timestamp),
    requestFrame: (callback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      callbacks.set(frameId, callback);
      return frameId;
    },
    cancelFrame: (frameId) => canceled.push(frameId),
    now: () => now,
  });

  assert.equal(clock.start(), true);
  assert.equal(clock.start(), false);
  assert.deepEqual(ticks, [10]);
  callbacks.get(0)(25);
  assert.deepEqual(ticks, [10, 25]);

  assert.equal(clock.stop(), true);
  assert.deepEqual(canceled, [1]);
  assert.equal(clock.frameId, null);
  assert.equal(clock.running, false);

  now = 40;
  assert.equal(clock.start(), true);
  assert.deepEqual(ticks, [10, 25, 40]);
  assert.equal(clock.frameId, 2);
});

test("overlay pagehide releases references and notifies its owner once", () => {
  let closeCount = 0;
  const overlay = new CaptionOverlay({ onClose: () => { closeCount += 1; } });
  const firstWindow = new FakeOverlayWindow();
  overlay.window = firstWindow;
  overlay.elements = {};
  overlay.mode = "popup";
  overlay.listenForWindowClose(firstWindow);

  firstWindow.dispatch("pagehide");
  firstWindow.dispatch("beforeunload");

  assert.equal(closeCount, 1);
  assert.equal(overlay.window, null);
  assert.equal(overlay.elements, null);
  assert.equal(overlay.mode, null);
  assert.equal(firstWindow.listeners.get("pagehide").size, 0);
  assert.equal(firstWindow.listeners.get("beforeunload").size, 0);
});

test("closing and replacing overlay windows does not let a stale window clear the new one", () => {
  let closeCount = 0;
  const overlay = new CaptionOverlay({ onClose: () => { closeCount += 1; } });
  const firstWindow = new FakeOverlayWindow();
  overlay.window = firstWindow;
  overlay.elements = {};
  overlay.listenForWindowClose(firstWindow);
  overlay.close();

  const secondWindow = new FakeOverlayWindow();
  overlay.window = secondWindow;
  overlay.elements = {};
  overlay.listenForWindowClose(secondWindow);
  firstWindow.dispatch("pagehide");

  assert.equal(overlay.window, secondWindow);
  assert.equal(closeCount, 1);

  secondWindow.dispatch("pagehide");
  assert.equal(overlay.window, null);
  assert.equal(closeCount, 2);
});

test("out-of-order Picture-in-Picture opens keep the newest window active", async (context) => {
  const originalPictureInPicture = globalThis.documentPictureInPicture;
  context.after(() => {
    if (originalPictureInPicture === undefined) delete globalThis.documentPictureInPicture;
    else globalThis.documentPictureInPicture = originalPictureInPicture;
  });
  const firstRequest = createDeferred();
  const secondRequest = createDeferred();
  const requests = [firstRequest, secondRequest];
  globalThis.documentPictureInPicture = {
    requestWindow: () => requests.shift().promise,
  };
  const overlay = new TestCaptionOverlay();
  const firstWindow = new FakeOverlayWindow();
  const secondWindow = new FakeOverlayWindow();

  const firstOpen = overlay.open();
  const secondOpen = overlay.open();
  secondRequest.resolve(secondWindow);
  assert.equal(await secondOpen, "document-picture-in-picture");
  assert.equal(overlay.window, secondWindow);

  firstRequest.resolve(firstWindow);
  await assert.rejects(firstOpen, CaptionOverlaySupersededError);
  assert.equal(firstWindow.closed, true);
  assert.equal(firstWindow.closeCount, 1);
  assert.equal(secondWindow.closed, false);
  assert.equal(overlay.window, secondWindow);
});

test("closing a pending open and reopening cannot resurrect its stale window", async (context) => {
  const originalPictureInPicture = globalThis.documentPictureInPicture;
  context.after(() => {
    if (originalPictureInPicture === undefined) delete globalThis.documentPictureInPicture;
    else globalThis.documentPictureInPicture = originalPictureInPicture;
  });
  const staleRequest = createDeferred();
  const currentRequest = createDeferred();
  const requests = [staleRequest, currentRequest];
  globalThis.documentPictureInPicture = {
    requestWindow: () => requests.shift().promise,
  };
  const overlay = new TestCaptionOverlay();
  const staleWindow = new FakeOverlayWindow();
  const currentWindow = new FakeOverlayWindow();

  const staleOpen = overlay.open();
  overlay.close();
  const currentOpen = overlay.open();
  currentRequest.resolve(currentWindow);
  await currentOpen;

  staleRequest.resolve(staleWindow);
  await assert.rejects(staleOpen, CaptionOverlaySupersededError);
  assert.equal(staleWindow.closed, true);
  assert.equal(currentWindow.closed, false);
  assert.equal(overlay.window, currentWindow);
});
