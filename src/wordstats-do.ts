// src/wordstats-do.ts — one Durable Object per answer word; holds cumulative solve stats.
// Sharded by word via env.WORDSTATS.idFromName(WORD). Read with GET, bump with POST /bump.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import { emptyWordStats, applyWordGame, deriveWordStats, type WordStatsState } from "./wordstats.ts";
import type { GameOutcome } from "./stats.ts";

export class WordStats extends DurableObject<Env> {
  private async load(): Promise<WordStatsState> {
    return (await this.ctx.storage.get<WordStatsState>("state")) ?? emptyWordStats();
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET") {
      return Response.json(deriveWordStats(await this.load()));
    }
    if (req.method === "POST" && url.pathname.endsWith("/bump")) {
      // A whole finished round arrives as one batch (all of a room's human players), so
      // the load→apply→put is a single atomic read-modify-write — no lost updates even
      // when several players finish the same word at once.
      const { games } = (await req.json()) as { games: { result: GameOutcome; guesses: number }[] };
      let state = await this.load();
      for (const g of games) state = applyWordGame(state, g);
      await this.ctx.storage.put("state", state);
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }
}
