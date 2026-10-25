// What a GM (game master) can do, and what the GM panel is shown.

export type GmAction =
  | { action: "list" }
  | { action: "kill"; target: string }
  | { action: "heal"; target: string }
  | { action: "god"; target: string; on: boolean }
  | { action: "onehit"; target: string; on: boolean }
  | { action: "level"; target: string; amount: number }
  | { action: "gold"; target: string; amount: number }
  | { action: "potions"; target: string; amount: number }
  | { action: "cosmetics"; target: string }
  | { action: "title"; target: string; titleId: string }
  | { action: "goto"; target: string }
  | { action: "summon"; target: string }
  | { action: "kick"; target: string }
  | { action: "ban"; target: string; days: number; reason: string }
  | { action: "unban"; playerId: string }
  | { action: "announce"; text: string };

/** One player online, as the GM panel lists them. `id` is their session, the target of actions. */
export interface GmPlayer {
  id: string;
  name: string;
  region: string;
  level: number;
  hp: number;
  maxHp: number;
  gm: boolean;
  god: boolean;
  oneHit: boolean;
}

export interface GmBan {
  playerId: string;
  name: string;
  /** Unix time in ms; banned for good when very far away. */
  until: number;
  reason: string;
}

export interface GmList {
  players: GmPlayer[];
  bans: GmBan[];
}

/** Ban lengths the panel offers; 0 means for good. */
export const BAN_DAYS = [1, 3, 7, 30, 0] as const;
/** "For good" is stored as this many days. */
export const PERMANENT_BAN_DAYS = 36500;
