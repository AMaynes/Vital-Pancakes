/**
 * Pure state, recurrence, tracker, inventory, validation, and encryption
 * policies for Overhead.
 */

export const OVERHEAD_FORMAT = "vital-pancakes-overhead";
export const OVERHEAD_VERSION = 1;
export const FOREGROUND_LIMIT = 5;

export const TRACKER_TEMPLATES = Object.freeze([
  ["self-care", "Self care", "boolean", "daily"],
  ["medication", "Medication log", "boolean", "daily"],
  ["vehicle", "Vehicle maintenance", "measurement", "interval"],
  ["chores", "House chores", "boolean", "weekly"],
  ["pet-care", "Pet care", "boolean", "daily"],
  ["bills", "Bills", "boolean", "monthly"],
  ["filters", "Filter replacement", "boolean", "interval"],
  ["warranties", "Warranty review", "free-text", "custom"],
]);

export function emptyOverheadState(now = new Date()) {
  return {
    format: OVERHEAD_FORMAT,
    version: OVERHEAD_VERSION,
    updatedAt: now.toISOString(),
    inbox: [],
    forefront: [],
    lists: [{ id: "list-inbox", name: "General", order: 0 }],
    tasks: [],
    notes: [],
    trackers: [],
    inventory: [],
    privateSections: [],
  };
}

export function validateOverheadState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Overhead data must be an object.");
  }
  if (value.format !== OVERHEAD_FORMAT) throw new TypeError("This is not an Overhead backup.");
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > OVERHEAD_VERSION) {
    throw new TypeError(`Unsupported Overhead version: ${value.version}.`);
  }
  const requiredArrays = [
    "inbox", "forefront", "lists", "tasks", "notes", "trackers", "inventory", "privateSections",
  ];
  requiredArrays.forEach((key) => {
    if (!Array.isArray(value[key])) throw new TypeError(`Overhead ${key} must be an array.`);
  });
  ensureUniqueIds(value);
  return migrateOverheadState(value);
}

export function migrateOverheadState(value) {
  const migrated = structuredCloneSafe(value);
  migrated.format = OVERHEAD_FORMAT;
  migrated.version = OVERHEAD_VERSION;
  migrated.updatedAt ||= new Date().toISOString();
  migrated.notes ||= [];
  migrated.privateSections ||= [];
  return migrated;
}

export function classifyDueDate(dueDate, now = new Date()) {
  if (!dueDate) return "unscheduled";
  const due = localDate(dueDate);
  if (!due) return "invalid";
  const today = startOfDay(now);
  if (due < today) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  const endUpcoming = new Date(today);
  endUpcoming.setDate(endUpcoming.getDate() + 7);
  return due <= endUpcoming ? "upcoming" : "later";
}

export function nextOccurrence(dateValue, recurrence, options = {}) {
  const date = localDate(dateValue);
  if (!date || !recurrence || recurrence === "none") return null;
  const next = new Date(date);
  if (recurrence === "daily") next.setDate(next.getDate() + 1);
  else if (recurrence === "weekly") next.setDate(next.getDate() + 7);
  else if (recurrence === "monthly") addCalendarMonthsClamped(next, 1);
  else if (recurrence === "yearly") addCalendarYearsClamped(next, 1);
  else if (recurrence === "interval") {
    const intervalDays = Math.max(1, Math.trunc(Number(options.intervalDays) || 1));
    next.setDate(next.getDate() + intervalDays);
  } else if (recurrence.startsWith("weekdays:")) {
    const days = recurrence
      .slice("weekdays:".length)
      .split(",")
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    if (!days.length) return null;
    do next.setDate(next.getDate() + 1);
    while (!days.includes(next.getDay()));
  } else {
    return null;
  }
  return toLocalDateString(next);
}

function addCalendarMonthsClamped(date, months) {
  const desiredDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(desiredDay, lastDay));
}

function addCalendarYearsClamped(date, years) {
  const desiredMonth = date.getMonth();
  const desiredDay = date.getDate();
  date.setDate(1);
  date.setFullYear(date.getFullYear() + years);
  date.setMonth(desiredMonth);
  const lastDay = new Date(date.getFullYear(), desiredMonth + 1, 0).getDate();
  date.setDate(Math.min(desiredDay, lastDay));
}

export function completeTask(task, completedAt = new Date()) {
  const history = [...(task.completionHistory ?? []), completedAt.toISOString()];
  const nextDueDate = nextOccurrence(task.dueDate || toLocalDateString(completedAt), task.recurrence, task);
  if (nextDueDate) {
    return { ...task, completionHistory: history, dueDate: nextDueDate, completed: false };
  }
  return { ...task, completionHistory: history, completed: true, completedAt: completedAt.toISOString() };
}

