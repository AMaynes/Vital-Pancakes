/**
 * Document Picture-in-Picture caption overlay with a normal popup fallback.
 * Imported caption text is assigned through textContent only.
 */

const DEFAULT_SETTINGS = Object.freeze({
  fontFamily: "Georgia, serif",
  fontSizePx: 34,
  color: "#ffffff",
  background: "#171613cc",
  verticalPlacement: "bottom",
  bilingual: false,
});

export class CaptionOverlaySupersededError extends Error {
  constructor() {
    super("Caption overlay opening was superseded by a newer request.");
    this.name = "AbortError";
    this.code = "CAPTION_OVERLAY_SUPERSEDED";
  }
}

export class CaptionDisplayClock {
  constructor({
    tick,
    requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
    cancelFrame = (frameId) => globalThis.cancelAnimationFrame(frameId),
    now = () => globalThis.performance.now(),
  } = {}) {
    if (typeof tick !== "function") throw new TypeError("Caption display clock requires a tick callback.");
    this.tick = tick;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.now = now;
    this.frameId = null;
    this.running = false;
    this.handleFrame = this.handleFrame.bind(this);
  }

  start() {
    if (this.running) return false;
    this.running = true;
    this.tick(this.now());
    this.schedule();
    return true;
  }

  stop() {
    const wasRunning = this.running;
    this.running = false;
    if (this.frameId !== null) {
      this.cancelFrame(this.frameId);
      this.frameId = null;
    }
    return wasRunning;
  }

  schedule() {
    if (!this.running || this.frameId !== null) return;
    this.frameId = this.requestFrame(this.handleFrame);
  }

  handleFrame(timestamp) {
    this.frameId = null;
    if (!this.running) return;
    this.tick(Number.isFinite(timestamp) ? timestamp : this.now());
    this.schedule();
  }
}

export class CaptionOverlay {
  constructor({ onClose = () => {} } = {}) {
    this.settings = { ...DEFAULT_SETTINGS };
    this.window = null;
    this.elements = null;
    this.hideControlsTimer = null;
    this.windowCloseListener = null;
    this.onClose = onClose;
    this.openGeneration = 0;
  }

  async open() {
    const generation = this.openGeneration + 1;
    this.openGeneration = generation;
    this.closeCurrentWindow();

    let windowRef;
    let mode;
    try {
      if (globalThis.documentPictureInPicture?.requestWindow) {
        windowRef = await globalThis.documentPictureInPicture.requestWindow({ width: 900, height: 220 });
        mode = "document-picture-in-picture";
      } else {
        windowRef = globalThis.window.open("", "vital-pancakes-caption-relay", "popup,width=900,height=260");
        if (!windowRef) throw new Error("The caption popup was blocked. Allow popups and try again.");
        mode = "popup";
      }
    } catch (error) {
      if (generation !== this.openGeneration) throw createSupersededOpenError();
      throw error;
    }

    if (generation !== this.openGeneration) {
      closeSupersededWindow(windowRef, this.window);
      throw createSupersededOpenError();
    }

    this.window = windowRef;
    this.mode = mode;
    try {
      this.buildDocument();
      this.listenForWindowClose(windowRef);
    } catch (error) {
      if (this.window === windowRef) this.close();
      else closeSupersededWindow(windowRef, this.window);
      throw error;
    }
    return mode;
  }

  update({
    sourceText = "",
    translatedText = "",
    status = "",
    visible = false,
    matched = false,
  } = {}) {
    if (!this.isOpen() || !this.elements) return;
    this.elements.status.textContent = status;
    this.elements.source.textContent = sourceText;
    this.elements.target.textContent = translatedText;
    this.elements.source.hidden = !this.settings.bilingual || !sourceText;
    this.elements.caption.hidden = !visible;
    this.elements.noMatch.hidden = matched;
    this.elements.noMatch.textContent = status || "No matching video detected";
  }

  applySettings(settings = {}) {
    this.settings = { ...this.settings, ...settings };
    if (!this.isOpen() || !this.elements) return;
    const root = this.elements.root;
    root.style.setProperty("--relay-font-family", this.settings.fontFamily);
    root.style.setProperty("--relay-font-size", `${clamp(Number(this.settings.fontSizePx), 16, 80)}px`);
    root.style.setProperty("--relay-color", this.settings.color);
    root.style.setProperty("--relay-background", this.settings.background);
    root.dataset.placement = this.settings.verticalPlacement;
    this.elements.source.hidden = !this.settings.bilingual || !this.elements.source.textContent;
  }

