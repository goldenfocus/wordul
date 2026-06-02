// src/user.ts — one Durable Object per username; holds profile, stats, history.
import { DurableObject } from "cloudflare:workers";
import type { Env, UserProfile, OwnedRoom } from "./types.ts";
import { emptyStats, applyGame, appendCapped } from "./stats.ts";
import { balance } from "./economy.ts";
import type { GameRecord } from "./records.ts";

const HISTORY_CAP = 100;
const ROOMS_CAP = 100;

export class User extends DurableObject<Env> {
  private async load(username: string): Promise<UserProfile> {
    const saved = await this.ctx.storage.get<UserProfile>("profile");
    if (saved) {
      // Self-heal: a profile first created by a write that didn't carry the username
      // (older bug / edge path) backfills it on the next call that does.
      if (!saved.username && username) {
        saved.username = username;
        await this.ctx.storage.put("profile", saved);
      }
      if (!Array.isArray(saved.ledger)) { saved.ledger = []; await this.ctx.storage.put("profile", saved); }
      return saved;
    }
    // Anchor the profile on first contact (any access path) so createdAt and the
    // username are stable across reads — not regenerated on every cold GET.
    const fresh: UserProfile = { username, createdAt: Date.now(), stats: emptyStats(), games: [], ownedRooms: [], ledger: [] };
    await this.ctx.storage.put("profile", fresh);
    return fresh;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const username = url.searchParams.get("username") ?? "";

    if (req.method === "GET") {
      const profile = await this.load(username);
      return Response.json({ ...profile, gold: balance(profile.ledger, "gold") });
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

    if (req.method === "POST" && url.pathname.endsWith("/ledger/append")) {
      const tx = (await req.json()) as { token: string; delta: number; reason: string; ref?: string };
      const profile = await this.load(username);
      profile.ledger.push({ token: tx.token, delta: tx.delta, reason: tx.reason, ts: Date.now(), ref: tx.ref });
      if (profile.ledger.length > 500) profile.ledger = profile.ledger.slice(-500);
      await this.ctx.storage.put("profile", profile);
      return Response.json({ gold: balance(profile.ledger, "gold") });
    }

    return new Response("not found", { status: 404 });
  }
}
