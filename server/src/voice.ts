// Team voice chat: the sound goes straight between the players' browsers (WebRTC); the server only
// passes on the messages that let two browsers find each other, and only between teammates.
//
// Browsers know each other by a voice tag, never by player id: a player id opens that player's
// progress, so it is not handed to anyone else.

import { randomUUID } from "node:crypto";

const tags = new Map<string, string>();
const owners = new Map<string, string>();
/** Players with their microphone on. */
const talking = new Set<string>();

export function tagOf(playerId: string) {
  let tag = tags.get(playerId);
  if (!tag) {
    tag = randomUUID();
    tags.set(playerId, tag);
    owners.set(tag, playerId);
  }
  return tag;
}

export function playerOf(tag: unknown) {
  return typeof tag === "string" ? owners.get(tag) : undefined;
}

export function setTalking(playerId: string, on: boolean) {
  if (on) {
    talking.add(playerId);
  } else {
    talking.delete(playerId);
  }
}

export function isTalking(playerId: string) {
  return talking.has(playerId);
}

/** A connection offer, answer or route is a few kilobytes at most. */
export const MAX_SIGNAL_LENGTH = 16_000;
