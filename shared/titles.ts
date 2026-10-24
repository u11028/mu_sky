// Titles (ฉายา) shown above a player's name, earned from lifetime progress.
// Each one also dresses the player's speech bubble and chat line in its colours.

/** Lifetime counters a title can ask for. */
export type LifeStat = "chats" | "steps" | "travels" | "regions" | "met" | "days";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface TitleStyle {
  /** Text colour of the title; legendary titles shift through the rainbow instead. */
  color: string;
  /** Soft light around the title. */
  glow: string;
  bubbleFill: string;
  bubbleBorder: string;
  bubbleText: string;
}

export interface Title {
  id: string;
  name: string;
  rarity: Rarity;
  /** How to earn it, shown while it is locked. */
  hint: string;
  /** The counter and the value it must reach; no stat = everyone has it. */
  stat?: LifeStat;
  goal: number;
  style: TitleStyle;
}

export const TITLES: readonly Title[] = [
  {
    id: "rookie",
    name: "มือใหม่ไฟแรง",
    rarity: "common",
    hint: "ได้ทันทีที่เข้าเกม",
    goal: 0,
    style: { color: "#e8eef2", glow: "#8fb3c9", bubbleFill: "#ffffff", bubbleBorder: "#9fb6c4", bubbleText: "#1b1b1b" },
  },
  {
    id: "talker",
    name: "ปากหวานประจำเมือง",
    rarity: "rare",
    hint: "คุยในแชท 30 ข้อความ",
    stat: "chats",
    goal: 30,
    style: { color: "#ff9fd0", glow: "#ff3d9a", bubbleFill: "#fff0f7", bubbleBorder: "#ff6fb3", bubbleText: "#5a1036" },
  },
  {
    id: "walker",
    name: "ขาลุยไร้พ่าย",
    rarity: "rare",
    hint: "เดินรวม 5,000 ก้าว",
    stat: "steps",
    goal: 5000,
    style: { color: "#ffbe70", glow: "#ff7a00", bubbleFill: "#fff5e8", bubbleBorder: "#ff9a3c", bubbleText: "#4a2600" },
  },
  {
    id: "traveler",
    name: "นักเดินทางพเนจร",
    rarity: "rare",
    hint: "ไปเยือน 3 ภาค",
    stat: "regions",
    goal: 3,
    style: { color: "#a6ff94", glow: "#2ecc40", bubbleFill: "#f0ffec", bubbleBorder: "#5fd35a", bubbleText: "#123d10" },
  },
  {
    id: "friend",
    name: "มิตรแท้แห่งแดนฟ้า",
    rarity: "rare",
    hint: "พบผู้เล่นคนอื่น 5 คน",
    stat: "met",
    goal: 5,
    style: { color: "#8ff5ff", glow: "#00c8ff", bubbleFill: "#ecfcff", bubbleBorder: "#38d3f5", bubbleText: "#063845" },
  },
  {
    id: "diligent",
    name: "ขยันเป็นนิสัย",
    rarity: "rare",
    hint: "ทำภารกิจประจำวันครบ 1 วัน",
    stat: "days",
    goal: 1,
    style: { color: "#9fc2ff", glow: "#3d7bff", bubbleFill: "#eef4ff", bubbleBorder: "#5b8cff", bubbleText: "#0d2556" },
  },
  {
    id: "conqueror",
    name: "ผู้พิชิตสยาม",
    rarity: "epic",
    hint: "ไปเยือนครบทั้ง 6 ภาค",
    stat: "regions",
    goal: 6,
    style: { color: "#ffe066", glow: "#ffb800", bubbleFill: "#2a2108", bubbleBorder: "#ffd23f", bubbleText: "#ffeeb8" },
  },
  {
    id: "legend",
    name: "ตำนานแห่งฟ้า",
    rarity: "legendary",
    hint: "ทำภารกิจประจำวันครบ 7 วัน",
    stat: "days",
    goal: 7,
    style: { color: "#ffffff", glow: "#b46bff", bubbleFill: "#1c1030", bubbleBorder: "#c792ff", bubbleText: "#f3e6ff" },
  },
];

export function findTitle(id: unknown) {
  return TITLES.find((title) => title.id === id);
}

/** The marks around a title's name, grander for rarer titles. */
export function decorateTitle(title: Title) {
  switch (title.rarity) {
    case "legendary":
      return `♛ ${title.name} ♛`;
    case "epic":
      return `★ ${title.name} ★`;
    case "rare":
      return `◆ ${title.name} ◆`;
    default:
      return `「${title.name}」`;
  }
}
