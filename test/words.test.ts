import { describe, it, expect } from "vitest";
import { isWordPage, slugFor, wordFromSlug, wordOfTheDay, ANSWER_WORDS } from "../src/words.ts";

describe("word helpers", () => {
  it("has the full 5-letter answer set", () => {
    expect(ANSWER_WORDS.size).toBe(2315);
    expect(ANSWER_WORDS.has("OCEAN")).toBe(true);
  });
  it("isWordPage is true for an answer word, false for non-answers", () => {
    expect(isWordPage("ocean")).toBe(true);
    expect(isWordPage("OCEAN")).toBe(true);
    expect(isWordPage("zzzzz")).toBe(false);
  });
  it("slug round-trips lowercase", () => {
    expect(slugFor("OCEAN")).toBe("ocean");
    expect(wordFromSlug("ocean")).toBe("OCEAN");
  });
  it("wordOfTheDay is deterministic for a date and is an answer word", () => {
    const w = wordOfTheDay(new Date("2026-06-04T00:00:00Z"));
    expect(ANSWER_WORDS.has(w)).toBe(true);
    expect(wordOfTheDay(new Date("2026-06-04T23:59:00Z"))).toBe(w);
  });
});
