// The game's rules, played by bots against a real server: run with `npm test`, and on GitHub
// before every deploy. Each test uses its own private room so they don't get in each other's way.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "colyseus.js";
import { gm, join, makeGm, partyCode, startServer, until, wait, walkTo } from "./helpers.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
});

describe("joining", () => {
  test("a player arrives in the middle of the central region, with a full health bar", async () => {
    const bot = await join(server, { name: "มาใหม่", party: partyCode() });
    const me = bot.me();
    assert.equal(me.name, "มาใหม่");
    assert.ok(Math.hypot(me.x - 800, me.y - 600) < 60);
    assert.equal(me.hp, me.maxHp);
    await bot.room.leave();
  });

  test("names posing as the game or a GM are replaced", async () => {
    for (const name of ["ระบบ", "GM", "[GM] เจ้าของ", "admin", "​ระบบ", "‮ระบบ"]) {
      const bot = await join(server, { name, party: partyCode() });
      assert.match(bot.me().name, /^ผู้เล่น\d{4}$/, `"${name}" should have been replaced`);
      await bot.room.leave();
    }
  });

  test("the first visit of the day brings a gift, the second none", async () => {
    const id = `test_gift_${Date.now()}`;
    const first = await join(server, { id, party: partyCode() });
    await until(() => first.got["daily-gift"]);
    assert.equal(first.got["daily-gift"][0].day, 1);
    await first.room.leave();
    const second = await join(server, { id, party: partyCode() });
    await wait(500);
    assert.equal(second.got["daily-gift"], undefined);
    await second.room.leave();
  });
});

describe("cheating and junk", () => {
  test("directions that are not numbers don't break the position", async () => {
    const bot = await join(server, { party: partyCode() });
    for (const dir of [{ x: Infinity, y: 0 }, { x: "1e999", y: -Infinity }, { x: NaN, y: "abc" }, { x: 1e308, y: 1e308 }, "junk"]) {
      bot.room.send("dir", dir);
      await wait(100);
    }
    bot.room.send("dir", { x: 0, y: 0 });
    await wait(200);
    assert.ok(Number.isFinite(bot.me().x) && Number.isFinite(bot.me().y));
    await bot.room.leave();
  });

  test("junk in every kind of message neither breaks the server nor gives anything", async () => {
    const bot = await join(server, { party: partyCode() });
    await until(() => bot.got["daily-gift"]);
    const gold = bot.me().gold;
    const junk = [undefined, null, 0, -1, 1e309, "x".repeat(12000), { a: { b: 1 } }, [1, 2]];
    const types = ["target", "chat", "equip-title", "attack", "buy", "potion", "gear-wear", "gear-off", "gear-sell", "buy-cosmetic", "equip", "ride", "team-invite", "team-answer", "team-leave", "skill", "gm", "voice", "voice-signal"];
    for (const type of types) for (const value of junk) bot.room.send(type, value);
    await wait(1000);
    assert.ok(bot.room.connection.isOpen, "still connected");
    assert.equal(bot.me().gold, gold);
    await bot.room.leave();
  });

});

