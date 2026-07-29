import { addItem } from "../app/store.js?v=14";
import {
  INFERENCE_SESSION_FORMAT,
  INFERENCE_SESSION_VERSION,
  buildInferencePrompt,
  convertInferenceToEntry,
  deduplicateInferences,
  enforceCitations,
  evidenceForInference,
  inspectBackupCollections,
  retrieveEvidence,
  validateInferenceSession,
} from "./inference-model.mjs";
import { LocalWebLlmClient } from "./local-webllm-client.mjs";
import { createId, createRepository, downloadJson, readJsonFile } from "./local-toolkit.mjs";
import { activateTabs, element, parseTags, toast } from "./suite-ui.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
  requireCommandString,
} from "./current-tool-ai-adapter.mjs?v=1";

const repository = createRepository("inference");
const sessionRepository = createRepository("inference-sessions");
const llm = new LocalWebLlmClient({ onProgress: updateModelProgress });
let collections = [];
let selectedCollectionIds = [];
let documents = [];
let chunks = [];
let inferences = [];
let sessions = [];
let activeIndex = null;
let activeRequestId = null;
let currentEvidence = [];
let importedName = "";
let activeSessionId = null;
let activeSessionMode = "mixed";
let activeSessionQuestion = "";
let activeSessionCreatedAt = null;

const byId = (id) => document.getElementById(id);

async function start() {
  try {
    const index = await repository.get("current-index");
    if (index) ({ documents, chunks, importedName, selectedCollectionIds } = index);
    sessions = await sessionRepository.list();
  } catch (error) {
    toast(`Saved inference data could not be opened: ${error.message}`, "error");
  }
  activateTabs(document.querySelector(".suite-tabs"), render);
  bindEvents();
  render();
  installInferenceAiHost();
}

function installInferenceAiHost() {
  installCurrentToolAiHost({
    id: "inference",
    title: "Inference Tool",
    description: "Reads and edits saved model-generated inferences without exposing imported source records or chunks.",
    limitations: [
      "Imported backup records, chunks, quoted evidence, file blobs, and encrypted collections are excluded from AI command context.",
      "Running retrieval or local model inference remains an explicit action in the Inference Tool.",
    ],
    getSnapshot: () => ({
      inferences,
      index: {
        importedName,
        documentCount: documents.length,
        chunkCount: chunks.length,
        selectedCollectionIds,
      },
      session: {
        id: activeSessionId,
        mode: activeSessionMode,
        question: activeSessionQuestion,
        createdAt: activeSessionCreatedAt,
      },
    }),
    getContext: (_options, snapshot) => ({
      index: snapshot.index,
      inferenceCount: snapshot.inferences.length,
      statusCounts: Object.fromEntries(["pending", "accepted", "rejected"].map((status) => [
        status,
        snapshot.inferences.filter((inference) => inference.status === status).length,
      ])),
    }),
    async commitSnapshot(nextState) {
      inferences = structuredClone(nextState.inferences);
      activeSessionId = nextState.session.id ?? activeSessionId ?? createId("session");
      activeSessionMode = nextState.session.mode ?? activeSessionMode;
      activeSessionQuestion = nextState.session.question ?? activeSessionQuestion;
      activeSessionCreatedAt = nextState.session.createdAt ?? activeSessionCreatedAt ?? new Date().toISOString();
      await saveLatestSession();
      render();
    },
    commands: [
      {
        type: "index.describe",
        description: "Read only index counts and selected collection identifiers.",
        permissions: ["read-summary"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "index.describe" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return { value: snapshot.index };
        },
      },
      {
        type: "inferences.list",
        description: "List generated inference records and citation identifiers without source record text.",
        permissions: ["read-content"],
        schema: {
          type: "object",
          properties: { status: { type: "string", enum: ["pending", "accepted", "rejected"] } },
          additionalProperties: false,
        },
        example: { type: "inferences.list", status: "pending" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["status"], commandIndex);
          return {
            value: snapshot.inferences
              .filter((inference) => !command.status || inference.status === command.status)
              .map(({ id, kind, title, statement, confidence, confidenceRationale, citations, tags, status }) => ({
                id, kind, title, statement, confidence, confidenceRationale, citations, tags, status,
              })),
          };
        },
      },
      {
        type: "inferences.update",
        description: "Edit, tag, accept, or reject one generated inference without changing source records.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["inferenceId", "changes"],
          properties: { inferenceId: { type: "string" }, changes: { type: "object" } },
          additionalProperties: false,
        },
        example: { type: "inferences.update", inferenceId: "inference-id", changes: { status: "accepted", tags: ["follow-up"] } },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["inferenceId", "changes"], commandIndex);
          const inferenceId = requireCommandString(command.inferenceId, "inferenceId", commandIndex, { maximumLength: 160 });
          const changes = requireCommandRecord(command.changes, "changes", commandIndex);
          const allowed = new Set(["title", "statement", "tags", "status"]);
          const unknown = Object.keys(changes).find((key) => !allowed.has(key));
          if (unknown) throw new Error(`Unsupported inference field: ${unknown}.`);
          const inference = snapshot.inferences.find((candidate) => candidate.id === inferenceId);
          if (!inference) throw new Error("Inference not found.");
          if (changes.status && !["pending", "accepted", "rejected"].includes(changes.status)) {
            throw new Error("Inference status must be pending, accepted, or rejected.");
          }
          const updated = {
            ...inference,
            ...(changes.title !== undefined ? { title: String(changes.title).trim().slice(0, 500) } : {}),
            ...(changes.statement !== undefined ? { statement: String(changes.statement).trim().slice(0, 12000) } : {}),
            ...(Array.isArray(changes.tags) ? { tags: parseTags(changes.tags.join(",")) } : {}),
            ...(changes.status ? { status: changes.status } : {}),
          };
          return {
            state: {
              ...snapshot,
              inferences: snapshot.inferences.map((candidate) => candidate.id === inferenceId ? updated : candidate),
            },
            updatedIds: [inferenceId],
            value: updated,
          };
        },
      },
    ],
  });
}

