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

  it("updateField coerces featured strings to booleans", () => {
    const out = updateField(base, "b", "featured", "true");
    expect(out.find((w) => w.id === "b").featured).toBe(true);
    const out2 = updateField(base, "a", "featured", "false");
    expect(out2.find((w) => w.id === "a").featured).toBe(false);
  });

  it("updateField coerces order strings to finite numbers", () => {
    const out = updateField(base, "a", "order", "5");
    expect(out.find((w) => w.id === "a").order).toBe(5);
    const out2 = updateField(base, "a", "order", "nope");
    expect(out2.find((w) => w.id === "a").order).toBe(0);
  });

  it("moveWorld is a no-op at the boundaries", () => {
    expect(moveWorld(base, "a", -1)).toEqual(base); // first up
    expect(moveWorld(base, "b", +1)).toEqual(base); // last down
    expect(moveWorld(base, "missing", -1)).toEqual(base); // unknown id
  });

  it("addWorld makes a unique id when the slug collides", () => {
    const out = addWorld(base, { slug: "a", name: "Dup", editionId: "default" });
    const ids = out.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it("buildOverrides keeps an added-then-edited world in added (not edits)", () => {
    let working = addWorld(base, { slug: "c", name: "C", editionId: "default" });
    const newId = working.find((w) => w.slug === "c").id;
    working = updateField(working, newId, "name", "C2");
    const ov = buildOverrides(working, base);
    expect(ov.added).toHaveLength(1);
    expect(ov.added[0].name).toBe("C2");
    expect(ov.edits[newId]).toBeUndefined();
  });
});
