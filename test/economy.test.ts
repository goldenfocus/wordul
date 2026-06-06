import { describe, it, expect } from "vitest";
import {
  POINTS, SPEED_CAP, SPEED_WINDOW_MS, comboMultiplier, escalatedPenalty,
  orderedDiscoveriesInLast, deadLettersFrom, wastedDeadLettersInLast,
  pointsEarned, speedBonusPoints, goldFromPoints, balance, settle, settleParts,
  DAILY_GOLD_RATE,
} from "../src/economy.ts";
import type { GuessRow } from "../src/economy.ts";

// helper: build a GuessRow from a word + a mask string ("g"=hot,"y"=warm,"x"=cold)
const row = (word: string, m: string): GuessRow => ({
  word: word.toUpperCase(),
  mask: [...m].map((c) => (c === "g" ? "hot" : c === "y" ? "warm" : "cold")),
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
  it("lists new warms then new hots, ascending, dup-safe", () => {
    const guesses = [row("CRANE", "gyxxx")]; // C hot, R warm
    const d = orderedDiscoveriesInLast(guesses);
    expect(d.map((x) => x.kind)).toEqual(["warm", "hot"]);
    expect(d.map((x) => x.index)).toEqual([1, 0]);
  });
  it("does not re-count a color already seen at that index", () => {
    const guesses = [row("CRANE", "gxxxx"), row("CLOUD", "gxxxx")];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([]); // C hot was already hot
  });

  it("a moving warm letter pays its warm once, not again at a new position", () => {
    // R proven present (warm) at pos1 in guess1; reappears warm at pos0 in guess2.
    // Dedup by LETTER → no new warm discovery for R in guess2.
    const guesses = [row("CRANE", "xyxxx"), row("RUMBA", "yxxxx")];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([]);
  });

  it("warm→hot upgrade: the hot still pays (dedup hot by POSITION)", () => {
    // R warm at pos1 in guess1 (letter proven present). In guess2 R lands hot at pos1.
    // Hot dedup is by position; pos1 was never hot before → hot R pos1 pays.
    const guesses = [row("CRANE", "xyxxx"), row("BREAD", "xgxxx")];
    const d = orderedDiscoveriesInLast(guesses);
    expect(d).toEqual([{ index: 1, kind: "hot", letter: "R" }]);
  });

  it("a carried hot never re-pays at the same position", () => {
    const guesses = [row("CRANE", "gxxxx"), row("CLOUD", "gxxxx"), row("CHALK", "gxxxx")];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([]); // C hot at pos0 long proven
  });
});

describe("deadLettersFrom / wastedDeadLettersInLast", () => {
  it("marks a cold-everywhere letter dead and flags its reuse", () => {
    const prior = [row("CRANE", "xxxxx")]; // all cold -> C,R,A,N,E dead
    expect(deadLettersFrom(prior).has("C")).toBe(true);
    const guesses = [...prior, row("CLOUD", "xxxxx")];
    expect(wastedDeadLettersInLast(guesses)).toEqual({ letters: ["C"], count: 1 });
  });
  it("a letter hot somewhere is never dead (dup-safe)", () => {
    const prior = [row("EERIE", "gxxxx")]; // first E hot -> E not dead
    expect(deadLettersFrom(prior).has("E")).toBe(false);
  });
});

describe("pointsEarned", () => {
  it("pays hots+warms with combo and a solve+speed bonus", () => {
    // 5 hots, combo(5)=3x -> round(500*3)=1500, +solve 500 +speed 300*5=1500 => 3500
    const guesses = [row("CRANE", "ggggg")];
    expect(pointsEarned(guesses, 6)).toBe(1500 + 500 + 1500);
  });
  it("subtracts capped, escalating wasted-letter penalties", () => {
    // guess1 all cold (C,R,A,N,E dead), guess2 "CRUMB" reuses C and R (2 dead letters),
    // no discoveries -> 50 + 50 = 100 penalty; +2× valid-word bonus (25 each) → -50.
    const guesses = [row("CRANE", "xxxxx"), row("CRUMB", "xxxxx")];
    expect(pointsEarned(guesses, 6)).toBe(-100 + 2 * POINTS.validWord);
  });
});

