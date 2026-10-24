import Phaser from "phaser";
import type { Room } from "colyseus.js";
import { SKINS, WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/world.ts";
import { PORTAL_RADIUS, REGIONS, type RegionId } from "../../shared/regions.ts";
import { decorateTitle, findTitle, type Title, type TitleStyle } from "../../shared/titles.ts";
import type { HitEvent } from "../../shared/combat.ts";
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

/** Columns of a character sheet: one per facing. Rows 0-3 are the walk cycle, 4 the swing, 6 the fall. */
const DIRECTIONS = ["down", "up", "left", "right"] as const;
type Direction = (typeof DIRECTIONS)[number];
const ATTACK_ROW = 4;
const DEAD_FRAME = 6 * DIRECTIONS.length;
/** How long the swing pose shows. */
const SWING_MS = 220;
/** Farther than this in one update is a teleport (respawn, GM): jump instead of gliding. */
const SNAP_DISTANCE = 200;

const HP_BAR = { width: 42, height: 5, y: 10 };

/** Drifting leaves or petals for the regions known for their trees. */
const AMBIENT: Partial<Record<RegionId, string>> = {
  north: "leaf-pink",
  central: "leaf",
  west: "leaf",
  northeast: "leaf",
};

/** Names, speech bubbles and portal signs stay readable even behind a house. */
const LABEL_DEPTH = 1_000_000;

/** Heights above the feet: the name, the title over it, and the bottom of the speech bubble. */
const NAME_Y = -46;
const TITLE_Y = -65;
const BUBBLE_Y = -66;
const BUBBLE_Y_WITH_TITLE = -88;
const BUBBLE_TAIL = 8;
const BUBBLE_PAD = { x: 10, y: 6 };

/** The bubble of a player without a title. */
const PLAIN_BUBBLE: TitleStyle = {
  color: "#ffffff",
  glow: "#ffffff",
  bubbleFill: "#ffffff",
  bubbleBorder: "#cfd8dc",
  bubbleText: "#1b1b1b",
};

function hex(color: string) {
  return Phaser.Display.Color.HexStringToColor(color).color;
}

/** Mythic titles flick between their two colours at random, like a broken screen. */
function glitching(time: number) {
  return Math.sin(time / 37) * Math.sin(time / 91) > 0.55;
}

/** A colour that slides around the colour wheel over time, for legendary titles. */
function rainbow(time: number, offset = 0) {
  const hue = (time / 3000 + offset) % 1;
  return Phaser.Display.Color.HSVToRGB(hue, 0.55, 1).color as number;
}

interface PlayerView {
  sprite: Phaser.GameObjects.Sprite;
  container: Phaser.GameObjects.Container;
  name: Phaser.GameObjects.Text;
  /** The title over the name, and the sparkles around a rare one. */
  title: Phaser.GameObjects.Text;
  titleId: string;
  sparkles?: Phaser.GameObjects.Particles.ParticleEmitter;
  bubble: Phaser.GameObjects.Container;
  bubbleFrame: Phaser.GameObjects.Graphics;
  bubbleText: Phaser.GameObjects.Text;
  bubbleTimer?: Phaser.Time.TimerEvent;
  skin: string;
  facing: Direction;
  movedAt: number;
  /** Health under the feet, and the golden ring of an immortal GM. */
  hpBar: Phaser.GameObjects.Graphics;
  aura?: Phaser.GameObjects.Ellipse;
  attackUntil: number;
  dead: boolean;
  /** What the name label and health bar last showed, to redraw them only on change. */
  label: string;
  hpShown: number;
  /** Last position the server sent; the view glides towards it. */
  targetX: number;
  targetY: number;
}

/** The local player, as the HUD shows it. */
export interface SelfState {
  name: string;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  gm: boolean;
}

export class WorldScene extends Phaser.Scene {
  private views = new Map<string, PlayerView>();
  private keys!: Record<
    "up" | "down" | "left" | "right" | "w" | "a" | "s" | "d" | "space" | "j",
    Phaser.Input.Keyboard.Key
  >;
  private sentDir = { x: 0, y: 0 };
  private marker!: Phaser.GameObjects.Arc;

  constructor(
    private readonly room: Room,
    private readonly regionId: RegionId,
    private readonly chatInput: HTMLInputElement,
    private readonly onPlayerCount: (count: number) => void,
    private readonly onSelf: (self: SelfState) => void,
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
    this.load.spritesheet("slash", "assets/fx/slash.png", { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet("smoke", "assets/fx/smoke.png", { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet("leaf", "assets/fx/leaf.png", { frameWidth: 12, frameHeight: 7 });
    this.load.spritesheet("leaf-pink", "assets/fx/leaf-pink.png", { frameWidth: 12, frameHeight: 7 });
    for (const sound of ["hit", "swing", "levelup", "dead"]) {
      this.load.audio(sound, `assets/sfx/${sound}.wav`);
    }
  }

  create() {
    this.prepareTextures();
    this.drawGround();
    this.placeProps();
    this.drawPortals();
    this.showRegionBanner();
    this.addAmbience();

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBackgroundColor("#1d3b2a");
    // A soft darkening towards the screen's edges draws the eye to the middle (WebGL only).
    this.cameras.main.postFX?.addVignette(0.5, 0.5, 0.95, 0.22);

    this.marker = this.add.circle(0, 0, 10).setStrokeStyle(2, 0xffffff, 0.9).setVisible(false).setDepth(1);

    // false = don't swallow these keys globally, or nobody could type "w" into the chat.
    this.keys = this.input.keyboard!.addKeys(
      { up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT", w: "W", a: "A", s: "S", d: "D", space: "SPACE", j: "J" },
      false,
    ) as WorldScene["keys"];
    for (const key of [this.keys.space, this.keys.j]) {
      key.on("down", () => {
        if (document.activeElement !== this.chatInput) {
          this.attack();
        }
      });
    }

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.room.send("target", { x: pointer.worldX, y: pointer.worldY });
      this.marker.setPosition(pointer.worldX, pointer.worldY).setVisible(true).setAlpha(1);
      this.tweens.add({ targets: this.marker, alpha: 0, duration: 700 });
    });

    const players = this.room.state.players;
    players.onAdd((player: any, sessionId: string) => {
      this.addPlayer(sessionId, player);
      player.onChange(() => {
        this.onPlayerMoved(sessionId, player.x, player.y);
        this.setTitle(sessionId, player.title);
        this.onPlayerState(sessionId, player);
      });
      // players.size isn't updated yet inside onAdd, so count what is on screen.
      this.onPlayerCount(this.views.size);
    });
    players.onRemove((_player: any, sessionId: string) => {
      const view = this.views.get(sessionId);
      view?.container.destroy();
      view?.name.destroy();
      view?.title.destroy();
      view?.sparkles?.destroy();
      view?.bubble.destroy();
      view?.hpBar.destroy();
      view?.aura?.destroy();
      this.views.delete(sessionId);
      this.onPlayerCount(this.views.size);
    });
  }

  update(time: number, delta: number) {
    this.sendKeyboardDirection();

    // Glide towards the server position instead of jumping 20 times a second.
    const blend = Math.min(1, delta / 90);
    this.views.forEach((view) => {
      const far = Math.hypot(view.targetX - view.container.x, view.targetY - view.container.y) > SNAP_DISTANCE;
      view.container.x += (view.targetX - view.container.x) * (far ? 1 : blend);
      view.container.y += (view.targetY - view.container.y) * (far ? 1 : blend);
      view.container.setDepth(view.container.y);
      const { x, y } = view.container;
      view.name.setPosition(x, y + NAME_Y);
      view.hpBar.setPosition(x, y + HP_BAR.y).setDepth(view.container.y + 1);
      view.aura?.setPosition(x, y + 2).setDepth(view.container.y - 1);

      const title = findTitle(view.titleId);
      // Rarer titles float gently; legendary ones also run through the rainbow.
      const bob = title && title.rarity !== "common" ? Math.sin(time / 400) * 2 : 0;
      view.title.setPosition(x, y + TITLE_Y + bob);
      if (title?.rarity === "legendary") {
        view.title.setTint(rainbow(time), rainbow(time, 0.25), rainbow(time, 0.5), rainbow(time, 0.75));
        if (view.bubble.visible) {
          this.drawBubbleFrame(view, time);
        }
      } else if (title?.rarity === "mythic") {
        const glitch = glitching(time);
        const color = glitch ? title.style.glow : title.style.color;
        // Changing a text's colour redraws it, so only do it when the colour flips.
        if (view.title.style.color !== color) {
          view.title.setColor(color);
        }
        view.title.setX(view.title.x + (glitch ? Phaser.Math.Between(-3, 3) : 0));
        view.title.setAngle(glitch ? Phaser.Math.FloatBetween(-4, 4) : Math.sin(time / 300) * 2);
        if (view.bubble.visible) {
          this.drawBubbleFrame(view, time);
        }
      }
      view.bubble.setPosition(x, y + (title ? BUBBLE_Y_WITH_TITLE : BUBBLE_Y));

      const column = DIRECTIONS.indexOf(view.facing);
      if (view.dead) {
        view.sprite.stop();
        view.sprite.setFrame(DEAD_FRAME);
      } else if (time < view.attackUntil) {
        view.sprite.stop();
        view.sprite.setFrame(ATTACK_ROW * DIRECTIONS.length + column);
      } else if (time - view.movedAt < WALK_HOLD_MS) {
        view.sprite.play(`${view.skin}-walk-${view.facing}`, true);
      } else {
        view.sprite.stop();
        view.sprite.setFrame(column);
      }
    });
  }

  /** Asks the server for a swing; the button and the space or J key call this. */
  attack() {
    if (!this.views.get(this.room.sessionId)?.dead) {
      this.room.send("attack");
    }
  }

  /** Someone swung: their swing pose, a blade arc in front of them and its whoosh. */
  showSwing(sessionId: string, dirX: number, dirY: number) {
    const view = this.views.get(sessionId);
    if (!view) {
      return;
    }

    view.facing = dirX > 0 ? "right" : dirX < 0 ? "left" : dirY < 0 ? "up" : "down";
    view.attackUntil = this.time.now + SWING_MS;
    const slash = this.add
      .sprite(view.container.x + dirX * 34, view.container.y - 20 + dirY * 30, "slash")
      .setScale(2.2)
      .setRotation(Math.atan2(dirY, dirX))
      .setDepth(view.container.y + 2)
      .setBlendMode(Phaser.BlendModes.ADD);
    slash.play("slash");
    slash.once("animationcomplete", () => slash.destroy());
    this.playNear("swing", view, 0.25);
  }

  /** A hit lands: a red flash, a jolt, a floating number, and for the one hurt a shaking screen. */
  showHit(event: HitEvent) {
    const view = this.views.get(event.target);
    if (!view) {
      return;
    }

    const isMe = event.target === this.room.sessionId;
    if (event.blocked) {
      this.floatText(view, "อมตะ!", "#ffd60a", 18);
      return;
    }

    view.sprite.setTintFill(0xffffff);
    this.time.delayedCall(70, () => view.sprite.setTint(0xff6b6b));
    this.time.delayedCall(180, () => view.sprite.clearTint());
    this.tweens.add({ targets: view.sprite, x: { from: Phaser.Math.Between(-4, 4), to: 0 }, duration: 120 });

    const text = event.crit ? `${event.damage}!` : `${event.damage}`;
    this.floatText(view, text, event.crit ? "#ffd60a" : isMe ? "#ff5c5c" : "#ffffff", event.crit ? 26 : 19);
    this.playNear("hit", view, 0.35);
    if (isMe) {
      this.cameras.main.shake(event.killed ? 300 : 120, event.killed ? 0.012 : 0.005);
    }

    if (event.killed) {
      const smoke = this.add.sprite(view.container.x, view.container.y - 18, "smoke").setScale(2.5).setDepth(view.container.y + 3);
      smoke.play("smoke");
      smoke.once("animationcomplete", () => smoke.destroy());
      if (isMe) {
        this.sound.play("dead", { volume: 0.35 });
      }
    }
  }

  /** A golden ring and a "LEVEL UP" over a player who just grew stronger (or was healed by a GM). */
  showLevelUp(sessionId: string) {
    const view = this.views.get(sessionId);
    if (!view) {
      return;
    }

    const ring = this.add
      .circle(view.container.x, view.container.y - 16, 12)
      .setStrokeStyle(4, 0xffd60a)
      .setDepth(LABEL_DEPTH - 2);
    this.tweens.add({ targets: ring, scale: 5, alpha: 0, duration: 700, ease: "Cubic.easeOut", onComplete: () => ring.destroy() });
    this.floatText(view, "LEVEL UP!", "#ffd60a", 22);
    this.playNear("levelup", view, 0.4);
  }

  private floatText(view: PlayerView, text: string, color: string, size: number) {
    const label = this.add
      .text(view.container.x + Phaser.Math.Between(-10, 10), view.container.y - 50, text, {
        fontFamily: FONT,
        fontSize: `${size}px`,
        fontStyle: "bold",
        color,
        stroke: "#140b1f",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(LABEL_DEPTH + 2)
      .setScale(0.6);
    this.tweens.add({ targets: label, scale: 1, duration: 120, ease: "Back.easeOut" });
    this.tweens.add({
      targets: label,
      y: label.y - 46,
      alpha: 0,
      delay: 350,
      duration: 650,
      ease: "Cubic.easeIn",
      onComplete: () => label.destroy(),
    });
  }

  /** Plays a sound only for things happening on screen, so far-off fights stay quiet. */
  private playNear(key: string, view: PlayerView, volume: number) {
    if (this.cameras.main.worldView.contains(view.container.x, view.container.y)) {
      this.sound.play(key, { volume });
    }
  }

  /** Level, health, death and GM marks, whenever the server changes them. */
  private onPlayerState(
    sessionId: string,
    player: { name: string; level: number; xp: number; hp: number; maxHp: number; dead: boolean; gm: boolean; god: boolean },
  ) {
    const view = this.views.get(sessionId);
    if (!view) {
      return;
    }

    const label = `${player.gm ? "[GM] " : ""}Lv.${player.level} ${player.name}`;
    if (view.label !== label) {
      view.label = label;
      view.name.setText(label);
      if (player.gm) {
        view.name.setColor("#ff4d6d");
      }
    }

    if (view.hpShown !== player.hp / player.maxHp) {
      view.hpShown = player.hp / player.maxHp;
      this.drawHpBar(view);
    }

    if (view.dead !== player.dead) {
      view.dead = player.dead;
      view.container.setAlpha(player.dead ? 0.55 : 1);
      view.hpBar.setVisible(!player.dead);
      if (!player.dead) {
        // Back on their feet: fade in.
        view.container.setAlpha(0);
        this.tweens.add({ targets: view.container, alpha: 1, duration: 400 });
      }
    }

    if (player.god && !view.aura) {
      view.aura = this.add.ellipse(view.container.x, view.container.y + 2, 54, 20, 0xffd60a, 0.35).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: view.aura, scaleX: 1.25, scaleY: 1.25, alpha: 0.12, duration: 800, yoyo: true, repeat: -1 });
    } else if (!player.god && view.aura) {
      view.aura.destroy();
      view.aura = undefined;
    }

    if (sessionId === this.room.sessionId) {
      this.onSelf({ ...player });
    }
  }

  private drawHpBar(view: PlayerView) {
    const share = Phaser.Math.Clamp(view.hpShown, 0, 1);
    const color = share > 0.5 ? 0x52d273 : share > 0.25 ? 0xf4c542 : 0xff4d4d;
    const left = -HP_BAR.width / 2;
    view.hpBar
      .clear()
      .fillStyle(0x140b1f, 0.75)
      .fillRoundedRect(left - 2, -2, HP_BAR.width + 4, HP_BAR.height + 4, 3)
      .fillStyle(color, 1)
      .fillRoundedRect(left, 0, Math.max(2, HP_BAR.width * share), HP_BAR.height, 2)
      .fillStyle(0xffffff, 0.35)
      .fillRect(left + 1, 0, Math.max(0, HP_BAR.width * share - 2), 1);
  }

  /** Leaves or petals drifting across the screen, in front of the world. */
  private addAmbience() {
    const texture = AMBIENT[this.regionId];
    if (!texture) {
      return;
    }

    this.add
      .particles(0, 0, texture, {
        frame: [0, 1, 2, 3, 4, 5],
        x: { min: -50, max: this.scale.width + 50 },
        y: -20,
        lifespan: 9000,
        speedX: { min: -30, max: 25 },
        speedY: { min: 35, max: 70 },
        rotate: { min: -40, max: 40 },
        scale: { min: 2.6, max: 3.2 },
        alpha: { start: 0.95, end: 0.6 },
        frequency: 420,
        quantity: 1,
      })
      .setScrollFactor(0)
      .setDepth(LABEL_DEPTH - 3);
  }

  showBubble(sessionId: string, text: string) {
    const view = this.views.get(sessionId);
    if (!view) {
      return;
    }

    view.bubbleText.setText(text);
    this.drawBubbleFrame(view, this.time.now);
    view.bubble.setVisible(true);
    view.bubbleTimer?.remove();
    view.bubbleTimer = this.time.delayedCall(BUBBLE_MS, () => view.bubble.setVisible(false));
  }

  /** Puts a title over a player's name, or takes it off with "". */
  private setTitle(sessionId: string, titleId: string) {
    const view = this.views.get(sessionId);
    if (!view || view.titleId === titleId) {
      return;
    }

    view.titleId = titleId;
    view.sparkles?.destroy();
    view.sparkles = undefined;
    const title = findTitle(titleId);
    if (!title) {
      view.title.setVisible(false);
      return;
    }

    view.title
      .setText(decorateTitle(title))
      .setColor(title.style.color)
      .setShadow(0, 0, title.style.glow, title.rarity === "common" ? 4 : 10, true, true)
      .clearTint()
      .setAngle(0)
      .setVisible(true);
    if (title.rarity === "epic" || title.rarity === "legendary" || title.rarity === "mythic") {
      view.sparkles = this.addSparkles(view.title, title);
    }
    if (view.bubble.visible) {
      this.drawBubbleFrame(view, this.time.now);
    }
  }

  /** Little stars twinkling around an epic or legendary title. */
  private addSparkles(target: Phaser.GameObjects.Text, title: Title) {
    const width = target.width;
    return this.add
      .particles(0, 0, "spark", {
        lifespan: 900,
        speedY: { min: -18, max: -6 },
        speedX: { min: -6, max: 6 },
        scale: { start: 1.6, end: 0 },
        alpha: { start: 1, end: 0 },
        frequency: title.rarity === "mythic" ? 50 : title.rarity === "legendary" ? 90 : 180,
        tint:
          title.rarity === "legendary"
            ? [0xff9cf0, 0x9cf0ff, 0xfff59c, 0xc792ff]
            : title.rarity === "mythic"
              ? [hex(title.style.color), hex(title.style.glow), hex(title.style.bubbleBorder)]
              : hex(title.style.glow),
        blendMode: "ADD",
        emitZone: { type: "random", source: new Phaser.Geom.Rectangle(-width / 2, -16, width, 18) } as any,
      })
      .startFollow(target)
      .setDepth(LABEL_DEPTH - 1);
  }

  /** The speech bubble's frame, in the colours of the speaker's title. */
  private drawBubbleFrame(view: PlayerView, time: number) {
    const title = findTitle(view.titleId);
    const style = title?.style ?? PLAIN_BUBBLE;
    const fancy = title?.rarity === "epic" || title?.rarity === "legendary" || title?.rarity === "mythic";
    const border =
      title?.rarity === "legendary"
        ? rainbow(time)
        : title?.rarity === "mythic" && glitching(time)
          ? hex(style.glow)
          : hex(style.bubbleBorder);
    const width = view.bubbleText.width + BUBBLE_PAD.x * 2;
    const height = view.bubbleText.height + BUBBLE_PAD.y * 2;
    const left = -width / 2;
    const top = -BUBBLE_TAIL - height;
    const lineWidth = fancy ? 3 : 2;

    view.bubbleText.setColor(style.bubbleText).setPosition(0, -BUBBLE_TAIL - BUBBLE_PAD.y);
    const frame = view.bubbleFrame.clear();
    frame.fillStyle(hex(style.bubbleFill), 0.96).fillRoundedRect(left, top, width, height, 10);
    frame.fillTriangle(-7, -BUBBLE_TAIL - 1, 7, -BUBBLE_TAIL - 1, 0, 0);
    frame.lineStyle(lineWidth, border, 1).strokeRoundedRect(left, top, width, height, 10);
    // Open the frame where the tail joins it, then outline the tail.
    frame.fillStyle(hex(style.bubbleFill), 1).fillRect(-6, -BUBBLE_TAIL - lineWidth, 12, lineWidth + 1);
    frame.lineBetween(-7, -BUBBLE_TAIL, 0, 0).lineBetween(7, -BUBBLE_TAIL, 0, 0);

    if (fancy) {
      // A second, thin frame inside and a gem on each corner.
      frame.lineStyle(1, border, 0.55).strokeRoundedRect(left + 4, top + 4, width - 8, height - 8, 7);
      frame.fillStyle(border, 1);
      for (const [cx, cy] of [
        [left, top],
        [left + width, top],
        [left, top + height],
        [left + width, top + height],
      ]) {
        frame.fillPoints(
          [
            { x: cx, y: cy - 5 },
            { x: cx + 5, y: cy },
            { x: cx, y: cy + 5 },
            { x: cx - 5, y: cy },
          ],
          true,
        );
      }
    }
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

  private addPlayer(
    sessionId: string,
    player: {
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
    },
  ) {
    const isMe = sessionId === this.room.sessionId;
    const skin = SKINS[player.skin] ?? SKINS[0];

    const shadow = this.add.image(0, 2, "shadow").setScale(SCALE).setAlpha(0.5);
    // Origin near the feet, so the container's position is where the character stands.
    const sprite = this.add.sprite(0, 0, skin, 0).setScale(SCALE).setOrigin(0.5, 0.9);
    const name = this.add
      .text(player.x, player.y + NAME_Y, player.name, {
        fontFamily: FONT,
        fontSize: "14px",
        color: isMe ? "#e9c46a" : "#ffffff",
        stroke: "#1b1b1b",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH);
    const title = this.add
      .text(player.x, player.y + TITLE_Y, "", {
        fontFamily: FONT,
        fontSize: "15px",
        fontStyle: "bold",
        stroke: "#140b1f",
        strokeThickness: 4,
        padding: { x: 6, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH)
      .setVisible(false);
    const bubbleText = this.add
      .text(0, 0, "", {
        fontFamily: FONT,
        fontSize: "14px",
        wordWrap: { width: 200, useAdvancedWrap: true },
        align: "center",
      })
      .setOrigin(0.5, 1);
    const bubbleFrame = this.add.graphics();
    const bubble = this.add
      .container(player.x, player.y + BUBBLE_Y, [bubbleFrame, bubbleText])
      .setDepth(LABEL_DEPTH)
      .setVisible(false);

    const container = this.add.container(player.x, player.y, [shadow, sprite]);
    const hpBar = this.add.graphics({ x: player.x, y: player.y + HP_BAR.y });
    this.views.set(sessionId, {
      hpBar,
      attackUntil: 0,
      dead: false,
      label: "",
      hpShown: -1,
      sprite,
      container,
      name,
      title,
      titleId: "",
      bubble,
      bubbleFrame,
      bubbleText,
      skin,
      facing: "down",
      movedAt: 0,
      targetX: player.x,
      targetY: player.y,
    });

    this.setTitle(sessionId, player.title);
    this.onPlayerState(sessionId, player);
    if (isMe) {
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
  }

  private prepareTextures() {
    // Crisp pixels for the art only; the Thai text stays smooth.
    for (const key of [...SKINS, "floor", "water", "nature", "village", "field", "shadow", "slash", "smoke", "leaf", "leaf-pink"]) {
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

    this.anims.create({ key: "slash", frames: this.anims.generateFrameNumbers("slash"), frameRate: 24 });
    this.anims.create({ key: "smoke", frames: this.anims.generateFrameNumbers("smoke"), frameRate: 14 });

    // A four-pointed star for the sparkles around grand titles.
    this.make
      .graphics({}, false)
      .fillStyle(0xffffff)
      .fillPoints([
        { x: 4, y: 0 },
        { x: 5, y: 3 },
        { x: 8, y: 4 },
        { x: 5, y: 5 },
        { x: 4, y: 8 },
        { x: 3, y: 5 },
        { x: 0, y: 4 },
        { x: 3, y: 3 },
      ], true)
      .generateTexture("spark", 8, 8)
      .destroy();
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
