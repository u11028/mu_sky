// Wings worn on the back and animals to ride, bought in the shop and kept for good.
// Index 0 in each list means "none".

export type WingStyle = "feather" | "bat" | "butterfly" | "flame" | "dragon" | "cosmic";

export interface Wing {
  name: string;
  price: number;
  /** Multiplier on damage while worn. */
  power: number;
  style: WingStyle;
  /** Main colour and the glow at the edges. */
  color: string;
  glow: string;
}

export const WINGS: readonly Wing[] = [
  { name: "ไม่ใส่ปีก", price: 0, power: 1, style: "feather", color: "#ffffff", glow: "#ffffff" },
  { name: "ปีกนางฟ้าสีขาว", price: 800, power: 1.05, style: "feather", color: "#ffffff", glow: "#bfe9ff" },
  { name: "ปีกปีศาจรัตติกาล", price: 1500, power: 1.08, style: "bat", color: "#2b1238", glow: "#ff2d55" },
  { name: "ปีกผีเสื้อแสงจันทร์", price: 2500, power: 1.1, style: "butterfly", color: "#7ff3ff", glow: "#c792ff" },
  { name: "ปีกฟีนิกซ์เพลิง", price: 5000, power: 1.15, style: "flame", color: "#ff7b00", glow: "#ffd60a" },
  { name: "ปีกมังกรมรกต", price: 9000, power: 1.2, style: "dragon", color: "#1f8a5a", glow: "#7dffb2" },
  { name: "ปีกเทพจักรวาล", price: 20000, power: 1.3, style: "cosmic", color: "#1a1040", glow: "#b388ff" },
];

export interface Mount {
  name: string;
  price: number;
  /** Multiplier on walking speed while riding. */
  speed: number;
  /** Model in assets/3d/mounts, its height in world units, and where the rider sits (share of that height). */
  model: string;
  height: number;
  seat: number;
  /** Flies a little above the ground instead of walking. */
  flies?: boolean;
}

export const MOUNTS: readonly Mount[] = [
  { name: "ไม่มีสัตว์ขี่", price: 0, speed: 1, model: "", height: 0, seat: 0 },
  { name: "ม้าน้ำตาล", price: 300, speed: 1.35, model: "Horse", height: 2.3, seat: 0.62 },
  { name: "กวางเขางาม", price: 700, speed: 1.45, model: "Stag", height: 2.8, seat: 0.5 },
  { name: "หมาป่าเงา", price: 1200, speed: 1.5, model: "Wolf", height: 1.9, seat: 0.62 },
  { name: "ม้าขาวสวรรค์", price: 2500, speed: 1.6, model: "WhiteHorse", height: 2.4, seat: 0.62 },
  { name: "แร็พเตอร์ดุ", price: 4500, speed: 1.7, model: "Raptor", height: 2.1, seat: 0.55 },
  { name: "มังกรราชันย์", price: 10000, speed: 1.85, model: "Dragon", height: 3, seat: 0.45, flies: true },
];

export type CosmeticKind = "wing" | "mount";

export function isCosmeticKind(value: unknown): value is CosmeticKind {
  return value === "wing" || value === "mount";
}

export function cosmeticList(kind: CosmeticKind): readonly { name: string; price: number }[] {
  return kind === "wing" ? WINGS : MOUNTS;
}

/** What a player owns and wears, as the server tells them. */
export interface Wardrobe {
  wings: number[];
  mounts: number[];
}
