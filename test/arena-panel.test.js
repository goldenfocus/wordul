import { describe, it, expect } from "vitest";
import { arenaRowProps, arenaEmptyState } from "../public/arena-panel.js";

const game = {
  routePath: "/@arena/maya-0",
  name: "Maya's room",
  host: "Maya",
  personaIcon: "🦊",
  edition: "default",
  wordLength: 5,
  seats: "1/2",
};

describe("arenaRowProps (F1)", () => {
  it("maps an OpenGame to row props", () => {
    expect(arenaRowProps(game)).toMatchObject({
      routePath: "/@arena/maya-0",
      avatar: "🦊",
      host: "Maya",
      wordLength: 5,
      seats: "1/2",
      edition: "default",
    });
  });
});

describe("arenaEmptyState (F2)", () => {
  it("null games → loading", () => {
    expect(arenaEmptyState(null, false)).toBe("loading");
  });
  it("isError → error (even with stale games)", () => {
    expect(arenaEmptyState([game], true)).toBe("error");
    expect(arenaEmptyState(null, true)).toBe("error");
  });
  it("empty array → empty", () => {
    expect(arenaEmptyState([], false)).toBe("empty");
  });
  it("non-empty array → list", () => {
    expect(arenaEmptyState([game], false)).toBe("list");
  });
});
