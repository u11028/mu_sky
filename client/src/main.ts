import "./style.css";
import Phaser from "phaser";
import { Client, type Room } from "colyseus.js";
import { ROOM_NAME, SERVER_PORT, SKINS, type ChatMessage } from "../../shared/world.ts";
import { isRegionId, REGIONS, type RegionId, START_REGION } from "../../shared/regions.ts";
import type { Achievement, ProgressView } from "../../shared/quests.ts";
import { decorateTitle, findTitle, type Title } from "../../shared/titles.ts";
import { WorldScene } from "./WorldScene.ts";

const NAME_KEY = "mu-sky.name";
const SKIN_KEY = "mu-sky.skin";
const ID_KEY = "mu-sky.id";

const joinDialog = document.querySelector<HTMLDivElement>("#join")!;
const joinForm = document.querySelector<HTMLFormElement>("#join-form")!;
const joinName = document.querySelector<HTMLInputElement>("#join-name")!;
const joinError = document.querySelector<HTMLParagraphElement>("#join-error")!;
const joinSkins = document.querySelector<HTMLFieldSetElement>("#join-skins")!;
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

// In development Vite serves the page and the game server runs on its own port;
// after `npm run build` the game server serves the page itself.
const protocol = location.protocol === "https:" ? "wss" : "ws";
const endpoint = import.meta.env.DEV ? `${protocol}://${location.hostname}:${SERVER_PORT}` : `${protocol}://${location.host}`;

let room: Room | undefined;
let game: Phaser.Game | undefined;
let scene: WorldScene | undefined;
/** Who the player is; sent again whenever they enter another region. */
let player = { name: "", skin: 0, playerId: loadPlayerId() };
/** True while switching regions, so leaving the old room doesn't count as a disconnect. */
let travelling = false;

/** A random id this browser keeps, so the server remembers its quests and titles. */
function loadPlayerId() {
  // getRandomValues, unlike randomUUID, also works on plain http:// over the LAN.
  const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
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

SKINS.forEach((skin, index) => {
  const label = document.createElement("label");
  const input = Object.assign(document.createElement("input"), { type: "radio", name: "skin", value: String(index) });
  input.checked = index === (savedSkin < SKINS.length ? savedSkin : 0);
  const preview = document.createElement("span");
  preview.className = "skin-preview";
  preview.style.backgroundImage = `url(assets/characters/${skin}.png)`;
  label.title = skin;
  label.append(input, preview);
  joinSkins.append(label);
  if (input.checked) {
    // Show the remembered look even when it sits far down the list.
    requestAnimationFrame(() => label.scrollIntoView({ block: "nearest" }));
  }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = joinName.value.trim();
  const skin = Number(new FormData(joinForm).get("skin")) || 0;
  joinError.textContent = "กำลังเชื่อมต่อ...";

  player = { ...player, name, skin };
  if (!(await enterRegion(START_REGION))) {
    joinError.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง";
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

/** Joins the room of a region and starts drawing it. False when the server can't be reached. */
async function enterRegion(region: RegionId, from?: RegionId) {
  try {
    room = await new Client(endpoint).joinOrCreate(ROOM_NAME, { ...player, region, from });
  } catch {
    return false;
  }

  startGame(room, region);
  return true;
}

/** A portal sent us on: leave this region quietly and join the next one. */
async function travel(to: RegionId, from: RegionId) {
  travelling = true;
  const leaving = room;
  room = undefined;
  game?.destroy(true);
  game = undefined;
  scene = undefined;
  online.textContent = `กำลังเดินทางไป${REGIONS[to].name}...`;
  await leaving?.leave();
  travelling = false;

  if (!(await enterRegion(to, from))) {
    showJoinDialog("เดินทางไม่สำเร็จ เข้าเกมใหม่ได้เลย");
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
  joinError.textContent = message;
  joinDialog.hidden = false;
}

function startGame(joined: Room, region: RegionId) {
  // The scene shows the count once its art has loaded.
  online.textContent = "กำลังโหลด...";
  scene = new WorldScene(joined, region, chatInput, (count) => {
    online.textContent = `${REGIONS[region].name} · ออนไลน์ ${count} คน`;
  });

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#1d3b2a",
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene,
  });

  joined.onMessage("chat-history", (messages: ChatMessage[]) => messages.forEach(addChatLine));
  joined.onMessage("chat", (message: ChatMessage) => {
    addChatLine(message);
    if (message.senderId && !message.system) {
      scene?.showBubble(message.senderId, message.text);
    }
  });

  joined.onMessage("progress", renderProgress);
  joined.onMessage("achievement", showToast);
  questButton.hidden = false;

  joined.onMessage("travel", (message: { to?: unknown; from?: unknown }) => {
    if (isRegionId(message?.to) && isRegionId(message?.from)) {
      void travel(message.to, message.from);
    }
  });

  joined.onLeave(() => {
    if (travelling) {
      return;
    }

    game?.destroy(true);
    game = undefined;
    scene = undefined;
    room = undefined;
    showJoinDialog("หลุดจากเซิร์ฟเวอร์ เข้าเกมใหม่ได้เลย");
  });
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
