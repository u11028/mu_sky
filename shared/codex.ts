// The collection book: every monster kind, how many of each the player has beaten, and a gold
// reward the first time each kind is "complete"; the gear names found, by rarity. Completing kinds
// counts towards two titles (see titles.ts, stat "codex").

import { MONSTER_KINDS, type MonsterKind, type MonsterKindId, REGION_MONSTERS } from "./monsters.ts";
import type { RegionId } from "./regions.ts";

/** Kills that complete a kind: ordinary monsters, bosses, the world boss. */
export function codexGoal(kind: MonsterKind) {
  return kind.world ? 1 : kind.boss ? 3 : 10;
}

/** Gold for completing a kind. */
export function codexReward(kind: MonsterKind) {
  return Math.round((kind.world ? 1000 : kind.boss ? 150 : 25) * (1 + kind.level / 5));
}

/** The book's pages: the monsters of each region, then the world boss, then those of timed events. */
export const CODEX_PAGES: { title: string; region?: RegionId; kinds: MonsterKindId[] }[] = [
  ...(Object.keys(REGION_MONSTERS) as RegionId[])
    .filter((region) => REGION_MONSTERS[region].boss)
    .map((region) => ({
      title: region,
      region,
      kinds: [...REGION_MONSTERS[region].kinds, REGION_MONSTERS[region].boss!],
    })),
  { title: "บอสโลก", kinds: (Object.keys(MONSTER_KINDS) as MonsterKindId[]).filter((id) => (MONSTER_KINDS[id] as MonsterKind).world) },
  { title: "อีเวนต์", kinds: ["goldRabbit"] },
];

export const CODEX_KINDS = CODEX_PAGES.flatMap((page) => page.kinds);

/** What the client shows: kills by kind, and the gear names found. */
export interface CodexView {
  hunted: Partial<Record<string, number>>;
  found: string[];
}
