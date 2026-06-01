import { describe, it, expect } from "vitest";
import { lineKey } from "/voice-key.js";

describe("lineKey", () => {
  it("is deterministic for the same input", () => {
    expect(lineKey("That's not a word. I checked.")).toBe(lineKey("That's not a word. I checked."));
  });
  it("returns 8 lowercase hex chars", () => {
    expect(lineKey("hello")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("differs for different inputs", () => {
    expect(lineKey("hello there")).not.toBe(lineKey("hello thele"));
  });
  it("handles empty and unicode without throwing", () => {
    expect(lineKey("")).toMatch(/^[0-9a-f]{8}$/);
    expect(lineKey("café — déjà")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("treats the {answer} template as its own distinct key", () => {
    expect(lineKey("The word was {answer}.")).not.toBe(lineKey("The word was CRANE."));
  });
});
