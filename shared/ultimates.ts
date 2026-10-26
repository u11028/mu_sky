// Each class's own skill, its "ultimate": what makes picking a class matter, and a team of mixed
// classes stronger than one of the same. The server carries them out (WorldRoom.useUltimate); the
// client draws them.

export type UltimateId = "bulwark" | "berserk" | "meteor" | "arrowRain" | "pierce" | "shadowStrike";

export interface Ultimate {
  name: string;
  icon: string;
  /** What it does, for the button's caption and the hero picker. */
  text: string;
  cooldownMs: number;
  /** How far away it can strike or reach, in pixels (0: around the hero). */
  reach: number;
  /** Size of the area or line it covers, in pixels. */
  radius: number;
  /** Damage as a multiple of a basic attack (0: it doesn't strike). */
  multiplier: number;
  /** How long the effect lasts, or how long until it lands. */
  durationMs: number;
  /** An attack: not usable in a safe zone. */
  offensive: boolean;
}

export const ULTIMATES: Record<UltimateId, Ultimate> = {
  bulwark: {
    name: "ป้อมปราการ",
    icon: "🛡",
    text: "ตัวเองและเพื่อนในทีมรอบตัว รับดาเมจลดครึ่ง 6 วินาที",
    cooldownMs: 22_000,
    reach: 0,
    radius: 320,
    multiplier: 0,
    durationMs: 6000,
    offensive: false,
  },
  berserk: {
    name: "คลั่งสงคราม",
    icon: "🔥",
    text: "ตีแรง ×1.6 วิ่งเร็ว ×1.3 นาน 6 วินาที",
    cooldownMs: 22_000,
    reach: 0,
    radius: 0,
    multiplier: 1.6,
    durationMs: 6000,
    // Only the hero is changed by it: fine to rage up in town before heading out.
    offensive: false,
  },
  meteor: {
    name: "อุกกาบาต",
    icon: "☄",
    text: "อุกกาบาตตกใส่ศัตรู ระเบิดวงกว้าง ×3.5",
    cooldownMs: 18_000,
    reach: 420,
    radius: 130,
    multiplier: 3.5,
    durationMs: 700,
    offensive: true,
  },
  arrowRain: {
    name: "ฝนธนู",
    icon: "🏹",
    text: "ลูกธนูโปรยลงพื้นที่ 4 ระลอก ระลอกละ ×1.1",
    cooldownMs: 18_000,
    reach: 420,
    radius: 150,
    multiplier: 1.1,
    durationMs: 450,
    offensive: true,
  },
  pierce: {
    name: "ศรทะลวง",
    icon: "🎯",
    text: "ยิงทะลุทุกตัวในแนวตรง ×2.5",
    cooldownMs: 15_000,
    reach: 460,
    radius: 24,
    multiplier: 2.5,
    durationMs: 0,
    offensive: true,
  },
  shadowStrike: {
    name: "เงาสังหาร",
    icon: "🗡",
    text: "วาร์ปไปหลังศัตรู ฟันคริติคอล ×3",
    cooldownMs: 14_000,
    reach: 380,
    radius: 0,
    multiplier: 3,
    durationMs: 0,
    offensive: true,
  },
};

/** Arrow rain falls in this many waves, `durationMs` apart. */
export const ARROW_RAIN_WAVES = 4;
/** Damage taken under a bulwark, as a share. */
export const BULWARK_TAKEN = 0.5;
/** A berserker's speed, as a multiple. */
export const BERSERK_SPEED = 1.3;

/** What the server tells everyone when an ultimate is used, for drawing it. */
export interface UltimateEvent {
  id: UltimateId;
  by: string;
  /** Where it lands (meteor, arrow rain), or where the hero blinked from (shadow strike). */
  x?: number;
  y?: number;
  /** The way a piercing shot flies. */
  dirX?: number;
  dirY?: number;
}
