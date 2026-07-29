import assert from "node:assert/strict";
import test from "node:test";

import {
  STATE_JURISDICTIONS,
  STATE_TAX_CATEGORIES,
  createTaxDirectory,
  searchTaxDirectory,
} from "./tax-directory.mjs";

const records = createTaxDirectory();

test("directory covers all 50 states and the District of Columbia", () => {
  assert.equal(STATE_JURISDICTIONS.length, 51);
  assert.equal(new Set(STATE_JURISDICTIONS.map((state) => state.code)).size, 51);
  assert.ok(STATE_JURISDICTIONS.some((state) => state.code === "DC"));
});

test("every state exposes every maintained tax category", () => {
  for (const jurisdiction of STATE_JURISDICTIONS) {
    const stateRecords = records.filter((record) => record.jurisdictionCode === jurisdiction.code);
    assert.equal(stateRecords.length, STATE_TAX_CATEGORIES.length, jurisdiction.name);
    assert.deepEqual(
      new Set(stateRecords.map((record) => record.categoryId)),
      new Set(STATE_TAX_CATEGORIES.map((category) => category.id)),
    );
  }
});

test("federal directory includes major individual, business, payroll, estate, excise, and filing resources", () => {
  const federalCategories = new Set(records
    .filter((record) => record.jurisdictionId === "federal")
    .map((record) => record.categoryId));
  for (const categoryId of [
    "individual-income",
    "business-income",
    "payroll-employment",
    "estate-inheritance-gift",
    "excise",
    "forms-payments",
  ]) {
    assert.ok(federalCategories.has(categoryId), categoryId);
  }
});

test("search combines jurisdiction names, codes, categories, and tax synonyms", () => {
  const californiaSales = searchTaxDirectory(records, { query: "California sales" });
  assert.ok(californiaSales.some((record) => (
    record.jurisdictionCode === "CA" && record.categoryId === "sales-use"
  )));

  const nevadaInheritance = searchTaxDirectory(records, { query: "NV inheritance" });
  assert.deepEqual(
    new Set(nevadaInheritance.map((record) => record.categoryId)),
    new Set(["estate-inheritance-gift"]),
  );
});

test("filters and limits produce bounded results", () => {
  const texas = searchTaxDirectory(records, {
    jurisdiction: "tx",
    categoryId: "all",
    limit: 5,
  });
  assert.equal(texas.length, 5);
  assert.ok(texas.every((record) => record.jurisdictionCode === "TX"));
});

test("every tax entry points to a secure official IRS source", () => {
  assert.ok(records.length > 750);
  for (const record of records) {
    const source = new URL(record.sourceUrl);
    assert.equal(source.protocol, "https:");
    assert.equal(source.hostname, "www.irs.gov");
  }
});
