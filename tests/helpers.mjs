// What the game tests share: a real game server on a free port with empty data, and bots that
// join it as players.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "colyseus.js";

const root = fileURLToPath(new URL("..", import.meta.url));
export const GM_KEY = "test-gm-key-1234";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check` holds, up to `ms`; returns whether it did. */
export async function until(check, ms = 5000) {
  const giveUp = Date.now() + ms;
  while (Date.now() < giveUp) {
    if (await check()) {
      return true;
    }
    await wait(50);
  }
  return false;
}

function freePort() {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Starts the game server; `stop()` ends it and removes its data. */
export async function startServer() {
  const port = await freePort();
  const data = mkdtempSync(joinPath(tmpdir(), "mu-sky-test-"));
  const server = spawn(process.execPath, [joinPath(root, "node_modules/tsx/dist/cli.mjs"), joinPath(root, "server/src/index.ts")], {
    cwd: joinPath(root, "server"),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: data,
      PROGRESS_FILE: joinPath(data, "progress.json"),
      ACCOUNTS_FILE: joinPath(data, "accounts.json"),
      GM_KEY,
      MONGODB_URI: "",
      // Invasions and rabbits only when a test's GM starts them.
      TIMED_EVENTS: "off",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (chunk) => (log += chunk));
  server.stderr.on("data", (chunk) => (log += chunk));
  if (!(await until(() => log.includes("Game server listening"), 30_000))) {
    server.kill();
    throw new Error(`The game server did not start:\n${log}`);
  }
  return {
    port,
    http: `http://localhost:${port}`,
    ws: `ws://localhost:${port}`,
    log: () => log,
    async stop() {
      server.kill();
      await wait(300);
      rmSync(data, { recursive: true, force: true });
    },
  };
}

let next = 0;

/** A player joining the game: their messages are kept by type in `bot.got`. */
export async function join(server, { name = "บอท", region = "central", party = "", skin = 0, id } = {}) {
  const playerId = id ?? `test_player_${process.pid}_${++next}_${Date.now()}`.slice(0, 64);
  const room = await new Client(server.ws).joinOrCreate("world", { name, skin, playerId, region, party });
  const bot = { room, playerId, got: {} };
  room.onMessage("*", (type, message) => {
    (bot.got[type] ??= []).push(message);
  });
  bot.me = () => room.state.players.get(room.sessionId);
  bot.said = () => [...(bot.got.chat ?? []), ...(bot.got.notice ?? [])].map((m) => m.text);
  await until(() => bot.me() !== undefined);
  return bot;
}

/** Makes a bot a GM through the chat, as a player would. */
export async function makeGm(bot) {
  bot.room.send("chat", { text: `/gm ${GM_KEY}` });
  await until(() => bot.me().gm);
}

/** A GM bot's own powers. */
export function gm(bot, action, extra = {}) {
  bot.room.send("gm", { action, target: bot.room.sessionId, ...extra });
}

/** Walks a bot to a point and waits until it is there. */
export async function walkTo(bot, x, y) {
  bot.room.send("target", { x, y });
  await until(() => Math.hypot(bot.me().x - x, bot.me().y - y) < 6, 15_000);
}

/** A party code no other test uses, so tests don't meet in the same rooms. */
export function partyCode() {
  const letters = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
}
