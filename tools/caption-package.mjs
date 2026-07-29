/**
 * Caption Relay package schema, validation, and forward-compatible migration.
 * Imported values remain plain data and are never trusted as markup.
 */

import { MAX_CAPTION_CUES, MAX_CAPTION_FILE_BYTES } from "./caption-formats.mjs";
import { assertCapturePlaybackRate } from "./caption-timing.mjs";

export const CAPTION_PACKAGE_KIND = "vital-pancakes-caption-relay";
export const CAPTION_PACKAGE_SCHEMA_VERSION = 1;

const MAX_TEXT_LENGTH = 20_000;
const MAX_TITLE_LENGTH = 500;
const RAW_MEDIA_DATA_URI = /^data:(?:audio|video)\//i;
const RAW_MEDIA_ENCODING = /^(?:audio|video|media)\/base64$/i;
const RAW_MEDIA_CONTAINER_KEYS = new Set(["audio", "video", "media"]);
const RAW_MEDIA_PAYLOAD_KEYS = new Set([
  "base64", "blob", "buffer", "byte", "bytes", "bytearray", "chunk", "chunks",
  "data", "frame", "frames", "payload", "pcm", "sample", "samples", "stream",
]);
const RAW_MEDIA_PAYLOAD_SUFFIX = /(?:base64|blob|buffers?|bytes?|bytearray|chunks?|data|frames?|payload|samples?|streams?)$/;
const RAW_WAVEFORM_OR_SAMPLE_KEY = /(?:waveform(?:arrays?|buffers?|chunks?|data|frames?|points?|samples?|values?)?|samples?(?:arrays?|buffers?|chunks?|data|frames?|values?)?)$/;
const MEDIA_METADATA_SUFFIX = /(?:metadata|codec|format|type|version|language|samplerate|channels|duration)$/;

export function createCaptionPackage(overrides = {}) {
  return validateCaptionPackage({
    schemaVersion: CAPTION_PACKAGE_SCHEMA_VERSION,
    kind: CAPTION_PACKAGE_KIND,
    title: "",
    originalDurationMs: 0,
    capturePlaybackRate: 1,
    sourceLanguage: "en",
    createdAt: new Date().toISOString(),
    transcriptionModel: {
      id: "",
      runtime: "",
      revision: "",
      license: "",
    },
    cues: [],
    sync: {
      mode: "fingerprint",
      fingerprints: [],
      textIndexVersion: 1,
    },
    glossary: [],
    settings: {},
    ...overrides,
  });
}

export function parseCaptionPackage(text) {
  const source = String(text ?? "");
  if (new TextEncoder().encode(source).byteLength > MAX_CAPTION_FILE_BYTES) {
    throw new RangeError("Caption Relay package exceeds the 25 MB import limit.");
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new TypeError("Caption Relay package is not valid JSON.");
  }
  return validateCaptionPackage(migrateCaptionPackage(value));
}

export function serializeCaptionPackage(value) {
  return `${JSON.stringify(validateCaptionPackage(value), null, 2)}\n`;
}

export function migrateCaptionPackage(value) {
  if (!isPlainObject(value)) throw new TypeError("Caption Relay package must be an object.");
  const version = Number(value.schemaVersion ?? 0);
  if (version > CAPTION_PACKAGE_SCHEMA_VERSION) {
    throw new RangeError(`Caption Relay schema ${version} is newer than this tool supports.`);
  }
  if (version === 1) return structuredCloneSafe(value);
  if (version !== 0) throw new RangeError(`Unsupported Caption Relay schema ${version}.`);

  const migrated = structuredCloneSafe(value);
  migrated.schemaVersion = 1;
  migrated.kind = migrated.kind || CAPTION_PACKAGE_KIND;
  migrated.sourceLanguage = migrated.sourceLanguage || "en";
  migrated.capturePlaybackRate = Number(migrated.capturePlaybackRate || 1);
  migrated.cues = (migrated.cues ?? []).map((cue, index) => ({
    id: cue.id || `cue-${String(index + 1).padStart(6, "0")}`,
    startMs: cue.startMs ?? cue.start ?? 0,
    endMs: cue.endMs ?? cue.end ?? cue.startMs ?? cue.start ?? 0,
    sourceText: cue.sourceText ?? cue.text ?? "",
    translations: cue.translations ?? (cue.vi ? { vi: cue.vi } : {}),
    confidence: cue.confidence ?? null,
  }));
  migrated.sync = {
    mode: migrated.capturePlaybackRate === 1 ? "fingerprint" : "text",
    fingerprints: [],
    textIndexVersion: 1,
    ...(migrated.sync ?? {}),
  };
  migrated.glossary ??= [];
  migrated.settings ??= {};
  migrated.transcriptionModel ??= { id: "", runtime: "", revision: "", license: "" };
  migrated.createdAt ||= new Date(0).toISOString();
  return migrated;
}

