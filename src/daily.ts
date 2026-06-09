// src/daily.ts — system-singleton Durable Object (idFromName("daily")). Owns the
// date→World schedule + deterministic fallback, and the set of dates ever resolved
// (for the archive + sitemap). The curated word is handed only to a seeded Room DO
// (server→server); /resolve never leaks a future day's word to a still-playing client.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import type { DailySchedule, World } from "./daily-core.ts";
import { activeDate, resolveWorld, normalizeWorld, saltForDate } from "./daily-core.ts";

type DailyState = { schedule: DailySchedule; seen: string[] };

// Daily picks on/after this UTC date are salted (when the DAILY_SALT secret is set);
// earlier dates are never salted, so enabling the secret doesn't rewrite history.
// House worlds are recomputed on demand (not stored), so without this cutoff, turning
// the salt on would retroactively change every past/today uncurated answer.
const SALT_FROM = "2026-06-05";

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
      // Server-only salt folds into the house-word seed so the daily pick can't be
      // predicted off the public alphabetical answer list + date alone. Empty (unset
      // secret) is a strict NO-OP, and the SALT_FROM cutoff keeps past/today unchanged.
      // Set via: wrangler secret put DAILY_SALT
      const salt = saltForDate(date, this.env.DAILY_SALT, SALT_FROM);
      const world = resolveWorld(state.schedule, date, Date.now(), salt);
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

    // Past-only answer reveal for the home carousel. NEVER today or future — same leak
    // rule as /resolve's archive guard (no live answer, no gold-farm seeding). Returns the
    // curated/house word + design edition for a day that's already been played out.
    if (req.method === "GET" && url.pathname === "/word") {
      const date = url.searchParams.get("date") || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= activeDate(Date.now())) {
        return new Response("not a past date", { status: 404 });
      }
      const state = await this.load();
      const salt = saltForDate(date, this.env.DAILY_SALT, SALT_FROM);
      const world = resolveWorld(state.schedule, date, Date.now(), salt);
      return Response.json({ date, word: world.word, themeId: world.edition });
    }

    // Admin list: the curated days, summarized — theme identity only, NEVER the word,
    // so a listing pasted into a chat/log can't leak a future answer. Auth upstream.
    if (req.method === "GET" && url.pathname === "/schedule") {
      const state = await this.load();
      const days = Object.values(state.schedule)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((w) => ({
          date: w.date, edition: w.edition, voice: w.voice,
          vibeTitle: w.vibeTitle, hasColorScheme: !!w.colorScheme, title: w.story?.title,
        }));
      return Response.json({ days });
    }

    // Admin unschedule: drop the curated World for ?date= — the day falls back to the
    // house World (base look). `seen` is untouched, so an already-played day keeps its
    // archive/sitemap entry. Auth upstream.
    if (req.method === "DELETE" && url.pathname === "/schedule") {
      const date = url.searchParams.get("date") ?? "";
      const state = await this.load();
      const removed = !!state.schedule[date];
      if (removed) {
        delete state.schedule[date];
        await this.ctx.storage.put("state", state);
      }
      return Response.json({ ok: true, date, removed });
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
