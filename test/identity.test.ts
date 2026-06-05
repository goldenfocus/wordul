import { describe, it, expect } from "vitest";
import { normalizeUsername, isValidUsername, normalizeSlug, roomPath, isReserved, RESERVED_USERNAMES } from "../src/identity.ts";

describe("normalizeUsername", () => {
  it("lowercases and strips illegal chars", () => {
    expect(normalizeUsername("  Yan!! ")).toBe("yan");
    expect(normalizeUsername("Cool_Guy-99")).toBe("cool_guy-99");
  });
  it("trims separators from the ends and clips to 20", () => {
    expect(normalizeUsername("--yan--")).toBe("yan");
    expect(normalizeUsername("a".repeat(40))).toBe("a".repeat(20));
  });
  it("re-trims a separator exposed by clipping at the max length", () => {
    expect(normalizeUsername("a".repeat(19) + "_z")).toBe("a".repeat(19));
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
  it("clips to 40 chars", () => {
    expect(normalizeSlug("a".repeat(50))).toBe("a".repeat(40));
  });
});

describe("roomPath", () => {
  it("joins owner and slug", () => {
    expect(roomPath("yan", "friday-night")).toBe("yan/friday-night");
  });
});

describe("isReserved", () => {
  it("flags brand/role/impersonation names (normalized)", () => {
    expect(isReserved("admin")).toBe(true);
    expect(isReserved("WORDUL")).toBe(true);   // normalized before lookup
    expect(isReserved(" Official ")).toBe(true);
    expect(isReserved("wordle")).toBe(true);   // the Wordle namesake — impersonation bait
    expect(isReserved("support")).toBe(true);
  });
  it("lets real people (incl. the owners) claim their handles", () => {
    for (const owner of ["yan", "antonio", "yanik", "zang"]) {
      expect(isReserved(owner)).toBe(false);
    }
    expect(isReserved("maple_otter")).toBe(false);
  });
  it("keeps the anchor word reserved (cannot register @wordul)", () => {
    expect(RESERVED_USERNAMES.has("wordul")).toBe(true);
  });
});
