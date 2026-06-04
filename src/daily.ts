// src/daily.ts — system-singleton Durable Object (idFromName("daily")). Owns the
// date→World schedule + deterministic fallback, and the set of dates ever resolved
// (for the archive + sitemap). The curated word is handed only to a seeded Room DO
// (server→server); /resolve never leaks a future day's word to a still-playing client.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import type { DailySchedule, World } from "./daily-core.ts";
import { activeDate, resolveWorld, normalizeWorld } from "./daily-core.ts";

type DailyState = { schedule: DailySchedule; seen: string[] };

export class Daily extends DurableObject<Env> {
  private async load(): Promise<DailyState> {
    return (await this.ctx.storage.get<DailyState>("state")) ?? { schedule: {}, seen: [] };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Resolve the World for a date (defaults to today). Records the date as "seen".
    if (req.method === "GET" && url.pathname === "/resolve") {
      const date = url.searchParams.get("date") || activeDate(Date.now());
      const state = await this.load();
      const world = resolveWorld(state.schedule, date, Date.now());
      // Only a date that's reached (≤ today UTC) becomes an archive/sitemap artifact —
      // a future permalink probe must not pollute the archive (anti gold-farm seeding).
      if (date <= activeDate(Date.now()) && !state.seen.includes(date)) {
        state.seen.push(date);
        await this.ctx.storage.put("state", state);
      }
      return Response.json(world);
    }

    // Sorted union of curated + seen dates — for the archive index + sitemap.
    if (req.method === "GET" && url.pathname === "/dates") {
      const state = await this.load();
      const dates = Array.from(new Set([...Object.keys(state.schedule), ...state.seen])).sort();
      return Response.json({ dates });
    }

    // Admin seed: write/overwrite a curated World. Auth is enforced UPSTREAM in the
    // worker (Bearer token) before this is ever reached.
    if (req.method === "POST" && url.pathname === "/schedule") {
      const world: World | null = normalizeWorld(await req.json().catch(() => null));
      if (!world) return new Response("invalid world", { status: 400 });
      const state = await this.load();
      state.schedule[world.date] = world;
      if (!state.seen.includes(world.date)) state.seen.push(world.date);
      await this.ctx.storage.put("state", state);
      return Response.json({ ok: true, date: world.date });
    }

    return new Response("not found", { status: 404 });
  }
}
