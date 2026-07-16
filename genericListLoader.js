/*
Overview & Purpose
Load, parse, sort, and render repository-managed content lists.

Architectural Relationships
Called by: Resource, publication, and literature-analysis pages.
Calls: Browser Fetch API and the page's data-list-source elements.

External Resources
Text files using the repository's <Entry> block format.

Notes
All fetched content is rendered with textContent to avoid interpreting data as HTML.
*/


"use strict";

/**
 * Parse repository entry blocks into normalized content records.
 *
 * @param {string} text Raw text containing one or more <Entry> blocks.
 * @returns {Array<{name: string, path: string, description: string}>} Valid entries.
 */
function parseEntries(text) {
  return text
    .split(/<Entry-End>/i)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const name = block.match(/Name:\s*"(.+?)"/i)?.[1]?.trim();
      const path = block.match(/PDF-Path:\s*"(.+?)"/i)?.[1]?.trim();
      const description = block.match(/Description:\s*"(.+?)"/i)?.[1]?.trim() ?? "";

      return name && path ? { name, path, description } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Replace a list's contents with a visible loading, empty, or error state.
 *
 * @param {HTMLElement} list Target list element.
 * @param {string} message Message shown to the visitor.
 */
function renderState(list, message) {
  const item = document.createElement("li");
  item.className = "list-state";
  item.textContent = message;
  list.replaceChildren(item);
}

/**
 * Render parsed entries as safe, accessible links.
 *
 * @param {HTMLElement} list Target list element.
 * @param {Array<{name: string, path: string, description: string}>} entries Parsed entries.
 */
function renderEntries(list, entries) {
  const fragment = document.createDocumentFragment();

  entries.forEach((entry) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = entry.path;

    const title = document.createElement("span");
    title.textContent = entry.name;
    link.appendChild(title);

    if (entry.description) {
      const description = document.createElement("span");
      description.className = "content-description";
      description.textContent = entry.description;
      link.appendChild(description);
    }

    item.appendChild(link);
    fragment.appendChild(item);
  });

  list.replaceChildren(fragment);
}

/**
 * Fetch and render a single list declared with data-list-source.
 *
 * @param {HTMLElement} list Target list element.
 * @returns {Promise<void>} Resolves after the list reaches its final state.
 */
async function loadList(list) {
  const source = list.dataset.listSource;
  const emptyMessage = list.dataset.emptyMessage ?? "No entries have been added yet.";

  if (!source) {
    renderState(list, "This list is missing its content source.");
    return;
  }

  renderState(list, "Loading…");

  try {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }

    const entries = parseEntries(await response.text());
    if (entries.length === 0) {
      renderState(list, emptyMessage);
      return;
    }

    renderEntries(list, entries);
  } catch (error) {
    console.error(`Unable to load ${source}:`, error);
    renderState(list, "This collection could not be loaded. Please try again later.");
  }
}

/**
 * Initialize every content list on the current page.
 */
function initializeContentLists() {
  document.querySelectorAll("[data-list-source]").forEach((list) => {
    loadList(list);
  });
}

document.addEventListener("DOMContentLoaded", initializeContentLists);
