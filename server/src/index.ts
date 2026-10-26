import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import colyseus from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME, SERVER_PORT } from "../../shared/world.ts";
import * as accounts from "./accounts.ts";
import { clientAddress } from "./environment.ts";
import { leaderboards, saveNow, summary } from "./progress.ts";
import { flushed } from "./store.ts";
import { report, reportServer } from "./errors.ts";
import { WorldRoom } from "./WorldRoom.ts";

// colyseus 0.15 is CommonJS: Node's ESM loader only sees its default export.
const { Server } = colyseus;
const port = Number(process.env.PORT) || SERVER_PORT;
const app = express();

// After `npm run build` the server also hands out the game itself, so one port is enough.
const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));
if (existsSync(clientDist)) {
  // Models have a gzipped twin made at build time: browsers that take gzip (all of them) get that,
  // a quarter of the size, at no cost to the server.
  app.get(/\.glb$/, (req, res, next) => {
    const packed = join(clientDist, decodeURIComponent(req.path) + ".gz");
    if (!/gzip/.test(String(req.headers["accept-encoding"] ?? "")) || !packed.startsWith(clientDist) || !existsSync(packed)) {
      next();
      return;
    }
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.type("model/gltf-binary");
    res.sendFile(packed);
  });
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

// Errors from players' browsers: grouped for the GM panel (see errors.ts). Bigger than the other
// requests, for the stack trace.
app.post("/api/errors", express.json({ limit: "8kb" }), (req, res) => {
  const result = report(req.body, clientAddress(req));
  res.status(result === "taken" ? 204 : result === "busy" ? 429 : 400).end();
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
  // Messages up to 16 KB: the default 4 KB is less than some phones' voice chat offers, which
  // would cut them off. Each message is still checked and trimmed by the room.
  transport: new WebSocketTransport({ server: createServer(app), maxPayload: 16 * 1024 }),
});

// One room per region and party: joining with { region: "north", party: "" } finds the public north,
// and { region: "north", party: "K7Q2MX" } that private room's own north.
gameServer.define(ROOM_NAME, WorldRoom).filterBy(["region", "party"]);

await gameServer.listen(port);
console.log(`Game server listening on port ${port}`);

// Errors outside any room: noted for the GM panel. A promise nobody waited on is noted and the
// game goes on; a thrown error leaves the server in an unknown state, so it saves and restarts.
process.on("unhandledRejection", (reason) => reportServer(reason, "unhandled promise"));
process.on("uncaughtException", (error) => {
  reportServer(error, "uncaught");
  saveNow();
  void Promise.race([flushed(), new Promise((done) => setTimeout(done, 5000))]).then(() => process.exit(1));
});

// Keep the last few seconds of progress when the server is stopped (a free host stops it when it
// sleeps), waiting up to a few seconds for the database to take it.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    saveNow();
    void Promise.race([flushed(), new Promise((done) => setTimeout(done, 8000))]).then(() => process.exit(0));
  });
}