describe("fighting", () => {
  test("players can't hurt each other in a safe zone, and can outside it", async () => {
    const party = partyCode();
    const a = await join(server, { name: "ดาบซ้าย", party });
    const b = await join(server, { name: "ดาบขวา", party });
    await Promise.all([walkTo(a, 800, 600), walkTo(b, 830, 600)]);
    await wait(1700); // past the arrival shield
    for (let i = 0; i < 3; i++) {
      a.room.send("attack");
      await wait(700);
    }
    assert.equal(b.me().hp, b.me().maxHp, "no harm inside");
    assert.ok(a.said().some((text) => text.includes("เขตปลอดภัย")));

    await Promise.all([walkTo(a, 800, 900), walkTo(b, 830, 900)]);
    for (let i = 0; i < 3; i++) {
      a.room.send("attack");
      await wait(700);
    }
    assert.ok(b.me().hp < b.me().maxHp, "hurt outside");
    await a.room.leave();
    await b.room.leave();
  });

  test("monsters give gold and experience, and sometimes gear", async () => {
    const bot = await join(server, { party: partyCode() });
    await makeGm(bot);
    gm(bot, "onehit", { on: true });
    gm(bot, "god", { on: true });
    // Each kill drops gear one time in five: keep at it until something drops (up to 40 kills,
    // when nothing at all would be about one chance in seven thousand).
    let kills = 0;
    const found = () => (bot.got.bag?.at(-1)?.items.length ?? 0) > 0;
    for (let round = 0; round < 90 && (kills < 10 || !found()) && kills < 40; round++) {
      const me = bot.me();
      let nearest;
      let distance = Infinity;
      bot.room.state.monsters.forEach((monster) => {
        const d = Math.hypot(monster.x - me.x, monster.y - me.y);
        if (!monster.dead && monster.kind !== "rahu" && d < distance) {
          nearest = monster;
          distance = d;
        }
      });
      if (!nearest) {
        await wait(500);
        continue;
      }
      await walkTo(bot, nearest.x + 20, nearest.y);
      bot.room.send("attack");
      await wait(700);
      kills = bot.got.xp?.length ?? 0;
    }
    assert.ok(kills >= 10, `killed ${kills}`);
    assert.ok(bot.me().gold > 0);
    assert.ok(found(), `found some gear in ${kills} kills`);
    await bot.room.leave();
  });

  test("gear can be worn, raising health, and sold for gold", async () => {
    const bot = await join(server, { party: partyCode() });
    await makeGm(bot);
    for (let i = 0; i < 4; i++) gm(bot, "gear");
    await until(() => (bot.got.bag?.at(-1)?.items.length ?? 0) >= 4);
    const items = bot.got.bag.at(-1).items;
    const charm = items.find((item) => item.slot === "charm");
    if (charm) {
      const before = bot.me().maxHp;
      bot.room.send("gear-wear", { id: charm.id });
      await until(() => bot.me().maxHp > before);
      assert.ok(bot.me().maxHp > before);
    }
    const gold = bot.me().gold;
    bot.room.send("gear-sell", { id: items[0].id });
    await until(() => bot.me().gold > gold);
    assert.ok(bot.me().gold > gold);
    await bot.room.leave();
  });

  test("the world boss rewards everyone who hit it", async () => {
    const party = partyCode();
    const a = await join(server, { name: "นักรบเอ", party });
    const b = await join(server, { name: "นักรบบี", party });
    await makeGm(a);
    gm(a, "worldboss");
    await until(() => [...a.room.state.monsters.values()].some((m) => m.kind === "rahu"));
    const [bossId, boss] = [...a.room.state.monsters.entries()].find(([, m]) => m.kind === "rahu") ?? [];
    if (!boss) {
      // Another test's world already has the world boss (there is one at a time): nothing to check.
      assert.ok(a.said().some((text) => text.includes("มีบอสโลกอยู่แล้ว")));
      return;
    }
    await makeGm(b);
    gm(a, "god", { on: true });
    gm(b, "god", { on: true });
    // Only those who land a blow share the prize: B keeps at it until one lands.
    const hitBy = (bot) => (bot.got.hit ?? []).some((hit) => hit.attacker === bot.room.sessionId && hit.target === bossId && hit.damage > 0);
    for (let i = 0; i < 12 && !hitBy(b); i++) {
      const now = a.room.state.monsters.get(bossId);
      await walkTo(b, now.x + 50, now.y + 30);
      b.room.send("attack");
      await wait(700);
    }
    assert.ok(hitBy(b), "B's blow landed");
    const now = a.room.state.monsters.get(bossId);
    await walkTo(a, now.x - 50, now.y + 30);
    gm(a, "onehit", { on: true });
    a.room.send("attack");
    await until(() => a.got["world-boss-end"] && b.got["world-boss-end"], 8000);
    assert.equal(a.got["world-boss-end"][0].beaten, true);
    for (const bot of [a, b]) {
      assert.ok(bot.got.loot?.some((loot) => loot.by === bot.room.sessionId && loot.rarity >= 3), "an epic or better drop");
    }
    await until(() => !a.room.state.monsters.has(bossId), 8000);
    await a.room.leave();
    await b.room.leave();
  });
});

describe("teams and voice", () => {
  test("invite, accept, leave: everyone's screen hears of it at once", async () => {
    const party = partyCode();
    const a = await join(server, { name: "หัวหน้า", party });
    const b = await join(server, { name: "ลูกทีม", party });
    a.room.send("team-invite", { target: b.room.sessionId });
    await until(() => b.got["team-invite"]);
    b.room.send("team-answer", { yes: true });
    await until(() => a.got.team?.at(-1)?.length === 2 && b.got.team?.at(-1)?.length === 2, 3000);
    assert.equal(a.me().team, b.me().team);
    assert.notEqual(a.me().team, "");

    a.room.send("team-leave");
    await until(() => a.got.team.at(-1).length === 0 && b.got.team.at(-1).length === 0, 3000);
    assert.equal(a.me().team, "");
    assert.equal(b.me().team, "");
    await a.room.leave();
    await b.room.leave();
  });

  test("voice set-up messages reach teammates only", async () => {
    const party = partyCode();
    const a = await join(server, { name: "คนพูด", party });
    const b = await join(server, { name: "เพื่อน", party });
    const c = await join(server, { name: "คนนอก", party });
    a.room.send("team-invite", { target: b.room.sessionId });
    await until(() => b.got["team-invite"]);
    b.room.send("team-answer", { yes: true });
    await until(() => a.got.team?.at(-1)?.length === 2);
    a.room.send("voice", { on: true });
    await until(() => b.got.team?.at(-1)?.find((m) => !m.me)?.talking === true, 3000);
    const tagOfB = a.got.team.at(-1).find((m) => !m.me).voice;
    // The team status never carries anyone's player id, only a voice tag.
    assert.ok(!JSON.stringify(a.got.team.at(-1)).includes(b.playerId));
    a.room.send("voice-signal", { to: tagOfB, data: { offer: { type: "offer", sdp: "test" } } });
    await until(() => b.got["voice-signal"]);
    assert.equal(b.got["voice-signal"][0].data.offer.sdp, "test");

    // Someone outside the team can't reach a member.
    c.room.send("voice", { on: true });
    c.room.send("voice-signal", { to: tagOfB, data: { offer: { type: "offer", sdp: "intruder" } } });
    await wait(500);
    assert.ok(!b.got["voice-signal"].some((m) => m.data.offer?.sdp === "intruder"));
    for (const bot of [a, b, c]) await bot.room.leave();
  });
});

