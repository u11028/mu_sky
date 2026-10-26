// Auto-hunting, as mobile RPGs have it: the player's hero picks the nearest monster it can take on,
// walks into reach for its class (archers keep their distance), attacks, uses its attacking skills
// when they help, and drinks a potion when health runs low. The game's own messages do the rest,
// so the server checks everything as if the player pressed the buttons.

import type { SkillId } from "../../../shared/combat.ts";

export interface HuntMonster {
  id: string;
  x: number;
  y: number;
  level: number;
  boss: boolean;
  world: boolean;
}

export interface HuntView {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level: number;
  potions: number;
  /** How far this class reaches with its basic attack, in pixels. */
  reach: number;
  monsters: HuntMonster[];
}

export interface HuntMove {
  dir: { x: number; y: number };
  attack: boolean;
  skill?: SkillId;
  /** The class skill, when it is ready and a fight is on. */
  ultimate: boolean;
  potion: boolean;
}

/** Bosses this many levels above the player are left alone. */
const BOSS_LEVEL_MARGIN = 2;
/** Monsters further than this are not chased. */
const SEARCH = 900;
const POTION_AT = 0.35;

export class AutoHunt {
  private targetId?: string;
  /** Monsters that couldn't be reached (a rock in the way): left alone for a while. */
  private skipped = new Map<string, number>();
  private progress = { x: 0, y: 0, at: 0 };
  private nextAttack = 0;
  private nextPotion = 0;
  private nextSkill: Partial<Record<SkillId, number>> = {};
  private nextUltimate = 0;

  constructor(private readonly ultimateCooldownMs: () => number) {}

  reset() {
    this.targetId = undefined;
    this.skipped.clear();
  }

  decide(view: HuntView, now: number): HuntMove {
    const move: HuntMove = { dir: { x: 0, y: 0 }, attack: false, ultimate: false, potion: false };
    if (view.hp <= 0) {
      return move;
    }
    if (view.hp / view.maxHp < POTION_AT && view.potions > 0 && now >= this.nextPotion) {
      move.potion = true;
      this.nextPotion = now + 8500;
    }

    const target = this.pickTarget(view, now);
    if (!target) {
      return move;
    }
    const dx = target.x - view.x;
    const dy = target.y - view.y;
    const distance = Math.hypot(dx, dy);
    // Bosses are big: they can be reached from further off.
    const reach = view.reach * (target.boss ? 1.1 : 0.85);

    if (distance > reach) {
      move.dir = { x: dx / distance, y: dy / distance };
      this.watchProgress(view, now, target.id);
      return move;
    }
    this.progress.at = 0;
    if (now >= this.nextAttack) {
      move.attack = true;
      this.nextAttack = now + 350;
    }
    // The spinning blade when several are close, the lightning strike now and then.
    const crowd = view.monsters.filter((m) => Math.hypot(m.x - view.x, m.y - view.y) < 100).length;
    if (now >= this.nextUltimate) {
      move.ultimate = true;
      this.nextUltimate = now + this.ultimateCooldownMs() + 500;
    }
    if (crowd >= 2 && now >= (this.nextSkill.spin ?? 0)) {
      move.skill = "spin";
      this.nextSkill.spin = now + 7000;
    } else if (now >= (this.nextSkill.strike ?? 0)) {
      move.skill = "strike";
      this.nextSkill.strike = now + 9000;
    }
    return move;
  }

  private pickTarget(view: HuntView, now: number) {
    const current = view.monsters.find((m) => m.id === this.targetId);
    if (current && Math.hypot(current.x - view.x, current.y - view.y) < SEARCH) {
      return current;
    }
    let best: HuntMonster | undefined;
    let bestDistance = SEARCH;
    for (const monster of view.monsters) {
      if (monster.world || (monster.boss && monster.level > view.level + BOSS_LEVEL_MARGIN) || (this.skipped.get(monster.id) ?? 0) > now) {
        continue;
      }
      const distance = Math.hypot(monster.x - view.x, monster.y - view.y);
      if (distance < bestDistance) {
        best = monster;
        bestDistance = distance;
      }
    }
    this.targetId = best?.id;
    this.progress.at = 0;
    return best;
  }

  /** Walking but not getting anywhere for two seconds: that one is out of reach for now. */
  private watchProgress(view: HuntView, now: number, targetId: string) {
    if (!this.progress.at) {
      this.progress = { x: view.x, y: view.y, at: now };
      return;
    }
    if (now - this.progress.at < 2000) {
      return;
    }
    if (Math.hypot(view.x - this.progress.x, view.y - this.progress.y) < 30) {
      this.skipped.set(targetId, now + 15_000);
      this.targetId = undefined;
    }
    this.progress = { x: view.x, y: view.y, at: now };
  }
}
