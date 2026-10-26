// Errors from players' browsers and from the server itself, grouped so the same bug seen by a
// hundred players is one line with a count. GMs read them in their panel; they are also logged.
// Kept in memory only: they are for noticing what breaks now, not a history.

import type { ErrorGroup, ErrorReport } from "../../shared/errors.ts";

const MAX_GROUPS = 100;
const MAX_DEVICES = 5;
/** Reports one address may send in an hour: a broken loop must not flood the server. */
const MAX_PER_HOUR = 60;

const groups = new Map<string, ErrorGroup>();
const senders = new Map<string, { count: number; since: number }>();

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, max) : "";
}

/**
 * Takes in one report: "taken", or refused as "junk" or because this address sent too many ("busy").
 * A browser's report is always marked as the client's, whatever it says about itself.
 */
export function report(raw: unknown, from: string, source: ErrorReport["source"] = "client"): "taken" | "junk" | "busy" {
  const now = Date.now();
  const sender = senders.get(from);
  if (sender && now - sender.since < 3600_000) {
    if (++sender.count > MAX_PER_HOUR) {
      return "busy";
    }
  } else {
    senders.set(from, { count: 1, since: now });
  }

  const input = (raw ?? {}) as Partial<Record<keyof ErrorReport, unknown>>;
  const entry: ErrorReport = {
    source,
    message: text(input.message, 300),
    where: text(input.where, 200),
    stack: text(input.stack, 1500),
    device: text(input.device, 120),
    version: text(input.version, 40),
    context: text(input.context, 120),
  };
  if (!entry.message) {
    return "junk";
  }

  const key = `${entry.source}|${entry.message}|${entry.where}`;
  let group = groups.get(key);
  if (!group) {
    // Room for the new one: the group not seen for longest goes.
    if (groups.size >= MAX_GROUPS) {
      const oldest = [...groups].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
      groups.delete(oldest[0]);
    }
    group = { ...entry, count: 0, firstAt: now, lastAt: now, devices: [] };
    groups.set(key, group);
  }
  group.count++;
  group.lastAt = now;
  group.stack = entry.stack || group.stack;
  group.context = entry.context || group.context;
  group.version = entry.version || group.version;
  if (entry.device && !group.devices.includes(entry.device) && group.devices.length < MAX_DEVICES) {
    group.devices.push(entry.device);
  }
  console.error(`[${entry.source} error] ${entry.message} @ ${entry.where} (${entry.device || "server"}; ${entry.context})`);
  return "taken";
}

/** An error in the server's own code. */
export function reportServer(error: unknown, context: string) {
  const err = error instanceof Error ? error : new Error(String(error));
  const where = err.stack?.split("\n")[1]?.trim() ?? "";
  report({ message: err.message, where, stack: err.stack, context }, "server", "server");
}

/** The most recent first. */
export function errorGroups(): ErrorGroup[] {
  return [...groups.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 50);
}

export function clearErrors() {
  groups.clear();
}
