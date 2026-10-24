// The player's own choices: music, sound and how much the graphics may ask of the device.
// Kept in this browser only.

export type Quality = "high" | "medium" | "low";

export interface Settings {
  music: boolean;
  musicVolume: number;
  sound: boolean;
  quality: Quality;
}

const KEY = "mu-sky.settings";
const listeners = new Set<(settings: Settings) => void>();

/** Phones start one step lower, so the game runs smoothly before anyone touches a setting. */
const DEFAULTS: Settings = {
  music: true,
  musicVolume: 0.5,
  sound: true,
  quality: matchMedia("(pointer: coarse)").matches ? "medium" : "high",
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
