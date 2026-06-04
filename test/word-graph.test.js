import { describe, it, expect } from "vitest";
import { buildWordGraph } from "../scripts/lib/word-graph.mjs";

const WORDS = ["OCEAN", "CANOE", "OCEAS", "OCEAR", "OCTAL", "OBEAN"];

describe("buildWordGraph", () => {
  const g = buildWordGraph(WORDS);
  it("finds anagrams (same letters, excluding self)", () => {
    expect(g.get("OCEAN").anagrams.sort()).toEqual(["CANOE"]);
  });
  it("finds ±1-letter ladder neighbors", () => {
    expect(g.get("OCEAN").ladder.sort()).toEqual(["OBEAN", "OCEAR", "OCEAS"]);
  });
  it("finds shared-start words (same first 2 letters, excluding self)", () => {
    expect(g.get("OCEAN").sharedStart).toContain("OCEAS");
    expect(g.get("OCEAN").sharedStart).not.toContain("OCEAN");
    expect(g.get("OCEAN").sharedStart).not.toContain("CANOE");
  });
  it("caps each list", () => {
    for (const v of g.values()) {
      expect(v.anagrams.length).toBeLessThanOrEqual(12);
      expect(v.ladder.length).toBeLessThanOrEqual(12);
      expect(v.sharedStart.length).toBeLessThanOrEqual(12);
    }
  });
});
