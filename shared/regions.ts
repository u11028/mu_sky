// The six regions of Thailand, each its own map and its own server room, and the dungeon.
// Portals link the central region to the other five; standing on one takes the player there.
// The dungeon's portal, also in the middle region, takes a team into a cave of its own.

export type RegionId = "central" | "north" | "northeast" | "east" | "west" | "south" | "dungeon";

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
      { to: "dungeon", x: 1150, y: 1060 },
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
  dungeon: {
    name: "ถ้ำดันเจี้ยน",
    tagline: "ฝ่าอสูร 4 ระลอกแล้วล้มบอส ก่อนหมดเวลา",
    // A cave hall in the middle of the map, walled in all round.
    bounds: { minX: 420, minY: 300, maxX: 1180, maxY: 900 },
    portals: [{ to: "central", x: 800, y: 860 }],
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

/** Safe zones: around where players appear in the middle, and around every portal. */
export const SAFE_RADIUS = 200;
export const PORTAL_SAFE_RADIUS = 140;

export interface SafeZone {
  x: number;
  y: number;
  radius: number;
}

const safeZoneCache = new Map<RegionId, SafeZone[]>();

/**
 * Where nobody can be hurt, by players or monsters, and nobody can attack: the middle, where players
 * appear and come back to life, and the portals, so nobody is ambushed on arriving.
 */
export function safeZones(region: RegionId): SafeZone[] {
  let zones = safeZoneCache.get(region);
  if (!zones) {
    const centre = spawnPoint(region);
    zones = [
      // The dungeon's middle is where the fighting is: only its way out is safe.
      ...(region === "dungeon" ? [] : [{ ...centre, radius: SAFE_RADIUS }]),
      ...REGIONS[region].portals.map((portal) => ({ x: portal.x, y: portal.y, radius: PORTAL_SAFE_RADIUS })),
    ];
    safeZoneCache.set(region, zones);
  }
  return zones;
}

export function inSafeZone(region: RegionId, x: number, y: number) {
  return safeZones(region).some((zone) => Math.hypot(zone.x - x, zone.y - y) <= zone.radius);
}
