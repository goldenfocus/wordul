import { describe, it, expect } from "vitest";
import { slugify, RESERVED_SLUGS, normalizeWordul, wordulToWorld, passesContentGate, type Wordul } from "../src/wordul-core.ts";

describe("slugify", () => {
  it("lowercases, hyphenates, strips junk", () => {
    expect(slugify("Ocean Day!")).toBe("ocean-day");
    expect(slugify("  multiple   spaces ")).toBe("multiple-spaces");
    expect(slugify("Café 2026")).toBe("cafe-2026"); // accents folded (NFKD), not dropped
  });
  it("falls back to 'world' when empty", () => {
    expect(slugify("!!!")).toBe("world");
  });
});

describe("RESERVED_SLUGS", () => {
  it("reserves gallery + system words", () => {
    for (const s of ["worduls", "daily", "settings", "feed", "api", "ws", "c"]) {
      expect(RESERVED_SLUGS.has(s)).toBe(true);
    }
  });
});

describe("normalizeWordul", () => {
  const ok = { vibeTitle: "Ocean Day", word: "ocean", story: { title: "Why", body: "Tides." }, colorScheme: { a1: "#012", a2: "#345", a3: "#678" } };
  it("produces a published wordul owned by the caller", () => {
    const w = normalizeWordul(ok, { owner: "zang", slug: "ocean-day", worldId: "wd_1", now: 1000 });
    expect(w).not.toBeNull();
    expect(w!.owner).toBe("zang");
    expect(w!.slug).toBe("ocean-day");
    expect(w!.worldId).toBe("wd_1");
    expect(w!.status).toBe("published");
    expect(w!.word).toBe("OCEAN");
    expect(w!.wordLocked).toBe(false);
    expect(w!.plays).toBe(0);
    expect(w!.visibility).toBe("public");
  });
  it("rejects an invalid bundle (bad word)", () => {
    expect(normalizeWordul({ word: "x", story: { title: "t", body: "b" } }, { owner: "zang", slug: "s", worldId: "id", now: 1 })).toBeNull();
  });
  it("allows an invented word", () => {
    const w = normalizeWordul({ word: "zzzzz", invented: true, story: { title: "t", body: "b" } }, { owner: "z", slug: "s", worldId: "id", now: 1 });
    expect(w).not.toBeNull();
    expect(w!.invented).toBe(true);
  });
});

describe("wordulToWorld", () => {
  it("synthesizes a playable World with a stable sentinel date + owned edition", () => {
    const w = normalizeWordul({ word: "ocean", story: { title: "Why", body: "B" }, vibeTitle: "Ocean Day" }, { owner: "zang", slug: "ocean-day", worldId: "wd_42", now: 5 })!;
    const world = wordulToWorld(w);
    expect(world.word).toBe("OCEAN");
    expect(world.date).toBe("world:wd_42");
    expect(world.edition).toBe("owned");
    expect(world.vibeTitle).toBe("Ocean Day");
    expect(world.story.title).toBe("Why");
  });
});

describe("passesContentGate (P1 no-op)", () => {
  it("always returns true in P1", () => {
    expect(passesContentGate("anything", "any", "any", "any")).toBe(true);
  });
});
