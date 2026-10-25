import "./style.css";
import { Client, type Room } from "colyseus.js";
import {
  type ChatMessage,
  cleanPartyCode,
  PARTY_ALPHABET,
  PARTY_CODE_LENGTH,
  ROOM_NAME,
  SERVER_PORT,
} from "../../shared/world.ts";
import { HEROES, type ShotEvent } from "../../shared/heroes.ts";
import { isRegionId, REGIONS, type RegionId, START_REGION } from "../../shared/regions.ts";
import type { Achievement, ProgressView } from "../../shared/quests.ts";
import { decorateTitle, findTitle, type Title, TITLES } from "../../shared/titles.ts";
import { type SelfState, World3D } from "./three/World3D.ts";
import { stopMusic } from "./three/music.ts";
import { play } from "./three/sfx.ts";
import { changeSettings, onSettings, type Quality } from "./settings.ts";
import { ARMOR_TIERS, POTION, type ShopItem, WEAPON_TIERS } from "../../shared/items.ts";
import { type CosmeticKind, MOUNTS, type Wardrobe, WINGS } from "../../shared/cosmetics.ts";
import type { WorldBossEnd, WorldBossEvent } from "../../shared/monsters.ts";
import { type BoardId, BOARDS, DAILY_GIFTS, type DailyGiftEvent, type Leaderboards } from "../../shared/rewards.ts";
import { BAG_SIZE, type BagView, type Gear, gearEffect, type GearSlot, type LootEvent, RARITIES, sellPrice } from "../../shared/loot.ts";
import { HeroPicker } from "./three/HeroPicker.ts";
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
accountLogout.addEventListener("click", () => {
  // A fresh, empty identity: the account's progress stays safe on the server.
  player.playerId = freshPlayerId();
  storage(ID_KEY, player.playerId);
  storage(USER_KEY, null);
  renderAccount();
});
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
  partyBadge.hidden = !player.party;
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
  questButton.hidden = true;
  questPanel.hidden = true;
  stats.hidden = true;
  actions.hidden = true;
  joystick.hidden = true;
  partyBadge.hidden = true;
  menuBar.hidden = true;
  rideButton.hidden = true;
  teamFrames.hidden = true;
  document.querySelectorAll<HTMLElement>(".side-panel").forEach((panel) => (panel.hidden = true));
  stopMusic();
  death.hidden = true;
  gmButton.hidden = true;
  gmPanel.hidden = true;
  joinError.textContent = message;
  joinDialog.hidden = false;
}

