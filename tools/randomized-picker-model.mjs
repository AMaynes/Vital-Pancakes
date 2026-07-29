/**
 * Parsing, probability, sampling, grouping, and deterministic seeded random
 * policies for Randomized Picker.
 */

export const PICKER_FORMAT = "vital-pancakes-picker";
export const PICKER_VERSION = 1;

export function parsePickerInput(text, mode = "lines") {
  if (typeof text !== "string") throw new TypeError("Picker input must be text.");
  const values = mode === "comma"
    ? parseCsvLine(text)
    : text.split(/\r?\n/);
  return values
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name, index) => ({
      id: `item-${index + 1}`,
      name,
      weight: 1,
      category: "",
      notes: "",
      enabled: true,
    }));
}

export function parsePickerCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines.shift()).map((header) => header.trim().toLowerCase());
  const nameIndex = headers.indexOf("name");
  if (nameIndex < 0) throw new TypeError("Picker CSV needs a name column.");
  return lines.map((line, index) => {
    const values = parseCsvLine(line);
    return {
      id: `csv-${index + 1}`,
      name: values[nameIndex]?.trim() ?? "",
      weight: values[headers.indexOf("weight")] || 1,
      category: values[headers.indexOf("category")]?.trim() ?? "",
      notes: values[headers.indexOf("notes")]?.trim() ?? "",
      enabled: headers.includes("enabled")
        ? !["false", "0", "no"].includes(String(values[headers.indexOf("enabled")]).toLowerCase())
        : true,
    };
  }).filter((item) => item.name);
}

export function validatePickerItems(items) {
  if (!Array.isArray(items) || !items.length) throw new TypeError("Add at least one item.");
  const normalized = items.map((item, index) => {
    const weight = Number(item.weight);
    if (!item?.name?.trim()) throw new TypeError(`Item ${index + 1} needs a name.`);
    if (!Number.isFinite(weight) || weight < 0) throw new TypeError(`“${item.name}” has an invalid or negative weight.`);
    return { ...item, id: String(item.id || `item-${index + 1}`), name: item.name.trim(), weight };
  });
  const enabled = normalized.filter((item) => item.enabled !== false);
  if (!enabled.length) throw new TypeError("Enable at least one item.");
  if (enabled.every((item) => item.weight === 0)) throw new TypeError("Enabled weights cannot all be zero.");
  return normalized;
}

export function normalizedProbabilities(items) {
  const valid = validatePickerItems(items).filter((item) => item.enabled !== false);
  const total = valid.reduce((sum, item) => sum + item.weight, 0);
  return valid.map((item) => ({ ...item, probability: item.weight / total }));
}

export function createSeededRandom(seed) {
  let state = hashSeed(String(seed));
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function weightedSample(items, count = 1, options = {}) {
  const random = options.random ?? cryptoRandom;
  const withReplacement = options.withReplacement ?? false;
  const eligible = validatePickerItems(items)
    .filter((item) => item.enabled !== false && !options.excludedIds?.includes(item.id))
    .filter((item) => !options.category || item.category === options.category);
  if (!eligible.length) throw new TypeError("No eligible items remain.");
  const requested = Math.max(1, Math.trunc(count));
  if (!withReplacement && requested > eligible.length) throw new RangeError("Cannot choose more unique items than are eligible.");

  if (withReplacement) {
    return Array.from({ length: requested }, () => chooseWeighted(eligible, random));
  }

  return eligible
    .filter((item) => item.weight > 0)
    .map((item) => {
      const uniform = Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, random()));
      return { item, key: -Math.log(uniform) / item.weight };
    })
    .sort((a, b) => a.key - b.key)
    .slice(0, requested)
    .map((entry) => entry.item);
}

export function randomOrder(items, random = cryptoRandom) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function divideIntoGroups(items, groupCount, random = cryptoRandom) {
  const count = Math.max(1, Math.min(items.length, Math.trunc(groupCount)));
  const groups = Array.from({ length: count }, (_, index) => ({ id: `group-${index + 1}`, items: [] }));
  randomOrder(items, random).forEach((item, index) => groups[index % count].items.push(item));
  return groups;
}

export function migratePickerProject(value) {
  if (!value || value.format !== PICKER_FORMAT) throw new TypeError("This is not a Randomized Picker project.");
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > PICKER_VERSION) {
    throw new TypeError(`Unsupported picker project version: ${value.version}.`);
  }
  return {
    ...structuredCloneSafe(value),
    version: PICKER_VERSION,
    items: validatePickerItems(value.items),
    settings: {
      mode: "one", count: 1, withReplacement: false, seeded: false, seed: "",
      category: "", excludedIds: [], ...value.settings,
    },
    history: Array.isArray(value.history) ? value.history : [],
  };
}

export function createPickerProject(items) {
  return {
    format: PICKER_FORMAT,
    version: PICKER_VERSION,
    name: "Untitled picker",
    items: validatePickerItems(items),
    settings: { mode: "one", count: 1, withReplacement: false, seeded: false, seed: "", category: "", excludedIds: [] },
    history: [],
  };
}

function chooseWeighted(items, random) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let target = random() * total;
  for (const item of items) {
    target -= item.weight;
    if (target < 0) return item;
  }
  return items.at(-1);
}

function cryptoRandom() {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure randomness is unavailable.");
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 4_294_967_296;
}

function hashSeed(seed) {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function parseCsvLine(line) {
  const values = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted && character === '"' && line[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      values.push(field);
      field = "";
    } else field += character;
  }
  if (quoted) throw new TypeError("CSV contains an unclosed quote.");
  values.push(field);
  return values;
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
