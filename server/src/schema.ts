import { MapSchema, Schema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") color = 0;
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
