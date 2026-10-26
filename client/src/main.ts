import "./style.css";
import { Client, type Room } from "colyseus.js";
import { type ChatMessage, cleanPartyCode, PARTY_ALPHABET, PARTY_CODE_LENGTH, RECONNECT_SECONDS, ROOM_NAME, SERVER_PORT } from "../../shared/world.ts";
import { heroOf, HEROES, type ShotEvent } from "../../shared/heroes.ts";
import { isRegionId, REGIONS, type RegionId, START_REGION } from "../../shared/regions.ts";
import { type Achievement, type ProgressView, type QuestState, rewardText, thaiDay } from "../../shared/quests.ts";
import { type GmReport, REPORT_REASONS } from "../../shared/safety.ts";
import type { GoldRabbitEvent, InvasionEnd, InvasionStatus } from "../../shared/events.ts";
import { decorateTitle, findTitle, type Title, TITLES } from "../../shared/titles.ts";
import { regionModels, type SelfState, World3D } from "./three/World3D.ts";
import { preload } from "./three/assets.ts";
import { Voice } from "./voice.ts";
import { stopMusic } from "./three/music.ts";
import { play } from "./three/sfx.ts";
import { changeSettings, onSettings, type Quality } from "./settings.ts";
import { ARMOR_TIERS, POTION, type ShopItem, WEAPON_TIERS } from "../../shared/items.ts";
import { type CosmeticKind, MOUNTS, type Wardrobe, WINGS } from "../../shared/cosmetics.ts";
import type { WorldBossEnd, WorldBossEvent } from "../../shared/monsters.ts";
import { type BoardId, BOARDS, DAILY_GIFTS, type DailyGiftEvent, type Leaderboards } from "../../shared/rewards.ts";
import {
  BAG_SIZE,
  type BagView,
  GEAR_NAMES_BY_RARITY,
  enhanceChance,
  enhanceCost,
  ENHANCE_RISKY_FROM,
  type Gear,
  gearEffect,
  gearName,
  type GearSlot,
  type LootEvent,
  MAX_PLUS,
  RARITIES,
  sellPrice,
} from "../../shared/loot.ts";
import { HeroPicker } from "./three/HeroPicker.ts";
import { startErrorReports } from "./errors.ts";
import { BUZZ, buzz } from "./haptics.ts";
import { applyIcons, setIcon } from "./icons.ts";
import { CODEX_KINDS, CODEX_PAGES, codexGoal, codexReward, type CodexView } from "../../shared/codex.ts";
import type { DungeonStatus } from "../../shared/dungeon.ts";
import { monsterKind } from "../../shared/monsters.ts";
import { ULTIMATES, type UltimateEvent } from "../../shared/ultimates.ts";
import type { ErrorGroup } from "../../shared/errors.ts";
import { RESPAWN_MS, type HitEvent, isSkillId, SKILLS, type SkillId, xpToNext } from "../../shared/combat.ts";
import { BAN_DAYS, type GmAction, type GmList, type GmPlayer } from "../../shared/gm.ts";

const NAME_KEY = "mu-sky.name";
const SKIN_KEY = "mu-sky.skin";
const ID_KEY = "mu-sky.id";
const USER_KEY = "mu-sky.user";

const joinDialog = document.querySelector<HTMLDivElement>("#join")!;
const joinForm = document.querySelector<HTMLFormElement>("#join-form")!;
const joinName = document.querySelector<HTMLInputElement>("#join-name")!;
const joinError = document.querySelector<HTMLParagraphElement>("#join-error")!;
const chatLog = document.querySelector<HTMLOListElement>("#chat-log")!;
const chatForm = document.querySelector<HTMLFormElement>("#chat-form")!;
const chatInput = document.querySelector<HTMLInputElement>("#chat-input")!;
const online = document.querySelector<HTMLSpanElement>("#online")!;
// The icons, drawn in once: every button marked data-icon gets its own.
applyIcons();

// From here on, errors on this page are reported to the GMs, with where the player was.
startErrorReports(() => `${online.textContent ?? ""} · ${room ? "ในเกม" : "หน้าแรก"}`);
const questButton = document.querySelector<HTMLButtonElement>("#quest-button")!;
const questCount = document.querySelector<HTMLSpanElement>("#quest-count")!;
const questPanel = document.querySelector<HTMLElement>("#quests")!;
const questList = document.querySelector<HTMLOListElement>("#quest-list")!;
const questDays = document.querySelector<HTMLParagraphElement>("#quest-days")!;
const titleList = document.querySelector<HTMLUListElement>("#title-list")!;
const toasts = document.querySelector<HTMLDivElement>("#toasts")!;
const stats = document.querySelector<HTMLDivElement>("#stats")!;
const actions = document.querySelector<HTMLDivElement>("#actions")!;
const joystick = document.querySelector<HTMLDivElement>("#joystick")!;
const attackButton = document.querySelector<HTMLButtonElement>("#attack-button")!;
const death = document.querySelector<HTMLDivElement>("#death")!;
const deathTimer = document.querySelector<HTMLParagraphElement>("#death-timer")!;
const gmButton = document.querySelector<HTMLButtonElement>("#gm-button")!;
const menuBar = document.querySelector<HTMLElement>("#menu-bar")!;
const teamFrames = document.querySelector<HTMLDivElement>("#team-frames")!;
const gmPanel = document.querySelector<HTMLElement>("#gm-panel")!;
const gmPlayers = document.querySelector<HTMLUListElement>("#gm-players")!;
const gmBans = document.querySelector<HTMLUListElement>("#gm-bans")!;
const gmActions = document.querySelector<HTMLElement>("#gm-actions")!;
const gmTargetName = document.querySelector<HTMLHeadingElement>("#gm-target-name")!;
const gmTitleSelect = document.querySelector<HTMLSelectElement>("#gm-title-select")!;
const gmBanDays = document.querySelector<HTMLSelectElement>("#gm-ban-days")!;

// In development Vite serves the page and the game server runs on its own port;
// after `npm run build` the game server serves the page itself.
const protocol = location.protocol === "https:" ? "wss" : "ws";
const endpoint = import.meta.env.DEV ? `${protocol}://${location.hostname}:${SERVER_PORT}` : `${protocol}://${location.host}`;

let room: Room | undefined;
let scene: World3D | undefined;
/** Who the player is; sent again whenever they enter another region. */
let player = { name: "", skin: 0, playerId: loadPlayerId(), party: "" };
/** True while switching regions, so leaving the old room doesn't count as a disconnect. */
let travelling = false;
/** Why the server removed us (kicked or banned), shown once the connection closes. */
let removedReason = "";

/** A new random player id. getRandomValues, unlike randomUUID, also works on plain http:// over the LAN. */
function freshPlayerId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A random id this browser keeps, so the server remembers its quests and titles. */
function loadPlayerId() {
  const fresh = freshPlayerId;
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = fresh();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return fresh();
  }
}

let savedSkin = 0;
try {
  joinName.value = localStorage.getItem(NAME_KEY) ?? "";
  savedSkin = Number(localStorage.getItem(SKIN_KEY)) || 0;
} catch {
  // Private windows may block storage; the choice just isn't remembered.
}

const heroSkin = document.querySelector<HTMLInputElement>("#hero-skin")!;
const heroName = document.querySelector<HTMLParagraphElement>("#hero-name")!;
const picker = new HeroPicker(document.querySelector("#hero-stage")!, savedSkin % HEROES.length, (index) => {
  heroSkin.value = String(index);
  const name = document.createElement("strong");
  name.textContent = HEROES[index].name;
  const role = document.createElement("small");
  role.textContent = HEROES[index].role;
  heroName.replaceChildren(name, role);
});
document.querySelector("#hero-prev")!.addEventListener("click", () => picker.step(-1));
document.querySelector("#hero-next")!.addEventListener("click", () => picker.step(1));

// ---- Accounts ----

const accountStatus = document.querySelector<HTMLParagraphElement>("#account-status")!;
const accountFields = document.querySelector<HTMLDivElement>("#account-fields")!;
const accountUser = document.querySelector<HTMLInputElement>("#account-user")!;
const accountPass = document.querySelector<HTMLInputElement>("#account-pass")!;
const accountLogout = document.querySelector<HTMLButtonElement>("#account-logout")!;

function storage(key: string, value?: string | null) {
  try {
    if (value === undefined) {
      return localStorage.getItem(key);
    }
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Private windows may block storage.
  }
  return null;
}

function renderAccount() {
  const user = storage(USER_KEY);
  accountFields.hidden = Boolean(user);
  accountLogout.hidden = !user;
  accountStatus.textContent = user
    ? `เข้าสู่ระบบเป็น ${user} แล้ว: เลเวล ฉายา และภารกิจตามไปทุกเครื่อง`
    : "ยังไม่ได้เข้าสู่ระบบ: ความคืบหน้าเก็บไว้ในเบราว์เซอร์นี้เท่านั้น สมัครเพื่อเล่นต่อบนเครื่องอื่น";
}

