import test from "node:test";
import assert from "node:assert/strict";

import { getConverterStatus } from "./file-converter-state.mjs";

test("reports ready after the converter loads", () => {
  assert.deepEqual(
    getConverterStatus({ online: true, loaded: true, timedOut: false }),
    {
      label: "Ready · files stay in your browser",
      tone: "ready",
    },
  );
});

test("reports an offline first-load requirement", () => {
  assert.deepEqual(
    getConverterStatus({ online: false, loaded: false, timedOut: false }),
    {
      label: "Offline · connect to load conversion engines",
      tone: "warning",
    },
  );
});

test("reports a useful timeout state", () => {
  assert.deepEqual(
    getConverterStatus({ online: true, loaded: false, timedOut: true }),
    {
      label: "Still loading · retry or open full screen",
      tone: "warning",
    },
  );
});
