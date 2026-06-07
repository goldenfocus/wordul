import { describe, it, expect } from "vitest";
import { triesFor, seatModel, compactRowProps, ghostSeatModel, railPillLabel, emptySeatActions } from "../public/lobby-view.js";

describe("triesFor (mirrors server guessesFor)", () => {
  it("is length+1, plateauing at 8", () => {
    expect(triesFor(4)).toBe(5);
    expect(triesFor(5)).toBe(6);
    expect(triesFor(7)).toBe(8);
    expect(triesFor(8)).toBe(8);   // plateau
    expect(triesFor(11)).toBe(8);  // plateau holds
  });
});

describe("seatModel (Your table)", () => {
  it("marks seat 0 as you, fills joined players, pads empties to capacity", () => {
    const m = seatModel({ players: [{ username: "papa" }, { username: "kai", isBot: false }], capacity: 3 }, "papa");
    expect(m.taken).toBe(2);
    expect(m.capacity).toBe(3);
    expect(m.seats.map((s) => s.kind)).toEqual(["you", "taken", "empty"]);
  });
  it("falls back to players.length capacity when capacity missing, min 2", () => {
    const m = seatModel({ players: [{ username: "papa" }] }, "papa");
    expect(m.capacity).toBeGreaterThanOrEqual(2);
    expect(m.taken).toBe(1);
  });
});

describe("ghostSeatModel", () => {
  it("is you + one seat per tape player, full house", () => {
    const tape = { players: [{ username: "ada", host: true }, { username: "bo" }] };
    const m = ghostSeatModel(tape);
    expect(m.seats.map((s) => s.kind)).toEqual(["you", "ghost", "ghost"]);
    expect(m.seats[1].username).toBe("ada");
    expect(m.taken).toBe(3);
    expect(m.capacity).toBe(3);
  });
  it("tolerates a missing tape", () => {
    const m = ghostSeatModel(null);
    expect(m.seats).toEqual([{ kind: "you" }]);
    expect(m.capacity).toBe(1);
  });
});

describe("seatModel ready marks", () => {
  it("carries each player's ready flag onto you/taken seats", () => {
    const snap = {
      capacity: 3,
      players: [
        { username: "me", ready: true },
        { username: "bo", ready: false },
      ],
    };
    const m = seatModel(snap, "me");
    expect(m.seats[0]).toMatchObject({ kind: "you", ready: true });
    expect(m.seats[1]).toMatchObject({ kind: "taken", username: "bo", ready: false });
  });
});

describe("compactRowProps (floor row)", () => {
  it("derives ×T tries from wordLength", () => {
    const p = compactRowProps({ routePath: "/@a/x", personaIcon: "🦊", host: "maya", wordLength: 8, seats: "4/5", edition: "jackpot" });
    expect(p.tries).toBe(8);
    expect(p.host).toBe("maya");
    expect(p.seats).toBe("4/5");
  });
});

describe("seatModel spectators (Lobby v2)", () => {
  const snap = {
    capacity: 2,
    players: [
      { username: "papa", role: "duelist", ready: true },
      { username: "kai", role: "duelist" },
      { username: "zoe", role: "spectator" },
      { username: "ana", role: "spectator" },
    ],
  };
  it("excludes spectators from seats and counts them as watching", () => {
    const m = seatModel(snap, "papa");
    expect(m.seats.map((s) => s.kind)).toEqual(["you", "taken"]);
    expect(m.taken).toBe(2);
    expect(m.capacity).toBe(2);
    expect(m.watching).toBe(2);
    expect(m.iAmSpectator).toBe(false);
  });
  it("a spectator viewer gets no you-seat and knows it", () => {
    const m = seatModel(snap, "zoe");
    expect(m.seats.map((s) => s.kind)).toEqual(["taken", "taken"]);
    expect(m.iAmSpectator).toBe(true);
    expect(m.watching).toBe(2); // zoe counts herself among the watchers
  });
  it("legacy snapshots without roles still seat everyone", () => {
    const m = seatModel({ capacity: 3, players: [{ username: "papa" }, { username: "kai" }] }, "papa");
    expect(m.seats.map((s) => s.kind)).toEqual(["you", "taken", "empty"]);
    expect(m.watching).toBe(0);
  });
});

describe("railPillLabel", () => {
  it("pluralizes the open-tables count", () => {
    expect(railPillLabel(0)).toBe("0 tables open");
    expect(railPillLabel(1)).toBe("1 table open");
    expect(railPillLabel(7)).toBe("7 tables open");
  });
});

describe("emptySeatActions (tap-a-seat capacity, Air skin)", () => {
  const model = (capacity, taken) => seatModel(
    { capacity, players: [{ username: "host" }, ...Array.from({ length: taken - 1 }, (_, i) => ({ username: "p" + i }))] },
    "host",
  );

  it("non-hosts get nothing — no + glyphs, no \u2715", () => {
    expect(emptySeatActions(model(3, 1), false)).toEqual({ addable: false, removableIndex: -1 });
  });

  it("host on a fresh duel: the empty seat adds, nothing removes (capacity at floor)", () => {
    const a = emptySeatActions(model(2, 1), true);
    expect(a.addable).toBe(true);
    expect(a.removableIndex).toBe(-1);
  });

  it("raised table: the LAST empty chair carries the \u2715", () => {
    const m = model(4, 1); // you + 3 empties
    expect(emptySeatActions(m, true).removableIndex).toBe(3);
  });

  it("at MAX capacity the + disappears but the \u2715 stays", () => {
    const a = emptySeatActions(model(6, 1), true);
    expect(a.addable).toBe(false);
    expect(a.removableIndex).toBe(5);
  });

  it("never removes below seated players", () => {
    // 3 seated at capacity 3: lo = max(2,3) = 3, no removable chair.
    expect(emptySeatActions(model(3, 3), true).removableIndex).toBe(-1);
  });

  it("a spectator never edits, even as inherited host", () => {
    const m = seatModel(
      { capacity: 3, players: [{ username: "watcher", role: "spectator" }, { username: "a" }, { username: "b" }] },
      "watcher",
    );
    expect(emptySeatActions(m, true)).toEqual({ addable: false, removableIndex: -1 });
  });
});