async function account(path: "login" | "register") {
  accountStatus.textContent = "กำลังตรวจสอบ...";
  try {
    const response = await fetch(`api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: accountUser.value.trim(), password: accountPass.value, playerId: player.playerId }),
    });
    const result = (await response.json()) as
      | { ok: true; playerId: string; username: string; name: string; skin: number }
      | { ok: false; error: string };
    if (!result.ok) {
      accountStatus.textContent = result.error;
      return;
    }

    player.playerId = result.playerId;
    storage(ID_KEY, result.playerId);
    storage(USER_KEY, result.username);
    accountPass.value = "";
    // Pick up where this account left off: its name and look.
    if (result.name) {
      joinName.value = result.name;
    }
    if (result.name) {
      picker.show(result.skin);
    }
    renderAccount();
  } catch {
    accountStatus.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง";
  }
}

document.querySelector("#account-login")!.addEventListener("click", () => void account("login"));
document.querySelector("#account-register")!.addEventListener("click", () => void account("register"));
/** Off the account on this browser: a fresh, empty identity; the account's progress stays safe on the server. */
function signOut() {
  player.playerId = freshPlayerId();
  storage(ID_KEY, player.playerId);
  storage(USER_KEY, null);
  renderAccount();
}

accountLogout.addEventListener("click", signOut);
renderAccount();

// ---- Full screen ----

const fullscreenButton = document.querySelector<HTMLButtonElement>("#fullscreen-button")!;
const canFullscreen = document.fullscreenEnabled && !matchMedia("(display-mode: fullscreen)").matches;
const touchScreen = matchMedia("(pointer: coarse)").matches;

/** Hides the browser's bars, so the game fills a phone's whole screen. */
function enterFullscreen() {
  if (canFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {
      // Some browsers refuse; the game still works with their bars showing.
    });
  }
}

fullscreenButton.hidden = !canFullscreen;
fullscreenButton.addEventListener("click", () => {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    enterFullscreen();
  }
});

// ---- Rooms: the public world, or a private one found by its code ----

const partyHint = document.querySelector<HTMLParagraphElement>("#party-hint")!;
const partyCode = document.querySelector<HTMLInputElement>("#party-code")!;
const partyBadge = document.querySelector<HTMLDivElement>("#party-badge")!;
let partyMode: "public" | "create" | "join" = "public";
let createdCode = "";

function newPartyCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(PARTY_CODE_LENGTH));
  return Array.from(bytes, (b) => PARTY_ALPHABET[b % PARTY_ALPHABET.length]).join("");
}

function choosePartyMode(mode: typeof partyMode) {
  partyMode = mode;
  for (const option of document.querySelectorAll<HTMLButtonElement>(".party-option")) {
    option.classList.toggle("selected", option.dataset.party === mode);
  }
  partyCode.hidden = mode !== "join";
  if (mode === "create") {
    createdCode ||= newPartyCode();
  }
  partyHint.textContent =
    mode === "public"
      ? "เล่นกับทุกคนที่ออนไลน์"
      : mode === "create"
        ? `ห้องใหม่ของคุณ รหัส ${createdCode} · เข้าเกมแล้วกด "ชวนเพื่อน" เพื่อส่งลิงก์`
        : "ใส่รหัสห้องที่เพื่อนส่งมา";
}

/** The party to join: "" for the public world, a code for a private room, undefined when the code is missing. */
function chosenParty() {
  if (partyMode === "public") {
    return "";
  }
  if (partyMode === "create") {
    return createdCode;
  }
  return cleanPartyCode(partyCode.value) || undefined;
}

for (const option of document.querySelectorAll<HTMLButtonElement>(".party-option")) {
  option.addEventListener("click", () => choosePartyMode(option.dataset.party as typeof partyMode));
}

// A friend's invite link (…?room=K7Q2MX) opens straight onto their room.
const invited = cleanPartyCode(new URLSearchParams(location.search).get("room"));
if (invited) {
  partyCode.value = invited;
  choosePartyMode("join");
  partyHint.textContent = `เพื่อนชวนเข้าห้อง ${invited} · ตั้งชื่อแล้วกดเข้าเกมได้เลย`;
}

function inviteLink() {
  return `${location.origin}${location.pathname}?room=${player.party}`;
}

function renderPartyBadge() {
  // In a dungeon the code is the team's cave, not a room to invite friends to.
  partyBadge.hidden = !player.party || currentRegion === "dungeon";
  document.querySelector("#party-badge-code")!.textContent = player.party;
}

document.querySelector("#party-invite")!.addEventListener("click", async () => {
  const link = inviteLink();
  const text = `มาเล่น MU Sky ด้วยกัน! ห้อง ${player.party}`;
  try {
    // Phones open their share sheet (LINE, Messenger…); computers copy the link.
    if (navigator.share) {
      await navigator.share({ title: "MU Sky", text, url: link });
      return;
    }
    await navigator.clipboard.writeText(link);
    showToast({ kind: "quest", text: "คัดลอกลิงก์ชวนเพื่อนแล้ว ส่งให้เพื่อนได้เลย" });
  } catch {
    // Without clipboard access (plain http), show the link to copy by hand.
    prompt("คัดลอกลิงก์นี้ส่งให้เพื่อน", link);
  }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  // Tapping "join" counts as the gesture browsers need before going full screen.
  if (touchScreen) {
    enterFullscreen();
  }
  const name = joinName.value.trim();
  const skin = Number(new FormData(joinForm).get("skin")) || 0;
  joinError.textContent = "กำลังเชื่อมต่อ...";

  const party = chosenParty();
  if (party === undefined) {
    joinError.textContent = "ใส่รหัสห้อง 6 ตัวที่เพื่อนส่งมา";
    return;
  }
  player = { ...player, name, skin, party };
  const entered = await enterRegion(START_REGION);
  if (entered !== true) {
    joinError.textContent = entered;
    return;
  }

  try {
    localStorage.setItem(NAME_KEY, name);
    localStorage.setItem(SKIN_KEY, String(skin));
  } catch {
    // See above.
  }

  joinError.textContent = "";
  joinDialog.hidden = true;
});

/** Joins the room of a region and starts drawing it. Returns why not when it can't. */
async function enterRegion(region: RegionId, from?: RegionId): Promise<true | string> {
  try {
    room = await new Client(endpoint).joinOrCreate(ROOM_NAME, { ...player, region, from });
  } catch (error) {
    // A ban comes back as a 403 with the reason; anything else means the server is out of reach.
    const { code, message } = error as { code?: number; message?: string };
    return code === 403 && message ? message : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง";
  }

  startGame(room, region);
  return true;
}

/** A portal sent us on: leave this region quietly and join the next one. */
async function travel(to: RegionId, from: RegionId, party = player.party) {
  player.party = party;
  travelling = true;
  const leaving = room;
  room = undefined;
  scene?.destroy();
  scene = undefined;
  online.textContent = `กำลังเดินทางไป${REGIONS[to].name}...`;
  // The loading screen at once, and the next region's models fetched while joining its room.
  showRegionLoading(to);
  void preload(regionModels(to));
  await leaving?.leave();
  travelling = false;

  const entered = await enterRegion(to, from);
  if (entered !== true) {
    showJoinDialog(entered === "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง" ? "เดินทางไม่สำเร็จ เข้าเกมใหม่ได้เลย" : entered);
  }
}

if (import.meta.env.DEV) {
  // Development only (left out of `npm run build`): jump between regions from the browser console.
  (window as unknown as { muTravel: typeof travel }).muTravel = travel;
}

function showJoinDialog(message: string) {
  online.textContent = "ออฟไลน์";
  // Left in the middle of the tutorial: it comes back next time.
  tutorial.hidden = true;
  tutorialStep = -1;
  voice.leave();
  renderVoiceButton();
  voiceButton.hidden = true;
  questButton.hidden = true;
  questPanel.hidden = true;
  stats.hidden = true;
  actions.hidden = true;
  joystick.hidden = true;
  partyBadge.hidden = true;
  menuBar.hidden = true;
  rideButton.hidden = true;
  autoButton.hidden = true;
  // Back at the start screen: the next game starts by hand.
  hunting = false;
  autoButton.classList.remove("on");
  teamFrames.hidden = true;
  document.querySelectorAll<HTMLElement>(".side-panel").forEach((panel) => (panel.hidden = true));
  stopMusic();
  death.hidden = true;
  gmButton.hidden = true;
  gmPanel.hidden = true;
  joinError.textContent = message;
  joinDialog.hidden = false;
}

/** The region being played, for what differs in the dungeon. */
let currentRegion: RegionId = START_REGION;

function startGame(joined: Room, region: RegionId) {
  currentRegion = region;
  dungeonBanner.hidden = true;
  // The world shows the count once its models have loaded.
  online.textContent = "กำลังโหลด...";
  showRegionLoading(region);
  void startTutorial();
  scene = new World3D(
    document.querySelector<HTMLDivElement>("#game")!,
    joined,
    region,
    chatInput,
    (count) => {
      online.textContent = `${REGIONS[region].name} · ออนไลน์ ${count} คน`;
      // Someone came or went: an open team panel lists who can be invited now.
      if (!document.querySelector<HTMLElement>("#team-panel")!.hidden) {
        renderNearby();
      }
    },
    renderSelf,
    showLoading,
  );

  joined.onMessage("chat-history", (messages: ChatMessage[]) => messages.forEach(addChatLine));
  joined.onMessage("chat", (message: ChatMessage) => {
    addChatLine(message);
    if (message.senderId && !message.system) {
      scene?.showBubble(message.senderId, message.text);
    }
  });

  joined.onMessage("progress", renderProgress);
  joined.onMessage("achievement", showToast);
  joined.onMessage("swing", (message: { id: string; x: number; y: number }) => scene?.showSwing(message.id, message.x, message.y));
  joined.onMessage("hit", (event: HitEvent) => {
    scene?.showHit(event);
    if (event.attacker === joined.sessionId && event.damage > 0) {
      countCombo();
    } else if (event.target === joined.sessionId && event.damage > 0) {
      breakCombo();
    }
  });
  joined.onMessage("invasion", showInvasion);
  joined.onMessage("invasion-end", endInvasion);
  joined.onMessage("gold-rabbit", (event: GoldRabbitEvent) => {
    const here = event.region === currentRegion;
    showToast({ kind: "title", text: here ? "✨ กระต่ายทองคำโผล่ในภาคนี้! ดูจุดทองบนแผนที่ รีบไล่ตี!" : `✨ กระต่ายทองคำโผล่ที่${REGIONS[event.region].name}! (60 วิ)` });
    play("levelup", 0.4);
    buzz(BUZZ.crit);
  });
  joined.onMessage("levelup", (message: { id: string }) => scene?.showLevelUp(message.id));
  joined.onMessage("mattack", (message: { id: string }) => scene?.showMonsterAttack(message.id));
  joined.onMessage("shot", (shot: ShotEvent) => scene?.showShot(shot));
  joined.onMessage("shot-end", (message: { id: number; x: number; y: number }) => scene?.endShot(message.id, message.x, message.y));
  joined.onMessage("xp", (message: { amount: number }) => scene?.showXp(message.amount));
  joined.onMessage("ultimate", (event: UltimateEvent) => {
    scene?.showUltimate(event);
    if (event.by === joined.sessionId) {
      startUltimateCooldown(ULTIMATES[event.id].cooldownMs);
    }
  });
  joined.onMessage("skill", (message: { id: SkillId; by: string; fromX?: number; fromY?: number; x?: number; y?: number; amount?: number }) => {
    scene?.showSkill(message);
    if (message.by === joined.sessionId) {
      startCooldown(message.id);
    }
  });
  joined.onMessage("gm-list", renderGmList);
  joined.onMessage("gm-errors", renderGmErrors);
  joined.onMessage("gm-reports", renderGmReports);
  joined.onMessage("blocked", renderBlocked);
  joined.onMessage("removed", (message: { text: string }) => {
    removedReason = message.text;
  });
  questButton.hidden = false;
  stats.hidden = false;
  actions.hidden = false;
  joystick.hidden = false;
  menuBar.hidden = false;
  autoButton.hidden = false;
  showUltimateButton(player.skin);
  scene.setAuto(hunting);
  joined.onMessage("gold", (message: { amount: number; x: number; y: number }) => scene?.showGold(message.amount, message.x, message.y));
  joined.onMessage("potion", (message: { by: string; amount: number }) => {
    scene?.showPotion(message.by, message.amount);
    if (message.by === joined.sessionId) {
      startPotionCooldown();
    }
  });
  joined.onMessage("upgrade", (message: { id: string }) => scene?.showUpgrade(message.id));
  joined.onMessage("loot", (event: LootEvent) => {
    scene?.showLoot(event);
    if (event.by === joined.sessionId && !event.sold) {
      bagDot.hidden = !bagPanel.hidden;
    }
  });
  joined.onMessage("bag", renderBag);
  joined.onMessage("codex", renderCodex);
  joined.onMessage("dungeon", renderDungeon);
  joined.onMessage("enhance", (event: { by: string; ok: boolean; plus: number; rarity: number }) => scene?.showEnhance(event));
  joined.onMessage("daily-gift", showDailyGift);
  joined.onMessage("voice-signal", (message: { from: string; data: Parameters<Voice["receive"]>[1] }) => {
    const mate = teamNow.find((member) => member.voice === message.from);
    void voice.receive(message.from, message.data, mate).catch(() => undefined);
  });
  voice.announce();
  joined.onMessage("world-boss", (event: WorldBossEvent) => showWorldBoss(event, true));
  joined.onMessage("world-boss-end", endWorldBoss);
  // A world boss of the world just left is not this one's; the server tells again if there is one here.
  hideWorldBoss();
  // The same for the invasion: each world has its own scores (and the dungeon none).
  hideInvasion();
  breakCombo();
  joined.onMessage("notice", (message: { text: string; ok: boolean }) => {
    showToast({ kind: message.ok ? "quest" : "title", text: message.text });
    if (message.ok) {
      play("buy", 0.35);
    }
  });
  joined.onMessage("team", renderTeam);
  joined.onMessage("wardrobe", (owned: Wardrobe) => {
    wardrobe = owned;
    if (me) {
      renderShop(me);
    }
  });
  joined.onMessage("team-invite", (message: { from: string }) => {
    document.querySelector("#team-invite-from")!.textContent = message.from;
    teamInvite.hidden = false;
    play("click", 0.4);
  });

  renderPartyBadge();
  joined.onMessage("travel", (message: { to?: unknown; from?: unknown; party?: unknown }) => {
    if (isRegionId(message?.to) && isRegionId(message?.from)) {
      void travel(message.to, message.from, cleanPartyCode(message.party));
    }
  });

  joined.onLeave((code) => {
    if (travelling) {
      return;
    }

    scene?.destroy();
    scene = undefined;
    room = undefined;
    // The connection dropped (not a kick, not leaving): the server keeps the player for a while.
    if (!removedReason && code !== 1000 && code !== 4000) {
      void reconnect(joined.reconnectionToken, region);
      return;
    }
    showJoinDialog(removedReason || "หลุดจากเซิร์ฟเวอร์ เข้าเกมใหม่ได้เลย");
    removedReason = "";
  });
}

/** Tries to get back into the room just lost, where the player stood, until the server gives up on them. */
async function reconnect(token: string, region: RegionId) {
  document.querySelector("#loading-region")!.textContent = "📶 กำลังเชื่อมต่อใหม่...";
  document.querySelector("#loading-tagline")!.textContent = "ตัวละครรออยู่ที่เดิม ไม่โดนตีระหว่างนี้";
  showLoading(0);
  online.textContent = "กำลังเชื่อมต่อใหม่...";
  const giveUpAt = Date.now() + RECONNECT_SECONDS * 1000;
  while (Date.now() < giveUpAt) {
    try {
      room = await new Client(endpoint).reconnect(token);
      startGame(room, region);
      return;
    } catch {
      // Still offline, or the server not reached yet: try again shortly.
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  showLoading(1);
  showJoinDialog("หลุดจากเซิร์ฟเวอร์นานเกินไป เข้าเกมใหม่ได้เลย");
}

const loading = document.querySelector<HTMLDivElement>("#loading")!;

/** Shown while a region loads, one at a time. */
const TIPS = [
  "ล้มบอสได้ของหายากขึ้นไปทุกครั้ง ส่วนมอนสเตอร์ทั่วไปก็มีโอกาสดรอปของ",
  "บอสโลกจอมอสูรราหูมาทุก 30 นาที ใครตีด้วยได้ของล้ำค่าทุกคน",
  "เข้าเกมทุกวันติดกัน วันที่ 7 ได้ของล้ำค่าและทอง 1,500",
  "ใส่อาวุธกับเครื่องรางที่ดรอปได้ในกระเป๋า 🎒 เสริมพลังจากร้านค้าอีกชั้น",
  "ชวนเพื่อนเข้าทีมได้ที่ปุ่ม 👥 แบ่ง XP กับทอง และตีกันเองไม่โดน",
  "ขี่สัตว์วิ่งเร็วขึ้น ส่วนปีกเพิ่มพลังโจมตี ซื้อได้ที่ร้านค้า 🛒",
  "ทำภารกิจรายวันครบได้ฉายา ฉายาบางอันยากและเพี้ยนมาก",
  "เลือดใกล้หมดกดยาเลือด 🧪 หรือสกิลพรแห่งชีวิต 💚",
  "สร้างห้องส่วนตัวแล้วส่งรหัสให้เพื่อน เล่นกันเฉพาะกลุ่มได้",
];
let tipIndex = Math.floor(Math.random() * TIPS.length);

function showRegionLoading(region: RegionId) {
  document.querySelector("#loading-region")!.textContent = REGIONS[region].name;
  document.querySelector("#loading-tagline")!.textContent = REGIONS[region].tagline;
  showLoading(0);
}

/** A loading bar while a region's models arrive; gone at 100%. */
function showLoading(share: number) {
  if (loading.hidden && share < 1) {
    // A new load: the next tip.
    tipIndex = (tipIndex + 1) % TIPS.length;
    document.querySelector("#loading-tip")!.textContent = `💡 ${TIPS[tipIndex]}`;
  }
  loading.hidden = share >= 1;
  loading.querySelector<HTMLElement>("span")!.style.width = `${Math.round(share * 100)}%`;
  loading.querySelector("b")!.textContent = `กำลังสร้างโลก ${Math.round(share * 100)}%`;
}

function addChatLine(message: ChatMessage) {
  const line = document.createElement("li");
  if (message.system) {
    line.className = "system";
    line.textContent = message.text;
  } else {
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = `${message.from}: `;
    const senderId = message.senderId;
    if (senderId && senderId !== room?.sessionId) {
      name.classList.add("tappable");
      name.addEventListener("click", () => openPlayerMenu(senderId, message.from));
    }
    const title = findTitle(message.title);
    if (title) {
      line.className = `framed rarity-${title.rarity}`;
      line.style.setProperty("--frame", title.style.bubbleBorder);
      line.append(titleBadge(title));
    }
    line.append(name, message.text);
  }

  chatLog.append(line);
  // Count what arrives while the chat is shrunk, shown on the 💬 button.
  if (!message.system && chatBox.classList.contains("min")) {
    unread++;
    showChatState();
  }
  while (chatLog.children.length > 60) {
    chatLog.firstElementChild?.remove();
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

/** A title written in its own colours and glow. */
function titleBadge(title: Title) {
  const badge = document.createElement("span");
  badge.className = `title-badge rarity-${title.rarity}`;
  badge.textContent = decorateTitle(title);
  badge.style.setProperty("--title-color", title.style.color);
  badge.style.setProperty("--title-glow", title.style.glow);
  return badge;
}

function renderProgress(progress: ProgressView) {
  const done = progress.quests.filter((quest) => quest.progress >= quest.goal).length;
  questCount.textContent = `${done}/${progress.quests.length}`;
  questButton.classList.toggle("complete", progress.dailyDone);

  const questItem = (quest: QuestState) => {
    const item = document.createElement("li");
    item.classList.toggle("done", quest.progress >= quest.goal);
    const text = document.createElement("span");
    text.textContent = quest.text;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = quest.progress >= quest.goal ? "สำเร็จ ✓" : `${quest.progress.toLocaleString()}/${quest.goal.toLocaleString()}`;
    const reward = document.createElement("small");
    reward.className = "reward";
    reward.textContent = `🎁 ${rewardText(quest.reward)}`;
    item.append(text, count, reward, progressBar(quest.progress, quest.goal));
    return item;
  };
  questList.replaceChildren(...progress.quests.map(questItem));
  const bonus = (element: Element, done: boolean, text: string) => {
    element.textContent = done ? `✓ รับโบนัสแล้ว: ${text}` : `🏆 ทำครบทุกข้อ รับโบนัส ${text}`;
    element.classList.toggle("done", done);
  };
  bonus(document.querySelector("#quest-bonus")!, progress.dailyDone, rewardText(progress.dailyBonus));
  document.querySelector("#weekly-list")!.replaceChildren(...progress.weekly.map(questItem));
  bonus(document.querySelector("#weekly-bonus")!, progress.weeklyDone, rewardText(progress.weeklyBonus));
  // Weeks start on Monday, Thai time.
  const daysLeft = 7 - ((thaiDay() + 3) % 7);
  document.querySelector("#weekly-ends")!.textContent = daysLeft === 1 ? "· รีเซ็ตคืนนี้" : `· เหลือ ${daysLeft} วัน`;
  questDays.textContent = progress.dailyDone
    ? `วันนี้ทำครบแล้ว · ทำครบมาแล้ว ${progress.days} วัน`
    : `ทำครบทุกข้อเพื่อนับวัน · ทำครบมาแล้ว ${progress.days} วัน · ภารกิจใหม่ทุกเที่ยงคืน`;

  const none = document.createElement("li");
  none.append(titleChoice("", "ไม่แสดงฉายา", progress.equipped === ""));
  titleList.replaceChildren(
    none,
    ...progress.titles.map((state) => {
      const title = findTitle(state.id)!;
      const item = document.createElement("li");
      item.classList.toggle("locked", !state.unlocked);
      if (state.unlocked) {
        item.append(titleChoice(title.id, titleBadge(title), progress.equipped === title.id));
      } else {
        const hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = `🔒 ${title.hint} (${state.progress}/${state.goal})`;
        item.append(titleBadge(title), hint, progressBar(state.progress, state.goal));
      }
      return item;
    }),
  );
}

/** A button that puts a title on, marked when it is the one worn. */
function titleChoice(id: string, label: string | Node, equipped: boolean) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "title-choice";
  button.classList.toggle("equipped", equipped);
  button.append(label);
  if (equipped) {
    const mark = document.createElement("span");
    mark.className = "worn";
    mark.textContent = "กำลังใช้";
    button.append(mark);
  }
  button.addEventListener("click", () => room?.send("equip-title", { id }));
  return button;
}

function progressBar(value: number, goal: number) {
  const bar = document.createElement("span");
  bar.className = "bar";
  bar.style.setProperty("--fill", `${goal === 0 ? 100 : Math.min(100, (value / goal) * 100)}%`);
  return bar;
}

function showToast(achievement: Achievement) {
  const toast = document.createElement("div");
  toast.className = `toast ${achievement.kind}`;
  const title = findTitle(achievement.titleId);
  if (title) {
    toast.append("ได้รับฉายาใหม่! ", titleBadge(title));
  } else {
    toast.textContent = achievement.text;
  }
  toasts.append(toast);
  setTimeout(() => toast.remove(), 4000);
}

let deathCountdown: ReturnType<typeof setInterval> | undefined;

/** The HUD's level, health and experience, the death screen and the GM button. */
function renderSelf(self: SelfState) {
  const next = xpToNext(self.level);
  document.querySelector("#stats-level")!.textContent = `Lv.${self.level}`;
  document.querySelector("#stats-hp")!.textContent = `${self.hp}/${self.maxHp}`;
  document.querySelector("#stats-xp")!.textContent = `XP ${self.xp}/${next}`;
  document.querySelector<HTMLElement>("#stats-hp-fill")!.style.width = `${(self.hp / self.maxHp) * 100}%`;
  document.querySelector<HTMLElement>("#stats-xp-fill")!.style.width = `${Math.min(100, (self.xp / next) * 100)}%`;
  document.querySelector("#stats-gold")!.textContent = `💰 ${self.gold.toLocaleString()}`;
  renderShop(self);
  document.querySelector("#potion-count")!.textContent = String(self.potions);
  // Gold changed with the bag open: what can be enhanced now changes too.
  const goldChanged = me?.gold !== self.gold;
  me = self;
  if (goldChanged && !bagPanel.hidden) {
    renderBag(bag);
  }
  rideButton.hidden = self.mount === 0 || self.dead;
  rideButton.classList.toggle("on", self.riding);
  stats.classList.toggle("low", self.hp / self.maxHp <= 0.25);
  gmButton.hidden = !self.gm;

  if (self.dead && death.hidden) {
    death.hidden = false;
    const respawnAt = Date.now() + RESPAWN_MS;
    const tick = () => {
      deathTimer.textContent = `ฟื้นในอีก ${Math.max(0, Math.ceil((respawnAt - Date.now()) / 1000))} วินาที`;
    };
    tick();
    deathCountdown = setInterval(tick, 250);
  } else if (!self.dead && !death.hidden) {
    death.hidden = true;
    clearInterval(deathCountdown);
  }
}

/** Sweeps a shade around a skill button until the skill can be used again. */
function startCooldown(id: SkillId) {
  const button = document.querySelector<HTMLButtonElement>(`.skill-button[data-skill="${id}"]`);
  if (!button) {
    return;
  }
  const ends = performance.now() + SKILLS[id].cooldownMs;
  const countdown = button.querySelector<HTMLSpanElement>(".cd")!;
  const frame = () => {
    const left = Math.max(0, ends - performance.now());
    button.style.setProperty("--cooldown", `${(left / SKILLS[id].cooldownMs) * 360}deg`);
    button.classList.toggle("cooling", left > 0);
    countdown.textContent = left > 0 ? String(Math.ceil(left / 1000)) : "";
    if (left > 0) {
      requestAnimationFrame(frame);
    }
  };
  frame();
}

// The class skill: its icon follows the hero chosen; T or the button uses it.
const ultimateButton = document.querySelector<HTMLButtonElement>("#ultimate-button")!;

function showUltimateButton(skin: number) {
  const ultimate = ULTIMATES[heroOf(skin).ultimate];
  setIcon(ultimateButton, heroOf(skin).ultimate);
  ultimateButton.title = `${ultimate.name}: ${ultimate.text} (T)`;
  ultimateButton.classList.toggle("offensive", ultimate.offensive);
}

function startUltimateCooldown(total: number) {
  const ends = performance.now() + total;
  const countdown = ultimateButton.querySelector<HTMLSpanElement>(".cd")!;
  const frame = () => {
    const left = Math.max(0, ends - performance.now());
    ultimateButton.style.setProperty("--cooldown", `${(left / total) * 360}deg`);
    ultimateButton.classList.toggle("cooling", left > 0);
    countdown.textContent = left > 0 ? String(Math.ceil(left / 1000)) : "";
    if (left > 0) {
      requestAnimationFrame(frame);
    }
  };
  frame();
}

ultimateButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  scene?.useUltimate();
});
window.addEventListener("keydown", (event) => {
  if (document.activeElement !== chatInput && !event.repeat && event.code === "KeyT") {
    scene?.useUltimate();
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>(".skill-button")) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const id = button.dataset.skill;
    if (isSkillId(id)) {
      scene?.useSkill(id);
    }
  });
}

// ---- Joystick ----

/** How far the knob travels from the centre, in pixels. */
const STICK_REACH = 46;
const knob = joystick.querySelector<HTMLDivElement>(".stick-knob")!;
let stickPointer: number | undefined;

function moveStick(event: PointerEvent) {
  const rect = joystick.getBoundingClientRect();
  let dx = event.clientX - (rect.left + rect.width / 2);
  let dy = event.clientY - (rect.top + rect.height / 2);
  const distance = Math.hypot(dx, dy);
  if (distance > STICK_REACH) {
    dx = (dx / distance) * STICK_REACH;
    dy = (dy / distance) * STICK_REACH;
  }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  scene?.setStick(dx / STICK_REACH, dy / STICK_REACH);
}

function releaseStick() {
  stickPointer = undefined;
  knob.style.transform = "";
  joystick.classList.remove("active");
  scene?.setStick(0, 0);
}

joystick.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  stickPointer = event.pointerId;
  joystick.setPointerCapture(event.pointerId);
  joystick.classList.add("active");
  moveStick(event);
});
joystick.addEventListener("pointermove", (event) => {
  if (event.pointerId === stickPointer) {
    moveStick(event);
  }
});
joystick.addEventListener("pointerup", releaseStick);
joystick.addEventListener("pointercancel", releaseStick);

// ---- Auto-hunting ----

const autoButton = document.querySelector<HTMLButtonElement>("#auto-button")!;
/** Stays on across regions, until the player turns it off. */
let hunting = false;

function setHunting(on: boolean) {
  hunting = on;
  scene?.setAuto(on);
  autoButton.classList.toggle("on", on);
  autoButton.setAttribute("aria-pressed", String(on));
  showToast({ kind: on ? "quest" : "title", text: on ? "🤖 ล่าอัตโนมัติ: เปิด · ขยับจอยเมื่อไรก็ควบคุมเองได้ทันที" : "🤖 ล่าอัตโนมัติ: ปิด" });
  play("click", 0.3);
}

autoButton.addEventListener("click", () => setHunting(!hunting));
window.addEventListener("keydown", (event) => {
  if (document.activeElement !== chatInput && !event.repeat && event.code === "KeyZ" && room) {
    setHunting(!hunting);
  }
});

// ---- Shop, potions, team, settings ----

let me: SelfState | undefined;

let wardrobe: Wardrobe = { wings: [0], mounts: [0] };
const rideButton = document.querySelector<HTMLButtonElement>("#ride-button")!;

function ride() {
  if (me && me.mount > 0 && !me.dead) {
    room?.send("ride", { on: !me.riding });
  }
}

rideButton.addEventListener("click", ride);
window.addEventListener("keydown", (event) => {
  if (document.activeElement !== chatInput && !event.repeat && event.code === "KeyV") {
    ride();
  }
});

/** Cards for every wing or mount: buy it, put it on, or see it's the one in use. */
function renderCosmetics(kind: CosmeticKind, self: SelfState) {
  const list = kind === "wing" ? WINGS : MOUNTS;
  const owned = kind === "wing" ? wardrobe.wings : wardrobe.mounts;
  const worn = kind === "wing" ? self.wing : self.mount;
  const cards = list.map((item, index) => {
    const card = document.createElement("div");
    card.className = `shop-card${index === worn ? " worn" : ""}`;
    const name = document.createElement("strong");
    name.textContent = item.name;
    const effect = document.createElement("small");
    effect.textContent =
      index === 0
        ? ""
        : kind === "wing"
          ? `โจมตี ×${(item as (typeof WINGS)[number]).power}`
          : `วิ่งเร็ว ×${(item as (typeof MOUNTS)[number]).speed}${(item as (typeof MOUNTS)[number]).flies ? " · บินได้" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    if (index === worn) {
      button.textContent = "ใช้อยู่";
      button.disabled = true;
    } else if (owned.includes(index)) {
      button.textContent = index === 0 ? "ถอด" : "ใช้";
      button.addEventListener("click", () => room?.send("equip", { kind, index }));
    } else {
      button.textContent = `${item.price.toLocaleString()} 💰`;
      button.disabled = self.gold < item.price;
      button.addEventListener("click", () => room?.send("buy-cosmetic", { kind, index }));
    }
    card.append(name, effect, button);
    return card;
  });
  document.querySelector(kind === "wing" ? "#shop-wings" : "#shop-mounts")!.replaceChildren(...cards);
}

function renderShop(self: SelfState) {
  renderCosmetics("wing", self);
  renderCosmetics("mount", self);
  document.querySelector("#shop-gold")!.textContent = self.gold.toLocaleString();
  document.querySelector("#shop-potions")!.textContent = String(self.potions);
  for (const [slot, tiers, label] of [
    ["weapon", WEAPON_TIERS, "พลังโจมตี"],
    ["armor", ARMOR_TIERS, "เลือดสูงสุด"],
  ] as const) {
    const now = tiers[self[slot]];
    const next = tiers[self[slot] + 1];
    document.querySelector(`#shop-${slot}-name`)!.textContent = next ? next.name : now.name;
    document.querySelector(`#shop-${slot}-info`)!.textContent = next
      ? `ตอนนี้: ${now.name} · ${label} ×${next.bonus}`
      : `ขั้นสูงสุดแล้ว · ${label} ×${now.bonus}`;
    const buy = document.querySelector<HTMLButtonElement>(`#shop-${slot}-buy`)!;
    buy.textContent = next ? `${next.price.toLocaleString()} 💰` : "สูงสุด";
    buy.disabled = !next || self.gold < next.price;
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-buy]")) {
  button.addEventListener("click", () => {
    room?.send("buy", { item: button.dataset.buy as ShopItem, count: Number(button.dataset.count) || 1 });
  });
}

const potionButton = document.querySelector<HTMLButtonElement>("#potion-button")!;

function drinkPotion() {
  if (me && me.potions > 0 && !me.dead && room) {
    room.send("potion");
  } else if (me && me.potions === 0) {
    showToast({ kind: "title", text: "ยาเลือดหมด ซื้อได้ที่ร้านค้า 🛒" });
  }
}

function startPotionCooldown() {
  const ends = performance.now() + POTION.cooldownMs;
  const countdown = potionButton.querySelector<HTMLSpanElement>(".cd")!;
  const frame = () => {
    const left = Math.max(0, ends - performance.now());
    potionButton.style.setProperty("--cooldown", `${(left / POTION.cooldownMs) * 360}deg`);
    potionButton.classList.toggle("cooling", left > 0);
    countdown.textContent = left > 0 ? String(Math.ceil(left / 1000)) : "";
    if (left > 0) {
      requestAnimationFrame(frame);
    }
  };
  frame();
}

potionButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  drinkPotion();
});
window.addEventListener("keydown", (event) => {
  if (document.activeElement !== chatInput && !event.repeat && (event.code === "KeyG" || event.code === "Digit5")) {
    drinkPotion();
  }
});

