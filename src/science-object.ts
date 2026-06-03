// src/science-object.ts — day-sharded Science Durable Object.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import { activeDate } from "./daily-core.ts";
import {
  applyScienceEvent,
  emptyScienceState,
  normalizeScienceEvent,
  publicScienceSummary,
  type ScienceDailyState,
} from "./science.ts";

export class Science extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/event") {
      const event = normalizeScienceEvent(await req.json().catch(() => null));
      if (!event) return new Response("invalid science event", { status: 400 });
      const state = await this.load(event.date);
      applyScienceEvent(state, event);
      await this.ctx.storage.put("state", state);
      return Response.json({ ok: true, date: state.date, events: state.totals.events });
    }

    if (req.method === "GET" && url.pathname === "/summary") {
      const date = validDate(url.searchParams.get("date")) ?? activeDate(Date.now());
      const includeWords = url.searchParams.get("includeWords") === "1";
      const state = await this.load(date);
      return Response.json(publicScienceSummary(state, { includeWords, generatedAt: Date.now() }), {
        headers: { "cache-control": "public, max-age=60" },
      });
    }

    return new Response("not found", { status: 404 });
  }

  private async load(date: string): Promise<ScienceDailyState> {
    const state = await this.ctx.storage.get<ScienceDailyState>("state");
    if (state) return backfill(state, date);
    return emptyScienceState(date);
  }
}

function validDate(date: string | null): string | null {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function backfill(state: ScienceDailyState, date: string): ScienceDailyState {
  if (!state.schemaVersion) state.schemaVersion = 1;
  if (!state.date) state.date = date;
  if (!state.powerups) state.powerups = { reveal_letter: 0, vowel_count: 0 };
  if (!state.hintUsage) state.hintUsage = { revealHints: {}, vowelHints: {} };
  if (!state.words) state.words = {};
  return state;
}
