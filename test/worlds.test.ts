import { describe, it, expect } from "vitest";
import { EDITIONS } from "../public/editions/index.js";
import {
  WORLDS,
  listWorlds,
  featuredWorlds,
  getWorld,
  isWorldSlug,
  worldSlugFromPath,
  type WorldDef,
} from "../src/worlds.ts";

describe("worlds registry", () => {
  it("every World resolves to a real edition", () => {
    const editionIds = new Set(EDITIONS.map((e) => e.id));
    expect(WORLDS.length).toBeGreaterThan(0);
    for (const w of WORLDS) {
      expect(editionIds.has(w.editionId)).toBe(true);
      expect(w.slug).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(w.name.length).toBeGreaterThan(0);
      expect(w.blurb.length).toBeGreaterThan(0);
    }
  });

  it("slugs and ids are unique", () => {
    const slugs = WORLDS.map((w) => w.slug);
    const ids = WORLDS.map((w) => w.id);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("listWorlds is sorted by order; featuredWorlds is the featured subset", () => {
    const ordered = listWorlds();
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].order).toBeGreaterThanOrEqual(ordered[i - 1].order);
    }
    const feat = featuredWorlds();
    expect(feat.length).toBeGreaterThan(0);
    expect(feat.every((w) => w.featured)).toBe(true);
  });

  it("getWorld / isWorldSlug resolve known slugs and reject unknowns", () => {
    const first: WorldDef = WORLDS[0];
    expect(getWorld(first.slug)?.id).toBe(first.id);
    expect(getWorld("nope-not-real")).toBe(null);
    expect(getWorld(undefined)).toBe(null);
    expect(isWorldSlug(first.slug)).toBe(true);
    expect(isWorldSlug("nope-not-real")).toBe(false);
  });

  it("worldSlugFromPath extracts the slug from /w/<slug> and nothing else", () => {
    expect(worldSlugFromPath("/w/jackpot")).toBe("jackpot");
    expect(worldSlugFromPath("/w/tin-bot")).toBe("tin-bot");
    expect(worldSlugFromPath("/w/")).toBe(null);
    expect(worldSlugFromPath("/worlds")).toBe(null);
    expect(worldSlugFromPath("/@jr/room")).toBe(null);
    expect(worldSlugFromPath(undefined)).toBe(null);
  });
});

import {
  WORLDS as TWIN_WORLDS,
  listWorlds as twinListWorlds,
  featuredWorlds as twinFeaturedWorlds,
  getWorld as twinGetWorld,
  isWorldSlug as twinIsWorldSlug,
  worldSlugFromPath as twinWorldSlugFromPath,
} from "/worlds.js";

describe("worlds registry — browser twin parity", () => {
  it("public/worlds.js is byte-for-byte identical data to src/worlds.ts", () => {
    expect(TWIN_WORLDS).toEqual(WORLDS);
  });

  it("twin helpers behave identically to the server helpers", () => {
    expect(twinListWorlds()).toEqual(listWorlds());
    expect(twinFeaturedWorlds()).toEqual(featuredWorlds());
    expect(twinGetWorld("jackpot")).toEqual(getWorld("jackpot"));
    expect(twinGetWorld("nope-not-real")).toBe(getWorld("nope-not-real")); // both null
    expect(twinIsWorldSlug("jackpot")).toBe(isWorldSlug("jackpot"));
    expect(twinIsWorldSlug("nope-not-real")).toBe(isWorldSlug("nope-not-real"));
    expect(twinWorldSlugFromPath("/w/tin-bot")).toBe(worldSlugFromPath("/w/tin-bot"));
    expect(twinWorldSlugFromPath("/worlds")).toBe(worldSlugFromPath("/worlds")); // both null
  });
});
