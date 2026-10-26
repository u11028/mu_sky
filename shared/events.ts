// Timed events: what brings everyone into the world at the same time.
//
// อสูรบุก (the invasion): on every whole hour, Thai time, demons pour into every region with
// players for ten minutes. Each one beaten scores; the best of each world win big, and everyone
// who scored gets something. A warning goes out five minutes and one minute before.
//
// กระต่ายทองคำ (the golden rabbit): now and then one appears in a busy region and runs from
// players. Every hit shakes coins out of it; catching it pays a jackpot.

import type { RegionId } from "./regions.ts";

export const INVASION = {
  everyMs: 60 * 60_000,
  lastsMs: 10 * 60_000,
  /** Warnings this long before the start. */
  warnMs: [5 * 60_000, 60_000],
  /** Demons alive at once in a region: a few, and more for each player there. */
  base: 6,
  perPlayer: 3,
  max: 18,
  /** Tougher than the region's own: more health, and they notice players from far away. */
  hpScale: 1.4,
  aggro: 650,
  /** Where a new one appears: this far from a player. */
  spawnNear: [260, 420] as const,
  /** A demon lord comes at the start and halfway. */
  lordAtMs: [0, 5 * 60_000],
  lordHpScale: 2.5,
  /** Points: each fighter of a demon, and of a demon lord. */
  points: 1,
  lordPoints: 10,
} as const;

/** Rewards for the best three of a world, then for everyone who scored this much or more. */
export const INVASION_PRIZES: readonly { gold: number; potions: number; gear?: "boss" }[] = [
  { gold: 2500, potions: 5, gear: "boss" },
  { gold: 1500, potions: 3, gear: "boss" },
  { gold: 900, potions: 2 },
];
export const INVASION_SCORED = [
  { from: 10, gold: 400, potions: 2 },
  { from: 1, gold: 150, potions: 1 },
] as const;

/** When the next invasion starts: the next whole hour (Thailand's clock is a whole number of hours ahead). */
export function nextInvasionAt(now = Date.now()) {
  return Math.ceil(now / INVASION.everyMs) * INVASION.everyMs;
}

export const GOLD_RABBIT = {
  kind: "goldRabbit",
  /** Between one and the next. */
  everyMs: [12 * 60_000, 20 * 60_000] as const,
  firstMs: 4 * 60_000,
  lastsMs: 60_000,
  /** Health: a base and more for each player in the region. */
  hp: 1500,
  hpPerPlayer: 400,
  /** Coins each hit shakes out, and the jackpot for the one who hit it most (others get a third). */
  coinsPerHit: 25,
  jackpot: 3000,
  /** It runs once a player comes this close, at this speed: players are faster, but not by much. */
  fleeFrom: 320,
  speed: 165,
} as const;

/** What the event banner shows each player, every couple of seconds while an invasion is near or on. */
export interface InvasionStatus {
  phase: "soon" | "on";
  startsAt: number;
  endsAt: number;
  /** The best of this world so far. */
  top: { name: string; score: number }[];
  mine: number;
  /** 0 when the player hasn't scored. */
  rank: number;
}

/** Sent to each player of a world when an invasion ends. */
export interface InvasionEnd {
  top: { name: string; score: number }[];
  mine: number;
  rank: number;
  /** What the player won, as text; "" for nothing. */
  prize: string;
}

export interface GoldRabbitEvent {
  region: RegionId;
  leftMs: number;
}
