import Phaser from "phaser";
import type { Room } from "colyseus.js";
import { SKINS, WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/world.ts";

const FONT = 'Tahoma, "Noto Sans Thai", "Leelawadee UI", sans-serif';
const ASSETS = "assets/ninja";
/** The pack is drawn at 16 px; everything is shown three times bigger. */
const SCALE = 3;
const TILE = 16 * SCALE;
const BUBBLE_MS = 4000;
/** A player counts as walking for this long after the server last moved them. */
const WALK_HOLD_MS = 150;

/** Columns of a character sheet: one per facing. Rows 0-3 are the walk cycle. */
const DIRECTIONS = ["down", "up", "left", "right"] as const;
type Direction = (typeof DIRECTIONS)[number];

/** Grass in tileset_floor.png (22 tiles per row): one plain tile and four with sprouts. */
const GRASS_PLAIN = 12 * 22 + 11;
const GRASS_SPROUTS = [12 * 22 + 12, 12 * 22 + 13, 12 * 22 + 14, 12 * 22 + 15];

/** Props cut from tileset_village.png, as x, y, width, height in source pixels. */
const PROPS = {
  treeBig: [0, 96, 64, 48],
  treeSmall: [64, 96, 32, 32],
  bush: [64, 80, 16, 16],
  bushRound: [80, 80, 16, 16],
  stump: [96, 128, 16, 16],
  house: [192, 96, 64, 80],
} as const;
type PropName = keyof typeof PROPS;

/** Names and speech bubbles stay readable even when a player walks behind a house. */
const LABEL_DEPTH = 1_000_000;

interface PlayerView {
  sprite: Phaser.GameObjects.Sprite;
  container: Phaser.GameObjects.Container;
  name: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  bubbleTimer?: Phaser.Time.TimerEvent;
  skin: string;
  facing: Direction;
  movedAt: number;
  /** Last position the server sent; the view glides towards it. */
  targetX: number;
  targetY: number;
}

/** Deterministic 0..99 per cell, so every player sees the same world. */
function noise(x: number, y: number) {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
}

export class WorldScene extends Phaser.Scene {
  private views = new Map<string, PlayerView>();
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;
  private sentDir = { x: 0, y: 0 };
  private marker!: Phaser.GameObjects.Arc;

  constructor(
    private readonly room: Room,
    private readonly chatInput: HTMLInputElement,
    private readonly onPlayerCount: (count: number) => void,
  ) {
    super("world");
  }

  preload() {
    for (const skin of SKINS) {
      this.load.spritesheet(skin, `assets/characters/${skin}.png`, { frameWidth: 16, frameHeight: 16 });
    }
    this.load.spritesheet("floor", `${ASSETS}/tileset_floor.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.image("village", `${ASSETS}/tileset_village.png`);
    this.load.image("shadow", `${ASSETS}/shadow.png`);
  }

  create() {
    this.createAnimations();
    this.drawGround();
    this.placeProps();

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBackgroundColor("#1d3b2a");

    this.marker = this.add.circle(0, 0, 10).setStrokeStyle(2, 0xffffff, 0.9).setVisible(false).setDepth(1);

    // false = don't swallow these keys globally, or nobody could type "w" into the chat.
    this.keys = this.input.keyboard!.addKeys(
      { up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT", w: "W", a: "A", s: "S", d: "D" },
      false,
    ) as WorldScene["keys"];

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.room.send("target", { x: pointer.worldX, y: pointer.worldY });
      this.marker.setPosition(pointer.worldX, pointer.worldY).setVisible(true).setAlpha(1);
      this.tweens.add({ targets: this.marker, alpha: 0, duration: 700 });
    });

    const players = this.room.state.players;
    players.onAdd((player: any, sessionId: string) => {
      this.addPlayer(sessionId, player);
      player.onChange(() => this.onPlayerMoved(sessionId, player.x, player.y));
      // players.size isn't updated yet inside onAdd, so count what is on screen.
      this.onPlayerCount(this.views.size);
    });
    players.onRemove((_player: any, sessionId: string) => {
      const view = this.views.get(sessionId);
      view?.container.destroy();
      view?.name.destroy();
      view?.bubble.destroy();
      this.views.delete(sessionId);
      this.onPlayerCount(this.views.size);
    });
  }

  update(time: number, delta: number) {
    this.sendKeyboardDirection();

    // Glide towards the server position instead of jumping 20 times a second.
    const blend = Math.min(1, delta / 90);
    this.views.forEach((view) => {
      view.container.x += (view.targetX - view.container.x) * blend;
      view.container.y += (view.targetY - view.container.y) * blend;
      view.container.setDepth(view.container.y);
      view.name.setPosition(view.container.x, view.container.y - 46);
      view.bubble.setPosition(view.container.x, view.container.y - 66);

      if (time - view.movedAt < WALK_HOLD_MS) {
        view.sprite.play(`${view.skin}-walk-${view.facing}`, true);
      } else {
        view.sprite.stop();
        view.sprite.setFrame(DIRECTIONS.indexOf(view.facing));
      }
    });
  }

  showBubble(sessionId: string, text: string) {
    const view = this.views.get(sessionId);
    if (!view) {
      return;
    }

    view.bubble.setText(text).setVisible(true);
    view.bubbleTimer?.remove();
    view.bubbleTimer = this.time.delayedCall(BUBBLE_MS, () => view.bubble.setVisible(false));
  }

  private onPlayerMoved(sessionId: string, x: number, y: number) {
    const view = this.views.get(sessionId);
    if (!view) {
      return;
    }

    const dx = x - view.targetX;
    const dy = y - view.targetY;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) {
      view.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      view.movedAt = this.time.now;
    }
    view.targetX = x;
    view.targetY = y;
  }

  private sendKeyboardDirection() {
    const typing = document.activeElement === this.chatInput;
    const k = this.keys;
    const x = typing ? 0 : Number(k.right.isDown || k.d.isDown) - Number(k.left.isDown || k.a.isDown);
    const y = typing ? 0 : Number(k.down.isDown || k.s.isDown) - Number(k.up.isDown || k.w.isDown);
    if (x !== this.sentDir.x || y !== this.sentDir.y) {
      this.sentDir = { x, y };
      this.room.send("dir", { x, y });
    }
  }

  private addPlayer(sessionId: string, player: { name: string; x: number; y: number; skin: number }) {
    const isMe = sessionId === this.room.sessionId;
    const skin = SKINS[player.skin] ?? SKINS[0];

    const shadow = this.add.image(0, 2, "shadow").setScale(SCALE).setAlpha(0.5);
    // Origin near the feet, so the container's position is where the character stands.
    const sprite = this.add.sprite(0, 0, skin, 0).setScale(SCALE).setOrigin(0.5, 0.9);
    const name = this.add
      .text(0, -46, player.name, {
        fontFamily: FONT,
        fontSize: "14px",
        color: isMe ? "#e9c46a" : "#ffffff",
        stroke: "#1b1b1b",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH);
    const bubble = this.add
      .text(0, -66, "", {
        fontFamily: FONT,
        fontSize: "14px",
        color: "#1b1b1b",
        backgroundColor: "#ffffffee",
        padding: { x: 8, y: 5 },
        wordWrap: { width: 200, useAdvancedWrap: true },
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH)
      .setVisible(false);

    const container = this.add.container(player.x, player.y, [shadow, sprite]);
    this.views.set(sessionId, {
      sprite,
      container,
      name,
      bubble,
      skin,
      facing: "down",
      movedAt: 0,
      targetX: player.x,
      targetY: player.y,
    });

    if (isMe) {
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
  }

  private createAnimations() {
    // Crisp pixels for the art only; the Thai text stays smooth.
    for (const key of [...SKINS, "floor", "village", "shadow"]) {
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }

    for (const key of SKINS) {
      DIRECTIONS.forEach((direction, column) => {
        this.anims.create({
          key: `${key}-walk-${direction}`,
          frames: [0, 1, 2, 3].map((row) => ({ key, frame: row * DIRECTIONS.length + column })),
          frameRate: 8,
          repeat: -1,
        });
      });
    }

    const village = this.textures.get("village");
    for (const [name, [x, y, width, height]] of Object.entries(PROPS)) {
      village.add(name, 0, x, y, width, height);
    }
  }

  private drawGround() {
    const map = this.make.tilemap({
      tileWidth: 16,
      tileHeight: 16,
      width: Math.ceil(WORLD_WIDTH / TILE),
      height: Math.ceil(WORLD_HEIGHT / TILE),
    });
    const tiles = map.addTilesetImage("floor")!;
    const layer = map.createBlankLayer("ground", tiles)!.setScale(SCALE).setDepth(-1000);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const n = noise(x, y);
        layer.putTileAt(n < 80 ? GRASS_PLAIN : GRASS_SPROUTS[n % GRASS_SPROUTS.length], x, y);
      }
    }
  }

  private placeProps() {
    const place = (prop: PropName, x: number, y: number) =>
      // Bottom-centre origin + depth by y: players walk behind the props' upper part.
      this.add.image(x, y, "village", prop).setScale(SCALE).setOrigin(0.5, 1).setDepth(y);

    // The village sits around the spawn point, which stays clear.
    const cx = WORLD_WIDTH / 2;
    const cy = WORLD_HEIGHT / 2;
    place("house", cx - 260, cy - 120);
    place("house", cx + 280, cy - 150);
    place("stump", cx - 120, cy + 170);
    place("bushRound", cx + 150, cy + 140);

    // A forest edge along the borders, thinned out by noise.
    for (let x = 60; x < WORLD_WIDTH; x += 150) {
      if (noise(x, 1) < 75) place(noise(x, 2) < 50 ? "treeBig" : "treeSmall", x, 150);
      if (noise(x, 3) < 75) place(noise(x, 4) < 50 ? "treeBig" : "treeSmall", x + 40, WORLD_HEIGHT - 20);
    }
    for (let y = 300; y < WORLD_HEIGHT - 100; y += 160) {
      if (noise(5, y) < 75) place("treeBig", 90, y);
      if (noise(6, y) < 75) place("treeBig", WORLD_WIDTH - 90, y);
    }

    // Scattered bushes and stumps in the open field.
    for (let i = 0; i < 40; i++) {
      const x = 200 + (noise(i, 7) / 100) * (WORLD_WIDTH - 400);
      const y = 260 + (noise(i, 8) / 100) * (WORLD_HEIGHT - 480);
      if (Math.hypot(x - cx, y - cy) < 220) continue;
      place(i % 5 === 0 ? "stump" : i % 2 ? "bush" : "bushRound", x, y);
    }
  }
}
