import { describe, it, expect } from "vitest";
import {
  POINTS, SPEED_CAP, SPEED_WINDOW_MS, comboMultiplier, escalatedPenalty,
  orderedDiscoveriesInLast, deadLettersFrom, wastedDeadLettersInLast,
  pointsEarned, speedBonusPoints, goldFromPoints, balance,
} from "../src/economy.ts";
import type { GuessRow } from "../src/economy.ts";

// helper: build a GuessRow from a word + a mask string ("g"=green,"y"=yellow,"x"=gray)
const row = (word: string, m: string): GuessRow => ({
  word: word.toUpperCase(),
  mask: [...m].map((c) => (c === "g" ? "green" : c === "y" ? "yellow" : "gray")),
});

describe("comboMultiplier", () => {
  it("is 1x for 0-1 discoveries, scales 0.5 per extra", () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBe(1.5);
    expect(comboMultiplier(5)).toBe(3);
  });
});

describe("escalatedPenalty", () => {
  it("is base on first reuse, linear after", () => {
    expect(escalatedPenalty(50, 0)).toBe(50);
    expect(escalatedPenalty(50, 2)).toBe(150);
  });
});

describe("orderedDiscoveriesInLast", () => {
  it("lists new yellows then new greens, ascending, dup-safe", () => {
    const guesses = [row("CRANE", "gyxxx")]; // C green, R yellow
    const d = orderedDiscoveriesInLast(guesses);
    expect(d.map((x) => x.kind)).toEqual(["yellow", "green"]);
    expect(d.map((x) => x.index)).toEqual([1, 0]);
  });
  it("does not re-count a color already seen at that index", () => {
    const guesses = [row("CRANE", "gxxxx"), row("CLOUD", "gxxxx")];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([]); // C green was already green
  });

  it("a moving yellow letter pays its yellow once, not again at a new position", () => {
    // R proven present (yellow) at pos1 in guess1; reappears yellow at pos0 in guess2.
    // Dedup by LETTER → no new yellow discovery for R in guess2.
    const guesses = [row("CRANE", "xyxxx"), row("RUMBA", "yxxxx")];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([]);
  });

  it("yellow→green upgrade: the green still pays (dedup green by POSITION)", () => {
    // R yellow at pos1 in guess1 (letter proven present). In guess2 R lands green at pos1.
    // Green dedup is by position; pos1 was never green before → green R pos1 pays.
    const guesses = [row("CRANE", "xyxxx"), row("BREAD", "xgxxx")];
    const d = orderedDiscoveriesInLast(guesses);
    expect(d).toEqual([{ index: 1, kind: "green", letter: "R" }]);
  });

  it("a carried green never re-pays at the same position", () => {
    const guesses = [row("CRANE", "gxxxx"), row("CLOUD", "gxxxx"), row("CHALK", "gxxxx")];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([]); // C green at pos0 long proven
  });
});

describe("deadLettersFrom / wastedDeadLettersInLast", () => {
  it("marks a gray-everywhere letter dead and flags its reuse", () => {
    const prior = [row("CRANE", "xxxxx")]; // all gray -> C,R,A,N,E dead
    expect(deadLettersFrom(prior).has("C")).toBe(true);
    const guesses = [...prior, row("CLOUD", "xxxxx")];
    expect(wastedDeadLettersInLast(guesses)).toEqual({ letters: ["C"], count: 1 });
  });
  it("a letter green somewhere is never dead (dup-safe)", () => {
    const prior = [row("EERIE", "gxxxx")]; // first E green -> E not dead
    expect(deadLettersFrom(prior).has("E")).toBe(false);
  });
});

describe("pointsEarned", () => {
  it("pays greens+yellows with combo and a solve+speed bonus", () => {
    // 5 greens, combo(5)=3x -> round(500*3)=1500, +solve 500 +speed 300*5=1500 => 3500
    const guesses = [row("CRANE", "ggggg")];
    expect(pointsEarned(guesses, 6)).toBe(1500 + 500 + 1500);
  });
  it("subtracts capped, escalating wasted-letter penalties", () => {
    // guess1 all gray (C,R,A,N,E dead), guess2 "CRUMB" reuses C and R (2 dead letters),
    // no discoveries -> 50 + 50 = 100 penalty, total -100.
    const guesses = [row("CRANE", "xxxxx"), row("CRUMB", "xxxxx")];
    expect(pointsEarned(guesses, 6)).toBe(-100);
  });
});

describe("speedBonusPoints", () => {
  it("decays linearly from SPEED_CAP at 0ms to 0 at the window edge", () => {
    expect(SPEED_CAP).toBe(500);
    expect(SPEED_WINDOW_MS).toBe(180000);
    expect(speedBonusPoints(0)).toBe(500);
    expect(speedBonusPoints(90000)).toBe(250);
    expect(speedBonusPoints(180000)).toBe(0);
    expect(speedBonusPoints(200000)).toBe(0); // clamps over-window to 0
    expect(speedBonusPoints(-50)).toBe(500);  // clamps negatives (elapsed never < 0)
  });
});

