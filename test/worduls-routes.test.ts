import { describe, it, expect } from "vitest";
import { extractBearer } from "../src/worduls-routes.ts";

describe("extractBearer", () => {
  it("pulls the token from an Authorization header", () => {
    expect(extractBearer(new Request("https://x", { headers: { Authorization: "Bearer abc123" } }))).toBe("abc123");
  });
  it("returns empty string when absent or malformed", () => {
    expect(extractBearer(new Request("https://x"))).toBe("");
    expect(extractBearer(new Request("https://x", { headers: { Authorization: "Basic zzz" } }))).toBe("");
  });
});
