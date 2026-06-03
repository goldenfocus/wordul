import { describe, it, expect } from "vitest";
import { computeFeedStreamView, computeFeedPostView } from "../public/feed.js";

// A published daily-discovery FeedPost, as /feed.json / /feed/<date>.json return it.
function post(over = {}) {
  return {
    kind: "daily-discovery",
    slug: "2026-06-02",
    date: "2026-06-02",
    headline: "June 2, 2026: CRANE. 64% found it.",
    findings: [
      { kind: "solve_rate", value: 64, display: "64%", text: "64% of players solved it." },
      { kind: "median_guesses", value: 4, display: "4", text: "The middle player solved it in 4 guesses." },
      { kind: "participation", value: 100, display: "100", text: "100 players finished the day." },
    ],
    highlights: [{ label: "Word", value: "CRANE" }],
    brainNotes: [
      { id: "mastery", pillar: "soul", title: "Quiet mastery", note: "Four guesses is the signature of a crowd that has quietly gotten good.", citation: "—" },
    ],
    pillars: ["soul"],
    published: true,
    generatedAt: 0,
    ...over,
  };
}

describe("computeFeedStreamView", () => {
  it("is empty for a missing payload or no posts", () => {
    for (const p of [null, undefined, {}, { posts: [] }]) {
      const v = computeFeedStreamView(p);
      expect(v.empty).toBe(true);
      expect(v.cards).toEqual([]);
    }
  });

  it("maps each post to a blog card with a composed intro from the findings", () => {
    const v = computeFeedStreamView({ posts: [post()] });
    expect(v.empty).toBe(false);
    expect(v.cards).toHaveLength(1);
    const c = v.cards[0];
    expect(c.date).toBe("2026-06-02");
    expect(c.title).toBe("June 2, 2026: CRANE. 64% found it.");
    // intro = first two finding sentences joined
    expect(c.intro).toBe("64% of players solved it. The middle player solved it in 4 guesses.");
    expect(c.pillars).toEqual(["soul"]);
  });

  it("prefers an admin editorial intro over the composed one", () => {
    const v = computeFeedStreamView({ posts: [post({ editorial: { intro: "A note from the lab." } })] });
    expect(v.cards[0].intro).toBe("A note from the lab.");
  });
});

describe("computeFeedPostView", () => {
  it("maps findings to readable sentences and passes notes through", () => {
    const v = computeFeedPostView(post());
    expect(v.title).toBe("June 2, 2026: CRANE. 64% found it.");
    expect(v.intro).toBe("64% of players solved it. The middle player solved it in 4 guesses.");
    expect(v.findings).toEqual([
      "64% of players solved it.",
      "The middle player solved it in 4 guesses.",
      "100 players finished the day.",
    ]);
    expect(v.notes).toHaveLength(1);
    expect(v.notes[0]).toMatchObject({ pillar: "soul", title: "Quiet mastery" });
    expect(v.pillars).toEqual(["soul"]);
  });

  it("degrades safely on a null/empty post", () => {
    for (const p of [null, undefined, {}]) {
      const v = computeFeedPostView(p);
      expect(v.title).toBe("");
      expect(v.findings).toEqual([]);
      expect(v.notes).toEqual([]);
      expect(v.pillars).toEqual([]);
    }
  });
});