describe("connection", () => {
  test("a dropped connection keeps the player, out of harm's way, until they come back", async () => {
    const party = partyCode();
    const watcher = await join(server, { name: "ผู้เฝ้าดู", party });
    const bot = await join(server, { name: "สัญญาณอ่อน", party });
    await walkTo(bot, 900, 640);
    const token = bot.room.reconnectionToken;
    const sessionId = bot.room.sessionId;
    // Cut the line without saying goodbye, as a phone losing its signal does.
    bot.room.connection.transport.ws.close();
    await until(() => watcher.room.state.players.get(sessionId)?.away === true, 3000);
    assert.equal(watcher.room.state.players.get(sessionId).away, true);

    const back = await new Client(server.ws).reconnect(token);
    back.onMessage("*", () => {});
    await until(() => watcher.room.state.players.get(sessionId)?.away === false, 3000);
    const player = back.state.players.get(sessionId);
    assert.ok(Math.hypot(player.x - 900, player.y - 640) < 6, "where they stood");
    assert.ok(!(watcher.got.chat ?? []).some((m) => m.text.includes("สัญญาณอ่อน ออกจากเกม")));
    await back.leave();
    await watcher.room.leave();
  });

  test("a goodbye lets the player go at once", async () => {
    const party = partyCode();
    const watcher = await join(server, { name: "ผู้เฝ้าดู", party });
    const bot = await join(server, { name: "ลาก่อน", party });
    const sessionId = bot.room.sessionId;
    await bot.room.leave(true);
    await until(() => !watcher.room.state.players.has(sessionId), 2000);
    assert.equal(watcher.room.state.players.has(sessionId), false);
    await watcher.room.leave();
  });
});

describe("web", () => {
  test("accounts: register, log in, wrong password refused", async () => {
    const username = `t${Date.now().toString(36)}`;
    const post = (path, body) =>
      fetch(`${server.http}/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const made = await post("register", { username, password: "secret-123", playerId: `test_account_${Date.now()}` });
    assert.equal(made.status, 200);
    assert.equal((await post("login", { username, password: "secret-123" })).status, 200);
    assert.equal((await post("login", { username, password: "wrong-pass" })).status, 401);
  });

  test("leaderboards answer", async () => {
    const response = await fetch(`${server.http}/api/leaderboards`);
    assert.equal(response.status, 200);
    const boards = await response.json();
    for (const board of ["level", "gold", "monsters", "worldBosses"]) {
      assert.ok(Array.isArray(boards[board]));
    }
  });

  test("error reports: taken, junk refused, a browser can't pass as the server", async () => {
    const post = (body) =>
      fetch(`${server.http}/api/errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({ message: "ทดสอบ", where: "a.js:1:1" })).status, 204);
    assert.equal((await post({ nothing: true })).status, 400);
    assert.equal((await post({ source: "server", message: "ปลอมตัว" })).status, 204);

    const bot = await join(server, { party: partyCode() });
    await makeGm(bot);
    bot.room.send("gm", { action: "errors" });
    await until(() => bot.got["gm-errors"]);
    const groups = bot.got["gm-errors"].at(-1);
    assert.ok(groups.some((group) => group.message === "ทดสอบ"));
    assert.equal(groups.find((group) => group.message === "ปลอมตัว")?.source, "client");
    await bot.room.leave();
  });
});

