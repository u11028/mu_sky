// The game world in 3D: draws a region and everyone in it, follows the local player, and turns
// taps and keys into the same messages the server has always understood.

import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Room } from "colyseus.js";
import { REGIONS, type RegionId } from "../../../shared/regions.ts";
import { type HitEvent, SKILLS, type SkillId } from "../../../shared/combat.ts";
import { type Hero, heroOf, type ShotEvent } from "../../../shared/heroes.ts";
import { regionLayout, slide } from "../../../shared/regionThemes.ts";
import { BOSS_ATTACK_RANGE, monsterKind, REGION_MONSTERS } from "../../../shared/monsters.ts";
import { PLAYER_SPEED, WORLD_HEIGHT, WORLD_WIDTH } from "../../../shared/world.ts";
import { Actor, heroActor, monsterActor } from "./actors.ts";
import { preload } from "./assets.ts";
import { Effects } from "./effects.ts";
import { BORDER_MODELS, CLOUD_MODELS, GRASS_MODELS, propModels, PX, REGION_LOOKS } from "./look.ts";
import { buildScenery, type Scenery } from "./scenery.ts";
import { loadSounds, play } from "./sfx.ts";
import { playMusic } from "./music.ts";
import { onSettings, type Settings } from "../settings.ts";
import { WEAPON_TIERS } from "../../../shared/items.ts";
import { MOUNTS, WINGS } from "../../../shared/cosmetics.ts";
import { loadModel } from "./assets.ts";

/** The local player, as the HUD shows it. */
export interface SelfState {
  name: string;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  gm: boolean;
  gold: number;
  potions: number;
  weapon: number;
  armor: number;
  team: string;
  wing: number;
  mount: number;
  riding: boolean;
}

/** Another player in this region, for the team panel's invite list. */
export interface Nearby {
  id: string;
  name: string;
  level: number;
  mate: boolean;
}

interface PlayerState {
  name: string;
  x: number;
  y: number;
  skin: number;
  title: string;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  gm: boolean;
  god: boolean;
  gold: number;
  potions: number;
  weapon: number;
  armor: number;
  team: string;
  wing: number;
  mount: number;
  riding: boolean;
}

interface MonsterState {
  kind: string;
  x: number;
  y: number;
  level: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}

/** Where the camera sits relative to the player it follows: behind and above, looking down. */
const CAMERA_OFFSET = new THREE.Vector3(0, 12.5, 15);
/** Props this see-through when they hide the player. */
const FADED = 0.28;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.7;

/** The way a key moves the player, as x and y on the server's map. */
const KEY_DIRECTIONS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
};

/** Swing colours by class: the blade's own light. Quick fighters strike twice. */
const SLASHES: Record<string, { color: string; twin?: boolean }> = {
  Knight: { color: "#ffe9a8" },
  Skeleton_Warrior: { color: "#d6f5ff" },
  Barbarian: { color: "#ff9a4d" },
  Skeleton_Rogue: { color: "#ff7a59" },
  Rogue: { color: "#8ff0ff", twin: true },
  Skeleton_Minion: { color: "#b8ff9a", twin: true },
};

/** The glow of each kind of shot. */
const SHOT_COLORS: Record<ShotEvent["projectile"], string> = {
  arrow: "#ffe2a0",
  bolt: "#cfe8ff",
  magic: "#b88cff",
};

/** Keys for the skills: Q E R F, or 1 to 4 in the same order as the buttons. */
const SKILL_KEYS: Record<string, SkillId> = {
  KeyQ: "spin",
  Digit1: "spin",
  KeyE: "dash",
  Digit2: "dash",
  KeyR: "strike",
  Digit3: "strike",
  KeyF: "heal",
  Digit4: "heal",
};

