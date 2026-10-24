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
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
