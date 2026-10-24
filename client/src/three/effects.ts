// Short-lived visual effects: blade arcs, shock rings, beams of light, dust, floating numbers.

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

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
          mesh.geometry?.dispose();
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

  /** A curved streak of light sweeping in front of a swing. */
  slash(at: THREE.Vector3, angle: number, color = "#fff2b8") {
    const material = glowMaterial(color, 0.95);
    const arc = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.9, 32, 1, -1.2, 2.4), material);
    arc.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(arc);
    holder.position.copy(at).add(new THREE.Vector3(0, 1, 0));
    holder.rotation.y = angle - Math.PI / 2;
    this.add(holder, 240, (t) => {
      arc.rotation.z = -0.9 + t * 1.8;
      holder.scale.setScalar(0.7 + t * 0.5);
      material.opacity = 0.95 * (1 - t);
    });
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

  /** A number or word that pops up over someone and floats away. */
  floatText(at: THREE.Vector3, text: string, className: string) {
    const element = document.createElement("div");
    element.className = `float-text ${className}`;
    element.textContent = text;
    const label = new CSS2DObject(element);
    const start = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, 0));
    label.position.copy(start);
    this.add(label, 1000, (t) => {
      label.position.y = start.y + t * 1.6;
      element.style.opacity = String(t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6);
    });
  }
}
