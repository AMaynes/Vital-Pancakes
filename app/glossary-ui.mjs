/**
 * Knowledge Center glossary editor and reference inserter.
 */

import {
  deleteGlossaryEntry,
  listGlossaryEntries,
  saveGlossaryEntry,
} from "./knowledge-db.mjs";

let controller = null;
let entries = [];
let editingId = null;
let insertionTarget = null;

export function installKnowledgeGlossary() {
  if (controller || !globalThis.document?.body) return controller;
  const dialog = buildDialog();
  document.body.append(dialog);
  document.addEventListener("focusin", (event) => {
    if (isTextEditor(event.target) && !dialog.contains(event.target)) insertionTarget = event.target;
  });
  const open = async () => {
    await refreshGlossary(dialog);
    dialog.showModal();
    dialog.querySelector("#global-glossary-search").focus();
  };
  dialog.addEventListener("close", () => {
    editingId = null;
    resetForm(dialog);
  });
  globalThis.addEventListener("knowledge:changed", () => {
    if (dialog.open) refreshGlossary(dialog);
  });
  controller = {
    open,
    close: () => dialog.close(),
  };
  return controller;
}

function buildDialog() {
  const dialog = document.createElement("dialog");
  dialog.id = "knowledge-glossary-dialog";
  dialog.className = "global-glossary-dialog";
  dialog.setAttribute("aria-labelledby", "global-glossary-title");
  dialog.innerHTML = `
    <div class="global-glossary-shell">
      <header class="global-glossary-heading">
        <div>
          <p>SHARED KNOWLEDGE</p>
          <h2 id="global-glossary-title">Glossary</h2>
        </div>
        <button type="button" class="global-glossary-close" aria-label="Close glossary">&times;</button>
      </header>
      <label class="global-glossary-search">
        <span>Search terms</span>
        <input id="global-glossary-search" type="search" autocomplete="off" placeholder="Term, alias, or definition">
      </label>
      <div class="global-glossary-layout">
        <section aria-label="Glossary entries">
          <div class="global-glossary-list" id="global-glossary-list"></div>
        </section>
        <form class="global-glossary-form" id="global-glossary-form">
          <input type="hidden" name="id">
          <h3 id="global-glossary-form-title">New term</h3>
          <label>Term<input name="term" maxlength="300" required></label>
          <label>Definition<textarea name="definition" rows="5" maxlength="100000"></textarea></label>
          <label>Aliases<input name="aliases" placeholder="Comma separated" maxlength="5000"></label>
          <label>Examples<textarea name="examples" rows="3" placeholder="One per line" maxlength="20000"></textarea></label>
          <label>Links<textarea name="links" rows="2" placeholder="One URL or [[reference]] per line" maxlength="10000"></textarea></label>
          <label>Tags<input name="tags" placeholder="Comma separated" maxlength="5000"></label>
          <div class="global-glossary-form-actions">
            <button type="button" class="global-glossary-cancel" hidden>Cancel edit</button>
            <button type="submit" class="global-glossary-save">Save term</button>
          </div>
        </form>
      </div>
      <p class="global-glossary-status" id="global-glossary-status" role="status"></p>
    </div>
  `;
  dialog.querySelector(".global-glossary-close").addEventListener("click", () => dialog.close());
  dialog.querySelector("#global-glossary-search").addEventListener("input", () => renderEntries(dialog));
  dialog.querySelector("#global-glossary-form").addEventListener("submit", (event) => saveEntry(event, dialog));
  dialog.querySelector(".global-glossary-cancel").addEventListener("click", () => {
    editingId = null;
    resetForm(dialog);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}

async function refreshGlossary(dialog) {
  try {
    entries = await listGlossaryEntries();
    renderEntries(dialog);
  } catch (error) {
    setStatus(dialog, error.message, true);
  }
}

function renderEntries(dialog) {
  const list = dialog.querySelector("#global-glossary-list");
  const query = dialog.querySelector("#global-glossary-search").value.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) => (
    !query
    || entry.term.toLocaleLowerCase().includes(query)
    || entry.aliases.some((alias) => alias.toLocaleLowerCase().includes(query))
    || entry.definition.toLocaleLowerCase().includes(query)
  ));
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "global-glossary-empty";
    empty.textContent = query ? "No matching terms." : "No terms yet.";
    list.append(empty);
    return;
  }
  visible.forEach((entry) => {
    const article = document.createElement("article");
    article.className = "global-glossary-entry";
    const heading = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.term;
    const aliases = document.createElement("span");
    aliases.textContent = entry.aliases.length ? entry.aliases.join(", ") : "No aliases";
    heading.append(title, aliases);
    const definition = document.createElement("p");
    definition.textContent = entry.definition || "No definition yet.";
    const actions = document.createElement("div");
    actions.className = "global-glossary-entry-actions";
    const studyLink = entry.links.find((link) => /^workspace\.html#section=(?:studies|idea-playground)/.test(link));
    if (studyLink) {
      const openStudy = document.createElement("a");
      openStudy.href = studyLink;
      openStudy.textContent = "Open study";
      actions.append(openStudy);
    }
    actions.append(
      actionButton("Insert", () => insertReference(entry, dialog)),
      actionButton("Edit", () => editEntry(entry, dialog)),
      actionButton("Delete", () => removeEntry(entry, dialog), "is-danger"),
    );
    article.append(heading, definition, actions);
    list.append(article);
  });
}

