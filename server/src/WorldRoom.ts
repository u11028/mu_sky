import colyseus, { type Client } from "colyseus";
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_SIZE,
  CHAT_MAX_LENGTH,
  type ChatMessage,
  NAME_MAX_LENGTH,
  PLAYER_SPEED,
  SKINS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../../shared/world.ts";
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
}

const EDGE = 16;

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

export class WorldRoom extends Room<WorldState> {
  maxClients = 50;

  private movements = new Map<string, Movement>();
  private chatHistory: ChatMessage[] = [];

  onCreate() {
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

      movement.target = { x: clamp(x, EDGE, WORLD_WIDTH - EDGE), y: clamp(y, EDGE, WORLD_HEIGHT - EDGE) };
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
      this.sendChat({ from: player.name, text }, client.sessionId);
    });

    this.setSimulationInterval((deltaMs) => this.update(deltaMs), 50);
  }

  onJoin(client: Client, options: { name?: unknown; skin?: unknown }) {
    const player = new Player();
    player.name = cleanText(options?.name, NAME_MAX_LENGTH) || `ผู้เล่น${Math.floor(1000 + Math.random() * 9000)}`;
    player.x = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 200;
    player.y = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 200;
    const skin = Number(options?.skin);
    player.skin = Number.isInteger(skin) && skin >= 0 && skin < SKINS.length ? skin : 0;

    this.state.players.set(client.sessionId, player);
    this.movements.set(client.sessionId, { dirX: 0, dirY: 0, lastChatAt: 0 });

    client.send("chat-history", this.chatHistory);
    this.sendChat({ from: "ระบบ", text: `${player.name} เข้ามาในโลกแล้ว`, system: true });
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.movements.delete(client.sessionId);
    if (player) {
      this.sendChat({ from: "ระบบ", text: `${player.name} ออกจากโลกแล้ว`, system: true });
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

    this.movements.forEach((movement, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player) {
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

      if (dx !== 0 || dy !== 0) {
        player.x = clamp(player.x + dx, EDGE, WORLD_WIDTH - EDGE);
        player.y = clamp(player.y + dy, EDGE, WORLD_HEIGHT - EDGE);
      }
    });
  }
}
