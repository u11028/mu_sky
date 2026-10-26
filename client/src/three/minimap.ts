// The whole region in a corner: the player (an arrow), teammates, other players, monsters, bosses,
// the world boss, portals and safe zones. A tap opens it big in the middle of the screen, with the
// portals' destinations written in.

import { REGIONS, type RegionId, safeZones } from "../../../shared/regions.ts";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../../shared/world.ts";
import { REGION_LOOKS } from "./look.ts";

export interface MapDot {
  x: number;
  y: number;
}

export interface MapView {
  me?: MapDot & { facingX: number; facingY: number };
  mates: MapDot[];
  others: MapDot[];
  monsters: (MapDot & { boss: boolean; world: boolean })[];
}

export class Minimap {
  private big = false;
  private readonly context: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly regionId: RegionId,
  ) {
    this.context = canvas.getContext("2d")!;
    canvas.hidden = false;
    canvas.onclick = () => {
      this.big = !this.big;
      canvas.classList.toggle("big", this.big);
    };
  }

  hide() {
    this.canvas.hidden = true;
    this.canvas.classList.remove("big");
    this.canvas.onclick = null;
  }

  draw(view: MapView, now: number) {
    const { canvas, context: g } = this;
    // Sharp on any screen: the drawing buffer follows the size on screen.
    const ratio = Math.min(devicePixelRatio, 2);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (width === 0 || height === 0) {
      return;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const sx = width / WORLD_WIDTH;
    const sy = height / WORLD_HEIGHT;
    const unit = width / 120;
    const region = REGIONS[this.regionId];
    const look = REGION_LOOKS[this.regionId];

    // The sea all round, the walkable land on it.
    g.fillStyle = "#2f7fb8";
    g.fillRect(0, 0, width, height);
    const { minX, minY, maxX, maxY } = region.bounds;
    g.fillStyle = look.ground;
    g.fillRect(minX * sx, minY * sy, (maxX - minX) * sx, (maxY - minY) * sy);

    for (const zone of safeZones(this.regionId)) {
      g.beginPath();
      g.ellipse(zone.x * sx, zone.y * sy, zone.radius * sx, zone.radius * sy, 0, 0, Math.PI * 2);
      g.fillStyle = "rgba(57, 184, 255, 0.25)";
      g.fill();
      g.strokeStyle = "rgba(30, 155, 255, 0.8)";
      g.lineWidth = unit * 0.6;
      g.stroke();
    }

    for (const portal of region.portals) {
      const x = portal.x * sx;
      const y = portal.y * sy;
      g.beginPath();
      g.arc(x, y, unit * 3, 0, Math.PI * 2);
      g.fillStyle = "#7df9ff";
      g.fill();
      g.strokeStyle = "#0b3b52";
      g.lineWidth = unit * 0.7;
      g.stroke();
      if (this.big) {
        this.label(REGIONS[portal.to].name, x, y - unit * 5, unit * 4);
      }
    }

    const dot = (point: MapDot, radius: number, fill: string, stroke = "rgba(0,0,0,0.6)") => {
      g.beginPath();
      g.arc(point.x * sx, point.y * sy, radius, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      g.strokeStyle = stroke;
      g.lineWidth = unit * 0.4;
      g.stroke();
    };
    for (const monster of view.monsters) {
      if (monster.world) {
        // The world boss throbs, so nobody misses it.
        dot(monster, unit * (4 + Math.sin(now / 200)), "#ff2fb4", "#fff");
      } else if (monster.boss) {
        dot(monster, unit * 3, "#b5179e", "#ffd60a");
        if (this.big) {
          this.label("บอส", monster.x * sx, monster.y * sy - unit * 5, unit * 3.5);
        }
      } else {
        dot(monster, unit * 1.3, "#e63946");
      }
    }
    view.others.forEach((player) => dot(player, unit * 1.8, "#ffffff"));
    view.mates.forEach((mate) => dot(mate, unit * 2.2, "#52d273", "#fff"));

    if (view.me) {
      // An arrow the way the player faces.
      const { x, y, facingX, facingY } = view.me;
      const angle = Math.atan2(facingY * sy, facingX * sx);
      g.save();
      g.translate(x * sx, y * sy);
      g.rotate(angle);
      g.beginPath();
      g.moveTo(unit * 4, 0);
      g.lineTo(-unit * 2.5, unit * 2.6);
      g.lineTo(-unit * 1.2, 0);
      g.lineTo(-unit * 2.5, -unit * 2.6);
      g.closePath();
      g.fillStyle = "#ffd60a";
      g.fill();
      g.strokeStyle = "#3d2a00";
      g.lineWidth = unit * 0.6;
      g.stroke();
      g.restore();
    }
  }

  private label(text: string, x: number, y: number, size: number) {
    const g = this.context;
    g.font = `700 ${size}px Kanit, sans-serif`;
    g.textAlign = "center";
    g.lineWidth = size * 0.3;
    g.strokeStyle = "rgba(0, 0, 0, 0.75)";
    g.strokeText(text, x, y);
    g.fillStyle = "#ffffff";
    g.fillText(text, x, y);
  }
}
