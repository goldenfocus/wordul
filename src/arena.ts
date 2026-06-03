import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import {
  emptyArenaState,
  apply,
  prune,
  openGames,
  type ArenaState,
  type OpenGame,
} from "./arena-core.ts";

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

  // SLICE A: verified no-op (no bots.ts / no /seed yet). Slice D wires the real seed loop.
  // Wrapped so a future throw can never break GET /open.
  async alarm(): Promise<void> {
    try {
      const s = prune(await this.load(), Date.now());
      await this.save(s);
    } catch (e) {
      console.error("arena alarm", (e as Error).message);
    } finally {
      void this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
  }
}
