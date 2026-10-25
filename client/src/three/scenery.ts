// Everything in a region that isn't a player or a monster: ground, sea, sky, props, portals, weather.

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../../shared/world.ts";
import { PORTAL_RADIUS, REGIONS, type RegionId } from "../../../shared/regions.ts";
import { PROPS, regionLayout, regionSeed, seededRandom, THEMES } from "../../../shared/regionThemes.ts";
import { copyModel, firstMesh, loadModel, standOnGround, tintLeaves } from "./assets.ts";
import { BORDER_MODELS, GRASS_MODELS, PROP_LOOKS, PX, REGION_LOOKS } from "./look.ts";

/** How far past the map's edge the ground goes, in units, so the camera never sees its end. */
const MARGIN = 40;
/** The sea's surface sits a little below the ground. */
const WATER_LEVEL = -0.35;

/** Something that moves on its own every frame. */
export type Animator = (time: number, delta: number) => void;

/** A tall prop that turns see-through when it stands between the camera and the player. */
export interface Occluder {
  object: THREE.Object3D;
  height: number;
  /** Own transparent copies of its materials, made the first time it fades. */
  materials?: THREE.Material[];
  opacity: number;
  /** When a line of sight to the player last passed through it. */
  blockedAt: number;
}

export interface Scenery {
  animators: Animator[];
  occluders: Occluder[];
  /** Height of the ground at a point, in units, for placing things on it. */
  heightAt: (x: number, z: number) => number;
}

/** Smooth value noise in [0, 1], the same everywhere for a given seed. */
function makeNoise(seed: number) {
  const hash = (x: number, y: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + seed * 0.013) * 43758.5453;
    return h - Math.floor(h);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const top = hash(xi, yi) * (1 - xf) + hash(xi + 1, yi) * xf;
    const bottom = hash(xi, yi + 1) * (1 - xf) + hash(xi + 1, yi + 1) * xf;
    return top * (1 - yf) + bottom * yf;
  };
  return (x: number, y: number) => noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.1;
}