// The world boss: a banner with the region and the time left, while it is up.
// ---- Combo: your blows landing one after another ----
const comboBox = document.querySelector<HTMLDivElement>("#combo")!;
const comboCount = document.querySelector<HTMLElement>("#combo-count")!;
const comboWord = document.querySelector<HTMLElement>("#combo-word")!;
/** Blows further apart than this start a new combo. */
const COMBO_GAP_MS = 2500;
const COMBO_TIERS = [
  { from: 100, word: "GODLIKE!", tier: 4 },
  { from: 50, word: "UNSTOPPABLE!", tier: 3 },
  { from: 25, word: "RAMPAGE!", tier: 2 },
  { from: 10, word: "GREAT!", tier: 1 },
  { from: 0, word: "COMBO", tier: 0 },
];
let combo = 0;
let comboTimer: ReturnType<typeof setTimeout> | undefined;

function countCombo() {
  combo++;
  clearTimeout(comboTimer);
  comboTimer = setTimeout(breakCombo, COMBO_GAP_MS);
  if (combo < 3) {
    return;
  }
  const { word, tier, from } = COMBO_TIERS.find((t) => combo >= t.from)!;
  comboCount.textContent = String(combo);
  comboWord.textContent = word;
  comboBox.dataset.tier = String(tier);
  comboBox.hidden = false;
  comboBox.classList.remove("bump", "fading");
  // Restart the pop on every blow.
  void comboBox.offsetWidth;
  comboBox.classList.add("bump");
  if (combo === from && tier > 0) {
    play("levelup", 0.3);
    buzz(BUZZ.crit);
  }
}

