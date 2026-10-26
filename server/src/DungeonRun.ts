// One dungeon room's runs: a countdown, four waves, the boss, against the clock; then a rest and
// the next run for whoever is still there. The room supplies the players and hands out rewards.

import {
  bossFor,
  DUNGEON,
  dungeonHp,
  type DungeonPhase,
  type DungeonStatus,
  waveKinds,
  waveSize,
} from "../../shared/dungeon.ts";
import { monsterKind, monsterMaxHp } from "../../shared/monsters.ts";
import type { Region } from "../../shared/regions.ts";
import { isBlocked, type RegionLayout } from "../../shared/regionThemes.ts";
import type { MonsterSystem } from "./MonsterSystem.ts";
import type { Monster, Player } from "./schema.ts";

export interface DungeonHost {
  region: Region;
  layout: RegionLayout;
  monsters: MonsterSystem;
  monsterStates: Map<string, Monster>;
  /** The players in the hall who can fight: alive or not, but not away or leaving. */
  heroes(): Player[];
  broadcast(type: string, message: unknown): void;
  announce(text: string): void;
  /** The run was won: pay everyone there. */
  cleared(bossKind: string): void;
}

export class DungeonRun {
  private phase: DungeonPhase | "idle" = "idle";
  private wave = 0;
  /** When the countdown, breather or rest ends; and when the clock runs out. */
  private nextAt = 0;
  private endsAt = 0;
  private alive = new Set<string>();
  private bossKind = "";
  private lastStatus = "";
  private lastSentAt = 0;
  /** Where each monster was when last seen moving, to catch one stuck behind a rock. */
  private seen = new Map<string, { x: number; y: number; at: number }>();

  constructor(private readonly host: DungeonHost) {}

  tick(now: number) {
    const heroes = this.host.heroes();
    if (heroes.length === 0) {
      // Everyone gone: the hall is emptied, ready for the next team.
      if (this.phase !== "idle") {
        this.clearMonsters();
        this.phase = "idle";
      }
      return;
    }
    if (this.phase === "idle") {
      this.begin(now);
    }
    this.forgetFallen();
    this.unstick(now, heroes);

    switch (this.phase) {
      case "countdown":
        if (now >= this.nextAt) {
          this.wave++;
          if (this.wave === 1) {
            this.endsAt = now + DUNGEON.timeMs;
          }
          this.spawnWave(heroes);
          this.phase = "wave";
        }
        break;
      case "wave":
      case "boss":
        if (now >= this.endsAt) {
          this.clearMonsters();
          this.phase = "failed";
          this.nextAt = now + DUNGEON.restMs;
          this.host.announce("⌛ หมดเวลา! ดันเจี้ยนไม่สำเร็จ รอบใหม่จะเริ่มในอีกครู่");
        } else if (this.alive.size === 0) {
          this.afterFight(now, heroes);
        }
        break;
      case "cleared":
      case "failed":
        if (now >= this.nextAt) {
          this.begin(now);
        }
        break;
    }
    this.sendStatus(now);
  }

  /** The status for one newcomer, right away. */
  status(now = Date.now()): DungeonStatus {
    const phase = this.phase === "idle" ? "countdown" : this.phase;
    const fighting = phase === "wave" || phase === "boss";
    return {
      phase,
      wave: this.wave,
      waves: DUNGEON.waves,
      left: this.alive.size,
      ms: Math.max(0, (fighting ? this.endsAt : this.nextAt) - now),
    };
  }

  private begin(now: number) {
    this.clearMonsters();
    this.phase = "countdown";
    this.wave = 0;
    this.nextAt = now + DUNGEON.countdownMs;
  }

  /** A wave beaten: a breather and the next, or the boss after the last; the boss: the end. */
  private afterFight(now: number, heroes: Player[]) {
    if (this.phase === "boss") {
      this.phase = "cleared";
      this.nextAt = now + DUNGEON.restMs;
      this.host.cleared(this.bossKind);
      return;
    }
    if (this.wave < DUNGEON.waves) {
      this.phase = "countdown";
      this.nextAt = now + DUNGEON.breatherMs;
      return;
    }
    this.spawnBoss(heroes);
    this.phase = "boss";
  }

  private teamLevel(heroes: Player[]) {
    return Math.round(heroes.reduce((sum, hero) => sum + hero.level, 0) / heroes.length);
  }