export function calculateTrackerSummary(tracker, now = new Date()) {
  const history = [...(tracker.history ?? [])]
    .filter((entry) => entry?.at)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const scheduledDates = getScheduleDates(tracker, now, 120);
  const completedDates = new Set(history.map((entry) => toLocalDateString(new Date(entry.at))));
  const today = toLocalDateString(now);
  const dueDates = scheduledDates.filter((date) => date <= today);
  const missed = dueDates.filter((date) => !completedDates.has(date));
  let streak = 0;
  for (let index = dueDates.length - 1; index >= 0; index -= 1) {
    if (!completedDates.has(dueDates[index])) break;
    streak += 1;
  }
  const recent = dueDates.slice(-30);
  const recentCompleted = recent.filter((date) => completedDates.has(date)).length;
  return {
    streak,
    completed: history.length,
    missed: missed.length,
    progress: recent.length ? recentCompleted / recent.length : 0,
    dueToday: scheduledDates.includes(today) && !completedDates.has(today),
  };
}

export function getScheduleDates(tracker, now = new Date(), lookbackDays = 60) {
  const start = tracker.startedAt ? localDate(tracker.startedAt) : new Date(now);
  const first = startOfDay(start || now);
  const lower = new Date(now);
  lower.setDate(lower.getDate() - lookbackDays);
  const dates = [];
  const cursor = first < lower ? startOfDay(lower) : first;
  const end = startOfDay(now);

  while (cursor <= end) {
    const day = cursor.getDay();
    const date = toLocalDateString(cursor);
    const cadence = tracker.schedule || "daily";
    let include = cadence === "daily";
    if (cadence === "weekly") include = day === Number(tracker.weekday ?? first.getDay());
    if (cadence === "monthly") include = cursor.getDate() === Number(tracker.monthday ?? first.getDate());
    if (cadence === "interval") {
      const days = Math.floor((cursor - first) / 86_400_000);
      include = days >= 0 && days % Math.max(1, Number(tracker.intervalDays) || 1) === 0;
    }
    if (cadence === "custom") {
      const weekdays = tracker.weekdays ?? [];
      include = weekdays.includes(day);
    }
    if (include) dates.push(date);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function getInventoryWarning(item, now = new Date(), expiringDays = 14) {
  const quantity = Number(item.quantity) || 0;
  const minimum = Number(item.minimum) || 0;
  const lowStock = quantity <= minimum;
  let daysUntilExpiration = null;
  if (item.expirationDate) {
    const expiration = localDate(item.expirationDate);
    if (expiration) daysUntilExpiration = Math.ceil((expiration - startOfDay(now)) / 86_400_000);
  }
  return {
    lowStock,
    expired: daysUntilExpiration !== null && daysUntilExpiration < 0,
    expiringSoon: daysUntilExpiration !== null && daysUntilExpiration >= 0 && daysUntilExpiration <= expiringDays,
    daysUntilExpiration,
    needsAttention: lowStock || (daysUntilExpiration !== null && daysUntilExpiration <= expiringDays),
  };
}

export async function encryptPrivatePayload(payload, password, options = {}) {
  if (!password) throw new TypeError("A password is required.");
  const webCrypto = getWebCrypto();
  const iterations = options.iterations ?? 250_000;
  const salt = webCrypto.getRandomValues(new Uint8Array(16));
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(password, salt, iterations, ["encrypt"]);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await webCrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    version: 1,
    algorithm: "AES-GCM",
    derivation: "PBKDF2-SHA-256",
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptPrivatePayload(envelope, password) {
  validateEncryptionEnvelope(envelope);
  const webCrypto = getWebCrypto();
  try {
    const key = await deriveEncryptionKey(
      password,
      base64ToBytes(envelope.salt),
      envelope.iterations,
      ["decrypt"],
    );
    const plaintext = await webCrypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
      key,
      base64ToBytes(envelope.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("The password is incorrect or this encrypted section is damaged.");
  }
}

export function validateEncryptionEnvelope(envelope) {
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== "AES-GCM") {
    throw new TypeError("Unsupported encrypted section.");
  }
  if (!Number.isInteger(envelope.iterations) || envelope.iterations < 100_000) {
    throw new TypeError("The encrypted section uses an unsafe or invalid key-derivation count.");
  }
  ["salt", "iv", "ciphertext"].forEach((key) => {
    if (typeof envelope[key] !== "string" || !envelope[key]) {
      throw new TypeError(`Encrypted section ${key} is missing.`);
    }
  });
  return envelope;
}

function ensureUniqueIds(state) {
  const ids = new Set();
  ["inbox", "forefront", "lists", "tasks", "notes", "trackers", "inventory", "privateSections"]
    .forEach((key) => state[key].forEach((record) => {
      if (!record || typeof record.id !== "string" || !record.id) {
        throw new TypeError(`Every ${key} record needs an id.`);
      }
      if (ids.has(record.id)) throw new TypeError(`Duplicate Overhead id: ${record.id}.`);
      ids.add(record.id);
    }));
}

async function deriveEncryptionKey(password, salt, iterations, usages) {
  const webCrypto = getWebCrypto();
  const material = await webCrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return webCrypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

function getWebCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable in this browser.");
  return globalThis.crypto;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function localDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function toLocalDateString(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
