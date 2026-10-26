// Little buzzes of the phone for what the player feels: a blow taken, a critical hit landed, a
// level gained. Phones that can't (iPhones, computers) just don't; the settings can turn it off.

import { settings } from "./settings.ts";

/** Ready-made patterns, in milliseconds of buzz and pause. */
export const BUZZ = {
  hurt: 35,
  hurtHard: 70,
  crit: 18,
  death: [90, 60, 140],
  levelUp: [40, 50, 40, 50, 80],
  rareFind: [30, 40, 30, 40, 100],
  worldBoss: [120, 80, 120],
} satisfies Record<string, number | number[]>;

export function buzz(pattern: number | number[]) {
  if (settings().vibrate && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Refused before the first touch: nothing to feel yet.
    }
  }
}