function breakCombo() {
  clearTimeout(comboTimer);
  combo = 0;
  if (!comboBox.hidden) {
    comboBox.classList.add("fading");
    comboTimer = setTimeout(() => {
      comboBox.hidden = true;
      comboBox.classList.remove("fading");
    }, 400);
  }
}

// ---- The invasion: a banner while it is near or on ----
const eventBanner = document.querySelector<HTMLButtonElement>("#event-banner")!;
let invasionStatus: InvasionStatus | undefined;
let invasionTimer: ReturnType<typeof setInterval> | undefined;

function clock(ms: number) {
  const left = Math.max(0, ms);
  return `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}`;
}

function drawInvasion() {
  const status = invasionStatus;
  if (!status) {
    return;
  }
  const now = Date.now();
  const on = status.phase === "on" && now >= status.startsAt;
  eventBanner.classList.toggle("on", on);
  document.querySelector("#event-text")!.textContent = on
    ? `😈 อสูรบุก! แต้มคุณ ${status.mine}${status.rank ? ` · อันดับ ${status.rank}` : ""}`
    : "😈 อสูรจะบุกใน";
  document.querySelector("#event-time")!.textContent = clock((on ? status.endsAt : status.startsAt) - now);
  if (now >= status.endsAt) {
    hideInvasion();
  }
}

