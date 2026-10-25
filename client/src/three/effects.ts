// Short-lived visual effects: blade arcs, shock rings, beams of light, dust, floating numbers.

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { radialTexture } from "./scenery.ts";

/** One soft glow texture for every flash, made once. */
let glowTexture: THREE.Texture | undefined;

/** A camera-facing glow: flashes, muzzle fire, trails. */
function glowSprite(color: THREE.ColorRepresentation, size: number) {
  glowTexture ??= radialTexture("#ffffff");
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}

interface Effect {
  object: THREE.Object3D;
  born: number;
  life: number;
  /** Changes the object as it ages; t runs from 0 to 1. */
  step: (t: number) => void;
}

function glowMaterial(color: THREE.ColorRepresentation, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export class Effects {
  private effects: Effect[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  private add(object: THREE.Object3D, life: number, step: (t: number) => void) {
    this.scene.add(object);
    this.effects.push({ object, born: performance.now(), life, step });
    step(0);
  }

  update(now: number) {
    this.effects = this.effects.filter((effect) => {
      const t = (now - effect.born) / effect.life;
      if (t >= 1) {
        effect.object.removeFromParent();
        effect.object.traverse((child) => {
          const mesh = child as THREE.Mesh;
          // Every sprite shares one built-in geometry; freeing it would only force a re-upload.
          if (!(child as THREE.Sprite).isSprite) {
            mesh.geometry?.dispose();
          }
          (mesh.material as THREE.Material | undefined)?.dispose?.();
        });
        if (effect.object instanceof CSS2DObject) {
          effect.object.element.remove();
        }
        return false;
      }
      effect.step(t);
      return true;
    });
  }

  /**
   * A curved streak of light sweeping in front of a swing: a coloured arc with a white-hot edge.
   * `twin` adds a second, crossing arc for quick double strikes.
   */
  slash(at: THREE.Vector3, angle: number, color = "#fff2b8", twin = false) {
    const sweep = (tilt: number, delay: number) => {
      const material = glowMaterial(color, 0.9);
      const core = glowMaterial("#ffffff", 1);
      const arc = new THREE.Mesh(new THREE.RingGeometry(0.8, 2, 40, 1, -1.3, 2.6), material);
      const edge = new THREE.Mesh(new THREE.RingGeometry(1.85, 2.05, 40, 1, -1.3, 2.6), core);
      arc.rotation.x = edge.rotation.x = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(arc, edge);
      holder.position.copy(at).add(new THREE.Vector3(0, 1, 0));
      holder.rotation.set(tilt, angle - Math.PI / 2, 0);
      this.add(holder, 260 + delay, (t) => {
        const s = Math.max(0, (t * (260 + delay) - delay) / 260);
        arc.rotation.z = edge.rotation.z = -1.1 + s * 2.2;
        holder.scale.setScalar(0.65 + s * 0.55);
        material.opacity = s === 0 ? 0 : 0.9 * (1 - s);
        core.opacity = s === 0 ? 0 : 1 - s;
      });
    };
    sweep(0, 0);
    if (twin) {
      sweep(0.5, 90);
    }
  }

  /** A burst of light where a blow lands: a flash, streaks flying out and sparks. */
  impact(at: THREE.Vector3, color = "#fff3b0", big = false) {
    const flash = glowSprite(color, 1);
    flash.position.copy(at);
    const size = big ? 3.6 : 2.2;
    this.add(flash, 200, (t) => {
      flash.scale.setScalar(0.6 + t * size);
      flash.material.opacity = 1 - t;
    });
    const streaks = new THREE.Group();
    streaks.position.copy(at);
    const material = glowMaterial("#ffffff", 1);
    for (let i = 0; i < (big ? 10 : 6); i++) {
      const streak = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), material);
      const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5).normalize();
      streak.lookAt(direction);
      streak.userData.direction = direction;
      streaks.add(streak);
    }
    this.add(streaks, 220, (t) => {
      for (const streak of streaks.children) {
        streak.position.copy(streak.userData.direction).multiplyScalar(0.3 + t * (big ? 2 : 1.3));
      }
      material.opacity = 1 - t;
    });
    this.sparks(at, color, big ? 14 : 7);
  }

  /** The flash at the hands as a shot leaves. */
  muzzle(at: THREE.Vector3, color: string) {
    const flash = glowSprite(color, 0.4);
    flash.position.copy(at);
    this.add(flash, 140, (t) => {
      flash.scale.setScalar(0.4 + t * 1.4);
      flash.material.opacity = 1 - t;
    });
  }

  /** A fading glow left behind a shot in flight. */
  trail(at: THREE.Vector3, color: string, size: number) {
    const glow = glowSprite(color, size);
    glow.position.copy(at);
    this.add(glow, 260, (t) => {
      glow.scale.setScalar(size * (1 - t * 0.7));
      glow.material.opacity = 0.7 * (1 - t);
    });
  }

  /** A magic orb bursting: a bright bloom, a ring and a spray of sparks. */
  explosion(at: THREE.Vector3, color: string) {
    const bloom = glowSprite(color, 1);
    bloom.position.copy(at);
    this.add(bloom, 320, (t) => {
      bloom.scale.setScalar(1 + t * 4);
      bloom.material.opacity = 1 - t;
    });
    this.shockwave(new THREE.Vector3(at.x, 0, at.z), 2.4, color);
    this.sparks(at, "#ffffff", 10);
    this.sparks(at, color, 12);
  }

  /** A whirlwind of blades around the player. */
  whirl(at: THREE.Vector3, radius: number) {
    const material = glowMaterial("#9be7ff", 0.9);
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.55, radius, 48, 1, 0, Math.PI * 1.6), material);
    ring.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(ring);
    holder.position.copy(at).add(new THREE.Vector3(0, 0.9, 0));
    this.add(holder, 380, (t) => {
      holder.rotation.y = -t * Math.PI * 2.5;
      holder.scale.setScalar(0.5 + t * 0.6);
      material.opacity = 0.9 * (1 - t * t);
    });
  }

  /** A ring of force spreading over the ground, for a boss's slam. */
  shockwave(at: THREE.Vector3, radius: number, color = "#ff4d4d") {
    const material = glowMaterial(color, 0.8);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(at).add(new THREE.Vector3(0, 0.1, 0));
    this.add(ring, 500, (t) => {
      ring.scale.setScalar(0.3 + t * radius);
      material.opacity = 0.8 * (1 - t);
    });
  }

  /** A column of golden light and a spreading ring: a level gained. */
  levelUp(at: THREE.Vector3) {
    const material = glowMaterial("#ffd60a", 0.7);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 7, 24, 1, true), material);
    pillar.position.copy(at).add(new THREE.Vector3(0, 3.5, 0));
    this.add(pillar, 1100, (t) => {
      pillar.scale.set(1 - t * 0.6, 0.2 + t, 1 - t * 0.6);
      material.opacity = 0.7 * (1 - t);
    });
    this.shockwave(at, 4, "#ffd60a");
    this.sparks(at.clone().add(new THREE.Vector3(0, 1, 0)), "#ffe680", 18);
  }

  /**
   * A drop: a tall beam in the rarity's colour and a spinning gem that rises and fades.
   * The rarer, the longer and brighter; the rarest also send out a ring.
   */
  loot(at: THREE.Vector3, color: string, rarity: number) {
    const life = 1600 + rarity * 500;
    const material = glowMaterial(color, 0.35 + rarity * 0.1);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 9, 16, 1, true), material);
    beam.position.copy(at).add(new THREE.Vector3(0, 4.5, 0));
    const startOpacity = material.opacity;
    this.add(beam, life, (t) => {
      beam.scale.set(1 + Math.sin(t * 30) * 0.06, Math.min(1, t * 6), 1 + Math.sin(t * 30) * 0.06);
      material.opacity = startOpacity * (t < 0.7 ? 1 : (1 - t) / 0.3);
    });
    const gemMaterial = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3, transparent: true });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), gemMaterial);
    const halo = glowSprite(color, 1.6);
    gem.add(halo);
    this.add(gem, life, (t) => {
      gem.position.copy(at).add(new THREE.Vector3(0, 0.8 + t * 1.4, 0));
      gem.rotation.y = t * 14;
      gemMaterial.opacity = t < 0.75 ? 1 : (1 - t) / 0.25;
      halo.material.opacity = gemMaterial.opacity;
    });
    this.sparks(at.clone().add(new THREE.Vector3(0, 0.8, 0)), color, 6 + rarity * 4);
    if (rarity >= 3) {
      this.shockwave(at, 3 + rarity, color);
    }
  }

  /** Puffs of dust or smoke. */
  dust(at: THREE.Vector3, size = 1, color = "#e8dcc8") {
    for (let i = 0; i < 5; i++) {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false });
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 * size, 0), material);
      const drift = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2);
      puff.position.copy(at).add(new THREE.Vector3(0, 0.3, 0));
      const start = puff.position.clone();
      this.add(puff, 520 + Math.random() * 200, (t) => {
        puff.position.copy(start).addScaledVector(drift, t * size);
        puff.scale.setScalar(0.6 + t * 1.2);
        material.opacity = 0.7 * (1 - t);
      });
    }
  }

  /** Little glowing bits flying out, for hits and level ups. */
  sparks(at: THREE.Vector3, color: string, count = 8) {
    for (let i = 0; i < count; i++) {
      const material = glowMaterial(color, 1);
      const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), material);
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5);
      spark.position.copy(at);
      const start = at.clone();
      this.add(spark, 450 + Math.random() * 250, (t) => {
        spark.position.copy(start).addScaledVector(velocity, t * 0.6).add(new THREE.Vector3(0, -t * t * 2, 0));
        material.opacity = 1 - t;
      });
    }
  }

  /** A jagged bolt from the sky with a flash of light where it lands. */
  lightning(at: THREE.Vector3, radius: number) {
    const bolt = new THREE.Group();
    const material = glowMaterial("#bfe9ff", 1);
    let from = new THREE.Vector3(at.x + (Math.random() - 0.5) * 2, 14, at.z + (Math.random() - 0.5) * 2);
    for (let i = 1; i <= 7; i++) {
      const to =
        i === 7
          ? at.clone()
          : new THREE.Vector3(
              at.x + (Math.random() - 0.5) * 1.6,
              14 - (14 * i) / 7,
              at.z + (Math.random() - 0.5) * 1.6,
            );
      const length = from.distanceTo(to);
      const segment = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, length, 5), material);
      segment.position.copy(from).lerp(to, 0.5);
      segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      bolt.add(segment);
      from = to;
    }
    const light = new THREE.PointLight("#9fdcff", 60, radius * 4);
    light.position.copy(at).add(new THREE.Vector3(0, 2, 0));
    bolt.add(light);
    this.add(bolt, 320, (t) => {
      // Flickers, then fades.
      material.opacity = t < 0.5 ? (Math.random() > 0.3 ? 1 : 0.2) : 1 - t;
      light.intensity = 60 * (1 - t);
    });
    this.shockwave(at, radius, "#9fdcff");
    this.sparks(at.clone().add(new THREE.Vector3(0, 0.4, 0)), "#e0f6ff", 16);
    this.dust(at, 1.6, "#cfd8e3");
  }

  /** A soft green glow rising around someone: health given back. */
  heal(at: THREE.Vector3) {
    const material = glowMaterial("#7dff9a", 0.6);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 3, 24, 1, true), material);
    column.position.copy(at).add(new THREE.Vector3(0, 1.5, 0));
    this.add(column, 900, (t) => {
      column.position.y = at.y + 1.5 + t * 1.2;
      material.opacity = 0.6 * (1 - t);
    });
    this.shockwave(at, 2.5, "#7dff9a");
    this.sparks(at.clone().add(new THREE.Vector3(0, 0.6, 0)), "#b9ffc8", 14);
  }

  /** A number or word that pops up over someone and floats away. */
  floatText(at: THREE.Vector3, text: string, className: string, life = 1000) {
    const element = document.createElement("div");
    element.className = `float-text ${className}`;
    element.textContent = text;
    const label = new CSS2DObject(element);
    const start = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, 0));
    label.position.copy(start);
    this.add(label, life, (t) => {
      label.position.y = start.y + t * 1.6;
      element.style.opacity = String(t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6);
    });
  }
}
