// Teams (ปาร์ตี้) of up to four players: shared experience and gold, no harm to each other.
// Kept by player id, so a team holds together across regions and rooms; not saved across restarts.

import { randomBytes } from "node:crypto";

export const TEAM_SIZE = 4;
/** How long an invitation stays open. */
const INVITE_MS = 60_000;
/** How long someone who closed the game keeps their place, so a reload doesn't drop them. */
const RETURN_MS = 90_000;

const members = new Map<string, string[]>();
const teamOf = new Map<string, string>();
/** Invitations by the invited player's id. */
const invites = new Map<string, { from: string; at: number }>();
const leaving = new Map<string, ReturnType<typeof setTimeout>>();

export function teamIdOf(playerId: string) {
  return teamOf.get(playerId) ?? "";
}

export function teamMembers(teamId: string) {
  return members.get(teamId) ?? [];
}

export function invite(from: string, to: string): string | undefined {
  if (from === to) {
    return "ชวนตัวเองไม่ได้";
  }
  const team = teamIdOf(from);
  if (team && teamMembers(team).length >= TEAM_SIZE) {
    return `ทีมเต็มแล้ว (${TEAM_SIZE} คน)`;
  }
  if (team && teamIdOf(to) === team) {
    return "อยู่ทีมเดียวกันแล้ว";
  }
  invites.set(to, { from, at: Date.now() });
  return undefined;
}

/**
 * The invited player says yes: they join the inviter's team, which is made if it didn't exist.
 * Returns the team and who is left in the one they quit for it, or why not.
 */
export function accept(to: string): { team: string; left: string[] } | { error: string } {
  const offer = invites.get(to);
  invites.delete(to);
  if (!offer || Date.now() - offer.at > INVITE_MS) {
    return { error: "คำชวนหมดเวลาแล้ว" };
  }
  let team = teamIdOf(offer.from);
  if (!team) {
    team = randomBytes(6).toString("hex");
    members.set(team, [offer.from]);
    teamOf.set(offer.from, team);
  }
  const list = teamMembers(team);
  if (list.length >= TEAM_SIZE) {
    return { error: "ทีมเต็มแล้ว" };
  }
  const left = leave(to);
  list.push(to);
  teamOf.set(to, team);
  return { team, left };
}

export function decline(to: string) {
  const offer = invites.get(to);
  invites.delete(to);
  return offer?.from;
}

/** Leaves the team; a team of one is no team. Returns who is still in it. */
export function leave(playerId: string) {
  const team = teamIdOf(playerId);
  if (!team) {
    return [];
  }
  teamOf.delete(playerId);
  const rest = teamMembers(team).filter((id) => id !== playerId);
  if (rest.length <= 1) {
    members.delete(team);
    rest.forEach((id) => teamOf.delete(id));
    return rest;
  }
  members.set(team, rest);
  return rest;
}

/** The game closed (not a trip between regions): drop them from the team unless they're back soon. */
export function goneFor(playerId: string, isBack: () => boolean, onDropped: (left: string[]) => void) {
  clearTimeout(leaving.get(playerId));
  leaving.set(
    playerId,
    setTimeout(() => {
      leaving.delete(playerId);
      if (!isBack()) {
        onDropped(leave(playerId));
      }
    }, RETURN_MS),
  );
}
