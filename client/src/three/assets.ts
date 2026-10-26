// Loading 3D models once and handing out copies, sized to the world.

import * as THREE from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

// The models are packed with meshopt (about half the size, and a quarter once gzipped).
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();

/** Loads a model once; later calls share it. Paths are under assets/3d without the extension. */
export function loadModel(path: string) {
  let pending = cache.get(path);
  if (!pending) {
    pending = loader.loadAsync(`assets/3d/${path}.glb`).then((gltf) => {
      // Copies share these, so leaving a region must not free them.
      gltf.scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.userData.shared = true;
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            material.userData.shared = true;
            // Copies with their own materials still share these pictures.
            for (const value of Object.values(material)) {
              if ((value as THREE.Texture | null)?.isTexture) {
                (value as THREE.Texture).userData.shared = true;
              }
            }
          }
        }
      });
      return gltf;
    });
    cache.set(path, pending);
  }
  return pending;
}

/** Loads many models, reporting how far along it is (0 to 1). Missing files are skipped, not fatal. */
export async function preload(paths: string[], onProgress?: (share: number) => void) {
  let done = 0;
  const unique = [...new Set(paths)];
  await Promise.all(
    unique.map(async (path) => {
      try {
        await loadModel(path);
      } catch (error) {
        console.warn(`Could not load ${path}`, error);
      }
      done++;
      onProgress?.(done / unique.length);
    }),
  );
}

export interface CopyOptions {
  /** Own copies of the materials, so flashing one monster red doesn't flash them all. */
  ownMaterials?: boolean;
  shadows?: boolean;
}

/** A copy of a loaded model (skinned meshes keep working), with shadows set up. */
export function copyModel(gltf: GLTF, options: CopyOptions = {}) {
  const copy = SkeletonUtils.clone(gltf.scene);
  copy.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.castShadow = options.shadows ?? true;
    mesh.receiveShadow = true;
    if (options.ownMaterials) {
      const own = (material: THREE.Material) => {
        const copy = material.clone();
        // This copy belongs to one model only, so it is freed with it.
        copy.userData.shared = false;
        return copy;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    }
    // Skinned meshes' bounds come from the rest pose; animated limbs would get culled at screen edges.
    mesh.frustumCulled = !(mesh as THREE.SkinnedMesh).isSkinnedMesh;
  });
  return copy;
}

/**
 * Wraps a model in a group whose origin is at its feet, scaled to the given height.
 * The group is what gets moved and turned around.
 */
export function standOnGround(model: THREE.Object3D, height: number) {
  const box = restBounds(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = height / Math.max(size.y, 0.001);
  model.scale.multiplyScalar(scale);
  const centre = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  model.position.set(-centre.x, -box.min.y * scale, -centre.z);
  const group = new THREE.Group();
  group.add(model);
  return group;
}

/**
 * A model's bounds in its rest pose. Box3.setFromObject would pose skinned meshes with bones
 * that haven't been placed yet, which gives nonsense for models with scaled armatures.
 */
function restBounds(model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      // Through the bones, as drawn: packed (meshopt) models keep their vertices in a small
      // grid and put the scale back in the skeleton, so the raw vertices say nothing of the size.
      skinned.skeleton.update();
      skinned.computeBoundingBox();
      part.copy(skinned.boundingBox!).applyMatrix4(mesh.matrixWorld);
    } else {
      mesh.geometry.computeBoundingBox();
      part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    }
    box.union(part);
  });
  return box;
}

/** Every material in a model, for effects such as a hit flash. */
export function materialsOf(model: THREE.Object3D) {
  const materials: THREE.MeshStandardMaterial[] = [];
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          materials.push(material as THREE.MeshStandardMaterial);
        }
      }
    }
  });
  return materials;
}

const tinted = new Map<string, THREE.Material>();

/**
 * Recolours the green parts of a model's texture (leaves) while keeping their shading,
 * for pink cherry blossoms or golden fruit trees from the same green tree.
 */
export function tintLeaves(model: THREE.Object3D, color: THREE.ColorRepresentation) {
  const tint = new THREE.Color(color);
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const original = mesh.material as THREE.MeshStandardMaterial;
    const key = `${original.uuid}:${tint.getHexString()}`;
    let material = tinted.get(key);
    if (!material) {
      const copy = original.clone();
      copy.onBeforeCompile = (shader) => {
        shader.uniforms.uTint = { value: tint };
        shader.fragmentShader = `uniform vec3 uTint;\n${shader.fragmentShader}`.replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          float greenness = diffuseColor.g - max(diffuseColor.r, diffuseColor.b);
          if (greenness > 0.015) {
            float light = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = uTint * (0.45 + light * 1.8);
          }`,
        );
      };
      copy.customProgramCacheKey = () => `leaf-tint-${tint.getHexString()}`;
      copy.userData.shared = true;
      tinted.set(key, copy);
      material = copy;
    }
    mesh.material = material;
  });
}

/** The first mesh in a model, for drawing many copies at once with an InstancedMesh. */
export function firstMesh(gltf: GLTF) {
  let found: THREE.Mesh | undefined;
  gltf.scene.traverse((child) => {
    if (!found && (child as THREE.Mesh).isMesh) {
      found = child as THREE.Mesh;
    }
  });
  return found;
}
