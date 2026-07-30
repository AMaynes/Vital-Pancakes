/**
 * Adaptive Review card generation, quiz construction, and FSRS scheduling.
 */

import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
} from "../vendor/ts-fsrs-5.4.1.mjs";

export const REVIEW_CARD_FORMAT = "vital-pancakes-review-card";
export const REVIEW_CARD_VERSION = 1;
export const REVIEW_SETTINGS_VERSION = 1;

const RATING_VALUES = Object.freeze({
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
});

export function defaultReviewSettings() {
  return {
    version: REVIEW_SETTINGS_VERSION,
    requestRetention: 0.9,
    maximumInterval: 36_500,
    dailyNewLimit: 20,
    enableShortTerm: true,
  };
}

export function normalizeReviewSettings(value = {}) {
  const defaults = defaultReviewSettings();
  const requestRetention = Number(value.requestRetention);
  const maximumInterval = Number(value.maximumInterval);
  const dailyNewLimit = Number(value.dailyNewLimit);
  return {
    version: REVIEW_SETTINGS_VERSION,
    requestRetention: Number.isFinite(requestRetention)
      ? clamp(requestRetention, 0.7, 0.99)
      : defaults.requestRetention,
    maximumInterval: Number.isInteger(maximumInterval)
      ? clamp(maximumInterval, 1, 100_000)
      : defaults.maximumInterval,
    dailyNewLimit: Number.isInteger(dailyNewLimit)
      ? clamp(dailyNewLimit, 1, 500)
      : defaults.dailyNewLimit,
    enableShortTerm: value.enableShortTerm === undefined
      ? defaults.enableShortTerm
      : Boolean(value.enableShortTerm),
  };
}

export function buildReviewCardsFromLesson({
  lesson,
  bookId,
  lessonId,
  now = new Date(),
}) {
  if (!lesson || typeof lesson !== "object") return [];
  const sourceTitle = cleanText(lesson.title, 500) || "Lesson";
  const sourcePages = normalizePages(lesson.sourcePages);
  const seeds = [
    ...(Array.isArray(lesson.flashcards) ? lesson.flashcards : []).map((entry, index) => ({
      sourceKey: `flashcard:${index}`,
      front: entry?.question,
      back: entry?.answer,
      kind: "flashcard",
    })),
    ...(Array.isArray(lesson.keyConcepts) ? lesson.keyConcepts : []).map((entry, index) => ({
      sourceKey: `concept:${index}`,
      front: entry?.term,
      back: entry?.explanation,
      kind: "concept",
    })),
  ];
  const seen = new Set();
  return seeds.flatMap((seed) => {
    const front = cleanText(seed.front, 20_000);
    const back = cleanText(seed.back, 100_000);
    const contentKey = normalizeKey(`${front}\u0000${back}`);
    if (!front || !back || seen.has(contentKey)) return [];
    seen.add(contentKey);
    const id = `review-${hashText(`${bookId}\u0000${lessonId}\u0000${seed.sourceKey}`)}`;
    return [validateReviewCard({
      format: REVIEW_CARD_FORMAT,
      version: REVIEW_CARD_VERSION,
      id,
      bookId,
      lessonId,
      lessonTitle: sourceTitle,
      sourceKey: seed.sourceKey,
      kind: seed.kind,
      front,
      back,
      sourcePages,
      tags: [
        lesson.sourceTitle,
        lesson.chapter,
        lesson.subchapter,
      ].filter(Boolean),
      suspended: false,
      manuallyEdited: false,
      schedule: serializeFsrsCard(createEmptyCard(now)),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })];
  });
}

export function mergeGeneratedReviewCards(existingCards, generatedCards) {
  const existing = new Map(existingCards.map((card) => {
    const normalized = validateReviewCard(card);
    return [`${normalized.lessonId}\u0000${normalized.sourceKey}`, normalized];
  }));
  const generatedKeys = new Set();
  const merged = generatedCards.map((card) => {
    const next = validateReviewCard(card);
    const key = `${next.lessonId}\u0000${next.sourceKey}`;
    generatedKeys.add(key);
    const current = existing.get(key);
    if (!current) return next;
    return validateReviewCard({
      ...next,
      id: current.id,
      front: current.manuallyEdited ? current.front : next.front,
      back: current.manuallyEdited ? current.back : next.back,
      manuallyEdited: current.manuallyEdited,
      suspended: current.suspended,
      schedule: current.schedule,
      createdAt: current.createdAt,
      updatedAt: next.updatedAt,
    });
  });
  existing.forEach((card, key) => {
    if (!generatedKeys.has(key)) merged.push(card);
  });
  return merged;
}

