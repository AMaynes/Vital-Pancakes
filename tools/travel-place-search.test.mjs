import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlaceSearchUrl,
  normalizePlaceQuery,
  sanitizePlaceSearchResults,
} from "./travel-place-search.mjs";

test("place searches are explicit, bounded HTTPS requests", () => {
  assert.equal(normalizePlaceQuery("  Museum   of Art  "), "Museum of Art");
  assert.equal(buildPlaceSearchUrl("http://example.com/search", "Museum"), null);
  assert.equal(buildPlaceSearchUrl("https://example.com/search", "ab"), null);

  const url = new URL(buildPlaceSearchUrl("https://example.com/search?old=value", "Museum of Art"));
  assert.equal(url.searchParams.get("q"), "Museum of Art");
  assert.equal(url.searchParams.get("format"), "jsonv2");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.has("old"), false);
});

test("place results retain only safe names and valid coordinates", () => {
  const results = sanitizePlaceSearchResults([
    { place_id: 1, display_name: "  Example   Museum, Hanoi ", lat: "21.03", lon: "105.85" },
    { place_id: 2, display_name: "Invalid latitude", lat: "200", lon: "10" },
    { place_id: 3, display_name: "", lat: "10", lon: "10" },
  ]);

  assert.deepEqual(results, [{
    id: "1",
    displayName: "Example Museum, Hanoi",
    latitude: 21.03,
    longitude: 105.85,
  }]);
  assert.deepEqual(sanitizePlaceSearchResults(results), results);
});
