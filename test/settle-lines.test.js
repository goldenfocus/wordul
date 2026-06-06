import { describe, it, expect } from "vitest";
import { receiptLines } from "../public/settle.js";

const receipt = (over = {}) => ({
  buyIn: 0, points: 2150, minted: 22, mult: 1, earned: 22,
  spends: 0, bonus: 0, payout: 22, net: 22, signed: false, ...over,
});

describe("receiptLines", () => {
  it("phase-1 race: mint line + payout line only (zero legs dropped)", () => {
    const lines = receiptLines(receipt());
    expect(lines).toEqual([
      { key: "mint", text: "2,150 pts → ◆ 22", tone: "gain" },
      { key: "payout", text: "◆ 22 to your wallet · net +22", tone: "gain" },
    ]);
  });
  it("mult, spends, bonus and the house floor each get a line", () => {
    const lines = receiptLines(receipt({ buyIn: 50, mult: 3, earned: 66, spends: 90, bonus: 10, payout: 36, net: -14 }));
    expect(lines.map((l) => l.key)).toEqual(["mint", "mult", "spends", "bonus", "payout"]);
    expect(lines.find((l) => l.key === "mult").text).toContain("×3");
    expect(lines.find((l) => l.key === "payout").tone).toBe("loss");
  });
  it("bust reads as the house floor", () => {
    const lines = receiptLines(receipt({ buyIn: 50, spends: 90, payout: 0, net: -50 }));
    expect(lines.find((l) => l.key === "payout").text).toContain("◆ 0");
  });
});