  private spawnWave(heroes: Player[]) {
    const kinds = waveKinds(this.teamLevel(heroes));
    const count = waveSize(this.wave, heroes.length);
    for (let i = 0; i < count; i++) {
      const kindId = kinds[Math.floor(Math.random() * kinds.length)];
      const kind = monsterKind(kindId)!;
      const spot = this.spot(heroes);
      this.alive.add(this.host.monsters.summonAt(kindId, dungeonHp(monsterMaxHp(kind), heroes.length, false), spot.x, spot.y, DUNGEON.aggro));
    }
  }

  private spawnBoss(heroes: Player[]) {
    this.bossKind = bossFor(this.teamLevel(heroes));
    const kind = monsterKind(this.bossKind)!;
    const { minX, maxX, minY } = this.host.region.bounds;
    // At the far end of the hall from the way in.
    const id = this.host.monsters.summonAt(this.bossKind, dungeonHp(monsterMaxHp(kind), heroes.length, true), (minX + maxX) / 2, minY + 120, DUNGEON.aggro);
    this.alive.add(id);
    this.host.announce(`👑 บอส ${kind.name} ปรากฏตัวแล้ว! ล้มให้ได้ก่อนหมดเวลา`);
  }

  /** A free spot in the hall, away from the heroes and the way out. */
  private spot(heroes: Player[]) {
    const { bounds, portals } = this.host.region;
    let best = { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY + 100 };
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = bounds.minX + 60 + Math.random() * (bounds.maxX - bounds.minX - 120);
      const y = bounds.minY + 60 + Math.random() * (bounds.maxY - bounds.minY - 120);
      if (isBlocked(this.host.layout, x, y, 24) || portals.some((p) => Math.hypot(p.x - x, p.y - y) < 230)) {
        continue;
      }
      const nearest = Math.min(...heroes.map((hero) => Math.hypot(hero.x - x, hero.y - y)));
      if (nearest >= 220) {
        return { x, y };
      }
      if (nearest > bestScore) {
        best = { x, y };
        bestScore = nearest;
      }
    }
    return best;
  }

  /**
   * A monster that hasn't moved for a while, far from everyone, is stuck behind something: it is
   * brought next to a hero, or the wave could never end.
   */
  private unstick(now: number, heroes: Player[]) {
    for (const id of this.alive) {
      const monster = this.host.monsterStates.get(id);
      if (!monster) {
        continue;
      }
      const last = this.seen.get(id);
      if (!last || Math.hypot(monster.x - last.x, monster.y - last.y) > 20) {
        this.seen.set(id, { x: monster.x, y: monster.y, at: now });
        continue;
      }
      const far = heroes.every((hero) => Math.hypot(hero.x - monster.x, hero.y - monster.y) > 150);
      if (far && now - last.at > 6000) {
        const hero = heroes[Math.floor(Math.random() * heroes.length)];
        const angle = Math.random() * Math.PI * 2;
        const { bounds } = this.host.region;
        for (let attempt = 0; attempt < 12; attempt++) {
          const x = Math.min(bounds.maxX, Math.max(bounds.minX, hero.x + Math.cos(angle + attempt) * 110));
          const y = Math.min(bounds.maxY, Math.max(bounds.minY, hero.y + Math.sin(angle + attempt) * 110));
          if (!isBlocked(this.host.layout, x, y, 20)) {
            monster.x = x;
            monster.y = y;
            break;
          }
        }
        this.seen.set(id, { x: monster.x, y: monster.y, at: now });
      }
    }
  }

  /** Monsters that fell: no longer counted, and gone from the hall a moment later. */
  private forgetFallen() {
    for (const id of [...this.alive]) {
      const monster = this.host.monsterStates.get(id);
      if (!monster || monster.dead) {
        this.alive.delete(id);
        this.seen.delete(id);
        setTimeout(() => this.host.monsters.remove(id), 3000);
      }
    }
  }

  private clearMonsters() {
    for (const id of [...this.host.monsterStates.keys()]) {
      this.host.monsters.remove(id);
    }
    this.alive.clear();
  }

  /** On every change, and each second for the clock. */
  private sendStatus(now: number) {
    const status = this.status(now);
    const key = `${status.phase}|${status.wave}|${status.left}`;
    if (key !== this.lastStatus || now - this.lastSentAt >= 1000) {
      this.lastStatus = key;
      this.lastSentAt = now;
      this.host.broadcast("dungeon", status);
    }
  }
}
