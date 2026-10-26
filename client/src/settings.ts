// The player's own choices: music, sound and how much the graphics may ask of the device.
// Kept in this browser only.

/** "auto" lets the game find the most the device can draw smoothly (see three/autoQuality.ts). */
export type Quality = "auto" | "high" | "medium" | "low";

export interface Settings {
  music: boolean;
  musicVolume: number;
  sound: boolean;
  /** The phone buzzes on blows taken, critical hits and big moments. */
  vibrate: boolean;
  quality: Quality;
}

const KEY = "mu-sky.settings";
const listeners = new Set<(settings: Settings) => void>();

const DEFAULTS: Settings = {
  music: true,
  musicVolume: 0.5,
  sound: true,
  vibrate: true,
  quality: "auto",
};

let current: Settings = { ...DEFAULTS };
try {
  current = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
} catch {
  // Blocked storage or an old, broken value: the defaults will do.
}

export function settings() {
  return current;
}

export function changeSettings(change: Partial<Settings>) {
  current = { ...current, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not remembered, but still applied for now.
  }
  listeners.forEach((listener) => listener(current));
}

/** Calls back now and on every change. */
export function onSettings(listener: (settings: Settings) => void) {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}
