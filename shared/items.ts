// Gold, potions and the weapon and armour upgrades sold in the shop.

export const POTION = {
  name: "ยาเลือด",
  price: 30,
  /** Share of the maximum health it gives back. */
  heal: 0.5,
  cooldownMs: 8000,
  /** Nobody carries more than this. */
  max: 99,
};

export interface Tier {
  name: string;
  price: number;
  /** Multiplier on damage (weapons) or maximum health (armour). */
  bonus: number;
  /** The glow of the weapon or the shine of the armour; none for the first tier. */
  color?: string;
}

export const WEAPON_TIERS: readonly Tier[] = [
  { name: "อาวุธฝึกหัด", price: 0, bonus: 1 },
  { name: "อาวุธเหล็กกล้า", price: 150, bonus: 1.15, color: "#dfe7ec" },
  { name: "อาวุธเงินแสงจันทร์", price: 500, bonus: 1.3, color: "#7fe3ff" },
  { name: "อาวุธทองคำราชันย์", price: 1500, bonus: 1.5, color: "#ffd60a" },
  { name: "อาวุธเพลิงมังกร", price: 4000, bonus: 1.8, color: "#ff4d3d" },
];

export const ARMOR_TIERS: readonly Tier[] = [
  { name: "ชุดผ้าเดินทาง", price: 0, bonus: 1 },
  { name: "เกราะหนังสัตว์", price: 120, bonus: 1.15, color: "#c49a6c" },
  { name: "เกราะโซ่เหล็ก", price: 450, bonus: 1.3, color: "#cfd8dc" },
  { name: "เกราะอัศวินทอง", price: 1300, bonus: 1.5, color: "#ffd60a" },
  { name: "เกราะเกล็ดมังกร", price: 3800, bonus: 1.8, color: "#ff4d3d" },
];

export type ShopItem = "potion" | "weapon" | "armor";

export function isShopItem(value: unknown): value is ShopItem {
  return value === "potion" || value === "weapon" || value === "armor";
}

/** Gold a monster drops: a little for small ones, a pile for a boss. Rounded, never zero. */
export function monsterGold(level: number, boss: boolean) {
  const base = boss ? 150 + level * 25 : 3 + level * 2;
  return Math.max(1, Math.round(base * (0.8 + Math.random() * 0.4)));
}
