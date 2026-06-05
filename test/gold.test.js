import { describe, it, expect } from "vitest";
import { GOLD, comboMultiplier, dailyCashOutReady } from "/gold.js";

describe("comboMultiplier", () => {
  it("is 1× for 0 or 1 discovery (no combo)", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(1)).toBe(1);
  });
  it("scales 2→1.5×, 3→2×, 4→2.5×, 5→3×", () => {
    expect(comboMultiplier(2)).toBe(1.5);
    expect(comboMultiplier(3)).toBe(2);
    expect(comboMultiplier(4)).toBe(2.5);
    expect(comboMultiplier(5)).toBe(3);
  });
});

// Regression guard on the C1 round-number constants + the earn formula
// (mirrors app.js accepted-guess earn path). If anyone retunes GOLD or the
// multiplier, these expected payouts must be revisited deliberately.
describe("gold sum (earn formula with C1 constants)", () => {
  const earned = (ng, ny) =>
    Math.round((ng * GOLD.green + ny * GOLD.yellow) * comboMultiplier(ng + ny));

  it("locks the C1 base values", () => {
    expect(GOLD.green).toBe(100);
    expect(GOLD.yellow).toBe(50);
    expect(GOLD.solve).toBe(500);
    expect(GOLD.speedPerGuessLeft).toBe(300);
    expect(GOLD.revealCost).toBe(4000);
    expect(GOLD.vowelCost).toBe(200);
  });

  it("single green = 100 (no combo)", () => {
    expect(earned(1, 0)).toBe(100);
  });
  it("single yellow = 50 (no combo)", () => {
    expect(earned(0, 1)).toBe(50);
  });
  it("2 greens = (100+100)×1.5 = 300", () => {
    expect(earned(2, 0)).toBe(300);
  });
  it("1 green + 1 yellow = (100+50)×1.5 = 225", () => {
    expect(earned(1, 1)).toBe(225);
  });
  it("3 greens = (300)×2 = 600", () => {
    expect(earned(3, 0)).toBe(600);
  });
});

// Regression guard for the 0-gold cash-out race (papa's ◆0 → ◆119, Jun 5 2026):
// the daily server broadcasts TWO snapshots on a solve — an early "fast board flip"
// one (status flipped, NO goldAwarded yet) and, after the awaited ledger mint, the
// confirmed one (goldAwarded: number). The client's one-shot cash-out must fire on
// the SECOND, never burn its guard on the first.
describe("dailyCashOutReady (mint-confirmed cash-out gate)", () => {
  it("not ready on the pre-mint snapshot (status flipped, goldAwarded missing)", () => {
    expect(dailyCashOutReady({ status: "won" }, false)).toBe(false);
  });
  it("ready once the server confirms the mint (goldAwarded is a number)", () => {
    expect(dailyCashOutReady({ status: "won", goldAwarded: 119 }, false)).toBe(true);
  });
  it("ready for a confirmed 0-gold mint (resigner: goldAwarded === 0)", () => {
    expect(dailyCashOutReady({ status: "lost", goldAwarded: 0 }, false)).toBe(true);
  });
  it("never ready while still playing, even if a stale goldAwarded exists", () => {
    expect(dailyCashOutReady({ status: "playing", goldAwarded: 7 }, false)).toBe(false);
  });
  it("one-shot: never re-fires after the cash-out ran", () => {
    expect(dailyCashOutReady({ status: "won", goldAwarded: 119 }, true)).toBe(false);
  });
  it("no player, no cash-out", () => {
    expect(dailyCashOutReady(null, false)).toBe(false);
  });
});
