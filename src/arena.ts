import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import {
  emptyArenaState,
  apply,
  prune,
  openGames,
  liveCount,
  seedPaths,
  driftTarget,
  rollWordLength,
  rollLifetime,
  TARGET_OPEN,
  MAX_SEEDED,
  type ArenaState,
  type SeedRec,
  type OpenGame,
} from "./arena-core.ts";
import { pickPersona } from "./bots.ts";

// Singleton coordinator DO (idFromName("arena")). Owns the authoritative Open-Games index.
// SLICE A: the alarm() seed loop is a VERIFIED no-op — there is no bots.ts and no Room /seed
// route yet, so it only prunes. Slice D wires the real pickPersona → /seed → register loop.
export class Arena extends DurableObject<Env> {
  private async load(): Promise<ArenaState> {
    return (await this.ctx.storage.get<ArenaState>("state")) ?? emptyArenaState();
  }
  private async save(s: ArenaState) {
    await this.ctx.storage.put("state", s);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/open") {
      // Prune-only. Does NOT seed: seeding from a public GET would stack mints and could
      // mint a leaky room before disguise lands (review fix, defects 6 & 10).
      const s = prune(await this.load(), Date.now());
      await this.save(s);
      if ((await this.ctx.storage.getAlarm()) === null) {
        void this.ctx.storage.setAlarm(Date.now() + 5_000);
      }
      return Response.json(openGames(s) satisfies OpenGame[]);
    }
    if (req.method === "POST" && url.pathname === "/open") {
      const b = (await req.json().catch(() => null)) as { path?: string } | null;
      if (!b?.path) return new Response("bad request", { status: 400 });
      await this.save(apply(await this.load(), { type: "register", path: b.path }));
      return Response.json({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/publish") {
      // A human-hosted public room announces itself (no mint/seed handshake).
      const rec = (await req.json().catch(() => null)) as SeedRec | null;
      if (!rec?.path || !rec.routePath || !rec.host) return new Response("bad request", { status: 400 });
      await this.save(apply(await this.load(), { type: "publish", rec }));
      return Response.json({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/close") {
      const b = (await req.json().catch(() => null)) as { path?: string } | null;
      if (!b?.path) return new Response("bad request", { status: 400 });
      await this.save(apply(await this.load(), { type: "close", path: b.path }));
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }

  // The seed loop: keep ~TARGET_OPEN live rooms waiting, capped at MAX_SEEDED. Each mint
  // picks an unused persona, mints a SeedRec (status minted, bumps seedCount), seeds the
  // ROOM DO server-to-server, then registers on 2xx (close on failure). `liveCount` is
  // re-read each iteration so a restock can't overshoot. Wrapped so a throw can't break
  // GET /open; always reschedules.
  async alarm(): Promise<void> {
    let s = emptyArenaState();
    try {
      s = prune(await this.load(), Date.now());
      // Drift the desired open-room count one step (a slow tide, not the old constant 3).
      s = { ...s, desiredOpen: driftTarget(s.desiredOpen ?? TARGET_OPEN, Math.random()) };
      await this.save(s);
      // Mint AT MOST ONE room per tick so rooms appear one-at-a-time over seconds instead
      // of snapping in as a batch. The jittered reschedule below paces the trickle.
      const target = s.desiredOpen ?? TARGET_OPEN;
      if (liveCount(s) < target && Object.keys(s.seeded).length < MAX_SEEDED) {
        const openIds = new Set(
          Object.values(s.seeded).filter((r) => r.status !== "closed").map((r) => r.personaId),
        );
        const persona = pickPersona(s.seedCount, openIds);
        if (persona) {
          const wordLength = rollWordLength(Math.random());
          const lifetimeMs = rollLifetime(Math.random());
          const { path, routePath } = seedPaths(persona.id, s.seedCount);
          const rec: SeedRec = {
            path,
            routePath,
            name: `${persona.name}'s room`,
            host: persona.name,
            personaId: persona.id,
            personaIcon: persona.avatar,
            edition: persona.edition,
            wordLength,
            seats: "1/2",
            mintedAt: Date.now(),
            lifetimeMs,
            status: "minted",
          };
          s = apply(s, { type: "mint", rec });
          await this.save(s);
          // Seed the ROOM DO (byte-identical key to what /ws?room=<path> resolves).
          let ok = false;
          try {
            const room = this.env.ROOM.get(this.env.ROOM.idFromName(path));
            const res = await room.fetch(new Request("https://do/seed", {
              method: "POST",
              body: JSON.stringify({
                path,
                persona: { id: persona.id, name: persona.name, avatar: persona.avatar },
                profile: "noob",
                edition: persona.edition,
                wordLength,
              }),
              headers: { "content-type": "application/json" },
            }));
            ok = res.ok;
          } catch (e) {
            console.error("arena seed room failed", path, (e as Error).message);
          }
          s = apply(s, ok ? { type: "register", path } : { type: "close", path });
          await this.save(s);
        }
      }
    } catch (e) {
      console.error("arena alarm", (e as Error).message);
    } finally {
      // Below target → short jittered gap (3–12s) so the next room trickles in soon.
      // At/over target → long idle drift (30–90s). Produces the "land alone, wait, a room
      // appears" cadence instead of an instant full set.
      const target = s.desiredOpen ?? TARGET_OPEN;
      const below = liveCount(s) < target && Object.keys(s.seeded).length < MAX_SEEDED;
      const delay = below
        ? 3_000 + Math.floor(Math.random() * 9_000)
        : 30_000 + Math.floor(Math.random() * 60_000);
      void this.ctx.storage.setAlarm(Date.now() + delay);
    }
  }
}