function showInvasion(status: InvasionStatus) {
  const first = !invasionStatus;
  invasionStatus = status;
  eventBanner.hidden = false;
  const medals = ["🥇", "🥈", "🥉", "4.", "5."];
  document.querySelector("#event-top")!.replaceChildren(
    ...(status.top.length > 0 ? status.top : [{ name: "ยังไม่มีใครได้แต้ม", score: 0 }]).map((entry, index) => {
      const row = document.createElement("li");
      row.textContent = status.top.length > 0 ? `${medals[index]} ${entry.name} · ${entry.score}` : entry.name;
      return row;
    }),
  );
  if (first) {
    clearInterval(invasionTimer);
    invasionTimer = setInterval(drawInvasion, 1000);
  }
  drawInvasion();
}

function hideInvasion() {
  clearInterval(invasionTimer);
  invasionTimer = undefined;
  invasionStatus = undefined;
  eventBanner.hidden = true;
}

function endInvasion(end: InvasionEnd) {
  hideInvasion();
  const next = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  const text = end.rank
    ? `🏆 อสูรบุกจบ! คุณได้อันดับ ${end.rank} (${end.mine} แต้ม)${end.prize ? ` · ได้ ${end.prize}` : ""}`
    : `😈 อสูรบุกจบแล้ว · รอบหน้า ${next} น.`;
  showToast({ kind: end.rank && end.rank <= 3 ? "title" : "daily", text });
  if (end.rank && end.rank <= 3) {
    play("levelup", 0.5);
  }
}

eventBanner.addEventListener("click", () => {
  const open = !eventBanner.classList.contains("open");
  eventBanner.classList.toggle("open", open);
  eventBanner.setAttribute("aria-expanded", String(open));
});

const worldBossBanner = document.querySelector<HTMLElement>("#world-boss")!;
let worldBossCountdown: ReturnType<typeof setInterval> | undefined;

function hideWorldBoss() {
  clearInterval(worldBossCountdown);
  worldBossBanner.hidden = true;
}

function showWorldBoss(event: WorldBossEvent, announce: boolean) {
  hideWorldBoss();
  const endsAt = Date.now() + event.leftMs;
  document.querySelector("#world-boss-name")!.textContent = event.name;
  document.querySelector("#world-boss-region")!.textContent = REGIONS[event.region].name;
  const time = document.querySelector("#world-boss-time")!;
  const tick = () => {
    const left = Math.max(0, endsAt - Date.now());
    time.textContent = `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}`;
    if (left === 0) {
      hideWorldBoss();
    }
  };
  tick();
  worldBossCountdown = setInterval(tick, 1000);
  worldBossBanner.hidden = false;
  if (announce && event.leftMs > 5000) {
    showToast({ kind: "title", text: `👹 บอสโลก ${event.name} บุก${REGIONS[event.region].name}! ไปช่วยกันล้ม รับของล้ำค่าทุกคน` });
    play("levelup", 0.5);
    buzz(BUZZ.worldBoss);
  }
}

function endWorldBoss(end: WorldBossEnd) {
  hideWorldBoss();
  showToast({
    kind: end.beaten ? "quest" : "title",
    text: end.beaten ? `🏆 ปราบ${end.name}สำเร็จ! ตีแรงสุด: ${end.top[0]?.name ?? "-"}` : `🌑 ${end.name} หนีไปแล้ว`,
  });
}

// A first visit: a few bubbles point out the controls, once per device.
const TUTORIAL_KEY = "mu-sky.tutorial-done";
const tutorial = document.querySelector<HTMLElement>("#tutorial")!;
let tutorialStep = -1;

function tutorialSteps(): { target: string; text: string }[] {
  return [
    {
      target: "#joystick",
      text: touchScreen ? "ลากจอยตรงนี้เพื่อเดิน" : "เดินด้วย W A S D หรือลูกศร (ลากจอยตรงนี้ก็ได้)",
    },
    { target: "#attack-button", text: touchScreen ? "กดปุ่มดาบเพื่อโจมตี ตัวละครหันหาศัตรูใกล้สุดเอง" : "กด Space หรือปุ่มดาบเพื่อโจมตี" },
    { target: ".skill-button[data-skill=\"spin\"]", text: touchScreen ? "สกิล 4 อย่างอยู่รอบปุ่มโจมตี ใช้แล้วต้องรอคูลดาวน์" : "สกิลกด Q E R F ใช้แล้วต้องรอคูลดาวน์" },
    { target: "#potion-button", text: "ยาเลือด 🧪 กดตอนเลือดน้อย ซื้อเพิ่มได้ที่ร้านค้า" },
    { target: "#quest-button", text: "ภารกิจรายวันอยู่ตรงนี้ ทำครบได้ฉายาเท่ๆ" },
    { target: "#menu-bar", text: "กระเป๋า 🎒 ร้านค้า 🛒 อันดับ 🏆 ทีม 👥 และตั้งค่า อยู่ที่นี่" },
    { target: "#online", text: "ล้มมอนสเตอร์เก็บทองและของดรอป แล้วเดินเข้าประตูวาร์ปเรืองแสงไปภาคอื่น ขอให้สนุก! ⚔" },
  ];
}

function placeTutorial() {
  const steps = tutorialSteps();
  const step = steps[tutorialStep];
  const target = document.querySelector<HTMLElement>(step.target);
  const ring = document.querySelector<HTMLElement>("#tutorial-ring")!;
  const bubble = document.querySelector<HTMLElement>("#tutorial-bubble")!;
  document.querySelector("#tutorial-text")!.textContent = step.text;
  document.querySelector("#tutorial-next")!.textContent = tutorialStep === steps.length - 1 ? "เริ่มเล่น!" : "ถัดไป";
  const box = target && !target.hidden ? target.getBoundingClientRect() : undefined;
  ring.hidden = !box;
  if (box) {
    const pad = 8;
    Object.assign(ring.style, {
      left: `${box.left - pad}px`,
      top: `${box.top - pad}px`,
      width: `${box.width + pad * 2}px`,
      height: `${box.height + pad * 2}px`,
    });
  }
  // Above the target when it sits low on the screen, below it otherwise.
  const middle = box ? box.top + box.height / 2 : innerHeight / 2;
  bubble.style.top = middle > innerHeight / 2 ? "" : `${(box?.bottom ?? 0) + 16}px`;
  bubble.style.bottom = middle > innerHeight / 2 ? `${innerHeight - (box?.top ?? innerHeight / 2) + 16}px` : "";
}

