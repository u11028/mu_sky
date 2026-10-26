// Players and monsters in 3D: an animated model, which way it faces, and the labels over its head.

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { decorateTitle, findTitle } from "../../../shared/titles.ts";
import { copyModel, loadModel, materialsOf, standOnGround } from "./assets.ts";
import type { Mount, Wing } from "../../../shared/cosmetics.ts";
import { buildWings } from "./wings.ts";

/** Animations every actor understands, mapped to each model's own clip names. */
export type Move = "idle" | "walk" | "run" | "attack" | "hit" | "death" | "spawn" | "ride";

/** KayKit heroes share one rig; their clips come from two animation files. */
const HERO_CLIPS: Record<Move, string> = {
  idle: "Idle_A",
  walk: "Walking_A",
  run: "Running_A",
  attack: "Throw",
  hit: "Hit_A",
  death: "Death_A",
  spawn: "Spawn_Ground",
  // Knees up, as if in a saddle.
  ride: "Jump_Idle",
};

/** Monster clips differ between kinds; the first one a model has wins. */
const MONSTER_CLIPS: Record<Move, string[]> = {
  idle: ["Idle", "Flying_Idle"],
  walk: ["Walk", "Fast_Flying", "Run"],
  run: ["Run", "Fast_Flying", "Walk"],
  attack: ["Bite_Front", "Punch", "Attack", "Headbutt", "Weapon"],
  hit: ["HitReact", "HitRecieve"],
  death: ["Death"],
  spawn: ["Yes", "Idle", "Flying_Idle"],
  ride: ["Idle", "Flying_Idle"],
};

/** Mount animals' clips: standing and galloping (or flying). */
const MOUNT_CLIPS = {
  idle: ["Idle", "Flying_Idle", "Velociraptor_Idle"],
  run: ["Gallop", "Fast_Flying", "Velociraptor_Run", "Walk"],
};

const HERO_HEIGHT = 2.1;

export interface Label {
  object: CSS2DObject;
  bubble: HTMLDivElement;
  title: HTMLDivElement;
  name: HTMLDivElement;
  hp: HTMLDivElement;
  hpFill: HTMLSpanElement;
  /** Health in numbers, written over the bar. */
  hpText: HTMLElement;
}

function makeLabel(height: number): Label {
  const anchor = document.createElement("div");
  anchor.className = "actor-anchor";
  const stack = document.createElement("div");
  stack.className = "actor-stack";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.hidden = true;
  const title = document.createElement("div");
  title.className = "actor-title";
  const name = document.createElement("div");
  name.className = "actor-name";
  const hp = document.createElement("div");
  hp.className = "actor-hp";
  const hpFill = document.createElement("span");
  const hpText = document.createElement("b");
  hp.append(hpFill, hpText);
  stack.append(bubble, title, name, hp);
  anchor.append(stack);
  const object = new CSS2DObject(anchor);
  object.position.y = height + 0.25;
  return { object, bubble, title, name, hp, hpFill, hpText };
}

export class Actor {
  readonly root = new THREE.Group();
  /** The body and anything worn on it (wings); lifted into the saddle when riding. */
  readonly avatar = new THREE.Group();
  private wings?: THREE.Group;
  private wingIndex = 0;
  private mount?: { model: THREE.Object3D; mixer: THREE.AnimationMixer; idle?: THREE.AnimationAction; run?: THREE.AnimationAction; current?: THREE.AnimationAction; info: Mount };
  /** Which mount the rider sits on (0 = on foot), to load it only when it changes. */
  mountKey = 0;
  readonly label: Label;
  private mixer?: THREE.AnimationMixer;
  private actions = new Map<Move, THREE.AnimationAction>();
  private base?: THREE.AnimationAction;
  private materials: THREE.MeshStandardMaterial[] = [];
  /** The weapons' own materials, lit up by shop upgrades. */
  weaponMaterials: THREE.MeshStandardMaterial[] = [];
  private flash = 0;
  /** A quick swell when struck, fading back to normal size. */
  private punch = 0;
  /** The animation holds still for a blink on a heavy hit, so the blow is felt. */
  private frozenUntil = 0;
  private bubbleTimer?: ReturnType<typeof setTimeout>;
  private titleId = "";

