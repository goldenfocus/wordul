// src/user.ts — one Durable Object per username; holds profile, stats, history.
import { DurableObject } from "cloudflare:workers";
import type { Env, UserProfile, OwnedRoom } from "./types.ts";
import { applyGame, appendCapped } from "./stats.ts";
import { healProfile, freshProfile, applyH2H } from "./user-core.ts";
import { publicProfile, makePassphrase, canClaim, addSession, revokeSession, touchSession, projectDirectory, validatePassphraseShape } from "./account-core.ts";
import { hashPassphrase, verifyPassphrase, mintToken, hashToken } from "./account-crypto.ts";
import type { GameRecord } from "./records.ts";

const HISTORY_CAP = 100;
const ROOMS_CAP = 100;
const PENDING_TTL_MS = 10 * 60 * 1000; // a previewed-but-uncommitted passphrase expires in 10 min
const MAX_SESSIONS = 20; // per-account device cap; oldest (by lastSeen) is evicted on a new login

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

    // Accounts P0 — preview a wordul-passphrase. The DO generates + hashes it, stashes the
    // HASH (never the raw words) in an ephemeral pendingClaim, and returns the raw phrase
    // + a nonce ONCE. Re-roll = call again (overwrites pendingClaim). No state is claimed yet.
    if (req.method === "POST" && url.pathname.endsWith("/account/preview")) {
      const profile = await this.load(username);
      const decision = canClaim(profile, username);
      if (!decision.ok) return Response.json({ error: decision.reason }, { status: decision.reason === "already_claimed" ? 409 : 400 });
      const words = makePassphrase();
      const phrase = words.join(" ");
      const { salt, hash } = await hashPassphrase(phrase);
      const nonce = mintToken();
      profile.pendingClaim = { salt, phraseHash: hash, nonce, createdAt: Date.now() };
      await this.ctx.storage.put("profile", profile);
      return Response.json({ passphrase: phrase, nonce });
    }

    // Accounts P0 — commit the previewed claim. The nonce binds this claim to the last
    // previewed phrase (so a re-roll's stale preview can't be committed). Double-claim is
    // blocked by canClaim (profile.claimed), not the nonce. Promotes the pending hash into
    // auth, mints the first session, writes the public KV projection. Single-writer DO ⇒
    // this whole transition is race-free with no lock.
    if (req.method === "POST" && url.pathname.endsWith("/account/claim")) {
      let claimBody: { nonce?: string };
      try { claimBody = (await req.json()) as { nonce?: string }; }
      catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
      const { nonce } = claimBody;
      const profile = await this.load(username);
      const decision = canClaim(profile, username);
      if (!decision.ok) return Response.json({ error: decision.reason }, { status: decision.reason === "already_claimed" ? 409 : 400 });
      const pending = profile.pendingClaim;
      if (!pending || pending.nonce !== nonce || Date.now() - pending.createdAt > PENDING_TTL_MS) {
        return Response.json({ error: "no_valid_preview" }, { status: 400 });
      }
      const token = mintToken();
      const tokenHash = await hashToken(token);
      const now = Date.now();
      profile.claimed = true;
      profile.auth = { v: 1, salt: pending.salt, phraseHash: pending.phraseHash, methods: {}, sessions: {}, claimedAt: now };
      addSession(profile.auth.sessions, tokenHash, { createdAt: now, lastSeen: now });
      delete profile.pendingClaim;
      await this.ctx.storage.put("profile", profile);
      // Public projection — written by the authority so /@username can render the badge
      // without waking the DO twice and without ever touching secrets. Best-effort.
      try {
        await this.env.DIRECTORY.put(`auth:${username}`, JSON.stringify(projectDirectory(profile)));
      } catch (e) { console.error("auth projection failed", username, (e as Error).message); }
      return Response.json({ sessionToken: token, history: { games: profile.games.length, since: profile.createdAt } });
    }

    // Accounts P0 — login on a new device with username + passphrase → a fresh session.
    if (req.method === "POST" && url.pathname.endsWith("/account/login")) {
      let loginBody: { passphrase?: string };
      try { loginBody = (await req.json()) as { passphrase?: string }; }
      catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
      const profile = await this.load(username);
      const phrase = (loginBody.passphrase ?? "").trim().toLowerCase();
      // Generic failure for every reject path (no oracle: unclaimed vs wrong phrase look identical).
      if (!profile.claimed || !profile.auth || !validatePassphraseShape(phrase)) {
        return Response.json({ error: "invalid_credentials" }, { status: 401 });
      }
      const ok = await verifyPassphrase(phrase, profile.auth.salt, profile.auth.phraseHash);
      if (!ok) return Response.json({ error: "invalid_credentials" }, { status: 401 });
      // Enforce the per-account session cap: evict the oldest (by lastSeen) before adding.
      const hashes = Object.keys(profile.auth.sessions);
      if (hashes.length >= MAX_SESSIONS) {
        const oldest = hashes.reduce((a, b) => (profile.auth!.sessions[a].lastSeen <= profile.auth!.sessions[b].lastSeen ? a : b));
        revokeSession(profile.auth.sessions, oldest);
      }
      const token = mintToken();
      const now = Date.now();
      addSession(profile.auth.sessions, await hashToken(token), { createdAt: now, lastSeen: now });
      await this.ctx.storage.put("profile", profile);
      return Response.json({ sessionToken: token });
    }

    // Accounts P0 — revoke a session. Caller proves ownership with its OWN sessionToken;
    // `target` is the session-id (= token hash, from /account/me) to kill (default = self).
    if (req.method === "POST" && url.pathname.endsWith("/account/sessions/revoke")) {
      let revokeBody: { sessionToken?: string; target?: string };
      try { revokeBody = (await req.json()) as { sessionToken?: string; target?: string }; }
      catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
      const { sessionToken, target } = revokeBody;
      const profile = await this.load(username);
      if (!profile.auth || !sessionToken) return Response.json({ error: "unauthorized" }, { status: 401 });
      const callerHash = await hashToken(sessionToken);
      if (!profile.auth.sessions[callerHash]) return Response.json({ error: "unauthorized" }, { status: 401 });
      const killed = revokeSession(profile.auth.sessions, target || callerHash);
      await this.ctx.storage.put("profile", profile);
      return Response.json({ ok: killed });
    }

    // Accounts P0 — who am I? Bearer sessionToken → account flags + session list (NO secrets;
    // session ids are token HASHES, which can't be reversed to a usable token).
    if (req.method === "GET" && url.pathname.endsWith("/account/me")) {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const profile = await this.load(username);
      if (!profile.auth || !token) return Response.json({ error: "unauthorized" }, { status: 401 });
      const callerHash = await hashToken(token);
      if (!profile.auth.sessions[callerHash]) return Response.json({ error: "unauthorized" }, { status: 401 });
      touchSession(profile.auth.sessions, callerHash, Date.now());
      await this.ctx.storage.put("profile", profile);
      const sessions = Object.entries(profile.auth.sessions).map(([id, m]) => ({
        id, current: id === callerHash, createdAt: m.createdAt, lastSeen: m.lastSeen, label: m.label,
      }));
      return Response.json({ username, claimed: true, verified: false, sessions });
    }

    // Accounts P0 — the hello seam (consumed by P1 worlds). Cheap validity check for a token.
    if (req.method === "POST" && url.pathname.endsWith("/account/verify-session")) {
      let verifyBody: { sessionToken?: string };
      try { verifyBody = (await req.json()) as { sessionToken?: string }; }
      catch { return Response.json({ valid: false }); }
      const profile = await this.load(username);
      if (!profile.auth || !verifyBody.sessionToken) return Response.json({ valid: false });
      const ok = !!profile.auth.sessions[await hashToken(verifyBody.sessionToken)];
      return Response.json({ valid: ok });
    }

    return new Response("not found", { status: 404 });
  }
}
