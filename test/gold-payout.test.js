// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { GOLD, comboMultiplier, playPayoutSequence } from "/gold.js";
import { getGold, setGold } from "/edition.js";

// Build the discovery shape app.js hands to playPayoutSequence: warms first, then
// hots, value attached. value = GOLD.hot for hots, GOLD.warm for warms.
function discoveries(ng, ny) {
  const out = [];
  for (let i = 0; i < ny; i++) out.push({ index: i, kind: "warm", letter: "A", value: GOLD.warm });
  for (let i = 0; i < ng; i++) out.push({ index: i, kind: "hot", letter: "B", value: GOLD.hot });
  return out;
}

// The old lump the staged payout must match exactly.
const oldLump = (ng, ny) =>
  Math.round((ng * GOLD.hot + ny * GOLD.warm) * comboMultiplier(ng + ny));

describe("playPayoutSequence — gold-sum invariant (no double-award, no drift)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setGold(0);
  });

  // reducedMotion path is synchronous → easiest to assert the total.
  const cases = [
    [1, 0], // single hot, mult 1
    [0, 1], // single warm, mult 1
    [2, 0], // 2 hots → 1.5×
    [1, 1], // 1g + 1y → 1.5×
    [3, 0], // 3 hots → 2×
    [2, 1], // → 2×
    [0, 5], // 5 warms → 3×
    [3, 2], // → 3×
  ];

  for (const [ng, ny] of cases) {
    it(`reducedMotion awards exactly the old lump for ${ng}g/${ny}y`, async () => {
      setGold(1000);
      const before = getGold();
      await playPayoutSequence({
        discoveries: discoveries(ng, ny),
        mult: comboMultiplier(ng + ny),
        reducedMotion: true,
      });
      expect(getGold() - before).toBe(oldLump(ng, ny));
    });
  }

  it("sequenced (non-reducedMotion) path awards the identical total", async () => {
    setGold(500);
    const before = getGold();
    const ng = 2, ny = 1; // mult 2 → combo finale present
    await playPayoutSequence({
      discoveries: discoveries(ng, ny),
      mult: comboMultiplier(ng + ny),
      reducedMotion: false,
    });
    expect(getGold() - before).toBe(oldLump(ng, ny));
  });

  it("sequenced single discovery (no combo) awards just the base", async () => {
    setGold(0);
    await playPayoutSequence({
      discoveries: discoveries(1, 0),
      mult: comboMultiplier(1),
      reducedMotion: false,
    });
    expect(getGold()).toBe(GOLD.hot);
  });

  it("per-beat ticks are integers summing to base; the bonus is round(base*mult)-base", async () => {
    // 3g+2y, mult 3: base = 3*100 + 2*50 = 400; total = round(400*3) = 1200; bonus = 800.
    const ng = 3, ny = 2;
    const base = ng * GOLD.hot + ny * GOLD.warm;
    const total = oldLump(ng, ny);
    expect(base).toBe(400);
    expect(total).toBe(1200);
    expect(total - base).toBe(800);
    setGold(0);
    await playPayoutSequence({
      discoveries: discoveries(ng, ny),
      mult: comboMultiplier(ng + ny),
      reducedMotion: false,
    });
    expect(getGold()).toBe(total);
  });

  it("empty discoveries award nothing", async () => {
    setGold(123);
    await playPayoutSequence({ discoveries: [], mult: 1, reducedMotion: true });
    expect(getGold()).toBe(123);
  });

  it("daily wallet adapter: round score takes the total, the persistent wallet is untouched", async () => {
    // §A: in a daily, discoveries must drive an EPHEMERAL round-score counter, never the
    // sacred gold wallet. The caller hands playPayoutSequence a `wallet` adapter; the
    // sequence reads/writes through it and ticks the passed hud — getGold() must not move.
    setGold(5000);
    const walletBefore = getGold();
    let score = 0;
    const wallet = { get: () => score, add: (d) => { score += d; }, drain: (d) => { score -= d; } };
    const hud = document.createElement("div");
    document.body.appendChild(hud);
    const ng = 2, ny = 1; // mult 2 → combo finale present
    await playPayoutSequence({
      discoveries: discoveries(ng, ny),
      mult: comboMultiplier(ng + ny),
      hud,
      wallet,
      reducedMotion: false,
    });
    expect(score).toBe(oldLump(ng, ny)); // the round score got the full total
    expect(getGold()).toBe(walletBefore); // the persistent gold wallet never moved
  });

  it("daily wallet adapter (reducedMotion) also leaves the wallet untouched", async () => {
    setGold(5000);
    const walletBefore = getGold();
    let score = 0;
    const wallet = { get: () => score, add: (d) => { score += d; }, drain: (d) => { score -= d; } };
    await playPayoutSequence({
      discoveries: discoveries(3, 2),
      mult: comboMultiplier(5),
      wallet,
      reducedMotion: true,
    });
    expect(score).toBe(oldLump(3, 2));
    expect(getGold()).toBe(walletBefore);
  });

  it("F5: the visible +N numbers in the log lines sum to the guess's real delta", async () => {
    // §E GOLD-SUM display contract: the combo finale must read as a delta/total, not an
    // increment that double-counts the base. Parse every visible "+N" from the emitted
    // log lines; their sum MUST equal the real total awarded (round(base*mult)).
    const lines = [];
    const log = { logLine: (t) => lines.push(t), addInstant: (t) => lines.push(t) };
    const ng = 3, ny = 2; // base 400, mult 3, total 1200, bonus 800
    setGold(0);
    await playPayoutSequence({
      discoveries: discoveries(ng, ny),
      mult: comboMultiplier(ng + ny),
      log,
      reducedMotion: false,
    });
    const visibleSum = lines
      .flatMap((l) => [...String(l).matchAll(/\+(\d+)/g)].map((m) => Number(m[1])))
      .reduce((s, n) => s + n, 0);
    expect(visibleSum).toBe(oldLump(ng, ny)); // 1200, not 400+1200
    expect(getGold()).toBe(oldLump(ng, ny));  // balance still exactly the total
  });

  it("invokes the log + getTile hooks per beat and a combo finale for >=2", async () => {
    const lines = [];
    const log = { logLine: (t, o) => lines.push({ t, o }), addInstant: (t, o) => lines.push({ t, o }) };
    const seen = [];
    const getTile = (i) => { seen.push(i); return null; };
    await playPayoutSequence({
      discoveries: discoveries(1, 1), // 1y + 1g → 2 discoveries → combo finale
      mult: comboMultiplier(2),
      log,
      getTile,
      reducedMotion: false,
    });
    // 2 beat lines + 1 combo finale line.
    expect(lines.length).toBe(3);
    expect(lines[lines.length - 1].o.tone).toBe("combo");
    expect(seen).toEqual([0, 0]); // one getTile call per discovery (warm idx0, hot idx0)
  });
});
