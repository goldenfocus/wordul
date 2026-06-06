// test/worlds-client.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { WORLDS, listWorlds, getWorld, hydrateWorlds } from "/worlds.js";

describe("worlds.js hydration", () => {
  beforeEach(() => hydrateWorlds(WORLDS)); // reset to base between tests

  it("listWorlds reflects a hydrated list", () => {
    hydrateWorlds([
      { id: "z", slug: "zed", name: "Zed", blurb: "b", editionId: "default", featured: true, order: 0 },
    ]);
    expect(listWorlds().map((w) => w.slug)).toEqual(["zed"]);
    expect(getWorld("zed").name).toBe("Zed");
  });

  it("getWorld stops resolving slugs that were hydrated away", () => {
    hydrateWorlds([]);
    expect(getWorld("wordul")).toBe(null);
  });

  it("ignores a non-array payload (keeps current list)", () => {
    hydrateWorlds(null);
    expect(listWorlds().length).toBe(WORLDS.length);
  });
});
