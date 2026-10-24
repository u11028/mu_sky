// Quest and title progress per player, kept in a JSON file so it survives restarts.
// A player is known by the random id their browser keeps; accounts can replace it later.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegionId } from "../../shared/regions.ts";
import { type Achievement, dailyQuests, type ProgressView, type QuestId, thaiDay } from "../../shared/quests.ts";
import { decorateTitle, findTitle, type LifeStat, TITLES } from "../../shared/titles.ts";

interface Daily {
  day: number;
  counts: Partial<Record<QuestId, number>>;
  /** Players met today, so meeting the same one twice counts once. */
  met: string[];
  done: boolean;
}

interface Life {
  chats: number;
  steps: number;
  travels: number;
  regions: RegionId[];
  met: string[];
  days: number;
}

interface Progress {
  daily: Daily;
  life: Life;
  equipped: string;
}

/** Enough to earn every title; older ids are dropped first. */
const MAX_MET = 50;
const SAVE_DELAY_MS = 2000;

const file = process.env.PROGRESS_FILE ?? fileURLToPath(new URL("../data/progress.json", import.meta.url));
const players = load();
let saveTimer: NodeJS.Timeout | undefined;

function load(): Map<string, Progress> {
  if (!existsSync(file)) {
    return new Map();
  }

  try {
    return new Map(Object.entries(JSON.parse(readFileSync(file, "utf8"))));
  } catch (error) {
    console.error(`Could not read ${file}; starting with no progress.`, error);
    return new Map();
  }
}

function scheduleSave() {
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    saveNow();
  }, SAVE_DELAY_MS);
}

/** Writes beside the file first, so a crash mid-write never leaves half a file. */
export function saveNow() {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(players)));
  renameSync(`${file}.tmp`, file);
}

function newDaily(day: number): Daily {
  return { day, counts: {}, met: [], done: false };
}

function get(playerId: string): Progress {
  let progress = players.get(playerId);
  if (!progress) {
    progress = {
      daily: newDaily(thaiDay()),
      life: { chats: 0, steps: 0, travels: 0, regions: [], met: [], days: 0 },
      equipped: "rookie",
    };
    players.set(playerId, progress);
  }

  // A new day brings fresh quests.
  const today = thaiDay();
  if (progress.daily.day !== today) {
    progress.daily = newDaily(today);
  }
  return progress;
}

function questProgress(daily: Daily, id: QuestId) {
  return id === "meet" ? daily.met.length : daily.counts[id] ?? 0;
}

function lifeValue(life: Life, stat: LifeStat) {
  const value = life[stat];
  return Array.isArray(value) ? value.length : value;
}

export function view(playerId: string): ProgressView {
  const { daily, life, equipped } = get(playerId);
  return {
    quests: dailyQuests(daily.day).map((quest) => ({
      ...quest,
      progress: Math.min(quest.goal, questProgress(daily, quest.id)),
    })),
    dailyDone: daily.done,
    days: life.days,
    titles: TITLES.map((title) => {
      const progress = title.stat ? Math.min(title.goal, lifeValue(life, title.stat)) : 0;
      return { id: title.id, progress, goal: title.goal, unlocked: progress >= title.goal };
    }),
    equipped,
  };
}

/** The title a player wears, if they still own it. */
export function equippedTitle(playerId: string) {
  const { equipped } = get(playerId);
  return isUnlocked(playerId, equipped) ? equipped : "";
}

function isUnlocked(playerId: string, titleId: string) {
  return view(playerId).titles.some((title) => title.id === titleId && title.unlocked);
}

/** "" takes the title off. False when the player hasn't earned it. */
export function equip(playerId: string, titleId: string) {
  if (titleId !== "" && !isUnlocked(playerId, titleId)) {
    return false;
  }

  get(playerId).equipped = titleId;
  scheduleSave();
  return true;
}

/**
 * Changes a player's progress and reports what it completed: quests, the whole day, titles.
 * Every change to progress goes through here.
 */
function update(playerId: string, change: (progress: Progress) => void): Achievement[] {
  const before = view(playerId);
  const progress = get(playerId);
  change(progress);

  const achievements: Achievement[] = [];
  const quests = dailyQuests(progress.daily.day);
  const allDone = quests.every((quest) => questProgress(progress.daily, quest.id) >= quest.goal);
  if (allDone && !progress.daily.done) {
    progress.daily.done = true;
    progress.life.days++;
  }

  const after = view(playerId);
  after.quests.forEach((quest, index) => {
    if (quest.progress >= quest.goal && before.quests[index].progress < quest.goal) {
      achievements.push({ kind: "quest", text: `ภารกิจสำเร็จ: ${quest.text}` });
    }
  });
  if (after.dailyDone && !before.dailyDone) {
    achievements.push({ kind: "daily", text: "ทำภารกิจประจำวันครบแล้ว! พรุ่งนี้มาใหม่นะ" });
  }
  after.titles.forEach((title, index) => {
    if (title.unlocked && !before.titles[index].unlocked) {
      achievements.push({ kind: "title", text: `ได้รับฉายา ${decorateTitle(findTitle(title.id)!)}`, titleId: title.id });
    }
  });

  scheduleSave();
  return achievements;
}

export function recordVisit(playerId: string, region: RegionId, travelled: boolean, regionOfTheDay: RegionId) {
  return update(playerId, ({ daily, life }) => {
    if (!life.regions.includes(region)) {
      life.regions.push(region);
    }
    if (travelled) {
      life.travels++;
    }
    if (region === regionOfTheDay) {
      daily.counts.visit = 1;
    }
  });
}

export function recordChat(playerId: string) {
  return update(playerId, ({ daily, life }) => {
    daily.counts.chat = (daily.counts.chat ?? 0) + 1;
    life.chats++;
  });
}

export function recordSteps(playerId: string, steps: number) {
  return update(playerId, ({ daily, life }) => {
    daily.counts.walk = (daily.counts.walk ?? 0) + steps;
    life.steps += steps;
  });
}

export function recordMeeting(playerId: string, otherId: string) {
  return update(playerId, ({ daily, life }) => {
    if (!daily.met.includes(otherId)) {
      daily.met.push(otherId);
    }
    if (!life.met.includes(otherId)) {
      life.met.push(otherId);
      if (life.met.length > MAX_MET) {
        life.met.shift();
      }
    }
  });
}