  /** Where the server last put it, in units; the view glides there. */
  targetX = 0;
  targetZ = 0;
  /** Which way it looks, as an angle around the up axis. */
  facing = 0;
  movedAt = 0;
  /** A one-off animation (a swing, a hit) that holds until done. */
  busyUntil = 0;
  dead = false;
  /** Running or walking pace when it moves. */
  gait: "walk" | "run" = "run";

  constructor(readonly height: number) {
    this.label = makeLabel(height);
    this.root.add(this.label.object, this.avatar);
  }

  /** Puts a model in and wires its animations. */
  attach(model: THREE.Object3D, clips: THREE.AnimationClip[], names: (move: Move) => string[]) {
    const placed = standOnGround(model, this.height);
    this.avatar.add(placed);
    this.materials = materialsOf(placed);
    this.mixer = new THREE.AnimationMixer(model);
    for (const move of Object.keys(MONSTER_CLIPS) as Move[]) {
      const clip = names(move)
        .map((wanted) => clips.find((c) => c.name === wanted || c.name.endsWith(`|${wanted}`)))
        .find(Boolean);
      if (clip) {
        this.actions.set(move, this.mixer.clipAction(clip));
      }
    }
    this.mixer.addEventListener("finished", () => this.settle());
    this.settle();
  }

  /** Back to standing, moving or sitting in the saddle after a one-off animation. */
  private settle() {
    if (!this.dead) {
      this.loop(this.mount ? "ride" : performance.now() - this.movedAt < 160 ? this.gait : "idle");
    }
  }

  /** Wings on the back (index 0 takes them off). */
  setWings(index: number, wing?: Wing) {
    if (index === this.wingIndex) {
      return;
    }
    this.wingIndex = index;
    this.wings?.removeFromParent();
    this.wings = index > 0 && wing ? buildWings(wing) : undefined;
    if (this.wings) {
      this.avatar.add(this.wings);
    }
  }

  /** Puts the rider on an animal (a loaded model), or back on foot with undefined. */
  setMount(info?: Mount, gltf?: GLTF) {
    if (this.mount) {
      this.mount.model.removeFromParent();
      this.mount = undefined;
    }
    if (info && gltf) {
      const model = copyModel(gltf);
      const placed = standOnGround(model, info.height);
      this.root.add(placed);
      const mixer = new THREE.AnimationMixer(model);
      const find = (names: string[]) => {
        const clip = names.map((name) => gltf.animations.find((c) => c.name === name || c.name.endsWith(`|${name}`))).find(Boolean);
        return clip ? mixer.clipAction(clip) : undefined;
      };
      this.mount = { model: placed, mixer, idle: find(MOUNT_CLIPS.idle), run: find(MOUNT_CLIPS.run), info };
    }
    this.avatar.position.y = info ? info.height * info.seat : 0;
    this.label.object.position.y = this.height + 0.25 + this.avatar.position.y;
    this.base = undefined;
    this.mixer?.stopAllAction();
    this.settle();
  }

