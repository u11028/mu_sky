// Sends errors that happen in this browser to the server, where GMs see them grouped: a bug on a
// player's phone shows up without anyone having to report it. Each error is sent once per visit,
// and only a few per visit, so a loop that keeps failing can't flood anything.

import type { ErrorReport } from "../../shared/errors.ts";

declare const __BUILD__: string;

const MAX_PER_VISIT = 10;
/** Noise from the browser or its extensions, not from the game. */
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /extension:\/\//i, /AbortError/i];

const sent = new Set<string>();

function device() {
  const agent = navigator.userAgent;
  const phone = /Android [\d.]+|iPhone OS [\d_]+|iPad|Windows NT [\d.]+|Mac OS X [\d_]+/.exec(agent)?.[0] ?? "";
  const browser = /(Edg|SamsungBrowser|Firefox|CriOS|Chrome|Version)\/[\d.]+/.exec(agent)?.[0] ?? "";
  return `${phone} ${browser} ${innerWidth}x${innerHeight}`.trim();
}

export function startErrorReports(context: () => string) {
  const send = (message: string, where: string, stack = "") => {
    const key = `${message}|${where}`;
    if (!message || sent.has(key) || sent.size >= MAX_PER_VISIT || IGNORED.some((pattern) => pattern.test(message) || pattern.test(where))) {
      return;
    }
    sent.add(key);
    let doing = "";
    try {
      doing = context();
    } catch {
      // Too early in the page's start for the game to say where the player is.
    }
    const report: ErrorReport = {
      source: "client",
      message: message.slice(0, 300),
      where: where.slice(0, 200),
      stack: stack.slice(0, 1500),
      device: device(),
      version: __BUILD__,
      context: doing.slice(0, 120),
    };
    // keepalive: still sent when the error comes as the page closes.
    void fetch("api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => undefined);
  };

  addEventListener("error", (event) => {
    const where = event.filename ? `${event.filename.split("/").pop()}:${event.lineno}:${event.colno}` : "";
    send(event.message, where, (event.error as Error | undefined)?.stack);
  });
  addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as Error | string | undefined;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    send(error.message, error.stack?.split("\n")[1]?.trim() ?? "promise", error.stack);
  });
}
