/**
 * Converts approved lessons into the backward-compatible Studies entry shape.
 */

import { createEmptyLesson } from "./master-lesson-validation.mjs";

export function lessonToStudyEntry({ lesson, bookId, lessonId, copy = false }) {
  const normalized = createEmptyLesson(lesson);
  const tags = [
    normalized.sourceTitle,
    normalized.chapter,
    normalized.subchapter,
    "generated lesson",
  ].filter(Boolean);
  return {
    format: "lesson",
    title: normalized.title,
    summary: normalized.overview || normalized.recap,
    lesson: normalized,
    sourceBookId: String(bookId ?? ""),
    sourceLessonId: copy ? `${lessonId}:copy:${Date.now()}` : String(lessonId ?? ""),
    sourceTitle: normalized.sourceTitle,
    sourcePages: normalized.sourcePages,
    tags: [...new Set(tags)],
  };
}

export function findSavedLesson(studiesSection, bookId, lessonId) {
  if (!Array.isArray(studiesSection?.items)) return null;
  return studiesSection.items.find((item) => (
    item.format === "lesson"
    && item.sourceBookId === bookId
    && item.sourceLessonId === lessonId
  )) ?? null;
}
