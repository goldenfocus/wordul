import { describe, it, expect } from "vitest";
import { renderWordPage } from "../scripts/lib/word-page.mjs";

const intel = {
  def: "A vast body of salt water.",
  fact: "Holds 97% of Earth's water.",
  quote: "We are tied to the ocean.",
  author: "John F. Kennedy",
  etymology: "From Greek Okeanos.",
  pos: "noun",
  syllables: 2,
};
const graph = { anagrams: ["CANOE"], ladder: ["OCEAS"], sharedStart: ["OCTAL"] };

describe("renderWordPage", () => {
  const html = renderWordPage("OCEAN", intel, graph, "https://wordul.com");
  it("is a full document with the word in title + h1", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("What does &quot;OCEAN&quot; mean?");
    expect(html).toMatch(/<h1[^>]*>OCEAN<\/h1>/);
  });
  it("includes definition, fact, quote, etymology", () => {
    expect(html).toContain("A vast body of salt water.");
    expect(html).toContain("Holds 97% of Earth's water.");
    expect(html).toContain("John F. Kennedy");
    expect(html).toContain("From Greek Okeanos.");
  });
  it("links related words to their pages", () => {
    expect(html).toContain('href="/word/canoe"');
    expect(html).toContain('href="/word/oceas"');
  });
  it("emits canonical, OG image, and JSON-LD", () => {
    expect(html).toContain('rel="canonical" href="https://wordul.com/word/ocean"');
    expect(html).toContain('content="https://wordul.com/word/og/ocean.png"');
    expect(html).toContain('"@type":"DefinedTerm"');
    expect(html).toContain('"@type":"FAQPage"');
  });
  it("omits the quote block entirely when no quote", () => {
    const noQuote = renderWordPage("CANOE", { def: "A boat.", fact: "Old." }, graph, "https://wordul.com");
    expect(noQuote).not.toContain("<blockquote");
  });
});
