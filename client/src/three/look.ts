// How the shared world layout looks in 3D: ground and sky per region, and a model for every prop.

import type { RegionId } from "../../../shared/regions.ts";
import type { PropName } from "../../../shared/regionThemes.ts";

/** World pixels (what the server counts in) per 3D unit. A hero, about 48 px tall, is 2 units. */
export const PX = 24;

export interface RegionLook {
  ground: string;
  /** A second ground colour, blended in patches for variety. */
  groundPatch: string;
  /** Sand along the sea, or bare earth along paths. */
  shore: string;
  sky: string;
  horizon: string;
  sun: string;
  sunStrength: number;
  /** Drifting petals or leaves in the air. */
  petals?: string;
  /** Grass tufts scattered over the ground. */
  grassCount: number;
}

export const REGION_LOOKS: Record<RegionId, RegionLook> = {
  central: {
    ground: "#8fd16a",
    groundPatch: "#74bd55",
    shore: "#e8cf8f",
    sky: "#7ec8ff",
    horizon: "#d9f1ff",
    sun: "#fff1d6",
    sunStrength: 2.6,
    grassCount: 360,
  },
  north: {
    ground: "#6fb15a",
    groundPatch: "#5a9a49",
    shore: "#c9b48a",
    sky: "#9fc9f0",
    horizon: "#eef3ff",
    sun: "#fff4ea",
    sunStrength: 2.3,
    petals: "#ffb7d5",
    grassCount: 300,
  },
  northeast: {
    ground: "#d39a5c",
    groundPatch: "#9fbf5a",
    shore: "#e7c38a",
    sky: "#8fd0ff",
    horizon: "#fff0d2",
    sun: "#ffe2b0",
    sunStrength: 2.9,
    petals: "#ffe066",
    grassCount: 220,
  },
  east: {
    ground: "#93d470",
    groundPatch: "#7fc35d",
    shore: "#f3dca3",
    sky: "#6fc3ff",
    horizon: "#dff6ff",
    sun: "#fff3dc",
    sunStrength: 2.8,
    grassCount: 300,
  },
  west: {
    ground: "#5f9a48",
    groundPatch: "#4c853a",
    shore: "#a99272",
    sky: "#f3b98a",
    horizon: "#ffe2c4",
    sun: "#ffc98f",
    sunStrength: 2.4,
    grassCount: 380,
  },
  south: {
    ground: "#a6d46a",
    groundPatch: "#e3c98d",
    shore: "#f6e2ac",
    sky: "#62c0ff",
    horizon: "#e8fbff",
    sun: "#fff6e0",
    sunStrength: 3,
    grassCount: 240,
  },
};

/** How a 2D prop is drawn in 3D. */
export interface PropLook {
  /** Models in assets/3d to pick from (by position, so everyone sees the same one). */
  models?: string[];
  /** Height in world units. */
  height: number;
  /** Several smaller copies spread around, for clusters and rock piles. */
  cluster?: number;
  /** Recolour the leaves. */
  tint?: string;
  /** Drawn from simple shapes instead of a model. */
  shape?: "flower" | "bamboo" | "paddy";
  color?: string;
}

const ROUND_TREES = ["nature/Tree_1_A", "nature/Tree_1_B", "nature/Tree_3_A", "nature/Tree_3_B"];
const PINES = ["nature/Tree_2_A", "nature/Tree_2_B", "nature/Tree_2_C"];
const LEAFY = ["nature/Tree_4_A", "nature/Tree_4_B", "nature/Tree_1_C"];
const ROCKS = ["nature/Rock_1_A", "nature/Rock_1_E", "nature/Rock_1_J", "nature/Rock_2_A", "nature/Rock_2_D"];
const BIG_ROCKS = ["nature/Rock_3_A", "nature/Rock_3_E"];
const HOUSES = [
  "town/building_home_A_green",
  "town/building_tavern_green",
  "town/building_home_B_blue",
  "town/building_windmill_blue",
];

export const PROP_LOOKS: Record<PropName, PropLook> = {
  roundTree: { models: ROUND_TREES, height: 4.2 },
  pine: { models: PINES, height: 5 },
  deadTree: { models: ["nature/Tree_Bare_1_A", "nature/Tree_Bare_2_A"], height: 3.8 },
  leafyTree: { models: LEAFY, height: 4.4 },
  cherry: { models: ["nature/Tree_1_A", "nature/Tree_1_B"], height: 4, tint: "#ff9ec7" },
  yellowTree: { models: ["nature/Tree_3_A"], height: 4, tint: "#ffcf4d" },
  pineCluster: { models: PINES, height: 5.4, cluster: 3 },
  greenCluster: { models: LEAFY, height: 4.6, cluster: 3 },
  cherryCluster: { models: ["nature/Tree_1_A", "nature/Tree_1_C"], height: 4.4, cluster: 3, tint: "#ff9ec7" },
  rockPileBrown: { models: ROCKS, height: 1.6, cluster: 3, tint: "#c2946a" },
  rockPileGrey: { models: ROCKS, height: 1.6, cluster: 3 },
  bigRockBrown: { models: BIG_ROCKS, height: 3.6, tint: "#c2946a" },
  bigRockGrey: { models: BIG_ROCKS, height: 3.6 },
  bigCherry: { models: ["nature/Tree_1_C"], height: 6, tint: "#ff8fbf" },
  bigGreen: { models: ["nature/Tree_1_C", "nature/Tree_4_B"], height: 6 },
  bigOrange: { models: ["nature/Tree_3_A", "nature/Tree_1_B"], height: 4.4, tint: "#ffa94d" },
  stumpBig: { models: ["town/tree_single_A_cut"], height: 1.6 },
  bamboo: { shape: "bamboo", height: 5 },
  bush: { models: ["nature/Bush_1_A", "nature/Bush_2_A", "nature/Bush_3_A"], height: 1.2 },
  tuft: { models: ["nature/Grass_1_A", "nature/Grass_2_A"], height: 0.8 },
  sunflower: { shape: "flower", height: 1.3, color: "#ffd23f" },
  sunflower2: { shape: "flower", height: 1.1, color: "#ffb703" },
  flowerRed: { shape: "flower", height: 0.9, color: "#ff5d73" },
  fern: { models: ["nature/Bush_4_A"], height: 1 },
  tallGrass: { models: ["nature/Grass_2_A"], height: 1 },
  house: { models: HOUSES, height: 6 },
  paddy: { shape: "paddy", height: 0.5, color: "#7cc46a" },
  paddyDark: { shape: "paddy", height: 0.5, color: "#5fa84f" },
};

/** Every model a region's props might use, to load before drawing it. */
export function propModels() {
  return [...new Set(Object.values(PROP_LOOKS).flatMap((look) => look.models ?? []))];
}

/** Scenery outside the walkable area: mountains and wooded hills. */
export const BORDER_MODELS = [
  "town/mountain_A_grass_trees",
  "town/mountain_B_grass_trees",
  "town/mountain_C_grass",
  "town/hills_A_trees",
  "town/hills_B_trees",
];
export const CLOUD_MODELS = ["town/cloud_big", "town/cloud_small"];
export const GRASS_MODELS = ["nature/Grass_1_A", "nature/Grass_2_A"];
