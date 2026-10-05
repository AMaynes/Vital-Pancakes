/** Subject practice pages expose the same canonical card commands as Library. */
import { initializeDatabase, getDatabase, saveDatabase } from "./database-store.mjs";
import { createDatabaseAiAdapter } from "./database-ai-adapter.mjs";
import { installAiPageHost } from "./ai-page-host.mjs";

const subject = location.pathname.includes("/mathematics/") ? "Mathematics" : "Arts";
const allowedIds = new Set();
await initializeDatabase();
installAiPageHost(createDatabaseAiAdapter({ id: subject === "Mathematics" ? "notecards-math" : "notecards-arts", getSnapshot: getDatabase, commitSnapshot: saveDatabase, allowedIds, getLocation: () => `cards-folder:${subject}` }));
const button = document.createElement("button"); button.type = "button"; button.className = "button button-quiet"; button.textContent = `Allow AI access to ${subject} cards`;
button.addEventListener("click", () => {
  if (allowedIds.size) { allowedIds.clear(); button.textContent = `Allow AI access to ${subject} cards`; return; }
  const db = getDatabase();
  for (const folder of Object.values(db.folders)) if (folder.id.startsWith(`cards-folder:${subject}`) || folder.id === `cards-generated:${subject}`) allowedIds.add(folder.id);
  for (const entry of Object.values(db.entries)) if (entry.id.startsWith(`notecard:${subject}:`) || entry.id === `card-practice:${subject}`) allowedIds.add(entry.id);
  button.textContent = `Revoke AI access to ${subject} cards`;
});
document.querySelector("#app")?.before(button);
