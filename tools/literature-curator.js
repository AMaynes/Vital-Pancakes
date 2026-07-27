/**
 * Overview & Purpose
 * Curates literature analyses around ideas, claims, and hypotheses in a
 * local-first evidence matrix.
 *
 * Architectural Relationships
 * Called by: literature-curator.html.
 * Calls: literature-curator-model.mjs, localStorage, dialog, and download APIs.
 *
 * External Resources
 * localStorage key "vital-pancakes-literature-curation-v1".
 *
 * Notes
 * User-authored content is rendered with textContent and never uploaded.
 */

import {
  ANALYSIS_RELATIONSHIPS,
  LITERATURE_CURATION_VERSION,
  countRelationships,
  removeAnalysis,
  removeCuration,
  sanitizeLiteratureCurations,
  upsertAnalysis,
  upsertCuration,
} from "./literature-curator-model.mjs";

const STORAGE_KEY = "vital-pancakes-literature-curation-v1";

const curationList = document.querySelector("#curation-list");
const curationCount = document.querySelector("#curation-count");
const curationDetail = document.querySelector("#curation-detail");
const status = document.querySelector("#curation-status");
const exportButton = document.querySelector("#export-curation");
const curationDialog = document.querySelector("#curation-dialog");
const curationForm = document.querySelector("#curation-form");
const analysisDialog = document.querySelector("#analysis-dialog");
const analysisForm = document.querySelector("#analysis-form");

let curations = loadCurations();
let activeCurationId = curations[0]?.id ?? null;
let editingCurationId = null;
let editingAnalysisId = null;

function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function loadCurations() {
  try {
    return sanitizeLiteratureCurations(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch (error) {
    console.error("Unable to load literature curations.", error);
    return [];
  }
}

function saveCurations(message = "Saved locally") {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: LITERATURE_CURATION_VERSION,
      curations,
    }));
    status.textContent = message;
    status.classList.remove("has-error");
  } catch (error) {
    console.error("Unable to save literature curations.", error);
    status.textContent = "Storage is full";
    status.classList.add("has-error");
  }
}

function render() {
  if (!curations.some((curation) => curation.id === activeCurationId)) {
    activeCurationId = curations[0]?.id ?? null;
  }
  renderIndex();
  renderDetail();
  exportButton.disabled = !activeCurationId;
}

function renderIndex() {
  curationList.replaceChildren();
  curationCount.textContent = String(curations.length);

  if (!curations.length) {
    curationList.append(createElement(
      "p",
      "curation-list-empty",
      "No curations yet. Create one when an idea needs an evidence trail.",
    ));
    return;
  }

  curations.forEach((curation) => {
    const button = createElement("button", "curation-index-item");
    button.type = "button";
    button.dataset.curationId = curation.id;
    button.classList.toggle("is-active", curation.id === activeCurationId);
    button.append(
      createElement("span", "", curation.targetType),
      createElement("strong", "", curation.title),
      createElement(
        "small",
        "",
        `${curation.analyses.length} ${curation.analyses.length === 1 ? "analysis" : "analyses"}`,
      ),
    );
    curationList.append(button);
  });
}

function renderDetail() {
  curationDetail.replaceChildren();
  const curation = getActiveCuration();
  if (!curation) {
    const empty = createElement("div", "curation-empty");
    empty.append(
      createElement("span", "", "∵"),
      createElement("h2", "", "Build an evidence trail"),
      createElement(
        "p",
        "",
        "Create an idea, claim, or hypothesis, then curate literature analyses according to how each source supports, complicates, contradicts, or contextualizes it.",
      ),
    );
    const createButton = createElement("button", "button button-primary", "Create the first curation");
    createButton.type = "button";
    createButton.dataset.createFirstCuration = "";
    empty.append(createButton);
    curationDetail.append(empty);
    return;
  }

  const inner = createElement("div", "curation-detail-inner");
  inner.append(
    createCurationHeader(curation),
    createCurationSummary(curation),
    createEvidenceSection(curation),
  );
  curationDetail.append(inner);
}

