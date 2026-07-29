/**
 * Local translation queue policy and glossary handling. Browser adapters are
 * injected so cue preservation can be tested without model dependencies.
 */

import { validateCaptionCuesPreserved } from "./caption-package.mjs";

export const TRANSLATION_STATES = Object.freeze([
  "idle", "running", "paused", "complete", "error",
]);

const UNICODE_TOKEN_CHARACTER = /[\p{L}\p{N}\p{M}_]/u;
const UNICODE_TOKEN_CHARACTER_CLASS = "[\\p{L}\\p{N}\\p{M}_]";
const PROPER_NAME_WORD = "\\p{Lu}[\\p{L}\\p{M}]*(?:['’][\\p{L}\\p{M}]+)?";

export function applyGlossary(text, glossary, {
  direction = "source-to-target",
  caseSensitive = false,
} = {}) {
  const entries = preparePhraseEntries(
    (Array.isArray(glossary) ? glossary : []).map((entry) => ({
      source: direction === "source-to-target" ? entry?.source : entry?.target,
      target: direction === "source-to-target" ? entry?.target : entry?.source,
    })),
    { caseSensitive },
  );
  if (!entries.length) return String(text ?? "");
  const entriesBySource = new Map(
    entries.map((entry) => [phraseLookupKey(entry.source, caseSensitive), entry]),
  );
  return String(text ?? "").replace(
    createPhraseExpression(entries, { caseSensitive }),
    (match) => String(entriesBySource.get(phraseLookupKey(match, caseSensitive))?.target ?? match),
  );
}

export function searchAndReplaceTranslations(cues, search, replacement, {
  language = "vi",
  caseSensitive = false,
} = {}) {
  const needle = String(search ?? "");
  if (!needle) return Array.isArray(cues) ? cues.map(cloneCue) : [];
  const expression = new RegExp(escapeRegExp(needle), caseSensitive ? "g" : "gi");
  return cues.map((cue) => ({
    ...cloneCue(cue),
    translations: {
      ...cue.translations,
      [language]: String(cue.translations?.[language] ?? "").replace(
        expression,
        () => String(replacement ?? ""),
      ),
    },
  }));
}

