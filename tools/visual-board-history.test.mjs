import assert from "node:assert/strict";
import test from "node:test";

import {
  createBoardHistoryEntry,
  restoreBoardHistoryEntry,
} from "./visual-board-history.mjs";

test("history entries preserve selection without sharing live object references", () => {
  const objects = [
    { id: "line-1", type: "line", color: "#000000" },
    { id: "line-2", type: "line", color: "#222222" },
  ];
  const entry = createBoardHistoryEntry(objects, [objects[1]]);

  objects[1].color = "#ff0000";
  const restored = restoreBoardHistoryEntry(entry);

  assert.equal(restored.objects[1].color, "#222222");
  assert.deepEqual(restored.selectedObjects.map((object) => object.id), ["line-2"]);
  assert.equal(restored.selectedObjects[0], restored.objects[1]);
  assert.notEqual(restored.objects[1], objects[1]);
});

test("history restoration keeps selected order and omits missing objects", () => {
  const restored = restoreBoardHistoryEntry({
    objects: [
      { id: "first", type: "line" },
      { id: "second", type: "line" },
    ],
    selectedIds: ["second", "missing", "first"],
  });

  assert.deepEqual(
    restored.selectedObjects.map((object) => object.id),
    ["second", "first"],
  );
});