function bindEvents() {
  byId("inference-file").addEventListener("change", importBackup);
  byId("inference-build-index").addEventListener("click", buildIndex);
  byId("inference-cancel-index").addEventListener("click", cancelIndex);
  byId("inference-delete-index").addEventListener("click", deleteIndex);
  byId("inference-load-model").addEventListener("click", loadModel);
  byId("inference-unload-model").addEventListener("click", () => {
    llm.unload();
    byId("inference-model-status").textContent = "No local model loaded";
  });
  byId("inference-analysis-form").addEventListener("submit", runAnalysis);
  byId("inference-cancel-analysis").addEventListener("click", () => {
    if (activeRequestId) llm.cancel(activeRequestId);
  });
  byId("inference-export").addEventListener("click", () => downloadJson(currentSession(), "inference-session.json"));
  window.addEventListener("pagehide", () => llm.destroy());
}

async function importBackup(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  if (file.size > 150 * 1024 * 1024 && !confirm(`This backup is ${(file.size / 1024 / 1024).toFixed(1)} MB. Indexing may take time and substantial local storage. Continue?`)) return;
  try {
    const backup = await readJsonFile(file, 500 * 1024 * 1024);
    collections = inspectBackupCollections(backup);
    selectedCollectionIds = collections.filter((collection) => collection.defaultSelected).map((collection) => collection.id);
    importedName = file.name;
    renderCollections();
    byId("inference-collections").hidden = false;
    toast(`Found ${collections.length} record collections.`);
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderCollections() {
  const container = byId("inference-collection-list");
  container.replaceChildren();
  collections.forEach((collection) => {
    const label = element("label", "suite-card");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedCollectionIds.includes(collection.id);
    checkbox.disabled = collection.sensitive;
    checkbox.addEventListener("change", () => {
      selectedCollectionIds = checkbox.checked
        ? [...new Set([...selectedCollectionIds, collection.id])]
        : selectedCollectionIds.filter((id) => id !== collection.id);
    });
    label.append(checkbox, element("strong", "", collection.name), element("p", "", `${collection.count} records${collection.sensitive ? " · excluded as sensitive" : ""}`));
    container.append(label);
  });
}

function buildIndex() {
  if (!collections.length || !selectedCollectionIds.length) return toast("Import a backup and select at least one non-sensitive collection.", "error");
  cancelIndex();
  const worker = new Worker("./inference-index-worker.js?v=1", { type: "module" });
  const id = crypto.randomUUID();
  activeIndex = { worker, id };
  worker.addEventListener("message", async (event) => {
    const message = event.data;
    if (message.id !== id) return;
    if (message.type === "progress") {
      byId("inference-index-progress").value = message.progress;
      byId("inference-index-progress-text").textContent = message.text;
    }
    if (message.type === "complete") {
      ({ documents, chunks } = message);
      worker.terminate();
      activeIndex = null;
      await repository.put("current-index", { importedName, selectedCollectionIds, documents, chunks, checkpointedAt: new Date().toISOString() });
      byId("inference-index-progress").value = 1;
      byId("inference-index-progress-text").textContent = "Index complete and checkpointed in this browser.";
      render();
    }
    if (message.type === "error") {
      worker.terminate();
      activeIndex = null;
      toast(message.error, message.cancelled ? "info" : "error");
    }
  });
  worker.addEventListener("error", (event) => toast(event.message, "error"));
  worker.postMessage({ type: "index", id, collections, selectedIds: selectedCollectionIds });
}

function cancelIndex() {
  if (!activeIndex) return;
  activeIndex.worker.postMessage({ type: "cancel", id: activeIndex.id });
}

async function deleteIndex() {
  if (!chunks.length || !confirm("Delete the derived local search index? Imported source files are not affected.")) return;
  documents = [];
  chunks = [];
  inferences = [];
  await repository.delete("current-index");
  render();
}

async function loadModel() {
  try {
    byId("inference-generation-status").textContent = "Checking WebGPU and loading model…";
    await llm.load(byId("inference-model").value);
    byId("inference-model-status").textContent = "Local model ready";
    byId("inference-generation-status").textContent = "Model ready. Source content remains inside this browser.";
  } catch (error) {
    toast(error.message, "error");
    byId("inference-model-status").textContent = "Model unavailable";
  }
}

async function runAnalysis(event) {
  event.preventDefault();
  if (!chunks.length) return toast("Build an index first.", "error");
  if (!llm.loadedModelId) return toast("Load a local model first. No data has been sent anywhere.", "error");
  const values = Object.fromEntries(new FormData(event.currentTarget));
  currentEvidence = retrieveEvidence(chunks, values.question, Number(values.limit) || 8);
  renderEvidencePreview();
  if (!currentEvidence.length) return toast("No relevant evidence was found for that question.", "error");
  const prompt = buildInferencePrompt(values.mode, values.question, currentEvidence);
  try {
    byId("inference-generation-status").textContent = "Analyzing retrieved evidence locally…";
    byId("inference-stream").textContent = "";
    const request = await llm.generate({
      ...prompt,
      json: true,
      maxTokens: 2200,
      onStream(text) { byId("inference-stream").textContent = text; },
    });
    activeRequestId = request.requestId;
    const output = await request.promise;
    activeRequestId = null;
    const parsed = JSON.parse(output);
    const generated = enforceCitations(parsed, currentEvidence);
    inferences = deduplicateInferences([...generated, ...inferences]);
    activeSessionId = createId("session");
    activeSessionMode = values.mode;
    activeSessionQuestion = values.question;
    activeSessionCreatedAt = new Date().toISOString();
    const session = currentSession(values.mode, values.question);
    await sessionRepository.put(session.id, session);
    sessions = await sessionRepository.list();
    byId("inference-generation-status").textContent = `Generated ${generated.length} cited inference${generated.length === 1 ? "" : "s"}.`;
    render();
  } catch (error) {
    activeRequestId = null;
    toast(error.name === "AbortError" ? "Analysis cancelled." : error.message, error.name === "AbortError" ? "info" : "error");
  }
}

function currentSession(mode = activeSessionMode, question = activeSessionQuestion) {
  return {
    format: INFERENCE_SESSION_FORMAT,
    version: INFERENCE_SESSION_VERSION,
    id: activeSessionId ?? createId("session"),
    name: question.slice(0, 80) || `Inference session ${new Date().toLocaleDateString()}`,
    createdAt: activeSessionCreatedAt ?? new Date().toISOString(),
    mode,
    question,
    importedName,
    documents,
    chunks,
    inferences,
  };
}

function render() {
  renderIndex();
  renderEvidencePreview();
  renderResults();
  renderSessions();
}

function renderIndex() {
  byId("inference-index-summary").textContent = chunks.length ? `${documents.length} records · ${chunks.length} chunks` : "No index";
  const body = byId("inference-source-table");
  body.replaceChildren();
  documents.forEach((document) => {
    const row = element("tr");
    row.append(element("td", "", document.title), element("td", "", document.collectionName), element("td", "", String(chunks.filter((chunk) => chunk.documentId === document.id).length)));
    body.append(row);
  });
}

function renderEvidencePreview() {
  const list = byId("inference-evidence-preview");
  list.replaceChildren();
  currentEvidence.forEach((chunk) => {
    const row = element("li", "suite-row");
    row.append(element("span", "suite-chip", chunk.recordId));
    const main = element("div", "suite-row-main");
    main.append(element("strong", "", chunk.sourceTitle), element("span", "", `${chunk.text.slice(0, 220)}${chunk.text.length > 220 ? "…" : ""}`));
    row.append(main);
    list.append(row);
  });
  if (!currentEvidence.length) list.append(element("li", "suite-empty", "Retrieved source snippets will appear here."));
}

function renderResults() {
  const container = byId("inference-results");
  container.replaceChildren();
  inferences.forEach((inference) => {
    const card = element("article", "suite-card inference-kind");
    card.dataset.kind = inference.kind;
    card.append(element("span", "suite-chip", inference.kind), element("h3", "", inference.title));
    const statement = element("textarea", "suite-textarea");
    statement.value = inference.statement;
    statement.addEventListener("change", () => {
      inference.statement = statement.value.trim();
      saveLatestSession();
    });
    card.append(statement);
    card.append(element("p", "", `Confidence ${Math.round(inference.confidence * 100)}% · ${inference.confidenceRationale}`));
    evidenceForInference(inference, chunks).forEach((chunk) => {
      const evidence = element("div", "inference-evidence");
      evidence.append(element("strong", "", `${chunk.sourceTitle} · ${chunk.recordId}`), element("p", "", chunk.text.slice(0, 420)));
      if (chunk.link) {
        const link = element("a", "", "Open source link");
        link.href = chunk.link;
        link.rel = "noreferrer";
        evidence.append(link);
      }
      card.append(evidence);
    });
    const tags = element("input", "suite-input");
    tags.placeholder = "Tags";
    tags.value = inference.tags.join(", ");
    tags.addEventListener("change", () => { inference.tags = parseTags(tags.value); saveLatestSession(); });
    const actions = element("div", "suite-actions");
    ["accepted", "rejected"].forEach((status) => actions.append(actionButton(status === "accepted" ? "Accept" : "Reject", () => {
      inference.status = status;
      saveLatestSession();
      renderResults();
    })));
    actions.append(actionButton("To Question & Idea", () => convertEntry(inference, "question")));
    actions.append(actionButton("To Study", () => convertEntry(inference, "study")));
    card.append(tags, actions, element("span", "suite-status", `Status: ${inference.status}`));
    container.append(card);
  });
  if (!inferences.length) container.append(element("div", "suite-empty", "No inferences yet. The original records are never modified."));
}

function convertEntry(inference, type) {
  const sectionId = type === "study" ? "studies" : "questions-ideas";
  const created = addItem(sectionId, convertInferenceToEntry(inference, type));
  toast(created ? `Saved to ${type === "study" ? "Studies" : "Questions & Ideas"}.` : "The destination library could not be found.", created ? "info" : "error");
}

async function saveLatestSession() {
  const session = currentSession();
  await sessionRepository.put(session.id, session);
  sessions = await sessionRepository.list();
}

function renderSessions() {
  const list = byId("inference-sessions");
  list.replaceChildren();
  sessions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).forEach((raw) => {
    let session;
    try { session = validateInferenceSession(raw); } catch { return; }
    const row = element("li", "suite-row");
    row.append(element("span", "suite-chip", `${session.inferences.length}`));
    const main = element("div", "suite-row-main");
    main.append(element("strong", "", session.name), element("span", "", `${new Date(session.createdAt).toLocaleString()} · ${session.documents.length} sources`));
    const actions = element("div", "suite-actions");
    actions.append(actionButton("Open", () => {
      ({ documents, chunks, inferences } = structuredClone(session));
      activeSessionId = session.id;
      activeSessionMode = session.mode;
      activeSessionQuestion = session.question;
      activeSessionCreatedAt = session.createdAt;
      currentEvidence = [];
      render();
    }));
    actions.append(actionButton("Delete", async () => {
      await sessionRepository.delete(session.id);
      if (activeSessionId === session.id) {
        activeSessionId = null;
        activeSessionCreatedAt = null;
      }
      sessions = await sessionRepository.list();
      renderSessions();
    }));
    row.append(main, actions);
    list.append(row);
  });
  if (!sessions.length) list.append(element("li", "suite-empty", "No saved analysis sessions."));
}

function updateModelProgress(message) {
  byId("inference-model-progress").value = message.progress;
  byId("inference-generation-status").textContent = message.text;
}

function actionButton(label, callback) {
  const button = element("button", "button button-quiet", label);
  button.type = "button";
  button.addEventListener("click", callback);
  return button;
}

start();