  /** Plays a looping animation, blending from the current one. */
  loop(move: Move) {
    const action = this.actions.get(move) ?? this.actions.get("idle");
    if (!action || action === this.base) {
      return;
    }
    action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.18).play();
    this.base?.fadeOut(0.18);
    this.base = action;
  }

  /** Plays an animation once (a swing, a hit), then goes back to the loop. */
  once(move: Move, hold = false) {
    const action = this.actions.get(move);
    if (!action) {
      return;
    }
    this.busyUntil = performance.now() + action.getClip().duration * 1000 * 0.8;
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.08).play();
    action.clampWhenFinished = hold;
    this.base?.fadeOut(0.08);
    this.base = action;
  }

  die() {
    this.dead = true;
    this.once("death", true);
    this.label.hp.hidden = true;
  }

  revive() {
    this.dead = false;
    this.label.hp.hidden = false;
    // The fall is held on its last frame; stop it outright, or it keeps pulling the body to the ground
    // under every later animation.
    this.mixer?.stopAllAction();
    this.base = undefined;
    this.once("spawn");
  }

  /** A white-then-red flash and a jolt, fading out; `heavy` also holds the pose for a blink. */
  hurt(heavy = false) {
    this.flash = 1;
    this.punch = 1;
    if (heavy) {
      this.frozenUntil = performance.now() + 80;
    }
  }

  /** Holds the animation still for a blink: the attacker's side of a heavy blow. */
  freeze(ms: number) {
    this.frozenUntil = Math.max(this.frozenUntil, performance.now() + ms);
  }

  update(delta: number, now: number) {
    if (now >= this.frozenUntil) {
      this.mixer?.update(delta / 1000);
    }
    const moving = now - this.movedAt < 160;
    this.wings?.userData.animate(now, moving || Boolean(this.mount?.info.flies));
    if (this.mount) {
      const wanted = moving ? (this.mount.run ?? this.mount.idle) : (this.mount.idle ?? this.mount.run);
      if (wanted && wanted !== this.mount.current) {
        wanted.reset().fadeIn(0.2).play();
        this.mount.current?.fadeOut(0.2);
        this.mount.current = wanted;
      }
      this.mount.mixer.update(delta / 1000);
      if (this.mount.info.flies) {
        // A flying mount hovers and bobs above the ground.
        const hover = 0.8 + Math.sin(now / 400) * 0.15;
        this.mount.model.position.y = hover;
        this.avatar.position.y = this.mount.info.height * this.mount.info.seat + hover;
      }
    }
    if (this.punch > 0) {
      this.punch = Math.max(0, this.punch - delta / 160);
      this.root.scale.set(1 + this.punch * 0.14, 1 - this.punch * 0.1, 1 + this.punch * 0.14);
    }

    const blend = Math.min(1, delta / 90);
    const far = Math.hypot(this.targetX - this.root.position.x, this.targetZ - this.root.position.z) > 8;
    this.root.position.x += (this.targetX - this.root.position.x) * (far ? 1 : blend);
    this.root.position.z += (this.targetZ - this.root.position.z) * (far ? 1 : blend);
    // Turn the short way round.
    const turn = Math.atan2(Math.sin(this.facing - this.root.rotation.y), Math.cos(this.facing - this.root.rotation.y));
    this.root.rotation.y += turn * Math.min(1, delta / 70);

    if (!this.dead && now >= this.busyUntil) {
      this.loop(this.mount ? "ride" : moving ? this.gait : "idle");
    }

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - delta / 220);
      for (const material of this.materials) {
        // A glowing weapon keeps its own light.
        if (this.weaponMaterials.includes(material)) {
          continue;
        }
        material.emissive.setRGB(this.flash, this.flash * (this.flash > 0.6 ? 1 : 0.25), this.flash * 0.25);
      }
    }
  }

  /** Called with each new server position. */
  moveTo(x: number, z: number, now: number) {
    const dx = x - this.targetX;
    const dz = z - this.targetZ;
    if (Math.abs(dx) + Math.abs(dz) > 0.02) {
      this.facing = Math.atan2(dx, dz);
      this.movedAt = now;
    }
    this.targetX = x;
    this.targetZ = z;
  }

  /** Moves towards a point without turning or walking: small corrections that aren't real steps. */
  slideTo(x: number, z: number) {
    this.targetX = x;
    this.targetZ = z;
  }

  /** A shop-bought weapon glows in its tier's colour; undefined for plain starting gear. */
  setWeaponGlow(color?: string) {
    for (const material of this.weaponMaterials) {
      material.emissive.set(color ?? "#000000");
      material.emissiveIntensity = color ? 0.9 : 1;
    }
  }

  /** Shows or hides the model together with its labels (labels don't follow the model's visibility). */
  setVisible(visible: boolean) {
    this.root.visible = visible;
    this.label.object.visible = visible;
  }

  face(dx: number, dz: number) {
    if (dx !== 0 || dz !== 0) {
      this.facing = Math.atan2(dx, dz);
    }
  }

  setName(text: string, className: string) {
    this.label.name.textContent = text;
    this.label.name.className = `actor-name ${className}`;
  }

  setHp(hp: number, maxHp: number, hideWhenFull = false) {
    const clamped = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
    this.label.hpFill.style.width = `${clamped * 100}%`;
    this.label.hpText.textContent = `${Math.max(0, Math.round(hp))}/${maxHp}`;
    this.label.hp.classList.toggle("low", clamped <= 0.25);
    this.label.hp.classList.toggle("mid", clamped > 0.25 && clamped <= 0.5);
    this.label.hp.style.visibility = hideWhenFull && clamped >= 1 ? "hidden" : "visible";
  }

  /** The title over the name, in its colours, glow and rarity effects. */
  setTitle(titleId: string) {
    if (titleId === this.titleId) {
      return;
    }
    this.titleId = titleId;
    const title = findTitle(titleId);
    this.label.title.replaceChildren();
    if (title) {
      const badge = document.createElement("span");
      badge.className = `title-badge rarity-${title.rarity}`;
      badge.textContent = decorateTitle(title);
      badge.style.setProperty("--title-color", title.style.color);
      badge.style.setProperty("--title-glow", title.style.glow);
      this.label.title.append(badge);
    }
  }

  /** A speech bubble in the colours of the speaker's title. */
  say(text: string) {
    const title = findTitle(this.titleId);
    const bubble = this.label.bubble;
    bubble.textContent = text;
    bubble.className = `bubble ${title ? `rarity-${title.rarity}` : ""}`;
    bubble.style.setProperty("--bubble-fill", title?.style.bubbleFill ?? "#ffffff");
    bubble.style.setProperty("--bubble-border", title?.style.bubbleBorder ?? "#cfd8dc");
    bubble.style.setProperty("--bubble-text", title?.style.bubbleText ?? "#1b1b1b");
    bubble.hidden = false;
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => (bubble.hidden = true), 4000);
  }

  dispose() {
    clearTimeout(this.bubbleTimer);
    this.label.object.element.remove();
    this.root.removeFromParent();
  }
}

