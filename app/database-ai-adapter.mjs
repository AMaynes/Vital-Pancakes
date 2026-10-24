/** Semantic personal database commands. Content is scoped to a page-session grant. */
import { createCurrentToolAiAdapter } from "../tools/current-tool-ai-adapter.mjs";
import { ENTRY_TYPES, STORAGE_POLICIES, validateDatabase, graphNeighborhood, storagePolicy, removeRecord, clone, reviewNotecard } from "./database-model.mjs";

const objectSchema = (properties, required = []) => ({ type: "object", properties: { type: { type: "string" }, ...properties }, required: ["type", ...required], additionalProperties: false });
const string = { type: "string", minLength: 1, maxLength: 500 };

export function createDatabaseAiAdapter({ id = "database", getSnapshot, commitSnapshot, allowedIds = new Set(), getLocation = () => null }) {
  const requireAccess = id => { if (!allowedIds.has(id)) throw new Error("Allow AI access to this specific directory or entry in the database browser first."); };
  const command = (type, description, permissions, mutates, properties, required, example, execute) => ({
    type, description, permissions, mutates, schema: objectSchema(properties, required), example: { type, ...example },
    execute(state, input) {
      const fields = new Set(["type", ...Object.keys(properties)]);
      if (Object.keys(input).some(key => !fields.has(key))) throw new TypeError("Unknown command field.");
      for (const key of required) if (input[key] === undefined) throw new TypeError(`${key} is required.`);
      const result = execute(state, input);
      if (mutates) return { ...result, state: validateDatabase(result.state ?? state) };
      return result;
    },
  });
  return createCurrentToolAiAdapter({ id, title: "Personal Database", description: "Directories, mixed entries, glossary, cards, references, graph views and storage preferences.",
    getSnapshot,
    commitSnapshot: async next => {
      const previous = getSnapshot(); await commitSnapshot(next);
      for (const record of Object.values(next.entries).concat(Object.values(next.folders))) {
        if (!previous.entries[record.id] && !previous.folders[record.id] && allowedIds.has(record.parentId)) allowedIds.add(record.id);
      }
    },
    getContext: () => ({ schemaVersion: 1, locationId: getLocation(), allowedIds: [...allowedIds], entryCount: Object.keys(getSnapshot().entries).length }),
    limitations: ["Content and graph labels require a narrow, explicit session grant in the database browser.", "Existing specialized entry fields are preserved; their original Workspace adapter remains available.", "Binary attachment ingestion requires file access. Google consent and initial folder selection require the user.", "SharedVP publishing is not implemented."],
    commands: [
      command("directories.list", "List direct children of a granted directory.", ["read-content"], false, { parentId: string }, ["parentId"], { parentId: "library" }, (state, input) => {
        requireAccess(input.parentId);
        return { value: { directories: Object.values(state.folders).filter(item => item.parentId === input.parentId && allowedIds.has(item.id)).map(({ id, title }) => ({ id, title })), entries: Object.values(state.entries).filter(item => item.parentId === input.parentId && allowedIds.has(item.id)).map(({ id, title, type }) => ({ id, title, type })) } };
      }),
      command("entries.get", "Read one explicitly granted entry, including blocks and review progress.", ["read-content", "sensitive-data"], false, { id: string }, ["id"], { id: "entry-example" }, (state, input) => { requireAccess(input.id); if (!state.entries[input.id]) throw new Error("Entry not found."); return { value: state.entries[input.id] }; }),
      command("directories.save", "Create or update a directory, with a storage override.", ["create", "update"], true, { id: string, parentId: string, title: string, storage: { enum: STORAGE_POLICIES } }, ["id", "parentId", "title"], { id: "folder-my-notes", parentId: "studies-projects", title: "My notes" }, (state, input) => {
        requireAccess(input.parentId); const existing = state.folders[input.id]; if (existing) requireAccess(input.id);
        if (state.entries[input.id] || state.assets[input.id] || state.links[input.id]) throw new TypeError("That ID is already in use.");
        if (existing?.role || existing?.legacySection || existing?.parentId === null) throw new TypeError("Use storage.set for permanent directories; their identity is preserved.");
        state.folders[input.id] = { ...existing, id: input.id, parentId: input.parentId, title: input.title, storage: input.storage ?? existing?.storage ?? "inherit" }; delete state.tombstones[input.id];
        return { state, [existing ? "updatedIds" : "createdIds"]: [input.id] };
      }),
      command("entries.save", "Create or replace mixed content, cards, glossary entries or saved graph views.", ["create", "update", "sensitive-data"], true,
        { id: string, parentId: string, title: string, entryType: { enum: [...ENTRY_TYPES, "practice-state"] }, content: { type: "array" }, data: { type: "object" }, storage: { enum: STORAGE_POLICIES } }, ["id", "parentId", "title", "entryType"],
        { id: "entry-my-note", parentId: "studies-projects", title: "My note", entryType: "blog", content: [{ type: "markdown", text: "A new idea." }] }, (state, input) => {
          requireAccess(input.parentId); const existing = state.entries[input.id]; if (existing) requireAccess(input.id);
          if (existing?.id.startsWith("workspace:")) throw new TypeError("Update specialized entries through the Workspace adapter.");
          if (existing && existing.type !== input.entryType) throw new TypeError("An existing entry keeps its type and stable identity. Create a new entry to use another type.");
          if (state.folders[input.id] || state.assets[input.id] || state.links[input.id]) throw new TypeError("That ID is already in use.");
          state.entries[input.id] = { ...existing, id: input.id, parentId: input.parentId, title: input.title, type: input.entryType, storage: input.storage ?? existing?.storage ?? "inherit", content: clone(input.content ?? []), data: clone(input.data ?? {}), updatedAt: new Date().toISOString() };
          delete state.tombstones[input.id]; return { state, [existing ? "updatedIds" : "createdIds"]: [input.id] };
        }),
      command("records.delete", "Remove an unreferenced entry or empty custom directory.", ["delete"], true, { id: string }, ["id"], { id: "entry-my-note" }, (state, input) => {
        requireAccess(input.id); const folder = state.folders[input.id];
        if (folder && (folder.role || folder.legacySection || folder.parentId === null)) throw new TypeError("Permanent directories cannot be deleted.");
        removeRecord(state, input.id); return { state, deletedIds: [input.id] };
      }),
      command("storage.set", "Set a directory or entry to local, cloud, both or inherit. Cloud-selected content is queued if the user has enabled automatic sync; otherwise sync is manual.", ["update"], true,
        { id: string, storage: { enum: STORAGE_POLICIES } }, ["id", "storage"], { id: "studies-projects", storage: "both" }, (state, input) => {
          requireAccess(input.id); if (!STORAGE_POLICIES.includes(input.storage)) throw new TypeError("Invalid storage policy.");
          const record = state.folders[input.id] ?? state.entries[input.id]; if (!record) throw new Error("Record not found."); record.storage = input.storage;
          return { state, updatedIds: [input.id], value: { effectiveStorage: storagePolicy(state, input.id), uploaded: false } };
        }),
      command("relationships.save", "Connect two granted records.", ["create", "update"], true,
        { id: string, sourceId: string, targetId: string, label: string }, ["id", "sourceId", "targetId"], { id: "link-example", sourceId: "entry-one", targetId: "entry-two", label: "explains" }, (state, input) => {
          requireAccess(input.sourceId); requireAccess(input.targetId);
          if (state.entries[input.id] || state.folders[input.id] || state.assets[input.id]) throw new TypeError("That ID is already in use.");
          state.links[input.id] = { ...state.links[input.id], id: input.id, sourceId: input.sourceId, targetId: input.targetId, type: input.label ?? "related" }; return { state, updatedIds: [input.id] };
        }),
      command("relationships.delete", "Remove a relationship between granted records.", ["delete"], true, { id: string }, ["id"], { id: "link-example" }, (state, input) => {
        const link = state.links[input.id]; if (!link) throw new Error("Relationship not found."); requireAccess(link.sourceId); requireAccess(link.targetId); delete state.links[input.id]; return { state, deletedIds: [input.id] };
      }),
      command("notecards.review", "Record a review on the original card ID.", ["update", "sensitive-data"], true, { id: string, remembered: { type: "boolean" } }, ["id", "remembered"], { id: "notecard-example", remembered: true }, (state, input) => {
        requireAccess(input.id); if (typeof input.remembered !== "boolean") throw new TypeError("remembered must be boolean.");
        const entry = state.entries[input.id]; if (entry?.type !== "notecard") throw new TypeError("Choose a notecard.");
        reviewNotecard(state, input.id, input.remembered);
        return { state, updatedIds: [input.id] };
      }),
      command("graph.explore", "Read a bounded neighborhood of granted records.", ["read-content"], false, { rootId: string, depth: { type: "integer", minimum: 0, maximum: 6 } }, ["rootId"], { rootId: "library", depth: 2 }, (state, input) => {
        requireAccess(input.rootId); const graph = graphNeighborhood(state, input.rootId, input.depth ?? 2);
        const visible = new Set(graph.nodes.filter(node => allowedIds.has(node.id)).map(node => node.id));
        return { value: { nodes: graph.nodes.filter(node => visible.has(node.id)), edges: graph.edges.filter(edge => visible.has(edge.sourceId) && visible.has(edge.targetId)), truncated: graph.truncated, hiddenNeighbors: graph.nodes.length - visible.size } };
      }),
    ],
  });
}
