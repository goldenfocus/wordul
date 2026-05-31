import { describe, it, expect } from "vitest";
import { normalizeUsername, isValidUsername, normalizeSlug, roomPath } from "../src/identity.ts";

describe("normalizeUsername", () => {
  it("lowercases and strips illegal chars", () => {
    expect(normalizeUsername("  Yan!! ")).toBe("yan");
    expect(normalizeUsername("Cool_Guy-99")).toBe("cool_guy-99");
  });
  it("trims separators from the ends and clips to 20", () => {
    expect(normalizeUsername("--yan--")).toBe("yan");
    expect(normalizeUsername("a".repeat(40))).toBe("a".repeat(20));
  });
});

describe("isValidUsername", () => {
  it("requires 3-20 normalized chars", () => {
    expect(isValidUsername("yan")).toBe(true);
    expect(isValidUsername("yo")).toBe(false);
    expect(isValidUsername("good_name-1")).toBe(true);
    expect(isValidUsername("!!")).toBe(false);
  });
});

describe("normalizeSlug", () => {
  it("allows a-z0-9- only, collapses and trims hyphens, clips to 40", () => {
    expect(normalizeSlug("Friday Night!!")).toBe("friday-night");
    expect(normalizeSlug("--happy--otter--")).toBe("happy-otter");
  });
});

describe("roomPath", () => {
  it("joins owner and slug", () => {
    expect(roomPath("yan", "friday-night")).toBe("yan/friday-night");
  });
});
