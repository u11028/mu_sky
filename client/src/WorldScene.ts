import Phaser from "phaser";
import type { Room } from "colyseus.js";
import { SKINS, WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/world.ts";
import { PORTAL_RADIUS, REGIONS, type RegionId } from "../../shared/regions.ts";
import { PROPS, type PropName, seededRandom, THEMES } from "./regionThemes.ts";

const FONT = 'Tahoma, "Noto Sans Thai", "Leelawadee UI", sans-serif';
/** The pack is drawn at 16 px; everything is shown three times bigger. */
const SCALE = 3;
const TILE = 16 * SCALE;
const BUBBLE_MS = 4000;
/** A player counts as walking for this long after the server last moved them. */
const WALK_HOLD_MS = 150;
/** Wavy water in tiles/water.png (28 tiles per row). */
const SEA_TILE = 2 * 28 + 11;
/** Sand between the walkable ground and the sea. */
const BEACH_TILE = 5 * 22;
const SEA_GAP = 40;

/** Columns of a character sheet: one per facing. Rows 0-3 are the walk cycle. */
const DIRECTIONS = ["down", "up", "left", "right"] as const;
type Direction = (typeof DIRECTIONS)[number];

/** Names, speech bubbles and portal signs stay readable even behind a house. */
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

export class WorldScene extends Phaser.Scene {
  private views = new Map<string, PlayerView>();
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;
  private sentDir = { x: 0, y: 0 };
  private marker!: Phaser.GameObjects.Arc;

  constructor(
    private readonly room: Room,
    private readonly regionId: RegionId,
    private readonly chatInput: HTMLInputElement,
    private readonly onPlayerCount: (count: number) => void,
  ) {
    super("world");
  }

  preload() {
    for (const skin of SKINS) {
      this.load.spritesheet(skin, `assets/characters/${skin}.png`, { frameWidth: 16, frameHeight: 16 });
    }
    this.load.spritesheet("floor", "assets/tiles/floor.png", { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet("water", "assets/tiles/water.png", { frameWidth: 16, frameHeight: 16 });
    this.load.image("nature", "assets/tiles/nature.png");
    this.load.image("village", "assets/tiles/village.png");
    this.load.image("field", "assets/tiles/field.png");
    this.load.image("shadow", "assets/shadow.png");
  }

  create() {
    this.prepareTextures();
    this.drawGround();
    this.placeProps();
    this.drawPortals();
    this.showRegionBanner();

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
      .text(player.x, player.y - 46, player.name, {
        fontFamily: FONT,
        fontSize: "14px",
        color: isMe ? "#e9c46a" : "#ffffff",
        stroke: "#1b1b1b",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH);
    const bubble = this.add
      .text(player.x, player.y - 66, "", {
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

  private prepareTextures() {
    // Crisp pixels for the art only; the Thai text stays smooth.
    for (const key of [...SKINS, "floor", "water", "nature", "village", "field", "shadow"]) {
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

    for (const [name, [sheet, column, row, width, height]] of Object.entries(PROPS)) {
      this.textures.get(sheet).add(name, 0, column * 16, row * 16, width * 16, height * 16);
    }
  }

  private drawGround() {
    const theme = THEMES[this.regionId];
    const { bounds } = REGIONS[this.regionId];
    const random = seededRandom(this.seed() + 1);

    const map = this.make.tilemap({
      tileWidth: 16,
      tileHeight: 16,
      width: Math.ceil(WORLD_WIDTH / TILE),
      height: Math.ceil(WORLD_HEIGHT / TILE),
    });
    const ground = map.createBlankLayer("ground", map.addTilesetImage("floor")!)!.setScale(SCALE).setDepth(-2000);
    const sea = map.createBlankLayer("sea", map.addTilesetImage("water")!)!.setScale(SCALE).setDepth(-1999);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        // How far this tile lies past the walkable edge on the sea side.
        const past =
          theme.sea === "east" ? x * TILE - bounds.maxX : theme.sea === "south" ? y * TILE - bounds.maxY : -Infinity;
        if (past >= SEA_GAP) {
          sea.putTileAt(SEA_TILE, x, y);
        } else if (past > -TILE) {
          ground.putTileAt(BEACH_TILE, x, y);
        } else {
          const details = theme.groundDetails;
          ground.putTileAt(random() < 0.18 ? details[Math.floor(random() * details.length)] : theme.ground, x, y);
        }
      }
    }
  }

  private placeProps() {
    const theme = THEMES[this.regionId];
    const { bounds, portals } = REGIONS[this.regionId];
    const random = seededRandom(this.seed());

    // Where props already stand: the centre of their footprint and a radius, to keep the next ones apart.
    const taken: { x: number; y: number; r: number }[] = [];
    const footprint = (prop: PropName, x: number, y: number) => {
      const [, , , width, height] = PROPS[prop];
      const r = (Math.max(width, height) * TILE) / 2;
      return { x, y: y - (height * TILE) / 2, r };
    };
    const place = (prop: PropName, x: number, y: number) => {
      const [sheet] = PROPS[prop];
      // Bottom-centre origin + depth by y: players walk behind a prop's upper part.
      this.add.image(x, y, sheet, prop).setScale(SCALE).setOrigin(0.5, 1).setDepth(y);
      taken.push(footprint(prop, x, y));
    };

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    for (const [prop, x, y] of theme.landmarks(cx, cy)) {
      place(prop, x, y);
    }

    // Scatter the rest, apart from each other, the portals and the open middle where players arrive.
    const weighted = Object.entries(theme.scatter).flatMap(([prop, weight]) => Array(weight).fill(prop as PropName));
    let placed = 0;
    for (let attempt = 0; placed < theme.scatterCount && attempt < theme.scatterCount * 30; attempt++) {
      const x = bounds.minX + 40 + random() * (bounds.maxX - bounds.minX - 80);
      const y = bounds.minY + 80 + random() * (bounds.maxY - bounds.minY - 100);
      const prop = weighted[Math.floor(random() * weighted.length)];
      const spot = footprint(prop, x, y);
      const crowded = taken.some((t) => Math.hypot(t.x - spot.x, t.y - spot.y) < (t.r + spot.r) * 0.8);
      const nearPortal = portals.some((p) => Math.hypot(p.x - x, p.y - y) < 150);
      if (crowded || nearPortal || Math.hypot(x - cx, y - cy) < 200) {
        continue;
      }
      place(prop, x, y);
      placed++;
    }
  }

  private drawPortals() {
    for (const portal of REGIONS[this.regionId].portals) {
      const glow = this.add.circle(portal.x, portal.y, PORTAL_RADIUS, 0x8be9fd, 0.25).setDepth(portal.y - 1);
      this.add.circle(portal.x, portal.y, PORTAL_RADIUS).setStrokeStyle(3, 0xe9f9ff, 0.9).setDepth(portal.y - 1);
      this.tweens.add({ targets: glow, scale: 1.25, alpha: 0.05, duration: 1100, yoyo: true, repeat: -1 });
      this.add
        .text(portal.x, portal.y - PORTAL_RADIUS - 8, `ไป${REGIONS[portal.to].name}`, {
          fontFamily: FONT,
          fontSize: "15px",
          color: "#ffffff",
          backgroundColor: "#1d3b2acc",
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5, 1)
        .setDepth(LABEL_DEPTH);
    }
  }

  private showRegionBanner() {
    const region = REGIONS[this.regionId];
    const banner = this.add
      .text(this.scale.width / 2, 90, `${region.name}\n${region.tagline}`, {
        fontFamily: FONT,
        fontSize: "26px",
        color: "#ffffff",
        align: "center",
        stroke: "#1b1b1b",
        strokeThickness: 5,
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(LABEL_DEPTH + 1);
    this.tweens.add({ targets: banner, alpha: 0, delay: 2500, duration: 900, onComplete: () => banner.destroy() });
  }

  /** A fixed number per region, so its random layout is the same for everyone. */
  private seed() {
    return [...this.regionId].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7);
  }
}
