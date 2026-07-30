/**
 * Shared file-path navigation for every Vital Pancakes page.
 *
 * The component derives a stable breadcrumb trail from the current route and
 * keeps browser back/forward controls in one predictable position.
 */

import { installGlobalGlossary } from "./app/glossary-ui.mjs";
import { scheduleKnowledgeSync } from "./app/knowledge-sync.mjs";
import { registerOfflineShell } from "./app/offline-shell.mjs?v=2";

const SITE_ROOT = new URL("./", import.meta.url);

registerOfflineShell().catch((error) => {
  console.error("Offline service worker registration failed.", error);
});

const PAGE_TRAILS = {
  "": [],
  "download-app.html": [
    segment("download-app"),
  ],
  "research-literature.html": [
    segment("research-literature", "research-literature.html"),
  ],
  "research_publications": [
    segment("research-literature", "research-literature.html"),
    segment("research-publications"),
  ],
  "literature_analysis": [
    segment("research-literature", "research-literature.html"),
    segment("literature-analysis"),
  ],
  "educational_resources": [
    segment("educational-resources", "educational_resources/"),
  ],
  "educational_resources/arts": [
    segment("educational-resources", "educational_resources/"),
    segment("arts"),
  ],
  "educational_resources/arts/flashcard-practice.html": [
    segment("educational-resources", "educational_resources/"),
    segment("arts", "educational_resources/arts/"),
    segment("flashcard-practice"),
  ],
  "educational_resources/compsci": [
    segment("educational-resources", "educational_resources/"),
    segment("computer-science"),
  ],
  "educational_resources/mathematics": [
    segment("educational-resources", "educational_resources/"),
    segment("mathematics"),
  ],
  "educational_resources/mathematics/flashcard-practice.html": [
    segment("educational-resources", "educational_resources/"),
    segment("mathematics", "educational_resources/mathematics/"),
    segment("flashcard-practice"),
  ],
  "educational_resources/neurosci": [
    segment("educational-resources", "educational_resources/"),
    segment("neuroscience"),
  ],
  "tools/architecture.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("software-architect"),
  ],
  "tools/ai-command-center.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("ai-command-center"),
  ],
  "tools/budget-finance.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("budget-finance"),
  ],
  "tools/bracket-generator.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("bracket-generator"),
  ],
  "tools/caption-relay.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("caption-relay"),
  ],
  "tools/file-converter.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("file-converter"),
  ],
  "tools/file-drop.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("file-drop"),
  ],
  "tools/graphing.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("graphing-tool"),
  ],
  "tools/inference.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("inference-tool"),
  ],
  "tools/markdown-studio.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("markdown-and-latex-studio"),
  ],
  "tools/overhead.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("overhead"),
  ],
  "tools/randomized-picker.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("randomized-picker"),
  ],
  "tools/scientific-calculator.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("scientific-calculator"),
  ],
  "tools/pdf-signer.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("pdf-signer"),
  ],
  "tools/literature-analyzer.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("literature-analyzer"),
  ],
  "tools/master-lesson-builder.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("master-lesson-builder"),
  ],
  "tools/travel-planner.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("travel-planner"),
  ],
  "tools/tool-designer.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("tool-designer-and-planner"),
  ],
  "tools/color-aesthetic.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("color-aesthetic-generator"),
  ],
  "tools/visual-board.html": [
    segment("workspace", "workspace.html#area=tools"),
    segment("visual-board"),
  ],
};

function segment(label, href = null) {
  return { label, href };
}

function getPageKey() {
  const rootPath = SITE_ROOT.pathname.endsWith("/") ? SITE_ROOT.pathname : `${SITE_ROOT.pathname}/`;
  let relativePath = decodeURIComponent(location.pathname);
  if (relativePath.startsWith(rootPath)) relativePath = relativePath.slice(rootPath.length);
  relativePath = relativePath.replace(/^\/+/, "").replace(/index\.html$/i, "").replace(/\/+$/, "");
  return relativePath;
}