function endTutorial() {
  tutorial.hidden = true;
  tutorialStep = -1;
  try {
    localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {
    // Without storage it shows again next time; nothing worse.
  }
}

async function startTutorial() {
  let done = false;
  try {
    done = localStorage.getItem(TUTORIAL_KEY) === "1";
  } catch {
    // See endTutorial.
  }
  if (done || tutorialStep >= 0) {
    return;
  }
  tutorialStep = 0;
  // After the world has loaded and the day's gift is out of the way.
  while (!loading.hidden || !dailyGift.hidden) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  // Left the game before it finished loading: show it next time instead, not over the start screen.
  if (!room) {
    tutorialStep = -1;
    return;
  }
  tutorial.hidden = false;
  placeTutorial();
}

document.querySelector("#tutorial-next")!.addEventListener("click", () => {
  tutorialStep++;
  play("click", 0.3);
  if (tutorialStep >= tutorialSteps().length) {
    endTutorial();
  } else {
    placeTutorial();
  }
});
document.querySelector("#tutorial-skip")!.addEventListener("click", endTutorial);
addEventListener("resize", () => {
  if (!tutorial.hidden) {
    placeTutorial();
  }
});

// The day's gift: seven cards, the ones of the streak so far ticked, today's shining.
const dailyGift = document.querySelector<HTMLElement>("#daily-gift")!;

function showDailyGift(event: DailyGiftEvent) {
  const cards = DAILY_GIFTS.map((gift, index) => {
    const day = index + 1;
    const card = document.createElement("li");
    card.className = day < event.day ? "claimed" : day === event.day ? "today" : "";
    const label = document.createElement("small");
    label.textContent = `วันที่ ${day}`;
    const icon = document.createElement("span");
    icon.className = "gift-icon";
    icon.textContent = day < event.day ? "✅" : gift.icon;
    const text = document.createElement("small");
    text.textContent = gift.text;
    card.append(label, icon, text);
    return card;
  });
  document.querySelector("#daily-gift-days")!.replaceChildren(...cards);
  const gift = DAILY_GIFTS[event.day - 1];
  document.querySelector("#daily-gift-got")!.textContent =
    `วันที่ ${event.day}: ได้ ${gift.text}${event.gearName ? ` (「${event.gearName}」อยู่ในกระเป๋า 🎒)` : ""}`;
  dailyGift.hidden = false;
  play("levelup", 0.4);
}

document.querySelector("#daily-gift-ok")!.addEventListener("click", () => {
  dailyGift.hidden = true;
  play("coin", 0.4);
});

// Leaderboards: fetched when the panel opens or the tab changes.
let board: BoardId = "level";

const boardTabs = BOARDS.map(({ id, name }) => {
  const tab = document.createElement("button");
  tab.type = "button";
  tab.textContent = name;
  tab.addEventListener("click", () => {
    board = id;
    void renderBoards();
  });
  tab.dataset.board = id;
  return tab;
});
document.querySelector("#board-tabs")!.replaceChildren(...boardTabs);

async function renderBoards() {
  boardTabs.forEach((tab) => tab.classList.toggle("on", tab.dataset.board === board));
  const list = document.querySelector("#board-list")!;
  let boards: Leaderboards;
  try {
    boards = await (await fetch("api/leaderboards")).json();
  } catch {
    list.replaceChildren(Object.assign(document.createElement("li"), { textContent: "โหลดอันดับไม่ได้ ลองใหม่อีกครั้ง" }));
    return;
  }
  const { unit } = BOARDS.find(({ id }) => id === board)!;
  const rows = boards[board].map((entry, index) => {
    const row = document.createElement("li");
    row.className = index < 3 ? `top top-${index + 1}` : "";
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = index < 3 ? ["🥇", "🥈", "🥉"][index] : String(index + 1);
    const who = document.createElement("span");
    who.className = "who";
    const name = document.createElement("b");
    name.textContent = entry.name;
    who.append(name);
    const title = findTitle(entry.title);
    if (title) {
      who.append(titleBadge(title));
    }
    const value = document.createElement("span");
    value.className = "value";
    value.textContent = board === "level" ? `Lv.${entry.value}` : `${entry.value.toLocaleString()} ${unit}`;
    row.append(rank, who, value);
    return row;
  });
  if (rows.length === 0) {
    rows.push(Object.assign(document.createElement("li"), { textContent: "ยังไม่มีใครติดอันดับ เป็นคนแรกเลย!" }));
  }
  list.replaceChildren(...rows);
}

// The dungeon's run, in a banner: the countdown, the wave and what is left of it, the clock.
const dungeonBanner = document.querySelector<HTMLElement>("#dungeon-banner")!;
let dungeonPhase = "";

function renderDungeon(status: DungeonStatus) {
  const seconds = Math.ceil(status.ms / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const text = {
    countdown: status.wave === 0 ? `⚔ ระลอกแรกมาใน ${seconds}` : `⚔ ระลอก ${status.wave + 1} มาใน ${seconds}`,
    wave: `⚔ ระลอก ${status.wave}/${status.waves} · เหลือ ${status.left} ตัว · ⏱ ${clock}`,
    boss: `👑 บอส! · ⏱ ${clock}`,
    cleared: `🏆 ผ่านดันเจี้ยน! รอบใหม่ใน ${seconds}`,
    failed: `⌛ หมดเวลา · รอบใหม่ใน ${seconds}`,
  }[status.phase];
  dungeonBanner.textContent = text;
  dungeonBanner.className = status.phase;
  dungeonBanner.hidden = false;
  // A new stage of the run: a sound, and a buzz for the big ones.
  if (status.phase !== dungeonPhase) {
    dungeonPhase = status.phase;
    if (status.phase === "boss" || status.phase === "cleared") {
      play("levelup", 0.5);
      buzz(BUZZ.worldBoss);
    }
  }
}

// The collection book: kills of each monster kind against its goal, and the gear found by rarity.
function renderCodex(view: CodexView) {
  let done = 0;
  const pages = CODEX_PAGES.map((page) => {
    const section = document.createElement("section");
    section.className = "codex-page";
    const title = document.createElement("h3");
    title.textContent = page.region ? REGIONS[page.region].name : page.title;
    const rows = page.kinds.map((id) => {
      const kind = monsterKind(id)!;
      const goal = codexGoal(kind);
      const kills = view.hunted[id] ?? 0;
      const complete = kills >= goal;
      done += complete ? 1 : 0;
      const row = document.createElement("div");
      row.className = `codex-row${complete ? " complete" : kills === 0 ? " unseen" : ""}`;
      const name = document.createElement("span");
      name.textContent = `${kind.world ? "👹" : kind.boss ? "👑" : "•"} ${kills === 0 ? "???" : kind.name} Lv.${kind.level}`;
      const bar = document.createElement("span");
      bar.className = "codex-bar";
      const fill = document.createElement("span");
      fill.style.width = `${Math.min(100, (kills / goal) * 100)}%`;
      bar.append(fill);
      const count = document.createElement("small");
      count.textContent = complete ? `✓ +${codexReward(kind).toLocaleString()}💰` : `${kills}/${goal}`;
      row.append(name, bar, count);
      return row;
    });
    section.append(title, ...rows);
    return section;
  });
  document.querySelector("#codex-count")!.textContent = `${done}/${CODEX_KINDS.length}`;
  document.querySelector("#codex-monsters")!.replaceChildren(...pages);
  // Gear: how many of each rarity's names have been found.
  const found = new Set(view.found);
  const gear = RARITIES.map((rarity, index) => {
    const names = GEAR_NAMES_BY_RARITY[index];
    const have = names.filter((name) => found.has(name));
    const item = document.createElement("li");
    item.style.setProperty("--rarity", rarity.color);
    item.textContent = `${rarity.name} ${have.length}/${names.length}`;
    item.title = have.join(", ");
    return item;
  });
  document.querySelector("#codex-gear")!.replaceChildren(...gear);
}

// Bag: gear found on monsters.
const bagPanel = document.querySelector<HTMLElement>("#bag-panel")!;
const bagDot = document.querySelector<HTMLElement>("#bag-dot")!;
let bag: BagView = { items: [], equipped: {} };

function gearCard(gear: Gear, worn: boolean) {
  const { color, name } = RARITIES[gear.rarity];
  const card = document.createElement("div");
  card.className = `shop-card gear-card${worn ? " worn" : ""}`;
  card.style.setProperty("--rarity", color);
  const title = document.createElement("strong");
  title.textContent = `${gear.slot === "weapon" ? "⚔" : "🔮"} ${gearName(gear)}`;
  const info = document.createElement("small");
  info.textContent = `${name} · ${gearEffect(gear)}`;
  const buttons = document.createElement("div");
  buttons.className = "gear-buttons";
  const wear = document.createElement("button");
  wear.type = "button";
  if (worn) {
    wear.textContent = "ถอด";
    wear.addEventListener("click", () => room?.send("gear-off", { slot: gear.slot }));
  } else {
    wear.textContent = "ใส่";
    wear.addEventListener("click", () => room?.send("gear-wear", { id: gear.id }));
  }
  const sell = document.createElement("button");
  sell.type = "button";
  sell.className = "secondary";
  sell.textContent = `ขาย ${sellPrice(gear)}`;
  sell.addEventListener("click", () => room?.send("gear-sell", { id: gear.id }));
  buttons.append(wear, sell);
  // Enhancing: the price and the chance, and a warning where a miss takes a step back.
  const enhance = document.createElement("button");
  enhance.type = "button";
  enhance.className = "gear-enhance";
  const plus = gear.plus ?? 0;
  if (plus >= MAX_PLUS) {
    enhance.textContent = "⚒ +10 สูงสุดแล้ว";
    enhance.disabled = true;
  } else {
    const chance = Math.round(enhanceChance(gear) * 100);
    const risky = plus >= ENHANCE_RISKY_FROM - 1 && chance < 100 ? " ⚠" : "";
    enhance.textContent = `⚒ ตีบวก +${plus + 1} · ${enhanceCost(gear).toLocaleString()}💰 · ${chance}%${risky}`;
    enhance.title = risky ? "ถ้าพลาดจะลดลง 1 ขั้น (ของไม่แตก)" : "ถ้าพลาดเสียแค่ทอง";
    enhance.disabled = (me?.gold ?? 0) < enhanceCost(gear);
    enhance.addEventListener("click", () => room?.send("gear-enhance", { id: gear.id }));
  }
  card.append(title, info, buttons, enhance);
  return card;
}

function renderBag(view: BagView) {
  bag = view;
  document.querySelector("#bag-count")!.textContent = `${view.items.length}/${BAG_SIZE}`;
  for (const slot of ["weapon", "charm"] as GearSlot[]) {
    const holder = document.querySelector(`#worn-${slot}`)!;
    const gear = view.items.find((item) => item.id === view.equipped[slot]);
    if (gear) {
      holder.replaceChildren(gearCard(gear, true));
    } else {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = slot === "weapon" ? "⚔ ยังไม่ได้ใส่อาวุธที่ดรอป" : "🔮 ยังไม่ได้ใส่เครื่องราง";
      holder.replaceChildren(empty);
    }
  }
  const worn = new Set(Object.values(view.equipped));
  const rest = view.items.filter((item) => !worn.has(item.id)).sort((a, b) => b.rarity - a.rarity || b.bonus - a.bonus);
  const list = document.querySelector("#bag-items")!;
  if (rest.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "กระเป๋าว่าง ไปล่ามอนสเตอร์กัน!";
    list.replaceChildren(empty);
  } else {
    list.replaceChildren(...rest.map((item) => gearCard(item, false)));
  }
}

document.querySelector("#bag-sell-junk")!.addEventListener("click", () => {
  const worn = new Set(Object.values(bag.equipped));
  for (const item of bag.items) {
    if (item.rarity <= 1 && !worn.has(item.id)) {
      room?.send("gear-sell", { id: item.id });
    }
  }
});

// On short screens the menu folds into one ☰ button that opens it as a row.
const menuToggle = document.querySelector<HTMLButtonElement>("#menu-toggle")!;

function foldMenu(open: boolean) {
  menuBar.classList.toggle("open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
  setIcon(menuToggle, open ? "close" : "menu");
}

menuToggle.addEventListener("click", () => {
  foldMenu(!menuBar.classList.contains("open"));
  play("click", 0.3);
});
gmButton.addEventListener("click", () => foldMenu(false));

// Panels on the right: one open at a time.
for (const button of menuBar.querySelectorAll<HTMLButtonElement>("[data-panel]")) {
  button.addEventListener("click", () => {
    const panel = document.querySelector<HTMLElement>(`#${button.dataset.panel}`)!;
    const opening = panel.hidden;
    foldMenu(false);
    document.querySelectorAll<HTMLElement>(".side-panel").forEach((other) => (other.hidden = true));
    panel.hidden = !opening;
    if (opening && button.dataset.panel === "team-panel") {
      renderNearby();
    }
    if (opening && button.dataset.panel === "bag-panel") {
      bagDot.hidden = true;
      // Drawn fresh: the gold may have changed since, and with it what can be enhanced.
      renderBag(bag);
    }
    if (opening && button.dataset.panel === "board-panel") {
      void renderBoards();
    }
    if (opening && button.dataset.panel === "codex-panel") {
      room?.send("codex");
    }
    play("click", 0.3);
  });
}
for (const close of document.querySelectorAll<HTMLButtonElement>(".panel-close")) {
  close.addEventListener("click", () => (close.closest<HTMLElement>(".side-panel")!.hidden = true));
}

// Team
const teamInvite = document.querySelector<HTMLDivElement>("#team-invite")!;
document.querySelector("#team-yes")!.addEventListener("click", () => {
  room?.send("team-answer", { yes: true });
  teamInvite.hidden = true;
});
document.querySelector("#team-no")!.addEventListener("click", () => {
  room?.send("team-answer", { yes: false });
  teamInvite.hidden = true;
});
document.querySelector("#team-leave")!.addEventListener("click", () => {
  room?.send("team-leave");
  teamFrames.hidden = true;
});

interface TeamMember {
  me: boolean;
  /** Voice tag, for the voice chat; and whether their microphone is on. */
  voice: string;
  talking: boolean;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  region: string;
  online: boolean;
}

// Team voice chat: teammates who talk are heard by everyone in the team; 🎤 turns one's own microphone on.
const voiceButton = document.querySelector<HTMLButtonElement>("#voice-button")!;
let speakingNow = new Set<string>();
let teamNow: TeamMember[] = [];
let voiceFailures = new Set<string>();
const voice = new Voice((type, message) => room?.send(type, message), {
  speaking(speaking) {
    speakingNow = speaking;
    voiceButton.classList.toggle("speaking", speaking.has("me"));
    document.querySelectorAll<HTMLElement>(".team-member[data-voice]").forEach((row) => {
      row.classList.toggle("speaking", speaking.has(row.dataset.voice!));
    });
  },
  blocked() {
    showToast({ kind: "title", text: "🔈 แตะจอหนึ่งครั้งเพื่อฟังเสียงเพื่อนในทีม" });
  },
  failed(name) {
    // Once per teammate: some mobile networks need a relay server for voice.
    if (!voiceFailures.has(name)) {
      voiceFailures.add(name);
      showToast({ kind: "title", text: `📶 ต่อเสียงกับ ${name || "เพื่อน"} ไม่สำเร็จ: เครือข่ายนี้อาจต้องใช้เซิร์ฟเวอร์ส่งต่อเสียง` });
    }
  },
});

function renderVoiceButton() {
  voiceButton.classList.toggle("on", voice.on);
  voiceButton.setAttribute("aria-pressed", String(voice.on));
  voiceButton.title = voice.on ? "ปิดไมค์" : "เปิดไมค์คุยกับทีม";
}

voiceButton.addEventListener("click", async () => {
  play("click", 0.3);
  if (voice.on) {
    voice.stop();
    renderVoiceButton();
    showToast({ kind: "title", text: "🔇 ปิดไมค์แล้ว (ยังได้ยินเพื่อนอยู่)" });
    return;
  }
  try {
    await voice.start();
    renderVoiceButton();
    showToast({ kind: "quest", text: "🎙 เปิดไมค์แล้ว เพื่อนในทีมได้ยินคุณ" });
  } catch {
    showToast({ kind: "title", text: "ใช้ไมค์ไม่ได้ ลองอนุญาตไมโครโฟนในเบราว์เซอร์ก่อน" });
  }
});

/** The team in the panel, and small health frames at the side of the screen. */
function renderTeam(list: TeamMember[]) {
  const inTeam = list.length > 1;
  teamFrames.hidden = !inTeam;
  voiceButton.hidden = !inTeam;
  // Someone joined or left: the invite list in an open team panel would still say who was in. It
  // reads the players' teams from the world, which the server sends a moment after this message.
  const changed = list.map((member) => member.voice).join() !== teamNow.map((member) => member.voice).join();
  teamNow = list;
  if (changed) {
    setTimeout(() => {
      if (!document.querySelector<HTMLElement>("#team-panel")!.hidden) {
        renderNearby();
      }
    }, 400);
  }
  if (!inTeam) {
    // Voice is for the team: with the team gone, so is the microphone and every link, listening ones too.
    voice.leave();
    renderVoiceButton();
    voiceFailures = new Set();
  }
  voice.syncTeam(list);
  document.querySelector<HTMLElement>("#team-dot")!.hidden = !inTeam;
  document.querySelector<HTMLButtonElement>("#team-leave")!.hidden = !inTeam;
  const frame = (member: TeamMember) => {
    const row = document.createElement("li");
    row.className = `team-member${member.dead ? " dead" : ""}${member.online ? "" : " offline"}`;
    // The local player's own row is "me", as the voice chat calls them.
    row.dataset.voice = member.me ? "me" : member.voice;
    row.classList.toggle("speaking", speakingNow.has(row.dataset.voice));
    const name = document.createElement("span");
    name.className = "team-name";
    name.textContent = `${member.me ? "⭐ " : ""}${member.online ? `Lv.${member.level} ` : ""}${member.name}${member.talking ? " 🎤" : ""}`;
    const where = document.createElement("small");
    where.textContent = member.online ? (member.dead ? "ล้มอยู่" : member.region) : "ออฟไลน์";
    const bar = document.createElement("span");
    bar.className = "team-hp";
    const fill = document.createElement("span");
    fill.style.width = `${member.online ? (member.hp / member.maxHp) * 100 : 0}%`;
    bar.append(fill);
    row.append(name, where, bar);
    return row;
  };
  document.querySelector("#team-members")!.replaceChildren(...list.map(frame));
  teamFrames.replaceChildren(...list.filter((member) => !member.me).map(frame));
}

// Another player: invite them, block them, or report them to the GMs.
const playerMenu = document.querySelector<HTMLDivElement>("#player-menu")!;
const playerReport = document.querySelector<HTMLFormElement>("#player-report")!;
let menuTarget = "";

document.querySelector("#player-report-reasons")!.replaceChildren(
  ...REPORT_REASONS.map((reason, index) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "report-reason";
    input.value = reason;
    input.checked = index === 0;
    label.append(input, reason);
    return label;
  }),
);

function openPlayerMenu(sessionId: string, name: string, mate = false) {
  menuTarget = sessionId;
  document.querySelector("#player-menu-name")!.textContent = name;
  document.querySelector<HTMLButtonElement>("#player-menu-invite")!.hidden = mate;
  document.querySelector<HTMLDivElement>("#player-menu-main")!.hidden = false;
  playerReport.hidden = true;
  document.querySelector<HTMLInputElement>("#player-report-note")!.value = "";
  playerMenu.hidden = false;
}

function closePlayerMenu() {
  playerMenu.hidden = true;
  menuTarget = "";
}

document.querySelector("#player-menu-close")!.addEventListener("click", closePlayerMenu);
document.querySelector("#player-menu-invite")!.addEventListener("click", () => {
  room?.send("team-invite", { target: menuTarget });
  closePlayerMenu();
});
document.querySelector("#player-menu-block")!.addEventListener("click", () => {
  room?.send("block", { target: menuTarget });
  closePlayerMenu();
});
document.querySelector("#player-menu-report")!.addEventListener("click", () => {
  document.querySelector<HTMLDivElement>("#player-menu-main")!.hidden = true;
  playerReport.hidden = false;
});
playerReport.addEventListener("submit", (event) => {
  event.preventDefault();
  const reason = playerReport.querySelector<HTMLInputElement>("input[name=report-reason]:checked")?.value;
  const note = document.querySelector<HTMLInputElement>("#player-report-note")!.value.trim();
  room?.send("report", { target: menuTarget, reason, note });
  closePlayerMenu();
});

/** The players this one blocked, each with a way to undo it. */
function renderBlocked(names: string[]) {
  const rows = names.map((name, index) => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = name;
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "secondary";
    undo.textContent = "เลิกบล็อก";
    undo.addEventListener("click", () => room?.send("unblock", { index }));
    row.append(label, undo);
    return row;
  });
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "ยังไม่ได้บล็อกใคร";
    rows.push(empty);
  }
  document.querySelector("#blocked-list")!.replaceChildren(...rows);
}

