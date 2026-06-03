import { describe, it, expect } from "vitest";
import { projectPlayerForClient } from "../src/bots.ts";
import type { PlayerState } from "../src/types.ts";

// A persona injected into a seeded room: human-looking username, isBot kept server-side.
const seededPersona: PlayerState = {
  username: "maya", // === persona.id; the H2H key + visible name source
  connected: true,
  guesses: [],
  status: "playing",
  isBot: true,
  scienceOptOut: true,
  points: 0,
  pointsSpent: 0,
};

describe("seeded persona outbound projection (D2)", () => {
  it("omits isBot but keeps the human-looking username", () => {
    const out = projectPlayerForClient(seededPersona);
    expect("isBot" in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain("isBot");
    expect(out.username).toBe("maya");
  });
});
