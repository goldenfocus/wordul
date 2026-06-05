import { describe, it, expect } from "vitest";
import { shareTargetUrl } from "/share-links.js";

// Regression: tapping the room name inside a challenge view (/c/<id>) produced
// "https://wordul.com/@papa/null" — the chooser fell back to the room form with a
// null slug instead of preferring the challenge id the view was opened with.
describe("shareTargetUrl", () => {
  const origin = "https://wordul.com";

  it("prefers the challenge id the view was opened with (game.challengeId)", () => {
    expect(shareTargetUrl({ origin, challengeId: "AW2rj", shareChallengeId: null, owner: "papa", slug: null }))
      .toBe("https://wordul.com/c/AW2rj");
  });

  it("uses a seeded arena room's published challenge (shareChallengeId)", () => {
    expect(shareTargetUrl({ origin, challengeId: null, shareChallengeId: "Zk9Qa", owner: "yan", slug: "fast-room" }))
      .toBe("https://wordul.com/c/Zk9Qa");
  });

  it("falls back to the room link in a plain room", () => {
    expect(shareTargetUrl({ origin, challengeId: null, shareChallengeId: null, owner: "yan", slug: "fast-room" }))
      .toBe("https://wordul.com/@yan/fast-room");
  });

  it("NEVER emits a null/undefined path segment — degrades to home", () => {
    for (const slug of [null, undefined, ""]) {
      const url = shareTargetUrl({ origin, challengeId: null, shareChallengeId: null, owner: "papa", slug });
      expect(url).not.toContain("null");
      expect(url).not.toContain("undefined");
      expect(url).toBe("https://wordul.com/");
    }
  });
});
