// Monsters of each region, and the boss that rules it. The server runs them; the client draws them.

import type { RegionId } from "./regions.ts";

export interface MonsterKind {
  name: string;
  /** Model file in assets/3d/monsters. */
  model: string;
  level: number;
  boss?: boolean;
  /** The world boss: comes now and then, for everyone, and never respawns by itself. */
  world?: boolean;
  /** How tall it stands, in world units (a hero is about 2). */
  height: number;
}

export const MONSTER_KINDS = {
  slime: { name: "สไลม์เขียว", model: "GreenBlob", level: 1, height: 1.1 },
  mushroom: { name: "เห็ดซน", model: "Mushnub", level: 2, height: 1.3 },
  larva: { name: "กระต่ายทุ่งนา", model: "Bunny", level: 3, height: 1.5 },
  mole: { name: "กบนาตัวโต", model: "Frog", level: 3, height: 1.4 },
  snake: { name: "กระบองเพชรจอมซน", model: "Cactoro", level: 4, height: 1.6 },
  owl: { name: "นกดอยฟูฟ่อง", model: "Birb", level: 4, height: 1.3 },
  spirit: { name: "ภูตหมอก", model: "Ghost", level: 5, height: 1.7 },
  racoon: { name: "ผึ้งเกราะสวนผลไม้", model: "Armabee", level: 5, height: 1.5 },
  octopus: { name: "หมึกปีกชายหาด", model: "Squidle", level: 6, height: 1.6 },
  axolot: { name: "ปลาบินทะเลตะวันออก", model: "Glub", level: 6, height: 1.5 },
  bamboo: { name: "ภูตลมทะเลใต้", model: "Hywirl", level: 6, height: 1.7 },
  kappa: { name: "ไดโนจอมซน", model: "Dino", level: 7, height: 1.8 },
  snake2: { name: "ค้างคาวถ้ำ", model: "Goleling", level: 7, height: 1.5 },
  skull: { name: "ออร์คป่าตะวันตก", model: "Orc", level: 8, height: 2.1 },
  spider: { name: "ปีศาจผาหิน", model: "Demon", level: 8, height: 2.1 },
  cyclope: { name: "เยติภูเขา", model: "Yeti", level: 9, height: 2.3 },

  kingSlime: { name: "ราชาเห็ดยักษ์", model: "MushroomKing", level: 6, boss: true, height: 4.2 },
  frogKing: { name: "ราชาอัลปากาแห่งอีสาน", model: "AlpakingEvolved", level: 9, boss: true, height: 4.4 },
  mistSpirit: { name: "วิญญาณดอยหลวง", model: "GhostSkull", level: 10, boss: true, height: 4.6 },
  giantRacoon: { name: "มังกรทะเลตะวันออก", model: "Dragon", level: 11, boss: true, height: 4.6 },
  giantBamboo: { name: "ราชาค้างคาวถ้ำใต้", model: "GolelingEvolved", level: 12, boss: true, height: 4.6 },
  demonCyclop: { name: "มังกรเพลิงผาหิน", model: "DragonEvolved", level: 14, boss: true, height: 5.2 },

  rahu: { name: "จอมอสูรราหู", model: "DragonEvolved", level: 20, boss: true, world: true, height: 7.5 },
} as const satisfies Record<string, MonsterKind>;

export type MonsterKindId = keyof typeof MONSTER_KINDS;

export function monsterKind(id: string): MonsterKind | undefined {
  return (MONSTER_KINDS as Record<string, MonsterKind>)[id];
}

/** Who lives where: a few of each kind, and one boss. Harder regions further from the centre. */
export const REGION_MONSTERS: Record<RegionId, { kinds: MonsterKindId[]; count: number; boss: MonsterKindId }> = {
  central: { kinds: ["slime", "mushroom"], count: 10, boss: "kingSlime" },
  northeast: { kinds: ["larva", "mole", "snake"], count: 12, boss: "frogKing" },
  north: { kinds: ["owl", "spirit"], count: 12, boss: "mistSpirit" },
  east: { kinds: ["racoon", "octopus", "axolot"], count: 12, boss: "giantRacoon" },
  south: { kinds: ["bamboo", "kappa", "snake2"], count: 12, boss: "giantBamboo" },
  west: { kinds: ["skull", "spider", "cyclope"], count: 12, boss: "demonCyclop" },
};

export function monsterMaxHp(kind: MonsterKind) {
  const hp = 30 + kind.level * 18;
  return kind.boss ? hp * 12 : hp;
}

export function monsterDamage(kind: MonsterKind) {
  // The world boss is for everyone, new players too: it hits hard, not at once.
  if (kind.world) {
    return 38;
  }
  const damage = 4 + kind.level * 2.5;
  return kind.boss ? damage * 2 : damage;
}

export function monsterXp(kind: MonsterKind) {
  const xp = 12 + kind.level * 8;
  return kind.boss ? xp * 10 : xp;
}

export const MONSTER_SPEED = 90;
export const MONSTER_CHASE_SPEED = 150;
export const MONSTER_ATTACK_RANGE = 40;
export const BOSS_ATTACK_RANGE = 80;
export const MONSTER_ATTACK_MS = 1200;
export const MONSTER_AGGRO = 170;
export const BOSS_AGGRO = 260;
/** A monster lured further than this from home gives up, walks back and heals. */
export const MONSTER_LEASH = 420;
export const MONSTER_RESPAWN_MS = 15_000;
export const BOSS_RESPAWN_MS = 180_000;
/** Monsters keep away from where players arrive. */
export const MONSTER_SAFE_RADIUS = 260;

/** The world boss's schedule and size. */
export const WORLD_BOSS = {
  kind: "rahu" as MonsterKindId,
  /** The first one comes soon after the server starts (a free host starts it when someone plays). */
  firstMs: 4 * 60_000,
  everyMs: 30 * 60_000,
  /** Gone if not beaten by then. */
  lastsMs: 10 * 60_000,
  /** Health for each player in that world when it comes, and at least this much. */
  hpPerPlayer: 2000,
  minHp: 3000,
  attackRange: 120,
};

/** Told to every room of the world the boss came to, and to whoever joins while it's there. */
export interface WorldBossEvent {
  region: RegionId;
  name: string;
  /** Time left, in ms: the client counts down from it on its own clock. */
  leftMs: number;
}

/** The world boss is gone: beaten (with the three who hit hardest) or escaped. */
export interface WorldBossEnd {
  beaten: boolean;
  name: string;
  top: { name: string; damage: number }[];
}
