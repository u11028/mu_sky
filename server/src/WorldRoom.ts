import colyseus, { type Client } from "colyseus";
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_SIZE,
  CHAT_MAX_LENGTH,
  type ChatMessage,
  NAME_MAX_LENGTH,
  PLAYER_SPEED,
  SKINS,
} from "../../shared/world.ts";
import {
  isRegionId,
  PORTAL_RADIUS,
  REGIONS,
  type Region,
  type RegionId,
  spawnPoint,
  START_REGION,
} from "../../shared/regions.ts";
import { type Achievement, regionOfTheDay, STEP_PX, thaiDay } from "../../shared/quests.ts";
import { findTitle } from "../../shared/titles.ts";
import * as progress from "./progress.ts";
import { Player, WorldState } from "./schema.ts";

// colyseus 0.15 is CommonJS: Node's ESM loader only sees its default export.
const { Room } = colyseus;

interface Movement {
  /** Keyboard direction; wins over the target while not zero. */
  dirX: number;
  dirY: number;
  /** Tapped or clicked destination. */
  target?: { x: number; y: number };
  lastChatAt: number;
  /** Set once the player stepped on a portal; they are leaving this room. */
  travelling?: boolean;
  /** Who the player is across rooms and visits, for their quests and titles. */
  playerId: string;
  /** Pixels walked and not yet counted as steps. */
  walkedPx: number;
}

interface JoinOptions {
  name?: unknown;
  skin?: unknown;
  /** The region the player comes from, to appear next to the portal back there. */
  from?: unknown;
  /** Random id the browser keeps, so progress follows the player. */
  playerId?: unknown;
}

/** Long and random enough that nobody guesses another player's id. */
const PLAYER_ID = /^[A-Za-z0-9_-]{16,64}$/;
/** Walked steps are counted towards quests once a second, not on every tick. */
const STEP_FLUSH_TICKS = 20;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  // Control characters would break the chat layout.
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

/** One room per region; the matchmaker keeps them apart with filterBy(["region"]). */
export class WorldRoom extends Room<WorldState> {
  maxClients = 50;

  private regionId: RegionId = START_REGION;
  private region: Region = REGIONS[START_REGION];
  private movements = new Map<string, Movement>();
  private chatHistory: ChatMessage[] = [];
  private ticks = 0;

  onCreate(options: { region?: unknown }) {
    this.regionId = isRegionId(options?.region) ? options.region : START_REGION;
    this.region = REGIONS[this.regionId];
    this.setState(new WorldState());

    this.onMessage("dir", (client, message: { x?: unknown; y?: unknown }) => {
      const movement = this.movements.get(client.sessionId);
      if (!movement) {
        return;
      }

      movement.dirX = Math.sign(Number(message?.x) || 0);
      movement.dirY = Math.sign(Number(message?.y) || 0);
      if (movement.dirX !== 0 || movement.dirY !== 0) {
        movement.target = undefined;
      }
    });

    this.onMessage("target", (client, message: { x?: unknown; y?: unknown }) => {
      const movement = this.movements.get(client.sessionId);
      const x = Number(message?.x);
      const y = Number(message?.y);
      if (!movement || !Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }

      const { bounds } = this.region;
      movement.target = { x: clamp(x, bounds.minX, bounds.maxX), y: clamp(y, bounds.minY, bounds.maxY) };
    });

    this.onMessage("chat", (client, message: { text?: unknown }) => {
      const movement = this.movements.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      const text = cleanText(message?.text, CHAT_MAX_LENGTH);
      const now = Date.now();
      if (!movement || !player || text === "" || now - movement.lastChatAt < CHAT_COOLDOWN_MS) {
        return;
      }

      movement.lastChatAt = now;
      this.sendChat({ from: player.name, text, title: player.title || undefined }, client.sessionId);
      this.celebrate(movement.playerId, progress.recordChat(movement.playerId));
    });

    this.onMessage("equip-title", (client, message: { id?: unknown }) => {
      const movement = this.movements.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      const id = typeof message?.id === "string" ? message.id : "";
      if (!movement || !player || !progress.equip(movement.playerId, id)) {
        return;
      }

      player.title = id;
      client.send("progress", progress.view(movement.playerId));
    });

    this.setSimulationInterval((deltaMs) => this.update(deltaMs), 50);
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new Player();
    player.name = cleanText(options?.name, NAME_MAX_LENGTH) || `ผู้เล่น${Math.floor(1000 + Math.random() * 9000)}`;
    const skin = Number(options?.skin);
    player.skin = Number.isInteger(skin) && skin >= 0 && skin < SKINS.length ? skin : 0;

    // A little spread, so a group arriving together doesn't stand on one spot.
    const spawn = spawnPoint(this.regionId, isRegionId(options?.from) ? options.from : undefined);
    player.x = spawn.x + (Math.random() - 0.5) * 60;
    player.y = spawn.y + (Math.random() - 0.5) * 60;

    // Without a valid id the progress still counts, but only for this visit.
    const playerId =
      typeof options?.playerId === "string" && PLAYER_ID.test(options.playerId)
        ? options.playerId
        : `guest-${client.sessionId}`;
    player.title = progress.equippedTitle(playerId);

    this.state.players.set(client.sessionId, player);
    this.movements.set(client.sessionId, { dirX: 0, dirY: 0, lastChatAt: 0, playerId, walkedPx: 0 });

    client.send("chat-history", this.chatHistory);
    client.send("progress", progress.view(playerId));
    this.sendChat({ from: "ระบบ", text: `${player.name} มาถึง${this.region.name}แล้ว`, system: true });

    const travelled = isRegionId(options?.from);
    this.celebrate(playerId, progress.recordVisit(playerId, this.regionId, travelled, regionOfTheDay(thaiDay())));

    // Everyone already here meets the newcomer, and the newcomer meets them.
    this.movements.forEach((other) => {
      if (other.playerId !== playerId) {
        this.celebrate(playerId, progress.recordMeeting(playerId, other.playerId));
        this.celebrate(other.playerId, progress.recordMeeting(other.playerId, playerId));
      }
    });
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const movement = this.movements.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.movements.delete(client.sessionId);
    if (player) {
      const text = movement?.travelling ? `${player.name} เดินทางต่อไปแล้ว` : `${player.name} ออกจากเกมแล้ว`;
      this.sendChat({ from: "ระบบ", text, system: true });
    }
  }