export class World3D {
  private renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  private labels = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.5, 600);
  private sun = new THREE.DirectionalLight();
  private effects = new Effects(this.scene);
  private scenery?: Scenery;
  private players = new Map<string, Actor>();
  private monsters = new Map<string, { actor: Actor; boss: boolean; level: number }>();
  /** Actors still loading their model; a removal in the meantime cancels them. */
  private loading = new Set<string>();
  private auras = new Map<string, THREE.Mesh>();
  private marker: THREE.Mesh;
  private keys = new Set<string>();
  private sentDir = { x: 0, y: 0 };
  /** The on-screen joystick's direction; wins over the keys while pushed. */
  private stick = { x: 0, y: 0 };
  /** Each player's class, for how their attacks look. */
  private heroes = new Map<string, Hero>();
  /** Arrows, bolts and orbs in flight, by the server's shot id. */
  private shots = new Map<number, { object: THREE.Object3D; dx: number; dz: number; speed: number; left: number }>();
  /**
   * Where the local player is drawn, in world pixels: moved at once by the player's own input
   * and gently kept in step with the server, so walking never waits for the network.
   */
  private predicted?: { x: number; y: number };
  private server = { x: 0, y: 0 };
  /** When the server last moved the local player; settling waits until it has stopped too. */
  private serverMovedAt = 0;
  private tapTarget?: { x: number; y: number };
  /** The local player's team, to tell teammates apart. */
  private myTeam = "";
  private playerStates = new Map<string, PlayerState>();
  private bossNear = false;
  private zoom = 1;
  private focus = new THREE.Vector3(WORLD_WIDTH / PX / 2, 0, WORLD_HEIGHT / PX / 2);
  private myLevel = 1;
  private frame = 0;
  private frameCount = 0;
  private last = performance.now();
  private disposed = false;
  private resize = new ResizeObserver(() => this.fit());
  private cleanup: (() => void)[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly room: Room,
    private readonly regionId: RegionId,
    private readonly chatInput: HTMLInputElement,
    private readonly onPlayerCount: (count: number) => void,
    private readonly onSelf: (self: SelfState) => void,
    private readonly onLoading: (share: number) => void,
  ) {
    const coarse = matchMedia("(pointer: coarse)").matches;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "world-canvas";
    this.labels.domElement.className = "world-labels";
    container.append(this.renderer.domElement, this.labels.domElement);

    const look = REGION_LOOKS[regionId];
    this.sun.color.set(look.sun);
    this.sun.intensity = look.sunStrength;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(coarse ? 1024 : 2048);
    Object.assign(this.sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.scene.add(this.marker);

    this.resize.observe(container);
    this.cleanup.push(onSettings((options) => this.applyQuality(options)));
    this.fit();
    loadSounds();
    void this.start();
  }

  // ---- Loading ----

  private async start() {
    const { kinds, boss } = REGION_MONSTERS[this.regionId];
    const monsterModels = [...kinds, boss].map((kind) => `monsters/${monsterKind(kind)!.model}`);
    await preload(
      [
        ...propModels(),
        ...BORDER_MODELS,
        ...CLOUD_MODELS,
        ...GRASS_MODELS,
        ...monsterModels,
        "anims/General",
        "anims/Movement",
      ],
      (share) => this.onLoading(share * 0.85),
    );
    if (this.disposed) {
      return;
    }
    this.scenery = await buildScenery(this.scene, this.regionId);
    if (this.disposed) {
      return;
    }
    this.onLoading(1);
    playMusic(this.regionId);
    this.listen();
    this.bindInput();
    this.loop();
    this.showBanner();
  }

  private listen() {
    const state = this.room.state as any;
    state.players.onAdd((player: any, id: string) => {
      void this.addPlayer(id, player);
      player.onChange(() => this.updatePlayer(id, player));
    });
    state.players.onRemove((_player: any, id: string) => {
      this.loading.delete(id);
      this.playerStates.delete(id);
      this.players.get(id)?.dispose();
      this.players.delete(id);
      this.auras.get(id)?.removeFromParent();
      this.auras.delete(id);
      this.onPlayerCount(this.players.size);
    });
    state.monsters.onAdd((monster: any, id: string) => {
      void this.addMonster(id, monster);
      monster.onChange(() => this.updateMonster(id, monster));
    });
    state.monsters.onRemove((_monster: any, id: string) => {
      this.monsters.get(id)?.actor.dispose();
      this.monsters.delete(id);
    });
  }

  private async addPlayer(id: string, player: PlayerState) {
    this.loading.add(id);
    const hero = heroOf(player.skin);
    this.heroes.set(id, hero);
    const actor = await heroActor(hero);
    if (!this.loading.delete(id) || this.disposed) {
      actor.dispose();
      return;
    }
    actor.targetX = player.x / PX;
    actor.targetZ = player.y / PX;
    actor.root.position.set(actor.targetX, 0, actor.targetZ);
    this.scene.add(actor.root);
    this.players.set(id, actor);
    this.updatePlayer(id, player);
    this.onPlayerCount(this.players.size);
  }

  private async addMonster(id: string, monster: MonsterState) {
    const kind = monsterKind(monster.kind);
    if (!kind) {
      return;
    }
    this.loading.add(id);
    const actor = await monsterActor(kind.model, kind.height);
    if (!this.loading.delete(id) || this.disposed) {
      actor.dispose();
      return;
    }
    actor.targetX = monster.x / PX;
    actor.targetZ = monster.y / PX;
    actor.root.position.set(actor.targetX, 0, actor.targetZ);
    actor.label.object.element.classList.add(kind.boss ? "boss" : "monster");
    this.scene.add(actor.root);
    this.monsters.set(id, { actor, boss: Boolean(kind.boss), level: kind.level });
    actor.setName(`${kind.boss ? "👑 " : ""}Lv.${kind.level} ${kind.name}`, this.danger(kind.level, Boolean(kind.boss)));
    this.updateMonster(id, monster);
  }

  private updatePlayer(id: string, player: PlayerState) {
    const actor = this.players.get(id);
    if (!actor) {
      return;
    }
    const now = performance.now();
    const isMe = id === this.room.sessionId;
    if (isMe) {
      if (player.x !== this.server.x || player.y !== this.server.y) {
        this.serverMovedAt = now;
      }
      this.server = { x: player.x, y: player.y };
      // First sight, a respawn, a dash or a GM's teleport: jump to where the server says.
      if (!this.predicted || player.dead || Math.hypot(player.x - this.predicted.x, player.y - this.predicted.y) > 140) {
        this.predicted = { x: player.x, y: player.y };
        this.tapTarget = undefined;
        actor.moveTo(player.x / PX, player.y / PX, now);
      }
    } else {
      actor.moveTo(player.x / PX, player.y / PX, now);
    }
    this.playerStates.set(id, player);
    if (isMe && this.myTeam !== player.team) {
      this.myTeam = player.team;
      // Teammates' names turn green; refresh everyone.
      this.playerStates.forEach((other, otherId) => otherId !== id && this.updatePlayer(otherId, other));
    }
    const mate = !isMe && player.team !== "" && player.team === this.myTeam;
    actor.setName(
      `${player.gm ? "[GM] " : ""}Lv.${player.level} ${player.name}`,
      player.gm ? "gm" : isMe ? "me" : mate ? "mate" : "",
    );
    actor.setWeaponGlow(WEAPON_TIERS[player.weapon]?.color);
    actor.setWings(player.wing, WINGS[player.wing]);
    this.setMount(actor, player.riding && !player.dead ? player.mount : 0);
    actor.setHp(player.hp, player.maxHp);
    actor.setTitle(player.title);
    if (player.dead && !actor.dead) {
      actor.die();
    } else if (!player.dead && actor.dead) {
      actor.revive();
      this.effects.dust(actor.root.position, 1.4, "#fff6c9");
    }
    this.setAura(id, actor, player.god);

    if (isMe) {
      this.onSelf({
        name: player.name,
        level: player.level,
        xp: player.xp,
        hp: player.hp,
        maxHp: player.maxHp,
        dead: player.dead,
        gm: player.gm,
        gold: player.gold,
        potions: player.potions,
        weapon: player.weapon,
        armor: player.armor,
        team: player.team,
        wing: player.wing,
        mount: player.mount,
        riding: player.riding,
      });
      if (this.myLevel !== player.level) {
        this.myLevel = player.level;
        this.monsters.forEach(({ actor: monster, boss, level }) => {
          monster.label.name.className = `actor-name ${this.danger(level, boss)}`;
        });
      }
    }
  }

  private updateMonster(id: string, monster: MonsterState) {
    const entry = this.monsters.get(id);
    if (!entry) {
      return;
    }
    const { actor, boss } = entry;
    actor.moveTo(monster.x / PX, monster.y / PX, performance.now());
    actor.setHp(monster.hp, monster.maxHp, !boss);
    if (monster.dead && !actor.dead) {
      actor.die();
      // The name goes at once; the body after its fall.
      actor.label.object.visible = false;
      setTimeout(() => {
        if (actor.dead) {
          actor.setVisible(false);
        }
      }, 1600);
    } else if (!monster.dead && actor.dead) {
      actor.setVisible(true);
      actor.root.position.set(actor.targetX, 0, actor.targetZ);
      actor.revive();
      this.effects.dust(actor.root.position, boss ? 3 : 1.2, "#e9d8ff");
    }
  }

  /** Monster names: red when far stronger than the player, orange when a little, white otherwise. */
  private danger(level: number, boss: boolean) {
    const gap = level - this.myLevel;
    return boss ? "boss" : gap >= 3 ? "danger" : gap >= 1 ? "tough" : "";
  }

  /** Puts a player on their mount, loading the animal the first time, or back on foot with 0. */
  private setMount(actor: Actor, index: number) {
    if (actor.mountKey === index) {
      return;
    }
    actor.mountKey = index;
    const info = MOUNTS[index];
    if (!index || !info?.model) {
      actor.setMount();
      return;
    }
    void loadModel(`mounts/${info.model}`).then((gltf) => {
      // Still the same choice once the model has arrived?
      if (actor.mountKey === index && !this.disposed) {
        actor.setMount(info, gltf);
        this.effects.dust(actor.root.position, 1.2, "#f4e9d8");
      }
    });
  }

  /** The golden ring under an immortal GM. */
  private setAura(id: string, actor: Actor, on: boolean) {
    const aura = this.auras.get(id);
    if (on && !aura) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.15, 40),
        new THREE.MeshBasicMaterial({
          color: "#ffd60a",
          transparent: true,
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      actor.root.add(ring);
      this.auras.set(id, ring);
    } else if (!on && aura) {
      aura.removeFromParent();
      this.auras.delete(id);
    }
  }

  // ---- What the page tells the world ----

  showBubble(id: string, text: string) {
    this.players.get(id)?.say(text);
  }

  showSwing(id: string, dirX: number, dirY: number) {
    const actor = this.players.get(id);
    if (!actor) {
      return;
    }
    actor.face(dirX, dirY);
    actor.once("attack");
    const hero = this.heroes.get(id);
    if (hero?.attack.kind === "ranged") {
      // The shot itself arrives as its own message; here only the flash at the hands.
      const hands = actor.root.position.clone().add(new THREE.Vector3(dirX * 0.7, 1.2, dirY * 0.7));
      this.effects.muzzle(hands, SHOT_COLORS[hero.attack.projectile]);
    } else {
      const look = SLASHES[hero?.id ?? ""] ?? SLASHES.Knight;
      this.effects.slash(actor.root.position, Math.atan2(dirX, dirY), look.color, look.twin);
    }
    this.playNear("swing", actor, 0.25);
  }

  showHit(event: HitEvent) {
    const actor = this.players.get(event.target) ?? this.monsters.get(event.target)?.actor;
    if (!actor) {
      return;
    }
    const head = actor.root.position.clone().add(new THREE.Vector3(0, actor.height + 0.4, 0));
    const isMe = event.target === this.room.sessionId;
    if (event.blocked) {
      this.effects.floatText(head, "อมตะ!", "immortal");
      return;
    }

    const mine = event.attacker === this.room.sessionId;
    actor.hurt(mine || Boolean(event.crit));
    const body = actor.root.position.clone().add(new THREE.Vector3(0, actor.height * 0.55, 0));
    this.effects.impact(body, event.crit ? "#ffd60a" : isMe ? "#ff6b6b" : "#fff3b0", Boolean(event.crit));
    this.effects.floatText(head, event.crit ? `${event.damage}!` : `${event.damage}`, event.crit ? "crit" : isMe ? "hurt" : "damage");
    this.playNear("hit", actor, 0.35);
    if (!event.killed && performance.now() >= actor.busyUntil) {
      actor.once("hit");
    }
    if (isMe) {
      this.shake(event.killed ? 0.6 : 0.25);
    } else if (mine) {
      // Your own blows land with a little kick.
      this.shake(event.crit ? 0.22 : 0.08);
    }
    if (event.killed) {
      const boss = this.monsters.get(event.target)?.boss;
      this.effects.dust(actor.root.position, boss ? 3 : 1.3, "#d6c7b4");
      if (isMe) {
        play("dead", 0.35);
      }
      if (boss) {
        this.shake(0.8);
      }
    }
  }

  /** A shot leaves someone's hands: an arrow, a crossbow bolt or a glowing orb. */
  showShot(shot: ShotEvent) {
    const object = projectileModel(shot.projectile);
    object.position.set(shot.x / PX, 1.15, shot.y / PX);
    object.rotation.y = Math.atan2(shot.dx, shot.dy);
    this.scene.add(object);
    this.shots.set(shot.id, {
      object,
      dx: shot.dx,
      dz: shot.dy,
      speed: shot.speed / PX,
      left: shot.range / PX,
    });
  }

  /** A shot hit something or flew its full range. */
  endShot(id: number, x: number, y: number) {
    const shot = this.shots.get(id);
    if (!shot) {
      return;
    }
    shot.object.removeFromParent();
    this.shots.delete(id);
    const at = new THREE.Vector3(x / PX, 1.1, y / PX);
    const color = shot.object.userData.color ?? "#fff3b0";
    if (shot.object.userData.kind === "magic") {
      this.effects.explosion(at, color);
    } else {
      this.effects.sparks(at, color, 6);
    }
  }

  /** Coins fly up from a fallen monster: the gold the local player got. */
  showGold(amount: number, x: number, y: number) {
    const at = new THREE.Vector3(x / PX, 1.4, y / PX);
    this.effects.sparks(at, "#ffd60a", 10);
    this.effects.floatText(at.clone().add(new THREE.Vector3(0, 0.6, 0)), `+${amount} 💰`, "gold");
    play("coin", 0.35);
  }

  /** A potion drunk: a green glow and the health it gave. */
  showPotion(by: string, amount: number) {
    const actor = this.players.get(by);
    if (!actor) {
      return;
    }
    this.effects.heal(actor.root.position);
    this.effects.floatText(actor.root.position.clone().add(new THREE.Vector3(0, actor.height + 0.4, 0)), `+${amount}`, "heal");
    this.playNear("potion", actor, 0.35);
  }

  /** New gear from the shop: a flash of light around the player. */
  showUpgrade(id: string) {
    const actor = this.players.get(id);
    if (actor) {
      this.effects.levelUp(actor.root.position);
      this.playNear("buy", actor, 0.4);
    }
  }

  /** The other players in this region, for inviting to a team. */
  nearbyPlayers(): Nearby[] {
    return [...this.playerStates]
      .filter(([id]) => id !== this.room.sessionId)
      .map(([id, player]) => ({
        id,
        name: player.name,
        level: player.level,
        mate: player.team !== "" && player.team === this.myTeam,
      }));
  }

  showMonsterAttack(id: string) {
    const entry = this.monsters.get(id);
    if (!entry) {
      return;
    }
    entry.actor.once("attack");
    if (entry.boss) {
      this.effects.shockwave(entry.actor.root.position, BOSS_ATTACK_RANGE / PX, "#ff4d4d");
      this.playNear("hit", entry.actor, 0.5);
    }
  }

  showLevelUp(id: string) {
    const actor = this.players.get(id);
    if (!actor) {
      return;
    }
    this.effects.levelUp(actor.root.position);
    this.effects.floatText(actor.root.position.clone().add(new THREE.Vector3(0, actor.height + 0.8, 0)), "LEVEL UP!", "levelup");
    this.playNear("levelup", actor, 0.4);
  }

  showXp(amount: number) {
    const actor = this.players.get(this.room.sessionId);
    if (actor) {
      this.effects.floatText(actor.root.position.clone().add(new THREE.Vector3(0, actor.height + 0.2, 0)), `+${amount} XP`, "xp");
    }
  }

  showSkill(message: { id: SkillId; by: string; fromX?: number; fromY?: number; x?: number; y?: number; amount?: number }) {
    const actor = this.players.get(message.by);
    if (!actor) {
      return;
    }
    if (message.id === "strike") {
      actor.once("attack");
      const at = new THREE.Vector3((message.x ?? 0) / PX, 0, (message.y ?? 0) / PX);
      this.effects.lightning(at, SKILLS.strike.radius / PX);
      this.playNear("hit", actor, 0.55);
      if (message.by === this.room.sessionId) {
        this.shake(0.3);
      }
      return;
    }
    if (message.id === "heal") {
      this.effects.heal(actor.root.position);
      this.effects.floatText(actor.root.position.clone().add(new THREE.Vector3(0, actor.height + 0.4, 0)), `+${message.amount ?? 0}`, "heal");
      this.playNear("levelup", actor, 0.25);
      return;
    }
    if (message.id === "spin") {
      this.effects.whirl(actor.root.position, SKILLS.spin.radius / PX);
      actor.once("attack");
      // A full turn of the body with the blade.
      const start = actor.root.rotation.y;
      const began = performance.now();
      const spin = () => {
        const t = (performance.now() - began) / 320;
        actor.root.rotation.y = start + Math.min(1, t) * Math.PI * 2;
        if (t < 1) {
          requestAnimationFrame(spin);
        }
      };
      spin();
      this.playNear("swing", actor, 0.4);
      return;
    }

    // Dash: dust where it started and along the way; the actor jumps straight to the end.
    const from = new THREE.Vector3((message.fromX ?? 0) / PX, 0, (message.fromY ?? 0) / PX);
    const to = new THREE.Vector3(actor.targetX, 0, actor.targetZ);
    for (let i = 0; i < 4; i++) {
      this.effects.dust(from.clone().lerp(to, i / 4), 0.8);
    }
    actor.root.position.copy(to);
    this.playNear("swing", actor, 0.25);
  }

  attack() {
    if (!this.players.get(this.room.sessionId)?.dead) {
      this.room.send("attack");
    }
  }

  useSkill(id: SkillId) {
    if (!this.players.get(this.room.sessionId)?.dead) {
      this.room.send("skill", { id });
    }
  }

  // ---- Input ----

  private bindInput() {
    const canvas = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ground = this.scene.getObjectByName("ground")!;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;

    const down = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size > 1) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1),
        this.camera,
      );
      const hit = raycaster.intersectObject(ground)[0];
      if (hit) {
        this.room.send("target", { x: hit.point.x * PX, y: hit.point.z * PX });
        this.tapTarget = { x: hit.point.x * PX, y: hit.point.z * PX };
        this.marker.position.set(hit.point.x, hit.point.y + 0.08, hit.point.z);
        this.marker.scale.setScalar(1.4);
        (this.marker.material as THREE.MeshBasicMaterial).opacity = 1;
      }
    };
    // Two fingers pinch to zoom on phones.
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) {
        return;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) {
          this.zoom = THREE.MathUtils.clamp(this.zoom * (pinch / distance), MIN_ZOOM, MAX_ZOOM);
        }
        pinch = distance;
      }
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      pinch = 0;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom * (1 + Math.sign(event.deltaY) * 0.1), MIN_ZOOM, MAX_ZOOM);
    };
    const typing = () => document.activeElement === this.chatInput;
    const keyDown = (event: KeyboardEvent) => {
      if (typing()) {
        return;
      }
      if (KEY_DIRECTIONS[event.code]) {
        this.keys.add(event.code);
      } else if (!event.repeat && (event.code === "Space" || event.code === "KeyJ")) {
        event.preventDefault();
        this.attack();
      } else if (!event.repeat && SKILL_KEYS[event.code]) {
        this.useSkill(SKILL_KEYS[event.code]);
      }
    };
    const keyUp = (event: KeyboardEvent) => this.keys.delete(event.code);
    const blur = () => this.keys.clear();

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
    });
  }

  /** The joystick's push, x and y from -1 to 1 (0, 0 when let go). */
  setStick(x: number, y: number) {
    this.stick = { x, y };
  }

  /** Where the player is steering, from the joystick or the keys; 0, 0 when neither. */
  private inputDirection() {
    if (Math.hypot(this.stick.x, this.stick.y) > 0.2) {
      // Rounded, so a resting thumb doesn't send a message every frame.
      return { x: Math.round(this.stick.x * 20) / 20, y: Math.round(this.stick.y * 20) / 20 };
    }
    let x = 0;
    let y = 0;
    if (document.activeElement !== this.chatInput) {
      for (const code of this.keys) {
        x += KEY_DIRECTIONS[code][0];
        y += KEY_DIRECTIONS[code][1];
      }
    }
    return { x: Math.sign(x), y: Math.sign(y) };
  }

  private sendKeyboardDirection() {
    const { x, y } = this.inputDirection();
    if (x !== this.sentDir.x || y !== this.sentDir.y) {
      this.sentDir = { x, y };
      this.room.send("dir", { x, y });
    }
  }

  /**
   * Moves the local player right away, the way the server will: same speed, same props in the way,
   * same edges. Far from the server's position it is pulled back; at rest it settles onto it.
   */
  private predictMe(me: Actor, delta: number, now: number) {
    if (!this.predicted || me.dead) {
      return;
    }
    const position = this.predicted;
    const state = this.playerStates.get(this.room.sessionId);
    const pace = state?.riding ? (MOUNTS[state.mount]?.speed ?? 1) : 1;
    const step = (PLAYER_SPEED * pace * delta) / 1000;
    const input = this.inputDirection();
    let dx = 0;
    let dy = 0;
    if (input.x !== 0 || input.y !== 0) {
      const length = Math.hypot(input.x, input.y);
      dx = (input.x / length) * step;
      dy = (input.y / length) * step;
      this.tapTarget = undefined;
    } else if (this.tapTarget) {
      const toX = this.tapTarget.x - position.x;
      const toY = this.tapTarget.y - position.y;
      const distance = Math.hypot(toX, toY);
      if (distance <= step) {
        dx = toX;
        dy = toY;
        this.tapTarget = undefined;
      } else {
        dx = (toX / distance) * step;
        dy = (toY / distance) * step;
      }
    }

    if (dx !== 0 || dy !== 0) {
      const { bounds } = REGIONS[this.regionId];
      const next = slide(regionLayout(this.regionId), position.x, position.y, dx, dy);
      position.x = THREE.MathUtils.clamp(next.x, bounds.minX, bounds.maxX);
      position.y = THREE.MathUtils.clamp(next.y, bounds.minY, bounds.maxY);
      // The server is a little behind while walking; only a real disagreement pulls back.
      const off = Math.hypot(this.server.x - position.x, this.server.y - position.y);
      if (off > 90) {
        position.x += (this.server.x - position.x) * 0.1;
        position.y += (this.server.y - position.y) * 0.1;
      }
      me.moveTo(position.x / PX, position.y / PX, now);
      return;
    }

    // Standing still: the server finishes its last steps a moment later. Once it has stopped too,
    // settle onto its position quietly, without turning or walking back.
    if (now - this.serverMovedAt > 250) {
      const blend = Math.min(1, delta / 150);
      position.x += (this.server.x - position.x) * blend;
      position.y += (this.server.y - position.y) * blend;
      me.slideTo(position.x / PX, position.y / PX);
    }
  }

  // ---- Every frame ----

  private shakeAmount = 0;

  private shake(amount: number) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  private loop = () => {
    if (this.disposed) {
      return;
    }
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const delta = Math.min(100, now - this.last);
    this.last = now;
    this.frameCount++;

    this.sendKeyboardDirection();
    const mine = this.players.get(this.room.sessionId);
    if (mine) {
      this.predictMe(mine, delta, now);
    }
    this.players.forEach((actor) => actor.update(delta, now));
    this.shots.forEach((shot, id) => {
      const travel = Math.min(shot.left, (shot.speed * delta) / 1000);
      shot.object.position.x += shot.dx * travel;
      shot.object.position.z += shot.dz * travel;
      shot.left -= travel;
      shot.object.rotation.z += shot.object.userData.spin ?? 0;
      // A glowing wake: every frame for magic, every other frame for arrows and bolts.
      const magic = shot.object.userData.kind === "magic";
      if (magic || this.frameCount % 2 === 0) {
        this.effects.trail(shot.object.position, shot.object.userData.color, magic ? 0.8 : 0.35);
      }
      // The server says where it ends; this only tidies up one whose end message was missed.
      if (shot.left <= 0 && shot.left > -1) {
        shot.left = -1;
        setTimeout(() => {
          shot.object.removeFromParent();
          this.shots.delete(id);
        }, 300);
      }
    });
    this.monsters.forEach(({ actor }) => actor.update(delta, now));
    this.auras.forEach((ring) => {
      ring.scale.setScalar(1 + Math.sin(now / 250) * 0.12);
    });
    this.scenery?.animators.forEach((animate) => animate(now, delta));
    // Twice a second: is a living boss close? Then the fight theme plays.
    if (this.frameCount % 30 === 0) {
      let near = false;
      this.monsters.forEach(({ actor, boss }) => {
        near ||= boss && !actor.dead && actor.root.position.distanceTo(this.focus) < 16;
      });
      if (near !== this.bossNear) {
        this.bossNear = near;
        playMusic(this.regionId, near);
      }
    }
    this.fadeOccluders(delta);
    this.effects.update(now);
    const marker = this.marker.material as THREE.MeshBasicMaterial;
    if (marker.opacity > 0) {
      marker.opacity = Math.max(0, marker.opacity - delta / 600);
      this.marker.scale.setScalar(this.marker.scale.x + delta / 900);
    }

    // Follow the local player smoothly; the sun's shadow box follows too.
    const me = this.players.get(this.room.sessionId);
    if (me) {
      this.focus.lerp(me.root.position, Math.min(1, delta / 140));
    }
    const portrait = this.container.clientHeight > this.container.clientWidth;
    const offset = CAMERA_OFFSET.clone().multiplyScalar(this.zoom * (portrait ? 1.35 : 1));
    this.camera.position.copy(this.focus).add(offset);
    if (this.shakeAmount > 0.01) {
      this.camera.position.add(
        new THREE.Vector3((Math.random() - 0.5) * this.shakeAmount, (Math.random() - 0.5) * this.shakeAmount, 0),
      );
      this.shakeAmount *= 0.86;
    }
    this.camera.lookAt(this.focus.x, this.focus.y + 1, this.focus.z);
    this.sun.position.copy(this.focus).add(new THREE.Vector3(-14, 24, 12));
    this.sun.target.position.copy(this.focus);

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  /** Trees and houses between the camera and the player fade, so the player is never hidden. */
  private fadeOccluders(delta: number) {
    for (const occluder of this.scenery?.occluders ?? []) {
      const { position } = occluder.object;
      // Nearer the camera (larger z) than the player, close sideways, and tall enough to reach the line of sight.
      const ahead = position.z - this.focus.z;
      const side = Math.abs(position.x - this.focus.x);
      const hides = ahead > -0.5 && ahead < occluder.height * 1.1 + 1 && side < 1.2 + occluder.height * 0.35;
      const target = hides ? FADED : 1;
      if (Math.abs(occluder.opacity - target) < 0.01) {
        continue;
      }
      if (!occluder.materials) {
        occluder.materials = [];
        occluder.object.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            const own = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone();
            own.transparent = true;
            own.userData.shared = false;
            mesh.material = own;
            occluder.materials!.push(own);
          }
        });
      }
      occluder.opacity += (target - occluder.opacity) * Math.min(1, delta / 120);
      for (const material of occluder.materials) {
        material.opacity = occluder.opacity;
        material.depthWrite = occluder.opacity > 0.95;
      }
    }
  }

  /** Sharper pictures and shadows on strong devices; fewer pixels and no shadows on weak ones. */
  private applyQuality(options: Settings) {
    const ratio = { high: Math.min(devicePixelRatio, 2), medium: Math.min(devicePixelRatio, 1.25), low: 1 }[options.quality];
    this.renderer.setPixelRatio(ratio);
    this.sun.castShadow = options.quality !== "low";
    const size = options.quality === "high" ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.setScalar(size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.fit();
  }

  private fit() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    this.labels.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private playNear(sound: "hit" | "swing" | "levelup" | "potion" | "buy", actor: Actor, volume: number) {
    if (actor.root.position.distanceTo(this.focus) < 22) {
      play(sound, volume);
    }
  }

  /** The region's name over the screen for a moment on arrival. */
  private showBanner() {
    const region = REGIONS[this.regionId];
    const banner = document.createElement("div");
    banner.className = "region-banner";
    const name = document.createElement("strong");
    name.textContent = region.name;
    const tagline = document.createElement("span");
    tagline.textContent = region.tagline;
    banner.append(name, tagline);
    this.container.append(banner);
    const timer = setTimeout(() => banner.remove(), 4000);
    this.cleanup.push(() => {
      clearTimeout(timer);
      banner.remove();
    });
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.cleanup.forEach((undo) => undo());
    this.players.forEach((actor) => actor.dispose());
    this.monsters.forEach(({ actor }) => actor.dispose());
    // Free this region's own meshes and materials; models shared with the loader cache stay for the next region.
    this.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh && !(child as THREE.Points).isPoints) {
        return;
      }
      if (!mesh.geometry.userData.shared) {
        mesh.geometry.dispose();
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!material.userData.shared) {
          material.dispose();
        }
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}

