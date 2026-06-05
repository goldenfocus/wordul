import { describe, it, expect } from "vitest";
import { buildOwnerTape, FIRST_GUESS_MS, MIN_GAP_MS, MAX_GAP_MS, DEFAULT_GAP_MS } from "/owner-tape.js";

// The owner's solo run, re-cut as a ghost tape at mint time so a /c/<id> visitor
// races a replay instead of a static score. Masks only — same no-spoiler rule as
// the arena tapes recorded by the Room DO.
describe("buildOwnerTape", () => {
  const masks = [
    ["cold", "cold", "warm", "cold", "cold"],
    ["cold", "warm", "hot", "cold", "cold"],
    ["hot", "hot", "hot", "hot", "hot"],
  ];
  const base = { username: "papa", wordLength: 5, maxGuesses: 6, masks, won: true };

  it("builds a v1 tape: one host player, a guess event per row, one finish", () => {
    const tape = buildOwnerTape({ ...base, times: null });
    expect(tape.v).toBe(1);
    expect(tape.wordLength).toBe(5);
    expect(tape.maxGuesses).toBe(6);
    expect(tape.players).toEqual([{ username: "papa", host: true }]);
    const guesses = tape.events.filter((e) => e.k === "guess");
    expect(guesses).toHaveLength(3);
    expect(guesses[0].status).toBe("playing");
    expect(guesses[2].status).toBe("won");
    expect(guesses[2].mask).toEqual(masks[2]);
    const finish = tape.events[tape.events.length - 1];
    expect(finish).toMatchObject({ k: "finish", u: "papa", status: "won", guesses: 3 });
  });

  it("uses real inter-guess gaps when commit times are known", () => {
    const times = [1000, 4000, 9000]; // gaps: 3s, 5s — both within clamp range
    const tape = buildOwnerTape({ ...base, times });
    const [g1, g2, g3] = tape.events.filter((e) => e.k === "guess");
    expect(g1.t).toBe(FIRST_GUESS_MS);
    expect(g2.t - g1.t).toBe(3000);
    expect(g3.t - g2.t).toBe(5000);
  });

  it("clamps a marathon gap (daily left open for hours) so the replay stays watchable", () => {
    const times = [1000, 1000 + 3 * 60 * 60 * 1000, 1000 + 3 * 60 * 60 * 1000 + 200];
    const tape = buildOwnerTape({ ...base, times });
    const [g1, g2, g3] = tape.events.filter((e) => e.k === "guess");
    expect(g2.t - g1.t).toBe(MAX_GAP_MS);
    expect(g3.t - g2.t).toBe(MIN_GAP_MS);
  });

  it("falls back to a fixed cadence when times are missing or incomplete (mid-game reload)", () => {
    const tape = buildOwnerTape({ ...base, times: [5000] }); // 1 time for 3 guesses
    const [g1, g2, g3] = tape.events.filter((e) => e.k === "guess");
    expect(g1.t).toBe(FIRST_GUESS_MS);
    expect(g2.t - g1.t).toBe(DEFAULT_GAP_MS);
    expect(g3.t - g2.t).toBe(DEFAULT_GAP_MS);
  });

  it("a lost run finishes lost", () => {
    const tape = buildOwnerTape({ ...base, won: false, times: null });
    const finish = tape.events[tape.events.length - 1];
    expect(finish.status).toBe("lost");
    const last = tape.events.filter((e) => e.k === "guess").pop();
    expect(last.status).toBe("lost");
  });

  it("returns null with no rows (nothing to replay)", () => {
    expect(buildOwnerTape({ ...base, masks: [], times: null })).toBeNull();
  });

  it("copies masks defensively (mutating input later doesn't corrupt the tape)", () => {
    const mine = masks.map((m) => m.slice());
    const tape = buildOwnerTape({ ...base, masks: mine, times: null });
    mine[0][0] = "hot";
    expect(tape.events[0].mask[0]).toBe("cold");
  });
});
