// Everything kept about a player: quests, titles, level, GM powers and bans.
// It lives in MongoDB or a JSON file (see store.ts) so it survives restarts.
// A player is known by the random id their browser keeps; accounts can replace it later.

import type { RegionId } from "../../shared/regions.ts";
import { MAX_LEVEL, xpToNext } from "../../shared/combat.ts";
import { dataFile } from "./environment.ts";
import { loadRecords, saveRecords } from "./store.ts";
import type { GmBan } from "../../shared/gm.ts";
import {
  BAG_SIZE,
  type BagView,
  enhanceChance,
  enhanceCost,
  ENHANCE_RISKY_FROM,
  type Gear,
  gearPower,
  type GearSlot,
  MAX_PLUS,
  sellPrice,
} from "../../shared/loot.ts";
import { BOARD_SIZE, type BoardId, BOARDS, DAILY_GIFTS, type Leaderboards } from "../../shared/rewards.ts";
import { codexGoal, type CodexView } from "../../shared/codex.ts";
import { monsterKind } from "../../shared/monsters.ts";
import { POTION } from "../../shared/items.ts";
import {
  type Achievement,
  DAILY_BONUS,
  dailyQuests,
  type ProgressView,
  type Quest,
  type QuestId,
  questReward,
  type Reward,
  rewardText,
  thaiDay,
  thaiWeek,
  WEEKLY_BONUS,
  WEEKLY_QUESTS,
} from "../../shared/quests.ts";
import { decorateTitle, findTitle, type LifeStat, TITLES } from "../../shared/titles.ts";

interface Daily {
  day: number;
  counts: Partial<Record<QuestId, number>>;
  /** Players met today, so meeting the same one twice counts once. */
  met: string[];
  done: boolean;
}

interface Weekly {
  week: number;
  counts: Partial<Record<QuestId, number>>;
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
  worldBosses: number;
  worldBossTop: number;
  invasionWins: number;
  goldRabbits: number;
  /** The collection book: kills by monster kind, and the names of the gear found. */
  hunted: Record<string, number>;
  found: string[];
  dungeons: number;
}

interface Progress {
  daily: Daily;
  weekly: Weekly;
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
  gold: number;
  potions: number;
  /** Tiers bought in the shop; 0 is the starting gear. */
  weapon: number;
  armor: number;
  /** Wings and mounts owned (indexes into WINGS and MOUNTS; 0, "none", always) and the ones in use. */
  ownedWings: number[];
  ownedMounts: number[];
  wing: number;
  mount: number;
  /** Gear found on monsters, the ids of the pieces worn, and the number for the next id. */
  bag: Gear[];
  gearOn: Partial<Record<GearSlot, string>>;
  nextGear: number;
  /** The last Thai day a daily gift was given, and how many days in a row (1 to 7) so far. */
  giftDay: number;
  giftStreak: number;
  /** Players whose chat, invites and voice this player doesn't want. */
  blocked: string[];
  /** Unix time in ms until which the player may not chat (too many reports); 0 = may. */
  mutedUntil: number;
}

/** Enough to earn every title; older ids are dropped first. */
const MAX_MET = 100;
const SAVE_DELAY_MS = 2000;

const file = process.env.PROGRESS_FILE ?? dataFile("progress.json");
const players = await loadRecords<Progress>("progress", file);
let saveTimer: NodeJS.Timeout | undefined;
/** Records that already have every field. */
const complete = new WeakSet<Progress>();

function scheduleSave() {
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    saveNow();
  }, SAVE_DELAY_MS);
}

export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  saveRecords("progress", file, players);
}

function newDaily(day: number): Daily {
  return { day, counts: {}, met: [], done: false };
}

function newWeekly(week: number): Weekly {
  return { week, counts: {}, done: false };
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
    worldBosses: 0,
    worldBossTop: 0,
    invasionWins: 0,
    goldRabbits: 0,
    hunted: {},
    found: [],
    dungeons: 0,
  };
}