/** The look of a shot: a feathered arrow, a short steel bolt, or a glowing orb. */
function projectileModel(kind: ShotEvent["projectile"]) {
  const group = new THREE.Group();
  if (kind === "magic") {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshBasicMaterial({ color: "#f0e1ff" }),
    );
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 12),
      new THREE.MeshBasicMaterial({ color: "#a66bff", transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const light = new THREE.PointLight("#b88cff", 6, 5);
    group.add(core, glow, light);
    group.userData.color = "#c9a6ff";
    group.userData.kind = "magic";
    return group;
  }

  const long = kind === "arrow";
  const length = long ? 1.1 : 0.7;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, length, 6),
    new THREE.MeshStandardMaterial({ color: long ? "#8b5a2b" : "#5b5f66", metalness: long ? 0 : 0.6 }),
  );
  shaft.rotation.x = Math.PI / 2;
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.22, 6),
    new THREE.MeshStandardMaterial({ color: "#d9dde3", metalness: 0.8, roughness: 0.3 }),
  );
  head.rotation.x = Math.PI / 2;
  head.position.z = length / 2 + 0.1;
  group.add(shaft, head);
  if (long) {
    const feathers = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.02, 0.22),
      new THREE.MeshStandardMaterial({ color: "#f4f1e8" }),
    );
    feathers.position.z = -length / 2 + 0.1;
    group.add(feathers);
  }
  // A faint streak behind it, so a fast shot is easy to follow.
  const streak = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 1.6),
    new THREE.MeshBasicMaterial({ color: "#fff6d6", transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  streak.rotation.x = Math.PI / 2;
  streak.position.z = -length / 2 - 0.6;
  group.add(streak);
  group.userData.color = long ? "#ffe2a0" : "#cfe8ff";
  group.userData.kind = kind;
  return group;
}
