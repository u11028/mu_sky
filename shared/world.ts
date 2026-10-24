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

export const PLAYER_COLORS = [0xe76f51, 0x2a9d8f, 0xe9c46a, 0x8ab17d, 0x9b5de5, 0xf15bb5, 0x00bbf9, 0xfb8500];

export interface ChatMessage {
  from: string;
  text: string;
  /** True for join/leave notices sent by the server. */
  system?: boolean;
  /** Session of the player who wrote it, to show the speech bubble over them. */
  senderId?: string;
}
