// Everything kept about a player: quests, titles, level, GM powers and bans.
// It lives in a JSON file so it survives restarts.
// A player is known by the random id their browser keeps; accounts can replace it later.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegionId } from "../../shared/regions.ts";
import { MAX_LEVEL, xpToNext } from "../../shared/combat.ts";
import type { GmBan } from "../../shared/gm.ts";
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
  idle: number;
  shore: number;
  laughs: number;
  nightChats: number;
  skins: number[];
  kills: number;
  deaths: number;
  monsters: number;
  bosses: number;
}

interface Progress {
  daily: Daily;
  life: Life;
  equipped: string;
  level: number;
  xp: number;
  /** Titles a GM gave. */
  granted: string[];
  gm: boolean;
  /** GM powers: takes no damage; kills with one hit. */
  god: boolean;
  oneHit: boolean;
  /** Unix time in ms until which the player may not join; 0 = not banned. */
  bannedUntil: number;
  banReason: string;
  /** Last name, look and address seen: to find and ban players, and to fill in the join form after a login. */
  name: string;
  skin: number;
  ip: string;
}

/** Enough to earn every title; older ids are dropped first. */
const MAX_MET = 100;
const SAVE_DELAY_MS = 2000;

const file = process.env.PROGRESS_FILE ?? fileURLToPath(new URL("../data/progress.json", import.meta.url));
const players = load();
let saveTimer: NodeJS.Timeout | undefined;
/** Records that already have every field. */
const complete = new WeakSet<Progress>();

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

function newLife(): Life {
  return {
    chats: 0,
    steps: 0,
    travels: 0,
    regions: [],
    met: [],
    days: 0,
    idle: 0,
    shore: 0,
    laughs: 0,
    nightChats: 0,
    skins: [],
    kills: 0,
    deaths: 0,
    monsters: 0,
    bosses: 0,
  };
}

function newProgress(): Progress {
  return {
    daily: newDaily(thaiDay()),
    life: newLife(),
    equipped: "rookie",
    level: 1,
    xp: 0,
    granted: [],
    gm: false,
    god: false,
    oneHit: false,
    bannedUntil: 0,
    banReason: "",
    name: "",
    skin: 0,
    ip: "",
  };
}

