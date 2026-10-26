// Reports players make about each other, for the GMs to look at. Kept with the progress (MongoDB or
// a JSON file) so a restart doesn't lose them; closed reports are dropped.

import { dataFile } from "./environment.ts";
import { loadRecords, saveRecords } from "./store.ts";
import { REPORTS_TO_MUTE } from "../../shared/safety.ts";

interface Report {
  at: number;
  reporterId: string;
  reporter: string;
  targetId: string;
  target: string;
  reason: string;
  note: string;
  region: string;
  chats: string[];
}

const MAX_REPORTS = 300;
/** The same player reporting the same other player again within this time is not a new report. */
const AGAIN_MS = 10 * 60_000;
/** Reports one player may make in an hour. */
const MAX_PER_HOUR = 10;
const HOUR_MS = 3600_000;

const file = process.env.REPORTS_FILE ?? dataFile("reports.json");
const reports = await loadRecords<Report>("reports", file);
let nextId = Math.max(0, ...[...reports.keys()].map((id) => Number(id.slice(1)) || 0)) + 1;

/**
 * Takes in a report: "taken", or refused as one already made ("again") or one too many ("busy").
 * `mute` is true when enough different players reported the target within the hour.
 */
export function fileReport(entry: Omit<Report, "at">): { result: "taken" | "again" | "busy"; mute?: boolean } {
  const now = Date.now();
  const all = [...reports.values()];
  if (all.some((r) => r.reporterId === entry.reporterId && r.targetId === entry.targetId && now - r.at < AGAIN_MS)) {
    return { result: "again" };
  }
  if (all.filter((r) => r.reporterId === entry.reporterId && now - r.at < HOUR_MS).length >= MAX_PER_HOUR) {
    return { result: "busy" };
  }

  reports.set(`r${nextId++}`, { ...entry, at: now });
  while (reports.size > MAX_REPORTS) {
    reports.delete(reports.keys().next().value!);
  }
  saveRecords("reports", file, reports);

  const reporters = new Set(
    [...reports.values()].filter((r) => r.targetId === entry.targetId && now - r.at < HOUR_MS).map((r) => r.reporterId),
  );
  return { result: "taken", mute: reporters.size >= REPORTS_TO_MUTE };
}

/** Open reports, newest first, with the target's id for the room to act on. */
export function openReports() {
  const counts = new Map<string, number>();
  for (const report of reports.values()) {
    counts.set(report.targetId, (counts.get(report.targetId) ?? 0) + 1);
  }
  return [...reports]
    .map(([id, report]) => ({ id, ...report, count: counts.get(report.targetId) ?? 1 }))
    .sort((a, b) => b.at - a.at);
}

export function reportTarget(id: string) {
  const report = reports.get(id);
  return report && { id: report.targetId, name: report.target };
}

/** Closes a report, and with `all` every other open one about the same player. */
export function closeReport(id: string, all = false) {
  const report = reports.get(id);
  if (!report) {
    return;
  }
  for (const [otherId, other] of reports) {
    if (otherId === id || (all && other.targetId === report.targetId)) {
      reports.delete(otherId);
    }
  }
  saveRecords("reports", file, reports);
}