function renderNearby() {
  const list = scene?.nearbyPlayers() ?? [];
  const rows = list.map((player) => {
    const row = document.createElement("li");
    row.className = "nearby";
    row.textContent = `Lv.${player.level} ${player.name}`;
    const invite = document.createElement("button");
    invite.type = "button";
    invite.textContent = player.mate ? "ในทีม" : "ชวน";
    invite.disabled = player.mate;
    invite.addEventListener("click", () => {
      room?.send("team-invite", { target: player.id });
      invite.disabled = true;
      invite.textContent = "ส่งแล้ว";
    });
    const more = document.createElement("button");
    more.type = "button";
    more.className = "more secondary";
    more.textContent = "⋯";
    more.title = "บล็อก / รายงาน";
    more.addEventListener("click", () => openPlayerMenu(player.id, player.name, player.mate));
    const actions = document.createElement("span");
    actions.className = "nearby-actions";
    actions.append(invite, more);
    row.append(actions);
    return row;
  });
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "ยังไม่มีใครในภาคนี้";
    rows.push(empty);
  }
  document.querySelector("#team-nearby")!.replaceChildren(...rows);
}

// Settings
const setMusic = document.querySelector<HTMLInputElement>("#set-music")!;
const setVolume = document.querySelector<HTMLInputElement>("#set-volume")!;
const setSound = document.querySelector<HTMLInputElement>("#set-sound")!;
const setVibrate = document.querySelector<HTMLInputElement>("#set-vibrate")!;
onSettings((options) => {
  setMusic.checked = options.music;
  setVolume.value = String(options.musicVolume);
  setSound.checked = options.sound;
  setVibrate.checked = options.vibrate;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#set-quality button")) {
    button.classList.toggle("selected", button.dataset.quality === options.quality);
  }
});
setMusic.addEventListener("change", () => changeSettings({ music: setMusic.checked }));
setVolume.addEventListener("input", () => changeSettings({ musicVolume: Number(setVolume.value) }));
setSound.addEventListener("change", () => changeSettings({ sound: setSound.checked }));
setVibrate.addEventListener("change", () => {
  changeSettings({ vibrate: setVibrate.checked });
  // A taste of it, so the player knows what they turned on.
  buzz(BUZZ.hurt);
});
for (const button of document.querySelectorAll<HTMLButtonElement>("#set-quality button")) {
  button.addEventListener("click", () => changeSettings({ quality: button.dataset.quality as Quality }));
}

// Leaving: back to the start screen, and off the account if signed in. A guest keeps their
// progress in this browser, so for them it is only leaving the game. Pressed twice, to be sure.
const logOutButton = document.querySelector<HTMLButtonElement>("#log-out")!;
let logOutArmed: ReturnType<typeof setTimeout> | undefined;

function renderLogOut() {
  const user = storage(USER_KEY);
  logOutButton.textContent = user ? "🚪 ออกจากระบบ" : "🚪 ออกจากเกม";
  document.querySelector("#log-out-note")!.textContent = user
    ? `บัญชี ${user}: เข้าใหม่ได้ด้วยชื่อบัญชีและรหัสผ่าน`
    : "ยังไม่มีบัญชี: ความคืบหน้าเก็บไว้ในเครื่องนี้ สมัครบัญชีได้ที่หน้าแรกเพื่อเล่นต่อเครื่องอื่น";
}

logOutButton.addEventListener("click", () => {
  if (!logOutArmed) {
    logOutButton.textContent = "กดอีกครั้งเพื่อยืนยัน";
    logOutArmed = setTimeout(() => {
      logOutArmed = undefined;
      renderLogOut();
    }, 3000);
    return;
  }
  clearTimeout(logOutArmed);
  logOutArmed = undefined;
  const signedIn = Boolean(storage(USER_KEY));
  removedReason = signedIn ? "ออกจากระบบแล้ว" : "ออกจากเกมแล้ว";
  if (signedIn) {
    signOut();
  }
  // A goodbye, not a dropped connection: the server lets go of the player at once.
  void room?.leave(true);
  renderLogOut();
});
document.querySelector('[data-panel="settings-panel"]')!.addEventListener("click", renderLogOut);

attackButton.addEventListener("pointerdown", (event) => {
  // The press stays on the button: no zooming or scrolling the page.
  event.preventDefault();
  scene?.attack();
  attackButton.classList.remove("pressed");
  void attackButton.offsetWidth;
  attackButton.classList.add("pressed");
});

// ---- GM panel ----

let gmTarget: GmPlayer | undefined;

function sendGm(action: GmAction) {
  room?.send("gm", action);
}

for (const title of TITLES) {
  gmTitleSelect.append(new Option(decorateTitle(title), title.id));
}
for (const days of BAN_DAYS) {
  gmBanDays.append(new Option(days === 0 ? "ถาวร" : `${days} วัน`, String(days)));
}