  /** Tells a player what they just achieved and sends their updated progress. */
  private celebrate(playerId: string, achievements: Achievement[]) {
    const entry = [...this.movements].find(([, movement]) => movement.playerId === playerId);
    const client = entry && this.clients.find((c) => c.sessionId === entry[0]);
    if (!client) {
      return;
    }

    client.send("progress", progress.view(playerId));
    for (const achievement of achievements) {
      client.send("achievement", achievement);
      const title = achievement.titleId && findTitle(achievement.titleId);
      if (title) {
        // A new title is news for everyone around.
        const name = this.state.players.get(client.sessionId)?.name;
        this.sendChat({ from: "ระบบ", text: `${name} ได้รับฉายา「${title.name}」แล้ว!`, system: true });
      }
    }
  }

  private sendChat(message: ChatMessage, senderId?: string) {
    this.chatHistory.push(message);
    if (this.chatHistory.length > CHAT_HISTORY_SIZE) {
      this.chatHistory.shift();
    }

    this.broadcast("chat", { ...message, senderId });
  }

  private update(deltaMs: number) {
    const step = (PLAYER_SPEED * deltaMs) / 1000;
    const { bounds, portals } = this.region;
    const flushSteps = ++this.ticks % STEP_FLUSH_TICKS === 0;

    this.movements.forEach((movement, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player || movement.travelling) {
        return;
      }

      let dx = 0;
      let dy = 0;
      if (movement.dirX !== 0 || movement.dirY !== 0) {
        const length = Math.hypot(movement.dirX, movement.dirY);
        dx = (movement.dirX / length) * step;
        dy = (movement.dirY / length) * step;
      } else if (movement.target) {
        const toX = movement.target.x - player.x;
        const toY = movement.target.y - player.y;
        const distance = Math.hypot(toX, toY);
        if (distance <= step) {
          dx = toX;
          dy = toY;
          movement.target = undefined;
        } else {
          dx = (toX / distance) * step;
          dy = (toY / distance) * step;
        }
      }

      if (flushSteps && movement.walkedPx >= STEP_PX) {
        const steps = Math.floor(movement.walkedPx / STEP_PX);
        movement.walkedPx -= steps * STEP_PX;
        this.celebrate(movement.playerId, progress.recordSteps(movement.playerId, steps));
      }

      if (dx === 0 && dy === 0) {
        return;
      }

      const x = clamp(player.x + dx, bounds.minX, bounds.maxX);
      const y = clamp(player.y + dy, bounds.minY, bounds.maxY);
      // Only real distance counts; pushing against the shore doesn't.
      movement.walkedPx += Math.hypot(x - player.x, y - player.y);
      player.x = x;
      player.y = y;

      const portal = portals.find((p) => Math.hypot(p.x - player.x, p.y - player.y) < PORTAL_RADIUS);
      if (portal) {
        movement.travelling = true;
        this.clients.find((c) => c.sessionId === sessionId)?.send("travel", { to: portal.to, from: this.regionId });
      }
    });
  }
}
