// The heroes a player can be. The server stores the chosen one's index as the player's `skin`.

export interface Hero {
  /** File name of the model in assets/3d/heroes. */
  id: string;
  name: string;
  /** Weapons held in the right and left hand, from assets/3d/weapons. */
  right?: string;
  left?: string;
}

export const HEROES: readonly Hero[] = [
  { id: "Knight", name: "อัศวิน", right: "sword_1handed", left: "shield_badge_color" },
  { id: "Barbarian", name: "นักรบเถื่อน", right: "axe_1handed", left: "shield_round_barbarian" },
  { id: "Mage", name: "จอมเวท", right: "staff", left: "spellbook_open" },
  { id: "Ranger", name: "พรานป่า", left: "bow_withString" },
  { id: "Rogue", name: "โจรเงา", right: "dagger", left: "dagger" },
  { id: "Rogue_Hooded", name: "นักฆ่าคลุมหน้า", right: "crossbow_1handed", left: "dagger" },
  { id: "Skeleton_Warrior", name: "อัศวินกระดูก", right: "Skeleton_Blade", left: "Skeleton_Shield_Small_A" },
  { id: "Skeleton_Mage", name: "จอมเวทกระดูก", right: "Skeleton_Staff" },
  { id: "Skeleton_Rogue", name: "โจรกระดูก", right: "Skeleton_Axe" },
  { id: "Skeleton_Minion", name: "สมุนกระดูก", right: "Skeleton_Blade" },
];

/** Players saved with an older, larger list of looks still get a hero. */
export function heroOf(skin: number) {
  const count = HEROES.length;
  return HEROES[((Math.floor(skin) % count) + count) % count];
}
