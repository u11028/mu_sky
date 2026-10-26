// Daily quests (ภารกิจประจำวัน), the same five for everyone and renewed at midnight Thai time, and
// weekly quests (ภารกิจประจำสัปดาห์), renewed on Monday. Each pays gold and potions when done, and
// finishing a whole day or week pays a bonus on top.

import { REGIONS, type RegionId } from "./regions.ts";

export type QuestId = "visit" | "chat" | "walk" | "meet" | "hunt" | "boss" | "dungeon" | "enhance" | "ultimate" | "daily";

export interface Reward {
  gold: number;
  potions: number;
}

export interface Quest {
  id: QuestId;
  text: string;
  goal: number;
  /** At level 1; the gold grows with the player's level (see questReward). */
  reward: Reward;
}

/** One step is this many pixels walked. */
export const STEP_PX = 10;

const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since 1970 in Thailand's time zone, so quests renew at Thai midnight. */
export function thaiDay(now = Date.now()) {
  return Math.floor((now + THAI_OFFSET_MS) / DAY_MS);
}

/** Weeks since 1970 in Thailand, each starting on a Monday (day 0, 1 January 1970, was a Thursday). */
export function thaiWeek(now = Date.now()) {
  return Math.floor((thaiDay(now) + 3) / 7);
}

/** Players start in the central region, so the region to visit is one of the other five. */
const VISIT_ROTATION: RegionId[] = ["north", "northeast", "east", "west", "south"];

export function regionOfTheDay(day: number) {
  return VISIT_ROTATION[day % VISIT_ROTATION.length];
}

/** Three of these join the two quests every day has. */
const DAILY_POOL: Quest[] = [
  { id: "chat", text: "ทักทายชาวเมือง คุยในแชท 5 ข้อความ", goal: 5, reward: { gold: 80, potions: 1 } },
  { id: "walk", text: "เดินเล่น 500 ก้าว", goal: 500, reward: { gold: 80, potions: 1 } },
  { id: "meet", text: "พบผู้เล่นคนอื่น 1 คน", goal: 1, reward: { gold: 80, potions: 1 } },
  { id: "boss", text: "ปราบบอสประจำภาค 1 ตัว", goal: 1, reward: { gold: 250, potions: 2 } },
  { id: "dungeon", text: "พิชิตถ้ำทีม 1 รอบ", goal: 1, reward: { gold: 250, potions: 2 } },
  { id: "enhance", text: "ตีบวกอุปกรณ์ 2 ครั้ง", goal: 2, reward: { gold: 150, potions: 0 } },
  { id: "ultimate", text: "ใช้สกิลอาชีพ 3 ครั้ง", goal: 3, reward: { gold: 120, potions: 1 } },
];

/** Every day's quests: the same for everyone, picked from the pool by the date. */
export function dailyQuests(day: number): Quest[] {
  // A shuffle seeded by the day, so each day mixes the pool its own way.
  let seed = day | 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pool = [...DAILY_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [
    { id: "visit", text: `ไปเยือน${REGIONS[regionOfTheDay(day)].name}`, goal: 1, reward: { gold: 100, potions: 1 } },
    { id: "hunt", text: "ล่ามอนสเตอร์ 10 ตัว", goal: 10, reward: { gold: 120, potions: 1 } },
    ...pool.slice(0, 3),
  ];
}

export const WEEKLY_QUESTS: readonly Quest[] = [
  { id: "hunt", text: "ล่ามอนสเตอร์ 300 ตัว", goal: 300, reward: { gold: 1500, potions: 5 } },
  { id: "boss", text: "ปราบบอส 10 ตัว", goal: 10, reward: { gold: 2000, potions: 5 } },
  { id: "dungeon", text: "พิชิตถ้ำทีม 3 รอบ", goal: 3, reward: { gold: 2000, potions: 5 } },
  { id: "daily", text: "ทำภารกิจประจำวันครบ 4 วัน", goal: 4, reward: { gold: 3000, potions: 10 } },
];

/** For finishing all of a day's quests, and all of a week's. */
export const DAILY_BONUS: Reward = { gold: 400, potions: 3 };
export const WEEKLY_BONUS: Reward = { gold: 5000, potions: 10 };

/** What a reward pays at a level: monsters pay more as players grow, so quests do too. */
export function questReward(reward: Reward, level: number): Reward {
  return { gold: Math.round((reward.gold * (4 + Math.max(1, level))) / 5), potions: reward.potions };
}

export function rewardText({ gold, potions }: Reward) {
  return [gold > 0 && `${gold.toLocaleString()} ทอง`, potions > 0 && `ยา ${potions}`].filter(Boolean).join(" + ");
}

export type QuestState = Quest & { progress: number };

/** What the server tells a player about their quests and titles. Rewards are at the player's level. */
export interface ProgressView {
  quests: QuestState[];
  /** All of today's quests are done. */
  dailyDone: boolean;
  dailyBonus: Reward;
  weekly: QuestState[];
  weeklyDone: boolean;
  weeklyBonus: Reward;
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
