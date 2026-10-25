// The monsters of one region: where they live, how they wander, chase, strike and come back.

import {
  BOSS_AGGRO,
  BOSS_ATTACK_RANGE,
  BOSS_RESPAWN_MS,
  MONSTER_AGGRO,
  MONSTER_ATTACK_MS,
  MONSTER_ATTACK_RANGE,
  MONSTER_CHASE_SPEED,
  MONSTER_LEASH,
  MONSTER_RESPAWN_MS,
  MONSTER_SAFE_RADIUS,
  MONSTER_SPEED,
  type MonsterKind,
  monsterDamage,
  monsterKind,
  monsterMaxHp,
  REGION_MONSTERS,
  WORLD_BOSS,
} from "../../shared/monsters.ts";
import { type Region, type RegionId, spawnPoint } from "../../shared/regions.ts";
import { isBlocked, type RegionLayout, slide } from "../../shared/regionThemes.ts";
import { Monster, type Player } from "./schema.ts";

/** What the monsters need from their room. */
export interface Arena {
  regionId: RegionId;
  region: Region;
  layout: RegionLayout;
  monsters: Map<string, Monster>;
  /** Players who can be chased: alive and not on their way out. */
  targets(): Iterable<[string, Player]>;
  broadcast(type: string, message: unknown): void;
  /** A monster's blow lands on a player; the room applies shields, immortality and death. */
  strikePlayer(monsterId: string, sessionId: string, damage: number): void;
  announce(text: string): void;
}

interface Mind {
  homeX: number;
  homeY: number;
  targetId?: string;
  /** Gave up a chase: walking home, healing on arrival. */
  returning: boolean;
  wanderTo?: { x: number; y: number };
  nextWanderAt: number;
  lastAttackAt: number;
  diedAt: number;
  /** Damage each player dealt, to share the reward. */
  damageBy: Map<string, number>;
  /** A one-off (the world boss): no leash, no healing on the way home, no coming back. */
  once: boolean;
}

export class MonsterSystem {
  private minds = new Map<string, Mind>();
  private nextId = 1;

  constructor(private readonly arena: Arena) {
    const { kinds, count, boss } = REGION_MONSTERS[arena.regionId];
    for (let i = 0; i < count; i++) {
      this.spawn(kinds[i % kinds.length], this.findHome(false));
    }
    this.spawn(boss, this.findHome(true));
  }

  /** The bookkeeping of a monster, for the room's reward and aggro logic. */
  mind(id: string) {
    return this.minds.get(id);
  }

  kind(monster: Monster) {
    return monsterKind(monster.kind)!;
  }

  /** A player hurt this monster: it remembers how much, and turns on them if it was idle. */
  hurt(id: string, sessionId: string, damage: number) {
    const mind = this.minds.get(id);
    if (!mind) {
      return;
    }
    mind.damageBy.set(sessionId, (mind.damageBy.get(sessionId) ?? 0) + damage);
    if (!mind.targetId && !mind.returning) {
      mind.targetId = sessionId;
    }
  }

  /** The monster fell. Returns who fought it, biggest share first, then forgets them. */
  defeat(id: string) {
    const mind = this.minds.get(id);
    const monster = this.arena.monsters.get(id);
    if (!mind || !monster) {
      return [];
    }
    monster.dead = true;
    monster.hp = 0;
    mind.diedAt = Date.now();
    mind.targetId = undefined;
    const fighters = [...mind.damageBy].sort((a, b) => b[1] - a[1]).map(([sessionId]) => sessionId);
    mind.damageBy.clear();
    return fighters;
  }

  update(deltaMs: number) {
    const now = Date.now();
    this.arena.monsters.forEach((monster, id) => {
      const mind = this.minds.get(id)!;
      const kind = this.kind(monster);

      if (monster.dead) {
        if (mind.once) {
          return;
        }
        if (now - mind.diedAt >= (kind.boss ? BOSS_RESPAWN_MS : MONSTER_RESPAWN_MS)) {
          this.revive(monster, mind, kind);
        }
        return;
      }

      const target = this.chooseTarget(monster, mind, kind);
      if (target) {
        const range = attackRange(kind);
        const distance = Math.hypot(target.x - monster.x, target.y - monster.y);
        if (distance > range * 0.8) {
          this.step(monster, target.x, target.y, MONSTER_CHASE_SPEED, deltaMs);
        } else if (now - mind.lastAttackAt >= MONSTER_ATTACK_MS) {
          mind.lastAttackAt = now;
          this.strike(id, monster, kind, mind.targetId!);
        }
        return;
      }

      if (mind.returning) {
        if (this.step(monster, mind.homeX, mind.homeY, MONSTER_CHASE_SPEED, deltaMs) < 8) {
          mind.returning = false;
          if (!mind.once) {
            monster.hp = monster.maxHp;
            mind.damageBy.clear();
          }
        }
        return;
      }

      // Idle: amble to a nearby spot now and then.
      if (now >= mind.nextWanderAt) {
        mind.nextWanderAt = now + 2500 + Math.random() * 4000;
        const angle = Math.random() * Math.PI * 2;
        const reach = Math.random() * 120;
        mind.wanderTo = { x: mind.homeX + Math.cos(angle) * reach, y: mind.homeY + Math.sin(angle) * reach };
      }
      if (mind.wanderTo && this.step(monster, mind.wanderTo.x, mind.wanderTo.y, MONSTER_SPEED, deltaMs) < 4) {
        mind.wanderTo = undefined;
      }
    });
  }

