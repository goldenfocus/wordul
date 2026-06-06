// test/studio-worlds-core.test.js
import { describe, it, expect } from "vitest";
import { addWorld, removeWorld, moveWorld, updateField, buildOverrides } from "/studio-worlds-core.js";

const base = [
  { id: "a", slug: "a", name: "A", blurb: "ba", editionId: "default", featured: true,  order: 0 },
  { id: "b", slug: "b", name: "B", blurb: "bb", editionId: "yang",    featured: false, order: 1 },
];

describe("studio-worlds-core", () => {
  it("updateField returns a new list with one field changed", () => {
    const out = updateField(base, "a", "name", "AA");
    expect(out.find((w) => w.id === "a").name).toBe("AA");
    expect(base.find((w) => w.id === "a").name).toBe("A"); // immutable input
  });

  it("addWorld appends a new world with a derived id and next order", () => {
    const out = addWorld(base, { slug: "c", name: "C", editionId: "default" });
    const added = out.find((w) => w.slug === "c");
    expect(added).toBeTruthy();
    expect(added.order).toBe(2);
    expect(added.id).toBeTruthy();
  });

  it("removeWorld drops by id", () => {
    expect(removeWorld(base, "a").map((w) => w.id)).toEqual(["b"]);
  });

  it("moveWorld swaps order with the neighbor", () => {
    const out = moveWorld(base, "b", -1); // move b up
    expect(out.find((w) => w.id === "b").order).toBeLessThan(out.find((w) => w.id === "a").order);
  });

  it("buildOverrides diffs a working list against base: edit", () => {
    const working = updateField(base, "a", "name", "AA");
    const ov = buildOverrides(working, base);
    expect(ov.edits.a).toEqual({ name: "AA" });
    expect(ov.added).toEqual([]);
    expect(ov.deleted).toEqual([]);
  });

  it("buildOverrides detects an added world", () => {
    const working = addWorld(base, { slug: "c", name: "C", editionId: "default" });
    const ov = buildOverrides(working, base);
    expect(ov.added).toHaveLength(1);
    expect(ov.added[0].slug).toBe("c");
  });

  it("buildOverrides detects a deletion", () => {
    const working = removeWorld(base, "a");
    const ov = buildOverrides(working, base);
    expect(ov.deleted).toEqual(["a"]);
  });
});
