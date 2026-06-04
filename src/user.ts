// src/user.ts — one Durable Object per username; holds profile, stats, history.
import { DurableObject } from "cloudflare:workers";
import type { Env, UserProfile, OwnedRoom } from "./types.ts";
import { applyGame, appendCapped } from "./stats.ts";
import { healProfile, freshProfile, applyH2H } from "./user-core.ts";
import { publicProfile } from "./account-core.ts";
import type { GameRecord } from "./records.ts";

const HISTORY_CAP = 100;
const ROOMS_CAP = 100;

export class User extends DurableObject<Env> {
  private async load(username: string): Promise<UserProfile> {
    const saved = await this.ctx.storage.get<UserProfile>("profile");
    if (saved) {
      // Idempotent self-heal (username backfill, ledger→balances rebuild, h2h backfill).
      // Persist only if a heal actually changed the profile — same net effect as the prior
      // per-branch puts, in one write.
      const before = JSON.stringify(saved);
      const healed = healProfile(saved, username);
      if (JSON.stringify(healed) !== before) await this.ctx.storage.put("profile", healed);
      return healed;
    }
    // Anchor the profile on first contact (any access path) so createdAt and the
    // username are stable across reads — not regenerated on every cold GET.
    const fresh = freshProfile(username);
    await this.ctx.storage.put("profile", fresh);
    return fresh;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const username = url.searchParams.get("username") ?? "";

    if (req.method === "GET") {
      const profile = await this.load(username);
      // SECURITY: never spread the raw profile — publicProfile() drops auth + pendingClaim
      // (salt/phraseHash/session hashes) and surfaces only the claimed/verified flags.
      return Response.json({ ...publicProfile(profile), gold: profile.balances.gold ?? 0 });
    }

    // NOTE: must exclude "/ledger/append" — it also endsWith("/append"), so without this
    // guard every gold mint was being swallowed here and parsed as a (junk) game record,
    // silently crediting zero gold. (Affected races + daily alike.)
    if (req.method === "POST" && url.pathname.endsWith("/append") && !url.pathname.endsWith("/ledger/append")) {
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
      profile.balances[tx.token] = (profile.balances[tx.token] ?? 0) + tx.delta;
      profile.ledger.push({ token: tx.token, delta: tx.delta, reason: tx.reason, ts: Date.now(), ref: tx.ref });
      if (profile.ledger.length > 500) profile.ledger = profile.ledger.slice(-500);
      await this.ctx.storage.put("profile", profile);
      return Response.json({ gold: profile.balances.gold ?? 0 });
    }

    // Per-(human, persona) head-to-head record. Placed AFTER /ledger/append so it can never
    // shadow the gold mint; "/h2h" shares no suffix with "/append" either (E3 guard locks this).
    if (req.method === "POST" && url.pathname.endsWith("/h2h")) {
      const { personaId, result } = (await req.json()) as { personaId: string; result: "w" | "l" };
      if (!personaId || (result !== "w" && result !== "l")) return new Response("bad request", { status: 400 });
      const profile = await this.load(username);
      applyH2H(profile.h2h!, personaId, result); // load() guarantees h2h via healProfile
      await this.ctx.storage.put("profile", profile);
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
}