let heroClips: Promise<THREE.AnimationClip[]> | undefined;

/** The shared hero animations, loaded once. */
function loadHeroClips() {
  heroClips ??= Promise.all([loadModel("anims/General"), loadModel("anims/Movement")]).then((files) =>
    files.flatMap((file: GLTF) => file.animations),
  );
  return heroClips;
}

/** Finds a bone or node by name anywhere in a model; the loader drops dots from names ("handslot.r"). */
function findNode(root: THREE.Object3D, name: string) {
  const wanted = THREE.PropertyBinding.sanitizeNodeName(name);
  let found: THREE.Object3D | undefined;
  root.traverse((child) => {
    if (!found && child.name === wanted) {
      found = child;
    }
  });
  return found;
}

/** A hero model with weapons in its hands. */
export async function heroActor(hero: { id: string; right?: string; left?: string }) {
  const [gltf, clips] = await Promise.all([loadModel(`heroes/${hero.id}`), loadHeroClips()]);
  const model = copyModel(gltf, { ownMaterials: true });
  // Knights wear a visor-less helmet; the face shows, like the pack's own pictures.
  findNode(model, "Knight_HelmetVisor")?.removeFromParent();
  const weaponMaterials: THREE.MeshStandardMaterial[] = [];
  for (const [side, weapon] of [
    ["handslot.r", hero.right],
    ["handslot.l", hero.left],
  ] as const) {
    const slot = weapon && findNode(model, side);
    if (slot) {
      const item = copyModel(await loadModel(`weapons/${weapon}`), { ownMaterials: true });
      slot.add(item);
      weaponMaterials.push(...materialsOf(item));
    }
  }
  const actor = new Actor(HERO_HEIGHT);
  actor.attach(model, clips, (move) => [HERO_CLIPS[move]]);
  actor.weaponMaterials = weaponMaterials;
  return actor;
}

/** A monster model with its own animations. */
export async function monsterActor(model: string, height: number) {
  const gltf = await loadModel(`monsters/${model}`);
  const actor = new Actor(height);
  actor.gait = "walk";
  actor.attach(copyModel(gltf, { ownMaterials: true }), gltf.animations, (move) => MONSTER_CLIPS[move]);
  return actor;
}
