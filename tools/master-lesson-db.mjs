/**
 * IndexedDB persistence for source books, pages, chunks, summaries, lessons,
 * and resumable generation jobs. Large model assets are cached by WebLLM.
 */

const DB_NAME = "vital-pancakes-master-lessons";
const DB_VERSION = 2;
const STORES = [
  "books",
  "pages",
  "chunks",
  "summaries",
  "lessons",
  "jobs",
  "reviewCards",
  "reviewLogs",
  "reviewSettings",
];

export function openLessonDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      STORES.forEach((storeName) => {
        if (database.objectStoreNames.contains(storeName)) return;
        const store = database.createObjectStore(storeName, { keyPath: "key" });
        if (storeName !== "books") store.createIndex("bookId", "bookId", { unique: false });
      });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listBooks() {
  const records = await getAll("books");
  return records
    .map((record) => record.value)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function getBook(bookId) {
  return getValue("books", bookId);
}

export function putBook(book) {
  return putValue("books", book.id, book.id, book);
}

export function putBookRecords(storeName, bookId, records) {
  if (!STORES.includes(storeName) || storeName === "books") {
    throw new TypeError(`Unsupported book record store: ${storeName}`);
  }
  return withTransaction(storeName, "readwrite", (store) => {
    records.forEach((record) => store.put({
      key: record.key ?? `${bookId}:${record.id ?? record.page}`,
      bookId,
      value: record,
    }));
  });
}

export async function replaceBookRecords(storeName, bookId, records) {
  if (!STORES.includes(storeName) || storeName === "books") {
    throw new TypeError(`Unsupported book record store: ${storeName}`);
  }
  const database = await openLessonDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const cursorRequest = store.index("bookId").openKeyCursor(bookId);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
        return;
      }
      records.forEach((record) => store.put({
        key: record.key ?? `${bookId}:${record.id ?? record.page}`,
        bookId,
        value: record,
      }));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getBookRecords(storeName, bookId) {
  if (!STORES.includes(storeName) || storeName === "books") return [];
  const database = await openLessonDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).index("bookId").getAll(bookId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result.map((record) => record.value));
  });
}

export function getLesson(bookId, lessonId) {
  return getValue("lessons", `${bookId}:${lessonId}`);
}

export function putLesson(bookId, lessonId, lesson) {
  return putValue("lessons", `${bookId}:${lessonId}`, bookId, lesson);
}

export function getSummary(bookId, summaryId) {
  return getValue("summaries", `${bookId}:${summaryId}`);
}

export function putSummary(bookId, summaryId, summary) {
  return putValue("summaries", `${bookId}:${summaryId}`, bookId, summary);
}

export function getJob(bookId) {
  return getValue("jobs", bookId);
}

export function putJob(bookId, job) {
  return putValue("jobs", bookId, bookId, job);
}

export async function deleteBookData(bookId) {
  const database = await openLessonDatabase();
  await Promise.all(STORES.map((storeName) => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = storeName === "books" ? store.delete(bookId) : store.index("bookId").openKeyCursor(bookId);
    if (storeName !== "books") {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  })));
}

async function getValue(storeName, key) {
  const database = await openLessonDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.value ?? null);
  });
}

async function getAll(storeName) {
  const database = await openLessonDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function putValue(storeName, key, bookId, value) {
  return withTransaction(storeName, "readwrite", (store) => {
    store.put({ key, bookId, value });
  });
}

async function withTransaction(storeName, mode, operation) {
  const database = await openLessonDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Storage operation was cancelled."));
  });
}
