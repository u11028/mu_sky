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

export { HEROES } from "./heroes.ts";

export interface ChatMessage {
  from: string;
  text: string;
  /** True for join/leave notices sent by the server. */
  system?: boolean;
  /** Session of the player who wrote it, to show the speech bubble over them. */
  senderId?: string;
  /** Title the writer wore, to colour their chat line. */
  title?: string;
}

/** Private rooms are found by a code like "K7Q2MX"; letters and digits that are hard to confuse. */
export const PARTY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PARTY_CODE_LENGTH = 6;
/** How many fit in a private room. */
export const PARTY_MAX_PLAYERS = 20;

/** The code in its standard form, or "" for the shared public world. */
export function cleanPartyCode(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const code = value.trim().toUpperCase();
  return code.length === PARTY_CODE_LENGTH && [...code].every((c) => PARTY_ALPHABET.includes(c)) ? code : "";
}

/**
 * How long a player whose connection dropped (a phone switching networks, a locked screen) is kept
 * in the world, unhurt, for the game to reconnect them where they were.
 */
export const RECONNECT_SECONDS = 45;
