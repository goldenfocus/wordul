// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { GOLD, isBankrupt, BANKRUPTCY_THRESHOLD } from "/gold.js";
import {
  affordablePowerups,
  cheapestAvailableCost,
  shouldShowMagic,
  isStuck,
  bumpErrorCount,
  giveUp,
  checkBankruptcy,
  STUCK_ERROR_THRESHOLD,
  resetPowerHints,
} from "../public/powerups.js";
import { VANILLA, WILD } from "/lane.js";

// A fresh round's power-up state: nothing revealed, vowel count unknown.
const freshState = () => ({ revealed: [], vowels: null });
const snap = (over = {}) => ({ phase: "playing", wordLength: 5, ...over });
const me = (over = {}) => ({ status: "playing", ...over });

describe("affordablePowerups", () => {
  it("returns nothing when you can't afford the cheapest power-up", () => {
    expect(affordablePowerups(0, freshState(), snap())).toEqual([]);
    expect(affordablePowerups(GOLD.vowelCost - 1, freshState(), snap())).toEqual([]);
  });
  it("returns only the vowel power-up when you can afford it but not a reveal", () => {
    const list = affordablePowerups(GOLD.vowelCost, freshState(), snap());
    expect(list.map((p) => p.id)).toEqual(["vowel"]);
  });
  it("returns both when you can afford a reveal", () => {
    const list = affordablePowerups(GOLD.revealCost, freshState(), snap());
    expect(list.map((p) => p.id).sort()).toEqual(["reveal", "vowel"]);
  });
  it("excludes the vowel power-up once the count is already known", () => {
    const list = affordablePowerups(GOLD.revealCost, { revealed: [], vowels: 2 }, snap());
    expect(list.map((p) => p.id)).toEqual(["reveal"]);
  });
  it("excludes reveal once every slot is known", () => {
    const allKnown = { revealed: [0, 1, 2, 3, 4].map((index) => ({ index, letter: "A" })), vowels: null };
    const list = affordablePowerups(GOLD.revealCost, allKnown, snap());
    expect(list.map((p) => p.id)).toEqual(["vowel"]);
  });
});

describe("cheapestAvailableCost", () => {
  it("is the vowel cost (the cheaper power-up) on a fresh round", () => {
    expect(cheapestAvailableCost(freshState(), snap())).toBe(GOLD.vowelCost);
  });
  it("falls back to the reveal cost once the vowel count is known", () => {
    expect(cheapestAvailableCost({ revealed: [], vowels: 3 }, snap())).toBe(GOLD.revealCost);
  });
  it("is null when no power-up is still buyable this round", () => {
    const allKnown = { revealed: [0, 1, 2, 3, 4].map((index) => ({ index, letter: "A" })), vowels: 7 };
    expect(cheapestAvailableCost(allKnown, snap())).toBe(null);
  });
});

describe("shouldShowMagic (✨ hide-unaffordable gate)", () => {
  it("hidden when gold is below the cheapest available power-up", () => {
    expect(shouldShowMagic(GOLD.vowelCost - 1, freshState(), snap(), me())).toBe(false);
  });
  it("shown once gold reaches the cheapest available power-up", () => {
    expect(shouldShowMagic(GOLD.vowelCost, freshState(), snap(), me())).toBe(true);
  });
  it("hidden when no power-up remains buyable, even with infinite gold", () => {
    const allKnown = { revealed: [0, 1, 2, 3, 4].map((index) => ({ index, letter: "A" })), vowels: 7 };
    expect(shouldShowMagic(999999, allKnown, snap(), me())).toBe(false);
  });
  it("hidden outside an active playing turn", () => {
    expect(shouldShowMagic(GOLD.revealCost, freshState(), snap({ phase: "lobby" }), me())).toBe(false);
    expect(shouldShowMagic(GOLD.revealCost, freshState(), snap(), me({ status: "won" }))).toBe(false);
    expect(shouldShowMagic(GOLD.revealCost, freshState(), null, me())).toBe(false);
    expect(shouldShowMagic(GOLD.revealCost, freshState(), snap(), null)).toBe(false);
  });
  it("hidden in the Vanilla lane even with plenty of gold (Gate A)", () => {
    expect(shouldShowMagic(GOLD.revealCost, freshState(), snap({ ruleset: VANILLA }), me())).toBe(false);
  });
  it("shown in the Wild lane, and when ruleset is absent (legacy → Wild)", () => {
    expect(shouldShowMagic(GOLD.revealCost, freshState(), snap({ ruleset: WILD }), me())).toBe(true);
    expect(shouldShowMagic(GOLD.revealCost, freshState(), snap(), me())).toBe(true);
  });
});

// --- C4: 💀 give-up + bankruptcy ---

describe("isBankrupt (Hard-Mode-only death floor)", () => {
  it("fires in Hard Mode once gold sinks past the threshold", () => {
    expect(isBankrupt(BANKRUPTCY_THRESHOLD, true)).toBe(true);
    expect(isBankrupt(BANKRUPTCY_THRESHOLD - 100, true)).toBe(true);
  });
  it("does not fire while still above the threshold, even negative", () => {
    expect(isBankrupt(BANKRUPTCY_THRESHOLD + 1, true)).toBe(false);
    expect(isBankrupt(-10, true)).toBe(false);
  });
  it("never fires in normal mode, no matter how negative", () => {
    expect(isBankrupt(BANKRUPTCY_THRESHOLD, false)).toBe(false);
    expect(isBankrupt(-99999, false)).toBe(false);
  });
});

