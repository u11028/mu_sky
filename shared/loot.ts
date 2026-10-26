// Gear that monsters drop: a weapon (more damage) and a charm (more health), each of a rarity.
// It works on top of the shop's tiers, so buying an upgrade and finding a good drop both count.

export type GearSlot = "weapon" | "charm";

export interface Rarity {
  name: string;
  color: string;
  /** The bonus a piece of this rarity rolls between. */
  min: number;
  max: number;
  /** Gold for selling one, before the monster's level adds to it. */
  sell: number;
}

export const RARITIES: readonly Rarity[] = [
  { name: "ธรรมดา", color: "#d9dee3", min: 1.03, max: 1.06, sell: 5 },
  { name: "ดี", color: "#4ade80", min: 1.07, max: 1.12, sell: 15 },
  { name: "หายาก", color: "#4aa8ff", min: 1.13, max: 1.2, sell: 50 },
  { name: "ล้ำค่า", color: "#c27bff", min: 1.22, max: 1.32, sell: 200 },
  { name: "ตำนาน", color: "#ff9a2e", min: 1.35, max: 1.5, sell: 800 },
];

export const LEGENDARY = RARITIES.length - 1;

const NAMES: Record<GearSlot, readonly (readonly string[])[]> = {
  weapon: [
    ["ดาบสนิมเขรอะ", "ไม้ตะพดเก่า", "มีดพร้าทุ่งนา", "คันธนูไม้ไผ่"],
    ["ดาบทหารยาม", "ขวานคนตัดไม้", "ทวนเหล็กหล่อ", "คทาหินเขียว"],
    ["ใบมีดแสงจันทร์", "ขวานคลื่นทะเล", "ธนูขนนกเหยี่ยว", "คทาน้ำแข็งดอย"],
    ["คมเขี้ยวพญานาค", "ค้อนฟ้าผ่า", "ธนูเงาราตรี", "คทาดวงดาวตก"],
    ["ดาบเทพอัสนีบาต", "ขวานราชันย์มังกร", "ธนูพระอาทิตย์ทอง", "คทาจักรวาลนิรันดร์"],
  ],
  charm: [
    ["เชือกมงคลขาด", "พระเครื่องดินเผา", "ลูกปัดไม้"],
    ["ตะกรุดทองแดง", "แหวนหยกอ่อน", "กำไลเงิน"],
    ["เหรียญพญาเต่า", "จี้ไพลินฟ้า", "ผ้ายันต์ห้าแถว"],
    ["ตะกรุดมหาอุด", "แก้วสารพัดนึก", "สร้อยเกล็ดนาค"],
    ["ดวงตาพญาครุฑ", "มงกุฎหิมพานต์", "หัวใจมังกรเพลิง"],
  ],
};

/** Every name a piece of each rarity can have, weapons and charms, for the collection book. */
export const GEAR_NAMES_BY_RARITY: readonly (readonly string[])[] = RARITIES.map((_, rarity) => [...NAMES.weapon[rarity], ...NAMES.charm[rarity]]);

export interface Gear {
  /** Unique within the player's bag. */
  id: string;
  slot: GearSlot;
  rarity: number;
  name: string;
  /** Damage (weapon) or maximum health (charm) multiplier. */
  bonus: number;
  /** The level of the monster it came from: worth more gold when sold. */
  level: number;
  /** Enhancement, +0 to +10 (see `enhance*` below); missing on gear from before it existed. */
  plus?: number;
}

/** Bag space; past it a new find is sold at once. */
export const BAG_SIZE = 24;

/** Chance that a normal monster drops anything. */
const DROP_CHANCE = 0.2;
/** How likely each rarity is, common first: normal monsters and bosses. */
const WEIGHTS = [55, 28, 12, 4, 1];
const BOSS_WEIGHTS = [0, 0, 50, 36, 14];
/** The world boss gives everyone who fought it something good. */
const WORLD_BOSS_WEIGHTS = [0, 0, 0, 70, 30];

export type DropSource = "monster" | "boss" | "world-boss";

function pick(weights: readonly number[]) {
  let roll = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < weights.length; index++) {
    roll -= weights[index];
    if (roll < 0) {
      return index;
    }
  }
  return 0;
}

/** What a kill drops, if anything. */
export function rollGear(source: DropSource, level: number): Omit<Gear, "id"> | undefined {
  if (source === "monster" && Math.random() >= DROP_CHANCE) {
    return undefined;
  }
  const rarity = pick(source === "monster" ? WEIGHTS : source === "boss" ? BOSS_WEIGHTS : WORLD_BOSS_WEIGHTS);
  const slot: GearSlot = Math.random() < 0.55 ? "weapon" : "charm";
  const names = NAMES[slot][rarity];
  const { min, max } = RARITIES[rarity];
  return {
    slot,
    rarity,
    name: names[Math.floor(Math.random() * names.length)],
    bonus: Math.round((min + Math.random() * (max - min)) * 100) / 100,
    level,
  };
}

export function sellPrice(gear: Pick<Gear, "rarity" | "level" | "plus">) {
  // An enhanced piece fetches back some of the gold put into it.
  return Math.round(RARITIES[gear.rarity].sell * (1 + gear.level / 10) * (1 + (gear.plus ?? 0) * 0.5));
}

/** A piece's multiplier with its enhancement: each step makes it 6% stronger (a legendary ×1.35 is ×2.16 at +10). */
export function gearPower(gear: Pick<Gear, "bonus" | "plus">) {
  return Math.round(gear.bonus * (1 + (gear.plus ?? 0) * 0.06) * 100) / 100;
}

export function gearEffect(gear: Pick<Gear, "slot" | "bonus" | "plus">) {
  return `${gear.slot === "weapon" ? "โจมตี" : "เลือดสูงสุด"} ×${gearPower(gear)}`;
}

/** The name with its enhancement, "+7 ดาบเทพอัสนีบาต". */
export function gearName(gear: Pick<Gear, "name" | "plus">) {
  return gear.plus ? `+${gear.plus} ${gear.name}` : gear.name;
}

/** The player's bag and what they have on, as the client shows it. */
export interface BagView {
  items: Gear[];
  equipped: Partial<Record<GearSlot, string>>;
}

/** A drop seen by everyone in the region: a beam of light where the monster fell. */
export interface LootEvent {
  /** Session id of the finder. */
  by: string;
  x: number;
  y: number;
  rarity: number;
  name: string;
  /** Sold at once because the bag was full. */
  sold?: number;
}

// ---- Enhancement ----

export const MAX_PLUS = 10;
/** Chance to reach each step, from +1 to +10. */
const ENHANCE_CHANCE = [1, 1, 1, 0.8, 0.7, 0.6, 0.45, 0.35, 0.25, 0.15];
/** From this step on, a failure takes the piece one step back (it never breaks). */
export const ENHANCE_RISKY_FROM = 7;

/** Gold to try for the next step: dearer with each step, and for rarer pieces. */
export function enhanceCost(gear: Pick<Gear, "rarity" | "plus">) {
  return Math.round(40 * 1.55 ** (gear.plus ?? 0) * (1 + gear.rarity * 0.75));
}

/** The chance (0 to 1) that the next step works. */
export function enhanceChance(gear: Pick<Gear, "plus">) {
  return ENHANCE_CHANCE[gear.plus ?? 0] ?? 0;
}
