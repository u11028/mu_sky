// Background music: each region's own tune, and a fight theme while a boss is near. Tunes cross-fade.

import type { RegionId } from "../../../shared/regions.ts";
import { onSettings, type Settings } from "../settings.ts";

const FADE_MS = 1200;

let playing: { track: string; audio: HTMLAudioElement } | undefined;
let wanted = "";
let options: Settings | undefined;

function volume() {
  return options?.music ? options.musicVolume * 0.6 : 0;
}

/** Fades one audio element towards a volume, then calls back. */
function fade(audio: HTMLAudioElement, to: number, done?: () => void) {
  const from = audio.volume;
  const began = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - began) / FADE_MS);
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      done?.();
    }
  };
  step();
}

function switchTo(track: string) {
  if (playing?.track === track) {
    return;
  }
  const old = playing;
  if (old) {
    fade(old.audio, 0, () => old.audio.pause());
  }
  const audio = new Audio(`assets/music/${track}.ogg`);
  audio.loop = true;
  audio.volume = 0;
  playing = { track, audio };
  // Browsers only allow sound after a tap or key press; the join button is one.
  audio
    .play()
    .then(() => fade(audio, volume()))
    .catch(() => {
      const retry = () => playing?.audio === audio && audio.play().then(() => fade(audio, volume())).catch(() => {});
      window.addEventListener("pointerdown", retry, { once: true });
    });
}

/** The tune for where the player is; `boss` switches to the fight theme. */
export function playMusic(region: RegionId, boss = false) {
  wanted = boss ? "boss" : region;
  if (options?.music) {
    switchTo(wanted);
  }
}

export function stopMusic() {
  const old = playing;
  playing = undefined;
  if (old) {
    fade(old.audio, 0, () => old.audio.pause());
  }
}

onSettings((next) => {
  options = next;
  if (!next.music) {
    stopMusic();
  } else if (wanted) {
    if (playing) {
      playing.audio.volume = volume();
    } else {
      switchTo(wanted);
    }
  }
});
