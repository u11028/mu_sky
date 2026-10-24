// Character looks a player can pick. The index is what the server stores, so new looks go at the end.
// Each name is a 64x112 sheet in client/public/assets/characters/ (Ninja Adventure, CC0).

const FEATURED = [
  "NinjaBlue", "SamuraiBlue", "Samurai", "Knight", "KnightGold", "Princess", "Noble", "Monk",
  "Hunter", "Shaman", "SorcererBlack", "SorcererOrange", "NinjaRed", "NinjaGreen", "NinjaYellow", "NinjaDark",
];

const OTHERS = [
  "Boy", "CamouflageGreen", "CamouflageRed", "Cavegirl", "Cavegirl2", "CaveLion", "CaveLion2", "Caveman",
  "Caveman2", "DemonGreen", "DemonRed", "EggBoy", "EggGirl", "Eskimo", "FighterRed", "FighterWhite", "Flam",
  "GladiatorBlue", "GoldStatue", "GreenPig", "Inspector", "Lion", "LionBoy", "LionOrange", "LionYellow",
  "ManGreen", "MaskFrog", "MaskGoldRacoon", "MaskRacoon", "Master", "Monk2", "Monkey", "MonkeyBoxerBlue",
  "MonkeyBoxerRed", "NinjaBlue2", "NinjaBomb", "NinjaEskimo", "NinjaFire", "NinjaGray", "NinjaLeaf",
  "NinjaMageBlack", "NinjaMageOrange", "NinjaMasked", "NinjaRed2", "NinjaThunder", "NinjaWater", "OldMan",
  "OldMan2", "OldMan3", "Pig", "RedGladiator", "RedNinja3", "RobotCamouflage", "RobotGreen", "RobotGrey",
  "ShamanLion", "Skeleton", "SkeletonDemon", "Spirit", "Statue", "Sultan", "Sultan2", "Tengu", "Tengu2",
  "Vampire", "Village6", "Villager", "Villager2", "Villager3", "Villager4", "Villager5", "Villager6", "Woman",
];

export const SKINS: readonly string[] = [...FEATURED, ...OTHERS];
