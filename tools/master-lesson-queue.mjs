/**
 * Pure resumable generation-queue state transitions.
 */

const ACTIVE_STATES = new Set(["running", "paused", "cancelled", "complete", "error"]);

export function createGenerationQueue(items) {
  const normalizedItems = [...new Set((Array.isArray(items) ? items : []).filter(Boolean))];
  return {
    state: normalizedItems.length ? "paused" : "complete",
    items: normalizedItems,
    completed: [],
    current: null,
    failed: null,
    error: "",
    scope: "lesson",
    message: "",
    aggregatePending: false,
  };
}

export function normalizeGenerationQueue(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) {
    return createGenerationQueue([]);
  }
  const items = [...new Set(value.items.filter((item) => typeof item === "string" && item))];
  const completed = [...new Set(
    (Array.isArray(value.completed) ? value.completed : [])
      .filter((item) => items.includes(item)),
  )];
  const state = ACTIVE_STATES.has(value.state) ? value.state : "paused";
  return {
    state: state === "running" ? "paused" : state,
    items,
    completed,
    current: typeof value.current === "string" && items.includes(value.current)
      ? value.current
      : null,
    failed: typeof value.failed === "string" && items.includes(value.failed)
      ? value.failed
      : null,
    error: typeof value.error === "string" ? value.error : "",
    scope: ["lesson", "chapter", "book"].includes(value.scope) ? value.scope : "lesson",
    message: typeof value.message === "string" ? value.message : "",
    aggregatePending: value.aggregatePending === true,
  };
}

export function resumeQueue(queue) {
  if (queue.completed.length >= queue.items.length && !queue.aggregatePending) {
    return { ...queue, state: "complete" };
  }
  return { ...queue, state: "running", error: "", failed: null };
}

export function pauseQueue(queue) {
  return queue.state === "running" ? { ...queue, state: "paused" } : queue;
}

export function cancelQueue(queue) {
  return { ...queue, state: "cancelled", current: null };
}

export function nextQueueItem(queue) {
  if (queue.state !== "running") return { queue, item: null };
  const item = queue.items.find((candidate) => !queue.completed.includes(candidate));
  if (!item) return { queue: { ...queue, state: "complete", current: null }, item: null };
  return { queue: { ...queue, current: item }, item };
}

export function completeQueueItem(queue, item) {
  const completed = queue.completed.includes(item)
    ? queue.completed
    : [...queue.completed, item];
  return {
    ...queue,
    state: completed.length >= queue.items.length ? "complete" : queue.state,
    completed,
    current: null,
    failed: null,
    error: "",
  };
}

export function failQueueItem(queue, item, error) {
  return {
    ...queue,
    state: "error",
    current: null,
    failed: item,
    error: String(error?.message ?? error ?? "Generation failed."),
  };
}

export function retryQueue(queue) {
  return {
    ...queue,
    state: "running",
    current: null,
    failed: null,
    error: "",
  };
}