export function validateCaptionPackage(value) {
  if (!isPlainObject(value)) throw new TypeError("Caption Relay package must be an object.");
  rejectRawMedia(value);
  if (value.kind !== CAPTION_PACKAGE_KIND) {
    throw new TypeError("This is not a Caption Relay package.");
  }
  if (Number(value.schemaVersion) !== CAPTION_PACKAGE_SCHEMA_VERSION) {
    throw new RangeError(`Caption Relay schema must be ${CAPTION_PACKAGE_SCHEMA_VERSION}.`);
  }
  if (typeof value.title !== "string" || value.title.length > MAX_TITLE_LENGTH) {
    throw new TypeError("Package title is invalid.");
  }
  requireInteger(value.originalDurationMs, "Original duration", { minimum: 0 });
  assertCapturePlaybackRate(value.capturePlaybackRate);
  if (value.sourceLanguage !== "en") throw new TypeError("Caption Relay currently requires English source captions.");
  if (!isValidIsoDate(value.createdAt)) throw new TypeError("Package creation date is invalid.");
  if (!isPlainObject(value.transcriptionModel)) throw new TypeError("Transcription model metadata is invalid.");
  validateCues(value.cues);
  validateSync(value.sync, value.capturePlaybackRate);
  validateGlossary(value.glossary);
  if (!isPlainObject(value.settings)) throw new TypeError("Package settings must be an object.");
  return structuredCloneSafe(value);
}

export function validateCaptionCuesPreserved(sourceCues, translatedCues, language = "vi") {
  if (!Array.isArray(sourceCues) || !Array.isArray(translatedCues)
    || sourceCues.length !== translatedCues.length) {
    throw new TypeError("Translation must retain exactly one cue for every source cue.");
  }
  sourceCues.forEach((sourceCue, index) => {
    const targetCue = translatedCues[index];
    if (sourceCue.id !== targetCue.id
      || sourceCue.startMs !== targetCue.startMs
      || sourceCue.endMs !== targetCue.endMs
      || sourceCue.sourceText !== targetCue.sourceText) {
      throw new TypeError(`Translation changed source cue ${sourceCue.id}.`);
    }
    if (!isPlainObject(targetCue.translations) || typeof targetCue.translations[language] !== "string") {
      throw new TypeError(`Translation result is missing cue ${sourceCue.id}.`);
    }
  });
  return true;
}

function validateCues(cues) {
  if (!Array.isArray(cues) || cues.length > MAX_CAPTION_CUES) {
    throw new RangeError(`Package cues must be an array with at most ${MAX_CAPTION_CUES.toLocaleString()} entries.`);
  }
  const ids = new Set();
  let previousStartMs = -1;
  cues.forEach((cue, index) => {
    if (!isPlainObject(cue)) throw new TypeError(`Cue ${index + 1} is invalid.`);
    if (typeof cue.id !== "string" || !cue.id || cue.id.length > 100 || ids.has(cue.id)) {
      throw new TypeError(`Cue ${index + 1} has an invalid or duplicate ID.`);
    }
    ids.add(cue.id);
    requireInteger(cue.startMs, `Cue ${cue.id} start`, { minimum: 0 });
    requireInteger(cue.endMs, `Cue ${cue.id} end`, { minimum: cue.startMs });
    if (cue.startMs < previousStartMs) throw new RangeError("Caption cues must be sorted by start time.");
    previousStartMs = cue.startMs;
    requireBoundedString(cue.sourceText, `Cue ${cue.id} source text`);
    if (!isPlainObject(cue.translations)) throw new TypeError(`Cue ${cue.id} translations are invalid.`);
    Object.entries(cue.translations).forEach(([language, text]) => {
      if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(language)) {
        throw new TypeError(`Cue ${cue.id} has an invalid translation language.`);
      }
      requireBoundedString(text, `Cue ${cue.id} translation`);
    });
    if (cue.confidence !== null && cue.confidence !== undefined
      && (!Number.isFinite(cue.confidence) || cue.confidence < 0 || cue.confidence > 1)) {
      throw new RangeError(`Cue ${cue.id} confidence must be null or between 0 and 1.`);
    }
  });
}

