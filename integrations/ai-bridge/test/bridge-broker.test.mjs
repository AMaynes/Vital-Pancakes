import assert from "node:assert/strict";
import { test } from "node:test";
import { BridgeBroker } from "../src/bridge-broker.mjs";

const PAGE = Object.freeze({
  pageId: "page-1",
  connectionId: "connection-1",
  origin: "http://localhost:8000",
  url: "http://localhost:8000/tools/visual-board.html",
  title: "Visual Board",
  tools: ["visual-board"],
});

function createFixture() {
  const sent = [];
  const connection = {
    send: (message) => sent.push(message),
    close: () => {},
  };
  const broker = new BridgeBroker({
    allowedPageOrigins: new Set(["http://localhost:8000"]),
  });
  broker.attachConnection(connection);
  broker.syncPages(connection, [PAGE]);
  return { broker, connection, sent };
}

test("routes a request to the connected page and correlates its response", async () => {
  const { broker, connection, sent } = createFixture();
  const resultPromise = broker.request(
    "getCapabilities",
    { args: ["visual-board"] },
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].pageId, PAGE.pageId);
  assert.equal(sent[0].method, "getCapabilities");
  broker.handleResponse(connection, {
    kind: "response",
    requestId: sent[0].requestId,
    ok: true,
    result: { toolId: "visual-board" },
  });
  assert.deepEqual(await resultPromise, { toolId: "visual-board" });
});

test("propagates structured page failures", async () => {
  const { broker, connection, sent } = createFixture();
  const resultPromise = broker.request("undo", { args: ["visual-board"] });
  broker.handleResponse(connection, {
    kind: "response",
    requestId: sent[0].requestId,
    ok: false,
    error: { code: "nothing_to_undo", message: "Nothing to undo." },
  });
  await assert.rejects(
    resultPromise,
    (error) => error.code === "nothing_to_undo" && error.message === "Nothing to undo.",
  );
});

test("an explicit page ID routes correctly when several pages are connected", async () => {
  const { broker, connection, sent } = createFixture();
  broker.syncPages(connection, [
    PAGE,
    {
      ...PAGE,
      pageId: "page-2",
      connectionId: "connection-2",
      title: "Studies",
      tools: ["studies"],
    },
  ]);
  const resultPromise = broker.request(
    "listTools",
    { args: [] },
    { pageId: "page-2" },
  );
  assert.equal(sent.at(-1).pageId, "page-2");
  broker.handleResponse(connection, {
    kind: "response",
    requestId: sent.at(-1).requestId,
    ok: true,
    result: [{ id: "studies" }],
  });
  assert.deepEqual(await resultPromise, [{ id: "studies" }]);
});

test("disconnect rejects pending requests", async () => {
  const { broker, connection } = createFixture();
  const resultPromise = broker.request("getContext", { args: ["visual-board", {}] });
  broker.detachConnection(connection);
  await assert.rejects(
    resultPromise,
    (error) => error.code === "bridge_disconnected",
  );
});

test("timeout sends cancellation and rejects the request", async () => {
  const { broker, sent } = createFixture();
  await assert.rejects(
    broker.request("getContext", { args: [] }, { timeoutMs: 250 }),
    (error) => error.code === "bridge_timeout",
  );
  assert.equal(sent.at(-1).kind, "cancel");
});