function createCurationHeader(curation) {
  const header = createElement("header", "curation-detail-header");
  const copy = createElement("div");
  copy.append(
    createElement("p", "curation-detail-kicker", curation.targetType),
    createElement("h2", "", curation.title),
    createElement("p", "curation-statement", curation.statement || "No target statement has been added."),
  );

  const actions = createElement("div", "curation-header-actions");
  const edit = createElement("button", "button button-quiet", "Edit");
  edit.type = "button";
  edit.dataset.editCuration = curation.id;
  const remove = createElement("button", "button button-danger-quiet", "Delete");
  remove.type = "button";
  remove.dataset.deleteCuration = curation.id;
  actions.append(edit, remove);
  header.append(copy, actions);
  return header;
}

function createCurationSummary(curation) {
  const summary = createElement("section", "curation-summary");
  const synthesis = createElement("div", "curation-synthesis");
  synthesis.append(
    createElement("span", "", "Working synthesis"),
    createElement(
      "p",
      "",
      curation.synthesis || "No synthesis yet. Revise the curation as the evidence changes your position.",
    ),
  );
  summary.append(synthesis);

  const counts = countRelationships(curation.analyses);
  ANALYSIS_RELATIONSHIPS.forEach((relationship) => {
    const count = createElement("div", "relationship-count");
    count.append(
      createElement("span", "", relationship),
      createElement("strong", "", String(counts[relationship])),
    );
    summary.append(count);
  });
  return summary;
}

function createEvidenceSection(curation) {
  const section = createElement("section");
  const heading = createElement("div", "evidence-heading");
  const copy = createElement("div");
  copy.append(
    createElement("h3", "", "Curated literature analyses"),
    createElement("p", "", "Classify each source by how it bears on the target—not by whether you like its conclusion."),
  );
  const add = createElement("button", "button button-primary", "+ Literature analysis");
  add.type = "button";
  add.dataset.addAnalysis = "";
  heading.append(copy, add);

  const matrix = createElement("div", "evidence-matrix");
  ANALYSIS_RELATIONSHIPS.forEach((relationship) => {
    matrix.append(createEvidenceColumn(
      relationship,
      curation.analyses.filter((analysis) => analysis.relationship === relationship),
    ));
  });
  section.append(heading, matrix);
  return section;
}

function createEvidenceColumn(relationship, analyses) {
  const column = createElement(
    "section",
    `evidence-column relationship-${relationship.toLocaleLowerCase()}`,
  );
  const header = document.createElement("header");
  header.append(
    createElement("h4", "", relationship),
    createElement("span", "", String(analyses.length)),
  );
  const body = createElement("div", "evidence-column-body");
  if (!analyses.length) {
    body.append(createElement("p", "evidence-column-empty", `No ${relationship.toLocaleLowerCase()} analyses yet.`));
  } else {
    analyses.forEach((analysis) => body.append(createAnalysisCard(analysis)));
  }
  column.append(header, body);
  return column;
}

function createAnalysisCard(analysis) {
  const card = createElement("article", "analysis-card");
  const header = document.createElement("header");
  const heading = createElement("div");
  heading.append(createElement("h5", "", analysis.sourceTitle));
  if (analysis.citation) {
    heading.append(createElement("p", "analysis-card-citation", analysis.citation));
  }

  const actions = createElement("div", "analysis-card-actions");
  const edit = createElement("button", "icon-button", "✎");
  edit.type = "button";
  edit.title = "Edit analysis";
  edit.dataset.editAnalysis = analysis.id;
  const remove = createElement("button", "icon-button", "×");
  remove.type = "button";
  remove.title = "Delete analysis";
  remove.dataset.deleteAnalysis = analysis.id;
  actions.append(edit, remove);
  header.append(heading, actions);
  card.append(header);

  if (analysis.sourceUrl) {
    const link = createElement("a", "", "Open source ↗");
    link.href = analysis.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.append(link);
  }
  appendAnalysisDefinition(card, "Key finding or passage", analysis.finding);
  appendAnalysisDefinition(card, "My analysis", analysis.analysis);
  appendAnalysisDefinition(card, "Limits and notes", analysis.notes);
  return card;
}