export function validateReviewCard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Review cards must be objects.");
  }
  const id = cleanText(value.id, 500);
  const bookId = cleanText(value.bookId, 500);
  const lessonId = cleanText(value.lessonId, 500);
  const front = cleanText(value.front, 20_000);
  const back = cleanText(value.back, 100_000);
  if (!id || !bookId || !lessonId || !front || !back) {
    throw new TypeError("Review cards need an id, book, lesson, front, and back.");
  }
  return {
    format: REVIEW_CARD_FORMAT,
    version: REVIEW_CARD_VERSION,
    id,
    bookId,
    lessonId,
    lessonTitle: cleanText(value.lessonTitle, 500) || "Lesson",
    sourceKey: cleanText(value.sourceKey, 500) || `manual:${id}`,
    kind: ["flashcard", "concept", "manual"].includes(value.kind) ? value.kind : "manual",
    front,
    back,
    sourcePages: normalizePages(value.sourcePages),
    tags: normalizeTextArray(value.tags, 100, 160),
    suspended: Boolean(value.suspended),
    manuallyEdited: Boolean(value.manuallyEdited),
    schedule: normalizeSerializedFsrsCard(value.schedule),
    createdAt: normalizeDate(value.createdAt),
    updatedAt: normalizeDate(value.updatedAt),
  };
}

export function getReviewQueue(cards, now = new Date(), settings = defaultReviewSettings()) {
  const normalizedSettings = normalizeReviewSettings(settings);
  let newCount = 0;
  return cards
    .map(validateReviewCard)
    .filter((card) => {
      if (card.suspended) return false;
      if (card.schedule.state === State.New) {
        newCount += 1;
        return newCount <= normalizedSettings.dailyNewLimit;
      }
      return new Date(card.schedule.due) <= now;
    })
    .sort((left, right) => (
      new Date(left.schedule.due) - new Date(right.schedule.due)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ));
}

export function calculateReviewStats(cards, now = new Date()) {
  const normalized = cards.map(validateReviewCard);
  return {
    total: normalized.length,
    due: normalized.filter((card) => !card.suspended && new Date(card.schedule.due) <= now).length,
    new: normalized.filter((card) => !card.suspended && card.schedule.state === State.New).length,
    learning: normalized.filter((card) => !card.suspended && [State.Learning, State.Relearning].includes(card.schedule.state)).length,
    mature: normalized.filter((card) => !card.suspended && card.schedule.state === State.Review && card.schedule.stability >= 21).length,
    suspended: normalized.filter((card) => card.suspended).length,
  };
}

export function previewReviewRatings(card, now = new Date(), settings = defaultReviewSettings()) {
  const normalized = validateReviewCard(card);
  const scheduler = createScheduler(settings);
  const preview = scheduler.repeat(deserializeFsrsCard(normalized.schedule), now);
  return Object.fromEntries(Object.entries(RATING_VALUES).map(([name, rating]) => [
    name,
    {
      due: preview[rating].card.due.toISOString(),
      interval: formatInterval(preview[rating].card.due - now),
    },
  ]));
}

export function applyReviewRating(
  card,
  ratingName,
  now = new Date(),
  settings = defaultReviewSettings(),
) {
  const normalized = validateReviewCard(card);
  const rating = RATING_VALUES[String(ratingName).toLocaleLowerCase()];
  if (!rating) throw new TypeError("Review rating must be again, hard, good, or easy.");
  const result = createScheduler(settings).next(deserializeFsrsCard(normalized.schedule), now, rating);
  const updated = validateReviewCard({
    ...normalized,
    schedule: serializeFsrsCard(result.card),
    updatedAt: now.toISOString(),
  });
  return {
    card: updated,
    log: {
      id: `review-log-${hashText(`${normalized.id}\u0000${now.toISOString()}\u0000${rating}`)}`,
      bookId: normalized.bookId,
      cardId: normalized.id,
      lessonId: normalized.lessonId,
      rating: String(ratingName).toLocaleLowerCase(),
      reviewedAt: now.toISOString(),
      previousSchedule: normalized.schedule,
      nextSchedule: updated.schedule,
      fsrsLog: serializeFsrsLog(result.log),
    },
  };
}

