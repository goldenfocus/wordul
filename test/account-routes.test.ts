import { describe, it, expect, vi } from "vitest";
import { publicProfile } from "../src/account-core.ts";
import type { UserProfile } from "../src/types.ts";

// worker.ts imports DO classes (Room, User, …) that extend DurableObject from
// "cloudflare:workers". Stub the runtime class so the module resolves under the
// plain-node vitest environment — identical pattern to room-finish-broadcast.test.ts.
vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

import { rateLimitDecision } from "../src/worker.ts";

describe("public GET shape (user.ts GET → publicProfile)", () => {
  it("a serialized public profile carries no secret keys", () => {
    const profile = {
      username: "zang", createdAt: 1, stats: {} as UserProfile["stats"],
      games: [], ownedRooms: [], ledger: [], balances: { gold: 3 }, h2h: {},
      claimed: true,
      auth: { v: 1 as const, salt: "SALT", phraseHash: "HASH", sessions: { h: { createdAt: 1, lastSeen: 1 } }, claimedAt: 1 },
    } satisfies UserProfile;
    // Mirror exactly what the DO GET returns:
    const body = JSON.stringify({ ...publicProfile(profile), gold: profile.balances.gold ?? 0 });
    expect(body).not.toContain("SALT");
    expect(body).not.toContain("HASH");
    expect(body).toContain("\"claimed\":true");
    expect(body).toContain("\"gold\":3");
  });

  it("locks the PUBLIC key set — a new UserProfile field must be consciously added here", () => {
    const profile = {
      username: "zang", createdAt: 1, stats: {} as UserProfile["stats"],
      games: [], ownedRooms: [], ledger: [], balances: { gold: 3 }, h2h: {},
      claimed: true,
      auth: { v: 1 as const, salt: "SALT", phraseHash: "HASH", sessions: { h: { createdAt: 1, lastSeen: 1 } }, claimedAt: 1 },
      pendingClaim: { salt: "PSALT", phraseHash: "PHASH", nonce: "NONCE", createdAt: 1 },
    } satisfies UserProfile;
    // Mirror the DO GET exactly:
    const body = JSON.parse(JSON.stringify({ ...publicProfile(profile), gold: profile.balances.gold ?? 0 }));
    const keys = new Set(Object.keys(body));
    // If you add a field to UserProfile and it should be PUBLIC, add it here.
    // If it's a SECRET, it must be stripped in publicProfile() — and this test will fail until it is.
    const EXPECTED_PUBLIC_KEYS = new Set([
      "username", "createdAt", "stats", "games", "ownedRooms",
      "goldHistory", "balances", "h2h", "claimed", "verified", "gold",
    ]);
    expect(keys).toEqual(EXPECTED_PUBLIC_KEYS);
  });
});

describe("rateLimitDecision (pure)", () => {
  it("allows up to the limit then blocks", () => {
    expect(rateLimitDecision(0, 5)).toEqual({ allow: true, next: 1 });
    expect(rateLimitDecision(4, 5)).toEqual({ allow: true, next: 5 });
    expect(rateLimitDecision(5, 5)).toEqual({ allow: false, next: 5 });
    expect(rateLimitDecision(99, 5)).toEqual({ allow: false, next: 99 });
  });
});

