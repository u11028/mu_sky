// Fighting between players: health, attacks, levels. The server decides every hit.

/** How far in front of a player a swing reaches. */
export const ATTACK_RANGE = 72;
export const ATTACK_COOLDOWN_MS = 450;
/** A tenth of hits are critical and deal this much more. */
export const CRIT_CHANCE = 0.1;
export const CRIT_MULTIPLIER = 1.8;

export const RESPAWN_MS = 5000;
/** Freshly (re)spawned players can't be hurt for a moment, so nobody is killed on arrival. */
export const SPAWN_SHIELD_MS = 3000;
/** Health comes back by itself after this long without being hit... */
export const REGEN_DELAY_MS = 5000;
/** ...at this share of the maximum per second. */
export const REGEN_PER_SECOND = 0.04;

export const MAX_LEVEL = 999;

export function maxHp(level: number) {
  return 100 + (level - 1) * 20;
}

export function attackPower(level: number) {
  return 12 + (level - 1) * 3;
}

/** Experience needed to go from this level to the next. */
export function xpToNext(level: number) {
  return 50 + level * 50;
}

export function killXp(victimLevel: number) {
  return 40 + victimLevel * 10;
}

/** What every client is told about a hit, to draw it. */
export interface HitEvent {
  attacker: string;
  target: string;
  damage: number;
  crit?: boolean;
  /** The target is immortal (GM): no damage. */
  blocked?: boolean;
  killed?: boolean;
}