describe("isStuck (💀 surface trigger)", () => {
  it("is stuck when the idle timer flagged it", () => {
    expect(isStuck({ stuck: true, errorCount: 0 })).toBe(true);
  });
  it("is stuck once errors reach the threshold", () => {
    expect(isStuck({ stuck: false, errorCount: STUCK_ERROR_THRESHOLD - 1 })).toBe(false);
    expect(isStuck({ stuck: false, errorCount: STUCK_ERROR_THRESHOLD })).toBe(true);
  });
  it("is not stuck on a fresh round", () => {
    expect(isStuck({ stuck: false, errorCount: 0 })).toBe(false);
    expect(isStuck({})).toBe(false);
  });
});

// A minimal ctx for the side-effecting give-up / bankruptcy / error functions.
// getElementById is null-safe (no DOM here), so renderGiveUp/surfaceGiveUp are no-ops.
const makeCtx = (over = {}) => {
  const game = {
    snapshot: { phase: "playing", word: "CRANE", players: [{ username: "me", status: "playing" }] },
    hasShownEndStats: false,
    stuck: false,
    errorCount: 0,
    ...over.game,
  };
  return {
    game,
    getUsername: () => "me",
    getGold: over.getGold ?? (() => 0),
    getSettings: over.getSettings ?? (() => ({ hardMode: false })),
    forfeit: over.forfeit ?? vi.fn(),
    renderGoldHud: () => {},
  };
};

describe("bumpErrorCount", () => {
  it("increments the per-round error counter", () => {
    const ctx = makeCtx();
    bumpErrorCount(ctx);
    expect(ctx.game.errorCount).toBe(1);
  });
  it("flags stuck once the error threshold trips", () => {
    const ctx = makeCtx({ game: { errorCount: STUCK_ERROR_THRESHOLD - 1 } });
    bumpErrorCount(ctx);
    expect(isStuck(ctx.game)).toBe(true);
  });
});

describe("giveUp (any mode → forfeit 'gave_up')", () => {
  it("forfeits with reason gave_up while playing", () => {
    const forfeit = vi.fn();
    giveUp(makeCtx({ forfeit }));
    expect(forfeit).toHaveBeenCalledWith("gave_up");
  });
  it("is a no-op once the end screen has shown", () => {
    const forfeit = vi.fn();
    giveUp(makeCtx({ forfeit, game: { hasShownEndStats: true } }));
    expect(forfeit).not.toHaveBeenCalled();
  });
  it("is a no-op when it's not my turn", () => {
    const forfeit = vi.fn();
    giveUp(makeCtx({
      forfeit,
      game: { snapshot: { phase: "playing", players: [{ username: "me", status: "lost" }] } },
    }));
    expect(forfeit).not.toHaveBeenCalled();
  });
});

describe("💀 DOM wiring (surface + tap to give up)", () => {
  it("surfaces the 💀 button after enough errors and a tap forfeits gave_up", () => {
    document.body.innerHTML = `<button id="giveUpBtn" hidden>💀</button>`;
    const btn = document.getElementById("giveUpBtn");
    const forfeit = vi.fn();
    const ctx = makeCtx({ forfeit });
    expect(btn.hidden).toBe(true);
    bumpErrorCount(ctx); bumpErrorCount(ctx); bumpErrorCount(ctx); // reaches STUCK_ERROR_THRESHOLD (3)
    expect(btn.hidden).toBe(false);
    btn.click();
    expect(forfeit).toHaveBeenCalledWith("gave_up");
  });
});

describe("checkBankruptcy (Hard Mode only → forfeit 'bankrupt')", () => {
  it("forfeits in Hard Mode once past the threshold", () => {
    const forfeit = vi.fn();
    checkBankruptcy(makeCtx({
      forfeit,
      getGold: () => BANKRUPTCY_THRESHOLD - 50,
      getSettings: () => ({ hardMode: true }),
    }));
    expect(forfeit).toHaveBeenCalledWith("bankrupt");
  });
  it("never forfeits in normal mode, even deeply negative", () => {
    const forfeit = vi.fn();
    checkBankruptcy(makeCtx({
      forfeit,
      getGold: () => -99999,
      getSettings: () => ({ hardMode: false }),
    }));
    expect(forfeit).not.toHaveBeenCalled();
  });
  it("does not forfeit while still above the Hard-Mode threshold", () => {
    const forfeit = vi.fn();
    checkBankruptcy(makeCtx({
      forfeit,
      getGold: () => BANKRUPTCY_THRESHOLD + 1,
      getSettings: () => ({ hardMode: true }),
    }));
    expect(forfeit).not.toHaveBeenCalled();
  });
});

describe("resetPowerHints", () => {
  it("clears the per-round rejection memory along with stuck/error state", () => {
    const game = {
      stuck: true, errorCount: 4,
      lastRejected: { word: "THESS", reason: "not in word list" },
    };
    resetPowerHints(game, 2);
    expect(game.stuck).toBe(false);
    expect(game.errorCount).toBe(0);
    expect(game.lastRejected).toBe(null);
    expect(game.ezRound).toBe(2);
  });
});
