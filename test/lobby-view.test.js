import { describe, it, expect } from "vitest";
import { triesFor, seatModel, compactRowProps, ghostSeatModel, railPillLabel, railTitleCount, emptySeatActions, yourTableRowProps, shouldChimeOnJoin, shouldShowRoundScore } from "../public/lobby-view.js";

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

describe("railTitleCount (desktop header count, iter3 §1 review fix)", () => {
  it("renders 'N open' — the noun lives in the Tables/Arena title", () => {
    expect(railTitleCount(0)).toBe("0 open");
    expect(railTitleCount(1)).toBe("1 open");
    expect(railTitleCount(7)).toBe("7 open");
  });
  it("coerces junk to 0 (loading/error states never paint NaN)", () => {
    expect(railTitleCount(undefined)).toBe("0 open");
    expect(railTitleCount("nope")).toBe("0 open");
  });
});

describe("yourTableRowProps (pinned rail row, iter3 §1)", () => {
  const snap = {
    capacity: 3,
    wordLength: 5,
    maxGuesses: 6,
    players: [{ username: "papa" }, { username: "kai" }],
  };
  it("builds the compact-row shape from the LIVE snapshot", () => {
    const p = yourTableRowProps(snap, "papa");
    expect(p).toMatchObject({ avatar: "P", host: "Your table", dim: "5×6", seats: "2/3" });
  });
  it("ticks seats when capacity or players change (the ＋/✕ feedback)", () => {
    expect(yourTableRowProps({ ...snap, capacity: 4 }, "papa").seats).toBe("2/4");
    expect(yourTableRowProps({ ...snap, players: [{ username: "papa" }] }, "papa").seats).toBe("1/3");
  });
  it("excludes spectators from the seat count, like the seat strip", () => {
    const p = yourTableRowProps(
      { ...snap, players: [...snap.players, { username: "zoe", role: "spectator" }] },
      "papa",
    );
    expect(p.seats).toBe("2/3");
  });
  it("falls back to smart-default rows when maxGuesses is missing", () => {
    expect(yourTableRowProps({ ...snap, maxGuesses: undefined }, "papa").dim).toBe("5×6");
  });
  it("avatar falls back to ◆ without a username", () => {
    expect(yourTableRowProps(snap, "").avatar).toBe("◆");
  });
});

describe("shouldChimeOnJoin (join sound decision, iter3 §1)", () => {
  it("chimes when the taken count grows in the lobby phase", () => {
    expect(shouldChimeOnJoin(1, 2, "lobby")).toBe(true);
  });
  it("stays silent on the first paint (my own join — no previous count)", () => {
    expect(shouldChimeOnJoin(null, 1, "lobby")).toBe(false);
    expect(shouldChimeOnJoin(undefined, 2, "lobby")).toBe(false);
  });
  it("stays silent when the count holds or shrinks (capacity taps, leavers)", () => {
    expect(shouldChimeOnJoin(2, 2, "lobby")).toBe(false);
    expect(shouldChimeOnJoin(2, 1, "lobby")).toBe(false);
  });
  it("never chimes outside the lobby phase", () => {
    expect(shouldChimeOnJoin(1, 2, "playing")).toBe(false);
    expect(shouldChimeOnJoin(1, 2, "finished")).toBe(false);
  });
});

describe("shouldShowRoundScore (iter3 §2 — no 'Score 0' in duel lobbies)", () => {
  it("never shows in the lobby phase, whatever the tally", () => {
    expect(shouldShowRoundScore("lobby", "playing", 0)).toBe(false);
    expect(shouldShowRoundScore("lobby", "playing", 120)).toBe(false);
  });
  it("never shows a zero (or missing) score", () => {
    expect(shouldShowRoundScore("playing", "playing", 0)).toBe(false);
    expect(shouldShowRoundScore("playing", "playing", undefined)).toBe(false);
    expect(shouldShowRoundScore("playing", "playing", null)).toBe(false);
  });
  it("shows while solving with a non-zero tally — negatives (penalty drains) included", () => {
    expect(shouldShowRoundScore("playing", "playing", 25)).toBe(true);
    expect(shouldShowRoundScore("playing", "playing", -50)).toBe(true);
  });
  it("hides once you're done (the settlement screen owns the end state)", () => {
    expect(shouldShowRoundScore("playing", "won", 120)).toBe(false);
    expect(shouldShowRoundScore("playing", undefined, 120)).toBe(false);
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
