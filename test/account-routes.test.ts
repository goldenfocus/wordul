import { describe, it, expect } from "vitest";
import { publicProfile } from "../src/account-core.ts";
import type { UserProfile } from "../src/types.ts";

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
});
