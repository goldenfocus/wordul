import { describe, it, expect } from "vitest";
import { typingHints } from "/hints.js";

// mask shorthand: g=hot(green) y=warm(yellow) x=cold(gray) — same helper style as penalties.test.js
const g = (word, m) => ({
  word,
  mask: [...m].map((c) => (c === "g" ? "hot" : c === "y" ? "warm" : "cold")),
});

describe("typingHints", () => {
  it("returns null hints on an empty board (nothing proven yet)", () => {
    expect(typingHints("CRANE", [])).toEqual([null, null, null, null, null]);
  });

  it("flags a proven-dead letter as dead", () => {
    const prior = [g("CRANE", "xxxxx")]; // C,R,A,N,E all proven absent
    expect(typingHints("CLOUD", prior)).toEqual(["dead", null, null, null, null]);
  });

  it("confirms a green only at its proven column", () => {
    const prior = [g("CRANE", "xgxxx")]; // R proven hot at col 1
    // R typed at col 1 → confirmed; R typed elsewhere → present (in word, slot unproven)
    expect(typingHints("BRAVO", prior)).toEqual([null, "confirmed", "dead", null, null]);
    expect(typingHints("ROBIN", prior)).toEqual(["present", null, null, null, "dead"]);
  });

  it("marks a proven-present (yellow) letter as present at ANY column — even its old yellow column", () => {
    const prior = [g("CRANE", "xxyxx")]; // A warm at col 2: in word, not at col 2
    // honest-claims rule: the dot only says "this letter is in the word"
    expect(typingHints("ALOHA", prior)).toEqual(["present", null, null, null, "present"]);
    expect(typingHints("STAIR", prior)).toEqual([null, null, "present", null, "dead"]); // col 2 still shows the dot
  });

  it("is dup-letter safe: a letter green somewhere is never dead (EERIE-style)", () => {
    const prior = [g("EERIE", "gxxxx")]; // first E hot → E present, not dead, despite cold E's
    const hints = typingHints("EVENT", prior);
    expect(hints[0]).toBe("confirmed"); // E at col 0 proven green
    expect(hints[2]).toBe("present");   // E elsewhere: in word
    expect(hints).not.toContain("dead");
  });

  it("upgrades yellow→green: the green column confirms, other columns stay present", () => {
    const prior = [g("CRANE", "xxyxx"), g("ALOHA", "gxxxx")]; // A warm@2 then hot@0
    expect(typingHints("ABBEY", prior)[0]).toBe("confirmed");
    expect(typingHints("OCTAL", prior)[3]).toBe("present");
  });

  it("handles a pending word shorter than the row (only typed columns get hints)", () => {
    const prior = [g("CRANE", "xxxxx")];
    expect(typingHints("CR", prior)).toEqual(["dead", "dead"]);
  });

  it("dead and present can coexist in one pending word", () => {
    const prior = [g("CRANE", "xyxxx")]; // C dead, R present
    expect(typingHints("CURRY", prior)).toEqual(["dead", null, "present", "present", null]);
  });

  it("is case-insensitive on the pending input", () => {
    const prior = [g("CRANE", "xxxxx")];
    expect(typingHints("cr", prior)).toEqual(["dead", "dead"]);
  });
});