describe("User DO route ordering (no new /account/* route shadows the money paths)", () => {
  // Mirror the EXACT endsWith predicates from user.ts fetch(), in route order.
  const appendMatch = (p: string) => p.endsWith("/append") && !p.endsWith("/ledger/append");
  const ledgerMatch = (p: string) => p.endsWith("/ledger/append");
  const h2hMatch = (p: string) => p.endsWith("/h2h");
  const previewMatch = (p: string) => p.endsWith("/account/preview");
  const claimMatch = (p: string) => p.endsWith("/account/claim");
  const loginMatch = (p: string) => p.endsWith("/account/login");
  const revokeMatch = (p: string) => p.endsWith("/account/sessions/revoke");
  const meMatch = (p: string) => p.endsWith("/account/me");
  const verifyMatch = (p: string) => p.endsWith("/account/verify-session");

  const all = { appendMatch, ledgerMatch, h2hMatch, previewMatch, claimMatch, loginMatch, revokeMatch, meMatch, verifyMatch };
  function onlyMatches(path: string, key: keyof typeof all) {
    for (const [name, fn] of Object.entries(all)) {
      expect(`${name}:${fn(path)}`).toBe(`${name}:${name === key}`);
    }
  }

  it("each account route matches ONLY itself, never an /append or /h2h path", () => {
    onlyMatches("/account/preview", "previewMatch");
    onlyMatches("/account/claim", "claimMatch");
    onlyMatches("/account/login", "loginMatch");
    onlyMatches("/account/sessions/revoke", "revokeMatch");
    onlyMatches("/account/me", "meMatch");
    onlyMatches("/account/verify-session", "verifyMatch");
  });
  it("the money paths still match only themselves", () => {
    onlyMatches("/users/zang/ledger/append", "ledgerMatch");
    onlyMatches("/users/zang/h2h", "h2hMatch");
  });

  it("the profile GET guard excludes /account/me (regression: GET /account/me was shadowed)", () => {
    // Mirror the guard in user.ts: profile GET runs for any GET EXCEPT /account/me.
    const profileGetMatch = (p: string) => !p.endsWith("/account/me");
    const meGetMatch = (p: string) => p.endsWith("/account/me");
    // A normal profile read (pathname "/") is handled by the profile GET, not /me.
    expect(profileGetMatch("/")).toBe(true);
    expect(meGetMatch("/")).toBe(false);
    // /account/me must fall through to the /me handler, NOT the profile GET.
    expect(profileGetMatch("/account/me")).toBe(false);
    expect(meGetMatch("/account/me")).toBe(true);
  });
});

describe("/ledger/append stores parts (mirrors user.ts append body)", () => {
  // Replicates the EXACT push expression from user.ts /ledger/append so the parts
  // store-through is locked the same way the route-ordering test locks predicates.
  function append(profile: UserProfile, tx: { token: string; delta: number; reason: string; ref?: string; parts?: { label: string; delta: number }[] }, now: number) {
    profile.balances[tx.token] = (profile.balances[tx.token] ?? 0) + tx.delta;
    profile.ledger.push({ token: tx.token, delta: tx.delta, reason: tx.reason, ts: now, ref: tx.ref, parts: tx.parts });
    if (profile.ledger.length > 500) profile.ledger = profile.ledger.slice(-500);
  }

  it("persists parts alongside reason/ref and accrues balance", () => {
    const p = {
      username: "zang", createdAt: 1, stats: {} as UserProfile["stats"],
      games: [], ownedRooms: [], ledger: [], balances: { gold: 3 }, h2h: {},
    } satisfies UserProfile;
    const parts = [{ label: "score", delta: 28 }, { label: "daily", delta: 100 }, { label: "speed", delta: 5 }];
    append(p, { token: "gold", delta: 133, reason: "mint:daily", ref: "daily/x#zang", parts }, 999);
    expect(p.balances.gold).toBe(136);
    expect(p.ledger).toHaveLength(1);
    expect(p.ledger[0]).toEqual({ token: "gold", delta: 133, reason: "mint:daily", ts: 999, ref: "daily/x#zang", parts });
    // Σ parts === delta (the daily invariant).
    expect(parts.reduce((s, x) => s + x.delta, 0)).toBe(133);
  });

  it("a partless tx (race cash-out) stores parts: undefined — flat total", () => {
    const p = {
      username: "zang", createdAt: 1, stats: {} as UserProfile["stats"],
      games: [], ownedRooms: [], ledger: [], balances: {}, h2h: {},
    } satisfies UserProfile;
    append(p, { token: "gold", delta: 40, reason: "mint:cashout", ref: "crane/x#0" }, 5);
    expect(p.ledger[0].parts).toBeUndefined();
  });
});
