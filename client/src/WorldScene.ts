import Phaser from "phaser";
import type { Room } from "colyseus.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/world.ts";

const FONT = 'Tahoma, "Noto Sans Thai", "Leelawadee UI", sans-serif';
const TILE = 64;
const BUBBLE_MS = 4000;

interface PlayerView {
  container: Phaser.GameObjects.Container;
  bubble: Phaser.GameObjects.Text;
  bubbleTimer?: Phaser.Time.TimerEvent;
  /** Last position the server sent; the view glides towards it. */
  targetX: number;
  targetY: number;
}

/** Deterministic 0..99 per tile, so every player sees the same ground. */
function tileNoise(x: number, y: number) {
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

  create() {
    this.drawGround();
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
      player.onChange(() => {
        const view = this.views.get(sessionId);
        if (view) {
          view.targetX = player.x;
          view.targetY = player.y;
        }
      });
      // players.size isn't updated yet inside onAdd, so count what is on screen.
      this.onPlayerCount(this.views.size);
    });
    players.onRemove((_player: any, sessionId: string) => {
      this.views.get(sessionId)?.container.destroy();
      this.views.delete(sessionId);
      this.onPlayerCount(this.views.size);
    });
  }

  update(_time: number, delta: number) {
    this.sendKeyboardDirection();

    // Glide towards the server position instead of jumping 20 times a second.
    const blend = Math.min(1, delta / 90);
    this.views.forEach((view) => {
      view.container.x += (view.targetX - view.container.x) * blend;
      view.container.y += (view.targetY - view.container.y) * blend;
      view.container.setDepth(10 + view.container.y);
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

  private addPlayer(sessionId: string, player: { name: string; x: number; y: number; color: number }) {
    const isMe = sessionId === this.room.sessionId;

    const shadow = this.add.ellipse(0, 14, 30, 10, 0x000000, 0.25);
    const body = this.add.circle(0, 0, 14, player.color).setStrokeStyle(2, 0x1b1b1b, 0.6);
    const face = this.add.circle(0, -18, 10, 0xf6d7b0).setStrokeStyle(2, 0x1b1b1b, 0.6);
    const name = this.add
      .text(0, -40, player.name, {
        fontFamily: FONT,
        fontSize: "14px",
        color: isMe ? "#e9c46a" : "#ffffff",
        stroke: "#1b1b1b",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    const bubble = this.add
      .text(0, -60, "", {
        fontFamily: FONT,
        fontSize: "14px",
        color: "#1b1b1b",
        backgroundColor: "#ffffffee",
        padding: { x: 8, y: 5 },
        wordWrap: { width: 200, useAdvancedWrap: true },
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setVisible(false);

    const container = this.add.container(player.x, player.y, [shadow, body, face, name, bubble]);
    this.views.set(sessionId, { container, bubble, targetX: player.x, targetY: player.y });

    if (isMe) {
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
  }

  private drawGround() {
    const ground = this.add.graphics();
    for (let ty = 0; ty < WORLD_HEIGHT / TILE; ty++) {
      for (let tx = 0; tx < WORLD_WIDTH / TILE; tx++) {
        const n = tileNoise(tx, ty);
        ground.fillStyle(n < 50 ? 0x5a9a4c : n < 85 ? 0x619f52 : 0x6eab5b);
        ground.fillRect(tx * TILE, ty * TILE, TILE, TILE);

        // A few flowers and stones, purely for looks.
        if (n % 17 === 0) {
          ground.fillStyle(n % 2 ? 0xffd6e0 : 0xfff3b0);
          ground.fillCircle(tx * TILE + 20 + (n % 24), ty * TILE + 18 + (n % 30), 4);
        } else if (n % 23 === 0) {
          ground.fillStyle(0x8d99ae);
          ground.fillEllipse(tx * TILE + 32, ty * TILE + 34, 18, 12);
        }
      }
    }

    ground.lineStyle(6, 0x2d5a3d);
    ground.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }
}