/** Distance from a point to a line segment. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export async function buildScenery(scene: THREE.Scene, regionId: RegionId): Promise<Scenery> {
  const look = REGION_LOOKS[regionId];
  const region = REGIONS[regionId];
  const theme = THEMES[regionId];
  const { bounds } = region;
  const noise = makeNoise(regionSeed(regionId));
  const animators: Animator[] = [];
  const occluders: Occluder[] = [];

  // ---- Light and air ----
  scene.background = new THREE.Color(look.horizon);
  scene.fog = new THREE.Fog(look.horizon, 70, 150);
  scene.add(new THREE.HemisphereLight(look.sky, look.groundPatch, 1.15));
  addSky(scene, look.sky, look.horizon);

  // ---- Ground: rolling hills past the edges, paths to the portals, sand and seabed on the sea side ----
  const centre = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const paths = region.portals.map((portal) => [centre.x, centre.y, portal.x, portal.y] as const);
  const seaPast = (x: number, y: number) =>
    theme.sea === "east" ? x - bounds.maxX : theme.sea === "south" ? y - bounds.maxY : -Infinity;

  const heightAt = (ux: number, uz: number) => {
    const x = ux * PX;
    const y = uz * PX;
    const past = seaPast(x, y);
    if (past > 0) {
      // Beach sloping down under the water.
      return -Math.min(2.5, (past / PX) * 0.35);
    }
    // How far outside the walkable area: the land rises into hills there.
    // The camera looks from the south, from up to ~35 units behind the player: hills there would
    // stand between it and the player, so the land only rises to the north, east and west.
    const outside = Math.max(bounds.minX - x, x - bounds.maxX, bounds.minY - y, 0) / PX;
    const hills = Math.min(1, outside / 10) ** 1.5 * (4 + noise(ux * 0.08, uz * 0.08) * 6);
    return hills + (noise(ux * 0.15, uz * 0.15) - 0.5) * 0.35;
  };

  const width = WORLD_WIDTH / PX + MARGIN * 2;
  const depth = WORLD_HEIGHT / PX + MARGIN * 2;
  const geometry = new THREE.PlaneGeometry(width, depth, Math.round(width), Math.round(depth));
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(WORLD_WIDTH / PX / 2, 0, WORLD_HEIGHT / PX / 2);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const ground = new THREE.Color(look.ground);
  const patch = new THREE.Color(look.groundPatch);
  const shore = new THREE.Color(look.shore);
  const dirt = new THREE.Color("#d9b37a");
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const ux = positions.getX(i);
    const uz = positions.getZ(i);
    positions.setY(i, heightAt(ux, uz));
    const x = ux * PX;
    const y = uz * PX;

    color.copy(ground).lerp(patch, THREE.MathUtils.smoothstep(noise(ux * 0.09 + 10, uz * 0.09), 0.45, 0.7));
    const pathDistance = Math.min(...paths.map(([ax, ay, bx, by]) => segmentDistance(x, y, ax, ay, bx, by)));
    // Worn paths from the village centre to every portal, with soft edges.
    color.lerp(dirt, (1 - THREE.MathUtils.smoothstep(pathDistance, 18, 34)) * 0.85);
    const past = seaPast(x, y);
    if (past > -60) {
      color.lerp(shore, THREE.MathUtils.smoothstep(past, -60, -10));
    }
    // A touch of light and dark so the ground doesn't look flat.
    color.multiplyScalar(0.92 + noise(ux * 0.6, uz * 0.6) * 0.16);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const groundMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  groundMesh.receiveShadow = true;
  groundMesh.name = "ground";
  scene.add(groundMesh);

  if (theme.sea) {
    animators.push(addSea(scene, theme.sea, theme.sea === "east" ? bounds.maxX / PX : bounds.maxY / PX));
  }

  // ---- Grass tufts, drawn as a few instanced meshes ----
  const random = seededRandom(regionSeed(regionId) + 7);
  for (const path of GRASS_MODELS) {
    const mesh = firstMesh(await loadModel(path));
    if (!mesh) {
      continue;
    }
    const count = Math.round(look.grassCount / GRASS_MODELS.length);
    const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, count);
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox!.max.y - mesh.geometry.boundingBox!.min.y || 1;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const ux = (bounds.minX + random() * (bounds.maxX - bounds.minX)) / PX;
      const uz = (bounds.minY + random() * (bounds.maxY - bounds.minY)) / PX;
      const scale = (0.22 + random() * 0.25) / size;
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
      matrix.compose(new THREE.Vector3(ux, heightAt(ux, uz), uz), quaternion, new THREE.Vector3(scale, scale, scale));
      instanced.setMatrixAt(i, matrix);
    }
    instanced.receiveShadow = true;
    scene.add(instanced);
  }

  // ---- Props from the shared layout ----
  for (const { prop, x, y } of regionLayout(regionId).props) {
    const object = await buildProp(prop, x, y);
    if (object) {
      object.position.set(x / PX, heightAt(x / PX, y / PX), y / PX);
      scene.add(object);
      const height = PROP_LOOKS[prop].height;
      // Anything tall enough to hide a player: trees, houses, big rocks.
      if (height >= 1.5) {
        const occluder: Occluder = { object, height, opacity: 1, blockedAt: 0 };
        object.userData.occluder = occluder;
        occluders.push(occluder);
      }
    }
  }

  // ---- Mountains and hills beyond the edges ----
  // (No clouds: the camera on a phone sits as high as they would, and they covered the whole screen.)
  await addBorder(scene, regionId, heightAt);
  for (const portal of region.portals) {
    animators.push(addPortal(scene, portal.x / PX, portal.y / PX, REGIONS[portal.to].name));
  }
  if (look.petals) {
    animators.push(addPetals(scene, look.petals));
  }

  return { animators, occluders, heightAt };
}

/** A big dome with a gradient from the sky colour above to the haze at the horizon. */
function addSky(scene: THREE.Scene, sky: string, horizon: string) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(sky) }, bottom: { value: new THREE.Color(horizon) } },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vDir;
      void main() { gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.45, vDir.y)), 1.0); }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), material);
  dome.position.set(WORLD_WIDTH / PX / 2, 0, WORLD_HEIGHT / PX / 2);
  dome.renderOrder = -1;
  scene.add(dome);
}

/** Water with drifting light and foam where it meets the sand. */
function addSea(scene: THREE.Scene, side: "east" | "south", shoreline: number): Animator {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: {
      time: { value: 0 },
      shoreline: { value: shoreline },
      eastward: { value: side === "east" ? 1 : 0 },
      shallow: { value: new THREE.Color("#5fd4e8") },
      deep: { value: new THREE.Color("#1f78c9") },
      ...THREE.UniformsLib.fog,
    },
    vertexShader: `
      uniform float time;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        vec4 world = modelMatrix * vec4(p, 1.0);
        world.y += sin(world.x * 0.6 + time * 1.2) * 0.06 + cos(world.z * 0.5 + time) * 0.06;
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float time; uniform float shoreline; uniform float eastward;
      uniform vec3 shallow; uniform vec3 deep;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        float out_ = mix(vWorld.z, vWorld.x, eastward) - shoreline;
        vec3 color = mix(shallow, deep, smoothstep(1.0, 16.0, out_));
        float glint = pow(max(0.0, sin(vWorld.x * 1.7 + time * 1.3) * sin(vWorld.z * 1.3 - time * 0.9)), 12.0);
        float foam = smoothstep(2.4, 0.6, out_) * (0.55 + 0.45 * sin(out_ * 6.0 - time * 3.0));
        color += glint * 0.45 + foam * 0.5;
        gl_FragColor = vec4(color, 0.88);
        #include <fog_fragment>
      }`,
  });
  const size = 400;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 120, 120), material);
  water.rotation.x = -Math.PI / 2;
  water.position.set(WORLD_WIDTH / PX / 2, WATER_LEVEL, WORLD_HEIGHT / PX / 2);
  scene.add(water);
  return (time) => {
    material.uniforms.time.value = time / 1000;
  };
}

