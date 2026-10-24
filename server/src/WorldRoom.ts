import type { IncomingMessage } from "node:http";
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
import {
  isRegionId,
  PORTAL_RADIUS,
  REGIONS,
  type Region,
  type RegionId,
  spawnPoint,
  START_REGION,
} from "../../shared/regions.ts";
import {
  ATTACK_COOLDOWN_MS,
  ATTACK_RANGE,
  attackPower,
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  type HitEvent,
  killXp,
  maxHp,
  REGEN_DELAY_MS,
  REGEN_PER_SECOND,
  RESPAWN_MS,
  SPAWN_SHIELD_MS,
} from "../../shared/combat.ts";
import { type GmAction, type GmList, PERMANENT_BAN_DAYS } from "../../shared/gm.ts";
import { type Achievement, regionOfTheDay, STEP_PX, thaiDay } from "../../shared/quests.ts";
import { findTitle } from "../../shared/titles.ts";
import { isGmKey } from "./gmKey.ts";
import * as progress from "./progress.ts";
import { Player, WorldState } from "./schema.ts";

// colyseus 0.15 is CommonJS: Node's ESM loader only sees its default export.
const { Room, ServerError } = colyseus;

interface Movement {
  /** Keyboard direction; wins over the target while not zero. */
  dirX: number;
  dirY: number;
  /** Tapped or clicked destination. */
  target?: { x: number; y: number };
  /** The way the player last walked, snapped to up, down, left or right: where a swing lands. */
  facingX: number;
  facingY: number;
  lastChatAt: number;
  /** Set once the player stepped on a portal; they are leaving this room. */
  travelling?: boolean;
  /** Who the player is across rooms and visits, for their quests and titles. */
  playerId: string;
  /** Pixels walked and not yet counted as steps. */
  walkedPx: number;
  /** Time not yet counted, standing still and walking into the sea. */
  idleMs: number;
  shoreMs: number;
  lastAttackAt: number;
  lastHitAt: number;
  diedAt: number;
  /** Can't be hurt until then. */
  shieldUntil: number;
  /** Health regained but not yet a whole point. */
  regen: number;
  /** GM power: every hit kills. */
  oneHit: boolean;
  /** Wrong GM keys typed; after a few the player can't try again this visit. */
  gmTries: number;
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
/** Steps and times are counted towards quests once a second, not on every tick. */
const STEP_FLUSH_TICKS = 20;
const MAX_GM_TRIES = 5;

/** Every open region room, so a GM can reach players anywhere. */
const rooms = new Set<WorldRoom>();
/** Where a player sent by a GM appears in the next region, instead of beside the portal. */
const arrivals = new Map<string, { x: number; y: number }>();

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

function validPlayerId(value: unknown) {
  return typeof value === "string" && PLAYER_ID.test(value) ? value : undefined;
}

function banText(ban: { until: number; reason: string }) {
  const forGood = ban.until - Date.now() > 10 * 365 * 24 * 60 * 60 * 1000;
  const until = new Date(ban.until).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  const reason = ban.reason ? ` เหตุผล: ${ban.reason}` : "";
  return forGood ? `คุณถูกแบนถาวร${reason}` : `คุณถูกแบนถึง ${until}${reason}`;
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
    rooms.add(this);

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
      if (text.startsWith("/")) {
        this.runCommand(client, movement, player, text);
        return;
      }
      this.sendChat({ from: player.name, text, title: player.title || undefined }, client.sessionId);
      this.celebrate(movement.playerId, progress.recordChat(movement.playerId, text));
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

    this.onMessage("attack", (client) => this.attack(client.sessionId));
    this.onMessage("gm", (client, message: GmAction) => this.runGmAction(client, message));

    this.setSimulationInterval((deltaMs) => this.update(deltaMs), 50);
  }

  onDispose() {
    rooms.delete(this);
  }

