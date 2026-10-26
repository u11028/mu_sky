import { REGIONS, type RegionId } from "./regions.ts";

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
  dungeon: {
    ...RED_EARTH,
    // Rocks and dead trees around the hall's edge; the middle stays clear for the fight.
    scatter: { rockPileGrey: 3, bigRockGrey: 2, rockPileBrown: 2, deadTree: 2, stumpBig: 1 },
    scatterCount: 14,
    landmarks: (cx, cy) => [
      ["bigRockGrey", cx - 300, cy - 220],
      ["bigRockGrey", cx + 300, cy - 220],
      ["rockPileGrey", cx - 330, cy + 120],
      ["rockPileGrey", cx + 330, cy + 120],
    ],
  },
};

/** Props are drawn from 16 px tiles at three times their size. */
export const PROP_SCALE = 3;
const TILE = 16 * PROP_SCALE;

/**
 * The part of a prop that blocks walking, as width and height in world pixels, centred on the prop's
 * bottom edge: a trunk, a wall, a rock's base. Props without one (flowers, grass, fields) can be walked through.
 */
const SOLID: Partial<Record<PropName, readonly [number, number]>> = {
  roundTree: [30, 22],
  pine: [30, 22],
  deadTree: [30, 22],
  leafyTree: [30, 22],
  cherry: [30, 22],
  yellowTree: [30, 22],
  pineCluster: [150, 48],
  greenCluster: [150, 48],
  cherryCluster: [150, 48],
  rockPileBrown: [150, 56],
  rockPileGrey: [150, 56],
  bigRockBrown: [160, 80],
  bigRockGrey: [160, 80],
  bigCherry: [64, 30],
  bigGreen: [64, 30],
  bigOrange: [64, 30],
  stumpBig: [60, 30],
  bamboo: [18, 14],
  house: [176, 110],
};

export interface PlacedProp {
  prop: PropName;
  /** Bottom centre, where the prop stands. */
  x: number;
  y: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RegionLayout {
  props: PlacedProp[];
  /** Areas nobody can walk into. */
  solids: Box[];
}

/** A fixed number per region, so its random layout is the same for everyone. */
export function regionSeed(regionId: RegionId) {
  return [...regionId].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7);
}

const layouts = new Map<RegionId, RegionLayout>();

/** Where every prop of a region stands; the same on the server and in every browser. */
export function regionLayout(regionId: RegionId): RegionLayout {
  const cached = layouts.get(regionId);
  if (cached) {
    return cached;
  }

  const theme = THEMES[regionId];
  const { bounds, portals } = REGIONS[regionId];
  const random = seededRandom(regionSeed(regionId));
  const props: PlacedProp[] = [];

  // Where props already stand: the centre of their footprint and a radius, to keep the next ones apart.
  const taken: { x: number; y: number; r: number }[] = [];
  const footprint = (prop: PropName, x: number, y: number) => {
    const [, , , width, height] = PROPS[prop];
    const r = (Math.max(width, height) * TILE) / 2;
    return { x, y: y - (height * TILE) / 2, r };
  };
  const place = (prop: PropName, x: number, y: number) => {
    props.push({ prop, x, y });
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

  const solids = props.flatMap(({ prop, x, y }) => {
    const solid = SOLID[prop];
    return solid ? [{ minX: x - solid[0] / 2, maxX: x + solid[0] / 2, minY: y - solid[1], maxY: y }] : [];
  });

  const layout = { props, solids };
  layouts.set(regionId, layout);
  return layout;
}

/** Whether a walker this wide, with feet at x, y, would stand inside something solid. */
export function isBlocked(layout: RegionLayout, x: number, y: number, radius = 10) {
  return layout.solids.some(
    (box) => x + radius > box.minX && x - radius < box.maxX && y + radius / 2 > box.minY && y - radius / 2 < box.maxY,
  );
}

/**
 * Moves from (x, y) by (dx, dy), sliding along whatever is in the way.
 * Someone already stuck inside a prop (an old spawn, a GM teleport) may walk out freely.
 */
export function slide(layout: RegionLayout, x: number, y: number, dx: number, dy: number) {
  if (isBlocked(layout, x, y)) {
    return { x: x + dx, y: y + dy };
  }
  if (!isBlocked(layout, x + dx, y + dy)) {
    return { x: x + dx, y: y + dy };
  }
  if (dx !== 0 && !isBlocked(layout, x + dx, y)) {
    return { x: x + dx, y };
  }
  if (dy !== 0 && !isBlocked(layout, x, y + dy)) {
    return { x, y: y + dy };
  }
  return { x, y };
}

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