function appendAnalysisDefinition(parent, label, value) {
  if (!value) return;
  const definition = createElement("div", "analysis-definition");
  definition.append(createElement("span", "", label), createElement("p", "", value));
  parent.append(definition);
}

function openCurationDialog(curation = null) {
  editingCurationId = curation?.id ?? null;
  curationForm.reset();
  curationForm.elements.title.value = curation?.title ?? "";
  curationForm.elements.targetType.value = curation?.targetType ?? "Idea";
  curationForm.elements.statement.value = curation?.statement ?? "";
  curationForm.elements.synthesis.value = curation?.synthesis ?? "";
  document.querySelector("#curation-dialog-eyebrow").textContent = curation ? "EDIT CURATION" : "NEW CURATION";
  document.querySelector("#curation-dialog-title").textContent = curation ? "Edit curation" : "Add curation";
  curationDialog.showModal();
  window.setTimeout(() => curationForm.elements.title.focus(), 0);
}

function openAnalysisDialog(analysis = null) {
  if (!getActiveCuration()) return;
  editingAnalysisId = analysis?.id ?? null;
  analysisForm.reset();
  analysisForm.elements.sourceTitle.value = analysis?.sourceTitle ?? "";
  analysisForm.elements.citation.value = analysis?.citation ?? "";
  analysisForm.elements.sourceUrl.value = analysis?.sourceUrl ?? "";
  analysisForm.elements.relationship.value = analysis?.relationship ?? "Supports";
  analysisForm.elements.finding.value = analysis?.finding ?? "";
  analysisForm.elements.analysis.value = analysis?.analysis ?? "";
  analysisForm.elements.notes.value = analysis?.notes ?? "";
  document.querySelector("#analysis-dialog-eyebrow").textContent = analysis ? "EDIT ANALYSIS" : "NEW ANALYSIS";
  document.querySelector("#analysis-dialog-title").textContent = analysis
    ? "Edit literature analysis"
    : "Add literature analysis";
  analysisDialog.showModal();
  window.setTimeout(() => analysisForm.elements.sourceTitle.focus(), 0);
}

