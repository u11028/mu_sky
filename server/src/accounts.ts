// Accounts: a name and password that lead to a player id, so the same progress opens on any device.
// Passwords are kept only as salted scrypt hashes, in MongoDB or accounts.json (see store.ts).

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dataFile } from "./environment.ts";
import { loadRecords, saveRecords } from "./store.ts";

interface Account {
  username: string;
  salt: string;
  hash: string;
  playerId: string;
  createdAt: number;
}

export const USERNAME = /^[A-Za-z0-9_฀-๿]{3,16}$/;
export const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const PLAYER_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** Wrong logins allowed from one address in a window, to slow down guessing. */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

const file = process.env.ACCOUNTS_FILE ?? dataFile("accounts.json");
const accounts = await loadRecords<Account>("accounts", file);
const failures = new Map<string, number[]>();

function save() {
  saveRecords("accounts", file, accounts);
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

/** Names compare without case, so "Guy" and "guy" are one account. */
function key(username: string) {
  return username.toLowerCase();
}

export type AccountResult = { ok: true; playerId: string; username: string } | { ok: false; error: string };

/**
 * Makes an account. It keeps the progress the browser already has, unless another account owns that.
 */
export function register(username: unknown, password: unknown, currentPlayerId: unknown): AccountResult {
  if (typeof username !== "string" || !USERNAME.test(username)) {
    return { ok: false, error: "ชื่อบัญชีต้องยาว 3-16 ตัว ใช้ตัวอักษรไทย อังกฤษ ตัวเลข หรือ _" };
  }
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return { ok: false, error: `รหัสผ่านต้องยาว ${PASSWORD_MIN}-${PASSWORD_MAX} ตัว` };
  }
  if (accounts.has(key(username))) {
    return { ok: false, error: "ชื่อบัญชีนี้มีคนใช้แล้ว" };
  }

  const owned = new Set([...accounts.values()].map((account) => account.playerId));
  const playerId =
    typeof currentPlayerId === "string" && PLAYER_ID.test(currentPlayerId) && !owned.has(currentPlayerId)
      ? currentPlayerId
      : randomBytes(16).toString("hex");
  const salt = randomBytes(16).toString("hex");
  accounts.set(key(username), { username, salt, hash: hashPassword(password, salt), playerId, createdAt: Date.now() });
  save();
  return { ok: true, playerId, username };
}

export function login(username: unknown, password: unknown, ip: string): AccountResult {
  const now = Date.now();
  const recent = (failures.get(ip) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);
  if (recent.length >= MAX_FAILURES) {
    return { ok: false, error: "ลองผิดหลายครั้งเกินไป รอ 10 นาทีแล้วลองใหม่" };
  }

  const account = typeof username === "string" ? accounts.get(key(username)) : undefined;
  const given = typeof password === "string" ? password : "";
  // Hash even for unknown names, so the reply takes as long either way.
  const expected = Buffer.from(account?.hash ?? "0".repeat(128), "hex");
  const actual = Buffer.from(hashPassword(given, account?.salt ?? "no-account"), "hex");
  if (!account || !timingSafeEqual(expected, actual)) {
    failures.set(ip, [...recent, now]);
    return { ok: false, error: "ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง" };
  }

  failures.delete(ip);
  return { ok: true, playerId: account.playerId, username: account.username };
}
