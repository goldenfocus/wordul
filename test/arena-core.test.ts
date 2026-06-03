import { describe, it, expect } from "vitest";
import {
  emptyArenaState,
  apply,
  prune,
  openGames,
  liveCount,
  STALE_MS,
  MAX_OPEN_MS,
  type SeedRec,
  type ArenaState,
} from "../src/arena-core.ts";

// A believable seeded record. `mintedAt` defaults to 0 so prune tests can set `now` explicitly.
function rec(over: Partial<SeedRec> = {}): SeedRec {
  return {
    path: "arena/maya-0",
    routePath: "/@arena/maya-0",
    name: "Maya's room",
    host: "maya",
    personaId: "maya",
    personaIcon: "🦊",
    edition: "default",
    wordLength: 5,
    seats: "1/2",
    mintedAt: 0,
    status: "minted",
    ...over,
  };
}

// Seed a record into a state at its current seedCount, returning the new state.
function withRec(state: ArenaState, r: SeedRec): ArenaState {
  return apply(state, { type: "mint", rec: r });
}

describe("emptyArenaState", () => {
  it("returns empty seeded + seedCount 0", () => {
    expect(emptyArenaState()).toEqual({ seeded: {}, seedCount: 0 });
  });
});

describe("apply", () => {
  it("mint inserts status=minted and bumps seedCount", () => {
    const s = apply(emptyArenaState(), { type: "mint", rec: rec() });
    expect(s.seedCount).toBe(1);
    expect(s.seeded["arena/maya-0"].status).toBe("minted");
  });

  it("register flips minted→registered, seedCount unchanged", () => {
    let s = withRec(emptyArenaState(), rec({ path: "arena/maya-0" }));
    s = apply(s, { type: "register", path: "arena/maya-0" });
    expect(s.seeded["arena/maya-0"].status).toBe("registered");
    expect(s.seedCount).toBe(1);
  });

  it("register is a no-op for missing or closed records", () => {
    let s = withRec(emptyArenaState(), rec({ path: "arena/maya-0" }));
    s = apply(s, { type: "close", path: "arena/maya-0" }); // now closed
    // closed → register must not resurrect
    s = apply(s, { type: "register", path: "arena/maya-0" });
    expect(s.seeded["arena/maya-0"].status).toBe("closed");
    // missing path → unchanged
    const before = JSON.stringify(s);
    s = apply(s, { type: "register", path: "arena/ghost-9" });
    expect(JSON.stringify(s)).toBe(before);
  });

  it("close flips any status→closed (idempotent)", () => {
    let s = withRec(emptyArenaState(), rec({ path: "arena/maya-0" }));
    s = apply(s, { type: "close", path: "arena/maya-0" });
    expect(s.seeded["arena/maya-0"].status).toBe("closed");
    // idempotent
    s = apply(s, { type: "close", path: "arena/maya-0" });
    expect(s.seeded["arena/maya-0"].status).toBe("closed");
  });
});

describe("liveCount", () => {
  it("counts minted+registered, not closed", () => {
    let s = emptyArenaState();
    s = withRec(s, rec({ path: "arena/a-0", status: "minted" }));
    s = withRec(s, rec({ path: "arena/b-1", status: "minted" }));
    s = apply(s, { type: "register", path: "arena/b-1" }); // registered
    s = withRec(s, rec({ path: "arena/c-2", status: "minted" }));
    s = apply(s, { type: "close", path: "arena/c-2" }); // closed
    expect(liveCount(s)).toBe(2);
  });
});

describe("openGames", () => {
  it("returns only registered, projected to OpenGame (no personaId/status/mintedAt)", () => {
    let s = emptyArenaState();
    s = withRec(s, rec({ path: "arena/a-0", status: "minted" })); // minted, excluded
    s = withRec(s, rec({ path: "arena/maya-1", personaId: "maya" }));
    s = apply(s, { type: "register", path: "arena/maya-1" });
    const games = openGames(s);
    expect(games).toHaveLength(1);
    const g = games[0];
    expect(g.routePath).toBe("/@arena/maya-0"); // routePath comes from the rec verbatim
    expect("personaId" in g).toBe(false);
    expect("status" in g).toBe(false);
    expect("mintedAt" in g).toBe(false);
  });
});

describe("prune", () => {
  it("drops minted older than STALE_MS", () => {
    let s = withRec(emptyArenaState(), rec({ path: "arena/a-0", status: "minted", mintedAt: 0 }));
    s = prune(s, STALE_MS + 1);
    expect(s.seeded["arena/a-0"]).toBeUndefined();
  });

  it("drops registered older than MAX_OPEN_MS (lifetime from mint)", () => {
    let s = withRec(emptyArenaState(), rec({ path: "arena/a-0", mintedAt: 0 }));
    s = apply(s, { type: "register", path: "arena/a-0" });
    s = prune(s, MAX_OPEN_MS + 1);
    expect(s.seeded["arena/a-0"]).toBeUndefined();
  });

  it("keeps fresh minted (< STALE_MS)", () => {
    let s = withRec(emptyArenaState(), rec({ path: "arena/a-0", status: "minted", mintedAt: 0 }));
    s = prune(s, STALE_MS - 1);
    expect(s.seeded["arena/a-0"]?.status).toBe("minted");
  });

  it("GCs closed immediately", () => {
    let s = withRec(emptyArenaState(), rec({ path: "arena/a-0", mintedAt: 0 }));
    s = apply(s, { type: "close", path: "arena/a-0" }); // now closed
    s = prune(s, 1);
    expect(s.seeded["arena/a-0"]).toBeUndefined();
  });
});
