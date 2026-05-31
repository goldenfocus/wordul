// src/user.ts — one Durable Object per username; holds profile, stats, history.
import { DurableObject } from "cloudflare:workers";
import type { Env, UserProfile, OwnedRoom } from "./types.ts";
import { emptyStats, applyGame, appendCapped } from "./stats.ts";
import type { GameRecord } from "./records.ts";

const HISTORY_CAP = 100;
const ROOMS_CAP = 100;

export class User extends DurableObject<Env> {
  private async load(username: string): Promise<UserProfile> {
    const saved = await this.ctx.storage.get<UserProfile>("profile");
    if (saved) return saved;
    return { username, createdAt: Date.now(), stats: emptyStats(), games: [], ownedRooms: [] };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const username = url.searchParams.get("username") ?? "";

    if (req.method === "GET") {
      const profile = await this.load(username);
      return Response.json(profile);
    }

    if (req.method === "POST" && url.pathname.endsWith("/append")) {
      const record = (await req.json()) as GameRecord;
      const profile = await this.load(username);
      profile.stats = applyGame(profile.stats, { result: record.result, guesses: record.guesses });
      profile.games = appendCapped(profile.games, record, HISTORY_CAP);
      await this.ctx.storage.put("profile", profile);
      return new Response("ok");
    }

    if (req.method === "POST" && url.pathname.endsWith("/room")) {
      const room = (await req.json()) as OwnedRoom;
      const profile = await this.load(username);
      const others = profile.ownedRooms.filter((r) => r.slug !== room.slug);
      profile.ownedRooms = [room, ...others].slice(0, ROOMS_CAP);
      await this.ctx.storage.put("profile", profile);
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
}