function validateSync(sync, playbackRate) {
  if (!isPlainObject(sync)) throw new TypeError("Synchronization index is invalid.");
  const allowedModes = new Set(["fingerprint", "text", "fingerprint-or-text"]);
  if (!allowedModes.has(sync.mode)) throw new TypeError("Synchronization mode is invalid.");
  if (Number(playbackRate) > 1 && sync.mode === "fingerprint") {
    throw new TypeError("Accelerated captures must use text synchronization.");
  }
  if (!Array.isArray(sync.fingerprints) || sync.fingerprints.length > 250_000) {
    throw new RangeError("Fingerprint index is invalid or too large.");
  }
  sync.fingerprints.forEach((fingerprint) => {
    if (!isPlainObject(fingerprint)) throw new TypeError("Fingerprint entry is invalid.");
    requireInteger(fingerprint.timeMs, "Fingerprint time", { minimum: 0 });
    if (typeof fingerprint.hash !== "string" || !/^[0-9a-f]{4,64}$/i.test(fingerprint.hash)) {
      throw new TypeError("Fingerprint hash is invalid.");
    }
  });
  requireInteger(sync.textIndexVersion ?? 1, "Text index version", { minimum: 1 });
}

function validateGlossary(glossary) {
  if (!Array.isArray(glossary) || glossary.length > 5_000) {
    throw new RangeError("Glossary must contain at most 5,000 entries.");
  }
  glossary.forEach((entry) => {
    if (!isPlainObject(entry)) throw new TypeError("Glossary entry is invalid.");
    requireBoundedString(entry.source, "Glossary source", 500);
    requireBoundedString(entry.target, "Glossary target", 500);
    if (!entry.source.trim()) throw new TypeError("Glossary source cannot be empty.");
  });
}

function rejectRawMedia(value, depth = 0, ancestors = []) {
  if (typeof value === "string") {
    if (RAW_MEDIA_DATA_URI.test(value.trim()) || RAW_MEDIA_ENCODING.test(value.trim())) {
      throw new TypeError("Caption Relay packages cannot contain raw movie audio or video.");
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (depth > 8) throw new TypeError("Caption Relay package nesting is too deep.");
  if (ArrayBuffer.isView(value)
    || value instanceof ArrayBuffer
    || (typeof Blob !== "undefined" && value instanceof Blob)) {
    throw new TypeError("Caption Relay packages cannot contain binary media.");
  }
  Object.entries(value).forEach(([key, child]) => {
    const normalizedKey = normalizeDataKey(key);
    if (isForbiddenRawMediaKey(normalizedKey, ancestors)) {
      throw new TypeError("Caption Relay packages cannot contain raw movie audio or video.");
    }
    rejectRawMedia(child, depth + 1, [...ancestors, normalizedKey]);
  });
}

function isForbiddenRawMediaKey(key, ancestors) {
  if (RAW_WAVEFORM_OR_SAMPLE_KEY.test(key)) return true;
  if (/^(?:raw)?(?:audio|video)(?:base64|blob|buffers?|bytes?|bytearray|chunks?|data|frames?|pcm|payload|samples?|streams?)?$/.test(key)) {
    return true;
  }
  if (/^(?:raw)?pcm(?:audio|buffers?|bytes?|chunks?|data|frames?|samples?)?$/.test(key)) {
    return true;
  }
  if (/^(?:media)(?:base64|blob|buffers?|bytes?|bytearray|chunks?|data|frames?|payload|samples?|streams?)$/.test(key)
    || /^(?:base64|blob|buffers?|bytes?|bytearray|chunks?|data|frames?|payload|samples?|streams?)(?:audio|video|media)$/.test(key)) {
    return true;
  }
  if (!MEDIA_METADATA_SUFFIX.test(key)
    && /(?:audio|video|media)/.test(key)
    && RAW_MEDIA_PAYLOAD_SUFFIX.test(key)) {
    return true;
  }
  if (!MEDIA_METADATA_SUFFIX.test(key)
    && /pcm/.test(key)
    && (RAW_MEDIA_PAYLOAD_SUFFIX.test(key)
      || /^(?:raw|captured|movie|recorded|source)?pcm$/.test(key))) {
    return true;
  }
  return RAW_MEDIA_PAYLOAD_KEYS.has(key)
    && ancestors.some(isRawMediaContainerKey);
}

function isRawMediaContainerKey(key) {
  return RAW_MEDIA_CONTAINER_KEYS.has(key)
    || /^(?:raw|captured|movie|recorded|source)+(?:audio|video|media)$/.test(key);
}

function normalizeDataKey(key) {
  return String(key).toLocaleLowerCase("en").replace(/[^a-z0-9]/g, "");
}

function requireInteger(value, label, { minimum = Number.MIN_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be an integer of at least ${minimum}.`);
  }
}

function requireBoundedString(value, label, maximum = MAX_TEXT_LENGTH) {
  if (typeof value !== "string" || value.length > maximum) {
    throw new TypeError(`${label} must be a string no longer than ${maximum.toLocaleString()} characters.`);
  }
}

function isValidIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
