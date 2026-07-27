/**
 * Pure validation and URL helpers for user-triggered place searches.
 *
 * The UI deliberately calls these helpers only after the user presses Search;
 * the configured Nominatim-compatible service must not be used for autocomplete.
 */

export const DEFAULT_PLACE_SEARCH_ENDPOINT = "https://nominatim.openstreetmap.org/search";

const QUERY_LIMIT = 200;
const RESULT_LIMIT = 5;

export function normalizePlaceQuery(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, QUERY_LIMIT);
}

export function buildPlaceSearchUrl(endpoint, query) {
  const normalizedQuery = normalizePlaceQuery(query);
  if (normalizedQuery.length < 3) return null;

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return null;
    url.search = "";
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", String(RESULT_LIMIT));
    url.searchParams.set("q", normalizedQuery);
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizePlaceSearchResults(payload) {
  if (!Array.isArray(payload)) return [];

  return payload
    .map((candidate) => {
      const displayName = String(candidate?.display_name ?? candidate?.displayName ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      const latitude = Number(candidate?.lat ?? candidate?.latitude);
      const longitude = Number(candidate?.lon ?? candidate?.longitude);
      if (
        !displayName
        || !Number.isFinite(latitude)
        || latitude < -90
        || latitude > 90
        || !Number.isFinite(longitude)
        || longitude < -180
        || longitude > 180
      ) {
        return null;
      }

      return {
        id: String(candidate.place_id ?? candidate.id ?? `${latitude},${longitude}`).slice(0, 128),
        displayName,
        latitude,
        longitude,
      };
    })
    .filter(Boolean)
    .slice(0, RESULT_LIMIT);
}