function startGame(joined: Room, region: RegionId) {
  // The world shows the count once its models have loaded.
  online.textContent = "กำลังโหลด...";
  document.querySelector("#loading-region")!.textContent = REGIONS[region].name;
  document.querySelector("#loading-tagline")!.textContent = REGIONS[region].tagline;
  showLoading(0);
  void startTutorial();
  scene = new World3D(
    document.querySelector<HTMLDivElement>("#game")!,
    joined,
    region,
    chatInput,
    (count) => {
      online.textContent = `${REGIONS[region].name} · ออนไลน์ ${count} คน`;
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
  joined.onMessage("hit", (event: HitEvent) => scene?.showHit(event));
  joined.onMessage("levelup", (message: { id: string }) => scene?.showLevelUp(message.id));
  joined.onMessage("mattack", (message: { id: string }) => scene?.showMonsterAttack(message.id));
  joined.onMessage("shot", (shot: ShotEvent) => scene?.showShot(shot));
  joined.onMessage("shot-end", (message: { id: number; x: number; y: number }) => scene?.endShot(message.id, message.x, message.y));
  joined.onMessage("xp", (message: { amount: number }) => scene?.showXp(message.amount));
  joined.onMessage("skill", (message: { id: SkillId; by: string; fromX?: number; fromY?: number; x?: number; y?: number; amount?: number }) => {
    scene?.showSkill(message);
    if (message.by === joined.sessionId) {
      startCooldown(message.id);
    }
  });
  joined.onMessage("gm-list", renderGmList);
  joined.onMessage("removed", (message: { text: string }) => {
    removedReason = message.text;
  });
  questButton.hidden = false;
  stats.hidden = false;
  actions.hidden = false;
  joystick.hidden = false;
  menuBar.hidden = false;
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
  joined.onMessage("daily-gift", showDailyGift);
  joined.onMessage("world-boss", (event: WorldBossEvent) => showWorldBoss(event, true));
  joined.onMessage("world-boss-end", endWorldBoss);
  // A world boss of the world just left is not this one's; the server tells again if there is one here.
  hideWorldBoss();
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

  joined.onLeave(() => {
    if (travelling) {
      return;
    }

    scene?.destroy();
    scene = undefined;
    room = undefined;
    showJoinDialog(removedReason || "หลุดจากเซิร์ฟเวอร์ เข้าเกมใหม่ได้เลย");
    removedReason = "";
  });
}

const loading = document.querySelector<HTMLDivElement>("#loading")!;

/** A loading bar while a region's models arrive; gone at 100%. */
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

  questList.replaceChildren(
    ...progress.quests.map((quest) => {
      const item = document.createElement("li");
      item.classList.toggle("done", quest.progress >= quest.goal);
      const text = document.createElement("span");
      text.textContent = quest.text;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = quest.progress >= quest.goal ? "สำเร็จ ✓" : `${quest.progress}/${quest.goal}`;
      item.append(text, count, progressBar(quest.progress, quest.goal));
      return item;
    }),
  );
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
  me = self;
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
  title.textContent = `${gear.slot === "weapon" ? "⚔" : "🔮"} ${gear.name}`;
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
  card.append(title, info, buttons);
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

// Panels on the right: one open at a time.
for (const button of menuBar.querySelectorAll<HTMLButtonElement>("[data-panel]")) {
  button.addEventListener("click", () => {
    const panel = document.querySelector<HTMLElement>(`#${button.dataset.panel}`)!;
    const opening = panel.hidden;
    document.querySelectorAll<HTMLElement>(".side-panel").forEach((other) => (other.hidden = true));
    panel.hidden = !opening;
    if (opening && button.dataset.panel === "team-panel") {
      renderNearby();
    }
    if (opening && button.dataset.panel === "bag-panel") {
      bagDot.hidden = true;
    }
    if (opening && button.dataset.panel === "board-panel") {
      void renderBoards();
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
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  region: string;
  online: boolean;
}

/** The team in the panel, and small health frames at the side of the screen. */
function renderTeam(list: TeamMember[]) {
  const inTeam = list.length > 1;
  teamFrames.hidden = !inTeam;
  document.querySelector<HTMLElement>("#team-dot")!.hidden = !inTeam;
  document.querySelector<HTMLButtonElement>("#team-leave")!.hidden = !inTeam;
  const frame = (member: TeamMember) => {
    const row = document.createElement("li");
    row.className = `team-member${member.dead ? " dead" : ""}${member.online ? "" : " offline"}`;
    const name = document.createElement("span");
    name.className = "team-name";
    name.textContent = `${member.me ? "⭐ " : ""}${member.online ? `Lv.${member.level} ` : ""}${member.name}`;
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
    row.append(invite);
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
onSettings((options) => {
  setMusic.checked = options.music;
  setVolume.value = String(options.musicVolume);
  setSound.checked = options.sound;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#set-quality button")) {
    button.classList.toggle("selected", button.dataset.quality === options.quality);
  }
});
setMusic.addEventListener("change", () => changeSettings({ music: setMusic.checked }));
setVolume.addEventListener("input", () => changeSettings({ musicVolume: Number(setVolume.value) }));
setSound.addEventListener("change", () => changeSettings({ sound: setSound.checked }));
for (const button of document.querySelectorAll<HTMLButtonElement>("#set-quality button")) {
  button.addEventListener("click", () => changeSettings({ quality: button.dataset.quality as Quality }));
}

attackButton.addEventListener("pointerdown", (event) => {
  // Not a tap on the map: don't walk there.
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
  }
});
document.querySelector("#gm-close")!.addEventListener("click", () => {
  gmPanel.hidden = true;
});
document.querySelector("#gm-refresh")!.addEventListener("click", () => sendGm({ action: "list" }));
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
