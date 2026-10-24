// Values both the server and the client must agree on.

export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 1200;

/** Walking speed in pixels per second. */
export const PLAYER_SPEED = 220;

export const NAME_MAX_LENGTH = 16;
export const CHAT_MAX_LENGTH = 120;

/** Minimum time between two chat messages of one player. */
export const CHAT_COOLDOWN_MS = 700;

/** How many recent chat messages a player gets when joining. */
export const CHAT_HISTORY_SIZE = 30;

export const ROOM_NAME = "world";
export const SERVER_PORT = 2567;

export { SKINS } from "./skins.ts";

export interface ChatMessage {
  from: string;
  text: string;
  /** True for join/leave notices sent by the server. */
  system?: boolean;
  /** Session of the player who wrote it, to show the speech bubble over them. */
  senderId?: string;
}
