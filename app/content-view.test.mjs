import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContentHash,
  CONTENT_VIEWS,
  getContentViewStorageKey,
  normalizeContentView,
} from "./content-view.mjs";

test("collection views default safely to list and preserve grid", () => {
  assert.equal(normalizeContentView("list"), CONTENT_VIEWS.LIST);
  assert.equal(normalizeContentView("grid"), CONTENT_VIEWS.GRID);
  assert.equal(normalizeContentView("unknown"), CONTENT_VIEWS.LIST);
  assert.equal(normalizeContentView(null), CONTENT_VIEWS.LIST);
});

test("collection view keys and deep links encode identifiers", () => {
  assert.equal(
    getContentViewStorageKey("questions & ideas"),
    "vital-pancakes:content-view:questions%20%26%20ideas",
  );
  assert.equal(
    buildContentHash("how-to-cook", "knife skills"),
    "#section=how-to-cook&item=knife+skills",
  );
  assert.equal(buildContentHash("recipes"), "#section=recipes");
});
