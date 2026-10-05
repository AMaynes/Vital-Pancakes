/** Keeps existing subject practice views attached to canonical card IDs. */
import { initializeDatabase, getDatabase, saveDatabase } from "./database-store.mjs";
import { importNotecards, clone, reviewNotecard } from "./database-model.mjs";

export function projectSubjectCards(db, subject, source) {
  const result = clone(source);
  const visit = (node, path) => {
    if (Array.isArray(node)) return node.map((item, index) => {
      if (typeof item?.question === "string" && typeof item.answer === "string") {
        const card = db.entries[`notecard:${subject}:${path}:${index}`];
        return card ? { ...item, question: card.data.front, answer: card.data.back, vpCardId: card.id } : null;
      }
      return visit(item, `${path}/${index}`);
    }).filter(item => item !== null);
    if (!node || typeof node !== "object") return node;
    for (const [key, value] of Object.entries(node)) if (value && typeof value === "object") node[key] = visit(value, `${path}/${key}`);
    return node;
  };
  return visit(result, "");
}

export async function loadCanonicalSubject(subject, source) {
  await initializeDatabase();
  if (!getDatabase().migrations[`notecards:${subject}`]) await saveDatabase(importNotecards(getDatabase(), subject, source));
  return projectSubjectCards(getDatabase(), subject, source);
}

export async function savePracticeState(subject, fields) {
  await initializeDatabase(); const db = getDatabase(); const id = `card-practice:${subject}`;
  const folderId = `cards-folder:${subject}`;
  db.folders[folderId] ??= { id: folderId, parentId: "notecards", title: subject, storage: "inherit" };
  db.entries[id] = { id, parentId: folderId, title: `${subject} practice progress`, type: "practice-state", storage: db.entries[id]?.storage ?? "inherit", content: [], data: { ...db.entries[id]?.data, ...clone(fields) } };
  await saveDatabase(db);
}
export async function loadPracticeState(subject) {
  await initializeDatabase();
  const existing = getDatabase().entries[`card-practice:${subject}`]?.data;
  if (existing) return existing;
  const slug = subject.toLowerCase(); const fields = {};
  for (const [field, suffix, legacy] of [["wrongQueue", "wrong-queue", "flashcard_wrong_queue"], ["pendingReviews", "pending-reviews", "flashcard_pending_reviews"], ["quizStats", "quiz-stats", "flashcard_quiz_daily_stats"]]) {
    try { const raw = localStorage.getItem(`vp-cards-${slug}-${suffix}`) ?? localStorage.getItem(legacy); if (raw) fields[field] = JSON.parse(raw); }
    catch { /* Invalid legacy data remains untouched in the recovery cache. */ }
  }
  if (!Object.keys(fields).length) return null;
  await savePracticeState(subject, fields); return fields;
}
export async function recordPracticeReview(subject, card, remembered) {
  if (!card) return;
  await initializeDatabase(); const db = getDatabase();
  const id = card.vpCardId ?? (card.isGenerated ? `notecard:${subject}:generated:${card.generatorKey}:${card.seed}` : null);
  if (!id) return;
  if (!db.entries[id]) {
    if (!card.isGenerated) return;
    const folderId = `cards-generated:${subject}`;
    db.folders[folderId] ??= { id: folderId, parentId: `cards-folder:${subject}`, title: "Generated practice", storage: "inherit" };
    db.entries[id] = { id, parentId: folderId, title: card.question, type: "notecard", content: [], storage: "inherit", data: { front: card.question, back: card.answer, generatorKey: card.generatorKey, seed: card.seed } };
  }
  reviewNotecard(db, id, remembered);
  await saveDatabase(db);
}
