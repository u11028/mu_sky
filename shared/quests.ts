// Daily quests (ภารกิจประจำวัน): the same four for everyone, renewed at midnight Thai time.

import { REGIONS, type RegionId } from "./regions.ts";

export type QuestId = "visit" | "chat" | "walk" | "meet";

export interface Quest {
  id: QuestId;
  text: string;
  goal: number;
}

/** One step is this many pixels walked. */
export const STEP_PX = 10;

const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since 1970 in Thailand's time zone, so quests renew at Thai midnight. */
export function thaiDay(now = Date.now()) {
  return Math.floor((now + THAI_OFFSET_MS) / DAY_MS);
}

/** Players start in the central region, so the region to visit is one of the other five. */
const VISIT_ROTATION: RegionId[] = ["north", "northeast", "east", "west", "south"];

export function regionOfTheDay(day: number) {
  return VISIT_ROTATION[day % VISIT_ROTATION.length];
}

export function dailyQuests(day: number): Quest[] {
  return [
    { id: "visit", text: `ไปเยือน${REGIONS[regionOfTheDay(day)].name}`, goal: 1 },
    { id: "chat", text: "ทักทายชาวเมือง คุยในแชท 5 ข้อความ", goal: 5 },
    { id: "walk", text: "เดินเล่น 500 ก้าว", goal: 500 },
    { id: "meet", text: "พบผู้เล่นคนอื่น 1 คน", goal: 1 },
  ];
}

/** What the server tells a player about their quests and titles. */
export interface ProgressView {
  quests: (Quest & { progress: number })[];
  /** All of today's quests are done. */
  dailyDone: boolean;
  /** Days on which every daily quest was done. */
  days: number;
  titles: { id: string; progress: number; goal: number; unlocked: boolean }[];
  /** Title shown above the head; "" shows none. */
  equipped: string;
}

/** A moment worth a pop-up: a quest done or a title earned. */
export interface Achievement {
  kind: "quest" | "daily" | "title";
  text: string;
  titleId?: string;
}
