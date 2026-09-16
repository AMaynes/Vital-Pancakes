// Informational UI only: this module never uploads or modifies saved records.
export function showNote(title, paragraphs) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "storage-note-dialog";
  const heading = document.createElement("h2");
  heading.id = "storage-note-title";
  heading.textContent = title;
  dialog.setAttribute("aria-labelledby", heading.id);
  dialog.append(heading);
  for (const text of paragraphs) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    dialog.append(paragraph);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());
  dialog.append(close);
  dialog.addEventListener("close", () => {
    dialog.remove();
    previousFocus?.focus();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

export function createStorageIndicator(section, item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "storage-indicator";
  button.textContent = "▣ Browser";
  button.title = "Show storage location";
  button.setAttribute("aria-label", `Storage location for ${item.title}: browser storage`);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    showNote(`Storage: ${item.title}`, [
      "Website caching / browser storage on this device. This entry is managed in this browser profile, not Google Drive or a native phone/computer file. An installed website (PWA) still uses browser-managed storage.",
      `Location: ${location.origin} → localStorage → artificially-neuroscience-workspace-v1 → ${section.id} → ${item.id}. The browser manages the disk location; this page cannot report a filesystem path or device name.`,
      "Browser storage usually survives closing the page. There is no known deletion date. Clearing site data, private browsing ending, or browser storage cleanup can remove it. This indicator identifies the storage backend; it is not proof that the latest write succeeded.",
      "Cloud storage and automatic synchronization are WIP and unavailable. No cloud copy or pending upload is confirmed. Existing image/video links are references and do not mean those files have been copied into storage.",
    ]);
  });
  return button;
}

// Turn each homepage WIP description into a readable, keyboard-accessible note.
document.querySelectorAll(".knowledge-wip-list > div").forEach((item) => {
  const title = item.querySelector("dt");
  if (!title) return;
  const noteTitle = title.textContent;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "wip-note-button";
  button.textContent = "Read full WIP note";
  button.setAttribute("aria-label", `Read full WIP note: ${title.textContent}`);
  button.addEventListener("click", () => showNote(noteTitle, [
    "Work in progress — this describes planned behavior, not an available feature.",
    ...Array.from(item.querySelectorAll("dd"), (note) => note.textContent),
  ]));
  title.append(button);
});
