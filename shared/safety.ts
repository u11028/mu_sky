// Keeping the game friendly: rude words hidden from chat and names, and what a report about a
// player says. The server does the hiding, so every player sees the same chat.

/** Spaces, dots and the like that people put between letters to slip a word past a filter. */
const GAP = "[\\s.\\-_*+~,'\"]*";

/** Rude Thai words, spelled out letter by letter so gaps between the letters still match. */
const THAI_WORDS = [
  "ควย",
  "เหี้ย",
  "สัส",
  "ไอ้สัด",
  "อีสัด",
  "เย็ด",
  "แตด",
  "ส้นตีน",
  "จัญไร",
  "ระยำ",
  "ชาติหมา",
  "ชาติชั่ว",
  "พ่อมึงตาย",
  "แม่มึงตาย",
  "ดอกทอง",
  "อีดอก",
  "กะหรี่",
  "เงี่ยน",
  "เสือก",
  "ไอ้ห่า",
  "อีห่า",
  "ไอ้เวร",
  "อีเวร",
  "ไอ้ควาย",
  "อีควาย",
  "หน้าหี",
];

/** English ones, matched in any case; the short ones only as whole words. */
const ENGLISH_WORDS = ["fuck", "shit", "bitch", "cunt", "asshole", "pussy", "nigger", "nigga", "whore", "slut", "bastard"];
const ENGLISH_WHOLE = ["fck", "fuk", "dick", "fag"];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const spaced = (word: string) => [...word].map(escape).join(GAP);

const RUDE = new RegExp(
  [
    ...THAI_WORDS.map(spaced),
    // หี alone, but not in หีบ (a chest) or เหี่ยว (wilted).
    "(?<!เ)หี(?![บ่้๊๋])",
    ...ENGLISH_WORDS.map(spaced),
    ...ENGLISH_WHOLE.map((word) => `\\b${spaced(word)}\\b`),
  ].join("|"),
  "giu",
);

/** The text with every rude word put out of sight. */
export function censor(text: string) {
  return text.replace(RUDE, "***");
}

/** Why a player can be reported. */
export const REPORT_REASONS = ["คำหยาบ / ด่าทอ", "ก่อกวน / สแปม", "โกง / ใช้โปรแกรมช่วย", "ชื่อไม่เหมาะสม", "อื่น ๆ"] as const;

/** Different players who must report someone within the hour before their chat is shut for a while. */
export const REPORTS_TO_MUTE = 3;
export const AUTO_MUTE_MINUTES = 30;

/** A report as the GM panel shows it. Actions on it go by its id; players' own ids stay on the server. */
export interface GmReport {
  id: string;
  at: number;
  reporter: string;
  target: string;
  reason: string;
  note: string;
  region: string;
  /** What the reported player said last, as the server saw it. */
  chats: string[];
  /** Open reports about the same player, this one included. */
  count: number;
  /** Their chat is shut until this time (Unix ms); 0 when it isn't. */
  mutedUntil: number;
}
