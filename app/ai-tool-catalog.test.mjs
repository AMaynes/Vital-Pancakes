import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AI_TOOL_CATALOG,
  CURRENT_AI_TOOLS,
  PLANNED_AI_TOOL_CONTRACTS,
} from "./ai-tool-catalog.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("every Workspace tool route has a maintained AI adapter contract", () => {
  const mainSource = readFileSync(resolve(repositoryRoot, "app/main.js"), "utf8");
  const workspaceRoutes = [...mainSource.matchAll(/href:\s*"(tools\/[^"]+\.html)"/g)]
    .map((match) => match[1]);
  const catalogRoutes = CURRENT_AI_TOOLS
    .filter((tool) => tool.route.startsWith("tools/"))
    .map((tool) => tool.route);

  assert.deepEqual(
    [...new Set(catalogRoutes)].sort(),
    [...new Set(workspaceRoutes)].sort(),
    "Update app/ai-tool-catalog.mjs and the tool adapter whenever a Workspace tool changes.",
  );
});

test("available tool contracts point to real routes and adapter modules", () => {
  CURRENT_AI_TOOLS.forEach((tool) => {
    assert.equal(tool.available, true);
    assert.equal(existsSync(resolve(repositoryRoot, tool.route)), true, tool.route);
    assert.equal(
      existsSync(resolve(repositoryRoot, tool.adapterModule)),
      true,
      `${tool.id} is missing ${tool.adapterModule}`,
    );
  });
});

test("every available tool page installs the shared AI page host", () => {
  CURRENT_AI_TOOLS.forEach((tool) => {
    const routePath = resolve(repositoryRoot, tool.route);
    const routeSource = readFileSync(routePath, "utf8");
    const moduleSources = [...routeSource.matchAll(
      /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*>/gi,
    )]
      .map((match) => match[1].split(/[?#]/, 1)[0])
      .filter((source) => !/^[a-z]+:/i.test(source))
      .map((source) => resolve(dirname(routePath), source))
      .filter(existsSync)
      .map((source) => readFileSync(source, "utf8"))
      .join("\n");

    assert.match(
      moduleSources,
      /\b(?:installAiPageHost|installCurrentToolAiHost)\s*\(/,
      `${tool.id} must install its adapter from a module loaded by ${tool.route}`,
    );
  });
});

test("tool identifiers are unique and planned contracts are never advertised as available", () => {
  const identifiers = AI_TOOL_CATALOG.map((tool) => tool.id);
  assert.equal(new Set(identifiers).size, identifiers.length);
  PLANNED_AI_TOOL_CONTRACTS.forEach((tool) => {
    assert.equal(tool.available, false);
    assert.equal(tool.route, null);
    assert.equal(tool.adapterModule, null);
  });
});

test("durable repository instructions require AI adapter maintenance", () => {
  const instructions = readFileSync(resolve(repositoryRoot, "AGENTS.md"), "utf8");
  assert.match(instructions, /AI command compatibility is mandatory/i);
  assert.match(instructions, /update that tool's AI adapter/i);
});
