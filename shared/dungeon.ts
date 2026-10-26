// The dungeon: a cave hall a team has to itself. Four waves of monsters, then a boss, against the
// clock; the monsters are picked and toughened for the team's level and size. Clearing it pays
// everyone there; then, after a short rest, a new run begins for whoever stays.

import { MONSTER_KINDS, type MonsterKind, type MonsterKindId } from "./monsters.ts";
import { PARTY_ALPHABET, PARTY_CODE_LENGTH } from "./world.ts";

export const DUNGEON = {
  waves: 4,
  /** From the first wave to the boss's fall. */
  timeMs: 5 * 60_000,
  /** Before the first wave, between waves, and the rest after a run. */
  countdownMs: 8000,
  breatherMs: 3000,
  restMs: 15_000,
  /** How far monsters notice the team, much further than outside: the hall is theirs. */
  aggro: 650,
};

const KINDS = Object.entries(MONSTER_KINDS) as [MonsterKindId, MonsterKind][];
/** Ordinary monsters and bosses a run can draw from (not the world boss). */
export const DUNGEON_MONSTERS = KINDS.filter(([, kind]) => !kind.boss).map(([id]) => id);
export const DUNGEON_BOSSES = KINDS.filter(([, kind]) => kind.boss && !kind.world).map(([id]) => id);

/** Monsters for a team of this average level: the kinds within reach of it. */
export function waveKinds(level: number): MonsterKindId[] {
  const near = DUNGEON_MONSTERS.filter((id) => Math.abs(MONSTER_KINDS[id].level - level) <= 2);
  if (near.length > 0) {
    return near;
  }
  // Beyond every kind's level: the toughest ones.
  const top = Math.max(...DUNGEON_MONSTERS.map((id) => MONSTER_KINDS[id].level));
  return DUNGEON_MONSTERS.filter((id) => MONSTER_KINDS[id].level >= top - 1);
}

/** The boss closest to a little above the team's level. */
export function bossFor(level: number): MonsterKindId {
  return DUNGEON_BOSSES.reduce((best, id) =>
    Math.abs(MONSTER_KINDS[id].level - (level + 2)) < Math.abs(MONSTER_KINDS[best].level - (level + 2)) ? id : best,
  );
}

/** How many monsters a wave has, for the team's size. */
export function waveSize(wave: number, players: number) {
  return 3 + wave + players * 2;
}

/** Monster health grows with the team, so a team of four isn't done in seconds. */
export function dungeonHp(baseHp: number, players: number, boss: boolean) {
  return Math.round(baseHp * (boss ? 0.6 + players * 0.5 : 0.8 + players * 0.25));
}

/**
 * The private room a team (or a player alone) gets: a room code made from the team's id, so
 * every member who walks in finds the same cave.
 */
export function dungeonParty(key: string) {
  let hash = 2166136261;
  for (const char of key) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  let code = "";
  for (let i = 0; i < PARTY_CODE_LENGTH; i++) {
    code += PARTY_ALPHABET[hash % PARTY_ALPHABET.length];
    hash = Math.floor(hash / PARTY_ALPHABET.length) ^ Math.imul(hash, 2654435761) >>> 0;
  }
  return code;
}

export type DungeonPhase = "countdown" | "wave" | "boss" | "cleared" | "failed";

/** What everyone in the dungeon sees about the run, sent on every change and each second. */
export interface DungeonStatus {
  phase: DungeonPhase;
  wave: number;
  waves: number;
  /** Monsters still standing in this wave. */
  left: number;
  /** Time left on the clock, or until the next thing starts. */
  ms: number;
}
