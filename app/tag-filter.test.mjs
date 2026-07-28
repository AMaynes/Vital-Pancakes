import assert from "node:assert/strict";
import test from "node:test";

import {
  collectEntryTags,
  filterItemsByTags,
  normalizeEntryTags,
} from "./tag-filter.mjs";

const entries = [
  { id: "kitchen", tags: ["Weekly", "Kitchen", "weekly"] },
  { id: "laundry", tags: ["weekly", "laundry"] },
  { id: "shower", tags: ["daily", "hygiene"] },
];

test("entry tags normalize case, whitespace, and duplicates", () => {
  assert.deepEqual(normalizeEntryTags([" Weekly ", "weekly", "", null]), ["weekly"]);
});

test("available tags report stable alphabetical counts", () => {
  assert.deepEqual(collectEntryTags(entries), [
    { tag: "daily", count: 1 },
    { tag: "hygiene", count: 1 },
    { tag: "kitchen", count: 1 },
    { tag: "laundry", count: 1 },
    { tag: "weekly", count: 2 },
  ]);
});

test("tag filtering is inclusive and empty selections show everything", () => {
  assert.deepEqual(filterItemsByTags(entries, []).map((item) => item.id), ["kitchen", "laundry", "shower"]);
  assert.deepEqual(
    filterItemsByTags(entries, ["kitchen", "hygiene"]).map((item) => item.id),
    ["kitchen", "shower"],
  );
});
