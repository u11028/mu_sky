import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import colyseus from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME, SERVER_PORT } from "../../shared/world.ts";
import { WorldRoom } from "./WorldRoom.ts";

// colyseus 0.15 is CommonJS: Node's ESM loader only sees its default export.
const { Server } = colyseus;
const port = Number(process.env.PORT) || SERVER_PORT;
const app = express();

// After `npm run build` the server also hands out the game itself, so one port is enough.
const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer(app) }),
});

gameServer.define(ROOM_NAME, WorldRoom);

await gameServer.listen(port);
console.log(`Game server listening on port ${port}`);
