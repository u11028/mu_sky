import "./style.css";
import { Client, type Room } from "colyseus.js";
import { ROOM_NAME, SERVER_PORT, type ChatMessage } from "../../shared/world.ts";
import { HEROES, type ShotEvent } from "../../shared/heroes.ts";
import { isRegionId, REGIONS, type RegionId, START_REGION } from "../../shared/regions.ts";
import type { Achievement, ProgressView } from "../../shared/quests.ts";
import { decorateTitle, findTitle, type Title, TITLES } from "../../shared/titles.ts";
import { type SelfState, World3D } from "./three/World3D.ts";
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
let player = { name: "", skin: 0, playerId: loadPlayerId() };
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

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  // Tapping "join" counts as the gesture browsers need before going full screen.
  if (touchScreen) {
    enterFullscreen();
  }
  const name = joinName.value.trim();
  const skin = Number(new FormData(joinForm).get("skin")) || 0;
  joinError.textContent = "กำลังเชื่อมต่อ...";

  player = { ...player, name, skin };
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
async function travel(to: RegionId, from: RegionId) {
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
  death.hidden = true;
  gmButton.hidden = true;
  gmPanel.hidden = true;
  joinError.textContent = message;
  joinDialog.hidden = false;
}

function startGame(joined: Room, region: RegionId) {
  // The world shows the count once its models have loaded.
  online.textContent = "กำลังโหลด...";
  showLoading(0);
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

  joined.onMessage("travel", (message: { to?: unknown; from?: unknown }) => {
    if (isRegionId(message?.to) && isRegionId(message?.from)) {
      void travel(message.to, message.from);
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
function showLoading(share: number) {
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

gmPanel.addEventListener("click", (event) => {
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
});

// Enter opens the chat on a keyboard; Escape gives the keys back to walking.
window.addEventListener("keydown", (event) => {
  if (!room) {
    return;
  }

  if (event.key === "Enter" && document.activeElement !== chatInput) {
    event.preventDefault();
    chatInput.focus();
  } else if (event.key === "Escape" && document.activeElement === chatInput) {
    chatInput.blur();
  }
});