function saveCurationFromForm(event) {
  event.preventDefault();
  const now = new Date().toISOString();
  const existing = curations.find((curation) => curation.id === editingCurationId);
  const curation = {
    id: existing?.id ?? createId(),
    title: curationForm.elements.title.value,
    targetType: curationForm.elements.targetType.value,
    statement: curationForm.elements.statement.value,
    synthesis: curationForm.elements.synthesis.value,
    analyses: existing?.analyses ?? [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  curations = upsertCuration(curations, curation);
  activeCurationId = curation.id;
  curationDialog.close();
  saveCurations(existing ? "Curation updated" : "Curation added");
  render();
}

function saveAnalysisFromForm(event) {
  event.preventDefault();
  const curation = getActiveCuration();
  if (!curation) return;
  const now = new Date().toISOString();
  const existing = curation.analyses.find((analysis) => analysis.id === editingAnalysisId);
  curations = upsertAnalysis(curations, curation.id, {
    id: existing?.id ?? createId(),
    sourceTitle: analysisForm.elements.sourceTitle.value,
    citation: analysisForm.elements.citation.value,
    sourceUrl: analysisForm.elements.sourceUrl.value,
    relationship: analysisForm.elements.relationship.value,
    finding: analysisForm.elements.finding.value,
    analysis: analysisForm.elements.analysis.value,
    notes: analysisForm.elements.notes.value,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  analysisDialog.close();
  saveCurations(existing ? "Analysis updated" : "Analysis added");
  render();
}

function deleteActiveCuration(curationId) {
  const curation = curations.find((candidate) => candidate.id === curationId);
  if (!curation || !window.confirm(`Delete “${curation.title}” and its literature analyses?`)) return;
  curations = removeCuration(curations, curation.id);
  activeCurationId = curations[0]?.id ?? null;
  saveCurations("Curation deleted");
  render();
}

function deleteActiveAnalysis(analysisId) {
  const curation = getActiveCuration();
  const analysis = curation?.analyses.find((candidate) => candidate.id === analysisId);
  if (!curation || !analysis || !window.confirm(`Delete the analysis of “${analysis.sourceTitle}”?`)) return;
  curations = removeAnalysis(curations, curation.id, analysis.id, new Date().toISOString());
  saveCurations("Analysis deleted");
  render();
}

function clearAllCurations() {
  if (!curations.length || !window.confirm("Clear every literature curation and analysis from this browser?")) return;
  curations = [];
  activeCurationId = null;
  saveCurations("All curations cleared");
  render();
}

function exportActiveCuration() {
  const curation = getActiveCuration();
  if (!curation) return;
  const counts = countRelationships(curation.analyses);
  const lines = [
    `# ${curation.title}`,
    "",
    `**Type:** ${curation.targetType}`,
    "",
    "## Target",
    "",
    curation.statement || "_No target statement._",
    "",
    "## Working synthesis",
    "",
    curation.synthesis || "_No synthesis yet._",
    "",
    "## Evidence balance",
    "",
    ...ANALYSIS_RELATIONSHIPS.map((relationship) => `- ${relationship}: ${counts[relationship]}`),
  ];

  ANALYSIS_RELATIONSHIPS.forEach((relationship) => {
    lines.push("", `## ${relationship}`, "");
    const analyses = curation.analyses.filter((analysis) => analysis.relationship === relationship);
    if (!analyses.length) {
      lines.push("_No analyses._");
      return;
    }
    analyses.forEach((analysis) => {
      lines.push(`### ${analysis.sourceTitle}`, "");
      if (analysis.citation) lines.push(analysis.citation, "");
      if (analysis.sourceUrl) lines.push(`[Open source](${analysis.sourceUrl})`, "");
      if (analysis.finding) lines.push("**Key finding or passage**", "", analysis.finding, "");
      if (analysis.analysis) lines.push("**My analysis**", "", analysis.analysis, "");
      if (analysis.notes) lines.push("**Limits and notes**", "", analysis.notes, "");
    });
  });

  const blob = new Blob([`${lines.join("\n").trim()}\n`], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(curation.title) || "literature-curation"}.md`;
  link.click();
  URL.revokeObjectURL(url);
  status.textContent = "Markdown exported";
}

function getActiveCuration() {
  return curations.find((curation) => curation.id === activeCurationId) ?? null;
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `curation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .toLocaleLowerCase()
    .slice(0, 80);
}

curationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-curation-id]");
  if (!button) return;
  activeCurationId = button.dataset.curationId;
  render();
});

curationDetail.addEventListener("click", (event) => {
  const curation = getActiveCuration();
  if (event.target.closest("[data-create-first-curation]")) {
    openCurationDialog();
  } else if (event.target.closest("[data-add-analysis]")) {
    openAnalysisDialog();
  } else if (event.target.closest("[data-edit-curation]")) {
    openCurationDialog(curation);
  } else if (event.target.closest("[data-delete-curation]")) {
    deleteActiveCuration(curation?.id);
  } else if (event.target.closest("[data-edit-analysis]")) {
    const analysisId = event.target.closest("[data-edit-analysis]").dataset.editAnalysis;
    openAnalysisDialog(curation?.analyses.find((analysis) => analysis.id === analysisId));
  } else if (event.target.closest("[data-delete-analysis]")) {
    deleteActiveAnalysis(event.target.closest("[data-delete-analysis]").dataset.deleteAnalysis);
  }
});

curationForm.addEventListener("submit", saveCurationFromForm);
analysisForm.addEventListener("submit", saveAnalysisFromForm);
document.querySelector("#add-curation").addEventListener("click", () => openCurationDialog());
document.querySelector("#clear-curations").addEventListener("click", clearAllCurations);
exportButton.addEventListener("click", exportActiveCuration);
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog")?.close());
});

render();
