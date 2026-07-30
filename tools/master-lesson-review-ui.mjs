/**
 * Browser workflow for Adaptive Review Studio.
 */

import {
  getBookRecords,
  getLesson,
  putBookRecords,
  replaceBookRecords,
} from "./master-lesson-db.mjs";
import {
  applyReviewRating,
  buildQuizQuestion,
  buildReviewCardsFromLesson,
  calculateReviewStats,
  defaultReviewSettings,
  getReviewQueue,
  mergeGeneratedReviewCards,
  normalizeReviewSettings,
  previewReviewRatings,
  undoLastReview,
  validateReviewCard,
} from "./master-lesson-review.mjs";

export function createAdaptiveReviewStudio(options) {
  const elements = Object.fromEntries([
    "review-sync-selected", "review-sync-book", "review-stats",
    "review-mode-flashcards", "review-mode-quiz", "review-undo", "review-queue",
    "review-card-stage", "review-settings-form", "review-retention", "review-new-limit",
    "review-short-term", "review-all-cards", "review-history", "review-editor-dialog",
    "review-editor-form", "review-editor-id", "review-editor-front", "review-editor-back",
    "review-editor-close", "review-editor-cancel",
  ].map((id) => [id, document.getElementById(id)]));
  let bookId = null;
  let cards = [];
  let logs = [];
  let settings = defaultReviewSettings();
  let mode = "flashcard";
  let currentCardId = null;
  let answerShown = false;
  let selectedQuizOption = null;

  function bindEvents() {
    elements["review-sync-selected"].addEventListener("click", syncSelectedLesson);
    elements["review-sync-book"].addEventListener("click", syncWholeBook);
    elements["review-mode-flashcards"].addEventListener("click", () => setMode("flashcard"));
    elements["review-mode-quiz"].addEventListener("click", () => setMode("quiz"));
    elements["review-undo"].addEventListener("click", undoReview);
    elements["review-settings-form"].addEventListener("submit", saveSettings);
    elements["review-editor-form"].addEventListener("submit", saveCardEdit);
    elements["review-editor-close"].addEventListener("click", closeEditor);
    elements["review-editor-cancel"].addEventListener("click", closeEditor);
  }

  async function loadBook(nextBookId) {
    bookId = nextBookId;
    const [savedCards, savedLogs, savedSettings] = await Promise.all([
      getBookRecords("reviewCards", bookId),
      getBookRecords("reviewLogs", bookId),
      getBookRecords("reviewSettings", bookId),
    ]);
    cards = savedCards.flatMap((card) => {
      try {
        return [validateReviewCard(card)];
      } catch {
        return [];
      }
    });
    logs = savedLogs
      .filter((log) => log && typeof log.id === "string" && typeof log.cardId === "string")
      .sort((left, right) => String(left.reviewedAt).localeCompare(String(right.reviewedAt)));
    settings = normalizeReviewSettings(savedSettings[0] ?? defaultReviewSettings());
    currentCardId = getReviewQueue(cards, new Date(), settings)[0]?.id ?? null;
    answerShown = false;
    selectedQuizOption = null;
    render();
  }

  function clear() {
    bookId = null;
    cards = [];
    logs = [];
    settings = defaultReviewSettings();
    currentCardId = null;
    answerShown = false;
    selectedQuizOption = null;
    render();
  }

  function getSnapshot() {
    return {
      cards: structuredClone(cards),
      logs: structuredClone(logs),
      settings: structuredClone(settings),
      mode,
    };
  }

  async function commitSnapshot(snapshot) {
    if (!bookId) throw new Error("Open a lesson book before changing adaptive review.");
    cards = (Array.isArray(snapshot.cards) ? snapshot.cards : []).map(validateReviewCard);
    logs = Array.isArray(snapshot.logs) ? structuredClone(snapshot.logs) : [];
    settings = normalizeReviewSettings(snapshot.settings);
    mode = snapshot.mode === "quiz" ? "quiz" : "flashcard";
    await Promise.all([
      persistCards(),
      replaceBookRecords("reviewLogs", bookId, logs),
      persistSettings(),
    ]);
    currentCardId = getReviewQueue(cards, new Date(), settings)[0]?.id ?? null;
    render();
  }

  async function syncSelectedLesson() {
    const book = options.getActiveBook();
    if (!book?.selectedNodeId) return;
    const node = book.outline.nodes.find((candidate) => candidate.id === book.selectedNodeId);
    if (node?.kind !== "lesson") return options.showToast("Select a generated lesson first.", true);
    options.captureActiveLesson();
    const lesson = options.getActiveLesson() ?? await getLesson(book.id, node.id);
    if (!lesson) return options.showToast("Generate or write this lesson before creating review cards.", true);
    const generated = buildReviewCardsFromLesson({
      lesson,
      bookId: book.id,
      lessonId: node.id,
    });
    if (!generated.length) {
      return options.showToast("Add flashcards or key concepts to this lesson first.", true);
    }
    cards = mergeGeneratedReviewCards(cards, generated);
    await persistCards();
    currentCardId = getReviewQueue(cards, new Date(), settings)[0]?.id ?? currentCardId;
    render();
    options.showToast(`Synced ${generated.length} review card${generated.length === 1 ? "" : "s"}.`);
  }

  async function syncWholeBook() {
    const book = options.getActiveBook();
    if (!book) return;
    options.captureActiveLesson();
    const generated = [];
    for (const node of book.outline.nodes.filter((candidate) => candidate.kind === "lesson")) {
      const lesson = node.id === book.selectedNodeId && options.getActiveLesson()
        ? options.getActiveLesson()
        : await getLesson(book.id, node.id);
      if (!lesson) continue;
      generated.push(...buildReviewCardsFromLesson({
        lesson,
        bookId: book.id,
        lessonId: node.id,
      }));
    }
    if (!generated.length) {
      return options.showToast("No generated flashcards or key concepts were found in this book.", true);
    }
    cards = mergeGeneratedReviewCards(cards, generated);
    await persistCards();
    currentCardId = getReviewQueue(cards, new Date(), settings)[0]?.id ?? currentCardId;
    render();
    options.showToast(`Synced ${generated.length} cards across this book.`);
  }

  function render() {
    if (!elements["review-stats"]) return;
    const stats = calculateReviewStats(cards);
    elements["review-stats"].replaceChildren();
    [
      ["Due", stats.due],
      ["New", stats.new],
      ["Learning", stats.learning],
      ["Mature", stats.mature],
      ["Suspended", stats.suspended],
      ["Total", stats.total],
    ].forEach(([label, value]) => {
      const item = element("div", "lesson-review-stat");
      item.append(element("strong", "", String(value)), element("span", "", label));
      elements["review-stats"].append(item);
    });
    elements["review-sync-selected"].disabled = !options.getActiveLesson();
    elements["review-sync-book"].disabled = !bookId;
    elements["review-mode-flashcards"].setAttribute("aria-pressed", String(mode === "flashcard"));
    elements["review-mode-quiz"].setAttribute("aria-pressed", String(mode === "quiz"));
    elements["review-retention"].value = String(settings.requestRetention);
    elements["review-new-limit"].value = String(settings.dailyNewLimit);
    elements["review-short-term"].checked = settings.enableShortTerm;
    renderQueue();
    renderStage();
    renderLibrary();
    renderHistory();
  }

  function renderQueue() {
    const queue = getReviewQueue(cards, new Date(), settings);
    if (!queue.some((card) => card.id === currentCardId)) currentCardId = queue[0]?.id ?? null;
    elements["review-queue"].replaceChildren();
    elements["review-undo"].disabled = !logs.length;
    if (!queue.length) {
      elements["review-queue"].append(element(
        "p",
        "lesson-empty-copy",
        cards.length ? "Nothing is due. The next review will appear on schedule." : "No review cards yet.",
      ));
      return;
    }
    queue.forEach((card) => {
      const button = element(
        "button",
        `lesson-review-queue-item${card.id === currentCardId ? " is-current" : ""}`,
      );
      button.type = "button";
      button.append(
        element("strong", "", card.front),
        element("span", "", `${card.lessonTitle} · ${formatDue(card.schedule.due)}`),
      );
      button.addEventListener("click", () => {
        currentCardId = card.id;
        answerShown = false;
        selectedQuizOption = null;
        render();
      });
      elements["review-queue"].append(button);
    });
  }

  function renderStage() {
    const stage = elements["review-card-stage"];
    stage.replaceChildren();
    const queue = getReviewQueue(cards, new Date(), settings);
    const card = queue.find((candidate) => candidate.id === currentCardId);
    if (!card) {
      stage.append(element(
        "p",
        "lesson-empty-copy",
        cards.length ? "Review queue complete for now." : "Sync a lesson to generate local FSRS review cards.",
      ));
      return;
    }
    const article = element("article", "lesson-review-card");
    const meta = element("div", "lesson-review-card-meta");
    meta.append(
      element("span", "", mode === "quiz" ? "QUIZ" : card.kind.toLocaleUpperCase()),
      element("span", "", card.sourcePages.length ? `Pages ${card.sourcePages.join(", ")}` : card.lessonTitle),
    );
    article.append(meta, element("p", "lesson-review-prompt", card.front));
    if (mode === "quiz") renderQuizCard(article, card);
    else renderFlashcard(article, card);
    stage.append(article);
  }

  function renderFlashcard(article, card) {
    if (!answerShown) {
      const reveal = element("button", "button button-primary lesson-review-reveal", "Show answer");
      reveal.type = "button";
      reveal.addEventListener("click", () => {
        answerShown = true;
        renderStage();
      });
      article.append(reveal);
      return;
    }
    article.append(element("p", "lesson-review-answer", card.back), createRatingButtons(card));
  }

  function renderQuizCard(article, card) {
    const quiz = buildQuizQuestion(card, cards, {
      seed: new Date().toISOString().slice(0, 10),
    });
    if (quiz.type === "free-response") return renderFlashcard(article, card);
    const optionList = element("div", "lesson-review-quiz-options");
    quiz.options.forEach((option) => {
      const button = element("button", "", option);
      button.type = "button";
      if (selectedQuizOption !== null) {
        button.disabled = true;
        if (option === quiz.answer) button.classList.add("is-correct");
        if (option === selectedQuizOption && option !== quiz.answer) button.classList.add("is-incorrect");
      }
      button.addEventListener("click", () => {
        selectedQuizOption = option;
        answerShown = true;
        renderStage();
      });
      optionList.append(button);
    });
    article.append(optionList);
    if (answerShown) {
      article.append(
        element(
          "p",
          "lesson-review-answer",
          selectedQuizOption === quiz.answer ? `Correct. ${quiz.answer}` : `Answer: ${quiz.answer}`,
        ),
        createRatingButtons(card),
      );
    }
  }

  function createRatingButtons(card) {
    const preview = previewReviewRatings(card, new Date(), settings);
    const group = element("div", "lesson-review-ratings");
    ["again", "hard", "good", "easy"].forEach((rating) => {
      const button = element("button");
      button.type = "button";
      button.append(
        element("strong", "", capitalize(rating)),
        element("span", "", preview[rating].interval),
      );
      button.addEventListener("click", () => gradeCurrentReview(rating));
      group.append(button);
    });
    return group;
  }

  async function gradeCurrentReview(rating) {
    const card = cards.find((candidate) => candidate.id === currentCardId);
    if (!card || !bookId) return;
    const outcome = applyReviewRating(card, rating, new Date(), settings);
    cards = cards.map((candidate) => candidate.id === card.id ? outcome.card : candidate);
    logs.push(outcome.log);
    await Promise.all([
      persistCards(),
      putBookRecords("reviewLogs", bookId, [outcome.log]),
    ]);
    currentCardId = getReviewQueue(cards, new Date(), settings)[0]?.id ?? null;
    answerShown = false;
    selectedQuizOption = null;
    render();
  }

  function setMode(nextMode) {
    mode = nextMode === "quiz" ? "quiz" : "flashcard";
    answerShown = false;
    selectedQuizOption = null;
    render();
  }

  async function saveSettings(event) {
    event.preventDefault();
    settings = normalizeReviewSettings({
      requestRetention: Number(elements["review-retention"].value),
      dailyNewLimit: Number(elements["review-new-limit"].value),
      maximumInterval: settings.maximumInterval,
      enableShortTerm: elements["review-short-term"].checked,
    });
    await persistSettings();
    render();
    options.showToast("Adaptive review settings saved.");
  }

  function renderLibrary() {
    const container = elements["review-all-cards"];
    container.replaceChildren();
    if (!cards.length) {
      container.append(element("p", "lesson-empty-copy", "Synced review cards will appear here."));
      return;
    }
    cards
      .slice()
      .sort((left, right) => left.lessonTitle.localeCompare(right.lessonTitle) || left.front.localeCompare(right.front))
      .forEach((card) => {
        const row = element("div", "lesson-review-library-row");
        const content = document.createElement("div");
        content.append(
          element("strong", "", card.front),
          element("span", "", `${card.lessonTitle} · ${card.kind}`),
        );
        const state = element("span", "", card.suspended ? "Suspended" : stateLabel(card.schedule.state));
        const due = document.createElement("time");
        due.dateTime = card.schedule.due;
        due.textContent = formatDue(card.schedule.due);
        const actions = element("div", "lesson-review-library-actions");
        actions.append(
          smallAction("Edit", () => openCardEditor(card)),
          smallAction(card.suspended ? "Resume" : "Suspend", () => toggleSuspended(card.id)),
          smallAction("Delete", () => deleteCard(card.id)),
        );
        row.append(content, state, due, actions);
        container.append(row);
      });
  }

  function renderHistory() {
    const container = elements["review-history"];
    container.replaceChildren();
    const cardMap = new Map(cards.map((card) => [card.id, card]));
    const recent = logs.slice(-50).reverse();
    if (!recent.length) {
      container.append(element("p", "lesson-empty-copy", "Completed reviews will be recorded here."));
      return;
    }
    recent.forEach((log) => {
      const row = element("div", "lesson-review-history-row");
      const reviewedAt = document.createElement("time");
      reviewedAt.dateTime = log.reviewedAt;
      reviewedAt.textContent = new Date(log.reviewedAt).toLocaleString();
      row.append(
        element("strong", "", cardMap.get(log.cardId)?.front ?? "Deleted card"),
        element("span", "", capitalize(log.rating)),
        reviewedAt,
      );
      container.append(row);
    });
  }

  async function undoReview() {
    const result = undoLastReview(cards, logs);
    if (!result.undone || !bookId) return;
    cards = result.cards;
    logs = result.logs;
    currentCardId = result.undone.cardId;
    await Promise.all([
      persistCards(),
      replaceBookRecords("reviewLogs", bookId, logs),
    ]);
    render();
    options.showToast("Last review undone.");
  }

  function openCardEditor(card) {
    elements["review-editor-id"].value = card.id;
    elements["review-editor-front"].value = card.front;
    elements["review-editor-back"].value = card.back;
    elements["review-editor-dialog"].showModal();
    elements["review-editor-front"].focus();
  }

  async function saveCardEdit(event) {
    event.preventDefault();
    const cardId = elements["review-editor-id"].value;
    cards = cards.map((card) => card.id === cardId
      ? validateReviewCard({
        ...card,
        front: elements["review-editor-front"].value,
        back: elements["review-editor-back"].value,
        manuallyEdited: true,
        updatedAt: new Date().toISOString(),
      })
      : card);
    await persistCards();
    closeEditor();
    render();
  }

  function closeEditor() {
    elements["review-editor-dialog"].close();
  }

  async function toggleSuspended(cardId) {
    cards = cards.map((card) => card.id === cardId
      ? validateReviewCard({ ...card, suspended: !card.suspended, updatedAt: new Date().toISOString() })
      : card);
    await persistCards();
    render();
  }

  async function deleteCard(cardId) {
    const card = cards.find((candidate) => candidate.id === cardId);
    if (!card || !confirm(`Delete review card “${card.front}”?`)) return;
    cards = cards.filter((candidate) => candidate.id !== cardId);
    if (currentCardId === cardId) currentCardId = null;
    await persistCards();
    render();
  }

  function persistCards() {
    if (!bookId) return Promise.resolve();
    return replaceBookRecords("reviewCards", bookId, cards);
  }

  function persistSettings() {
    if (!bookId) return Promise.resolve();
    return replaceBookRecords("reviewSettings", bookId, [{
      id: "settings",
      ...settings,
    }]);
  }

  return Object.freeze({
    bindEvents,
    clear,
    commitSnapshot,
    getSnapshot,
    loadBook,
    render,
    syncSelectedLesson,
    syncWholeBook,
  });
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function smallAction(label, action) {
  const button = element("button", "button button-small", label);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

function formatDue(value) {
  const due = new Date(value);
  const delta = due - new Date();
  if (delta <= 0) return "Due now";
  const minutes = Math.ceil(delta / 60_000);
  if (minutes < 60) return `In ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `In ${hours}h`;
  return `In ${Math.ceil(hours / 24)}d`;
}

function stateLabel(state) {
  return ["New", "Learning", "Review", "Relearning"][Number(state)] ?? "New";
}

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : "";
}