  /** Banned players and anyone from a banned address are turned away before joining. */
  onAuth(_client: Client, options: JoinOptions, request?: IncomingMessage) {
    const ip = request?.socket?.remoteAddress ?? "";
    const ban = progress.activeBan(validPlayerId(options?.playerId) ?? "", ip);
    if (ban) {
      throw new ServerError(403, banText(ban));
    }
    return { ip };
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new Player();
    player.name = cleanText(options?.name, NAME_MAX_LENGTH) || `ผู้เล่น${Math.floor(1000 + Math.random() * 9000)}`;
    const skin = Number(options?.skin);
    player.skin = Number.isInteger(skin) && skin >= 0 && skin < SKINS.length ? skin : 0;

    // Without a valid id the progress still counts, but only for this visit.
    const playerId = validPlayerId(options?.playerId) ?? `guest-${client.sessionId}`;
    player.title = progress.equippedTitle(playerId);
    progress.remember(playerId, player.name, (client.auth as { ip?: string } | undefined)?.ip ?? "");

    // A little spread, so a group arriving together doesn't stand on one spot.
    // A player a GM sent here appears where the GM chose instead.
    const spawn = spawnPoint(this.regionId, isRegionId(options?.from) ? options.from : undefined);
    const arrival = arrivals.get(playerId);
    arrivals.delete(playerId);
    player.x = arrival?.x ?? spawn.x + (Math.random() - 0.5) * 60;
    player.y = arrival?.y ?? spawn.y + (Math.random() - 0.5) * 60;

    const powers = progress.profile(playerId);
    player.gm = powers.gm;
    player.god = powers.god;
    this.applyLevel(player, playerId);
    player.hp = player.maxHp;

    this.state.players.set(client.sessionId, player);
    this.movements.set(client.sessionId, {
      dirX: 0,
      dirY: 0,
      facingX: 0,
      facingY: 1,
      lastChatAt: 0,
      playerId,
      walkedPx: 0,
      idleMs: 0,
      shoreMs: 0,
      lastAttackAt: 0,
      lastHitAt: 0,
      diedAt: 0,
      shieldUntil: Date.now() + SPAWN_SHIELD_MS,
      regen: 0,
      oneHit: powers.oneHit,
      gmTries: 0,
    });

    client.send("chat-history", this.chatHistory);
    client.send("progress", progress.view(playerId));
    this.sendChat({ from: "ระบบ", text: `${player.name} มาถึง${this.region.name}แล้ว`, system: true });

    const travelled = isRegionId(options?.from);
    this.celebrate(
      playerId,
      progress.recordVisit(playerId, this.regionId, travelled, regionOfTheDay(thaiDay()), player.skin),
    );

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

  /** Counts the steps and whole seconds gathered since the last time towards quests and titles. */
  private flushActivity(movement: Movement) {
    const steps = Math.floor(movement.walkedPx / STEP_PX);
    const idle = Math.floor(movement.idleMs / 1000);
    const shore = Math.floor(movement.shoreMs / 1000);
    if (steps === 0 && idle === 0 && shore === 0) {
      return;
    }

    movement.walkedPx -= steps * STEP_PX;
    movement.idleMs -= idle * 1000;
    movement.shoreMs -= shore * 1000;
    this.celebrate(movement.playerId, progress.recordActivity(movement.playerId, { steps, idle, shore }));
  }

  private sendChat(message: ChatMessage, senderId?: string) {
    this.chatHistory.push(message);
    if (this.chatHistory.length > CHAT_HISTORY_SIZE) {
      this.chatHistory.shift();
    }

    this.broadcast("chat", { ...message, senderId });
  }

  /** A system line only one player sees. */
  private tell(client: Client, text: string) {
    client.send("chat", { from: "ระบบ", text, system: true });
  }

  // ---- Combat ----

  /** Level, experience and maximum health from the saved profile. */
  private applyLevel(player: Player, playerId: string) {
    const { level, xp } = progress.profile(playerId);
    player.level = level;
    player.xp = xp;
    player.maxHp = maxHp(level);
    player.hp = Math.min(player.hp, player.maxHp);
  }

  /** A swing in the way the player faces; it hits everyone in reach in front of them. */
  private attack(sessionId: string) {
    const attacker = this.state.players.get(sessionId);
    const movement = this.movements.get(sessionId);
    const now = Date.now();
    if (!attacker || !movement || attacker.dead || movement.travelling) {
      return;
    }
    if (now - movement.lastAttackAt < ATTACK_COOLDOWN_MS) {
      return;
    }

    movement.lastAttackAt = now;
    // Attacking ends the arrival shield.
    movement.shieldUntil = 0;
    this.broadcast("swing", { id: sessionId, x: movement.facingX, y: movement.facingY });

    this.state.players.forEach((target, targetId) => {
      const targetMovement = this.movements.get(targetId);
      if (targetId === sessionId || target.dead || !targetMovement || targetMovement.travelling) {
        return;
      }

      const dx = target.x - attacker.x;
      const dy = target.y - attacker.y;
      const distance = Math.hypot(dx, dy);
      const inFront = distance < 20 || (dx * movement.facingX + dy * movement.facingY) / distance > 0.25;
      if (distance <= ATTACK_RANGE && inFront && now >= targetMovement.shieldUntil) {
        this.hit(sessionId, attacker, movement, targetId, target, targetMovement);
      }
    });
  }

  private hit(
    attackerId: string,
    attacker: Player,
    attackerMovement: Movement,
    targetId: string,
    target: Player,
    targetMovement: Movement,
  ) {
    if (target.god) {
      this.broadcast("hit", { attacker: attackerId, target: targetId, damage: 0, blocked: true } satisfies HitEvent);
      return;
    }

    const crit = Math.random() < CRIT_CHANCE;
    const rolled = attackPower(attacker.level) * (0.85 + Math.random() * 0.3) * (crit ? CRIT_MULTIPLIER : 1);
    const damage = attackerMovement.oneHit ? target.hp : Math.max(1, Math.round(rolled));
    target.hp = Math.max(0, target.hp - damage);
    targetMovement.lastHitAt = Date.now();
    const killed = target.hp === 0;
    this.broadcast("hit", { attacker: attackerId, target: targetId, damage, crit, killed } satisfies HitEvent);

    if (killed) {
      this.defeat(targetId, target, targetMovement, attacker, attackerMovement);
    }
  }

  /** The target falls; the winner, if any, gains experience. A GM's punishment has no winner. */
  private defeat(targetId: string, target: Player, targetMovement: Movement, killer?: Player, killerMovement?: Movement) {
    target.hp = 0;
    target.dead = true;
    targetMovement.diedAt = Date.now();
    targetMovement.target = undefined;
    targetMovement.dirX = 0;
    targetMovement.dirY = 0;
    this.celebrate(targetMovement.playerId, progress.recordDeath(targetMovement.playerId));

    if (!killer || !killerMovement) {
      this.sendChat({ from: "ระบบ", text: `⚡ ${target.name} ถูก GM ลงทัณฑ์!`, system: true });
      return;
    }

    this.sendChat({ from: "ระบบ", text: `⚔ ${killer.name} ล้ม ${target.name} แล้ว!`, system: true });
    const levels = progress.addXp(killerMovement.playerId, killXp(target.level));
    this.levelChanged(killer, killerMovement.playerId, levels);
    this.celebrate(killerMovement.playerId, progress.recordKill(killerMovement.playerId));
  }

  /** Shows a new level: full health, a burst of light and a line in the chat. */
  private levelChanged(player: Player, playerId: string, levels: number) {
    this.applyLevel(player, playerId);
    if (levels > 0) {
      player.hp = player.maxHp;
      const id = [...this.movements].find(([, movement]) => movement.playerId === playerId)?.[0];
      this.broadcast("levelup", { id, level: player.level });
      this.sendChat({ from: "ระบบ", text: `✨ ${player.name} เลเวลอัพเป็น Lv.${player.level}!`, system: true });
    }
  }

  private respawn(player: Player, movement: Movement) {
    const spawn = spawnPoint(this.regionId);
    player.x = spawn.x + (Math.random() - 0.5) * 60;
    player.y = spawn.y + (Math.random() - 0.5) * 60;
    player.hp = player.maxHp;
    player.dead = false;
    movement.shieldUntil = Date.now() + SPAWN_SHIELD_MS;
  }

  // ---- Commands and GM ----

  private runCommand(client: Client, movement: Movement, player: Player, text: string) {
    const [command, ...args] = text.split(/\s+/);
    if (command === "/gm") {
      if (movement.gmTries >= MAX_GM_TRIES) {
        this.tell(client, "ลองรหัส GM ผิดหลายครั้งเกินไป ออกแล้วเข้าเกมใหม่ก่อน");
        return;
      }
      if (!isGmKey(args.join(" "))) {
        movement.gmTries++;
        this.tell(client, "รหัส GM ไม่ถูกต้อง");
        return;
      }

      progress.setPower(movement.playerId, "gm", true);
      player.gm = true;
      this.celebrate(movement.playerId, progress.grantTitle(movement.playerId, "skykeeper"));
      this.tell(client, "คุณเป็น GM แล้ว! กดปุ่ม 🛡 GM ที่มุมซ้ายบนเพื่อเปิดแผงควบคุม");
      return;
    }

    this.tell(client, "ไม่รู้จักคำสั่งนี้ (คำสั่งที่มี: /gm <รหัส>)");
  }

  /** Finds a player by session in any region. */
  private static locate(sessionId: string) {
    for (const room of rooms) {
      const player = room.state.players.get(sessionId);
      const movement = room.movements.get(sessionId);
      const client = room.clients.find((c) => c.sessionId === sessionId);
      if (player && movement && client) {
        return { room, player, movement, client };
      }
    }
    return undefined;
  }

  private static gmList(): GmList {
    const players = [...rooms].flatMap((room) =>
      [...room.movements].flatMap(([id, movement]) => {
        const player = room.state.players.get(id);
        return player
          ? [
              {
                id,
                name: player.name,
                region: room.region.name,
                level: player.level,
                hp: player.hp,
                maxHp: player.maxHp,
                gm: player.gm,
                god: player.god,
                oneHit: movement.oneHit,
              },
            ]
          : [];
      }),
    );
    return { players, bans: progress.bans() };
  }

  private runGmAction(client: Client, message: GmAction) {
    const movement = this.movements.get(client.sessionId);
    const gm = this.state.players.get(client.sessionId);
    if (!movement || !gm || !progress.profile(movement.playerId).gm || typeof message !== "object" || !message) {
      return;
    }

    const done = (text: string) => {
      this.tell(client, `[GM] ${text}`);
      client.send("gm-list", WorldRoom.gmList());
    };

    switch (message.action) {
      case "list":
        client.send("gm-list", WorldRoom.gmList());
        return;
      case "announce": {
        const text = cleanText(message.text, CHAT_MAX_LENGTH);
        if (text) {
          rooms.forEach((room) => room.sendChat({ from: "GM", text: `📢 ประกาศจาก GM: ${text}`, system: true }));
        }
        return;
      }
      case "unban":
        if (typeof message.playerId === "string") {
          progress.unban(message.playerId);
          done("ปลดแบนแล้ว");
        }
        return;
    }

    const found = WorldRoom.locate(String((message as { target?: unknown }).target));
    if (!found) {
      done("ไม่พบผู้เล่นคนนี้ (อาจออกจากเกมไปแล้ว)");
      return;
    }
    const { room, player: target, movement: targetMovement, client: targetClient } = found;
    const targetId = targetClient.sessionId;

    switch (message.action) {
      case "kill":
        if (!target.dead) {
          room.broadcast("hit", { attacker: client.sessionId, target: targetId, damage: target.hp, killed: true });
          room.defeat(targetId, target, targetMovement);
        }
        done(`ลงทัณฑ์ ${target.name} แล้ว`);
        return;
      case "heal":
        target.dead = false;
        target.hp = target.maxHp;
        room.broadcast("levelup", { id: targetId, level: target.level });
        done(`ฟื้นพลัง ${target.name} เต็มหลอดแล้ว`);
        return;
      case "god":
        progress.setPower(targetMovement.playerId, "god", Boolean(message.on));
        target.god = Boolean(message.on);
        done(`${target.name}: อมตะ ${target.god ? "เปิด" : "ปิด"}`);
        return;
      case "onehit":
        progress.setPower(targetMovement.playerId, "oneHit", Boolean(message.on));
        targetMovement.oneHit = Boolean(message.on);
        done(`${target.name}: ฆ่าทีเดียวตาย ${targetMovement.oneHit ? "เปิด" : "ปิด"}`);
        return;
      case "level": {
        const amount = Math.round(Number(message.amount));
        if (!Number.isFinite(amount) || amount === 0) {
          return;
        }
        const before = target.level;
        progress.setLevel(targetMovement.playerId, before + amount);
        room.levelChanged(target, targetMovement.playerId, Math.max(0, progress.profile(targetMovement.playerId).level - before));
        done(`${target.name}: Lv.${before} → Lv.${target.level}`);
        return;
      }
      case "title": {
        const title = findTitle(message.titleId);
        if (title) {
          room.celebrate(targetMovement.playerId, progress.grantTitle(targetMovement.playerId, title.id));
          done(`มอบฉายา「${title.name}」ให้ ${target.name} แล้ว`);
        }
        return;
      }
      case "goto":
        this.sendTo(client, movement, gm, room, target);
        done(`วาร์ปไปหา ${target.name}`);
        return;
      case "summon":
        room.sendTo(targetClient, targetMovement, target, this, gm);
        done(`ดึง ${target.name} มาหาแล้ว`);
        return;
      case "kick":
        if (targetId === client.sessionId) {
          return;
        }
        targetClient.send("removed", { text: "คุณถูก GM เตะออกจากเกม" });
        targetClient.leave(4000);
        done(`เตะ ${target.name} ออกแล้ว`);
        return;
      case "ban": {
        if (targetId === client.sessionId) {
          done("แบนตัวเองไม่ได้");
          return;
        }
        const days = Number(message.days) > 0 ? Number(message.days) : PERMANENT_BAN_DAYS;
        const reason = cleanText(message.reason, 80);
        const until = progress.ban(targetMovement.playerId, days, reason);
        targetClient.send("removed", { text: banText({ until, reason }) });
        targetClient.leave(4003);
        done(`แบน ${target.name} ${days === PERMANENT_BAN_DAYS ? "ถาวร" : `${days} วัน`} แล้ว`);
        return;
      }
    }
  }

  /** Moves a player of this room next to someone, in this room or by travelling to theirs. */
  private sendTo(client: Client, movement: Movement, player: Player, destination: WorldRoom, beside: Player) {
    const spot = { x: beside.x + 40, y: beside.y };
    if (destination === this) {
      player.x = clamp(spot.x, this.region.bounds.minX, this.region.bounds.maxX);
      player.y = spot.y;
      movement.target = undefined;
      return;
    }

    arrivals.set(movement.playerId, spot);
    movement.travelling = true;
    client.send("travel", { to: destination.regionId, from: this.regionId });
  }

  // ---- Simulation ----

  private update(deltaMs: number) {
    const step = (PLAYER_SPEED * deltaMs) / 1000;
    const { bounds, portals } = this.region;
    const flushSteps = ++this.ticks % STEP_FLUSH_TICKS === 0;
    const now = Date.now();

    this.movements.forEach((movement, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player || movement.travelling) {
        return;
      }

      if (player.dead) {
        if (now - movement.diedAt >= RESPAWN_MS) {
          this.respawn(player, movement);
        }
        return;
      }

      if (player.hp < player.maxHp && now - movement.lastHitAt > REGEN_DELAY_MS) {
        movement.regen += (player.maxHp * REGEN_PER_SECOND * deltaMs) / 1000;
        const whole = Math.floor(movement.regen);
        movement.regen -= whole;
        player.hp = Math.min(player.maxHp, player.hp + whole);
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

      if (flushSteps) {
        this.flushActivity(movement);
      }

      if (dx === 0 && dy === 0) {
        movement.idleMs += deltaMs;
        return;
      }

      // Same rule as the client uses to pick which way the sprite looks.
      if (Math.abs(dx) > Math.abs(dy)) {
        movement.facingX = Math.sign(dx);
        movement.facingY = 0;
      } else {
        movement.facingX = 0;
        movement.facingY = Math.sign(dy);
      }

      const x = clamp(player.x + dx, bounds.minX, bounds.maxX);
      const y = clamp(player.y + dy, bounds.minY, bounds.maxY);
      // The east and south have the sea past their edge: walking into it gets nowhere.
      const intoSea =
        (dx > 0 && x === bounds.maxX && bounds.maxX < WORLD_WIDTH - 16) ||
        (dy > 0 && y === bounds.maxY && bounds.maxY < WORLD_HEIGHT - 16);
      if (intoSea) {
        movement.shoreMs += deltaMs;
      }
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