function newProgress(): Progress {
  return {
    daily: newDaily(thaiDay()),
    weekly: newWeekly(thaiWeek()),
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
    gold: 0,
    // A few to start with, so a new player learns what they do.
    potions: 3,
    weapon: 0,
    armor: 0,
    ownedWings: [0],
    ownedMounts: [0],
    wing: 0,
    mount: 0,
    bag: [],
    gearOn: {},
    nextGear: 1,
    giftDay: 0,
    giftStreak: 0,
    blocked: [],
    mutedUntil: 0,
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
  const week = thaiWeek();
  if (progress.weekly.week !== week) {
    progress.weekly = newWeekly(week);
  }
  return progress;
}

function questProgress(daily: Daily, id: QuestId) {
  return id === "meet" ? daily.met.length : daily.counts[id] ?? 0;
}

/** Counts something done towards today's quests and this week's. */
function bump({ daily, weekly }: Progress, id: QuestId, amount = 1) {
  daily.counts[id] = (daily.counts[id] ?? 0) + amount;
  weekly.counts[id] = (weekly.counts[id] ?? 0) + amount;
}

function questStates(quests: readonly Quest[], progress: (id: QuestId) => number, level: number) {
  return quests.map((quest) => ({
    ...quest,
    reward: questReward(quest.reward, level),
    progress: Math.min(quest.goal, progress(quest.id)),
  }));
}

/** Monster kinds with enough kills to be complete in the collection book. */
function codexDone(life: Life) {
  return Object.entries(life.hunted ?? {}).filter(([id, kills]) => {
    const kind = monsterKind(id);
    return kind && kills >= codexGoal(kind);
  }).length;
}

function lifeValue(life: Life, stat: Exclude<LifeStat, "titles">) {
  if (stat === "codex") {
    return codexDone(life);
  }
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
  const { daily, weekly, life, equipped, level } = record;
  return {
    quests: questStates(dailyQuests(daily.day), (id) => questProgress(daily, id), level),
    dailyDone: daily.done,
    dailyBonus: questReward(DAILY_BONUS, level),
    weekly: questStates(WEEKLY_QUESTS, (id) => weekly.counts[id] ?? 0, level),
    weeklyDone: weekly.done,
    weeklyBonus: questReward(WEEKLY_BONUS, level),
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

function pay(progress: Progress, reward: Reward) {
  progress.gold += reward.gold;
  progress.potions = Math.min(POTION.max, progress.potions + reward.potions);
}

/**
 * Changes a player's progress and reports what it completed: quests, the whole day or week, titles.
 * Every change to progress goes through here. Quest rewards are paid into the saved gold and
 * potions at once; the room copies them onto the player (see WorldRoom.celebrate).
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
    progress.weekly.counts.daily = (progress.weekly.counts.daily ?? 0) + 1;
  }
  if (!progress.weekly.done && WEEKLY_QUESTS.every((quest) => (progress.weekly.counts[quest.id] ?? 0) >= quest.goal)) {
    progress.weekly.done = true;
  }

  const after = view(playerId);
  const finished = (now: ProgressView["quests"], then: ProgressView["quests"], label: string) =>
    now.forEach((quest, index) => {
      if (quest.progress >= quest.goal && then[index].progress < quest.goal) {
        pay(progress, quest.reward);
        achievements.push({ kind: "quest", text: `${label}สำเร็จ: ${quest.text} · ได้ ${rewardText(quest.reward)}` });
      }
    });
  finished(after.quests, before.quests, "ภารกิจ");
  finished(after.weekly, before.weekly, "ภารกิจสัปดาห์");
  if (after.dailyDone && !before.dailyDone) {
    pay(progress, after.dailyBonus);
    achievements.push({ kind: "daily", text: `ทำภารกิจประจำวันครบแล้ว! โบนัส ${rewardText(after.dailyBonus)} · พรุ่งนี้มาใหม่นะ` });
  }
  if (after.weeklyDone && !before.weeklyDone) {
    pay(progress, after.weeklyBonus);
    achievements.push({ kind: "daily", text: `ภารกิจประจำสัปดาห์ครบทุกข้อ! โบนัสใหญ่ ${rewardText(after.weeklyBonus)}` });
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
    if (region !== "dungeon" && !life.regions.includes(region)) {
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
  return update(playerId, (record) => {
    const { life } = record;
    bump(record, "chat");
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
  return update(playerId, (record) => {
    const { life } = record;
    bump(record, "walk", activity.steps);
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

/**
 * A monster beaten. `completed` is true when this kill completes its kind in the collection book
 * (the caller hands out the gold for it).
 */
export function recordMonsterKill(playerId: string, kindId: string, boss: boolean) {
  let completed = false;
  const achievements = update(playerId, (record) => {
    const { life } = record;
    bump(record, "hunt");
    life.monsters++;
    if (boss) {
      life.bosses++;
      bump(record, "boss");
    }
    const kind = monsterKind(kindId);
    if (kind) {
      const kills = (life.hunted[kindId] ?? 0) + 1;
      life.hunted[kindId] = kills;
      completed = kills === codexGoal(kind);
    }
  });
  return { achievements, completed };
}

export function recordDungeon(playerId: string) {
  return update(playerId, (record) => {
    record.life.dungeons++;
    bump(record, "dungeon");
  });
}

/** One try at enhancing, whether it took or not. */
export function recordEnhance(playerId: string) {
  return update(playerId, (record) => bump(record, "enhance"));
}

export function recordUltimate(playerId: string) {
  return update(playerId, (record) => bump(record, "ultimate"));
}

export function codex(playerId: string): CodexView {
  const { life } = get(playerId);
  return { hunted: { ...life.hunted }, found: [...life.found] };
}

/** A world boss beaten: everyone who hit it counts one; the hardest hitter also counts a top. */
export function recordWorldBoss(playerId: string, top: boolean) {
  return update(playerId, ({ life }) => {
    life.worldBosses++;
    if (top) {
      life.worldBossTop++;
    }
  });
}

export function recordInvasionWin(playerId: string) {
  return update(playerId, ({ life }) => {
    life.invasionWins++;
  });
}

export function recordGoldRabbit(playerId: string) {
  return update(playerId, ({ life }) => {
    life.goldRabbits++;
  });
}

/** The name and look a player last used, for the join form. */
export function summary(playerId: string) {
  const record = players.get(playerId);
  return { name: record?.name ?? "", skin: record?.skin ?? 0 };
}

/** Gold, potions and gear: what the shop sells and the player carries. */
export interface Inventory {
  gold: number;
  potions: number;
  weapon: number;
  armor: number;
  wing: number;
  mount: number;
}

export function inventory(playerId: string): Inventory {
  const { gold, potions, weapon, armor, wing, mount } = get(playerId);
  return { gold, potions, weapon, armor, wing, mount };
}

/** The wings and mounts a player owns. */
export function wardrobe(playerId: string) {
  const { ownedWings, ownedMounts } = get(playerId);
  return { wings: [...ownedWings], mounts: [...ownedMounts] };
}

export function addToWardrobe(playerId: string, kind: "wing" | "mount", index: number) {
  const record = get(playerId);
  const owned = kind === "wing" ? record.ownedWings : record.ownedMounts;
  if (!owned.includes(index)) {
    owned.push(index);
    owned.sort((a, b) => a - b);
  }
  scheduleSave();
}

export function saveInventory(playerId: string, change: Partial<Inventory>) {
  Object.assign(get(playerId), change);
  scheduleSave();
}

// ---- Gear from monsters ----

export function bag(playerId: string): BagView {
  const { bag, gearOn } = get(playerId);
  return { items: bag.map((gear) => ({ ...gear })), equipped: { ...gearOn } };
}

/** What the worn gear adds: damage and health multipliers, and the worn weapon's rarity (-1 for none). */
export function gearBonus(playerId: string) {
  const { bag, gearOn } = get(playerId);
  const weapon = bag.find((gear) => gear.id === gearOn.weapon);
  const charm = bag.find((gear) => gear.id === gearOn.charm);
  return { power: weapon ? gearPower(weapon) : 1, hp: charm ? gearPower(charm) : 1, weaponRarity: weapon?.rarity ?? -1, weaponPlus: weapon?.plus ?? 0 };
}

/** Puts a find in the bag; with the bag full it is sold instead, for the gold returned (the caller adds it). */
export function addGear(playerId: string, found: Omit<Gear, "id">): { gear: Gear; sold?: number } {
  const record = get(playerId);
  const gear = { ...found, id: `g${record.nextGear++}` };
  if (!record.life.found.includes(gear.name)) {
    record.life.found.push(gear.name);
  }
  if (record.bag.length >= BAG_SIZE) {
    return { gear, sold: sellPrice(gear) };
  }
  record.bag.push(gear);
  scheduleSave();
  return { gear };
}

/** Wears a piece from the bag in its slot; false when it isn't there. */
export function wearGear(playerId: string, gearId: string) {
  const record = get(playerId);
  const gear = record.bag.find((item) => item.id === gearId);
  if (!gear) {
    return false;
  }
  record.gearOn[gear.slot] = gear.id;
  scheduleSave();
  return true;
}

export function takeOffGear(playerId: string, slot: GearSlot) {
  delete get(playerId).gearOn[slot];
  scheduleSave();
}

/** Sells a piece (taking it off first); the gold it brings (the caller adds it), or 0 when it isn't there. */
export function sellGear(playerId: string, gearId: string) {
  const record = get(playerId);
  const index = record.bag.findIndex((item) => item.id === gearId);
  if (index < 0) {
    return 0;
  }
  const [gear] = record.bag.splice(index, 1);
  if (record.gearOn[gear.slot] === gear.id) {
    delete record.gearOn[gear.slot];
  }
  scheduleSave();
  return sellPrice(gear);
}

// ---- Coming back ----

/**
 * The first visit of a Thai day: the streak goes on from yesterday (or starts over), and the
 * day's gift is due. Returns which day of the streak (1 to 7), or 0 when today's was given already.
 * The caller hands out the gift itself.
 */
export function claimDailyGift(playerId: string) {
  const record = get(playerId);
  const today = thaiDay();
  if (record.giftDay === today) {
    return 0;
  }
  record.giftStreak = record.giftDay === today - 1 ? (record.giftStreak % DAILY_GIFTS.length) + 1 : 1;
  record.giftDay = today;
  scheduleSave();
  return record.giftStreak;
}

let boards: { at: number; value: Leaderboards } | undefined;
const BOARDS_FRESH_MS = 30_000;

/** The top players of each board; GMs, with their powers, and banned players don't take part. */
export function leaderboards(): Leaderboards {
  const now = Date.now();
  if (boards && now - boards.at < BOARDS_FRESH_MS) {
    return boards.value;
  }
  const entries = [...players].filter(([, record]) => record.name && !record.gm && !(record.bannedUntil > now));
  const score: Record<BoardId, (record: Progress) => number> = {
    // Level first, then experience within it.
    level: (record) => (record.level ?? 1) * 1e9 + (record.xp ?? 0),
    gold: (record) => record.gold ?? 0,
    monsters: (record) => record.life?.monsters ?? 0,
    worldBosses: (record) => record.life?.worldBosses ?? 0,
  };
  const value = Object.fromEntries(
    BOARDS.map(({ id }) => [
      id,
      entries
        .filter(([, record]) => score[id](record) > 0)
        .sort((a, b) => score[id](b[1]) - score[id](a[1]))
        .slice(0, BOARD_SIZE)
        .map(([playerId, record]) => ({
          name: record.name,
          skin: record.skin ?? 0,
          value: id === "level" ? record.level ?? 1 : score[id](record),
          title: equippedTitle(playerId),
        })),
    ]),
  ) as Leaderboards;
  boards = { at: now, value };
  return value;
}

/**
 * One try at the next enhancement step, paid for by the caller (the cost is returned for that).
 * "max" and "missing" cost nothing; "failed" from +7 up takes the piece one step back.
 */
export function enhanceGear(playerId: string, gearId: string, gold: number) {
  const gear = get(playerId).bag.find((item) => item.id === gearId);
  if (!gear) {
    return { result: "missing" as const };
  }
  const plus = gear.plus ?? 0;
  if (plus >= MAX_PLUS) {
    return { result: "max" as const, gear };
  }
  const cost = enhanceCost(gear);
  if (gold < cost) {
    return { result: "poor" as const, gear, cost };
  }
  const worked = Math.random() < enhanceChance(gear);
  if (worked) {
    gear.plus = plus + 1;
  } else if (plus >= ENHANCE_RISKY_FROM) {
    gear.plus = plus - 1;
  }
  scheduleSave();
  return { result: worked ? ("done" as const) : ("failed" as const), gear, cost, before: plus };
}

// ---- Safety ----

/** Enough for anyone; the oldest block is dropped first. */
const MAX_BLOCKED = 100;

/** Blocks another player; false when they were blocked already. */
export function block(playerId: string, otherId: string) {
  const record = get(playerId);
  if (playerId === otherId || record.blocked.includes(otherId)) {
    return false;
  }
  record.blocked.push(otherId);
  if (record.blocked.length > MAX_BLOCKED) {
    record.blocked.shift();
  }
  scheduleSave();
  return true;
}

/** Unblocks the player at this place in the list blocked() gave. */
export function unblock(playerId: string, index: number) {
  const record = get(playerId);
  if (!Number.isInteger(index) || index < 0 || index >= record.blocked.length) {
    return false;
  }
  record.blocked.splice(index, 1);
  scheduleSave();
  return true;
}

export function blocks(playerId: string, otherId: string) {
  return players.get(playerId)?.blocked?.includes(otherId) ?? false;
}

/** The names of the players blocked, in order: the ids stay on the server. */
export function blockedNames(playerId: string) {
  return get(playerId).blocked.map((id) => players.get(id)?.name || "ผู้เล่น");
}

export function mute(playerId: string, minutes: number) {
  const record = get(playerId);
  record.mutedUntil = Math.max(record.mutedUntil, Date.now() + minutes * 60_000);
  scheduleSave();
  return record.mutedUntil;
}

export function unmute(playerId: string) {
  const record = players.get(playerId);
  if (record) {
    record.mutedUntil = 0;
    scheduleSave();
  }
}

/** Unix time in ms until which the player may not chat; 0 when they may. */
export function mutedUntil(playerId: string) {
  const until = players.get(playerId)?.mutedUntil ?? 0;
  return until > Date.now() ? until : 0;
}

/** The name a player was last seen with, even when they're offline. */
export function nameOf(playerId: string) {
  return players.get(playerId)?.name ?? "";
}
