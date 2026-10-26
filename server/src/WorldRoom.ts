import type { IncomingMessage } from "node:http";
import colyseus, { type Client } from "colyseus";
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_SIZE,
  CHAT_MAX_LENGTH,
  type ChatMessage,
  cleanPartyCode,
  NAME_MAX_LENGTH,
  PARTY_MAX_PLAYERS,
  PLAYER_SPEED,
  RECONNECT_SECONDS,
  HEROES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../../shared/world.ts";
import {
  isRegionId,
  PORTAL_RADIUS,
  REGIONS,
  type Region,
  type RegionId,
  inSafeZone,
  spawnPoint,
  START_REGION,
} from "../../shared/regions.ts";
import {
  attackPower,
  CRIT_MULTIPLIER,
  type HitEvent,
  killXp,
  maxHp,
  REGEN_DELAY_MS,
  REGEN_PER_SECOND,
  isSkillId,
  RESPAWN_MS,
  SKILLS,
  type SkillId,
  SPAWN_SHIELD_MS,
} from "../../shared/combat.ts";
import {
  monsterKind,
  monsterMaxHp,
  monsterXp,
  REGION_MONSTERS,
  WORLD_BOSS,
  type WorldBossEnd,
  type WorldBossEvent,
} from "../../shared/monsters.ts";
import { codexReward } from "../../shared/codex.ts";
import { dungeonParty } from "../../shared/dungeon.ts";
import { DungeonRun } from "./DungeonRun.ts";
import { isBlocked, regionLayout, type RegionLayout, slide } from "../../shared/regionThemes.ts";
import { heroOf, type ShotEvent } from "../../shared/heroes.ts";
import { MonsterSystem } from "./MonsterSystem.ts";
import { type GmAction, type GmList, PERMANENT_BAN_DAYS } from "../../shared/gm.ts";
import { type Achievement, questReward, regionOfTheDay, rewardText, STEP_PX, thaiDay } from "../../shared/quests.ts";
import { findTitle } from "../../shared/titles.ts";
import { clientAddress } from "./environment.ts";
import { isGmKey } from "./gmKey.ts";
import * as teams from "./teams.ts";
import * as voice from "./voice.ts";
import { clearErrors, errorGroups, reportServer } from "./errors.ts";
import { closeReport, fileReport, openReports, reportTarget } from "./reports.ts";
import {
  GOLD_RABBIT,
  type GoldRabbitEvent,
  INVASION,
  INVASION_PRIZES,
  INVASION_SCORED,
  type InvasionEnd,
  type InvasionStatus,
  nextInvasionAt,
} from "../../shared/events.ts";
import { AUTO_MUTE_MINUTES, censor, type GmReport, REPORT_REASONS } from "../../shared/safety.ts";
import { ARMOR_TIERS, isShopItem, monsterGold, POTION, type ShopItem, WEAPON_TIERS } from "../../shared/items.ts";
import { type CosmeticKind, cosmeticList, isCosmeticKind, MOUNTS, WINGS } from "../../shared/cosmetics.ts";
import * as progress from "./progress.ts";
import { type DropSource, LEGENDARY, type LootEvent, RARITIES, rollGear } from "../../shared/loot.ts";
import { DAILY_GIFTS, type DailyGiftEvent } from "../../shared/rewards.ts";
import { ARROW_RAIN_WAVES, BERSERK_SPEED, BULWARK_TAKEN, ULTIMATES, type UltimateEvent } from "../../shared/ultimates.ts";
import { type Monster, Player, WorldState } from "./schema.ts";

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
  /** When each skill may be used again. */
  skillReadyAt: Partial<Record<SkillId, number>>;
  potionReadyAt: number;
  /** Last time the player was told they can't fight in a safe zone, to say it only now and then. */
  safeNoticeAt: number;
  /** Kicked or banned by a GM: never kept for a reconnection. */
  removed?: boolean;
  /** The class skill: when it may be used again, and until when its effect holds. */
  ultimateReadyAt: number;
  guardUntil: number;
  rageUntil: number;
  /** The last lines the player wrote, for a report about them. */
  recentChats: string[];
}

/** Lines of a player's chat kept for a report. */
const REPORT_CHATS = 5;

/** Teammates within this distance share a monster's reward even if they didn't hit it. */
const SHARE_DISTANCE = 800;

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
/** Wrong GM keys allowed before a lock, counted by address and by player across rooms and visits. */
const MAX_GM_TRIES = 5;
const GM_LOCK_MS = 15 * 60_000;
const gmFailures = new Map<string, { count: number; lockedUntil: number }>();

/** An arrow, crossbow bolt or magic orb in flight. */
interface Projectile extends ShotEvent {
  travelled: number;
  /** Shot at a monster: flies past other players instead of hitting whoever stands in the way. */
  monstersOnly: boolean;
}

/** How close a shot must pass to hit: about a body's width; bosses are bigger. */
const SHOT_RADIUS = 26;
const BOSS_SHOT_RADIUS = 56;

/** Two players on the same team: they can't hurt each other. */
function sameTeam(a: Player, b: Player) {
  return a.team !== "" && a.team === b.team;
}

/** Every open region room, so a GM can reach players anywhere. */
const rooms = new Set<WorldRoom>();
/** Where a player sent by a GM appears in the next region, instead of beside the portal. */
const arrivals = new Map<string, { x: number; y: number }>();

/** The room each player in a dungeon came from (its party code), to go back to on leaving. */
const beforeDungeon = new Map<string, string>();

/** The world boss now up, if any: its room, its monster id and when it leaves. */
let worldBoss: { room: WorldRoom; monsterId: string; endsAt: number } | undefined;
let nextWorldBossAt = Date.now() + WORLD_BOSS.firstMs;
let worldBossTimer: NodeJS.Timeout | undefined;

/** The invasion near or on, for every world at once; each world (party) keeps its own scores. */
let invasion:
  | { startsAt: number; endsAt: number; warned: number; started: boolean; lords: number; scores: Map<string, Map<string, { name: string; score: number }>> }
  | undefined;
/** TIMED_EVENTS=off: events only when a GM starts them (the tests). */
const naturalEvents = process.env.TIMED_EVENTS !== "off";
let nextInvasion = naturalEvents ? nextInvasionAt() : Infinity;
/** The golden rabbit now running, if any. */
let rabbit: { room: WorldRoom; monsterId: string; endsAt: number } | undefined;
let nextRabbitAt = naturalEvents ? Date.now() + GOLD_RABBIT.firstMs : Infinity;
let eventTimer: NodeJS.Timeout | undefined;

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

/** Names that would pass a player's chat off as the game's or a GM's. */
const RESERVED_NAME = /^(ระบบ|ประกาศ|แอดมิน|admin|system|gm|\[gm\]|ผู้ดูแล)/i;

