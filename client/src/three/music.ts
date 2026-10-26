// Background music: each region's own tune, and a fight theme while a boss is near. Tunes cross-fade.
//
// Loudness goes through Web Audio (a gain per tune) where the browser has it: iPhones ignore an
// audio element's own volume, so fading or turning it down there did nothing. Turning the music off
// pauses every tune at once rather than fading, so it is silent the moment the switch is pressed.

import type { RegionId } from "../../../shared/regions.ts";
import { onSettings, type Settings } from "../settings.ts";

const FADE_MS = 1200;

interface Tune {
  track: string;
  audio: HTMLAudioElement;
  gain?: GainNode;
}

let playing: Tune | undefined;
let wanted = "";
let options: Settings | undefined;
let context: AudioContext | undefined;
/** Every tune started and not yet stopped: a fading one included. */
const tunes = new Set<Tune>();

function volume() {
  return options?.music ? options.musicVolume * 0.6 : 0;
}

/** Web Audio starts suspended until a tap; any tap or key wakes it. */
function wake() {
  void context?.resume();
}
addEventListener("pointerdown", wake, true);
addEventListener("keydown", wake, true);

function routed(audio: HTMLAudioElement): GainNode | undefined {
  try {
    context ??= new AudioContext();
    wake();
    const gain = context.createGain();
    gain.gain.value = 0;
    context.createMediaElementSource(audio).connect(gain).connect(context.destination);
    return gain;
  } catch {
    // No Web Audio: the element's own volume will have to do.
    return undefined;
  }
}

function setLevel(tune: Tune, level: number) {
  if (tune.gain && context) {
    tune.gain.gain.cancelScheduledValues(context.currentTime);
    tune.gain.gain.setValueAtTime(level, context.currentTime);
  } else {
    tune.audio.volume = level;
  }
}

/** Fades a tune towards a loudness, then calls back. */
function fade(tune: Tune, to: number, done?: () => void) {
  if (tune.gain && context) {
    const now = context.currentTime;
    tune.gain.gain.cancelScheduledValues(now);
    tune.gain.gain.setValueAtTime(tune.gain.gain.value, now);
    tune.gain.gain.linearRampToValueAtTime(to, now + FADE_MS / 1000);
  } else {
    const from = tune.audio.volume;
    const began = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - began) / FADE_MS);
      tune.audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t < 1 && tunes.has(tune)) {
        requestAnimationFrame(step);
      }
    };
    step();
  }
  // A timer, not animation frames: those stop in a hidden tab and the tune would never pause.
  if (done) {
    setTimeout(done, FADE_MS);
  }
}

function halt(tune: Tune) {
  tune.audio.pause();
  tunes.delete(tune);
}

function switchTo(track: string) {
  if (playing?.track === track) {
    return;
  }
  const old = playing;
  if (old) {
    fade(old, 0, () => halt(old));
  }
  const audio = new Audio(`assets/music/${track}.ogg`);
  audio.loop = true;
  const tune: Tune = { track, audio, gain: routed(audio) };
  if (!tune.gain) {
    audio.volume = 0;
  }
  tunes.add(tune);
  playing = tune;
  const start = () =>
    audio.play().then(() => {
      // Turned off while it was loading: stay silent.
      if (playing === tune) {
        fade(tune, volume());
      } else {
        halt(tune);
      }
    });
  // Browsers only allow sound after a tap or key press; the join button is one.
  start().catch(() => {
    const retry = () => {
      if (playing === tune) {
        start().catch(() => {});
      }
    };
    window.addEventListener("pointerdown", retry, { once: true });
  });
}

/** The tune for where the player is; `boss` switches to the fight theme. */
export function playMusic(region: RegionId, boss = false) {
  wanted = boss || region === "dungeon" ? "boss" : region;
  if (options?.music) {
    switchTo(wanted);
  }
}

/** Leaving the game: the tune fades out. */
export function stopMusic() {
  const old = playing;
  playing = undefined;
  if (old) {
    fade(old, 0, () => halt(old));
  }
}

/** The music switch turned off: silence now, every tune. */
function silence() {
  playing = undefined;
  for (const tune of [...tunes]) {
    setLevel(tune, 0);
    halt(tune);
  }
}

onSettings((next) => {
  options = next;
  if (!next.music) {
    silence();
  } else if (wanted) {
    if (playing) {
      setLevel(playing, volume());
    } else {
      switchTo(wanted);
    }
  }
});
