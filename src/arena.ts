import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import {
  emptyArenaState,
  apply,
  prune,
  openGames,
  liveCount,
  seedPaths,
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
    try {
      let s = prune(await this.load(), Date.now());
      await this.save(s);
      while (liveCount(s) < TARGET_OPEN && Object.keys(s.seeded).length < MAX_SEEDED) {
        const openIds = new Set(
          Object.values(s.seeded).filter((r) => r.status !== "closed").map((r) => r.personaId),
        );
        const persona = pickPersona(s.seedCount, openIds);
        if (!persona) break; // roster exhausted this round
        const { path, routePath } = seedPaths(persona.id, s.seedCount);
        const rec: SeedRec = {
          path,
          routePath,
          name: `${persona.name}'s room`,
          host: persona.name,
          personaId: persona.id,
          personaIcon: persona.avatar,
          edition: persona.edition,
          wordLength: 5,
          seats: "1/2",
          mintedAt: Date.now(),
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
              wordLength: 5,
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
    } catch (e) {
      console.error("arena alarm", (e as Error).message);
    } finally {
      void this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
  }
}
