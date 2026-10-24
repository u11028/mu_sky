import "./style.css";
import Phaser from "phaser";
import { Client, type Room } from "colyseus.js";
import { ROOM_NAME, SERVER_PORT, SKINS, type ChatMessage } from "../../shared/world.ts";
import { isRegionId, REGIONS, type RegionId, START_REGION } from "../../shared/regions.ts";
import { WorldScene } from "./WorldScene.ts";

const NAME_KEY = "mu-sky.name";
const SKIN_KEY = "mu-sky.skin";

const joinDialog = document.querySelector<HTMLDivElement>("#join")!;
const joinForm = document.querySelector<HTMLFormElement>("#join-form")!;
const joinName = document.querySelector<HTMLInputElement>("#join-name")!;
const joinError = document.querySelector<HTMLParagraphElement>("#join-error")!;
const joinSkins = document.querySelector<HTMLFieldSetElement>("#join-skins")!;
const chatLog = document.querySelector<HTMLOListElement>("#chat-log")!;
const chatForm = document.querySelector<HTMLFormElement>("#chat-form")!;
const chatInput = document.querySelector<HTMLInputElement>("#chat-input")!;
const online = document.querySelector<HTMLSpanElement>("#online")!;

// In development Vite serves the page and the game server runs on its own port;
// after `npm run build` the game server serves the page itself.
const protocol = location.protocol === "https:" ? "wss" : "ws";
const endpoint = import.meta.env.DEV ? `${protocol}://${location.hostname}:${SERVER_PORT}` : `${protocol}://${location.host}`;

let room: Room | undefined;
let game: Phaser.Game | undefined;
let scene: WorldScene | undefined;
/** Who the player is; sent again whenever they enter another region. */
let player = { name: "", skin: 0 };
/** True while switching regions, so leaving the old room doesn't count as a disconnect. */
let travelling = false;

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

  player = { name, skin };
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
    line.append(name, message.text);
  }

  chatLog.append(line);
  while (chatLog.children.length > 60) {
    chatLog.firstElementChild?.remove();
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

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
