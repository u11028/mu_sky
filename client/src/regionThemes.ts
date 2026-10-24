import type { RegionId } from "../../shared/regions.ts";

/** The 16 px tilesets props are cut from. */
export type PropSheet = "nature" | "village" | "field";

/** Props as [sheet, column, row, width, height], counted in 16 px tiles. */
export const PROPS = {
  roundTree: ["nature", 0, 0, 2, 2],
  pine: ["nature", 2, 0, 2, 2],
  deadTree: ["nature", 4, 0, 2, 2],
  leafyTree: ["nature", 6, 0, 2, 2],
  cherry: ["nature", 14, 0, 2, 2],
  yellowTree: ["nature", 18, 0, 2, 2],
  pineCluster: ["nature", 0, 2, 4, 3],
  greenCluster: ["nature", 4, 2, 4, 3],
  cherryCluster: ["nature", 12, 2, 4, 3],
  rockPileBrown: ["nature", 12, 5, 4, 3],
  rockPileGrey: ["nature", 16, 5, 4, 3],
  bigRockBrown: ["nature", 17, 10, 4, 3],
  bigRockGrey: ["nature", 17, 14, 4, 3],
  bigCherry: ["nature", 0, 18, 3, 3],
  bigGreen: ["nature", 3, 18, 3, 3],
  bigOrange: ["nature", 9, 18, 3, 3],
  stumpBig: ["nature", 0, 8, 2, 2],
  bamboo: ["nature", 11, 8, 1, 2],
  bush: ["nature", 1, 10, 1, 1],
  tuft: ["nature", 3, 10, 1, 1],
  sunflower: ["nature", 0, 11, 1, 1],
  sunflower2: ["nature", 1, 11, 1, 1],
  flowerRed: ["nature", 3, 11, 1, 1],
  fern: ["nature", 4, 11, 1, 1],
  tallGrass: ["nature", 7, 11, 1, 1],
  house: ["village", 12, 6, 4, 5],
  paddy: ["field", 0, 3, 3, 3],
  paddyDark: ["field", 0, 6, 3, 3],
} as const satisfies Record<string, readonly [PropSheet, number, number, number, number]>;

export type PropName = keyof typeof PROPS;

/** Fixed props, by name and the point where their bottom centre stands. */
export type Placement = readonly [PropName, number, number];

export interface Theme {
  /** Frames in tiles/floor.png (22 tiles per row): a plain ground and a few with sprouts. */
  ground: number;
  groundDetails: number[];
  /** Props scattered at random places, picked by weight. */
  scatter: Partial<Record<PropName, number>>;
  scatterCount: number;
  /** Props the region is known for, at fixed places. */
  landmarks: (cx: number, cy: number) => Placement[];
  /** The side the sea lies on, outside the walkable bounds. */
  sea?: "east" | "south";
}

const LIGHT_GRASS = { ground: 12 * 22, groundDetails: [265, 266, 267, 268] };
const DARK_GRASS = { ground: 12 * 22 + 11, groundDetails: [276, 277, 278, 279] };
const RED_EARTH = { ground: 5 * 22, groundDetails: [111, 112, 113, 114] };

export const THEMES: Record<RegionId, Theme> = {
  central: {
    ...LIGHT_GRASS,
    scatter: { bigGreen: 2, roundTree: 3, leafyTree: 2, bush: 4, flowerRed: 3, sunflower: 1, tuft: 3 },
    scatterCount: 70,
    landmarks: (cx, cy) => [
      ["house", cx - 230, cy - 90],
      ["house", cx + 230, cy - 90],
      ["house", cx - 330, cy + 230],
      ["house", cx + 330, cy + 230],
    ],
  },
  north: {
    ...DARK_GRASS,
    scatter: { pineCluster: 3, pine: 5, cherry: 3, cherryCluster: 2, bigCherry: 2, rockPileGrey: 2, bigRockGrey: 1, fern: 3, tuft: 2 },
    scatterCount: 85,
    // A grove of cherry trees on the hill, like the wild Himalayan cherries in bloom.
    landmarks: (cx, cy) => [
      ["bigCherry", cx - 160, cy - 60],
      ["bigCherry", cx + 160, cy - 60],
      ["cherryCluster", cx, cy - 200],
      ["bigRockGrey", cx - 420, cy - 250],
      ["rockPileGrey", cx + 430, cy - 260],
    ],
  },
  northeast: {
    ...RED_EARTH,
    scatter: { sunflower: 4, sunflower2: 4, deadTree: 2, yellowTree: 2, stumpBig: 1, tuft: 2 },
    scatterCount: 45,
    // Rice paddies in a grid on both sides of the path through the middle.
    landmarks: (cx, cy) => {
      const fields: Placement[] = [];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const y = cy - 170 + row * 170;
          fields.push(["paddy", cx - 560 + col * 165, y], ["paddyDark", cx + 230 + col * 165, y]);
        }
      }
      return fields;
    },
  },
  east: {
    ...LIGHT_GRASS,
    sea: "east",
    scatter: { leafyTree: 2, bush: 3, flowerRed: 2, tuft: 2, yellowTree: 1 },
    scatterCount: 40,
    // An orchard of fruit trees in rows, east of the open middle, towards the sea.
    landmarks: (cx, cy) => {
      const orchard: Placement[] = [];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          orchard.push(["bigOrange", cx + 170 + col * 170, cy - 170 + row * 190]);
        }
      }
      return orchard;
    },
  },
  west: {
    ...DARK_GRASS,
    scatter: { greenCluster: 3, bigGreen: 3, bigRockBrown: 2, rockPileBrown: 2, fern: 3, roundTree: 2 },
    scatterCount: 90,
    landmarks: (cx, cy) => [
      ["bigRockBrown", cx - 200, cy - 260],
      ["rockPileBrown", cx + 120, cy - 300],
      ["bigRockBrown", cx + 380, cy + 260],
    ],
  },
  south: {
    ...RED_EARTH,
    sea: "south",
    scatter: { bamboo: 4, leafyTree: 2, bush: 2, rockPileBrown: 1 },
    scatterCount: 55,
    // A bamboo grove behind the beach.
    landmarks: (cx) => {
      const grove: Placement[] = [];
      for (let i = 0; i < 12; i++) {
        grove.push(["bamboo", cx - 300 + i * 55, 330 + (i % 3) * 30]);
      }
      return grove;
    },
  },
};

/** Small deterministic random generator, so every player sees the same layout. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