async function buildProp(prop: keyof typeof PROPS, x: number, y: number) {
  const look = PROP_LOOKS[prop];
  // The same variety for everyone: picked from the prop's position.
  const pick = Math.abs(Math.floor(x * 7.31 + y * 3.17));
  if (look.shape === "flower") {
    return flower(look.color!, look.height);
  }
  if (look.shape === "bamboo") {
    return bamboo(look.height, pick);
  }
  if (look.shape === "paddy") {
    const [, , , w, h] = PROPS[prop];
    return paddy(look.color!, (w * 48) / PX, (h * 48) / PX);
  }

  const group = new THREE.Group();
  const count = look.cluster ?? 1;
  const [, , , tilesWide] = PROPS[prop];
  const spread = ((tilesWide * 48) / PX) * 0.32;
  for (let i = 0; i < count; i++) {
    const path = look.models![(pick + i) % look.models!.length];
    let gltf;
    try {
      gltf = await loadModel(path);
    } catch {
      continue;
    }
    const model = copyModel(gltf);
    if (look.tint) {
      tintLeaves(model, look.tint);
    }
    const size = count > 1 ? look.height * (0.75 + ((pick + i * 13) % 5) * 0.08) : look.height;
    const placed = standOnGround(model, size);
    const angle = (i / count) * Math.PI * 2 + pick;
    if (count > 1) {
      placed.position.set(Math.cos(angle) * spread, 0, Math.sin(angle) * spread * 0.6 - spread * 0.3);
    }
    placed.rotation.y = prop === "house" ? 0 : (pick % 360) * (Math.PI / 180) + i;
    group.add(placed);
  }
  return group;
}

/** A flower: a stem and a ring of petals around a dark centre. */
function flower(color: string, height: number) {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, height, 5),
    new THREE.MeshStandardMaterial({ color: "#4f9a3a" }),
  );
  stem.position.y = height / 2;
  group.add(stem);
  const petals = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  petals.position.y = height;
  petals.rotation.x = 0.5;
  petals.castShadow = true;
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshStandardMaterial({ color: "#6b3d1f" }));
  heart.position.set(0, height + 0.05, 0.04);
  group.add(petals, heart);
  return group;
}

/** A clump of bamboo: jointed green stalks with a few leaves at the top. */
function bamboo(height: number, pick: number) {
  const group = new THREE.Group();
  const stalk = new THREE.MeshStandardMaterial({ color: "#7cb342", roughness: 0.6 });
  const joint = new THREE.MeshStandardMaterial({ color: "#558b2f" });
  const leaf = new THREE.MeshStandardMaterial({ color: "#8bc34a", side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const h = height * (0.75 + ((pick + i * 7) % 4) * 0.1);
    const x = Math.cos(i * 1.7 + pick) * 0.45;
    const z = Math.sin(i * 1.7 + pick) * 0.45;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, h, 7), stalk);
    pole.position.set(x, h / 2, z);
    pole.rotation.z = (i - 1.5) * 0.04;
    pole.castShadow = true;
    group.add(pole);
    for (let j = 1; j < 5; j++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 7), joint);
      ring.position.set(x, (h * j) / 5, z);
      group.add(ring);
    }
    for (let j = 0; j < 3; j++) {
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.1), leaf);
      blade.position.set(x, h - 0.2, z);
      blade.rotation.set(0.9, j * 2.1 + i, 0.3);
      group.add(blade);
    }
  }
  return group;
}

/** A rice paddy: a shallow green-water field with rows of rice plants. */
function paddy(color: string, width: number, depth: number) {
  const group = new THREE.Group();
  const field = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.92, 0.12, depth * 0.92),
    new THREE.MeshStandardMaterial({ color: "#6fae9a", roughness: 0.3, metalness: 0.1 }),
  );
  field.position.set(0, 0.04, -depth / 2);
  field.receiveShadow = true;
  const bank = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.1, depth),
    new THREE.MeshStandardMaterial({ color: "#9b7448" }),
  );
  bank.position.set(0, 0.02, -depth / 2);
  group.add(bank, field);
  const plant = new THREE.ConeGeometry(0.16, 0.7, 4);
  const material = new THREE.MeshStandardMaterial({ color });
  const rows = 5;
  const cols = 5;
  const plants = new THREE.InstancedMesh(plant, material, rows * cols);
  const matrix = new THREE.Matrix4();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      matrix.makeTranslation(((c + 0.5) / cols - 0.5) * width * 0.8, 0.4, -((r + 0.5) / rows) * depth * 0.85 - depth * 0.07);
      plants.setMatrixAt(r * cols + c, matrix);
    }
  }
  plants.castShadow = true;
  group.add(plants);
  return group;
}

