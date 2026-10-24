// The six regions of Thailand, each its own map and its own server room.
// Portals link the central region to the other five; standing on one takes the player there.

export type RegionId = "central" | "north" | "northeast" | "east" | "west" | "south";

export interface Portal {
  to: RegionId;
  x: number;
  y: number;
}

export interface Region {
  name: string;
  /** Short line shown when entering, about what the region is known for. */
  tagline: string;
  /** The part of the map players can walk on; the sea lies outside it. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  portals: Portal[];
}

export const START_REGION: RegionId = "central";

/** Distance from a portal's centre at which it takes the player. */
export const PORTAL_RADIUS = 36;

const FULL = { minX: 16, minY: 16, maxX: 1584, maxY: 1184 };

export const REGIONS: Record<RegionId, Region> = {
  central: {
    name: "ภาคกลาง",
    tagline: "หมู่บ้านริมทุ่ง จุดเริ่มต้นการเดินทาง",
    bounds: FULL,
    portals: [
      { to: "north", x: 800, y: 110 },
      { to: "northeast", x: 1480, y: 300 },
      { to: "east", x: 1480, y: 900 },
      { to: "south", x: 800, y: 1090 },
      { to: "west", x: 120, y: 600 },
    ],
  },
  north: {
    name: "ภาคเหนือ",
    tagline: "ป่าสน ดอยสูง และซากุระเมืองไทย",
    bounds: FULL,
    portals: [{ to: "central", x: 800, y: 1090 }],
  },
  northeast: {
    name: "ภาคอีสาน",
    tagline: "ทุ่งนากว้าง ทานตะวันบาน",
    bounds: FULL,
    portals: [{ to: "central", x: 120, y: 900 }],
  },
  east: {
    name: "ภาคตะวันออก",
    tagline: "สวนผลไม้และทะเลตะวันออก",
    bounds: { ...FULL, maxX: 1300 },
    portals: [{ to: "central", x: 120, y: 300 }],
  },
  west: {
    name: "ภาคตะวันตก",
    tagline: "ป่าลึก ผาหิน และน้ำตก",
    bounds: FULL,
    portals: [{ to: "central", x: 1480, y: 600 }],
  },
  south: {
    name: "ภาคใต้",
    tagline: "หาดทราย ทะเลใส ป่าไผ่",
    bounds: { ...FULL, maxY: 900 },
    portals: [{ to: "central", x: 800, y: 110 }],
  },
};

export function isRegionId(value: unknown): value is RegionId {
  return typeof value === "string" && Object.hasOwn(REGIONS, value);
}

/** Where a player appears: just inside the portal back to where they came from, or the middle. */
export function spawnPoint(region: RegionId, from?: RegionId) {
  const { bounds, portals } = REGIONS[region];
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const back = portals.find((p) => p.to === from);
  if (!back) {
    return { x: cx, y: cy };
  }

  // Step 110 px from the portal towards the middle, out of its reach.
  const dx = cx - back.x;
  const dy = cy - back.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: back.x + (dx / length) * 110, y: back.y + (dy / length) * 110 };
}
