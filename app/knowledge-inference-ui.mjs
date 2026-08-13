import {
  deleteKnowledgeInferenceSession,
  saveKnowledgeInferenceSession,
} from "./knowledge-db.mjs";
import {
  buildInferencePrompt,
  convertInferenceToEntry,
  createKnowledgeInferenceSession,
  deduplicateInferences,
  enforceCitations,
  evidenceForInference,
  retrieveEvidence,
  validateKnowledgeInferenceSession,
} from "./knowledge-inference.mjs";
import { addItem } from "./store.js";

/**
 * Button-driven local inference panel embedded in the Knowledge Center.
 */

const byId = (id) => document.getElementById(id);

export function createKnowledgeInferenceController({
  getKnowledge,
  llm,
  modelOptions,
  parseModelJson,
}) {
  let sessions = [];
  let activeSession = null;
  let currentEvidence = [];
  let chunks = [];
  let chunkKey = "";
  let indexPromise = null;
  let indexWorker = null;
  let activeRequestId = null;

  bindEvents();
  populateModels();
  render();

  return {
    getSessions: () => structuredClone(sessions),
    updateKnowledge,
    updateModelProgress,
    destroy,
  };

  function bindEvents() {
    byId("knowledge-inference-open").addEventListener("click", openDialog);
    byId("knowledge-inference-close").addEventListener("click", closeDialog);
    byId("knowledge-inference-load").addEventListener("click", loadModel);
    byId("knowledge-inference-form").addEventListener("submit", runAnalysis);
    byId("knowledge-inference-cancel").addEventListener("click", cancelAnalysis);
    byId("knowledge-inference-dialog").addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
  }

  function populateModels() {
    const select = byId("knowledge-inference-model");
    select.replaceChildren(...modelOptions.map((model) => (
      new Option(`${model.label} / ${model.details}`, model.id)
    )));
    if (!llm.isSupported()) {
      byId("knowledge-inference-load").disabled = true;
      setStatus("WebGPU is unavailable. Knowledge inference requires a supported desktop browser.", true);
    }
  }

  function updateKnowledge(nextKnowledge) {
    sessions = (nextKnowledge.inferenceSessions ?? []).flatMap((session) => {
      try {
        return [validateKnowledgeInferenceSession(session)];
      } catch {
        return [];
      }
    });
    if (activeSession) {
      activeSession = sessions.find((session) => session.id === activeSession.id) ?? activeSession;
    } else {
      activeSession = sessions[0] ?? null;
    }
    render();
  }

  async function openDialog() {
    const dialog = byId("knowledge-inference-dialog");
    dialog.showModal();
    render();
    try {
      await ensureIndex();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function closeDialog() {
    cancelAnalysis();
    byId("knowledge-inference-dialog").close();
  }

  async function ensureIndex() {
    const knowledge = getKnowledge();
    const nextKey = `${knowledge.lastIndexedAt ?? "unindexed"}:${knowledge.documents.length}`;
    if (chunks.length && chunkKey === nextKey) return chunks;
    if (indexPromise) return indexPromise;
    if (!knowledge.documents.length) {
      throw new Error("No indexed knowledge is available. Add local content, then refresh the Knowledge Center.");
    }
    setStatus("Preparing the existing Knowledge index for local analysis…");
    byId("knowledge-inference-progress").value = 0.05;
    indexPromise = new Promise((resolve, reject) => {
      indexWorker?.terminate();
      const worker = new Worker("./app/knowledge-inference-worker.js?v=1", { type: "module" });
      const id = globalThis.crypto?.randomUUID?.()
        ?? `knowledge-index-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      indexWorker = worker;
      const finish = () => {
        worker.terminate();
        if (indexWorker === worker) indexWorker = null;
      };
      worker.addEventListener("message", (event) => {
        const message = event.data ?? {};
        if (message.id !== id) return;
        if (message.type === "progress") {
          byId("knowledge-inference-progress").value = Number(message.progress) || 0;
          setStatus(message.text);
        } else if (message.type === "complete") {
          chunks = message.chunks;
          chunkKey = nextKey;
          byId("knowledge-inference-progress").value = 1;
          setStatus(`${chunks.length} evidence chunks ready from ${knowledge.documents.length} indexed entries.`);
          finish();
          resolve(chunks);
        } else if (message.type === "error") {
          finish();
          reject(new Error(message.error));
        }
      });
      worker.addEventListener("error", (event) => {
        finish();
        reject(new Error(event.message || "Knowledge indexing failed."));
      });
      worker.postMessage({
        type: "index",
        id,
        documents: knowledge.documents.map(({ id: documentId, title, text, source, kind, url }) => ({
          id: documentId,
          title,
          text,
          source,
          kind,
          url,
        })),
      });
    }).finally(() => {
      indexPromise = null;
    });
    return indexPromise;
  }

  async function loadModel() {
    const button = byId("knowledge-inference-load");
    button.disabled = true;
    setStatus("Loading the selected local model…");
    try {
      await llm.load(byId("knowledge-inference-model").value);
      setStatus("Local model ready. No knowledge leaves this browser.");
      button.textContent = "Model loaded";
    } catch (error) {
      setStatus(error.message, true);
      button.disabled = false;
    }
  }

  async function runAnalysis(event) {
    event.preventDefault();
    if (!llm.loadedModelId) {
      setStatus("Load the local model before analyzing knowledge.", true);
      return;
    }
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await ensureIndex();
      currentEvidence = retrieveEvidence(
        chunks,
        values.question,
        Number(values.limit) || 8,
      );
      renderEvidence(currentEvidence);
      if (!currentEvidence.length) {
        setStatus("No relevant evidence was found for that question.", true);
        return;
      }
      setBusy(true);
      setStatus("Analyzing retrieved evidence locally…");
      byId("knowledge-inference-stream").textContent = "";
      const request = await llm.generate({
        ...buildInferencePrompt(values.mode, values.question, currentEvidence),
        json: true,
        maxTokens: 2_200,
        onStream(text) {
          byId("knowledge-inference-stream").textContent = text;
        },
      });
      activeRequestId = request.requestId;
      const output = parseModelJson(await request.promise);
      activeRequestId = null;
      const generated = enforceCitations(output, currentEvidence);
      if (!generated.length) {
        setStatus("The model returned no claims with valid evidence citations.", true);
        return;
      }
      activeSession = createKnowledgeInferenceSession({
        name: values.question,
        mode: values.mode,
        question: values.question,
        sourceIndexAt: getKnowledge().lastIndexedAt,
        sourceDocumentCount: getKnowledge().documents.length,
        evidence: currentEvidence,
        inferences: deduplicateInferences(generated),
      });
      activeSession = await saveKnowledgeInferenceSession(activeSession);
      sessions = [activeSession, ...sessions.filter((session) => session.id !== activeSession.id)];
      setStatus(`Generated ${generated.length} cited inference${generated.length === 1 ? "" : "s"} for review.`);
      render();
    } catch (error) {
      activeRequestId = null;
      setStatus(
        error.name === "AbortError" ? "Knowledge analysis cancelled." : error.message,
        error.name !== "AbortError",
      );
    } finally {
      setBusy(false);
    }
  }

  function cancelAnalysis() {
    if (activeRequestId) llm.cancel(activeRequestId);
    activeRequestId = null;
  }

  function render() {
    renderEvidence(currentEvidence.length ? currentEvidence : activeSession?.evidence ?? []);
    renderResults();
    renderSessions();
  }

  function renderEvidence(evidence) {
    const list = byId("knowledge-inference-evidence");
    list.replaceChildren();
    evidence.forEach((chunk) => {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = chunk.sourceTitle;
      const text = document.createElement("p");
      text.textContent = `${chunk.text.slice(0, 260)}${chunk.text.length > 260 ? "…" : ""}`;
      item.append(title, text);
      list.append(item);
    });
    if (!evidence.length) list.append(emptyMessage("Retrieved source excerpts appear here."));
  }

  function renderResults() {
    const container = byId("knowledge-inference-results");
    container.replaceChildren();
    if (!activeSession?.inferences.length) {
      container.append(emptyMessage("No inference session selected.", "p"));
      return;
    }
    activeSession.inferences.forEach((inference) => {
      const card = document.createElement("article");
      card.className = "knowledge-inference-result";
      card.dataset.kind = inference.kind;
      const heading = document.createElement("div");
      const kind = document.createElement("span");
      kind.textContent = inference.kind;
      const title = document.createElement("strong");
      title.textContent = inference.title;
      heading.append(kind, title);
      const statement = document.createElement("textarea");
      statement.value = inference.statement;
      statement.setAttribute("aria-label", `${inference.title} statement`);
      statement.addEventListener("change", async () => {
        const nextStatement = statement.value.trim();
        if (!nextStatement) {
          statement.value = inference.statement;
          setStatus("An inference statement cannot be empty.", true);
          return;
        }
        inference.statement = nextStatement;
        try {
          await saveActiveSession();
        } catch (error) {
          setStatus(error.message, true);
        }
      });
      const confidence = document.createElement("p");
      confidence.textContent = `Confidence ${Math.round(inference.confidence * 100)}% · ${inference.confidenceRationale}`;
      const citations = document.createElement("ul");
      citations.className = "knowledge-inference-citations";
      evidenceForInference(inference, activeSession.evidence).forEach((chunk) => {
        const item = document.createElement("li");
        const label = document.createElement(chunk.link ? "a" : "span");
        label.textContent = chunk.sourceTitle;
        if (chunk.link) label.href = chunk.link;
        item.append(label);
        citations.append(item);
      });
      const tags = document.createElement("input");
      tags.value = inference.tags.join(", ");
      tags.placeholder = "Tags";
      tags.setAttribute("aria-label", `${inference.title} tags`);
      tags.addEventListener("change", async () => {
        inference.tags = [...new Set(tags.value.split(",").map((tag) => tag.trim()).filter(Boolean))];
        try {
          await saveActiveSession();
        } catch (error) {
          setStatus(error.message, true);
        }
      });
      const actions = document.createElement("div");
      actions.className = "knowledge-inference-result-actions";
      actions.append(
        actionButton("Accept", () => updateInferenceStatus(inference.id, "accepted")),
        actionButton("Reject", () => updateInferenceStatus(inference.id, "rejected")),
        actionButton("To Question & Idea", () => convertEntry(inference, "question")),
        actionButton("To Study", () => convertEntry(inference, "study")),
      );
      const status = document.createElement("small");
      status.textContent = `Status: ${inference.status}`;
      card.append(heading, statement, confidence, citations, tags, actions, status);
      container.append(card);
    });
  }

  function renderSessions() {
    const list = byId("knowledge-inference-sessions");
    list.replaceChildren();
    sessions.forEach((session) => {
      const item = document.createElement("li");
      const summary = document.createElement("button");
      summary.type = "button";
      summary.textContent = `${session.name} · ${session.inferences.length} result${session.inferences.length === 1 ? "" : "s"}`;
      summary.addEventListener("click", () => {
        activeSession = session;
        currentEvidence = [];
        render();
      });
      const remove = actionButton("Delete", async () => {
        if (!confirm(`Delete inference session “${session.name}”?`)) return;
        await deleteKnowledgeInferenceSession(session.id);
        sessions = sessions.filter((candidate) => candidate.id !== session.id);
        if (activeSession?.id === session.id) activeSession = sessions[0] ?? null;
        render();
      });
      item.append(summary, remove);
      list.append(item);
    });
    if (!sessions.length) list.append(emptyMessage("No saved inference sessions."));
  }

  async function updateInferenceStatus(inferenceId, status) {
    const inference = activeSession.inferences.find((candidate) => candidate.id === inferenceId);
    if (!inference) return;
    const previousStatus = inference.status;
    inference.status = status;
    try {
      await saveActiveSession();
      renderResults();
    } catch (error) {
      inference.status = previousStatus;
      setStatus(error.message, true);
    }
  }

  async function saveActiveSession() {
    activeSession = await saveKnowledgeInferenceSession(activeSession);
    sessions = sessions.map((session) => session.id === activeSession.id ? activeSession : session);
  }

  function convertEntry(inference, type) {
    const sectionId = type === "study" ? "studies" : "questions-ideas";
    const created = addItem(sectionId, convertInferenceToEntry(inference, type));
    setStatus(created
      ? `Saved to ${type === "study" ? "Studies" : "Working Ideas"}.`
      : "The destination library could not be found.", !created);
  }

  function updateModelProgress(message) {
    const progress = Number(message.progress) || 0;
    byId("knowledge-inference-progress").value = progress;
    if (byId("knowledge-inference-dialog").open) setStatus(message.text);
  }

  function setBusy(busy) {
    byId("knowledge-inference-run").disabled = busy;
    byId("knowledge-inference-cancel").hidden = !busy;
  }

  function setStatus(message, error = false) {
    const status = byId("knowledge-inference-status");
    status.textContent = message;
    status.classList.toggle("is-error", error);
  }

  function destroy() {
    cancelAnalysis();
    indexWorker?.terminate();
  }
}

function actionButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function emptyMessage(message, tag = "li") {
  const item = document.createElement(tag);
  item.className = "knowledge-empty";
  item.textContent = message;
  return item;
}