describe("class skills", () => {
  /** A GM hero of the given class standing by the nearest ordinary monster, out of any safe zone. */
  async function nearMonster(skin, party = partyCode(), immortal = true) {
    const bot = await join(server, { skin, party });
    await makeGm(bot);
    if (immortal) gm(bot, "god", { on: true });
    let found;
    let distance = Infinity;
    bot.room.state.monsters.forEach((monster, id) => {
      const d = Math.hypot(monster.x - 800, monster.y - 600);
      if (!monster.dead && monster.kind !== "rahu" && monster.level <= 3 && d < distance) {
        found = [id, monster];
        distance = d;
      }
    });
    const [id, monster] = found;
    await walkTo(bot, monster.x - 90, monster.y);
    return { bot, id, monster: () => bot.room.state.monsters.get(id) };
  }
  const hitsOn = (bot, target) => (bot.got.hit ?? []).filter((hit) => hit.attacker === bot.room.sessionId && hit.target === target && hit.damage > 0);

  test("knight's bulwark shields the team; berserk rages; both wear off", async () => {
    const party = partyCode();
    const knight = await join(server, { skin: 0, party });
    const mate = await join(server, { skin: 2, party });
    knight.room.send("team-invite", { target: mate.room.sessionId });
    await until(() => mate.got["team-invite"]);
    mate.room.send("team-answer", { yes: true });
    await until(() => knight.me().team !== "" && knight.me().team === mate.me().team);
    knight.room.send("ultimate");
    await until(() => knight.me().guarded && mate.room.state.players.get(mate.room.sessionId).guarded, 2000);
    assert.ok(knight.me().guarded && mate.me().guarded, "both shielded");
    knight.room.send("ultimate");
    await wait(300);
    assert.equal(knight.got.ultimate?.filter((u) => u.by === knight.room.sessionId).length, 1, "not again before its cooldown");

    const barbarian = await join(server, { skin: 1, party });
    barbarian.room.send("ultimate");
    await until(() => barbarian.me().rage, 2000);
    assert.ok(barbarian.me().rage);
    await until(() => !barbarian.me().rage && !knight.me().guarded, 8000);
    assert.equal(barbarian.me().rage, false, "rage wears off");
    assert.equal(knight.me().guarded, false, "the shield wears off");
    for (const bot of [knight, mate, barbarian]) await bot.room.leave();
  });

  test("offensive class skills can't be used in a safe zone", async () => {
    const mage = await join(server, { skin: 2, party: partyCode() });
    await walkTo(mage, 800, 600);
    mage.room.send("ultimate");
    await wait(600);
    assert.equal(mage.got.ultimate, undefined);
    assert.ok(mage.said().some((text) => text.includes("เขตปลอดภัย")));
    await mage.room.leave();
  });

  test("meteor, arrow rain and the piercing shot hurt the monsters they reach", async () => {
    for (const skin of [2, 3, 5]) {
      const { bot, id } = await nearMonster(skin);
      bot.room.send("ultimate");
      await until(() => hitsOn(bot, id).length > 0, 4000);
      assert.ok(hitsOn(bot, id).length > 0, `class ${skin} hurt the monster`);
      if (skin === 3) {
        // Arrow rain falls in waves.
        await wait(2000);
        assert.ok(hitsOn(bot, id).length >= 2 || bot.got.xp, "more than one wave (or it died first)");
      }
      await bot.room.leave();
    }
  });

  test("the shadow strike lands behind the target with a critical hit", async () => {
    const { bot, id, monster } = await nearMonster(4);
    const from = { x: bot.me().x, y: bot.me().y };
    bot.room.send("ultimate");
    await until(() => hitsOn(bot, id).length > 0, 3000);
    await wait(200); // the blow is told at once; the new position comes with the next state update
    const strike = hitsOn(bot, id)[0];
    assert.equal(strike.crit, true);
    const target = monster() ?? { x: from.x + 90, y: from.y };
    assert.ok(Math.hypot(bot.me().x - target.x, bot.me().y - target.y) < 80, "next to it");
    assert.ok(Math.hypot(bot.me().x - from.x, bot.me().y - from.y) > 60, "blinked there");
    await bot.room.leave();
  });
});

// Last: the lock it sets holds for every bot here, since they all come from the same address.
describe("the GM key", () => {
  test("wrong GM keys lock the key for a while, even after leaving and coming back", async () => {
    const id = `test_guess_${Date.now()}`;
    const party = partyCode();
    let bot = await join(server, { id, party });
    for (let i = 1; i <= 6; i++) {
      bot.room.send("chat", { text: `/gm wrong${i}` });
      await wait(1050);
      if (i === 3) {
        await bot.room.leave();
        bot = await join(server, { id, party });
      }
    }
    bot.room.send("chat", { text: "/gm test-gm-key-1234" });
    await wait(1100);
    assert.equal(bot.me().gm, false);
    assert.ok(bot.said().some((text) => text.includes("ผิดหลายครั้งเกินไป")));
    await bot.room.leave();
  });
});