export function undoLastReview(cards, logs) {
  if (!logs.length) return { cards: cards.map(validateReviewCard), logs: [], undone: null };
  const ordered = logs.slice().sort((left, right) => String(left.reviewedAt).localeCompare(String(right.reviewedAt)));
  const undone = ordered.pop();
  return {
    cards: cards.map(validateReviewCard).map((card) => (
      card.id === undone.cardId
        ? validateReviewCard({ ...card, schedule: undone.previousSchedule, updatedAt: new Date().toISOString() })
        : card
    )),
    logs: ordered,
    undone,
  };
}

export function buildQuizQuestion(card, allCards, options = {}) {
  const normalized = validateReviewCard(card);
  const distractors = allCards
    .map(validateReviewCard)
    .filter((candidate) => candidate.id !== normalized.id && candidate.back !== normalized.back)
    .map((candidate) => candidate.back);
  const uniqueDistractors = [...new Set(distractors)];
  if (uniqueDistractors.length < 2) {
    return {
      cardId: normalized.id,
      question: normalized.front,
      answer: normalized.back,
      type: "free-response",
      options: [],
    };
  }
  const seeded = deterministicOrder(uniqueDistractors, `${normalized.id}:${options.seed ?? "quiz"}`);
  const choices = deterministicOrder(
    [normalized.back, ...seeded.slice(0, 3)],
    `${normalized.id}:${options.seed ?? "quiz"}:choices`,
  );
  return {
    cardId: normalized.id,
    question: normalized.front,
    answer: normalized.back,
    type: "multiple-choice",
    options: choices,
  };
}

export function serializeFsrsCard(card) {
  return {
    due: new Date(card.due).toISOString(),
    stability: Number(card.stability) || 0,
    difficulty: Number(card.difficulty) || 0,
    elapsed_days: Number(card.elapsed_days) || 0,
    scheduled_days: Number(card.scheduled_days) || 0,
    learning_steps: Number(card.learning_steps) || 0,
    reps: Number(card.reps) || 0,
    lapses: Number(card.lapses) || 0,
    state: Number(card.state) || State.New,
    last_review: card.last_review ? new Date(card.last_review).toISOString() : null,
  };
}

export function deserializeFsrsCard(value) {
  const card = normalizeSerializedFsrsCard(value);
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}

function normalizeSerializedFsrsCard(value = {}) {
  const empty = serializeFsrsCard(createEmptyCard(new Date()));
  const state = Number(value.state);
  return {
    due: normalizeDate(value.due ?? empty.due),
    stability: finiteNonnegative(value.stability),
    difficulty: finiteNonnegative(value.difficulty),
    elapsed_days: finiteNonnegative(value.elapsed_days),
    scheduled_days: finiteNonnegative(value.scheduled_days),
    learning_steps: finiteNonnegative(value.learning_steps),
    reps: Math.max(0, Math.trunc(Number(value.reps) || 0)),
    lapses: Math.max(0, Math.trunc(Number(value.lapses) || 0)),
    state: [State.New, State.Learning, State.Review, State.Relearning].includes(state)
      ? state
      : State.New,
    last_review: value.last_review ? normalizeDate(value.last_review) : null,
  };
}

function createScheduler(settings) {
  const normalized = normalizeReviewSettings(settings);
  return fsrs({
    request_retention: normalized.requestRetention,
    maximum_interval: normalized.maximumInterval,
    enable_fuzz: false,
    enable_short_term: normalized.enableShortTerm,
    learning_steps: normalized.enableShortTerm ? ["1m", "10m"] : [],
    relearning_steps: normalized.enableShortTerm ? ["10m"] : [],
  });
}

function serializeFsrsLog(log) {
  return {
    ...log,
    due: new Date(log.due).toISOString(),
    review: new Date(log.review).toISOString(),
  };
}

function deterministicOrder(values, seed) {
  return values
    .map((value, index) => ({ value, score: hashText(`${seed}\u0000${index}\u0000${value}`) }))
    .sort((left, right) => left.score.localeCompare(right.score))
    .map(({ value }) => value);
}

function formatInterval(milliseconds) {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 365) return `${days}d`;
  return `${(days / 365).toFixed(1)}y`;
}

function normalizePages(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((page) => Number.isInteger(page) && page > 0))]
    .sort((left, right) => left - right);
}

function normalizeTextArray(value, maximumItems, maximumLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => cleanText(entry, maximumLength)).filter(Boolean))]
    .slice(0, maximumItems);
}

function cleanText(value, maximumLength) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximumLength);
}

function normalizeKey(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function normalizeDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.valueOf())) throw new TypeError("Review dates must be valid.");
  return date.toISOString();
}

function finiteNonnegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function hashText(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
