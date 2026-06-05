// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { wireCardArt, aiLookupHref } from "/endcard.js";

// End-game word card dedup: the OG tile art shows the word (tiles) and the definition
// (tagline), so once the art has LOADED the duplicate text hides. Until then the text
// stays visible — on a slow connection the old "hide immediately, restore on error"
// contract left the panel blank for the whole load (the empty THE WORD bug, Jun 5).
// New contract: text is the default, art replaces it only when it actually paints.
function setup() {
  const preview = document.createElement("img");
  const big = document.createElement("div");
  const def = document.createElement("div");
  document.body.append(preview, big, def);
  return { preview, big, def };
}

describe("wireCardArt", () => {
  it("keeps the text visible at wire time (art not loaded yet)", () => {
    const { preview, big, def } = setup();
    wireCardArt(preview, [big, def]);
    expect(big.classList.contains("ewc-text-fallback")).toBe(false);
    expect(def.classList.contains("ewc-text-fallback")).toBe(false);
    expect(document.body.contains(preview)).toBe(true);
  });

  it("hides the duplicate text once the art actually loads", () => {
    const { preview, big, def } = setup();
    wireCardArt(preview, [big, def]);
    preview.dispatchEvent(new Event("load"));
    expect(big.classList.contains("ewc-text-fallback")).toBe(true);
    expect(def.classList.contains("ewc-text-fallback")).toBe(true);
  });

  it("hides the text immediately when the art is already cached (complete)", () => {
    const { preview, big, def } = setup();
    Object.defineProperty(preview, "complete", { value: true });
    Object.defineProperty(preview, "naturalWidth", { value: 1200 });
    wireCardArt(preview, [big, def]);
    expect(big.classList.contains("ewc-text-fallback")).toBe(true);
    expect(def.classList.contains("ewc-text-fallback")).toBe(true);
  });

  it("on image error: removes the art and the text stays", () => {
    const { preview, big, def } = setup();
    wireCardArt(preview, [big, def]);
    preview.dispatchEvent(new Event("error"));
    expect(document.body.contains(preview)).toBe(false);
    expect(big.classList.contains("ewc-text-fallback")).toBe(false);
    expect(def.classList.contains("ewc-text-fallback")).toBe(false);
  });

  it("on error after a load already fired: text comes back", () => {
    const { preview, big, def } = setup();
    wireCardArt(preview, [big, def]);
    preview.dispatchEvent(new Event("load"));
    preview.dispatchEvent(new Event("error"));
    expect(document.body.contains(preview)).toBe(false);
    expect(big.classList.contains("ewc-text-fallback")).toBe(false);
  });

  it("tolerates an empty element list (never throws)", () => {
    const { preview } = setup();
    expect(() => {
      wireCardArt(preview, []);
      preview.dispatchEvent(new Event("load"));
      preview.dispatchEvent(new Event("error"));
    }).not.toThrow();
    expect(document.body.contains(preview)).toBe(false);
  });
});

// When the dictionary has no entry, "Look it up" hands off to Google AI Mode with the
// SAME curated prompt the word-wiki pages use ("Continue with AI ✦" in
// scripts/lib/word-page.mjs) — instead of linking to a /word/<w> page that may not exist.
describe("aiLookupHref", () => {
  it("builds a Google AI Mode (udm=50) link with the wiki's curated prompt", () => {
    const href = aiLookupHref("look");
    expect(href.startsWith("https://www.google.com/search?udm=50&q=")).toBe(true);
    const prompt = new URL(href).searchParams.get("q");
    // Prompt parity with scripts/lib/word-page.mjs — uppercased word, same framing.
    expect(prompt).toBe(
      `Tell me something surprising about the word "LOOK" — where it comes from, how its meaning has shifted over the centuries, and a cool way it's used today.`,
    );
  });
});
