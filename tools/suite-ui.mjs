/**
 * Small safe-DOM helpers shared by the local-first workspace suite.
 */

export function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

export function setBusy(elementNode, busy, label = "Working…") {
  if (!elementNode) return;
  if (busy) {
    elementNode.dataset.previousLabel = elementNode.textContent;
    elementNode.textContent = label;
    elementNode.disabled = true;
    elementNode.setAttribute("aria-busy", "true");
  } else {
    elementNode.textContent = elementNode.dataset.previousLabel || elementNode.textContent;
    elementNode.disabled = false;
    elementNode.removeAttribute("aria-busy");
  }
}

export function createToastRegion() {
  let region = document.querySelector(".suite-toast-region");
  if (region) return region;
  region = element("div", "suite-toast-region");
  region.setAttribute("aria-live", "polite");
  document.body.append(region);
  return region;
}

export function toast(message, tone = "info") {
  const region = createToastRegion();
  const item = element("div", `suite-toast suite-toast-${tone}`, message);
  region.append(item);
  setTimeout(() => item.remove(), 4200);
}

export function activateTabs(container, onChange = () => {}) {
  const tabs = [...container.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    tabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute("aria-selected", String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(candidate.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
    });
    onChange(tab.dataset.tab ?? tab.id);
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let targetIndex = index;
      if (event.key === "ArrowLeft") targetIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") targetIndex = (index + 1) % tabs.length;
      if (event.key === "Home") targetIndex = 0;
      if (event.key === "End") targetIndex = tabs.length - 1;
      tabs[targetIndex].focus();
      select(tabs[targetIndex]);
    });
  });
  return { select };
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value / 1024;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)} ${units[index]}`;
}

export function parseTags(value) {
  return [...new Set(String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean))];
}

export function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function debounce(callback, wait = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), wait);
  };
}

export function trapDialog(dialog) {
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )].filter((node) => !node.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}
