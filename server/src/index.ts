import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import colyseus from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME, SERVER_PORT } from "../../shared/world.ts";
import * as accounts from "./accounts.ts";
import { clientAddress } from "./environment.ts";
import { saveNow, summary } from "./progress.ts";
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

// Accounts: the reply carries the player id, plus the name and look last used, to fill in the join form.
app.use("/api", express.json({ limit: "2kb" }));
app.post("/api/register", (req, res) => {
  const result = accounts.register(req.body?.username, req.body?.password, req.body?.playerId);
  res.status(result.ok ? 200 : 400).json(result.ok ? { ...result, ...summary(result.playerId) } : result);
});
app.post("/api/login", (req, res) => {
  const result = accounts.login(req.body?.username, req.body?.password, clientAddress(req));
  res.status(result.ok ? 200 : 401).json(result.ok ? { ...result, ...summary(result.playerId) } : result);
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer(app) }),
});

// One room per region: joining with { region: "north" } only matches the north's room.
gameServer.define(ROOM_NAME, WorldRoom).filterBy(["region"]);

await gameServer.listen(port);
console.log(`Game server listening on port ${port}`);

// Keep the last few seconds of progress when the server is stopped.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    saveNow();
    process.exit(0);
  });
}
