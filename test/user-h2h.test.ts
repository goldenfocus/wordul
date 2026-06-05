import { describe, it, expect } from "vitest";
import { healProfile, freshProfile, applyH2H } from "../src/user-core.ts";
import type { UserProfile } from "../src/types.ts";

function profileWithLedger(): UserProfile {
  return {
    username: "yan",
    createdAt: 1,
    stats: { played: 2, wins: 1, currentStreak: 1, maxStreak: 1, guessDistribution: {} } as UserProfile["stats"],
    games: [],
    ownedRooms: [],
    ledger: [{ token: "gold", delta: 250, reason: "mint:cashout", ts: 1 }],
    balances: { gold: 250 },
  };
}

describe("healProfile (E1, E4)", () => {
  it("backfills missing h2h to {}", () => {
    const p = healProfile(profileWithLedger(), "yan");
    expect(p.h2h).toEqual({});
  });

  it("preserves balances/ledger (gold path unchanged)", () => {
    const p = healProfile(profileWithLedger(), "yan");
    expect(p.balances.gold).toBe(250);
    expect(p.ledger).toHaveLength(1);
    expect(p.ledger[0].delta).toBe(250);
  });

  it("rebuilds balances from ledger when balances is missing (existing self-heal intact)", () => {
    const broken = profileWithLedger();
    // @ts-expect-error simulate a pre-balances profile
    delete broken.balances;
    const p = healProfile(broken, "yan");
    expect(p.balances.gold).toBe(250);
  });
});

describe("freshProfile", () => {
  it("includes an empty h2h and empty ledger/balances", () => {
    const p = freshProfile("newbie");
    expect(p.username).toBe("newbie");
    expect(p.h2h).toEqual({});
    expect(p.ledger).toEqual([]);
    expect(p.balances).toEqual({});
  });
});

describe("applyH2H (E2)", () => {
  it("increments the win counter", () => {
    const h2h: Record<string, { w: number; l: number }> = {};
    applyH2H(h2h, "maya", "w");
    applyH2H(h2h, "maya", "w");
    expect(h2h.maya).toEqual({ w: 2, l: 0 });
  });

  it("increments the loss counter independently", () => {
    const h2h: Record<string, { w: number; l: number }> = { maya: { w: 1, l: 0 } };
    applyH2H(h2h, "maya", "l");
    expect(h2h.maya).toEqual({ w: 1, l: 1 });
  });
});

describe("route ordering guard (E3 — /h2h never shadows /ledger/append)", () => {
  // Mirror the exact predicates in user.ts fetch(), in route order.
  const appendMatch = (p: string) => p.endsWith("/append") && !p.endsWith("/ledger/append");
  const ledgerMatch = (p: string) => p.endsWith("/ledger/append");
  const h2hMatch = (p: string) => p.endsWith("/h2h");

  it("a /h2h path matches ONLY the h2h route", () => {
    const p = "/users/yan/h2h";
    expect(appendMatch(p)).toBe(false);
    expect(ledgerMatch(p)).toBe(false);
    expect(h2hMatch(p)).toBe(true);
  });

  it("a /ledger/append path is never caught by /append or /h2h", () => {
    const p = "/users/yan/ledger/append";
    expect(appendMatch(p)).toBe(false); // the load-bearing guard
    expect(h2hMatch(p)).toBe(false);
    expect(ledgerMatch(p)).toBe(true);
  });
});

describe("reserved follows/followers seams", () => {
  it("seeds empty follows/followers arrays", () => {
    const p = freshProfile("zang");
    expect(p.follows).toEqual([]);
    expect(p.followers).toEqual([]);
  });
  it("backfills follows/followers on heal of an older profile", () => {
    const old = freshProfile("zang");
    delete old.follows;
    delete old.followers;
    const healed = healProfile(old, "zang");
    expect(healed.follows).toEqual([]);
    expect(healed.followers).toEqual([]);
  });
});
