// Short sound effects, decoded once and played without delay.

const SOUNDS = ["hit", "swing", "levelup", "dead"] as const;
export type Sound = (typeof SOUNDS)[number];

let context: AudioContext | undefined;
const buffers = new Map<Sound, AudioBuffer>();

/** Loads the sounds; browsers only let them play after the first tap or key press. */
export function loadSounds() {
  if (context) {
    return;
  }
  context = new AudioContext();
  for (const sound of SOUNDS) {
    fetch(`assets/sfx/${sound}.wav`)
      .then((response) => response.arrayBuffer())
      .then((data) => context!.decodeAudioData(data))
      .then((buffer) => buffers.set(sound, buffer))
      .catch(() => {
        // A missing sound just stays silent.
      });
  }
  const unlock = () => void context?.resume();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export function play(sound: Sound, volume = 0.4) {
  const buffer = buffers.get(sound);
  if (!context || !buffer || context.state !== "running") {
    return;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(context.destination);
  source.start();
}