async function saveEntry(event, dialog) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    const entry = await saveGlossaryEntry({
      id: editingId || undefined,
      term: data.get("term"),
      definition: data.get("definition"),
      aliases: splitCommaList(data.get("aliases")),
      examples: splitLineList(data.get("examples")),
      links: splitLineList(data.get("links")),
      tags: splitCommaList(data.get("tags")),
      createdAt: entries.find((candidate) => candidate.id === editingId)?.createdAt,
    });
    editingId = null;
    resetForm(dialog);
    await refreshGlossary(dialog);
    setStatus(dialog, `Saved “${entry.term}”.`);
  } catch (error) {
    setStatus(dialog, error.message, true);
  }
}

function editEntry(entry, dialog) {
  editingId = entry.id;
  const form = dialog.querySelector("#global-glossary-form");
  form.elements.id.value = entry.id;
  form.elements.term.value = entry.term;
  form.elements.definition.value = entry.definition;
  form.elements.aliases.value = entry.aliases.join(", ");
  form.elements.examples.value = entry.examples.join("\n");
  form.elements.links.value = entry.links.join("\n");
  form.elements.tags.value = entry.tags.join(", ");
  dialog.querySelector("#global-glossary-form-title").textContent = "Edit term";
  dialog.querySelector(".global-glossary-cancel").hidden = false;
  form.elements.term.focus();
}

async function removeEntry(entry, dialog) {
  if (!confirm(`Delete “${entry.term}” from the shared glossary?`)) return;
  try {
    await deleteGlossaryEntry(entry.id);
    if (editingId === entry.id) {
      editingId = null;
      resetForm(dialog);
    }
    await refreshGlossary(dialog);
    setStatus(dialog, `Deleted “${entry.term}”.`);
  } catch (error) {
    setStatus(dialog, error.message, true);
  }
}

async function insertReference(entry, dialog) {
  const reference = `[[${entry.term}]]`;
  if (isTextEditor(insertionTarget)) {
    if (insertionTarget instanceof HTMLInputElement || insertionTarget instanceof HTMLTextAreaElement) {
      const start = insertionTarget.selectionStart ?? insertionTarget.value.length;
      const end = insertionTarget.selectionEnd ?? start;
      insertionTarget.setRangeText(reference, start, end, "end");
      insertionTarget.dispatchEvent(new Event("input", { bubbles: true }));
      dialog.close();
      insertionTarget.focus();
      return;
    }
    insertionTarget.focus();
    document.execCommand("insertText", false, reference);
    dialog.close();
    return;
  }
  try {
    await navigator.clipboard.writeText(reference);
    setStatus(dialog, `${reference} copied.`);
  } catch {
    setStatus(dialog, `Reference: ${reference}`);
  }
}

function resetForm(dialog) {
  const form = dialog.querySelector("#global-glossary-form");
  form.reset();
  form.elements.id.value = "";
  dialog.querySelector("#global-glossary-form-title").textContent = "New term";
  dialog.querySelector(".global-glossary-cancel").hidden = true;
}

function actionButton(label, action, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener("click", action);
  return button;
}

function isTextEditor(element) {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || Boolean(element?.isContentEditable);
}

function splitCommaList(value) {
  return String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function splitLineList(value) {
  return String(value ?? "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function setStatus(dialog, message, error = false) {
  const status = dialog.querySelector("#global-glossary-status");
  status.textContent = message;
  status.classList.toggle("is-error", error);
}
