import { randomUUID } from "node:crypto";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "./constants.mjs";
import {
  assertAllowedPage,
  BridgeProtocolError,
  createGatewayRequest,
} from "./protocol.mjs";

export class BridgeUnavailableError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BridgeUnavailableError";
    this.code = code;
  }
}

export class BridgeBroker {
  #allowedOrigins;
  #connection = null;
  #pages = new Map();
  #pending = new Map();
  #activePageId = null;

  constructor({ allowedPageOrigins }) {
    this.#allowedOrigins = allowedPageOrigins;
  }

  attachConnection(connection) {
    if (this.#connection && this.#connection !== connection) {
      this.#connection.close(4001, "A newer authenticated extension replaced this connection.");
    }
    this.#rejectPending("bridge_replaced", "The browser bridge connection was replaced.");
    this.#connection = connection;
    this.#pages.clear();
    this.#activePageId = null;
  }

  detachConnection(connection) {
    if (this.#connection !== connection) return;
    this.#connection = null;
    this.#pages.clear();
    this.#activePageId = null;
    this.#rejectPending("bridge_disconnected", "The browser bridge disconnected.");
  }

  syncPages(connection, pages) {
    if (this.#connection !== connection) {
      throw new BridgeProtocolError("stale_connection", "The bridge connection is no longer active.");
    }
    const nextPages = new Map();
    for (const page of pages) {
      assertAllowedPage(page, this.#allowedOrigins);
      nextPages.set(page.pageId, Object.freeze({ ...page }));
    }
    this.#pages = nextPages;
    if (!nextPages.has(this.#activePageId)) {
      this.#activePageId = pages.at(-1)?.pageId ?? null;
    }
  }

  setActivePage(connection, pageId) {
    if (this.#connection !== connection || !this.#pages.has(pageId)) return;
    this.#activePageId = pageId;
  }

  listPages() {
    return [...this.#pages.values()].map((page) => ({ ...page }));
  }

  async request(method, params = {}, {
    pageId,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {}) {
    if (!this.#connection) {
      throw new BridgeUnavailableError(
        "bridge_not_connected",
        "No paired Vital Pancakes browser extension is connected.",
      );
    }
    const page = this.#selectPage(pageId);
    const requestId = randomUUID();
    const boundedTimeoutMs = Math.min(Math.max(Number(timeoutMs) || 1, 250), 120_000);
    const message = createGatewayRequest({
      requestId,
      pageId: page.pageId,
      method,
      params,
      deadlineMs: Date.now() + boundedTimeoutMs,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        this.#connection?.send({
          protocolVersion: 1,
          kind: "cancel",
          requestId,
          pageId: page.pageId,
        });
        reject(new BridgeUnavailableError(
          "bridge_timeout",
          `The Vital Pancakes page did not answer within ${boundedTimeoutMs} ms.`,
        ));
      }, boundedTimeoutMs);
      timer.unref?.();
      this.#pending.set(requestId, { resolve, reject, timer, pageId: page.pageId });
      try {
        this.#connection.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(requestId);
        reject(error);
      }
    });
  }

  handleResponse(connection, message) {
    if (this.#connection !== connection) return false;
    const pending = this.#pending.get(message.requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.#pending.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      const error = new BridgeUnavailableError(
        String(message.error?.code || "page_request_failed"),
        String(message.error?.message || "The Vital Pancakes page rejected the request."),
      );
      error.details = message.error?.details;
      pending.reject(error);
    }
    return true;
  }

  #selectPage(pageId) {
    if (pageId) {
      const page = this.#pages.get(pageId);
      if (!page) {
        throw new BridgeUnavailableError(
          "page_not_connected",
          `The requested Vital Pancakes page is not connected: ${pageId}`,
        );
      }
      return page;
    }
    if (this.#activePageId && this.#pages.has(this.#activePageId)) {
      return this.#pages.get(this.#activePageId);
    }
    if (this.#pages.size === 1) return this.#pages.values().next().value;
    if (this.#pages.size === 0) {
      throw new BridgeUnavailableError(
        "page_not_connected",
        "Open Vital Pancakes and use the extension to connect that tab.",
      );
    }
    throw new BridgeUnavailableError(
      "page_required",
      "More than one Vital Pancakes page is connected; provide pageId.",
    );
  }

  #rejectPending(code, message) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new BridgeUnavailableError(code, message));
    }
    this.#pending.clear();
  }
}
