/**
 * Semantic AI command contract for the homepage knowledge center.
 */

import {
  getBacklinks,
  findRelatedDocuments,
  normalizeGlossaryEntry,
  normalizeKnowledgeLink,
  searchKnowledgeDocuments,
} from "./knowledge-model.mjs";
import {
  rejectUnknownCommandFields,
  requireCommandRecord,
  requireCommandString,
} from "../tools/current-tool-ai-adapter.mjs";

export function createHomeKnowledgeAiConfiguration(controller) {
  return {
    id: "knowledge-home",
    title: "Knowledge Home",
    description: "Searches the shared local index and manages reviewable glossary and relationship records.",
    limitations: [
      "Encrypted vault contents, passwords, private Overhead sections, and raw file bytes are never returned.",
      "Vault export and restore remain explicit user actions.",
      "AI-suggested relationships remain pending until accepted.",
      "Running local knowledge inference remains an explicit button action; commands may only review saved results.",
    ],
    getSnapshot: controller.getSnapshot,
    getContext: (_options, snapshot) => ({
      documents: snapshot.documents.length,
      glossaryTerms: snapshot.glossary.length,
      acceptedRelationships: snapshot.links.filter((link) => link.status === "accepted").length,
      pendingSuggestions: snapshot.links.filter((link) => link.status === "pending").length,
      inferenceSessions: snapshot.inferenceSessions.length,
      vault: controller.getVaultSummary(),
    }),
    commitSnapshot: controller.commitSnapshot,
    commands: [
      {
        type: "vault.summary",
        description: "Read storage counts only; never return record content, filenames, passwords, or file bytes.",
        permissions: ["read-summary"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "vault.summary" },
        execute(_snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return { value: controller.getVaultSummary() };
        },
      },
      {
        type: "knowledge.search",
        description: "Search the local cross-tool text index with bounded result snippets.",
        permissions: ["read-content"],
        schema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", maxLength: 500 },
            kind: { type: "string", maxLength: 120 },
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
          additionalProperties: false,
        },
        example: { type: "knowledge.search", query: "synaptic plasticity", limit: 10 },
        execute(_snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["query", "kind", "limit"], commandIndex);
          const query = requireCommandString(command.query, "query", commandIndex, { maximumLength: 500 });
          return {
            value: searchKnowledgeDocuments(controller.getDocuments(), query, {
              kind: command.kind,
              limit: Math.max(1, Math.min(50, Number(command.limit) || 20)),
            }).map(({ id, title, kind, source, url, tags, snippet, score }) => ({
              id, title, kind, source, url, tags, snippet, score,
            })),
          };
        },
      },
      {
        type: "knowledge.related",
        description: "Return related entries and backlinks for one indexed record.",
        permissions: ["read-content"],
        schema: {
          type: "object",
          required: ["documentId"],
          properties: { documentId: { type: "string", maxLength: 700 } },
          additionalProperties: false,
        },
        example: { type: "knowledge.related", documentId: "workspace:studies:memory" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["documentId"], commandIndex);
          const documentId = requireCommandString(command.documentId, "documentId", commandIndex, { maximumLength: 700 });
          return {
            value: {
              related: findRelatedDocuments(documentId, controller.getDocuments(), snapshot.links)
                .map(({ id, title, kind, source, url, sharedTerms, relatedScore }) => ({
                  id, title, kind, source, url, sharedTerms, relatedScore,
                })),
              backlinks: getBacklinks(documentId, snapshot.links, controller.getDocuments(), snapshot.glossary)
                .map(({ relation, origin, source }) => ({
                  relation,
                  origin,
                  source: {
                    id: source.id,
                    title: source.title,
                    kind: source.kind,
                    url: source.url ?? null,
                  },
                })),
            },
          };
        },
      },
      {
        type: "inferences.list",
        description: "List saved Knowledge Center inference results without returning stored evidence excerpts.",
        permissions: ["read-content"],
        schema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["pending", "accepted", "rejected"] },
          },
          additionalProperties: false,
        },
        example: { type: "inferences.list", status: "pending" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["status"], commandIndex);
          return {
            value: snapshot.inferenceSessions.flatMap((session) => (
              session.inferences
                .filter((inference) => !command.status || inference.status === command.status)
                .map((inference) => ({
                  sessionId: session.id,
                  sessionName: session.name,
                  id: inference.id,
                  kind: inference.kind,
                  title: inference.title,
                  statement: inference.statement,
                  confidence: inference.confidence,
                  confidenceRationale: inference.confidenceRationale,
                  citations: inference.citations,
                  tags: inference.tags,
                  status: inference.status,
                }))
            )),
          };
        },
      },
      {
        type: "inferences.update",
        description: "Edit, tag, accept, or reject one saved inference without changing source records.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["sessionId", "inferenceId", "changes"],
          properties: {
            sessionId: { type: "string", maxLength: 200 },
            inferenceId: { type: "string", maxLength: 200 },
            changes: { type: "object" },
          },
          additionalProperties: false,
        },
        example: {
          type: "inferences.update",
          sessionId: "inference-session-id",
          inferenceId: "inference-id",
          changes: { status: "accepted", tags: ["follow-up"] },
        },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["sessionId", "inferenceId", "changes"], commandIndex);
          const sessionId = requireCommandString(command.sessionId, "sessionId", commandIndex, { maximumLength: 200 });
          const inferenceId = requireCommandString(command.inferenceId, "inferenceId", commandIndex, { maximumLength: 200 });
          const changes = requireCommandRecord(command.changes, "changes", commandIndex);
          const allowed = new Set(["title", "statement", "tags", "status"]);
          const unknown = Object.keys(changes).find((key) => !allowed.has(key));
          if (unknown) throw new Error(`Unsupported inference field: ${unknown}.`);
          if (changes.status && !["pending", "accepted", "rejected"].includes(changes.status)) {
            throw new Error("Inference status must be pending, accepted, or rejected.");
          }
          const session = snapshot.inferenceSessions.find((candidate) => candidate.id === sessionId);
          const inference = session?.inferences.find((candidate) => candidate.id === inferenceId);
          if (!session || !inference) throw new Error("Inference not found.");
          const updated = {
            ...inference,
            ...(changes.title !== undefined
              ? { title: String(changes.title).trim().slice(0, 500) }
              : {}),
            ...(changes.statement !== undefined
              ? { statement: String(changes.statement).trim().slice(0, 12_000) }
              : {}),
            ...(Array.isArray(changes.tags)
              ? {
                tags: [...new Set(changes.tags.map((tag) => String(tag).trim()).filter(Boolean))]
                  .slice(0, 50),
              }
              : {}),
            ...(changes.status ? { status: changes.status } : {}),
          };
          return {
            state: {
              ...snapshot,
              inferenceSessions: snapshot.inferenceSessions.map((candidate) => (
                candidate.id === sessionId
                  ? {
                    ...candidate,
                    updatedAt: new Date().toISOString(),
                    inferences: candidate.inferences.map((item) => (
                      item.id === inferenceId ? updated : item
                    )),
                  }
                  : candidate
              )),
            },
            updatedIds: [inferenceId],
            value: updated,
          };
        },
      },
      {
        type: "glossary.list",
        description: "List shared glossary definitions, aliases, examples, links, and tags.",
        permissions: ["read-content"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "glossary.list" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return { value: snapshot.glossary };
        },
      },
      {
        type: "glossary.upsert",
        description: "Create or update one shared glossary entry.",
        permissions: ["create", "update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["entry"],
          properties: { entry: { type: "object" } },
          additionalProperties: false,
        },
        example: {
          type: "glossary.upsert",
          entry: { term: "LTP", definition: "Long-term potentiation.", aliases: [] },
        },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["entry"], commandIndex);
          const input = requireCommandRecord(command.entry, "entry", commandIndex);
          const current = input.id
            ? snapshot.glossary.find((entry) => entry.id === input.id)
            : null;
          const entry = normalizeGlossaryEntry({
            ...current,
            ...input,
            id: input.id || createId("glossary"),
            createdAt: current?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          return {
            state: {
              ...snapshot,
              glossary: current
                ? snapshot.glossary.map((candidate) => candidate.id === entry.id ? entry : candidate)
                : [...snapshot.glossary, entry],
            },
            [current ? "updatedIds" : "createdIds"]: [entry.id],
            value: entry,
          };
        },
      },
      {
        type: "glossary.delete",
        description: "Delete one glossary entry and its graph relationships.",
        permissions: ["delete"],
        mutates: true,
        schema: {
          type: "object",
          required: ["entryId"],
          properties: { entryId: { type: "string", maxLength: 700 } },
          additionalProperties: false,
        },
        example: { type: "glossary.delete", entryId: "glossary-id" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["entryId"], commandIndex);
          const entryId = requireCommandString(command.entryId, "entryId", commandIndex, { maximumLength: 700 });
          if (!snapshot.glossary.some((entry) => entry.id === entryId)) throw new Error("Glossary entry not found.");
          const graphId = `glossary:${entryId}`;
          return {
            state: {
              ...snapshot,
              glossary: snapshot.glossary.filter((entry) => entry.id !== entryId),
              links: snapshot.links.filter((link) => link.sourceId !== graphId && link.targetId !== graphId),
            },
            deletedIds: [entryId],
          };
        },
      },
      {
        type: "relationships.list",
        description: "List accepted links and pending AI relationship suggestions.",
        permissions: ["read-summary"],
        schema: {
          type: "object",
          properties: { status: { type: "string", enum: ["pending", "accepted", "rejected"] } },
          additionalProperties: false,
        },
        example: { type: "relationships.list", status: "pending" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["status"], commandIndex);
          return {
            value: snapshot.links.filter((link) => !command.status || link.status === command.status),
          };
        },
      },
      {
        type: "relationships.propose",
        description: "Add one reviewable AI relationship suggestion without accepting it.",
        permissions: ["create"],
        mutates: true,
        schema: {
          type: "object",
          required: ["sourceId", "targetId", "relation", "rationale"],
          properties: {
            sourceId: { type: "string" },
            targetId: { type: "string" },
            relation: { type: "string" },
            rationale: { type: "string" },
          },
          additionalProperties: false,
        },
        example: {
          type: "relationships.propose",
          sourceId: "entry-a",
          targetId: "entry-b",
          relation: "supports",
          rationale: "Both records discuss the same mechanism.",
        },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["sourceId", "targetId", "relation", "rationale"], commandIndex);
          const link = normalizeKnowledgeLink({
            id: createId("ai-link"),
            sourceId: requireCommandString(command.sourceId, "sourceId", commandIndex, { maximumLength: 700 }),
            targetId: requireCommandString(command.targetId, "targetId", commandIndex, { maximumLength: 700 }),
            relation: requireCommandString(command.relation, "relation", commandIndex, { maximumLength: 120 }),
            rationale: requireCommandString(command.rationale, "rationale", commandIndex, { maximumLength: 4_000 }),
            origin: "ai",
            status: "pending",
          });
          assertKnownNodes(snapshot, link);
          return {
            state: { ...snapshot, links: [...snapshot.links, link] },
            createdIds: [link.id],
            value: link,
          };
        },
      },
      {
        type: "relationships.add",
        description: "Add an accepted manual relationship between two known nodes.",
        permissions: ["create"],
        mutates: true,
        schema: {
          type: "object",
          required: ["sourceId", "targetId", "relation"],
          properties: {
            sourceId: { type: "string" },
            targetId: { type: "string" },
            relation: { type: "string" },
            rationale: { type: "string" },
          },
          additionalProperties: false,
        },
        example: {
          type: "relationships.add",
          sourceId: "entry-a",
          targetId: "entry-b",
          relation: "applies to",
        },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["sourceId", "targetId", "relation", "rationale"], commandIndex);
          const link = normalizeKnowledgeLink({
            id: createId("manual-link"),
            sourceId: requireCommandString(command.sourceId, "sourceId", commandIndex, { maximumLength: 700 }),
            targetId: requireCommandString(command.targetId, "targetId", commandIndex, { maximumLength: 700 }),
            relation: requireCommandString(command.relation, "relation", commandIndex, { maximumLength: 120 }),
            rationale: String(command.rationale ?? "").slice(0, 4_000),
            origin: "manual",
            status: "accepted",
          });
          assertKnownNodes(snapshot, link);
          return {
            state: { ...snapshot, links: [...snapshot.links, link] },
            createdIds: [link.id],
            value: link,
          };
        },
      },
      {
        type: "relationships.review",
        description: "Accept or reject one pending AI relationship suggestion.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["linkId", "status"],
          properties: {
            linkId: { type: "string" },
            status: { type: "string", enum: ["accepted", "rejected"] },
          },
          additionalProperties: false,
        },
        example: { type: "relationships.review", linkId: "ai-link-id", status: "accepted" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["linkId", "status"], commandIndex);
          const linkId = requireCommandString(command.linkId, "linkId", commandIndex, { maximumLength: 700 });
          if (!["accepted", "rejected"].includes(command.status)) throw new Error("Status must be accepted or rejected.");
          const link = snapshot.links.find((candidate) => candidate.id === linkId && candidate.origin === "ai");
          if (!link) throw new Error("AI relationship suggestion not found.");
          return {
            state: {
              ...snapshot,
              links: snapshot.links.map((candidate) => candidate.id === linkId
                ? normalizeKnowledgeLink({ ...candidate, status: command.status, updatedAt: new Date().toISOString() })
                : candidate),
            },
            updatedIds: [linkId],
          };
        },
      },
    ],
  };
}

function assertKnownNodes(snapshot, link) {
  const ids = new Set([
    ...snapshot.documents.map((document) => document.id),
    ...snapshot.glossary.map((entry) => `glossary:${entry.id}`),
  ]);
  if (!ids.has(link.sourceId) || !ids.has(link.targetId)) {
    throw new Error("Relationship source and target must both be known knowledge nodes.");
  }
}

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
