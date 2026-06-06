import { describe, it, expect } from "vitest";
import { WORLDS, type WorldDef } from "../src/worlds.ts";
import { mergeWorlds, EMPTY_OVERRIDES, type WorldOverrides } from "../src/world-overrides.ts";

const base: WorldDef[] = [
  { id: "a", slug: "a", name: "A", blurb: "ba", editionId: "default", featured: true,  order: 0 },
  { id: "b", slug: "b", name: "B", blurb: "bb", editionId: "yang",    featured: false, order: 1 },
];

describe("mergeWorlds", () => {
  it("returns the base list (sorted) when overrides are empty", () => {
    expect(mergeWorlds(base, EMPTY_OVERRIDES).map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("applies field edits but never changes a base world's id", () => {
    const ov: WorldOverrides = { edits: { a: { name: "AA", id: "hacked" } as any }, added: [], deleted: [] };
    const out = mergeWorlds(base, ov);
    expect(out.find((w) => w.id === "a")!.name).toBe("AA");
    expect(out.map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("drops deleted base worlds (tombstone)", () => {
    const ov: WorldOverrides = { edits: {}, added: [], deleted: ["a"] };
    expect(mergeWorlds(base, ov).map((w) => w.id)).toEqual(["b"]);
  });

  it("appends added worlds and re-sorts by order", () => {
    const added: WorldDef = { id: "c", slug: "c", name: "C", blurb: "bc", editionId: "default", featured: false, order: -1 };
    const ov: WorldOverrides = { edits: {}, added: [added], deleted: [] };
    expect(mergeWorlds(base, ov).map((w) => w.id)).toEqual(["c", "a", "b"]);
  });

  it("real launch worlds survive an empty merge unchanged", () => {
    expect(mergeWorlds(WORLDS, EMPTY_OVERRIDES).length).toBe(WORLDS.length);
  });
});
