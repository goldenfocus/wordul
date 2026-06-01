// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { GOLD, comboMultiplier, playPayoutSequence } from "/gold.js";
import { getGold, setGold } from "/edition.js";

// Build the discovery shape app.js hands to playPayoutSequence: yellows first, then
// greens, value attached. value = GOLD.green for greens, GOLD.yellow for yellows.
function discoveries(ng, ny) {
  const out = [];
  for (let i = 0; i < ny; i++) out.push({ index: i, kind: "yellow", letter: "A", value: GOLD.yellow });
  for (let i = 0; i < ng; i++) out.push({ index: i, kind: "green", letter: "B", value: GOLD.green });
  return out;
}

// The old lump the staged payout must match exactly.
const oldLump = (ng, ny) =>
  Math.round((ng * GOLD.green + ny * GOLD.yellow) * comboMultiplier(ng + ny));

describe("playPayoutSequence — gold-sum invariant (no double-award, no drift)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setGold(0);
  });

  // reducedMotion path is synchronous → easiest to assert the total.
  const cases = [
    [1, 0], // single green, mult 1
    [0, 1], // single yellow, mult 1
    [2, 0], // 2 greens → 1.5×
    [1, 1], // 1g + 1y → 1.5×
    [3, 0], // 3 greens → 2×
    [2, 1], // → 2×
    [0, 5], // 5 yellows → 3×
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
    expect(getGold()).toBe(GOLD.green);
  });

  it("per-beat ticks are integers summing to base; the bonus is round(base*mult)-base", async () => {
    // 3g+2y, mult 3: base = 3*100 + 2*50 = 400; total = round(400*3) = 1200; bonus = 800.
    const ng = 3, ny = 2;
    const base = ng * GOLD.green + ny * GOLD.yellow;
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
    expect(seen).toEqual([0, 0]); // one getTile call per discovery (yellow idx0, green idx0)
  });
});
