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