export function prepareSubtitleTextForTranslation(text) {
  const source = String(text ?? "");
  const speaker = source.match(/^\s*((?:[-–—]\s*)|(?:\[[^\]]+\]\s*)|(?:[A-Z][A-Z .'-]{1,30}:\s*))/)?.[0] ?? "";
  const trailing = source.match(/([.!?…]+)\s*$/)?.[1] ?? "";
  const core = source.slice(speaker.length, trailing ? -trailing.length : undefined).trim();
  return { speaker, trailing, core };
}

export function restoreSubtitleAffixes(translatedText, affixes) {
  const core = String(translatedText ?? "").trim();
  const speaker = String(affixes?.speaker ?? "");
  const trailing = String(affixes?.trailing ?? "");
  const withoutDuplicatePunctuation = trailing && core.endsWith(trailing)
    ? core.slice(0, -trailing.length)
    : core;
  return `${speaker}${withoutDuplicatePunctuation}${trailing}`.trim();
}

export async function translateCaptionCues(sourceCues, translateText, {
  language = "vi",
  glossary = [],
  shouldPause = () => false,
  waitUntilResumed = async () => {},
  onProgress = () => {},
  previousCues = sourceCues,
  retryFailedOnly = false,
  shouldAbort = () => false,
  onCue = () => {},
} = {}) {
  if (!Array.isArray(sourceCues) || typeof translateText !== "function") {
    throw new TypeError("Translation requires cues and a text translator.");
  }
  const output = sourceCues.map((sourceCue, index) => {
    const prior = previousCues?.[index];
    return {
      ...cloneCue(sourceCue),
      translations: { ...sourceCue.translations, ...prior?.translations },
      translationStatus: prior?.translationStatus,
      translationError: prior?.translationError,
    };
  });
  for (const [index, sourceCue] of sourceCues.entries()) {
    throwIfTranslationAborted(shouldAbort);
    const targetCue = output[index];
    if (retryFailedOnly && targetCue.translationStatus !== "failed") continue;
    if (!retryFailedOnly && targetCue.translations?.[language] && targetCue.translationStatus !== "failed") {
      onProgress({ completed: index + 1, total: sourceCues.length, cueId: sourceCue.id });
      continue;
    }
    if (shouldPause()) await waitUntilResumed();
    const affixes = prepareSubtitleTextForTranslation(sourceCue.sourceText);
    try {
      const translated = affixes.core
        ? await translateTextWithGlossarySegments(
          affixes.core,
          glossary,
          (segment) => translateText(segment, sourceCue),
        )
        : "";
      targetCue.translations[language] = requireNonEmptyTranslationResult(
        sourceCue.sourceText,
        applyGlossary(
          restoreSubtitleAffixes(translated, affixes),
          glossary,
        ),
      );
      throwIfTranslationAborted(shouldAbort);
      targetCue.translationStatus = "translated";
      delete targetCue.translationError;
    } catch (error) {
      if (error?.name === "AbortError" || shouldAbort()) throw error;
      targetCue.translations[language] ??= "";
      targetCue.translationStatus = "failed";
      targetCue.translationError = String(error?.message ?? "Translation failed.").slice(0, 500);
    }
    onCue({ cue: cloneCue(targetCue), index });
    onProgress({ completed: index + 1, total: sourceCues.length, cueId: sourceCue.id });
  }
  validateCaptionCuesPreserved(sourceCues, output, language);
  return output;
}

export async function regenerateCaptionCue(sourceCue, translateText, options = {}) {
  if (!sourceCue || typeof sourceCue !== "object" || Array.isArray(sourceCue)) {
    throw new TypeError("Caption regeneration requires one source cue.");
  }
  const previousCue = {
    ...cloneCue(sourceCue),
    translationStatus: "failed",
  };
  const [regeneratedCue] = await translateCaptionCues(
    [sourceCue],
    translateText,
    {
      ...options,
      previousCues: [previousCue],
      retryFailedOnly: true,
    },
  );
  return regeneratedCue;
}

export function requireNonEmptyTranslationResult(sourceText, translatedText) {
  const output = String(translatedText ?? "");
  if (String(sourceText ?? "").trim() && !output.trim()) {
    throw new Error("Translation returned no text.");
  }
  return output;
}

function throwIfTranslationAborted(shouldAbort) {
  if (!shouldAbort()) return;
  const error = new Error("Translation was cancelled.");
  error.name = "AbortError";
  throw error;
}

export async function translateTextWithGlossarySegments(text, glossary, translateText) {
  if (typeof translateText !== "function") throw new TypeError("A translation function is required.");
  const source = String(text ?? "");
  const glossaryEntries = (Array.isArray(glossary) ? glossary : [])
    .filter((entry) => (
      String(entry?.source ?? "").trim()
      && String(entry?.target ?? "").trim()
    ))
    .map((entry) => ({ source: String(entry.source), target: String(entry.target ?? "") }));
  const glossarySources = new Set(
    glossaryEntries.map((entry) => phraseLookupKey(entry.source, false)),
  );
  const protectedNames = findLikelyProperNames(source)
    .filter((name) => !glossarySources.has(phraseLookupKey(name, false)))
    .map((name) => ({ source: name, target: name }));
  const entries = preparePhraseEntries(
    [...glossaryEntries, ...protectedNames],
    { caseSensitive: false },
  );
  const translateSegment = async (segment) => (
    /[\p{L}\p{N}]/u.test(segment)
      ? requireNonEmptyTranslationResult(segment, await translateText(segment))
      : segment
  );
  if (!entries.length) return translateSegment(source);
  const expression = createPhraseExpression(entries, { caseSensitive: false });
  const entriesBySource = new Map(
    entries.map((entry) => [phraseLookupKey(entry.source, false), entry]),
  );
  const parts = [];
  let cursor = 0;
  for (const match of source.matchAll(expression)) {
    if (match.index > cursor) {
      const segment = source.slice(cursor, match.index);
      parts.push(await translateSegment(segment));
    }
    const glossaryEntry = entriesBySource.get(phraseLookupKey(match[0], false));
    parts.push(String(glossaryEntry?.target ?? match[0]));
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) {
    const segment = source.slice(cursor);
    parts.push(await translateSegment(segment));
  }
  return requireNonEmptyTranslationResult(
    source,
    parts.join(" ").replace(/\s+([,.;!?…])/g, "$1").replace(/\s+/g, " ").trim(),
  );
}

export function findLikelyProperNames(text) {
  const source = String(text ?? "");
  const candidates = [];
  const expression = new RegExp(
    `(?<!${UNICODE_TOKEN_CHARACTER_CLASS})${PROPER_NAME_WORD}(?:\\s+${PROPER_NAME_WORD}){0,3}(?!${UNICODE_TOKEN_CHARACTER_CLASS})`,
    "gu",
  );
  const sentenceStarters = new Set([
    "a", "an", "are", "ask", "can", "come", "could", "did", "do", "find",
    "good", "great", "he", "hello", "how", "i", "is", "it", "let", "listen", "look", "meet", "no",
    "okay", "please", "she", "tell", "thank", "that", "the", "they", "this",
    "was", "we", "welcome", "were", "what", "when", "where", "who", "why", "will",
    "would", "yes", "you",
  ]);
  for (const match of source.matchAll(expression)) {
    let value = match[0];
    let start = match.index ?? 0;
    let droppedSentenceStarter = false;
    const words = value.split(/\s+/);
    const prefix = source.slice(0, start);
    const atSentenceStart = !prefix.trim() || /[.!?…]\s*$/u.test(prefix);
    if (atSentenceStart && words.length > 1
      && sentenceStarters.has(words[0].toLocaleLowerCase("en"))) {
      start += words[0].length + 1;
      value = words.slice(1).join(" ");
      droppedSentenceStarter = true;
    }
    const nextCharacter = source[start + value.length] ?? "";
    const singleWord = !value.includes(" ");
    if (singleWord && value.length < 2) continue;
    if (singleWord && sentenceStarters.has(value.toLocaleLowerCase("en"))) continue;
    if (singleWord && atSentenceStart && !droppedSentenceStarter) {
      const occurrences = source.match(createPhraseExpression(
        [{ source: value }],
        { caseSensitive: true },
      ))?.length ?? 0;
      if (!/[,;:]/.test(nextCharacter)
        && occurrences < 2
        && value !== value.toLocaleUpperCase()) continue;
    }
    candidates.push(value);
  }
  return [...new Map(
    candidates.map((value) => [phraseLookupKey(value, false), value]),
  ).values()];
}

export function countTranslationProgress(cues, language = "vi") {
  const total = Array.isArray(cues) ? cues.length : 0;
  const failed = cues.filter((cue) => cue.translationStatus === "failed").length;
  const completed = cues.filter((cue) => (
    cue.translationStatus === "translated" && typeof cue.translations?.[language] === "string"
  )).length;
  return { total, completed, failed, pending: Math.max(0, total - completed - failed) };
}

function cloneCue(cue) {
  return { ...cue, translations: { ...(cue?.translations ?? {}) } };
}

function preparePhraseEntries(entries, { caseSensitive }) {
  const uniqueEntries = new Map();
  for (const entry of entries) {
    const source = String(entry?.source ?? "");
    const target = String(entry?.target ?? "");
    if (!source.trim() || !target.trim()) continue;
    const key = phraseLookupKey(source, caseSensitive);
    if (!uniqueEntries.has(key)) {
      uniqueEntries.set(key, {
        source,
        target,
      });
    }
  }
  return [...uniqueEntries.values()].sort(
    (left, right) => Array.from(right.source).length - Array.from(left.source).length,
  );
}

function createPhraseExpression(entries, { caseSensitive }) {
  const alternatives = entries.map((entry) => {
    const source = String(entry.source);
    const characters = Array.from(source);
    const leadingBoundary = UNICODE_TOKEN_CHARACTER.test(characters[0] ?? "")
      ? `(?<!${UNICODE_TOKEN_CHARACTER_CLASS})`
      : "";
    const trailingBoundary = UNICODE_TOKEN_CHARACTER.test(characters.at(-1) ?? "")
      ? `(?!${UNICODE_TOKEN_CHARACTER_CLASS})`
      : "";
    return `${leadingBoundary}${escapeRegExp(source)}${trailingBoundary}`;
  });
  return new RegExp(alternatives.join("|"), `${caseSensitive ? "" : "i"}gu`);
}

function phraseLookupKey(value, caseSensitive) {
  const normalized = String(value).normalize("NFC");
  return caseSensitive ? normalized : normalized.toLocaleLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
