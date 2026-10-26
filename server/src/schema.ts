import { MapSchema, Schema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("uint8") skin = 0;
  /** Id of the title shown above the name; "" for none. */
  @type("string") title = "";
  @type("uint16") level = 1;
  @type("uint32") xp = 0;
  @type("uint16") hp = 100;
  @type("uint16") maxHp = 100;
  @type("boolean") dead = false;
  /** Shown with a GM mark by the name. */
  @type("boolean") gm = false;
  /** Immortal (a GM power): drawn with a golden aura. */
  @type("boolean") god = false;
  @type("uint32") gold = 0;
  @type("uint16") potions = 0;
  /** Shop tiers, shown as a glowing weapon. */
  @type("uint8") weapon = 0;
  @type("uint8") armor = 0;
  /** Rarity of the weapon found on monsters and worn (-1 for none): its glow outshines the shop's. */
  @type("int8") gearRarity = -1;
  /** The worn weapon's damage multiplier; the server's alone, not sent. */
  gearPower = 1;
  /** The team's id, or "" when alone: teammates can't hurt each other. */
  @type("string") team = "";
  /** Wings worn and mount chosen (0 = none), and whether the player is riding it now. */
  @type("uint8") wing = 0;
  @type("uint8") mount = 0;
  @type("boolean") riding = false;
  /** The connection dropped and the game is waiting for them to come back: shown, but out of reach. */
  @type("boolean") away = false;
  /** Class skills in effect: under a bulwark (half damage taken), or berserk (harder, faster). */
  @type("boolean") guarded = false;
  @type("boolean") rage = false;
}

export class Monster extends Schema {
  /** Key into MONSTER_KINDS. */
  @type("string") kind = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("uint16") level = 1;
  @type("uint32") hp = 1;
  @type("uint32") maxHp = 1;
  @type("boolean") dead = false;
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Monster }) monsters = new MapSchema<Monster>();
}