  close() {
    this.openGeneration += 1;
    this.closeCurrentWindow();
  }

  closeCurrentWindow() {
    const windowRef = this.window;
    if (!windowRef) return;
    this.releaseWindow(windowRef);
    if (!windowRef.closed) windowRef.close?.();
  }

  isOpen() {
    if (!this.window) return false;
    if (this.window.closed) {
      this.releaseWindow(this.window);
      return false;
    }
    return true;
  }

  listenForWindowClose(windowRef) {
    this.removeWindowCloseListener();
    const handleClose = () => this.releaseWindow(windowRef);
    windowRef.addEventListener?.("pagehide", handleClose, { once: true });
    windowRef.addEventListener?.("beforeunload", handleClose, { once: true });
    this.windowCloseListener = { windowRef, handleClose };
  }

  removeWindowCloseListener() {
    if (!this.windowCloseListener) return;
    const { windowRef, handleClose } = this.windowCloseListener;
    windowRef.removeEventListener?.("pagehide", handleClose);
    windowRef.removeEventListener?.("beforeunload", handleClose);
    this.windowCloseListener = null;
  }

  releaseWindow(windowRef) {
    if (this.window !== windowRef) return;
    this.removeWindowCloseListener();
    clearTimeout(this.hideControlsTimer);
    this.hideControlsTimer = null;
    this.window = null;
    this.elements = null;
    this.mode = null;
    this.onClose();
  }

  buildDocument() {
    const documentRef = this.window.document;
    documentRef.title = "Caption Relay Overlay";
    documentRef.body.replaceChildren();
    const style = documentRef.createElement("style");
    style.textContent = `
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; overflow: hidden; background: transparent; font-family: system-ui, sans-serif; }
      main { --relay-font-family: Georgia, serif; --relay-font-size: 34px; --relay-color: #fff; --relay-background: #171613cc;
        min-height: 100vh; display: flex; align-items: flex-end; justify-content: center; padding: 18px; }
      main[data-placement="top"] { align-items: flex-start; }
      main[data-placement="middle"] { align-items: center; }
      .caption { max-width: min(94vw, 1100px); padding: .25em .5em; border-radius: 4px; background: var(--relay-background);
        color: var(--relay-color); font-family: var(--relay-font-family); font-size: var(--relay-font-size); line-height: 1.22; text-align: center;
        text-shadow: 0 2px 4px #000; white-space: pre-wrap; }
      .source { display: block; margin-bottom: .2em; color: color-mix(in srgb, var(--relay-color), #d2b675 35%); font-size: .62em; }
      .no-match { padding: 7px 11px; border: 1px solid #d2b675; background: #171613e8; color: #f4f1e8; font-size: 13px; }
      .controls { position: fixed; inset: 8px 8px auto; display: flex; justify-content: space-between; gap: 10px; padding: 6px 8px;
        background: #171613e8; color: #f4f1e8; font-size: 11px; transition: opacity .2s; }
      .controls.is-hidden { opacity: 0; pointer-events: none; }
    `;
    const root = documentRef.createElement("main");
    const controls = documentRef.createElement("div");
    controls.className = "controls";
    const label = documentRef.createElement("strong");
    label.textContent = "Caption Relay";
    const status = documentRef.createElement("span");
    status.textContent = "Waiting for matching audio";
    controls.append(label, status);
    const caption = documentRef.createElement("div");
    caption.className = "caption";
    caption.hidden = true;
    const source = documentRef.createElement("span");
    source.className = "source";
    const target = documentRef.createElement("span");
    caption.append(source, target);
    const noMatch = documentRef.createElement("div");
    noMatch.className = "no-match";
    noMatch.textContent = "No matching video detected";
    root.append(controls, caption, noMatch);
    documentRef.head.replaceChildren(style);
    documentRef.body.append(root);
    this.elements = { root, controls, status, caption, source, target, noMatch };
    const revealControls = () => {
      controls.classList.remove("is-hidden");
      clearTimeout(this.hideControlsTimer);
      this.hideControlsTimer = setTimeout(() => controls.classList.add("is-hidden"), 2_200);
    };
    documentRef.addEventListener("pointermove", revealControls);
    documentRef.addEventListener("keydown", revealControls);
    revealControls();
    this.applySettings(this.settings);
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function closeSupersededWindow(windowRef, activeWindow) {
  if (!windowRef || windowRef === activeWindow || windowRef.closed) return;
  windowRef.close?.();
}

function createSupersededOpenError() {
  return new CaptionOverlaySupersededError();
}
