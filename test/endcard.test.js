// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { wireCardArt } from "/endcard.js";

// End-game word card dedup: the OG tile art already shows the word (tiles) and the
// definition (tagline), so the duplicate text starts hidden and only returns when
// the art can't load. These tests lock the "image is hero, text is parachute" contract.
function setup() {
  const preview = document.createElement("img");
  const big = document.createElement("div");
  const def = document.createElement("div");
  document.body.append(preview, big, def);
  return { preview, big, def };
}

describe("wireCardArt", () => {
  it("hides the duplicate text while the card art is the hero", () => {
    const { preview, big, def } = setup();
    wireCardArt(preview, [big, def]);
    expect(big.classList.contains("ewc-text-fallback")).toBe(true);
    expect(def.classList.contains("ewc-text-fallback")).toBe(true);
    expect(document.body.contains(preview)).toBe(true);
  });

  it("on image error: removes the art and brings the text back", () => {
    const { preview, big, def } = setup();
    wireCardArt(preview, [big, def]);
    preview.dispatchEvent(new Event("error"));
    expect(document.body.contains(preview)).toBe(false);
    expect(big.classList.contains("ewc-text-fallback")).toBe(false);
    expect(def.classList.contains("ewc-text-fallback")).toBe(false);
  });

  it("tolerates an empty element list (never throws)", () => {
    const { preview } = setup();
    expect(() => {
      wireCardArt(preview, []);
      preview.dispatchEvent(new Event("error"));
    }).not.toThrow();
    expect(document.body.contains(preview)).toBe(false);
  });
});
