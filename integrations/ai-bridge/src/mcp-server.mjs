import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { PERMISSIONS } from "./constants.mjs";

const pageIdSchema = z.string().min(1).max(160).optional();
const toolIdSchema = z.string().min(1).max(120);
const permissionSchema = z.enum(PERMISSIONS);
const jsonObjectSchema = z.record(z.string(), z.unknown());

export function createVitalPancakesMcpServer(broker) {
  const server = new McpServer({
    name: "vital-pancakes",
    version: "0.1.0",
    description: "Controls explicitly connected Vital Pancakes pages through their validated AI command API.",
  });

  server.registerTool(
    "vp_list_tools",
    {
      title: "List Vital Pancakes tools",
      description: "List connected Vital Pancakes pages and the AI-capable tools each page exposes.",
      inputSchema: z.object({ pageId: pageIdSchema }).strict(),
      annotations: readOnlyAnnotations(),
    },
    async ({ pageId }) => safeToolCall(async () => {
      const pages = broker.listPages();
      if (pages.length === 0) {
        return {
          pages,
          tools: [],
          warning: "No page is connected. Open Vital Pancakes and connect the tab from the extension.",
        };
      }
      const selectedPages = pageId
        ? pages.filter((page) => page.pageId === pageId)
        : pages;
      if (pageId && selectedPages.length === 0) {
        throw bridgeError("page_not_connected", `Connected page not found: ${pageId}`);
      }
      const toolsByPage = await Promise.all(selectedPages.map(async (page) => ({
        pageId: page.pageId,
        tools: await broker.request("listTools", { args: [] }, { pageId: page.pageId }),
      })));
      return { pages, toolsByPage };
    }),
  );

  server.registerTool(
    "vp_get_capabilities",
    {
      title: "Get tool capabilities",
      description: "Read the truthful command schema, examples, permissions, and limits for one Vital Pancakes tool.",
      inputSchema: z.object({
        toolId: toolIdSchema,
        pageId: pageIdSchema,
      }).strict(),
      annotations: readOnlyAnnotations(),
    },
    async ({ toolId, pageId }) => safeToolCall(() => broker.request(
      "getCapabilities",
      { args: [toolId] },
      { pageId },
    )),
  );

  server.registerTool(
    "vp_get_context",
    {
      title: "Get approved tool context",
      description: "Read compact context from one Vital Pancakes tool. The page applies its permission and sensitive-data rules.",
      inputSchema: z.object({
        toolId: toolIdSchema,
        options: jsonObjectSchema.optional(),
        pageId: pageIdSchema,
      }).strict(),
      annotations: readOnlyAnnotations(),
    },
    async ({ toolId, options = {}, pageId }) => safeToolCall(() => broker.request(
      "getContext",
      { args: [toolId, options] },
      { pageId },
    )),
  );

  server.registerTool(
    "vp_preview_commands",
    {
      title: "Preview Vital Pancakes commands",
      description: "Validate and preview a command envelope without mutating the connected tool.",
      inputSchema: z.object({
        envelope: jsonObjectSchema,
        grantedPermissions: z.array(permissionSchema).max(PERMISSIONS.length).default([]),
        pageId: pageIdSchema,
      }).strict(),
      annotations: readOnlyAnnotations(),
    },
    async ({ envelope, grantedPermissions, pageId }) => safeToolCall(() => {
      if (envelope.mode !== "preview") {
        throw bridgeError(
          "preview_mode_required",
          'vp_preview_commands requires envelope.mode to be "preview".',
        );
      }
      return broker.request(
        "dispatch",
        { args: [envelope, { grantedPermissions }] },
        { pageId },
      );
    }),
  );

  server.registerTool(
    "vp_apply_commands",
    {
      title: "Apply Vital Pancakes commands",
      description: "Apply one validated command envelope to an explicitly connected Vital Pancakes tool.",
      inputSchema: z.object({
        envelope: jsonObjectSchema,
        grantedPermissions: z.array(permissionSchema).max(PERMISSIONS.length).default([]),
        pageId: pageIdSchema,
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ envelope, grantedPermissions, pageId }) => safeToolCall(() => {
      if (envelope.mode !== "apply") {
        throw bridgeError(
          "apply_mode_required",
          'vp_apply_commands requires envelope.mode to be "apply".',
        );
      }
      return broker.request(
        "dispatch",
        { args: [envelope, { grantedPermissions }] },
        { pageId },
      );
    }),
  );

  server.registerTool(
    "vp_undo",
    {
      title: "Undo a tool command",
      description: "Undo the latest supported action in a connected Vital Pancakes tool.",
      inputSchema: z.object({
        toolId: toolIdSchema,
        pageId: pageIdSchema,
      }).strict(),
      annotations: mutationAnnotations(),
    },
    async ({ toolId, pageId }) => safeToolCall(() => broker.request(
      "undo",
      { args: [toolId] },
      { pageId },
    )),
  );

  server.registerTool(
    "vp_redo",
    {
      title: "Redo a tool command",
      description: "Redo the latest supported action in a connected Vital Pancakes tool.",
      inputSchema: z.object({
        toolId: toolIdSchema,
        pageId: pageIdSchema,
      }).strict(),
      annotations: mutationAnnotations(),
    },
    async ({ toolId, pageId }) => safeToolCall(() => broker.request(
      "redo",
      { args: [toolId] },
      { pageId },
    )),
  );

  server.registerTool(
    "vp_export",
    {
      title: "Export from a Vital Pancakes tool",
      description: "Ask a connected Vital Pancakes tool to perform an approved export.",
      inputSchema: z.object({
        toolId: toolIdSchema,
        options: jsonObjectSchema.optional(),
        grantedPermissions: z.array(permissionSchema).max(PERMISSIONS.length).default([]),
        pageId: pageIdSchema,
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ toolId, options = {}, grantedPermissions, pageId }) => safeToolCall(
      () => broker.request(
        "exportTool",
        { args: [toolId, { ...options, grantedPermissions }] },
        { pageId, timeoutMs: 120_000 },
      ),
    ),
  );

  return server;
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function mutationAnnotations() {
  return {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  };
}

async function safeToolCall(operation) {
  try {
    const result = await operation();
    const output = { ok: true, result };
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    };
  } catch (error) {
    const output = {
      ok: false,
      error: {
        code: String(error?.code || "bridge_failure"),
        message: error instanceof Error ? error.message : "Vital Pancakes bridge request failed.",
        ...(error?.details ? { details: error.details } : {}),
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
      isError: true,
    };
  }
}

function bridgeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
