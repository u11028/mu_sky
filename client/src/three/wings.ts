// Wings, built from simple shapes: feathers fanned out, a bat's or dragon's membrane, a butterfly's
// glowing lobes. Each pair flaps on its own, harder while the wearer moves.

import * as THREE from "three";
import type { Wing } from "../../../shared/cosmetics.ts";

/** A soft, rounded feather lying along +x. */
function featherShape(length: number, width: number) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(length * 0.4, width, length, 0);
  shape.quadraticCurveTo(length * 0.4, -width * 0.6, 0, 0);
  return shape;
}

/** A membrane between finger bones, scalloped along its lower edge: bat and dragon wings. */
function membraneShape(spiky: boolean) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.35, 0.75);
  shape.lineTo(1.35, 0.85);
  // Scallops between the fingertips.
  const tips: [number, number][] = [
    [1.45, 0.2],
    [1.05, -0.25],
    [0.6, -0.4],
    [0.15, -0.25],
  ];
  let [px, py] = [1.35, 0.85];
  for (const [x, y] of tips) {
    const sag = spiky ? 0.12 : 0.22;
    shape.quadraticCurveTo((px + x) / 2 - sag, (py + y) / 2 - sag * 0.4, x, y);
    [px, py] = [x, y];
  }
  shape.quadraticCurveTo(0.05, -0.05, 0, 0);
  return shape;
}

/** Two rounded lobes, big above and small below: a butterfly's wing. */
function butterflyShapes() {
  const upper = new THREE.Shape();
  upper.moveTo(0, 0);
  upper.bezierCurveTo(0.2, 0.9, 1.25, 1.05, 1.15, 0.35);
  upper.bezierCurveTo(1.1, 0.05, 0.5, 0.0, 0, 0);
  const lower = new THREE.Shape();
  lower.moveTo(0, 0);
  lower.bezierCurveTo(0.3, -0.1, 0.9, -0.25, 0.75, -0.7);
  lower.bezierCurveTo(0.55, -0.95, 0.1, -0.5, 0, 0);
  return [upper, lower];
}

function material(color: string, glow: string, glowStrength: number, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: glow,
    emissiveIntensity: glowStrength,
    side: THREE.DoubleSide,
    roughness: 0.5,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
}

/** One wing (the left one), its root at the origin, spreading towards -x. */
function oneWing(wing: Wing) {
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, angle = 0) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.z = angle;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  switch (wing.style) {
    case "feather":
    case "flame":
    case "cosmic": {
      // A bird's wing: the arm rises from the shoulder and arcs outward; long flight feathers hang from
      // it, longest at the tip, with a row of short coverts over their roots.
      const flame = wing.style === "flame";
      const back = material(wing.color, wing.glow, flame ? 0.9 : wing.style === "cosmic" ? 0.7 : 0.25);
      const front = material(flame ? "#ffd60a" : wing.style === "cosmic" ? "#3b2a80" : "#f4f8ff", wing.glow, flame ? 1.2 : 0.35);
      const arm = (t: number) => ({ x: 0.12 + t * 1.3, y: 0.1 + Math.sin(t * Math.PI * 0.85) * 0.6 });
      // Broad, overlapping feathers, so together they read as one wing rather than a comb.
      const flight = 13;
      for (let i = 0; i < flight; i++) {
        const t = i / (flight - 1);
        const { x, y } = arm(t);
        // Inner feathers hang straight down; outer ones sweep out towards the tip.
        add(new THREE.ShapeGeometry(featherShape(0.6 + t * 0.75, 0.42)), back, x, y, -0.004 * i, -1.85 + t * 1.25);
      }
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const { x, y } = arm(t * 0.95);
        add(new THREE.ShapeGeometry(featherShape(0.45 + t * 0.12, 0.36)), front, x, y + 0.02, 0.02, -1.3 + t * 0.9);
      }
      // A soft band along the arm hides where the feathers meet it.
      const band = new THREE.Shape();
      const top = Array.from({ length: 9 }, (_, i) => arm(i / 8));
      band.moveTo(top[0].x, top[0].y + 0.08);
      top.forEach((p) => band.lineTo(p.x, p.y + 0.08));
      [...top].reverse().forEach((p) => band.lineTo(p.x, p.y - 0.22));
      add(new THREE.ShapeGeometry(band), front, 0, 0, 0.025);
      break;
    }
    case "bat":
    case "dragon": {
      const dragon = wing.style === "dragon";
      add(new THREE.ShapeGeometry(membraneShape(!dragon)), material(wing.color, wing.glow, dragon ? 0.35 : 0.25, 0.92));
      // Finger bones along the membrane, glowing faintly.
      const bone = material(dragon ? "#0f4d33" : "#16061f", wing.glow, 0.6);
      for (const [x, y] of [
        [0.35, 0.75],
        [1.35, 0.85],
        [1.45, 0.2],
        [1.05, -0.25],
        [0.6, -0.4],
      ]) {
        const length = Math.hypot(x, y);
        const rod = add(new THREE.CylinderGeometry(0.025, 0.035, length, 5), bone);
        rod.position.set(x / 2, y / 2, 0.01);
        rod.rotation.z = Math.atan2(y, x) - Math.PI / 2;
      }
      break;
    }
    case "butterfly": {
      const [upper, lower] = butterflyShapes();
      const glass = material(wing.color, wing.glow, 0.9, 0.75);
      add(new THREE.ShapeGeometry(upper), glass);
      add(new THREE.ShapeGeometry(lower), glass);
      // Bright rims that catch the light.
      const rim = new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8 });
      for (const shape of [upper, lower]) {
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(shape.getPoints(24)), rim));
      }
      break;
    }
  }
  // The shapes were drawn spreading to +x; turn the wing so it spreads to -x (the wearer's left).
  group.scale.x = -1;
  return group;
}

/**
 * A pair of wings for the back. `group.userData.animate(time, moving)` flaps them;
 * cosmic wings also shift colour.
 */
export function buildWings(wing: Wing) {
  const pair = new THREE.Group();
  const left = new THREE.Group();
  const right = new THREE.Group();
  left.add(oneWing(wing));
  right.add(oneWing(wing));
  right.scale.x = -1;
  left.position.set(-0.1, 0, 0);
  right.position.set(0.1, 0, 0);
  pair.add(left, right);
  // Behind the shoulders, tilted back a little, and big enough to read from the game's camera.
  pair.position.set(0, 1.25, -0.28);
  pair.rotation.x = 0.15;
  pair.scale.setScalar(1.25);

  const glowing: THREE.MeshStandardMaterial[] = [];
  pair.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && (mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      glowing.push(mesh.material as THREE.MeshStandardMaterial);
    }
  });

  pair.userData.animate = (time: number, moving: boolean) => {
    const speed = moving ? 0.011 : 0.004;
    const reach = moving ? 0.55 : 0.22;
    const flap = Math.sin(time * speed) * reach;
    // Swept back from the body, beating forward and up.
    left.rotation.y = 0.4 + flap * 0.7;
    right.rotation.y = -0.4 - flap * 0.7;
    left.rotation.z = -flap * 0.5;
    right.rotation.z = flap * 0.5;
    if (wing.style === "cosmic") {
      const hue = (time / 4000) % 1;
      for (const mat of glowing) {
        mat.emissive.setHSL(hue, 0.8, 0.5);
      }
    } else if (wing.style === "flame") {
      for (const mat of glowing) {
        mat.emissiveIntensity = 0.9 + Math.sin(time / 90) * 0.25;
      }
    }
  };
  pair.userData.animate(0, false);
  return pair;
}