describe("CRANE → CRANK economy case", () => {
  // Answer CRANK. Guess1 CRANE → C,R,A,N green, E gray. Guess2 CRANK → all green (solve).
  const guesses = [row("CRANE", "ggggx"), row("CRANK", "ggggg")];

  it("guess2 yields only the new green K at pos5 (no re-paid greens, no phantom yellow)", () => {
    expect(orderedDiscoveriesInLast(guesses)).toEqual([
      { index: 4, kind: "green", letter: "K" },
    ]);
  });

  it("pointsEarned reflects the discoveries + solve, independent of the speed clock", () => {
    // guess1: 4 new greens, combo(4)=2.5× → round(400*2.5)=1000.
    // guess2: 1 new green (K), combo(1)=1× → 100. Solve at guess2: +500 +300*guessesLeft(6-2=4)=1200.
    // pointsEarned uses the GUESS-count speed bonus (speedPerGuessLeft), not wall-clock speedBonusPoints.
    expect(pointsEarned(guesses, 6)).toBe(1000 + 100 + 500 + 1200);
  });
});

describe("goldFromPoints", () => {
  it("converts points to gold and never mints negative", () => {
    expect(goldFromPoints(3500)).toBe(35);
    expect(goldFromPoints(-100)).toBe(0);
  });
});

describe("daily mint formula (spec §B + §C)", () => {
  // room.ts scorePlayer mints, for a non-resigner:
  //   gold = goldFromPoints(points) + DAILY_GOLD_BONUS + goldFromPoints(speedBonusPoints(elapsedMs))
  // DAILY_GOLD_BONUS is a room.ts constant (100); we verify the two economy-owned legs here
  // and the composition. Server wiring (startedAt stamp, isDaily branch) is covered manually
  // (no DO harness for the RoomDO class in this suite).
  const DAILY_GOLD_BONUS = 100; // mirror of room.ts constant
  const mint = (points: number, elapsedMs: number | null) =>
    goldFromPoints(points) + DAILY_GOLD_BONUS + (elapsedMs == null ? 0 : goldFromPoints(speedBonusPoints(elapsedMs)));

  it("adds the score mint + flat daily goody + a wall-clock time bonus", () => {
    // 3500 pts → 35 gold; +100 goody; instant solve (0ms) → speedBonus 500 → 5 gold = 140.
    expect(mint(3500, 0)).toBe(35 + 100 + 5);
  });
  it("time bonus decays to 0 at the window edge (just score + goody)", () => {
    expect(mint(3500, SPEED_WINDOW_MS)).toBe(35 + 100 + 0);
  });
  it("a null solve clock (never stamped) contributes no time bonus", () => {
    expect(mint(3500, null)).toBe(35 + 100);
  });
  it("half-window solve earns half the speed bonus in gold", () => {
    // speedBonusPoints(90000)=250 → goldFromPoints(250)=round(2.5)=2 (banker's: 3? round=3) gold.
    expect(mint(0, 90000)).toBe(0 + 100 + goldFromPoints(speedBonusPoints(90000)));
    expect(goldFromPoints(speedBonusPoints(90000))).toBe(3); // 250/100 → 2.5 → round → 3
  });

  // §B CLIENT CASH-OUT breakdown honesty. app.js cashOutDaily reconstructs the goody breakdown
  // from what the client actually has on the wire: the SERVER total (me.goldAwarded), the
  // player's final daily points (me.points), and the flat daily bonus constant. It derives
  //   scoreGold = round(points/100)            (mirrors goldFromPoints)
  //   dailyBonus = 100 (when there is any mint)
  //   speedGold  = max(0, mint − scoreGold − dailyBonus)   ← the HONEST remainder
  // The contract: those three displayed legs always SUM to the server's goldAwarded — the
  // total stays authoritative, nothing is fabricated, and the speed leg matches the server's
  // own speed bonus exactly (since score+daily+speed === mint on the server too).
  const DAILY_GOLD_BONUS_CLIENT = 100; // mirror of app.js DAILY_GOLD_BONUS (= room.ts)
  const clientBreakdown = (goldAwarded: number, points: number) => {
    const scoreGold = Math.max(0, Math.round(points / 100));
    const dailyBonus = goldAwarded > 0 ? DAILY_GOLD_BONUS_CLIENT : 0;
    const speedGold = Math.max(0, goldAwarded - scoreGold - dailyBonus);
    return { scoreGold, dailyBonus, speedGold };
  };

  it("client cash-out legs sum to the server's confirmed mint (never fabricated)", () => {
    for (const [points, elapsedMs] of [[3500, 0], [3500, SPEED_WINDOW_MS], [0, 90000], [120, 45000]] as const) {
      const goldAwarded = mint(points, elapsedMs); // the server total the wire delivers
      const { scoreGold, dailyBonus, speedGold } = clientBreakdown(goldAwarded, points);
      expect(scoreGold + dailyBonus + speedGold).toBe(goldAwarded); // legs sum to the total
      expect(scoreGold).toBe(goldFromPoints(points));               // score leg is honest
      // The remainder leg equals the server's own wall-clock speed bonus, exactly.
      expect(speedGold).toBe(goldFromPoints(speedBonusPoints(elapsedMs)));
    }
  });

  it("a zero mint shows no breakdown legs (nothing to claim)", () => {
    const { scoreGold, dailyBonus, speedGold } = clientBreakdown(0, 0);
    expect(scoreGold + dailyBonus + speedGold).toBe(0);
    expect(dailyBonus).toBe(0); // no daily-bonus line when the server minted nothing
  });
});

describe("balance", () => {
  it("sums signed deltas for a token and allows negative", () => {
    const led = [
      { token: "gold", delta: 100, reason: "mint:cashout", ts: 1 },
      { token: "gold", delta: -300, reason: "spend:buyin", ts: 2 },
      { token: "other", delta: 999, reason: "x", ts: 3 },
    ];
    expect(balance(led, "gold")).toBe(-200);
  });
});