function renderGmList(list: GmList) {
  gmPlayers.replaceChildren(
    ...list.players.map((p) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gm-player";
      button.classList.toggle("selected", p.id === gmTarget?.id);
      const marks = `${p.gm ? " 🛡" : ""}${p.god ? " ✨" : ""}${p.oneHit ? " 🗡" : ""}`;
      button.textContent = `Lv.${p.level} ${p.name}${marks} · ${p.region} · ❤ ${p.hp}/${p.maxHp}`;
      button.addEventListener("click", () => {
        gmTarget = p;
        renderGmList(list);
      });
      item.append(button);
      return item;
    }),
  );

  // Keep the chosen player's details fresh, or forget them once they've gone.
  gmTarget = list.players.find((p) => p.id === gmTarget?.id);
  gmSelf = list.players.find((p) => p.id === room?.sessionId);
  document.querySelector("#gm-self-god")!.classList.toggle("on", Boolean(gmSelf?.god));
  document.querySelector("#gm-self-onehit")!.classList.toggle("on", Boolean(gmSelf?.oneHit));
  gmActions.hidden = !gmTarget;
  if (gmTarget) {
    gmTargetName.textContent = `เลือก: ${gmTarget.name} (Lv.${gmTarget.level})`;
    document.querySelector("#gm-god")!.classList.toggle("on", gmTarget.god);
    document.querySelector("#gm-onehit")!.classList.toggle("on", gmTarget.oneHit);
  }

  gmBans.replaceChildren(
    ...list.bans.map((ban) => {
      const item = document.createElement("li");
      const until = ban.until - Date.now() > 10 * 365 * 864e5 ? "ถาวร" : new Date(ban.until).toLocaleString("th-TH");
      item.textContent = `${ban.name || ban.playerId.slice(0, 8)} · ${until}${ban.reason ? ` · ${ban.reason}` : ""} `;
      const unban = document.createElement("button");
      unban.type = "button";
      unban.className = "small";
      unban.textContent = "ปลดแบน";
      unban.addEventListener("click", () => sendGm({ action: "unban", playerId: ban.playerId }));
      item.append(unban);
      return item;
    }),
  );
  if (list.bans.length === 0) {
    const none = document.createElement("li");
    none.className = "muted";
    none.textContent = "ยังไม่มีใครถูกแบน";
    gmBans.append(none);
  }
}

/** The GM's own line in the last list, for the state of the self buttons. */
let gmSelf: GmPlayer | undefined;

gmPanel.addEventListener("click", (event) => {
  // "Me" buttons: powers and gifts for the GM, without picking a name first.
  const self = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-self]")?.dataset.self;
  if (self && room) {
    const target = room.sessionId;
    switch (self) {
      case "god":
        sendGm({ action: "god", target, on: !gmSelf?.god });
        break;
      case "onehit":
        sendGm({ action: "onehit", target, on: !gmSelf?.oneHit });
        break;
      case "gold":
        sendGm({ action: "gold", target, amount: 10_000 });
        break;
      case "potions":
        sendGm({ action: "potions", target, amount: 99 });
        break;
      case "level":
        sendGm({ action: "level", target, amount: 10 });
        break;
      case "heal":
        sendGm({ action: "heal", target });
        break;
      case "cosmetics":
        sendGm({ action: "cosmetics", target });
        break;
      case "gear":
        sendGm({ action: "gear", target });
        break;
      case "worldboss":
        sendGm({ action: "worldboss", target });
        break;
      case "invasion":
        sendGm({ action: "invasion" });
        break;
      case "rabbit":
        sendGm({ action: "rabbit" });
        break;
    }
    return;
  }

  const action = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-gm]")?.dataset.gm;
  if (!action || !gmTarget) {
    return;
  }

  const target = gmTarget.id;
  switch (action) {
    case "god":
      sendGm({ action, target, on: !gmTarget.god });
      break;
    case "onehit":
      sendGm({ action, target, on: !gmTarget.oneHit });
      break;
    case "level":
      sendGm({ action, target, amount: Number(document.querySelector<HTMLInputElement>("#gm-level")!.value) });
      break;
    case "gold":
      sendGm({ action, target, amount: Number(document.querySelector<HTMLInputElement>("#gm-gold")!.value) });
      break;
    case "title":
      sendGm({ action, target, titleId: gmTitleSelect.value });
      break;
    case "ban": {
      const days = Number(gmBanDays.value);
      const length = days === 0 ? "ถาวร" : `${days} วัน`;
      if (confirm(`แบน ${gmTarget.name} ${length}?`)) {
        sendGm({ action, target, days, reason: document.querySelector<HTMLInputElement>("#gm-ban-reason")!.value });
      }
      break;
    }
    case "kick":
    case "kill":
    case "heal":
    case "goto":
    case "summon":
      sendGm({ action, target });
      break;
  }
});

gmButton.addEventListener("click", () => {
  gmPanel.hidden = !gmPanel.hidden;
  if (!gmPanel.hidden) {
    sendGm({ action: "list" });
    sendGm({ action: "errors" });
    sendGm({ action: "reports" });
  }
});
document.querySelector("#gm-reports-refresh")!.addEventListener("click", () => sendGm({ action: "reports" }));

/** Reports about players, newest first, each with what the player said last and what to do. */
function renderGmReports(reports: GmReport[]) {
  const ago = (at: number) => {
    const minutes = Math.round((Date.now() - at) / 60_000);
    return minutes < 1 ? "เมื่อกี้" : minutes < 60 ? `${minutes} นาทีก่อน` : minutes < 1440 ? `${Math.round(minutes / 60)} ชม.ก่อน` : `${Math.round(minutes / 1440)} วันก่อน`;
  };
  const rows = reports.map((report) => {
    const item = document.createElement("li");
    item.className = "gm-report";
    const head = document.createElement("strong");
    head.textContent = `⚑ ${report.target} · ${report.reason}${report.count > 1 ? ` · ถูกรายงาน ${report.count} ครั้ง` : ""}`;
    const facts = document.createElement("small");
    facts.textContent = [
      `โดย ${report.reporter}`,
      report.region,
      ago(report.at),
      report.mutedUntil > Date.now() && `🔇 ปิดแชทถึง ${new Date(report.mutedUntil).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`,
    ]
      .filter(Boolean)
      .join(" · ");
    item.append(head, facts);
    if (report.note) {
      const note = document.createElement("small");
      note.textContent = `“${report.note}”`;
      item.append(note);
    }
    const chats = document.createElement("blockquote");
    chats.textContent = report.chats.length > 0 ? report.chats.join("\n") : "(ไม่มีแชทล่าสุด)";
    chats.style.whiteSpace = "pre-line";
    item.append(chats);
    const grid = document.createElement("div");
    grid.className = "gm-grid";
    const action = (text: string, send: GmAction, danger = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.classList.toggle("danger", danger);
      button.addEventListener("click", () => sendGm(send));
      grid.append(button);
    };
    action("✓ ปิดเรื่อง", { action: "report-close", id: report.id });
    if (report.mutedUntil > Date.now()) {
      action("🔊 เปิดแชท", { action: "report-unmute", id: report.id });
    } else {
      action("🔇 ปิดแชท 1 ชม.", { action: "report-mute", id: report.id });
    }
    action("⛔ แบน 1 วัน", { action: "report-ban", id: report.id, days: 1 }, true);
    action("⛔ แบน 7 วัน", { action: "report-ban", id: report.id, days: 7 }, true);
    if (report.count > 1) {
      action("✓ ปิดทุกเรื่อง", { action: "report-close", id: report.id, all: true });
    }
    item.append(grid);
    return item;
  });
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "ไม่มีรายงานค้างอยู่ 👍";
    rows.push(empty);
  }
  document.querySelector("#gm-reports")!.replaceChildren(...rows);
}
document.querySelector("#gm-close")!.addEventListener("click", () => {
  gmPanel.hidden = true;
});
document.querySelector("#gm-refresh")!.addEventListener("click", () => sendGm({ action: "list" }));
document.querySelector("#gm-errors-refresh")!.addEventListener("click", () => sendGm({ action: "errors" }));
document.querySelector("#gm-errors-clear")!.addEventListener("click", () => sendGm({ action: "errors-clear" }));

/** Errors reported from players' browsers and the server, newest first, each with how often. */
function renderGmErrors(groups: ErrorGroup[]) {
  const ago = (at: number) => {
    const minutes = Math.round((Date.now() - at) / 60_000);
    return minutes < 1 ? "เมื่อกี้" : minutes < 60 ? `${minutes} นาทีก่อน` : `${Math.round(minutes / 60)} ชม.ก่อน`;
  };
  const rows = groups.map((group) => {
    const item = document.createElement("li");
    item.className = `gm-error ${group.source}`;
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${group.source === "server" ? "🖥" : "📱"} ×${group.count} · ${group.message}`;
    const facts = document.createElement("small");
    facts.textContent = [
      `ล่าสุด ${ago(group.lastAt)}`,
      group.where,
      group.context,
      group.devices.join(" / "),
      group.version && `build ${group.version}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const stack = document.createElement("pre");
    stack.textContent = group.stack;
    details.append(summary, facts, stack);
    item.append(details);
    return item;
  });
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "ยังไม่มีบัครายงานเข้ามา 🎉";
    rows.push(empty);
  }
  document.querySelector("#gm-errors")!.replaceChildren(...rows);
}
document.querySelector("#gm-announce")!.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>("#gm-announce-text")!;
  if (input.value.trim()) {
    sendGm({ action: "announce", text: input.value.trim() });
  }
  input.value = "";
});

questButton.addEventListener("click", () => {
  questPanel.hidden = !questPanel.hidden;
});
document.querySelector("#quests-close")!.addEventListener("click", () => {
  questPanel.hidden = true;
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (text && room) {
    room.send("chat", { text });
  }
  chatInput.value = "";
  chatInput.blur();
  closeChat();
});

// The chat can be shrunk to a 💬 button (remembered). Typing opens it for the moment; sending or
// leaving the box folds it back. Phones also fold it to its last lines when not typing.
const CHAT_MIN_KEY = "mu-sky.chat-min";
const chatBox = document.querySelector<HTMLElement>("#chat")!;
const chatUnread = document.querySelector<HTMLSpanElement>("#chat-unread")!;
let chatMinimized = storage(CHAT_MIN_KEY) === "1";
let unread = 0;

function showChatState() {
  chatBox.classList.toggle("min", chatMinimized && !chatBox.classList.contains("open"));
  chatUnread.hidden = unread === 0;
  chatUnread.textContent = unread > 9 ? "9+" : String(unread);
}

function openChat() {
  chatBox.classList.add("open");
  unread = 0;
  showChatState();
  chatInput.focus();
  chatLog.scrollTop = chatLog.scrollHeight;
}

function closeChat() {
  chatBox.classList.remove("open");
  showChatState();
  chatLog.scrollTop = chatLog.scrollHeight;
}

document.querySelector("#chat-toggle")!.addEventListener("click", () => {
  // Pressing 💬 brings the chat back for good.
  chatMinimized = false;
  storage(CHAT_MIN_KEY, "0");
  openChat();
});
document.querySelector("#chat-min")!.addEventListener("click", () => {
  chatMinimized = true;
  storage(CHAT_MIN_KEY, "1");
  chatInput.blur();
  closeChat();
});
showChatState();
// Closing the keyboard without sending folds it back.
chatInput.addEventListener("blur", () => {
  if (!chatInput.value.trim()) {
    setTimeout(closeChat, 150);
  }
});

// Enter opens the chat on a keyboard; Escape gives the keys back to walking.
window.addEventListener("keydown", (event) => {
  if (!room) {
    return;
  }

  if (event.key === "Enter" && document.activeElement !== chatInput) {
    event.preventDefault();
    openChat();
  } else if (event.key === "Escape" && document.activeElement === chatInput) {
    chatInput.blur();
  }
});
