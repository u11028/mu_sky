import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import colyseus from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME, SERVER_PORT } from "../../shared/world.ts";
import * as accounts from "./accounts.ts";
import { clientAddress } from "./environment.ts";
import { leaderboards, saveNow, summary } from "./progress.ts";
import { flushed } from "./store.ts";
import { WorldRoom } from "./WorldRoom.ts";

// colyseus 0.15 is CommonJS: Node's ESM loader only sees its default export.
const { Server } = colyseus;
const port = Number(process.env.PORT) || SERVER_PORT;
const app = express();

// After `npm run build` the server also hands out the game itself, so one port is enough.
const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));
if (existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders(res, path) {
        if (/[\\/]assets[\\/][^\\/]+-[\w-]{8}\.(js|css)$/.test(path)) {
          // Built code: its name changes with every build, so it never needs asking about again.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (/\.(glb|ogg|mp3|png|jpg|webp)$/.test(path)) {
          // Models, music and pictures: kept a day, instead of asking the server about each one
          // (a round trip across the ocean) every time the game opens.
          res.setHeader("Cache-Control", "public, max-age=86400");
        } else {
          // The page itself: always the newest, so an update shows on the next visit.
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/leaderboards", (_req, res) => {
  res.json(leaderboards());
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

// One room per region and party: joining with { region: "north", party: "" } finds the public north,
// and { region: "north", party: "K7Q2MX" } that private room's own north.
gameServer.define(ROOM_NAME, WorldRoom).filterBy(["region", "party"]);

await gameServer.listen(port);
console.log(`Game server listening on port ${port}`);

// Keep the last few seconds of progress when the server is stopped (a free host stops it when it
// sleeps), waiting up to a few seconds for the database to take it.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    saveNow();
    void Promise.race([flushed(), new Promise((done) => setTimeout(done, 8000))]).then(() => process.exit(0));
  });
}