  /** Keeps chasing the current target while it's in reach, or picks the closest player that comes near. */
  private chooseTarget(monster: Monster, mind: Mind, kind: MonsterKind) {
    const players = new Map(this.arena.targets());
    const current = mind.targetId ? players.get(mind.targetId) : undefined;
    if (current && (mind.once || Math.hypot(current.x - mind.homeX, current.y - mind.homeY) <= MONSTER_LEASH)) {
      return current;
    }
    if (mind.targetId) {
      // Lost them, or lured too far: go home.
      mind.targetId = undefined;
      mind.returning = true;
      return undefined;
    }
    if (mind.returning) {
      return undefined;
    }

    const aggro = kind.boss ? BOSS_AGGRO : MONSTER_AGGRO;
    let closest: [string, Player] | undefined;
    let closestDistance = aggro;
    for (const [sessionId, player] of players) {
      const distance = Math.hypot(player.x - monster.x, player.y - monster.y);
      if (distance < closestDistance) {
        closest = [sessionId, player];
        closestDistance = distance;
      }
    }
    mind.targetId = closest?.[0];
    return closest?.[1];
  }

  /** A blow at the target; a boss slams the ground and hits everyone around it. */
  private strike(id: string, monster: Monster, kind: MonsterKind, targetId: string) {
    this.arena.broadcast("mattack", { id });
    const damage = Math.round(monsterDamage(kind) * (0.85 + Math.random() * 0.3));
    if (!kind.boss) {
      this.arena.strikePlayer(id, targetId, damage);
      return;
    }
    for (const [sessionId, player] of this.arena.targets()) {
      if (Math.hypot(player.x - monster.x, player.y - monster.y) <= attackRange(kind)) {
        this.arena.strikePlayer(id, sessionId, damage);
      }
    }
  }

  /** Walks towards a point, sliding around props. Returns the distance still to go. */
  private step(monster: Monster, toX: number, toY: number, speed: number, deltaMs: number) {
    const dx = toX - monster.x;
    const dy = toY - monster.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) {
      return distance;
    }

    const length = Math.min(distance, (speed * deltaMs) / 1000);
    const { bounds } = this.arena.region;
    const next = slide(this.arena.layout, monster.x, monster.y, (dx / distance) * length, (dy / distance) * length);
    monster.x = Math.min(bounds.maxX, Math.max(bounds.minX, next.x));
    monster.y = Math.min(bounds.maxY, Math.max(bounds.minY, next.y));
    return distance - length;
  }

  /** Brings in a one-off monster, the world boss, with this much health. Returns its id. */
  summon(kindId: string, maxHp: number) {
    const id = this.spawn(kindId, this.findHome(false, true), true);
    const monster = this.arena.monsters.get(id)!;
    monster.maxHp = maxHp;
    monster.hp = maxHp;
    return id;
  }

  remove(id: string) {
    this.arena.monsters.delete(id);
    this.minds.delete(id);
  }

  private spawn(kindId: string, home: { x: number; y: number }, once = false) {
    const kind = monsterKind(kindId)!;
    const monster = new Monster();
    monster.kind = kindId;
    monster.level = kind.level;
    monster.maxHp = monsterMaxHp(kind);
    monster.hp = monster.maxHp;
    monster.x = home.x;
    monster.y = home.y;
    const id = `mob${this.nextId++}`;
    this.arena.monsters.set(id, monster);
    this.minds.set(id, {
      homeX: home.x,
      homeY: home.y,
      returning: false,
      nextWanderAt: Date.now() + Math.random() * 3000,
      lastAttackAt: 0,
      diedAt: 0,
      damageBy: new Map(),
      once,
    });
    return id;
  }

  private revive(monster: Monster, mind: Mind, kind: MonsterKind) {
    monster.x = mind.homeX;
    monster.y = mind.homeY;
    monster.hp = monster.maxHp;
    monster.dead = false;
    mind.returning = false;
    if (kind.boss) {
      this.arena.announce(`⚠ บอส ${kind.name} Lv.${kind.level} ปรากฏตัวที่${this.arena.region.name}แล้ว!`);
    }
  }

  /**
   * A free spot away from where players arrive and from the portals; bosses go far out, and the
   * world boss stays close enough to the middle that everyone finds it.
   */
  private findHome(boss: boolean, world = false) {
    const { bounds, portals } = this.arena.region;
    const centre = spawnPoint(this.arena.regionId);
    let best = { x: bounds.minX + 100, y: bounds.minY + 100 };
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < (boss ? 200 : 60); attempt++) {
      const x = bounds.minX + 80 + Math.random() * (bounds.maxX - bounds.minX - 160);
      const y = bounds.minY + 80 + Math.random() * (bounds.maxY - bounds.minY - 160);
      const fromCentre = Math.hypot(x - centre.x, y - centre.y);
      const nearPortal = portals.some((p) => Math.hypot(p.x - x, p.y - y) < 180);
      if (fromCentre < MONSTER_SAFE_RADIUS || nearPortal || isBlocked(this.arena.layout, x, y, 30)) {
        continue;
      }
      if (world && fromCentre > MONSTER_SAFE_RADIUS + 200) {
        continue;
      }
      // Ordinary monsters take the first good spot; a boss keeps looking for the farthest one.
      if (!boss) {
        return { x, y };
      }
      if (fromCentre > bestScore) {
        best = { x, y };
        bestScore = fromCentre;
      }
    }
    return best;
  }
}

function attackRange(kind: MonsterKind) {
  return kind.world ? WORLD_BOSS.attackRange : kind.boss ? BOSS_ATTACK_RANGE : MONSTER_ATTACK_RANGE;
}