describe("valid-word bonus", () => {
  it("a zero-discovery valid guess still earns the flat bonus (no more dead air)", () => {
    const guesses = [row("CRANE", "xxxxx")]; // all cold, no prior guesses → no penalty
    expect(pointsEarned(guesses, 6)).toBe(POINTS.validWord);
  });
  it("stacks flat with discovery points, OUTSIDE the combo multiplier", () => {
    // C,R warm: base 100 × combo(2)=1.5 → 150, +25 flat (not 125×1.5).
    const guesses = [row("CRANE", "yyxxx")];
    expect(pointsEarned(guesses, 6)).toBe(150 + POINTS.validWord);
  });
  it("the winning (all-green) row earns NO valid-word bonus — solve bonus owns it", () => {
    // Same as the headline solve case: 1500 combo + 500 solve + 1500 speed, no +25.
    const guesses = [row("CRANE", "ggggg")];
    expect(pointsEarned(guesses, 6)).toBe(1500 + 500 + 1500);
  });
  it("every non-winning row pays once: wrong guesses then a solve", () => {
    // guess1 all cold (+25), guess2 solve: 5 hots combo 1500 + solve 500 + speed 300×4.
    const guesses = [row("MUSTY", "xxxxx"), row("CRANE", "ggggg")];
    expect(pointsEarned(guesses, 6)).toBe(POINTS.validWord + 1500 + 500 + 1200);
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
  // Answer CRANK. Guess1 CRANE → C,R,A,N hot, E cold. Guess2 CRANK → all hot (solve).
  const guesses = [row("CRANE", "ggggx"), row("CRANK", "ggggg")];

  it("guess2 yields only the new hot K at pos5 (no re-paid hots, no phantom warm)", () => {
    expect(orderedDiscoveriesInLast(guesses)).toEqual([
      { index: 4, kind: "hot", letter: "K" },
    ]);
  });

  it("pointsEarned reflects the discoveries + solve, independent of the speed clock", () => {
    // guess1: 4 new hots, combo(4)=2.5× → round(400*2.5)=1000, +25 valid-word bonus.
    // guess2: 1 new hot (K), combo(1)=1× → 100. Solve at guess2: +500 +300*guessesLeft(6-2=4)=1200.
    // pointsEarned uses the GUESS-count speed bonus (speedPerGuessLeft), not wall-clock speedBonusPoints.
    expect(pointsEarned(guesses, 6)).toBe(1000 + POINTS.validWord + 100 + 500 + 1200);
  });
});

describe("goldFromPoints", () => {
  it("converts points to gold and never mints negative", () => {
    expect(goldFromPoints(3500)).toBe(35);
    expect(goldFromPoints(-100)).toBe(0);
  });

  it("honors a custom rate divisor (daily mints at ÷9)", () => {
    expect(goldFromPoints(2300, DAILY_GOLD_RATE)).toBe(256); // 2300/9 = 255.55… → 256
    expect(goldFromPoints(3500)).toBe(35);                   // default 100 unchanged
    expect(goldFromPoints(-100, DAILY_GOLD_RATE)).toBe(0);   // never negative at any rate
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
    goldFromPoints(points, DAILY_GOLD_RATE) + DAILY_GOLD_BONUS +
    (elapsedMs == null ? 0 : goldFromPoints(speedBonusPoints(elapsedMs), DAILY_GOLD_RATE));

  it("adds the score mint + flat daily goody + a wall-clock time bonus", () => {
    // 3500 pts ÷9 → 389; +100 goody; instant solve (0ms) → speedBonus 500 ÷9 → 56 = 545.
    expect(mint(3500, 0)).toBe(389 + 100 + 56);
  });
  it("time bonus decays to 0 at the window edge (just score + goody)", () => {
    expect(mint(3500, SPEED_WINDOW_MS)).toBe(389 + 100 + 0);
  });
  it("a null solve clock (never stamped) contributes no time bonus", () => {
    expect(mint(3500, null)).toBe(389 + 100);
  });
  it("half-window solve earns half the speed bonus in gold", () => {
    // speedBonusPoints(90000)=250 → goldFromPoints(250, DAILY_GOLD_RATE) = round(250/9) = round(27.8) = 28.
    expect(mint(0, 90000)).toBe(0 + 100 + goldFromPoints(speedBonusPoints(90000), DAILY_GOLD_RATE));
    expect(goldFromPoints(speedBonusPoints(90000), DAILY_GOLD_RATE)).toBe(28); // 250/9 → 27.8 → 28
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
    const scoreGold = Math.max(0, Math.round(points / DAILY_GOLD_RATE));
    const dailyBonus = goldAwarded > 0 ? DAILY_GOLD_BONUS_CLIENT : 0;
    const speedGold = Math.max(0, goldAwarded - scoreGold - dailyBonus);
    return { scoreGold, dailyBonus, speedGold };
  };

  it("client cash-out legs sum to the server's confirmed mint (never fabricated)", () => {
    for (const [points, elapsedMs] of [[3500, 0], [3500, SPEED_WINDOW_MS], [0, 90000], [120, 45000]] as const) {
      const goldAwarded = mint(points, elapsedMs); // the server total the wire delivers
      const { scoreGold, dailyBonus, speedGold } = clientBreakdown(goldAwarded, points);
      expect(scoreGold + dailyBonus + speedGold).toBe(goldAwarded); // legs sum to the total
      expect(scoreGold).toBe(goldFromPoints(points, DAILY_GOLD_RATE));               // score leg is honest
      // The remainder leg equals the server's own wall-clock speed bonus, exactly.
      expect(speedGold).toBe(goldFromPoints(speedBonusPoints(elapsedMs), DAILY_GOLD_RATE));
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

describe("settle", () => {
  it("mints points/100 at mult 1, no extras", () => {
    const r = settle({ buyIn: 0, points: 2150, mult: 1, spends: 0, bonus: 0 });
    expect(r.minted).toBe(22); // round(21.5) banker-free: Math.round
    expect(r.earned).toBe(22);
    expect(r.payout).toBe(22);
    expect(r.net).toBe(22);
  });
  it("multiplies the minted gold (the ×N moment)", () => {
    const r = settle({ buyIn: 50, points: 2850, mult: 3, spends: 0, bonus: 25 });
    expect(r.minted).toBe(29);
    expect(r.earned).toBe(87);
    expect(r.payout).toBe(162); // 50 + 87 + 25
    expect(r.net).toBe(112);
  });
  it("default mode clamps at the house floor — buy-in is max loss", () => {
    const r = settle({ buyIn: 50, points: 720, mult: 1, spends: 70, bonus: 0 });
    expect(r.payout).toBe(0);   // raw 50+7−70 = −13 → 0
    expect(r.net).toBe(-50);
  });
  it("signed mode lets the table reach into your pocket", () => {
    const r = settle({ buyIn: 50, points: 720, mult: 1, spends: 70, bonus: 0, signed: true });
    expect(r.payout).toBe(-13);
    expect(r.net).toBe(-63);
  });
  it("never mints from negative points", () => {
    const r = settle({ buyIn: 0, points: -400, mult: 1, spends: 0, bonus: 0 });
    expect(r.minted).toBe(0);
    expect(r.payout).toBe(0);
  });
});

describe("settleParts", () => {
  it("Σparts === payout − buyIn, zero legs dropped, floor leg explains the clamp", () => {
    const r = settle({ buyIn: 50, points: 720, mult: 1, spends: 70, bonus: 0 });
    const parts = settleParts(r);
    expect(parts.reduce((s, p) => s + p.delta, 0)).toBe(r.payout - r.buyIn);
    expect(parts.map((p) => p.label)).toEqual(["score", "power-ups", "house floor"]);
  });
  it("plain phase-1 race: a single score leg", () => {
    const r = settle({ buyIn: 0, points: 2150, mult: 1, spends: 0, bonus: 0 });
    expect(settleParts(r)).toEqual([{ label: "score", delta: 22 }]);
  });
  it("bonus and mult each emit their own leg", () => {
    const r = settle({ buyIn: 50, points: 2850, mult: 3, spends: 0, bonus: 25 });
    const parts = settleParts(r);
    expect(parts.map((p) => p.label)).toEqual(["score", "bonus"]);
    expect(parts.reduce((s, p) => s + p.delta, 0)).toBe(r.payout - r.buyIn); // invariant
  });
});

describe("settle with a rate divisor", () => {
  it("mints at the given rate; default callers unchanged", () => {
    const daily = settle({ buyIn: 0, points: 2300, mult: 1, spends: 0, bonus: 145, rate: DAILY_GOLD_RATE });
    expect(daily.minted).toBe(256);
    expect(daily.payout).toBe(256 + 145);
    const race = settle({ buyIn: 0, points: 2300, mult: 1, spends: 0, bonus: 0 });
    expect(race.minted).toBe(23); // ÷100 default — races untouched
  });
});
