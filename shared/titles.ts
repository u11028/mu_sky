// Titles (ฉายา) shown above a player's name, earned from lifetime progress.
// Each one also dresses the player's speech bubble and chat line in its colours.

/** Lifetime counters a title can ask for. */
export type LifeStat =
  | "chats"
  | "steps"
  | "travels"
  | "regions"
  | "met"
  | "days"
  /** Seconds spent standing still. */
  | "idle"
  /** Seconds spent walking into the sea and getting nowhere. */
  | "shore"
  /** Chat messages with "555" in them. */
  | "laughs"
  /** Chat messages sent between midnight and 5 a.m. Thai time. */
  | "nightChats"
  /** Different looks worn. */
  | "skins"
  /** Other players defeated. */
  | "kills"
  /** Times defeated. */
  | "deaths"
  /** Monsters and bosses defeated. */
  | "monsters"
  | "bosses"
  /** Other titles earned. */
  | "titles";

/** "mythic" is for the strangest, hardest titles: they flicker and glitch. */
export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

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
  /** Only a GM can give it. */
  grantOnly?: boolean;
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

  // The odd ones: strange things to do, and a lot of them.
  {
    id: "tree",
    name: "ร่างทรงต้นไม้",
    rarity: "epic",
    hint: "ยืนนิ่งๆ ไม่ขยับรวม 2 ชั่วโมง (นับเป็นวินาที)",
    stat: "idle",
    goal: 7200,
    style: { color: "#b9e86f", glow: "#4f8a1b", bubbleFill: "#22320f", bubbleBorder: "#8fcf3c", bubbleText: "#e4f7c4" },
  },
  {
    id: "swimmer",
    name: "นักว่ายน้ำที่ว่ายไม่เป็น",
    rarity: "epic",
    hint: "เดินดันทะเลอยู่ที่ชายหาดรวม 10 นาที (นับเป็นวินาที)",
    stat: "shore",
    goal: 600,
    style: { color: "#7fd8ff", glow: "#0077ff", bubbleFill: "#0a2240", bubbleBorder: "#4fb8ff", bubbleText: "#d6f0ff" },
  },
  {
    id: "laugher",
    name: "555 จนลมจับ",
    rarity: "epic",
    hint: "พิมพ์แชทที่มี 555 อยู่ด้วย 100 ข้อความ",
    stat: "laughs",
    goal: 100,
    style: { color: "#fff27a", glow: "#ff9f1c", bubbleFill: "#3a2a00", bubbleBorder: "#ffd60a", bubbleText: "#fff7c2" },
  },
  {
    id: "owl",
    name: "นกฮูกไม่หลับไม่นอน",
    rarity: "epic",
    hint: "คุยในแชทช่วงเที่ยงคืนถึงตีห้า 50 ข้อความ",
    stat: "nightChats",
    goal: 50,
    style: { color: "#c9b8ff", glow: "#5a3dff", bubbleFill: "#120c2e", bubbleBorder: "#8f7bff", bubbleText: "#e6deff" },
  },
  {
    id: "warper",
    name: "หัวร้อนกดวาร์ปรัวๆ",
    rarity: "epic",
    hint: "เดินผ่านประตูวาร์ป 200 ครั้ง",
    stat: "travels",
    goal: 200,
    style: { color: "#ff9a7a", glow: "#ff3b1f", bubbleFill: "#3a0f06", bubbleBorder: "#ff6a3d", bubbleText: "#ffe0d6" },
  },
  {
    id: "faces",
    name: "พันหน้าพันตา",
    rarity: "epic",
    hint: "เข้าเกมด้วยตัวละครครบทั้ง 10 แบบ",
    stat: "skins",
    goal: 10,
    style: { color: "#ffb0f5", glow: "#d23cff", bubbleFill: "#2e0a33", bubbleBorder: "#e07bff", bubbleText: "#fbe0ff" },
  },
  {
    id: "firefeet",
    name: "เท้าไฟ ส้นเท้าไหม้",
    rarity: "legendary",
    hint: "เดินรวม 100,000 ก้าว",
    stat: "steps",
    goal: 100000,
    style: { color: "#ffffff", glow: "#ff5e00", bubbleFill: "#2b0d00", bubbleBorder: "#ff8a3d", bubbleText: "#ffe3cc" },
  },
  {
    id: "chatterbox",
    name: "ปากไม่มีหูรูด",
    rarity: "legendary",
    hint: "คุยในแชทรวม 1,000 ข้อความ",
    stat: "chats",
    goal: 1000,
    style: { color: "#ffffff", glow: "#ff3d9a", bubbleFill: "#2e0718", bubbleBorder: "#ff7ac0", bubbleText: "#ffe0f0" },
  },
  {
    id: "celebrity",
    name: "คนดังประจำหมู่บ้าน",
    rarity: "legendary",
    hint: "พบผู้เล่นคนอื่น 50 คน",
    stat: "met",
    goal: 50,
    style: { color: "#ffffff", glow: "#ffd23f", bubbleFill: "#2a2108", bubbleBorder: "#ffe066", bubbleText: "#fff4c7" },
  },
  {
    id: "bloody",
    name: "มือเปื้อนเลือด",
    rarity: "epic",
    hint: "ล้มผู้เล่นคนอื่น 10 ครั้ง",
    stat: "kills",
    goal: 10,
    style: { color: "#ff6b6b", glow: "#c1121f", bubbleFill: "#2b0606", bubbleBorder: "#e5383b", bubbleText: "#ffd6d6" },
  },
  {
    id: "reaper",
    name: "ยมทูตประจำสยาม",
    rarity: "legendary",
    hint: "ล้มผู้เล่นคนอื่น 100 ครั้ง",
    stat: "kills",
    goal: 100,
    style: { color: "#ffffff", glow: "#7b2cbf", bubbleFill: "#10001f", bubbleBorder: "#9d4edd", bubbleText: "#ead6ff" },
  },
  {
    id: "hunter",
    name: "นักล่ามือใหม่",
    rarity: "rare",
    hint: "ล้มมอนสเตอร์ 50 ตัว",
    stat: "monsters",
    goal: 50,
    style: { color: "#c7f464", glow: "#4caf50", bubbleFill: "#f4ffe6", bubbleBorder: "#7cc242", bubbleText: "#1f3d0c" },
  },
  {
    id: "bossbane",
    name: "ผู้โค่นบัลลังก์บอส",
    rarity: "epic",
    hint: "ปราบบอส 6 ครั้ง",
    stat: "bosses",
    goal: 6,
    style: { color: "#ffb703", glow: "#fb8500", bubbleFill: "#2b1600", bubbleBorder: "#ffb703", bubbleText: "#ffe8c2" },
  },
  {
    id: "slayer",
    name: "จอมปราบอสูรแห่งสยาม",
    rarity: "legendary",
    hint: "ล้มมอนสเตอร์ 1,000 ตัว",
    stat: "monsters",
    goal: 1000,
    style: { color: "#ffffff", glow: "#2a9d8f", bubbleFill: "#04201d", bubbleBorder: "#3ddbc8", bubbleText: "#d8fff9" },
  },
  {
    id: "regular",
    name: "ตายบ่อยจนยมบาลจำหน้าได้",
    rarity: "epic",
    hint: "ถูกล้ม 50 ครั้ง",
    stat: "deaths",
    goal: 50,
    style: { color: "#d0d0d0", glow: "#6c757d", bubbleFill: "#1e1e1e", bubbleBorder: "#adb5bd", bubbleText: "#f1f1f1" },
  },
  {
    id: "tireless",
    name: "ผู้ไม่เคยหยุดพัก",
    rarity: "mythic",
    hint: "ทำภารกิจประจำวันครบ 30 วัน",
    stat: "days",
    goal: 30,
    style: { color: "#ff4d6d", glow: "#00f5d4", bubbleFill: "#0b0b12", bubbleBorder: "#ff4d6d", bubbleText: "#f1f1ff" },
  },
  {
    id: "weirdking",
    name: "ราชาแห่งความเพี้ยน",
    rarity: "mythic",
    hint: "สะสมฉายาอื่นให้ได้ 15 ฉายา",
    stat: "titles",
    goal: 15,
    style: { color: "#f15bb5", glow: "#00bbf9", bubbleFill: "#140021", bubbleBorder: "#fee440", bubbleText: "#fff6d6" },
  },
  {
    id: "skykeeper",
    name: "ผู้คุมกฎแห่งฟ้า",
    rarity: "mythic",
    hint: "มอบโดย GM เท่านั้น",
    goal: 1,
    grantOnly: true,
    style: { color: "#ffd60a", glow: "#ff0054", bubbleFill: "#1a0008", bubbleBorder: "#ffd60a", bubbleText: "#fff3c4" },
  },
];

export function findTitle(id: unknown) {
  return TITLES.find((title) => title.id === id);
}

/** The marks around a title's name, grander for rarer titles. */
export function decorateTitle(title: Title) {
  switch (title.rarity) {
    case "mythic":
      return `⚡ ${title.name} ⚡`;
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
