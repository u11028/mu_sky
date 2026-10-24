// Monsters of each region, and the boss that rules it. The server runs them; the client draws them.

import type { RegionId } from "./regions.ts";

export interface MonsterKind {
  name: string;
  /** Art: a 4x4 sheet in assets/monsters, or a boss's idle strip in assets/bosses. */
  sprite: string;
  level: number;
  boss?: boolean;
  /** Boss strips: frame size and count. */
  frame?: { width: number; height: number; count: number };
  /** How much bigger than the 16 px art it is drawn. */
  scale: number;
}

export const MONSTER_KINDS = {
  slime: { name: "สไลม์เขียว", sprite: "Slime", level: 1, scale: 3 },
  mushroom: { name: "เห็ดซน", sprite: "Mushroom", level: 2, scale: 3 },
  larva: { name: "หนอนนา", sprite: "Larva", level: 3, scale: 3 },
  mole: { name: "ตุ่นขุดนา", sprite: "Mole", level: 3, scale: 3 },
  snake: { name: "งูเขียวหางไหม้", sprite: "Snake", level: 4, scale: 3 },
  owl: { name: "นกฮูกดอย", sprite: "Owl", level: 4, scale: 3 },
  spirit: { name: "ภูตหมอก", sprite: "Spirit", level: 5, scale: 3 },
  racoon: { name: "แรคคูนขโมยผลไม้", sprite: "Racoon", level: 5, scale: 3 },
  octopus: { name: "หมึกแดงชายหาด", sprite: "RedOctopus", level: 6, scale: 3 },
  axolot: { name: "ซาลาแมนเดอร์", sprite: "Axolot", level: 6, scale: 3 },
  bamboo: { name: "ไผ่เดินได้", sprite: "Bamboo", level: 6, scale: 3 },
  kappa: { name: "กัปปะริมน้ำ", sprite: "KappaGreen", level: 7, scale: 3 },
  snake2: { name: "งูจงอาง", sprite: "Snake2", level: 7, scale: 3 },
  skull: { name: "หัวกะโหลกหลอน", sprite: "Skull", level: 8, scale: 3 },
  spider: { name: "แมงมุมพิษ", sprite: "SpiderRed", level: 8, scale: 3 },
  cyclope: { name: "ไซคลอปส์จิ๋ว", sprite: "Cyclope", level: 9, scale: 3 },

  kingSlime: {
    name: "ราชาสไลม์",
    sprite: "GiantSlime",
    level: 6,
    boss: true,
    frame: { width: 62, height: 52, count: 5 },
    scale: 2.4,
  },
  frogKing: {
    name: "ราชากบทุ่งนา",
    sprite: "GiantFrog",
    level: 9,
    boss: true,
    frame: { width: 40, height: 40, count: 5 },
    scale: 3,
  },
  mistSpirit: {
    name: "วิญญาณดอยหลวง",
    sprite: "GiantSpirit",
    level: 10,
    boss: true,
    frame: { width: 50, height: 50, count: 5 },
    scale: 2.6,
  },
  giantRacoon: {
    name: "แรคคูนยักษ์แห่งสวน",
    sprite: "GiantRacoon",
    level: 11,
    boss: true,
    frame: { width: 60, height: 60, count: 6 },
    scale: 2.4,
  },
  giantBamboo: {
    name: "อสูรไผ่ยักษ์",
    sprite: "GiantBamboo",
    level: 12,
    boss: true,
    frame: { width: 62, height: 62, count: 6 },
    scale: 2.4,
  },
  demonCyclop: {
    name: "ยักษ์ตาเดียวแห่งผาหิน",
    sprite: "DemonCyclop",
    level: 14,
    boss: true,
    frame: { width: 50, height: 50, count: 5 },
    scale: 2.8,
  },
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
