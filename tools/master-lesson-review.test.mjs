import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReviewRating,
  buildQuizQuestion,
  buildReviewCardsFromLesson,
  calculateReviewStats,
  getReviewQueue,
  mergeGeneratedReviewCards,
  previewReviewRatings,
  undoLastReview,
} from "./master-lesson-review.mjs";

const now = new Date("2026-07-30T00:00:00.000Z");
const lesson = {
  title: "Cell transport",
  sourceTitle: "Biology",
  chapter: "Cells",
  sourcePages: [12, 13],
  flashcards: [
    { question: "What is diffusion?", answer: "Net movement down a concentration gradient." },
    { question: "What is osmosis?", answer: "Diffusion of water across a selectively permeable membrane." },
    { question: "What is active transport?", answer: "Movement against a gradient using energy." },
  ],
  keyConcepts: [
    { term: "Concentration gradient", explanation: "A difference in concentration across space." },
  ],
};

test("lesson output deterministically becomes unique review cards", () => {
  const cards = buildReviewCardsFromLesson({
    lesson,
    bookId: "book",
    lessonId: "lesson",
    now,
  });
  assert.equal(cards.length, 4);
  assert.equal(new Set(cards.map((card) => card.id)).size, 4);
  assert.deepEqual(cards[0].sourcePages, [12, 13]);
  assert.deepEqual(
    buildReviewCardsFromLesson({ lesson, bookId: "book", lessonId: "lesson", now }),
    cards,
  );
});

test("regeneration preserves scheduling and manual edits", () => {
  const [card] = buildReviewCardsFromLesson({ lesson, bookId: "book", lessonId: "lesson", now });
  const reviewed = applyReviewRating(card, "good", now).card;
  const edited = { ...reviewed, front: "Edited question", manuallyEdited: true };
  const changedLesson = structuredClone(lesson);
  changedLesson.flashcards[0].question = "Changed source question";
  const generated = buildReviewCardsFromLesson({
    lesson: changedLesson,
    bookId: "book",
    lessonId: "lesson",
    now,
  });
  const merged = mergeGeneratedReviewCards([edited], generated);
  assert.equal(merged[0].front, "Edited question");
  assert.equal(merged[0].schedule.reps, 1);
});

test("FSRS ratings schedule cards and expose all four previews", () => {
  const [card] = buildReviewCardsFromLesson({ lesson, bookId: "book", lessonId: "lesson", now });
  const preview = previewReviewRatings(card, now);
  assert.deepEqual(Object.keys(preview), ["again", "hard", "good", "easy"]);
  const reviewed = applyReviewRating(card, "good", now);
  assert.equal(reviewed.card.schedule.reps, 1);
  assert.ok(new Date(reviewed.card.schedule.due) > now);
  assert.equal(reviewed.log.rating, "good");
});

test("queue ordering, statistics, and review cancellation are deterministic", () => {
  const cards = buildReviewCardsFromLesson({ lesson, bookId: "book", lessonId: "lesson", now });
  const first = applyReviewRating(cards[0], "easy", now);
  const current = [first.card, ...cards.slice(1)];
  assert.equal(getReviewQueue(current, now).length, 3);
  assert.equal(calculateReviewStats(current, now).new, 3);
  const undone = undoLastReview(current, [first.log]);
  assert.equal(undone.logs.length, 0);
  assert.equal(undone.cards[0].schedule.reps, 0);
});

test("quiz generation uses stable choices and falls back to free response", () => {
  const cards = buildReviewCardsFromLesson({ lesson, bookId: "book", lessonId: "lesson", now });
  const quiz = buildQuizQuestion(cards[0], cards, { seed: "session" });
  assert.equal(quiz.type, "multiple-choice");
  assert.equal(quiz.options.includes(cards[0].back), true);
  assert.deepEqual(buildQuizQuestion(cards[0], cards, { seed: "session" }), quiz);
  assert.equal(buildQuizQuestion(cards[0], [cards[0]]).type, "free-response");
});
