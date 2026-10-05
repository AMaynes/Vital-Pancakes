// Informational UI only: this module never uploads or modifies saved records.
import { databaseReady, getDatabase, getDeviceValue } from "./database-store.mjs";
import { sameRecord } from "./database-model.mjs";

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
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const db = databaseReady() ? getDatabase() : null;
    const id = `workspace:${section.id}:${item.id}`;
    let receipt;
    try { if (db) receipt = await getDeviceValue("drive-receipt"); } catch { /* A missing receipt never confirms a cloud copy. */ }
    const confirmed = receipt?.datasetId === db?.datasetId && sameRecord(receipt?.database?.entries?.[id], db?.entries?.[id]) && Boolean(db?.entries?.[id]);
    showNote(`Storage: ${item.title}`, [
      "This entry has a browser copy on this device. An installed website (PWA) still uses browser-managed storage. Local file backups and selected Google Drive copies are managed through Library → Storage & backup.",
      db ? `Location: ${location.origin} → IndexedDB → vital-pancakes-database → state → database → entries → ${id}. The browser manages the disk location.` : `Location: ${location.origin} → localStorage → artificially-neuroscience-workspace-v1 → ${section.id} → ${item.id}. The browser manages the disk location.`,
      "Browser storage usually survives closing the page. There is no known deletion date. Clearing site data, private browsing ending, or browser storage cleanup can remove it. This indicator identifies the storage backend; it is not proof that the latest write succeeded.",
      confirmed ? `A matching copy was confirmed in the last completed Drive sync (${new Date(receipt.at).toLocaleString()}). This does not check subsequent remote changes.` : "No matching cloud copy is confirmed for the current entry. Drive requires OAuth setup and an explicit sync. Automatic synchronization remains planned. External image/video links remain references rather than copied attachments.",
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
