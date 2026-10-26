// "Auto" graphics: watches how many frames the device draws and steps the detail down when it
// struggles, back up when it has had room to spare for a while. The step it settles on is kept, so
// the next visit starts there.
//
// A phone saving its battery may hold every page to 30 frames a second however light the game is:
// so a step down needs the frame rate well below the best this device has shown, not just low.

export type Level = "high" | "medium" | "low" | "minimal";

export const LEVELS: readonly Level[] = ["high", "medium", "low", "minimal"];

const KEY = "mu-sky.auto-quality";
/** Frames are counted over windows this long. */
const WINDOW_MS = 2000;
/** Arriving in a region compiles shaders and loads models: those first seconds say nothing. */
const SETTLE_MS = 5000;

function saved(): Level {
  try {
    const level = localStorage.getItem(KEY) as Level | null;
    if (level && LEVELS.includes(level)) {
      return level;
    }
  } catch {
    // Not remembered: start from the device's kind.
  }
  return matchMedia("(pointer: coarse)").matches ? "medium" : "high";
}

export class AutoQuality {
  level: Level = saved();
  private frames = 0;
  private windowStart = 0;
  private startedAt = performance.now();
  private best = 0;
  private slow = 0;
  private smooth = 0;
  private steppedDownAt = 0;

  /** Counts one frame; returns the new level when it changed. */
  frame(now: number): Level | undefined {
    if (now - this.startedAt < SETTLE_MS) {
      return undefined;
    }
    if (!this.windowStart) {
      this.windowStart = now;
    }
    this.frames++;
    const span = now - this.windowStart;
    if (span < WINDOW_MS) {
      return undefined;
    }
    const fps = (this.frames * 1000) / span;
    this.frames = 0;
    this.windowStart = now;
    // A hidden tab, or a pause long enough to skew the count: not a measure of the device.
    if (document.hidden || span > WINDOW_MS * 1.5) {
      return undefined;
    }
    this.best = Math.max(this.best, fps);

    const struggling = fps < 24 || (fps < 40 && fps < this.best * 0.75);
    const roomToSpare = fps >= Math.max(50, this.best * 0.92);
    this.slow = struggling ? this.slow + 1 : 0;
    this.smooth = roomToSpare ? this.smooth + 1 : 0;

    const index = LEVELS.indexOf(this.level);
    // Two slow windows in a row (4 s): a step down.
    if (this.slow >= 2 && index < LEVELS.length - 1) {
      this.steppedDownAt = now;
      return this.set(LEVELS[index + 1]);
    }
    // Half a minute with room to spare, and not just after stepping down: try a step up.
    if (this.smooth >= 15 && index > 0 && now - this.steppedDownAt > 60_000) {
      return this.set(LEVELS[index - 1]);
    }
    return undefined;
  }

  private set(level: Level) {
    this.level = level;
    this.slow = 0;
    this.smooth = 0;
    try {
      localStorage.setItem(KEY, level);
    } catch {
      // Only for this visit, then.
    }
    return level;
  }
}