/** Mountains and wooded hills just outside the map, so it ends in a landscape, not an edge. */
async function addBorder(scene: THREE.Scene, regionId: RegionId, heightAt: (x: number, z: number) => number) {
  const { bounds } = REGIONS[regionId];
  const sea = THEMES[regionId].sea;
  const random = seededRandom(regionSeed(regionId) + 3);
  const w = WORLD_WIDTH / PX;
  const h = WORLD_HEIGHT / PX;
  const spots: [number, number][] = [];
  const step = 9;
  for (let x = -10; x <= w + 10; x += step) {
    spots.push([x, bounds.minY / PX - 8 - random() * 8]);
    // None along the south edge: the camera stands there.
  }
  for (let z = -2; z <= h + 2; z += step) {
    spots.push([bounds.minX / PX - 8 - random() * 8, z]);
    if (sea !== "east") {
      spots.push([bounds.maxX / PX + 8 + random() * 8, z]);
    }
  }
  for (const [x, z] of spots) {
    const path = BORDER_MODELS[Math.floor(random() * BORDER_MODELS.length)];
    const model = standOnGround(copyModel(await loadModel(path), { shadows: false }), 7 + random() * 7);
    model.position.set(x, heightAt(x, z) - 0.6, z);
    model.rotation.y = random() * Math.PI * 2;
    model.scale.multiplyScalar(1.6);
    scene.add(model);
  }
}

/** A shimmering ring of light with a sign, leading to another region. */
function addPortal(scene: THREE.Scene, x: number, z: number, destination: string): Animator {
  const group = new THREE.Group();
  group.position.set(x, 0.05, z);
  const radius = PORTAL_RADIUS / PX;
  const glow = new THREE.MeshBasicMaterial({
    color: "#7df9ff",
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const base = new THREE.Mesh(new THREE.RingGeometry(radius * 0.75, radius * 1.15, 48), glow);
  base.rotation.x = -Math.PI / 2;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.75, 48),
    new THREE.MeshBasicMaterial({ map: radialTexture("#bff9ff"), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, 6, 32, 1, true),
    new THREE.MeshBasicMaterial({
      map: beamTexture("#7df9ff"),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 3;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.95, 0.07, 8, 48),
    new THREE.MeshBasicMaterial({ color: "#e9fdff" }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.6;
  group.add(base, disc, beam, ring);

  const sign = document.createElement("div");
  sign.className = "portal-sign";
  sign.textContent = `🌀 ไป${destination}`;
  const label = new CSS2DObject(sign);
  label.position.set(0, 4.4, 0);
  group.add(label);
  scene.add(group);

  return (time) => {
    const t = time / 1000;
    ring.position.y = 0.4 + ((t * 0.8) % 1) * 4;
    (ring.material as THREE.MeshBasicMaterial).opacity = 1 - ((t * 0.8) % 1);
    (ring.material as THREE.MeshBasicMaterial).transparent = true;
    disc.rotation.z = t * 1.5;
    glow.opacity = 0.45 + Math.sin(t * 3) * 0.15;
  };
}

/** Petals or leaves drifting down around the camera. */
function addPetals(scene: THREE.Scene, color: string): Animator {
  const count = 220;
  const positions = new Float32Array(count * 3);
  const random = seededRandom(5);
  const w = WORLD_WIDTH / PX;
  const h = WORLD_HEIGHT / PX;
  for (let i = 0; i < count; i++) {
    positions.set([random() * w, random() * 14, random() * h], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color, size: 0.32, map: radialTexture("#ffffff"), transparent: true, depthWrite: false }),
  );
  scene.add(points);
  return (time, delta) => {
    const t = time / 1000;
    for (let i = 0; i < count; i++) {
      let y = positions[i * 3 + 1] - delta * 0.0012;
      if (y < 0) {
        y = 14;
      }
      positions[i * 3 + 1] = y;
      positions[i * 3] += Math.sin(t + i) * delta * 0.0006 + delta * 0.0004;
      if (positions[i * 3] > w) {
        positions[i * 3] = 0;
      }
    }
    geometry.attributes.position.needsUpdate = true;
  };
}

/** A soft round spot, bright in the middle, for glows and petals. */
export function radialTexture(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.5, `${color}88`);
  gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Light fading upwards, for beams. */
function beamTexture(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 64, 0, 0);
  gradient.addColorStop(0, `${color}aa`);
  gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