function getTrail() {
  const pageKey = getPageKey();
  if (pageKey === "workspace.html") return getWorkspaceTrail();
  const configuredTrail = PAGE_TRAILS[pageKey];
  if (configuredTrail) return configuredTrail;

  const parts = pageKey.split("/").filter(Boolean);
  return parts.map((part, index) => {
    const isLast = index === parts.length - 1;
    const label = slugify(part.replace(/\.html$/i, ""));
    const href = isLast ? null : `${parts.slice(0, index + 1).join("/")}/`;
    return segment(label, href);
  });
}

function getWorkspaceTrail() {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const requestedArea = parameters.get("area");
  const sectionId = parameters.get("section");
  const itemId = parameters.get("item");
  const activeLink = document.querySelector("[data-site-area][aria-current='page']");
  const activeArea = requestedArea || activeLink?.dataset.siteArea || "tools";
  const areaLabel = {
    everyday: "everyday-life",
    protocols: "everyday-life",
    studies: "studies-and-projects",
    tools: "workspace",
  }[activeArea] || "workspace";
  const trail = [
    segment(
      areaLabel,
      sectionId ? `workspace.html#area=${encodeURIComponent(activeArea)}` : null,
    ),
  ];

  if (sectionId) {
    const workspaceMain = document.querySelector("#app-main");
    const sectionTitle = workspaceMain?.dataset.sectionTitle || sectionId;
    trail.push(
      segment(
        slugify(sectionTitle),
        itemId ? `workspace.html#section=${encodeURIComponent(sectionId)}` : null,
      ),
    );
  }

  if (sectionId && itemId) {
    const workspaceMain = document.querySelector("#app-main");
    const itemTitle = workspaceMain?.dataset.itemTitle || itemId;
    trail.push(segment(slugify(itemTitle)));
  }
  return trail;
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function renderPathNavigation() {
  const header = document.querySelector(".site-header");
  if (!header) return;

  let navigation = document.querySelector(".path-navigation");
  if (!navigation) {
    navigation = document.createElement("nav");
    navigation.className = "path-navigation";
    navigation.setAttribute("aria-label", "Current page path and browser history");

    const trail = document.createElement("ol");
    trail.className = "path-navigation-trail";
    const historyControls = document.createElement("div");
    historyControls.className = "path-history-controls";
    historyControls.append(
      createHistoryButton("back", "←", () => history.back()),
      createHistoryButton("forward", "→", () => history.forward()),
    );
    navigation.append(trail, historyControls);
    header.insertAdjacentElement("afterend", navigation);
    document.body.classList.add("has-path-navigation");
  }

  const trail = navigation.querySelector(".path-navigation-trail");
  trail.replaceChildren();
  const fullTrail = [segment("mainpage", "index.html"), ...getTrail()];
  fullTrail.forEach((pathSegment, index) => {
    const item = document.createElement("li");
    const isCurrent = index === fullTrail.length - 1;
    if (pathSegment.href && !isCurrent) {
      const link = document.createElement("a");
      link.href = new URL(pathSegment.href, SITE_ROOT).href;
      link.textContent = pathSegment.label;
      item.append(link);
    } else {
      const current = document.createElement("span");
      current.textContent = pathSegment.label;
      if (isCurrent) current.setAttribute("aria-current", "page");
      item.append(current);
    }
    trail.append(item);
  });
}

function createHistoryButton(direction, glyph, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `path-history-button path-history-${direction}`;
  button.setAttribute("aria-label", `Go ${direction}`);
  button.title = `Go ${direction}`;
  button.textContent = glyph;
  button.addEventListener("click", action);
  return button;
}

renderPathNavigation();
window.addEventListener("hashchange", () => window.setTimeout(renderPathNavigation, 0));

const workspaceMain = document.querySelector("#app-main");
if (workspaceMain) {
  new MutationObserver(renderPathNavigation).observe(workspaceMain, {
    childList: true,
    subtree: true,
  });
}

installGlobalGlossary();
scheduleKnowledgeSync();
window.addEventListener("storage", () => scheduleKnowledgeSync());
window.addEventListener("workspace:changed", () => scheduleKnowledgeSync());
