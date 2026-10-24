import { MapSchema, Schema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("uint8") skin = 0;
  /** Id of the title shown above the name; "" for none. */
  @type("string") title = "";
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
