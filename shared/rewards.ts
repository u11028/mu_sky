// Coming back: a gift for each day in a row the player logs in, bigger towards the seventh,
// and the leaderboards everyone can see.

export interface DailyGift {
  gold: number;
  potions: number;
  /** A piece of gear from the drop table: a boss's (rare or better) or the world boss's (epic or better). */
  gear?: "boss" | "world-boss";
  /** What the card shows. */
  icon: string;
  text: string;
}

/** Day 1 to 7 of a streak; after the seventh it starts over. Missing a day starts over too. */
export const DAILY_GIFTS: readonly DailyGift[] = [
  { gold: 100, potions: 0, icon: "💰", text: "100 ทอง" },
  { gold: 0, potions: 3, icon: "🧪", text: "ยาเลือด 3 ขวด" },
  { gold: 300, potions: 0, icon: "💰", text: "300 ทอง" },
  { gold: 200, potions: 5, icon: "🧪", text: "ยา 5 + 200 ทอง" },
  { gold: 0, potions: 0, gear: "boss", icon: "🎁", text: "ของหายาก+" },
  { gold: 800, potions: 0, icon: "💎", text: "800 ทอง" },
  { gold: 1500, potions: 5, gear: "world-boss", icon: "👑", text: "ของล้ำค่า+ และ 1,500 ทอง" },
];

/** Sent when the day's gift is given: which day of the streak it is (1 to 7). */
export interface DailyGiftEvent {
  day: number;
  /** The gear's name, when the gift had one. */
  gearName?: string;
}

export type BoardId = "level" | "gold" | "monsters" | "worldBosses";

export const BOARDS: readonly { id: BoardId; name: string; unit: string }[] = [
  { id: "level", name: "เลเวล", unit: "" },
  { id: "gold", name: "เศรษฐี", unit: "ทอง" },
  { id: "monsters", name: "นักล่า", unit: "ตัว" },
  { id: "worldBosses", name: "บอสโลก", unit: "ครั้ง" },
];

export interface BoardEntry {
  name: string;
  skin: number;
  value: number;
  /** The title worn, by id; "" for none. */
  title: string;
}

export type Leaderboards = Record<BoardId, BoardEntry[]>;

export const BOARD_SIZE = 10;
