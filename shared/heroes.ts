// The heroes a player can be, and how each one fights. The server stores the chosen one's index
// as the player's `skin`, and uses its class for health, damage and the basic attack.

/** Swings at whatever is in front, or shoots something that flies. */
export type Attack =
  | {
      kind: "melee";
      /** Reach in world pixels. */
      range: number;
      /** How wide the swing is: the smallest cosine between facing and target that still hits. */
      arc: number;
    }
  | {
      kind: "ranged";
      range: number;
      projectile: "arrow" | "bolt" | "magic";
      /** Pixels per second. */
      speed: number;
    };

export interface Hero {
  /** File name of the model in assets/3d/heroes. */
  id: string;
  name: string;
  /** One line on how it plays, for the join screen. */
  role: string;
  /** Weapons held in the right and left hand, from assets/3d/weapons. */
  right?: string;
  left?: string;
  attack: Attack;
  /** Time between basic attacks. */
  cooldownMs: number;
  /** Multipliers on the level's health and damage, and the chance of a critical hit. */
  hp: number;
  power: number;
  crit: number;
}

const SWORD_AND_SHIELD = {
  attack: { kind: "melee", range: 72, arc: 0.25 },
  cooldownMs: 450,
  hp: 1.3,
  power: 1,
  crit: 0.1,
} as const;
const HEAVY_AXE = {
  attack: { kind: "melee", range: 82, arc: -0.1 },
  cooldownMs: 560,
  hp: 1.15,
  power: 1.3,
  crit: 0.1,
} as const;
const QUICK_BLADES = {
  attack: { kind: "melee", range: 64, arc: 0.3 },
  cooldownMs: 300,
  hp: 0.95,
  power: 0.8,
  crit: 0.3,
} as const;
const MAGIC = {
  attack: { kind: "ranged", range: 330, projectile: "magic", speed: 560 },
  cooldownMs: 600,
  hp: 0.85,
  power: 1.25,
  crit: 0.1,
} as const;

export const HEROES: readonly Hero[] = [
  { id: "Knight", name: "อัศวิน", role: "สายแทงค์ · ดาบกับโล่ เลือดเยอะที่สุด", right: "sword_1handed", left: "shield_badge_color", ...SWORD_AND_SHIELD },
  { id: "Barbarian", name: "นักรบเถื่อน", role: "สายบู๊ · ขวานตีแรง ฟันกว้าง", right: "axe_1handed", left: "shield_round_barbarian", ...HEAVY_AXE },
  { id: "Mage", name: "จอมเวท", role: "สายเวท · ยิงลูกเวทระยะไกล แรงแต่เลือดน้อย", right: "staff", left: "spellbook_open", ...MAGIC },
  {
    id: "Ranger",
    name: "พรานป่า",
    role: "สายธนู · ยิงไกลที่สุด ยิงไว",
    left: "bow_withString",
    attack: { kind: "ranged", range: 380, projectile: "arrow", speed: 840 },
    cooldownMs: 420,
    hp: 0.9,
    power: 0.95,
    crit: 0.15,
  },
  { id: "Rogue", name: "โจรเงา", role: "สายลอบ · มีดคู่ ตีไว คริติคอลสูง", right: "dagger", left: "dagger", ...QUICK_BLADES },
  {
    id: "Rogue_Hooded",
    name: "นักฆ่าคลุมหน้า",
    role: "สายหน้าไม้ · ยิงระยะกลาง คริติคอลสูง",
    right: "crossbow_1handed",
    left: "dagger",
    attack: { kind: "ranged", range: 300, projectile: "bolt", speed: 920 },
    cooldownMs: 520,
    hp: 0.9,
    power: 1.1,
    crit: 0.25,
  },
  { id: "Skeleton_Warrior", name: "อัศวินกระดูก", role: "สายแทงค์ · ดาบกับโล่ เลือดเยอะ", right: "Skeleton_Blade", left: "Skeleton_Shield_Small_A", ...SWORD_AND_SHIELD },
  { id: "Skeleton_Mage", name: "จอมเวทกระดูก", role: "สายเวท · ยิงลูกเวทระยะไกล", right: "Skeleton_Staff", ...MAGIC },
  { id: "Skeleton_Rogue", name: "โจรกระดูก", role: "สายบู๊ · ขวานตีแรง ฟันกว้าง", right: "Skeleton_Axe", ...HEAVY_AXE },
  { id: "Skeleton_Minion", name: "สมุนกระดูก", role: "สายลอบ · ตีไว คริติคอลสูง", right: "Skeleton_Blade", ...QUICK_BLADES },
];

/** Players saved with an older, larger list of looks still get a hero. */
export function heroOf(skin: number) {
  const count = HEROES.length;
  return HEROES[((Math.floor(skin) % count) + count) % count];
}

/** A shot in flight, as every client is told to draw it. */
export interface ShotEvent {
  id: number;
  by: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  range: number;
  projectile: "arrow" | "bolt" | "magic";
}