function playerName(value: unknown) {
  // Invisible and direction-changing characters would let a name look like another.
  const name = cleanText(value, NAME_MAX_LENGTH).replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, "").trim();
  if (!name || RESERVED_NAME.test(name)) {
    return `ผู้เล่น${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return name;
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

/** One room per region and party; the matchmaker keeps them apart with filterBy(["region", "party"]). */
export class WorldRoom extends Room<WorldState> {
  maxClients = 50;

  private regionId: RegionId = START_REGION;
  private region: Region = REGIONS[START_REGION];
  private movements = new Map<string, Movement>();
  /** Recent chat, each line with who wrote it, so those who blocked them don't see it on joining. */
  private chatHistory: { message: ChatMessage; writer?: string }[] = [];
  private ticks = 0;
  private projectiles: Projectile[] = [];
  private nextShotId = 1;
  private layout!: RegionLayout;
  private monsters!: MonsterSystem;

  /** A private room's code; "" in the public world. */
  private party = "";
  /** The waves and the boss, in the dungeon's rooms. */
  private dungeon?: DungeonRun;

  onCreate(options: { region?: unknown; party?: unknown }) {
    this.regionId = isRegionId(options?.region) ? options.region : START_REGION;
    this.party = cleanPartyCode(options?.party);
    if (this.party) {
      this.maxClients = PARTY_MAX_PLAYERS;
    }
    this.region = REGIONS[this.regionId];
    this.setState(new WorldState());
    rooms.add(this);
    worldBossTimer ??= setInterval(() => WorldRoom.worldBossTick(), 10_000);
    eventTimer ??= setInterval(() => WorldRoom.eventTick(), 1000);
    this.layout = regionLayout(this.regionId);
    this.monsters = new MonsterSystem({
      regionId: this.regionId,
      region: this.region,
      layout: this.layout,
      monsters: this.state.monsters,
      targets: () => this.chaseable(),
      broadcast: (type, message) => this.broadcast(type, message),
      strikePlayer: (monsterId, sessionId, damage) => this.monsterHit(monsterId, sessionId, damage),
      announce: (text) => this.sendChat({ from: "ระบบ", text, system: true }),
    });
    if (this.regionId === "dungeon") {
      this.dungeon = new DungeonRun({
        region: this.region,
        layout: this.layout,
        monsters: this.monsters,
        monsterStates: this.state.monsters,
        heroes: () =>
          [...this.state.players].filter(([id, player]) => !player.away && !this.movements.get(id)?.travelling).map(([, player]) => player),
        broadcast: (type, message) => this.broadcast(type, message),
        announce: (text) => this.sendChat({ from: "ระบบ", text, system: true }),
        cleared: (bossKind) => this.dungeonCleared(bossKind),
      });
    }

    this.onMessage("dir", (client, message: { x?: unknown; y?: unknown }) => {
      const movement = this.movements.get(client.sessionId);
      if (!movement) {
        return;
      }

      // Keys send -1, 0 or 1; a joystick sends any direction. Either way the player walks at full speed.
      // Anything else (Infinity, text) is no direction: dividing by it would make the position NaN.
      const x = clamp(Number(message?.x) || 0, -1, 1);
      const y = clamp(Number(message?.y) || 0, -1, 1);
      const length = Math.hypot(x, y);
      movement.dirX = length > 0.2 ? x / length : 0;
      movement.dirY = length > 0.2 ? y / length : 0;
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
      const muted = progress.mutedUntil(movement.playerId);
      if (muted) {
        this.tell(client, `🔇 คุณถูกปิดแชทชั่วคราวเพราะมีผู้เล่นรายงาน อีก ${Math.ceil((muted - now) / 60_000)} นาที`);
        return;
      }
      const clean = censor(text);
      movement.recentChats.push(clean === text ? text : `${clean}  (เดิม: ${text})`);
      if (movement.recentChats.length > REPORT_CHATS) {
        movement.recentChats.shift();
      }
      this.sendChat({ from: player.name, text: clean, title: player.title || undefined }, client.sessionId);
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
    this.onMessage("buy", (client, message: { item?: unknown; count?: unknown }) => {
      if (isShopItem(message?.item)) {
        this.buy(client, message.item, Number(message?.count) || 1);
      }
    });
    this.onMessage("potion", (client) => this.drinkPotion(client.sessionId));
    this.onMessage("gear-wear", (client, message: { id?: unknown }) => this.changeGear(client, "wear", String(message?.id)));
    this.onMessage("gear-off", (client, message: { slot?: unknown }) => this.changeGear(client, "off", String(message?.slot)));
    this.onMessage("gear-sell", (client, message: { id?: unknown }) => this.changeGear(client, "sell", String(message?.id)));
    this.onMessage("gear-enhance", (client, message: { id?: unknown }) => this.enhance(client, String(message?.id)));
    this.onMessage("codex", (client) => {
      const movement = this.movements.get(client.sessionId);
      if (movement) {
        client.send("codex", progress.codex(movement.playerId));
      }
    });
    this.onMessage("buy-cosmetic", (client, message: { kind?: unknown; index?: unknown }) => {
      if (isCosmeticKind(message?.kind)) {
        this.buyCosmetic(client, message.kind, Number(message?.index));
      }
    });
    this.onMessage("equip", (client, message: { kind?: unknown; index?: unknown }) => {
      if (isCosmeticKind(message?.kind)) {
        this.equipCosmetic(client, message.kind, Number(message?.index));
      }
    });
    this.onMessage("ride", (client, message: { on?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      if (player && !player.dead) {
        player.riding = Boolean(message?.on) && player.mount > 0;
      }
    });
    this.onMessage("team-invite", (client, message: { target?: unknown }) => this.teamInvite(client, String(message?.target)));
    this.onMessage("team-answer", (client, message: { yes?: unknown }) => this.teamAnswer(client, Boolean(message?.yes)));
    this.onMessage("team-leave", (client) => {
      const movement = this.movements.get(client.sessionId);
      if (movement) {
        this.teamChanged(teams.leave(movement.playerId), [movement.playerId]);
      }
    });
    this.onMessage("ultimate", (client) => this.useUltimate(client.sessionId));
    this.onMessage("skill", (client, message: { id?: unknown }) => {
      if (isSkillId(message?.id)) {
        this.useSkill(client.sessionId, message.id);
      }
    });
    this.onMessage("gm", (client, message: GmAction) => this.runGmAction(client, message));
    this.onMessage("voice", (client, message: { on?: unknown }) => {
      const movement = this.movements.get(client.sessionId);
      if (movement) {
        voice.setTalking(movement.playerId, Boolean(message?.on));
      }
    });
    this.onMessage("voice-signal", (client, message: { to?: unknown; data?: unknown }) => this.passVoiceSignal(client, message));
    this.onMessage("block", (client, message: { target?: unknown }) => this.block(client, String(message?.target)));
    this.onMessage("unblock", (client, message: { index?: unknown }) => {
      const movement = this.movements.get(client.sessionId);
      if (movement && progress.unblock(movement.playerId, Number(message?.index))) {
        client.send("blocked", progress.blockedNames(movement.playerId));
      }
    });
    this.onMessage("report", (client, message: { target?: unknown; reason?: unknown; note?: unknown }) =>
      this.report(client, String(message?.target), message?.reason, message?.note),
    );

    this.setSimulationInterval((deltaMs) => this.update(deltaMs), 50);
  }

  /** An error in this room's code: noted for the GM panel; the room and everyone in it carry on. */
  onUncaughtException(error: Error, methodName: string) {
    reportServer(error, `${methodName} · ${this.regionId}${this.party ? ` · ห้อง ${this.party}` : ""}`);
  }

  onDispose() {
    rooms.delete(this);
    if (rabbit?.room === this) {
      rabbit = undefined;
    }
    // The world boss's region emptied and closed: it is gone, and the other regions' banners with it.
    if (worldBoss?.room === this) {
      worldBoss = undefined;
      const name = monsterKind(WORLD_BOSS.kind)!.name;
      for (const room of this.sameWorld()) {
        room.broadcast("world-boss-end", { beaten: false, name, top: [] } satisfies WorldBossEnd);
      }
    }
  }

  /** Banned players and anyone from a banned address are turned away before joining. */
  onAuth(_client: Client, options: JoinOptions, request?: IncomingMessage) {
    const ip = clientAddress(request);
    const ban = progress.activeBan(validPlayerId(options?.playerId) ?? "", ip);
    if (ban) {
      throw new ServerError(403, banText(ban));
    }
    return { ip };
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new Player();
    player.name = censor(playerName(options?.name));
    const skin = Number(options?.skin);
    player.skin = Number.isInteger(skin) && skin >= 0 && skin < HEROES.length ? skin : 0;

    // Without a valid id the progress still counts, but only for this visit.
    const playerId = validPlayerId(options?.playerId) ?? `guest-${client.sessionId}`;
    player.title = progress.equippedTitle(playerId);
    progress.remember(playerId, player.name, player.skin, (client.auth as { ip?: string } | undefined)?.ip ?? "");

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
    Object.assign(player, progress.inventory(playerId));
    this.sendInventory(client, playerId);
    if (this.dungeon) {
      client.send("dungeon", this.dungeon.status());
    }
    player.team = teams.teamIdOf(playerId);
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
      skillReadyAt: {},
      potionReadyAt: 0,
      safeNoticeAt: 0,
      ultimateReadyAt: 0,
      guardUntil: 0,
      rageUntil: 0,
      recentChats: [],
    });

    client.send(
      "chat-history",
      this.chatHistory.filter((entry) => !entry.writer || !progress.blocks(playerId, entry.writer)).map((entry) => entry.message),
    );
    client.send("progress", progress.view(playerId));
    this.giveDailyGift(client, player, playerId);
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

  /** What the client keeps outside the room's state: sent on joining, and again on coming back. */
  private sendInventory(client: Client, playerId: string) {
    client.send("wardrobe", progress.wardrobe(playerId));
    client.send("bag", progress.bag(playerId));
    client.send("blocked", progress.blockedNames(playerId));
    if (worldBoss && worldBoss.room.party === this.party) {
      client.send("world-boss", worldBoss.room.worldBossEvent());
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    const movement = this.movements.get(client.sessionId);
    // A dropped connection, not a goodbye: keep the player where they stand, out of harm's way,
    // for the game to reconnect them.
    if (!consented && player && movement && !movement.travelling && !movement.removed) {
      player.away = true;
      player.riding = false;
      movement.dirX = 0;
      movement.dirY = 0;
      movement.target = undefined;
      try {
        const back = await this.allowReconnection(client, RECONNECT_SECONDS);
        player.away = false;
        movement.shieldUntil = Date.now() + SPAWN_SHIELD_MS;
        this.sendInventory(back, movement.playerId);
        back.send("progress", progress.view(movement.playerId));
        return;
      } catch {
        // Not back in time: they leave as usual.
      }
    }
    if (movement && !movement.travelling) {
      voice.setTalking(movement.playerId, false);
    }
    if (movement && !movement.travelling && teams.teamIdOf(movement.playerId)) {
      const { playerId } = movement;
      teams.goneFor(
        playerId,
        () => WorldRoom.sessionOf(playerId) !== undefined,
        (left) => this.teamChanged(left, [playerId]),
      );
    }
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
    // Quest rewards went into the saved gold and potions: the player carries them now.
    const player = entry && this.state.players.get(entry[0]);
    if (player && achievements.length > 0) {
      const { gold, potions } = progress.inventory(playerId);
      if (gold > player.gold) {
        this.clients.find((c) => c.sessionId === entry[0])?.send("gold", { amount: gold - player.gold, x: player.x, y: player.y });
      }
      player.gold = gold;
      player.potions = potions;
    }
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
    const writer = senderId ? this.movements.get(senderId)?.playerId : undefined;
    this.chatHistory.push({ message, writer });
    if (this.chatHistory.length > CHAT_HISTORY_SIZE) {
      this.chatHistory.shift();
    }

    const line = { ...message, senderId };
    for (const client of this.clients) {
      const reader = this.movements.get(client.sessionId)?.playerId;
      // Those who blocked the writer don't see it.
      if (!writer || !reader || !progress.blocks(reader, writer)) {
        client.send("chat", line);
      }
    }
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
    // Each class is tougher or frailer than the level alone says; armour and a charm add to it.
    const gear = progress.gearBonus(playerId);
    player.gearPower = gear.power;
    player.gearRarity = gear.weaponRarity;
    player.maxHp = Math.round(maxHp(level) * heroOf(player.skin).hp * (ARMOR_TIERS[player.armor]?.bonus ?? 1) * gear.hp);
    player.hp = Math.min(player.hp, player.maxHp);
  }

  /** Standing in a safe zone, or waiting to reconnect: can't hurt anyone or be hurt. */
  private isSafe(player: Player) {
    return player.away || inSafeZone(this.regionId, player.x, player.y);
  }

  /** Tells a player who tried to fight in a safe zone why nothing happened, now and then. */
  private safeNotice(sessionId: string, movement: Movement) {
    const now = Date.now();
    if (now - movement.safeNoticeAt > 3000) {
      movement.safeNoticeAt = now;
      this.clients.find((c) => c.sessionId === sessionId)?.send("notice", { text: "🛡 เขตปลอดภัย: ต่อสู้ไม่ได้ ออกไปนอกวงก่อน", ok: false });
    }
  }

  /** Players a monster may chase: alive, here, not leaving, and out of the safe zones. */
  private *chaseable(): Iterable<[string, Player]> {
    for (const [sessionId, player] of this.state.players) {
      const movement = this.movements.get(sessionId);
      if (!player.dead && movement && !movement.travelling && !this.isSafe(player)) {
        yield [sessionId, player];
      }
    }
  }

  /** The player and their movement, when they can act right now. */
  private fighter(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const movement = this.movements.get(sessionId);
    return player && movement && !player.dead && !movement.travelling ? { player, movement } : undefined;
  }

  /**
   * Turns the player towards the nearest foe within reach, as mobile games do: monsters first,
   * other players only when no monster is near, so fighting in town stays a choice.
   */
  private aim(sessionId: string, player: Player, movement: Movement, reach: number): "monster" | "player" | undefined {
    let best: { x: number; y: number } | undefined;
    let bestDistance = Infinity;
    this.state.monsters.forEach((monster) => {
      const distance = Math.hypot(monster.x - player.x, monster.y - player.y);
      const extra = this.monsters.kind(monster).boss ? 40 : 0;
      if (!monster.dead && distance <= reach + extra && distance < bestDistance) {
        best = monster;
        bestDistance = distance;
      }
    });
    if (!best) {
      this.state.players.forEach((other, otherId) => {
        const otherMovement = this.movements.get(otherId);
        const distance = Math.hypot(other.x - player.x, other.y - player.y);
        if (
          otherId !== sessionId &&
          !other.dead &&
          !sameTeam(player, other) &&
          otherMovement &&
          !otherMovement.travelling &&
          !this.isSafe(other) &&
          distance <= reach &&
          distance < bestDistance
        ) {
          best = other;
          bestDistance = distance;
        }
      });
    }
    if (best && bestDistance > 1) {
      movement.facingX = (best.x - player.x) / bestDistance;
      movement.facingY = (best.y - player.y) / bestDistance;
    }
    return best ? ("kind" in best ? "monster" : "player") : undefined;
  }

  /** The class's basic attack: a swing in front, or a shot that flies. */
  private attack(sessionId: string) {
    const attacker = this.fighter(sessionId);
    const now = Date.now();
    if (!attacker) {
      return;
    }
    const { player, movement } = attacker;
    const hero = heroOf(player.skin);
    if (now - movement.lastAttackAt < hero.cooldownMs) {
      return;
    }
    // No fighting from inside: an archer could shoot monsters that can't come for them.
    if (this.isSafe(player)) {
      this.safeNotice(sessionId, movement);
      return;
    }

    movement.lastAttackAt = now;
    // Attacking ends the arrival shield, and gets the rider off.
    movement.shieldUntil = 0;
    player.riding = false;
    const aimedAt = this.aim(sessionId, player, movement, hero.attack.range * 1.15);
    const { facingX, facingY } = movement;
    this.broadcast("swing", { id: sessionId, x: facingX, y: facingY });

    if (hero.attack.kind === "melee") {
      const { arc } = hero.attack;
      this.strikeAround(sessionId, hero.attack.range, 1, (dx, dy, distance) => {
        return distance < 20 || (dx * facingX + dy * facingY) / distance > arc;
      });
      return;
    }

    const shot: Projectile = {
      id: this.nextShotId++,
      by: sessionId,
      // From the hands, a little in front of the body.
      x: player.x + facingX * 16,
      y: player.y + facingY * 16,
      dx: facingX,
      dy: facingY,
      speed: hero.attack.speed,
      range: hero.attack.range,
      projectile: hero.attack.projectile,
      travelled: 0,
      monstersOnly: aimedAt === "monster",
    };
    this.projectiles.push(shot);
    const { travelled: _travelled, monstersOnly: _monstersOnly, ...event } = shot;
    this.broadcast("shot", event satisfies ShotEvent);
  }

  /** Moves every shot on; one ends on the first player or monster it touches, a solid prop, or its range. */
  private updateProjectiles(deltaMs: number) {
    const now = Date.now();
    this.projectiles = this.projectiles.filter((shot) => {
      const shooter = this.fighter(shot.by);
      const step = (shot.speed * deltaMs) / 1000;
      // Checked in small steps so a fast arrow can't skip over a target.
      for (let moved = 0; moved < step; moved += 12) {
        const advance = Math.min(12, step - moved);
        shot.x += shot.dx * advance;
        shot.y += shot.dy * advance;
        shot.travelled += advance;

        let ended = false;
        this.state.monsters.forEach((monster, monsterId) => {
          const radius = this.monsters.kind(monster).boss ? BOSS_SHOT_RADIUS : SHOT_RADIUS;
          if (!ended && !monster.dead && Math.hypot(monster.x - shot.x, monster.y - 14 - shot.y) <= radius) {
            ended = true;
            if (shooter) {
              this.hitMonster(shot.by, shooter.player, shooter.movement, monsterId, monster, 1);
            }
          }
        });
        this.state.players.forEach((target, targetId) => {
          const targetMovement = this.movements.get(targetId);
          if (
            ended ||
            shot.monstersOnly ||
            targetId === shot.by ||
            this.isSafe(target) ||
            (shooter && sameTeam(shooter.player, target)) ||
            target.dead ||
            !targetMovement ||
            targetMovement.travelling ||
            Math.hypot(target.x - shot.x, target.y - 14 - shot.y) > SHOT_RADIUS
          ) {
            return;
          }
          ended = true;
          if (shooter && now >= targetMovement.shieldUntil) {
            this.hit(shot.by, shooter.player, shooter.movement, targetId, target, targetMovement);
          }
        });
        if (ended || shot.travelled >= shot.range || isBlocked(this.layout, shot.x, shot.y + 10, 4)) {
          this.broadcast("shot-end", { id: shot.id, x: shot.x, y: shot.y });
          return false;
        }
      }
      return true;
    });
  }

  private useSkill(sessionId: string, skillId: SkillId) {
    const attacker = this.fighter(sessionId);
    const now = Date.now();
    if (!attacker || now < (attacker.movement.skillReadyAt[skillId] ?? 0)) {
      return;
    }

    const { player, movement } = attacker;
    if ((skillId === "spin" || skillId === "strike") && this.isSafe(player)) {
      this.safeNotice(sessionId, movement);
      return;
    }
    movement.skillReadyAt[skillId] = now + SKILLS[skillId].cooldownMs;
    movement.shieldUntil = 0;
    player.riding = false;

    if (skillId === "spin") {
      this.broadcast("skill", { id: skillId, by: sessionId });
      this.strikeAround(sessionId, SKILLS.spin.radius, SKILLS.spin.multiplier, () => true);
      return;
    }

    if (skillId === "strike") {
      const { distance, radius, multiplier } = SKILLS.strike;
      this.aim(sessionId, player, movement, distance + radius);
      const aimX = movement.facingX * distance;
      const aimY = movement.facingY * distance;
      this.broadcast("skill", { id: skillId, by: sessionId, x: player.x + aimX, y: player.y + aimY });
      this.strikeAround(sessionId, distance + radius, multiplier, (dx, dy) => Math.hypot(dx - aimX, dy - aimY) <= radius);
      return;
    }

    if (skillId === "heal") {
      const amount = Math.min(player.maxHp - player.hp, Math.round(player.maxHp * SKILLS.heal.share));
      player.hp += amount;
      this.broadcast("skill", { id: skillId, by: sessionId, amount });
      return;
    }

    // Dash: forward in small steps, so it stops at walls and the shore instead of passing through.
    const from = { x: player.x, y: player.y };
    const { bounds } = this.region;
    for (let travelled = 0; travelled < SKILLS.dash.distance; travelled += 10) {
      const next = slide(this.layout, player.x, player.y, movement.facingX * 10, movement.facingY * 10);
      player.x = clamp(next.x, bounds.minX, bounds.maxX);
      player.y = clamp(next.y, bounds.minY, bounds.maxY);
    }
    movement.target = undefined;
    movement.shieldUntil = now + SKILLS.dash.shieldMs;
    movement.walkedPx += Math.hypot(player.x - from.x, player.y - from.y);
    this.broadcast("skill", { id: skillId, by: sessionId, fromX: from.x, fromY: from.y });
  }

  /** A blow's damage after a bulwark over the one taking it. */
  private guarded(target: Player, damage: number) {
    return target.guarded ? Math.max(1, Math.round(damage * BULWARK_TAKEN)) : damage;
  }

  // ---- Class skills ----

  /** The class's own skill, each with its effect (see shared/ultimates.ts). */
  private useUltimate(sessionId: string) {
    const attacker = this.fighter(sessionId);
    const now = Date.now();
    if (!attacker || now < attacker.movement.ultimateReadyAt) {
      return;
    }
    const { player, movement } = attacker;
    const id = heroOf(player.skin).ultimate;
    const ultimate = ULTIMATES[id];
    if (ultimate.offensive && this.isSafe(player)) {
      this.safeNotice(sessionId, movement);
      return;
    }
    movement.ultimateReadyAt = now + ultimate.cooldownMs;
    movement.shieldUntil = 0;
    this.celebrate(movement.playerId, progress.recordUltimate(movement.playerId));
    player.riding = false;
    const event: UltimateEvent = { id, by: sessionId };

    switch (id) {
      case "bulwark":
        // The hero and teammates around: half the damage for a while.
        this.state.players.forEach((other, otherId) => {
          const otherMovement = this.movements.get(otherId);
          const near = Math.hypot(other.x - player.x, other.y - player.y) <= ultimate.radius;
          if (otherMovement && !other.dead && near && (otherId === sessionId || sameTeam(player, other))) {
            other.guarded = true;
            otherMovement.guardUntil = now + ultimate.durationMs;
          }
        });
        break;
      case "berserk":
        player.rage = true;
        movement.rageUntil = now + ultimate.durationMs;
        break;
      case "meteor":
      case "arrowRain": {
        // On the nearest foe in reach, or ahead.
        this.aim(sessionId, player, movement, ultimate.reach);
        const target = this.nearestFoe(sessionId, player, ultimate.reach);
        const x = target?.x ?? player.x + movement.facingX * ultimate.reach * 0.5;
        const y = target?.y ?? player.y + movement.facingY * ultimate.reach * 0.5;
        Object.assign(event, { x, y });
        const waves = id === "meteor" ? 1 : ARROW_RAIN_WAVES;
        for (let wave = 1; wave <= waves; wave++) {
          this.clock.setTimeout(() => this.strikeArea(sessionId, x, y, ultimate.radius, ultimate.multiplier), ultimate.durationMs * wave);
        }
        break;
      }
      case "pierce": {
        this.aim(sessionId, player, movement, ultimate.reach);
        const { facingX: dirX, facingY: dirY } = movement;
        Object.assign(event, { dirX, dirY });
        this.strikeLine(sessionId, player.x, player.y, dirX, dirY, ultimate.reach, ultimate.radius, ultimate.multiplier);
        break;
      }
      case "shadowStrike": {
        const target = this.nearestFoe(sessionId, player, ultimate.reach);
        if (!target) {
          // Nobody to strike: the skill isn't spent.
          movement.ultimateReadyAt = 0;
          this.clients.find((c) => c.sessionId === sessionId)?.send("notice", { text: "ไม่มีศัตรูในระยะ", ok: false });
          return;
        }
        Object.assign(event, { x: player.x, y: player.y });
        // Behind them, as seen from where the hero stood (or beside them, if a rock is there).
        const away = Math.hypot(target.x - player.x, target.y - player.y) || 1;
        const behind = { x: target.x + ((target.x - player.x) / away) * 36, y: target.y + ((target.y - player.y) / away) * 36 };
        const { bounds } = this.region;
        if (!isBlocked(this.layout, behind.x, behind.y, 12)) {
          player.x = clamp(behind.x, bounds.minX, bounds.maxX);
          player.y = clamp(behind.y, bounds.minY, bounds.maxY);
        }
        movement.target = undefined;
        movement.facingX = (target.x - player.x) / (Math.hypot(target.x - player.x, target.y - player.y) || 1);
        movement.facingY = (target.y - player.y) / (Math.hypot(target.x - player.x, target.y - player.y) || 1);
        if (target.monsterId) {
          const monster = this.state.monsters.get(target.monsterId)!;
          this.hitMonster(sessionId, player, movement, target.monsterId, monster, ultimate.multiplier, true);
        } else if (target.playerId) {
          const victim = this.state.players.get(target.playerId)!;
          this.hit(sessionId, player, movement, target.playerId, victim, this.movements.get(target.playerId)!, ultimate.multiplier, true);
        }
        break;
      }
    }
    this.broadcast("ultimate", event);
  }

  /** The closest monster, or player who can be fought, within reach. */
  private nearestFoe(sessionId: string, player: Player, reach: number) {
    let best: { x: number; y: number; monsterId?: string; playerId?: string } | undefined;
    let bestDistance = reach;
    this.state.monsters.forEach((monster, monsterId) => {
      const distance = Math.hypot(monster.x - player.x, monster.y - player.y);
      if (!monster.dead && distance <= bestDistance) {
        best = { x: monster.x, y: monster.y, monsterId };
        bestDistance = distance;
      }
    });
    if (!best) {
      this.state.players.forEach((other, otherId) => {
        const otherMovement = this.movements.get(otherId);
        const distance = Math.hypot(other.x - player.x, other.y - player.y);
        if (otherId !== sessionId && !other.dead && otherMovement && !otherMovement.travelling && !sameTeam(player, other) && !this.isSafe(other) && distance <= bestDistance) {
          best = { x: other.x, y: other.y, playerId: otherId };
          bestDistance = distance;
        }
      });
    }
    return best;
  }

  /** Everyone (but the hero's team) and every monster within `radius` of a point. */
  private strikeArea(sessionId: string, x: number, y: number, radius: number, multiplier: number) {
    const attacker = this.fighter(sessionId);
    if (!attacker) {
      return;
    }
    const now = Date.now();
    this.state.monsters.forEach((monster, monsterId) => {
      const extra = this.monsters.kind(monster).boss ? 40 : 0;
      if (!monster.dead && Math.hypot(monster.x - x, monster.y - y) <= radius + extra) {
        this.hitMonster(sessionId, attacker.player, attacker.movement, monsterId, monster, multiplier);
      }
    });
    this.state.players.forEach((target, targetId) => {
      const targetMovement = this.movements.get(targetId);
      if (targetId === sessionId || target.dead || !targetMovement || targetMovement.travelling || sameTeam(attacker.player, target)) {
        return;
      }
      if (Math.hypot(target.x - x, target.y - y) <= radius && now >= targetMovement.shieldUntil) {
        this.hit(sessionId, attacker.player, attacker.movement, targetId, target, targetMovement, multiplier);
      }
    });
  }

  /** Everything along a straight line from a point, `width` either side of it. */
  private strikeLine(sessionId: string, x: number, y: number, dirX: number, dirY: number, length: number, width: number, multiplier: number) {
    const attacker = this.fighter(sessionId);
    if (!attacker) {
      return;
    }
    const now = Date.now();
    const onLine = (px: number, py: number, extra: number) => {
      const along = (px - x) * dirX + (py - y) * dirY;
      const aside = Math.abs((px - x) * dirY - (py - y) * dirX);
      return along >= 0 && along <= length && aside <= width + extra;
    };
    this.state.monsters.forEach((monster, monsterId) => {
      if (!monster.dead && onLine(monster.x, monster.y, this.monsters.kind(monster).boss ? 40 : 14)) {
        this.hitMonster(sessionId, attacker.player, attacker.movement, monsterId, monster, multiplier);
      }
    });
    this.state.players.forEach((target, targetId) => {
      const targetMovement = this.movements.get(targetId);
      if (targetId === sessionId || target.dead || !targetMovement || targetMovement.travelling || sameTeam(attacker.player, target)) {
        return;
      }
      if (onLine(target.x, target.y, 14) && now >= targetMovement.shieldUntil) {
        this.hit(sessionId, attacker.player, attacker.movement, targetId, target, targetMovement, multiplier);
      }
    });
  }

  /** Hits every player and monster within reach that `aims` accepts, with the attacker's power times `multiplier`. */
  private strikeAround(
    sessionId: string,
    reach: number,
    multiplier: number,
    aims: (dx: number, dy: number, distance: number) => boolean,
  ) {
    const attacker = this.fighter(sessionId);
    if (!attacker) {
      return;
    }
    const { player, movement } = attacker;
    const now = Date.now();
    const inReach = (x: number, y: number, extra = 0) => {
      const dx = x - player.x;
      const dy = y - player.y;
      const distance = Math.hypot(dx, dy);
      return distance <= reach + extra && aims(dx, dy, distance);
    };

    this.state.players.forEach((target, targetId) => {
      const targetMovement = this.movements.get(targetId);
      if (targetId === sessionId || target.dead || !targetMovement || targetMovement.travelling || sameTeam(player, target)) {
        return;
      }
      if (inReach(target.x, target.y) && now >= targetMovement.shieldUntil) {
        this.hit(sessionId, player, movement, targetId, target, targetMovement, multiplier);
      }
    });

    this.state.monsters.forEach((monster, monsterId) => {
      // Bosses are big: their body can be reached from further away.
      const extra = this.monsters.kind(monster).boss ? 40 : 0;
      if (!monster.dead && inReach(monster.x, monster.y, extra)) {
        this.hitMonster(sessionId, player, movement, monsterId, monster, multiplier);
      }
    });
  }

  /** Damage from the attacker's level and class, a little random, sometimes critical. */
  private rollDamage(attacker: Player, multiplier: number, sureCrit = false) {
    const hero = heroOf(attacker.skin);
    const crit = sureCrit || Math.random() < hero.crit;
    const rolled =
      attackPower(attacker.level) *
      hero.power *
      (WEAPON_TIERS[attacker.weapon]?.bonus ?? 1) *
      attacker.gearPower *
      (WINGS[attacker.wing]?.power ?? 1) *
      (attacker.rage ? ULTIMATES.berserk.multiplier : 1) *
      multiplier *
      (0.85 + Math.random() * 0.3) *
      (crit ? CRIT_MULTIPLIER : 1);
    return { damage: Math.max(1, Math.round(rolled)), crit };
  }

  private hit(
    attackerId: string,
    attacker: Player,
    attackerMovement: Movement,
    targetId: string,
    target: Player,
    targetMovement: Movement,
    multiplier = 1,
    sureCrit = false,
  ) {
    if (this.isSafe(target)) {
      return;
    }
    if (target.god) {
      this.broadcast("hit", { attacker: attackerId, target: targetId, damage: 0, blocked: true } satisfies HitEvent);
      return;
    }

    const rolled = this.rollDamage(attacker, multiplier, sureCrit);
    // A one-hit GM always kills; a bulwark halves the rest.
    const damage = attackerMovement.oneHit ? target.hp : this.guarded(target, rolled.damage);
    target.hp = Math.max(0, target.hp - damage);
    targetMovement.lastHitAt = Date.now();
    const killed = target.hp === 0;
    this.broadcast("hit", { attacker: attackerId, target: targetId, damage, crit: rolled.crit, killed } satisfies HitEvent);

    if (killed) {
      this.defeat(targetId, target, targetMovement, attacker, attackerMovement);
    }
  }

  private hitMonster(
    attackerId: string,
    attacker: Player,
    attackerMovement: Movement,
    monsterId: string,
    monster: Monster,
    multiplier: number,
    sureCrit = false,
  ) {
    const rolled = this.rollDamage(attacker, multiplier, sureCrit);
    const damage = attackerMovement.oneHit ? monster.hp : Math.min(monster.hp, rolled.damage);
    monster.hp -= damage;
    this.monsters.hurt(monsterId, attackerId, damage);
    const killed = monster.hp <= 0;
    this.broadcast("hit", { attacker: attackerId, target: monsterId, damage, crit: rolled.crit, killed } satisfies HitEvent);
    if (monster.elite === "rabbit" && damage > 0) {
      const coins = Math.round(GOLD_RABBIT.coinsPerHit * (1 + attacker.level / 10));
      attacker.gold += coins;
      progress.saveInventory(attackerMovement.playerId, { gold: attacker.gold });
      this.clients.find((c) => c.sessionId === attackerId)?.send("gold", { amount: coins, x: monster.x, y: monster.y });
    }
    if (killed) {
      this.monsterDefeated(monsterId, monster);
    }
  }

  /**
   * Everyone who fought the monster shares the reward: the top fighter in full, helpers half.
   * Teammates close by who didn't hit it get the helpers' share too.
   */
  private monsterDefeated(monsterId: string, monster: Monster) {
    const kind = this.monsters.kind(monster);
    const damageBy = new Map(this.monsters.mind(monsterId)?.damageBy);
    const fighters = this.monsters.defeat(monsterId);
    const teamsThere = new Set(fighters.map((id) => this.state.players.get(id)?.team).filter(Boolean));
    this.state.players.forEach((player, sessionId) => {
      const near = Math.hypot(player.x - monster.x, player.y - monster.y) <= SHARE_DISTANCE;
      if (!fighters.includes(sessionId) && player.team && teamsThere.has(player.team) && near && !player.dead) {
        fighters.push(sessionId);
      }
    });
    if (worldBoss?.room === this && worldBoss.monsterId === monsterId) {
      this.worldBossDefeated(monsterId, monster, fighters, damageBy);
      return;
    }
    if (monster.elite === "invader" || monster.elite === "lord") {
      this.scoreInvader(monster, fighters);
      // Let it fall before it goes.
      this.clock.setTimeout(() => this.monsters.remove(monsterId), 2000);
    } else if (monster.elite === "rabbit" && rabbit?.monsterId === monsterId) {
      this.rabbitCaught(monsterId, monster, fighters);
    }
    const names: string[] = [];
    const gold = monsterGold(kind.level, Boolean(kind.boss));
    fighters.forEach((sessionId, index) => {
      const player = this.state.players.get(sessionId);
      const movement = this.movements.get(sessionId);
      const client = this.clients.find((c) => c.sessionId === sessionId);
      if (!player || !movement || !client) {
        return;
      }
      names.push(player.name);
      const xp = index === 0 ? monsterXp(kind) : Math.ceil(monsterXp(kind) / 2);
      const coins = index === 0 ? gold : Math.ceil(gold / 2);
      client.send("xp", { amount: xp });
      client.send("gold", { amount: coins, x: monster.x, y: monster.y });
      player.gold += coins;
      progress.saveInventory(movement.playerId, { gold: player.gold });
      // Each fighter rolls for their own drop, so helping is worth it too.
      this.dropGear(client, player, movement.playerId, kind.boss ? "boss" : "monster", kind.level, monster);
      this.levelChanged(player, movement.playerId, progress.addXp(movement.playerId, xp));
      this.recordKill(client, player, movement.playerId, monster.kind, Boolean(kind.boss));
    });

    if (kind.boss && names.length > 0) {
      this.sendChat({ from: "ระบบ", text: `🏆 ${names.join(", ")} ปราบ${kind.name}สำเร็จ!`, system: true });
    }
  }

  /** A monster's blow on a player, through the same shields as a player's. */
  private monsterHit(monsterId: string, sessionId: string, blow: number) {
    const target = this.state.players.get(sessionId);
    const movement = this.movements.get(sessionId);
    if (!target || !movement || target.dead || Date.now() < movement.shieldUntil || this.isSafe(target)) {
      return;
    }
    if (target.god) {
      this.broadcast("hit", { attacker: monsterId, target: sessionId, damage: 0, blocked: true } satisfies HitEvent);
      return;
    }

    const damage = this.guarded(target, blow);
    target.hp = Math.max(0, target.hp - damage);
    movement.lastHitAt = Date.now();
    const killed = target.hp === 0;
    this.broadcast("hit", { attacker: monsterId, target: sessionId, damage, killed } satisfies HitEvent);
    if (killed) {
      const monster = this.state.monsters.get(monsterId);
      this.defeat(sessionId, target, movement, undefined, undefined, monster && this.monsters.kind(monster).name);
    }
  }

  /**
   * The target falls; the winner, if any, gains experience.
   * A monster's victim has the monster's name and no winner; a GM's punishment has neither.
   */
  private defeat(
    targetId: string,
    target: Player,
    targetMovement: Movement,
    killer?: Player,
    killerMovement?: Movement,
    monsterName?: string,
  ) {
    target.hp = 0;
    target.dead = true;
    targetMovement.diedAt = Date.now();
    targetMovement.target = undefined;
    targetMovement.dirX = 0;
    targetMovement.dirY = 0;
    this.celebrate(targetMovement.playerId, progress.recordDeath(targetMovement.playerId));

    if (monsterName) {
      this.sendChat({ from: "ระบบ", text: `💀 ${target.name} ถูก${monsterName}ล้ม!`, system: true });
      return;
    }
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

  // ---- Coming back ----

  /** The first visit of the day brings the next gift of the streak. */
  private giveDailyGift(client: Client, player: Player, playerId: string) {
    const day = progress.claimDailyGift(playerId);
    if (day === 0) {
      return;
    }
    const gift = DAILY_GIFTS[day - 1];
    player.gold += gift.gold;
    player.potions = Math.min(POTION.max, player.potions + gift.potions);
    progress.saveInventory(playerId, { gold: player.gold, potions: player.potions });
    let gearName: string | undefined;
    if (gift.gear) {
      const found = rollGear(gift.gear, Math.max(5, player.level));
      if (found) {
        const { gear, sold } = progress.addGear(playerId, found);
        gearName = gear.name;
        if (sold) {
          player.gold += sold;
          progress.saveInventory(playerId, { gold: player.gold });
        }
        client.send("bag", progress.bag(playerId));
      }
    }
    client.send("daily-gift", { day, gearName } satisfies DailyGiftEvent);
  }

  // ---- The dungeon ----

  /**
   * The room a portal leads into: the dungeon is the team's own (or the player's, alone), and its
   * way out goes back to the world the player came from; every other portal stays in this world.
   */
  private partyBeyond(to: RegionId, playerId: string) {
    if (to === "dungeon") {
      beforeDungeon.set(playerId, this.party);
      return dungeonParty(teams.teamIdOf(playerId) || playerId);
    }
    if (this.regionId === "dungeon") {
      const back = beforeDungeon.get(playerId) ?? "";
      beforeDungeon.delete(playerId);
      return back;
    }
    return this.party;
  }

  /** A run won: everyone in the hall gets gold, experience and a fine piece of gear. */
  private dungeonCleared(bossKind: string) {
    const boss = monsterKind(bossKind)!;
    const heroes = [...this.movements].filter(([id]) => {
      const player = this.state.players.get(id);
      return player && !player.away;
    });
    for (const [sessionId, movement] of heroes) {
      const player = this.state.players.get(sessionId)!;
      const client = this.clients.find((c) => c.sessionId === sessionId);
      if (!client) {
        continue;
      }
      const gold = Math.round(150 * (1 + player.level / 4) * (1 + heroes.length * 0.15));
      const xp = monsterXp(boss);
      player.gold += gold;
      progress.saveInventory(movement.playerId, { gold: player.gold });
      client.send("gold", { amount: gold, x: player.x, y: player.y });
      client.send("xp", { amount: xp });
      this.levelChanged(player, movement.playerId, progress.addXp(movement.playerId, xp));
      // A rare piece or better for sure, and sometimes a second.
      this.dropGear(client, player, movement.playerId, "boss", boss.level, player);
      if (Math.random() < 0.4) {
        this.dropGear(client, player, movement.playerId, "boss", boss.level, player);
      }
      this.celebrate(movement.playerId, progress.recordDungeon(movement.playerId));
    }
    const names = heroes.map(([id]) => this.state.players.get(id)!.name).join(", ");
    this.sendChat({ from: "ระบบ", text: `🏆 ${names} ผ่านดันเจี้ยนสำเร็จ! รอบใหม่จะเริ่มในอีกครู่`, system: true });
  }

  // ---- The world boss ----

  /** Every few seconds: send the world boss away when its time is up, or bring the next one. */
  private static worldBossTick() {
    const now = Date.now();
    if (worldBoss) {
      if (now >= worldBoss.endsAt) {
        worldBoss.room.worldBossLeaves();
      }
      return;
    }
    if (now < nextWorldBossAt) {
      return;
    }
    // A public region with players if there is one, else a private room with players.
    // Never into a dungeon: it is the team's own fight.
    const busy = [...rooms].filter((room) => room.clients.length > 0 && room.regionId !== "dungeon");
    const choices = busy.some((room) => room.party === "") ? busy.filter((room) => room.party === "") : busy;
    if (choices.length === 0) {
      nextWorldBossAt = now + 60_000;
      return;
    }
    choices[Math.floor(Math.random() * choices.length)].summonWorldBoss();
  }

  /** Rooms of the same world as this one: the public world, or this private room's regions. */
  private sameWorld() {
    return [...rooms].filter((room) => room.party === this.party);
  }

  private worldBossEvent(): WorldBossEvent {
    const kind = monsterKind(WORLD_BOSS.kind)!;
    return { region: this.regionId, name: kind.name, leftMs: Math.max(0, (worldBoss?.endsAt ?? 0) - Date.now()) };
  }

  /** Brings the world boss here now, as big as the number of players in this world asks. */
  private summonWorldBoss() {
    const world = this.sameWorld();
    const players = world.reduce((count, room) => count + room.clients.length, 0);
    const hp = Math.max(WORLD_BOSS.minHp, WORLD_BOSS.hpPerPlayer * players);
    const monsterId = this.monsters.summon(WORLD_BOSS.kind, hp);
    worldBoss = { room: this, monsterId, endsAt: Date.now() + WORLD_BOSS.lastsMs };
    nextWorldBossAt = Date.now() + WORLD_BOSS.everyMs;
    const event = this.worldBossEvent();
    const minutes = Math.round(WORLD_BOSS.lastsMs / 60_000);
    for (const room of world) {
      room.broadcast("world-boss", event);
      room.sendChat({
        from: "ระบบ",
        text: `👹 บอสโลก ${event.name} บุกมาที่${this.region.name}แล้ว! ใครตีด้วยได้ของล้ำค่าทุกคน (อยู่ ${minutes} นาที)`,
        system: true,
      });
    }
  }

  private worldBossLeaves() {
    if (!worldBoss) {
      return;
    }
    this.monsters.remove(worldBoss.monsterId);
    worldBoss = undefined;
    const name = monsterKind(WORLD_BOSS.kind)!.name;
    for (const room of this.sameWorld()) {
      room.broadcast("world-boss-end", { beaten: false, name, top: [] } satisfies WorldBossEnd);
      room.sendChat({ from: "ระบบ", text: `🌑 ${name} หนีกลับไปแล้ว... รอรอบหน้า!`, system: true });
    }
  }

  /** Everyone who hit it gets gold, experience and a fine drop; the hardest hitter, a title too. */
  private worldBossDefeated(monsterId: string, monster: Monster, fighters: string[], damageBy: Map<string, number>) {
    worldBoss = undefined;
    const kind = this.monsters.kind(monster);
    const top: WorldBossEnd["top"] = [];
    fighters.forEach((sessionId, index) => {
      const player = this.state.players.get(sessionId);
      const movement = this.movements.get(sessionId);
      const client = this.clients.find((c) => c.sessionId === sessionId);
      if (!player || !movement || !client) {
        return;
      }
      if (top.length < 3) {
        top.push({ name: player.name, damage: damageBy.get(sessionId) ?? 0 });
      }
      const xp = index === 0 ? monsterXp(kind) : Math.ceil(monsterXp(kind) / 2);
      const coins = monsterGold(kind.level, true) * (index === 0 ? 3 : 1);
      client.send("xp", { amount: xp });
      client.send("gold", { amount: coins, x: monster.x, y: monster.y });
      player.gold += coins;
      progress.saveInventory(movement.playerId, { gold: player.gold });
      this.levelChanged(player, movement.playerId, progress.addXp(movement.playerId, xp));
      this.dropGear(client, player, movement.playerId, "world-boss", kind.level, monster);
      this.recordKill(client, player, movement.playerId, monster.kind, true);
      this.celebrate(movement.playerId, progress.recordWorldBoss(movement.playerId, index === 0));
    });
    // Let it fall before it goes.
    this.clock.setTimeout(() => this.monsters.remove(monsterId), 5000);

    const medals = ["🥇", "🥈", "🥉"];
    const ranking = top.map((entry, index) => `${medals[index]} ${entry.name} (${entry.damage.toLocaleString()})`).join("  ");
    for (const room of this.sameWorld()) {
      room.broadcast("world-boss-end", { beaten: true, name: kind.name, top } satisfies WorldBossEnd);
      room.sendChat({ from: "ระบบ", text: `🏆 ปราบบอสโลก ${kind.name} สำเร็จ! ${ranking}`, system: true });
    }
  }

  // ---- Timed events: the invasion and the golden rabbit ----

  /** Every second: warnings, the start, keeping the demons coming, the end; and the rabbit. */
  private static eventTick() {
    const now = Date.now();
    const busy = [...rooms].filter((room) => room.clients.length > 0 && room.regionId !== "dungeon");

    if (!invasion && now >= nextInvasion - INVASION.warnMs[0]) {
      invasion = { startsAt: nextInvasion, endsAt: nextInvasion + INVASION.lastsMs, warned: 0, started: false, lords: 0, scores: new Map() };
    }
    if (invasion) {
      const on = invasion;
      // One warning at a time, even when the server started late and several are due.
      let warn = false;
      while (on.warned < INVASION.warnMs.length && now >= on.startsAt - INVASION.warnMs[on.warned]) {
        on.warned++;
        warn = true;
      }
      if (warn && on.startsAt - now > 5000) {
        const minutes = Math.max(1, Math.round((on.startsAt - now) / 60_000));
        rooms.forEach((room) => room.sendChat({ from: "ระบบ", text: `😈 อีก ${minutes} นาที อสูรจะบุกทุกภาค! ล้มให้มากที่สุด ติด 3 อันดับแรกรับรางวัลใหญ่`, system: true }));
      }
      if (!on.started && now >= on.startsAt) {
        on.started = true;
        rooms.forEach((room) => room.sendChat({ from: "ระบบ", text: "😈 อสูรบุกแล้ว! 10 นาทีนี้ ล้มอสูรได้แต้ม · จอมอสูรได้ 10 แต้ม", system: true }));
      }
      if (on.started && now < on.endsAt) {
        for (const room of busy) {
          room.topUpInvaders();
        }
        while (on.lords < INVASION.lordAtMs.length && now >= on.startsAt + INVASION.lordAtMs[on.lords]) {
          on.lords++;
          busy.forEach((room) => room.summonLord());
        }
      }
      if (now >= on.endsAt) {
        WorldRoom.endInvasion(on);
        invasion = undefined;
        nextInvasion = naturalEvents ? nextInvasionAt(now + 1) : Infinity;
      } else if (now % 2000 < 1000) {
        rooms.forEach((room) => room.sendInvasionStatus());
      }
    }

    if (rabbit && now >= rabbit.endsAt) {
      rabbit.room.rabbitEscapes();
    } else if (!rabbit && now >= nextRabbitAt) {
      const choices = busy.some((room) => room.party === "") ? busy.filter((room) => room.party === "") : busy;
      if (choices.length === 0) {
        nextRabbitAt = now + 60_000;
      } else {
        choices[Math.floor(Math.random() * choices.length)].summonRabbit();
      }
    }
  }

  /** A free spot this far from a player, out of the safe zones; undefined when none was found. */
  private spotNear(player: Player, [near, far]: readonly [number, number]) {
    const { bounds } = this.region;
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = near + Math.random() * (far - near);
      const x = Math.min(bounds.maxX - 60, Math.max(bounds.minX + 60, player.x + Math.cos(angle) * distance));
      const y = Math.min(bounds.maxY - 60, Math.max(bounds.minY + 60, player.y + Math.sin(angle) * distance));
      if (!inSafeZone(this.regionId, x, y) && !isBlocked(this.layout, x, y, 30)) {
        return { x, y };
      }
    }
    return undefined;
  }

  /** Near a random player here (those out in the open first). */
  private spotNearSomeone(range: readonly [number, number]) {
    const players = [...this.state.players.values()].filter((player) => !player.dead && !player.away);
    const out = players.filter((player) => !inSafeZone(this.regionId, player.x, player.y));
    const pool = out.length > 0 ? out : players;
    for (let attempt = 0; attempt < 4 && pool.length > 0; attempt++) {
      const spot = this.spotNear(pool[Math.floor(Math.random() * pool.length)], range);
      if (spot) {
        return spot;
      }
    }
    return undefined;
  }

  private eventMonsters(...elites: string[]) {
    return [...this.state.monsters].filter(([, monster]) => elites.includes(monster.elite));
  }

  /** More demons, up to as many as the players here call for, a few at a time. */
  private topUpInvaders() {
    const alive = this.eventMonsters("invader").filter(([, monster]) => !monster.dead).length;
    const wanted = Math.min(INVASION.max, INVASION.base + INVASION.perPlayer * this.clients.length);
    const { kinds } = REGION_MONSTERS[this.regionId];
    for (let i = alive; i < wanted && i < alive + 3 && kinds.length > 0; i++) {
      const spot = this.spotNearSomeone(INVASION.spawnNear);
      if (!spot) {
        return;
      }
      const kindId = kinds[Math.floor(Math.random() * kinds.length)];
      const id = this.monsters.summonAt(kindId, Math.round(monsterMaxHp(monsterKind(kindId)!) * INVASION.hpScale), spot.x, spot.y, INVASION.aggro);
      this.state.monsters.get(id)!.elite = "invader";
    }
  }

  /** The region's boss, as a demon lord: far tougher, worth ten points. */
  private summonLord() {
    const lordKind = REGION_MONSTERS[this.regionId].boss;
    const spot = this.spotNearSomeone([350, 520]);
    if (!lordKind || !spot) {
      return;
    }
    const kind = monsterKind(lordKind)!;
    const id = this.monsters.summonAt(lordKind, Math.round(monsterMaxHp(kind) * INVASION.lordHpScale), spot.x, spot.y, INVASION.aggro);
    this.state.monsters.get(id)!.elite = "lord";
    this.sendChat({ from: "ระบบ", text: `👹 จอมอสูร ${kind.name} ปรากฏตัวที่${this.region.name}! ล้มได้ 10 แต้ม`, system: true });
  }

  /** A demon beaten: points for everyone who fought it, in this world's scores. */
  private scoreInvader(monster: Monster, fighters: string[]) {
    if (!invasion || Date.now() >= invasion.endsAt) {
      return;
    }
    let scores = invasion.scores.get(this.party);
    if (!scores) {
      scores = new Map();
      invasion.scores.set(this.party, scores);
    }
    fighters.forEach((sessionId, index) => {
      const movement = this.movements.get(sessionId);
      const player = this.state.players.get(sessionId);
      if (!movement || !player) {
        return;
      }
      const points = monster.elite === "lord" ? (index === 0 ? INVASION.lordPoints : 3) : INVASION.points;
      const entry = scores!.get(movement.playerId) ?? { name: player.name, score: 0 };
      entry.name = player.name;
      entry.score += points;
      scores!.set(movement.playerId, entry);
    });
  }

  private static ranking(party: string) {
    return [...(invasion?.scores.get(party) ?? new Map<string, { name: string; score: number }>())].sort((a, b) => b[1].score - a[1].score);
  }

  /** Each player's banner: when, the best of their world, their own score and place. */
  private sendInvasionStatus() {
    if (!invasion || this.regionId === "dungeon") {
      return;
    }
    const ranking = WorldRoom.ranking(this.party);
    const top = ranking.slice(0, 5).map(([, entry]) => ({ ...entry }));
    for (const client of this.clients) {
      const playerId = this.movements.get(client.sessionId)?.playerId;
      const index = ranking.findIndex(([id]) => id === playerId);
      client.send("invasion", {
        phase: invasion.started ? "on" : "soon",
        startsAt: invasion.startsAt,
        endsAt: invasion.endsAt,
        top,
        mine: index >= 0 ? ranking[index][1].score : 0,
        rank: index + 1,
      } satisfies InvasionStatus);
    }
  }

  /** The end: prizes for each world's best and for everyone who scored, and the demons go. */
  private static endInvasion(ended: NonNullable<typeof invasion>) {
    const prizes = new Map<string, string>();
    for (const [party, scores] of ended.scores) {
      const ranking = [...scores].sort((a, b) => b[1].score - a[1].score);
      ranking.forEach(([playerId, entry], index) => {
        const where = WorldRoom.sessionOf(playerId);
        if (!where) {
          return;
        }
        const prize = INVASION_PRIZES[index] ?? INVASION_SCORED.find((tier) => entry.score >= tier.from);
        if (prize) {
          prizes.set(playerId, where.room.givePrize(where.sessionId, prize, index === 0));
        }
      });
      const medals = ["🥇", "🥈", "🥉"];
      const podium = ranking.slice(0, 3).map(([, entry], index) => `${medals[index]} ${entry.name} (${entry.score})`).join("  ");
      for (const room of rooms) {
        if (room.party === party && podium) {
          room.sendChat({ from: "ระบบ", text: `🏆 อสูรบุกจบแล้ว! ${podium}`, system: true });
        }
      }
    }
    for (const room of rooms) {
      for (const [id] of room.eventMonsters("invader", "lord")) {
        room.monsters.remove(id);
      }
      const ranking = [...(ended.scores.get(room.party) ?? new Map<string, { name: string; score: number }>())].sort(
        (a, b) => b[1].score - a[1].score,
      );
      const top = ranking.slice(0, 5).map(([, entry]) => ({ ...entry }));
      for (const client of room.clients) {
        const playerId = room.movements.get(client.sessionId)?.playerId ?? "";
        const index = ranking.findIndex(([id]) => id === playerId);
        client.send("invasion-end", {
          top,
          mine: index >= 0 ? ranking[index][1].score : 0,
          rank: index + 1,
          prize: prizes.get(playerId) ?? "",
        } satisfies InvasionEnd);
      }
    }
  }

  /** Pays a prize to a player here (gold grows with their level); returns it as text. */
  private givePrize(sessionId: string, prize: { gold: number; potions: number; gear?: "boss" }, champion: boolean) {
    const player = this.state.players.get(sessionId);
    const movement = this.movements.get(sessionId);
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!player || !movement || !client) {
      return "";
    }
    const { gold, potions } = questReward(prize, player.level);
    player.gold += gold;
    player.potions = Math.min(POTION.max, player.potions + potions);
    progress.saveInventory(movement.playerId, { gold: player.gold, potions: player.potions });
    client.send("gold", { amount: gold, x: player.x, y: player.y });
    if (prize.gear) {
      this.dropGear(client, player, movement.playerId, prize.gear, Math.max(5, player.level), player);
    }
    if (champion) {
      this.celebrate(movement.playerId, progress.recordInvasionWin(movement.playerId));
    }
    return [rewardText({ gold, potions }), prize.gear && "ของหายาก"].filter(Boolean).join(" + ");
  }

  private summonRabbit() {
    const spot = this.spotNearSomeone([380, 600]);
    if (!spot) {
      nextRabbitAt = naturalEvents ? Date.now() + 30_000 : Infinity;
      return;
    }
    const hp = GOLD_RABBIT.hp + GOLD_RABBIT.hpPerPlayer * this.clients.length;
    const monsterId = this.monsters.summonFleeing(GOLD_RABBIT.kind, hp, spot.x, spot.y, GOLD_RABBIT.fleeFrom, GOLD_RABBIT.speed);
    this.state.monsters.get(monsterId)!.elite = "rabbit";
    rabbit = { room: this, monsterId, endsAt: Date.now() + GOLD_RABBIT.lastsMs };
    nextRabbitAt = naturalEvents
      ? Date.now() + GOLD_RABBIT.everyMs[0] + Math.random() * (GOLD_RABBIT.everyMs[1] - GOLD_RABBIT.everyMs[0])
      : Infinity;
    const event = { region: this.regionId, leftMs: GOLD_RABBIT.lastsMs } satisfies GoldRabbitEvent;
    for (const room of this.sameWorld()) {
      room.broadcast("gold-rabbit", event);
      room.sendChat({
        from: "ระบบ",
        text: `✨ กระต่ายทองคำโผล่ที่${this.region.name}! ตีได้เหรียญทุกครั้ง จับได้รับแจ็กพอต (${GOLD_RABBIT.lastsMs / 1000} วิ)`,
        system: true,
      });
    }
  }

  private rabbitEscapes() {
    if (!rabbit) {
      return;
    }
    this.monsters.remove(rabbit.monsterId);
    rabbit = undefined;
    for (const room of this.sameWorld()) {
      room.broadcast("gold-rabbit-end", {});
      room.sendChat({ from: "ระบบ", text: "🐰 กระต่ายทองคำวิ่งหนีไปแล้ว... รอบหน้าต้องไวกว่านี้!", system: true });
    }
  }

  /** Caught: the jackpot for the one who hit it most, a third for everyone else who hit it. */
  private rabbitCaught(monsterId: string, monster: Monster, fighters: string[]) {
    rabbit = undefined;
    const names: string[] = [];
    fighters.forEach((sessionId, index) => {
      const player = this.state.players.get(sessionId);
      const movement = this.movements.get(sessionId);
      const client = this.clients.find((c) => c.sessionId === sessionId);
      if (!player || !movement || !client) {
        return;
      }
      names.push(player.name);
      const { gold } = questReward({ gold: index === 0 ? GOLD_RABBIT.jackpot : Math.round(GOLD_RABBIT.jackpot / 3), potions: 0 }, player.level);
      player.gold += gold;
      progress.saveInventory(movement.playerId, { gold: player.gold });
      client.send("gold", { amount: gold, x: monster.x, y: monster.y });
      if (index === 0) {
        this.celebrate(movement.playerId, progress.recordGoldRabbit(movement.playerId));
      }
    });
    this.clock.setTimeout(() => this.monsters.remove(monsterId), 2000);
    for (const room of this.sameWorld()) {
      room.broadcast("gold-rabbit-end", {});
      if (names.length > 0) {
        room.sendChat({ from: "ระบบ", text: `🐰💰 ${names[0]} จับกระต่ายทองคำได้ที่${this.region.name}! รับแจ็กพอตไปเลย`, system: true });
      }
    }
  }

  // ---- Gear from monsters ----

  /** Rolls a drop for one player; a find shows as a beam of its colour where the monster fell. */
  private dropGear(client: Client, player: Player, playerId: string, source: DropSource, level: number, at: { x: number; y: number }) {
    const found = rollGear(source, level);
    if (!found) {
      return;
    }
    const { gear, sold } = progress.addGear(playerId, found);
    if (sold) {
      player.gold += sold;
      progress.saveInventory(playerId, { gold: player.gold });
    }
    this.broadcast("loot", { by: client.sessionId, x: at.x, y: at.y, rarity: gear.rarity, name: gear.name, sold } satisfies LootEvent);
    client.send("bag", progress.bag(playerId));
    if (gear.rarity >= LEGENDARY - 1) {
      this.sendChat({
        from: "ระบบ",
        text: `${gear.rarity === LEGENDARY ? "🌟" : "💜"} ${player.name} ได้รับ「${gear.name}」ระดับ${RARITIES[gear.rarity].name}!`,
        system: true,
      });
    }
  }

  /** A monster beaten, in the quests, titles and collection book; a completed kind pays out. */
  private recordKill(client: Client, player: Player, playerId: string, kindId: string, boss: boolean) {
    const { achievements, completed } = progress.recordMonsterKill(playerId, kindId, boss);
    this.celebrate(playerId, achievements);
    const kind = monsterKind(kindId);
    if (completed && kind) {
      const gold = codexReward(kind);
      player.gold += gold;
      progress.saveInventory(playerId, { gold: player.gold });
      client.send("gold", { amount: gold, x: player.x, y: player.y });
      client.send("notice", { text: `📖 สมุดสะสม: ${kind.name} ครบแล้ว! +${gold.toLocaleString()} ทอง`, ok: true });
    }
  }

  /** One try at enhancing a piece of gear: gold paid either way, the result shown to everyone near. */
  private enhance(client: Client, gearId: string) {
    const player = this.state.players.get(client.sessionId);
    const movement = this.movements.get(client.sessionId);
    if (!player || !movement) {
      return;
    }
    const outcome = progress.enhanceGear(movement.playerId, gearId, player.gold);
    const notice = (text: string, ok: boolean) => client.send("notice", { text, ok });
    if (outcome.result === "missing") {
      return;
    }
    if (outcome.result === "max") {
      notice("ตีบวกสูงสุด +10 แล้ว", false);
      return;
    }
    if (outcome.result === "poor") {
      notice(`ทองไม่พอ ต้องใช้ ${outcome.cost.toLocaleString()} ทอง`, false);
      return;
    }
    player.gold -= outcome.cost;
    progress.saveInventory(movement.playerId, { gold: player.gold });
    this.celebrate(movement.playerId, progress.recordEnhance(movement.playerId));
    const { gear } = outcome;
    const plus = gear.plus ?? 0;
    this.broadcast("enhance", { by: client.sessionId, ok: outcome.result === "done", plus, rarity: gear.rarity });
    if (outcome.result === "done") {
      notice(`ตีบวกสำเร็จ! ${gear.name} +${plus}`, true);
      if (plus >= 7) {
        this.sendChat({ from: "ระบบ", text: `⚒ ${player.name} ตีบวก「${gear.name}」สำเร็จเป็น +${plus}!`, system: true });
      }
    } else {
      notice(plus < outcome.before ? `ตีบวกพลาด! ${gear.name} ลดลงเหลือ +${plus}` : `ตีบวกพลาด! ${gear.name} ยังเป็น +${plus}`, false);
    }
    // Worn gear changes the hero's power and health at once.
    const share = player.hp / player.maxHp;
    this.applyLevel(player, movement.playerId);
    if (!player.dead) {
      player.hp = Math.max(1, Math.round(player.maxHp * share));
    }
    client.send("bag", progress.bag(movement.playerId));
  }

  private changeGear(client: Client, change: "wear" | "off" | "sell", what: string) {
    const player = this.state.players.get(client.sessionId);
    const movement = this.movements.get(client.sessionId);
    if (!player || !movement) {
      return;
    }
    const { playerId } = movement;
    if (change === "wear") {
      if (!progress.wearGear(playerId, what)) {
        return;
      }
      this.broadcast("upgrade", { id: client.sessionId });
    } else if (change === "off") {
      if (what !== "weapon" && what !== "charm") {
        return;
      }
      progress.takeOffGear(playerId, what);
    } else {
      const price = progress.sellGear(playerId, what);
      if (price === 0) {
        return;
      }
      player.gold += price;
      progress.saveInventory(playerId, { gold: player.gold });
      client.send("notice", { text: `ขายได้ ${price} ทอง`, ok: true });
    }
    // A charm changes the health bar: keep the share of health the player had.
    const share = player.hp / player.maxHp;
    this.applyLevel(player, playerId);
    if (!player.dead) {
      player.hp = Math.max(1, Math.round(player.maxHp * share));
    }
    client.send("bag", progress.bag(playerId));
  }

  // ---- Shop and potions ----

  private buy(client: Client, item: ShopItem, count: number) {
    const player = this.state.players.get(client.sessionId);
    const movement = this.movements.get(client.sessionId);
    if (!player || !movement) {
      return;
    }
    const notice = (text: string, ok: boolean) => client.send("notice", { text, ok });

    if (item === "potion") {
      const wanted = Math.max(1, Math.min(Math.floor(count), POTION.max - player.potions));
      const cost = wanted * POTION.price;
      if (player.potions >= POTION.max) {
        notice(`พกยาได้สูงสุด ${POTION.max} ขวด`, false);
      } else if (player.gold < cost) {
        notice(`ทองไม่พอ ต้องใช้ ${cost} ทอง`, false);
      } else {
        player.gold -= cost;
        player.potions += wanted;
        notice(`ซื้อ${POTION.name} ${wanted} ขวด`, true);
      }
    } else {
      const tiers = item === "weapon" ? WEAPON_TIERS : ARMOR_TIERS;
      const next = tiers[player[item] + 1];
      if (!next) {
        notice("อัปเกรดสูงสุดแล้ว", false);
      } else if (player.gold < next.price) {
        notice(`ทองไม่พอ ต้องใช้ ${next.price} ทอง`, false);
      } else {
        player.gold -= next.price;
        player[item] += 1;
        if (item === "armor") {
          const before = player.maxHp;
          this.applyLevel(player, movement.playerId);
          player.hp = Math.min(player.maxHp, player.hp + (player.maxHp - before));
        }
        notice(`ได้รับ ${next.name}!`, true);
        this.broadcast("upgrade", { id: client.sessionId });
      }
    }
    const { gold, potions, weapon, armor } = player;
    progress.saveInventory(movement.playerId, { gold, potions, weapon, armor });
  }

  private drinkPotion(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const movement = this.movements.get(sessionId);
    const now = Date.now();
    if (!player || !movement || player.dead || player.potions <= 0 || now < movement.potionReadyAt) {
      return;
    }
    // Not wasted on a full bar.
    if (player.hp >= player.maxHp) {
      this.clients.find((c) => c.sessionId === sessionId)?.send("notice", { text: "เลือดเต็มอยู่แล้ว", ok: false });
      return;
    }
    movement.potionReadyAt = now + POTION.cooldownMs;
    player.potions -= 1;
    const amount = Math.min(player.maxHp - player.hp, Math.round(player.maxHp * POTION.heal));
    player.hp += amount;
    progress.saveInventory(movement.playerId, { potions: player.potions });
    this.broadcast("potion", { by: sessionId, amount });
  }

  // ---- Wings and mounts ----

  private buyCosmetic(client: Client, kind: CosmeticKind, index: number) {
    const player = this.state.players.get(client.sessionId);
    const movement = this.movements.get(client.sessionId);
    const item = cosmeticList(kind)[index];
    if (!player || !movement || !item || index <= 0) {
      return;
    }
    const owned = progress.wardrobe(movement.playerId)[kind === "wing" ? "wings" : "mounts"];
    if (owned.includes(index)) {
      this.equipCosmetic(client, kind, index);
      return;
    }
    if (player.gold < item.price) {
      client.send("notice", { text: `ทองไม่พอ ต้องใช้ ${item.price.toLocaleString()} ทอง`, ok: false });
      return;
    }
    player.gold -= item.price;
    progress.addToWardrobe(movement.playerId, kind, index);
    progress.saveInventory(movement.playerId, { gold: player.gold });
    client.send("notice", { text: `ได้รับ ${item.name}!`, ok: true });
    this.broadcast("upgrade", { id: client.sessionId });
    this.equipCosmetic(client, kind, index);
  }

  /** Puts on owned wings, or picks the mount to ride (0 takes them off). */
  private equipCosmetic(client: Client, kind: CosmeticKind, index: number) {
    const player = this.state.players.get(client.sessionId);
    const movement = this.movements.get(client.sessionId);
    if (!player || !movement) {
      return;
    }
    const owned = progress.wardrobe(movement.playerId)[kind === "wing" ? "wings" : "mounts"];
    if (!owned.includes(index)) {
      return;
    }
    if (kind === "wing") {
      player.wing = index;
    } else {
      player.mount = index;
      player.riding = index > 0;
    }
    progress.saveInventory(movement.playerId, { [kind]: index });
    client.send("wardrobe", progress.wardrobe(movement.playerId));
  }

  // ---- Teams ----

  /** The room and session where a player is now, if they're in the game. */
  private static sessionOf(playerId: string) {
    for (const room of rooms) {
      for (const [sessionId, movement] of room.movements) {
        if (movement.playerId === playerId) {
          return { room, sessionId };
        }
      }
    }
    return undefined;
  }

  // ---- Safety ----

  /** Someone here no longer bothers this player: their chat, team invites and voice stay away. */
  private block(client: Client, targetSession: string) {
    const movement = this.movements.get(client.sessionId);
    const target = this.movements.get(targetSession);
    const name = this.state.players.get(targetSession)?.name;
    if (!movement || !target || targetSession === client.sessionId) {
      return;
    }
    if (progress.block(movement.playerId, target.playerId)) {
      client.send("blocked", progress.blockedNames(movement.playerId));
      client.send("notice", { text: `บล็อก ${name} แล้ว จะไม่เห็นแชทและคำชวนของเขาอีก · เลิกบล็อกได้ในตั้งค่า`, ok: true });
    }
  }

  private report(client: Client, targetSession: string, reason: unknown, note: unknown) {
    const movement = this.movements.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    const target = this.movements.get(targetSession);
    const targetPlayer = this.state.players.get(targetSession);
    const why = REPORT_REASONS.find((known) => known === reason);
    if (!movement || !player || !target || !targetPlayer || !why || targetSession === client.sessionId) {
      return;
    }
    const filed = fileReport({
      reporterId: movement.playerId,
      reporter: player.name,
      targetId: target.playerId,
      target: targetPlayer.name,
      reason: why,
      note: cleanText(note, 100),
      region: this.region.name,
      chats: [...target.recentChats],
    });
    const notice = (text: string, ok: boolean) => client.send("notice", { text, ok });
    if (filed.result === "again") {
      notice("รายงานผู้เล่นคนนี้ไปแล้ว GM จะตรวจสอบให้", true);
      return;
    }
    if (filed.result === "busy") {
      notice("รายงานบ่อยเกินไป ลองใหม่ภายหลัง", false);
      return;
    }
    notice(`ส่งรายงาน ${targetPlayer.name} ถึง GM แล้ว ขอบคุณที่ช่วยดูแลเกม`, true);
    if (filed.mute && !progress.mutedUntil(target.playerId)) {
      progress.mute(target.playerId, AUTO_MUTE_MINUTES);
      const targetClient = this.clients.find((c) => c.sessionId === targetSession);
      if (targetClient) {
        this.tell(targetClient, `🔇 มีผู้เล่นหลายคนรายงานคุณ แชทถูกปิด ${AUTO_MUTE_MINUTES} นาที · กรุณาเล่นอย่างสุภาพ`);
      }
    }
    WorldRoom.tellGms(`📣 รายงานใหม่: ${targetPlayer.name} (${why}) โดย ${player.name} · ดูในแผง GM`);
  }

  /** A line for every GM online, wherever they are. */
  private static tellGms(text: string) {
    for (const room of rooms) {
      for (const [sessionId, movement] of room.movements) {
        const client = room.clients.find((c) => c.sessionId === sessionId);
        if (client && progress.profile(movement.playerId).gm) {
          room.tell(client, text);
        }
      }
    }
  }

  private static gmReports(): GmReport[] {
    return openReports().map((report) => ({
      id: report.id,
      at: report.at,
      reporter: report.reporter,
      target: report.target,
      reason: report.reason,
      note: report.note,
      region: report.region,
      chats: report.chats,
      count: report.count,
      mutedUntil: progress.mutedUntil(report.targetId),
    }));
  }

  private actOnReport(client: Client, message: Extract<GmAction, { id: string }>) {
    const id = String(message.id);
    const target = reportTarget(id);
    const why = openReports().find((report) => report.id === id)?.reason ?? "";
    const done = (text: string) => {
      this.tell(client, `[GM] ${text}`);
      client.send("gm-reports", WorldRoom.gmReports());
    };
    if (!target) {
      done("ไม่พบรายงานนี้ (อาจถูกปิดไปแล้ว)");
      return;
    }
    const name = target.name || progress.nameOf(target.id);
    switch (message.action) {
      case "report-close":
        closeReport(id, Boolean(message.all));
        done(message.all ? `ปิดทุกรายงานของ ${name} แล้ว` : "ปิดรายงานแล้ว");
        return;
      case "report-mute":
        progress.mute(target.id, 60);
        done(`ปิดแชท ${name} 1 ชั่วโมงแล้ว`);
        return;
      case "report-unmute":
        progress.unmute(target.id);
        done(`เปิดแชทให้ ${name} แล้ว`);
        return;
      case "report-ban": {
        if (progress.profile(target.id).gm) {
          done("แบน GM ไม่ได้");
          return;
        }
        const days = Number(message.days) > 0 ? Math.min(Number(message.days), PERMANENT_BAN_DAYS) : PERMANENT_BAN_DAYS;
        const reason = `ถูกรายงาน: ${why}`;
        const until = progress.ban(target.id, days, reason);
        // Online now: out they go.
        const where = WorldRoom.sessionOf(target.id);
        const targetClient = where?.room.clients.find((c) => c.sessionId === where.sessionId);
        const targetMovement = where?.room.movements.get(where.sessionId);
        if (targetClient && targetMovement) {
          targetClient.send("removed", { text: banText({ until, reason }) });
          targetMovement.removed = true;
          targetClient.leave(4003);
        }
        closeReport(id, true);
        done(`แบน ${name} ${days === PERMANENT_BAN_DAYS ? "ถาวร" : `${days} วัน`} แล้ว`);
        return;
      }
    }
  }

  private teamInvite(client: Client, targetSession: string) {
    const movement = this.movements.get(client.sessionId);
    const target = this.movements.get(targetSession);
    const player = this.state.players.get(client.sessionId);
    const targetClient = this.clients.find((c) => c.sessionId === targetSession);
    if (!movement || !target || !player || !targetClient) {
      return;
    }
    if (progress.blocks(target.playerId, movement.playerId)) {
      client.send("notice", { text: `ส่งคำชวนให้ ${this.state.players.get(targetSession)?.name} แล้ว`, ok: true });
      return;
    }
    const problem = teams.invite(movement.playerId, target.playerId);
    if (problem) {
      client.send("notice", { text: problem, ok: false });
      return;
    }
    targetClient.send("team-invite", { from: player.name });
    client.send("notice", { text: `ส่งคำชวนให้ ${this.state.players.get(targetSession)?.name} แล้ว`, ok: true });
  }

  private teamAnswer(client: Client, yes: boolean) {
    const movement = this.movements.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!movement || !player) {
      return;
    }
    if (!yes) {
      const from = teams.decline(movement.playerId);
      const inviter = from ? WorldRoom.sessionOf(from) : undefined;
      inviter?.room.clients.find((c) => c.sessionId === inviter.sessionId)?.send("notice", { text: `${player.name} ปฏิเสธคำชวน`, ok: false });
      return;
    }
    const result = teams.accept(movement.playerId);
    if ("error" in result) {
      client.send("notice", { text: result.error, ok: false });
      return;
    }
    this.teamChanged([...teams.teamMembers(result.team), ...result.left], []);
  }

  /** Writes each member's team onto their player, wherever they are; `gone` lose theirs. */
  private teamChanged(stillIn: string[], gone: string[]) {
    for (const playerId of [...stillIn, ...gone]) {
      const where = WorldRoom.sessionOf(playerId);
      const player = where?.room.state.players.get(where.sessionId);
      if (player) {
        player.team = teams.teamIdOf(playerId);
        // No team any more: the status each second skips them, so say it now (the team panel,
        // frames and voice go away).
        if (!player.team) {
          where!.room.clients.find((c) => c.sessionId === where!.sessionId)?.send("team", []);
        }
      }
    }
    // The new team shows at once, not with the next status a second later.
    rooms.forEach((room) => room.sendTeamStatus());
  }

  /** Passes a voice connection message to a teammate, wherever they are; nobody else is reachable. */
  private passVoiceSignal(client: Client, message: { to?: unknown; data?: unknown }) {
    const from = this.movements.get(client.sessionId)?.playerId;
    const to = voice.playerOf(message?.to);
    const team = from && teams.teamIdOf(from);
    // Teammates only, and only while one of the two talks: a listener needs a link too.
    if (!from || !to || !team || teams.teamIdOf(to) !== team || !(voice.isTalking(from) || voice.isTalking(to))) {
      return;
    }
    if (progress.blocks(from, to) || progress.blocks(to, from)) {
      return;
    }
    if (JSON.stringify(message.data ?? null).length > voice.MAX_SIGNAL_LENGTH) {
      return;
    }
    const where = WorldRoom.sessionOf(to);
    where?.room.clients
      .find((c) => c.sessionId === where.sessionId)
      ?.send("voice-signal", { from: voice.tagOf(from), data: message.data });
  }

  /** Each player in a team hears how their teammates are doing, wherever they are. */
  private sendTeamStatus() {
    for (const [sessionId, player] of this.state.players) {
      if (!player.team) {
        continue;
      }
      const client = this.clients.find((c) => c.sessionId === sessionId);
      const mine = this.movements.get(sessionId)?.playerId;
      const list = teams.teamMembers(player.team).map((playerId) => {
        const where = WorldRoom.sessionOf(playerId);
        const mate = where?.room.state.players.get(where.sessionId);
        return mate
          ? {
              me: playerId === mine,
              voice: voice.tagOf(playerId),
              talking: voice.isTalking(playerId) && !mate.away,
              name: mate.name,
              level: mate.level,
              hp: mate.hp,
              maxHp: mate.maxHp,
              dead: mate.dead,
              region: where!.room.region.name,
              online: true,
            }
          : {
              me: false,
              voice: voice.tagOf(playerId),
              talking: false,
              name: progress.summary(playerId).name || "ผู้เล่น",
              level: 0,
              hp: 0,
              maxHp: 1,
              dead: false,
              region: "",
              online: false,
            };
      });
      client?.send("team", list);
    }
  }

  // ---- Commands and GM ----

  private runCommand(client: Client, movement: Movement, player: Player, text: string) {
    const [command, ...args] = text.split(/\s+/);
    if (command === "/gm") {
      // Counted by address and by player: leaving and coming back does not reset it.
      const keys = [`ip:${(client.auth as { ip?: string } | undefined)?.ip ?? ""}`, `id:${movement.playerId}`];
      const now = Date.now();
      if (keys.some((key) => (gmFailures.get(key)?.lockedUntil ?? 0) > now)) {
        this.tell(client, "ลองรหัส GM ผิดหลายครั้งเกินไป รอ 15 นาทีแล้วลองใหม่");
        return;
      }
      if (!isGmKey(args.join(" "))) {
        for (const key of keys) {
          const entry = gmFailures.get(key) ?? { count: 0, lockedUntil: 0 };
          entry.count++;
          if (entry.count >= MAX_GM_TRIES) {
            entry.count = 0;
            entry.lockedUntil = now + GM_LOCK_MS;
          }
          gmFailures.set(key, entry);
        }
        this.tell(client, "รหัส GM ไม่ถูกต้อง");
        return;
      }
      keys.forEach((key) => gmFailures.delete(key));

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
                region: room.party ? `${room.region.name} · ห้อง ${room.party}` : room.region.name,
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
      case "errors":
        client.send("gm-errors", errorGroups());
        return;
      case "errors-clear":
        clearErrors();
        client.send("gm-errors", errorGroups());
        return;
      case "reports":
        client.send("gm-reports", WorldRoom.gmReports());
        return;
      case "invasion":
        if (invasion?.started) {
          // On already: the same button ends it now, prizes and all.
          invasion.endsAt = Date.now();
          done("จบอสูรบุกแล้ว แจกรางวัลตามอันดับ");
          return;
        }
        // Soon, with a short warning.
        nextInvasion = Date.now() + 10_000;
        invasion = { startsAt: nextInvasion, endsAt: nextInvasion + INVASION.lastsMs, warned: INVASION.warnMs.length, started: false, lords: 0, scores: new Map() };
        rooms.forEach((room) => room.sendChat({ from: "ระบบ", text: "😈 GM เรียกอสูร! อีก 10 วินาทีอสูรจะบุกทุกภาค", system: true }));
        done("อสูรจะบุกใน 10 วินาที");
        return;
      case "rabbit":
        if (rabbit) {
          done(`มีกระต่ายทองคำอยู่แล้วที่${rabbit.room.region.name}`);
          return;
        }
        this.summonRabbit();
        done("ปล่อยกระต่ายทองคำแล้ว");
        return;
      case "report-close":
      case "report-ban":
      case "report-mute":
      case "report-unmute":
        this.actOnReport(client, message);
        return;
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
      case "gold": {
        const amount = Math.round(Number(message.amount));
        if (!Number.isFinite(amount) || amount === 0) {
          return;
        }
        target.gold = clamp(target.gold + amount, 0, 999_999_999);
        progress.saveInventory(targetMovement.playerId, { gold: target.gold });
        targetClient.send("gold", { amount, x: target.x, y: target.y });
        done(`${target.name}: ทอง ${amount > 0 ? "+" : ""}${amount.toLocaleString()} (รวม ${target.gold.toLocaleString()})`);
        return;
      }
      case "potions": {
        const amount = Math.round(Number(message.amount));
        if (!Number.isFinite(amount) || amount === 0) {
          return;
        }
        target.potions = clamp(target.potions + amount, 0, POTION.max);
        progress.saveInventory(targetMovement.playerId, { potions: target.potions });
        done(`${target.name}: ยาเลือด ${target.potions} ขวด`);
        return;
      }
      case "cosmetics": {
        // Every wing and mount, wearing the best of each.
        WINGS.forEach((_, index) => progress.addToWardrobe(targetMovement.playerId, "wing", index));
        MOUNTS.forEach((_, index) => progress.addToWardrobe(targetMovement.playerId, "mount", index));
        target.wing = WINGS.length - 1;
        target.mount = MOUNTS.length - 1;
        // Up in the saddle, as choosing a mount in the shop does.
        target.riding = !target.dead;
        progress.saveInventory(targetMovement.playerId, { wing: target.wing, mount: target.mount });
        targetClient.send("wardrobe", progress.wardrobe(targetMovement.playerId));
        done(`${target.name}: ได้ปีกและสัตว์ขี่ครบทุกแบบ`);
        return;
      }
      case "worldboss": {
        if (worldBoss) {
          done(`มีบอสโลกอยู่แล้วที่${worldBoss.room.region.name}`);
        } else {
          room.summonWorldBoss();
          done(`เรียกบอสโลกมาที่${room.region.name}แล้ว`);
        }
        return;
      }
      case "gear": {
        // A world boss's prize, dropped at the player's feet.
        room.dropGear(targetClient, target, targetMovement.playerId, "world-boss", target.level, target);
        done(`${target.name}: ได้ของดรอประดับล้ำค่าขึ้นไป 1 ชิ้น`);
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
        targetMovement.removed = true;
        targetClient.leave(4000);
        done(`เตะ ${target.name} ออกแล้ว`);
        return;
      case "ban": {
        if (targetId === client.sessionId) {
          done("แบนตัวเองไม่ได้");
          return;
        }
        const days = Number(message.days) > 0 ? Math.min(Number(message.days), PERMANENT_BAN_DAYS) : PERMANENT_BAN_DAYS;
        const reason = cleanText(message.reason, 80);
        const until = progress.ban(targetMovement.playerId, days, reason);
        targetClient.send("removed", { text: banText({ until, reason }) });
        targetMovement.removed = true;
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
    // Into the destination's room, which may be another party's.
    client.send("travel", { to: destination.regionId, from: this.regionId, party: destination.party });
  }

  // ---- Simulation ----

  private update(deltaMs: number) {
    const baseStep = (PLAYER_SPEED * deltaMs) / 1000;
    const { bounds, portals } = this.region;
    const flushSteps = ++this.ticks % STEP_FLUSH_TICKS === 0;
    if (flushSteps) {
      this.sendTeamStatus();
    }
    const now = Date.now();
    this.monsters.update(deltaMs);
    this.dungeon?.tick(now);
    this.updateProjectiles(deltaMs);

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

      // Class skills wear off.
      if (player.guarded && now >= movement.guardUntil) {
        player.guarded = false;
      }
      if (player.rage && now >= movement.rageUntil) {
        player.rage = false;
      }
      const step = baseStep * (player.riding ? (MOUNTS[player.mount]?.speed ?? 1) : 1) * (player.rage ? BERSERK_SPEED : 1);

      // A safe zone is a place to rest: health comes back three times as fast, at once.
      const safe = this.isSafe(player);
      if (player.hp < player.maxHp && (safe || now - movement.lastHitAt > REGEN_DELAY_MS)) {
        movement.regen += (player.maxHp * REGEN_PER_SECOND * (safe ? 3 : 1) * deltaMs) / 1000;
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

      // The way the player looks: where a swing or a lightning strike lands.
      const length = Math.hypot(dx, dy);
      movement.facingX = dx / length;
      movement.facingY = dy / length;

      const moved = slide(this.layout, player.x, player.y, dx, dy);
      const x = clamp(moved.x, bounds.minX, bounds.maxX);
      const y = clamp(moved.y, bounds.minY, bounds.maxY);
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
        this.clients
          .find((c) => c.sessionId === sessionId)
          ?.send("travel", { to: portal.to, from: this.regionId, party: this.partyBeyond(portal.to, movement.playerId) });
      }
    });
  }
}