function get(playerId: string): Progress {
  let progress = players.get(playerId);
  if (!progress || !complete.has(progress)) {
    // New players, and players saved before a field existed, get the starting values.
    progress = { ...newProgress(), ...progress, life: { ...newLife(), ...progress?.life } };
    complete.add(progress);
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

function lifeValue(life: Life, stat: Exclude<LifeStat, "titles">) {
  const value = life[stat];
  return Array.isArray(value) ? value.length : value;
}

/** How far a player is towards each title; "titles" counts the others they own. */
function titleStates({ life, granted }: Progress) {
  const states = TITLES.map((title) => {
    const value = granted.includes(title.id)
      ? title.goal
      : !title.stat || title.stat === "titles"
        ? 0
        : lifeValue(life, title.stat);
    return { id: title.id, progress: Math.min(title.goal, value), goal: title.goal };
  });
  const owned = states.filter((state, index) => TITLES[index].stat !== "titles" && state.progress >= state.goal).length;
  return states.map((state, index) => {
    const progress =
      TITLES[index].stat === "titles" && !granted.includes(state.id) ? Math.min(state.goal, owned) : state.progress;
    return { ...state, progress, unlocked: progress >= state.goal };
  });
}

export function view(playerId: string): ProgressView {
  const record = get(playerId);
  const { daily, life, equipped } = record;
  return {
    quests: dailyQuests(daily.day).map((quest) => ({
      ...quest,
      progress: Math.min(quest.goal, questProgress(daily, quest.id)),
    })),
    dailyDone: daily.done,
    days: life.days,
    titles: titleStates(record),
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

export function recordVisit(
  playerId: string,
  region: RegionId,
  travelled: boolean,
  regionOfTheDay: RegionId,
  skin: number,
) {
  return update(playerId, ({ daily, life }) => {
    if (!life.skins.includes(skin)) {
      life.skins.push(skin);
    }
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

export function recordChat(playerId: string, text: string) {
  return update(playerId, ({ daily, life }) => {
    daily.counts.chat = (daily.counts.chat ?? 0) + 1;
    life.chats++;
    if (text.includes("555")) {
      life.laughs++;
    }
    if (thaiHour() < 5) {
      life.nightChats++;
    }
  });
}

/** What a player did in the last moments: steps walked, seconds standing still or pushing into the sea. */
export function recordActivity(playerId: string, activity: { steps: number; idle: number; shore: number }) {
  return update(playerId, ({ daily, life }) => {
    daily.counts.walk = (daily.counts.walk ?? 0) + activity.steps;
    life.steps += activity.steps;
    life.idle += activity.idle;
    life.shore += activity.shore;
  });
}

function thaiHour() {
  return (new Date().getUTCHours() + 7) % 24;
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

export function recordKill(playerId: string) {
  return update(playerId, ({ life }) => {
    life.kills++;
  });
}

export function recordDeath(playerId: string) {
  return update(playerId, ({ life }) => {
    life.deaths++;
  });
}

/** A GM gives a title, even one nobody can earn. */
export function grantTitle(playerId: string, titleId: string) {
  return update(playerId, ({ granted }) => {
    if (findTitle(titleId) && !granted.includes(titleId)) {
      granted.push(titleId);
    }
  });
}

/** Level, experience and powers, as the game needs them while playing. */
export function profile(playerId: string) {
  const { level, xp, gm, god, oneHit } = get(playerId);
  return { level, xp, gm, god, oneHit };
}

/** Adds experience; returns how many levels it brought. */
export function addXp(playerId: string, amount: number) {
  const record = get(playerId);
  record.xp += amount;
  let levels = 0;
  while (record.level < MAX_LEVEL && record.xp >= xpToNext(record.level)) {
    record.xp -= xpToNext(record.level);
    record.level++;
    levels++;
  }
  scheduleSave();
  return levels;
}

export function setLevel(playerId: string, level: number) {
  const record = get(playerId);
  record.level = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
  record.xp = 0;
  scheduleSave();
  return record.level;
}

export function setPower(playerId: string, power: "gm" | "god" | "oneHit", on: boolean) {
  get(playerId)[power] = on;
  scheduleSave();
}

/** Remembers who a player last was, so a GM can find and ban them. */
export function remember(playerId: string, name: string, skin: number, ip: string) {
  const record = get(playerId);
  record.name = name;
  record.skin = skin;
  record.ip = ip;
  scheduleSave();
}

export function ban(playerId: string, days: number, reason: string) {
  const record = get(playerId);
  record.bannedUntil = Date.now() + days * 24 * 60 * 60 * 1000;
  record.banReason = reason;
  scheduleSave();
  return record.bannedUntil;
}

export function unban(playerId: string) {
  const record = players.get(playerId);
  if (record) {
    record.bannedUntil = 0;
    record.banReason = "";
    scheduleSave();
  }
}

/** Addresses shared by everyone on this computer: banning one would ban the GM too. */
function isLocalAddress(ip: string) {
  return ip === "" || ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/** The ban that keeps this player, or anyone from their address, out; undefined when they may join. */
export function activeBan(playerId: string, ip: string) {
  const now = Date.now();
  const own = players.get(playerId);
  if (own && own.bannedUntil > now) {
    return { until: own.bannedUntil, reason: own.banReason };
  }
  if (isLocalAddress(ip)) {
    return undefined;
  }
  for (const record of players.values()) {
    if (record.ip === ip && record.bannedUntil > now) {
      return { until: record.bannedUntil, reason: record.banReason };
    }
  }
  return undefined;
}

export function bans(): GmBan[] {
  const now = Date.now();
  return [...players]
    .filter(([, record]) => record.bannedUntil > now)
    .map(([playerId, record]) => ({ playerId, name: record.name, until: record.bannedUntil, reason: record.banReason }));
}

/** A monster fell; everyone who fought it counts it for the hunting quest. */
export function recordMonsterKill(playerId: string, boss: boolean) {
  return update(playerId, ({ daily, life }) => {
    daily.counts.hunt = (daily.counts.hunt ?? 0) + 1;
    life.monsters++;
    if (boss) {
      life.bosses++;
    }
  });
}

/** The name and look a player last used, for the join form. */
export function summary(playerId: string) {
  const record = players.get(playerId);
  return { name: record?.name ?? "", skin: record?.skin ?? 0 };
}
