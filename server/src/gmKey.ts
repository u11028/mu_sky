// The secret that makes a player a GM: typed once in the chat as "/gm <key>".
// It comes from GM_KEY, or from gm-key.txt in the data folder, made with a random key on first start.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataFile } from "./environment.ts";

export const GM_KEY_FILE = dataFile("gm-key.txt");

function loadKey() {
  if (process.env.GM_KEY) {
    return process.env.GM_KEY;
  }
  if (!existsSync(GM_KEY_FILE)) {
    mkdirSync(dirname(GM_KEY_FILE), { recursive: true });
    writeFileSync(GM_KEY_FILE, `${randomBytes(9).toString("base64url")}\n`);
    console.log(`Made a GM key in ${GM_KEY_FILE}`);
  }
  return readFileSync(GM_KEY_FILE, "utf8").trim();
}

const key = Buffer.from(loadKey());

export function isGmKey(attempt: string) {
  const given = Buffer.from(attempt);
  // Compared in constant time, so the key can't be guessed from how long a wrong one takes.
  return given.length === key.length && timingSafeEqual(given, key);
}
