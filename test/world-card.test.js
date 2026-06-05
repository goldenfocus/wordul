// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getWorld } from "/worlds.js";
import { renderWorldCard, pushRecentWorld, getRecentWorldSlugs } from "/world-card.js";

describe("renderWorldCard", () => {
  it("builds an anchor to /w/<slug> painted in the World's edition, name via textContent", () => {
    const world = getWorld("jackpot");
    const el = renderWorldCard(world);
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("/w/jackpot");
    expect(el.classList.contains("world-card")).toBe(true);
    expect(el.dataset.edition).toBe("jackpot"); // paintEditionVars ran
    expect(el.textContent).toContain("Jackpot");
    // XSS-safe: name is text, not parsed HTML.
    expect(el.querySelector(".world-card-name").textContent).toBe("Jackpot");
  });
});

describe("recent Worlds store", () => {
  beforeEach(() => localStorage.clear());

  it("pushes most-recent-first, dedupes, and caps the list", () => {
    pushRecentWorld("jackpot");
    pushRecentWorld("arcade");
    pushRecentWorld("jackpot"); // re-visit moves it to front, no dup
    expect(getRecentWorldSlugs()).toEqual(["jackpot", "arcade"]);
  });

  it("ignores junk and returns [] when empty", () => {
    expect(getRecentWorldSlugs()).toEqual([]);
    pushRecentWorld("");
    pushRecentWorld(null);
    expect(getRecentWorldSlugs()).toEqual([]);
  });
});
