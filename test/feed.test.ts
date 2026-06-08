// test/feed.test.ts
import { describe, expect, it } from "vitest";
import { buildDailyPost, buildWeeklyPost, grayOpenerRate, letterRevealRate, matchBrainNotes } from "../src/feed.ts";
import { BRAIN_NOTES } from "../src/brain-notes.ts";
import type { ScienceKindScope, SciencePublicDailySummary } from "../src/science.ts";
import type { ScienceWeeklySummary } from "../src/science.ts";
import type { World } from "../src/daily-core.ts";

// The daily scope the post is ABOUT. Pooled `totals` in these fixtures are deliberately
// different (999 finishes / 1 win) so any finding leaking from the cross-mode pool fails loudly.
function dailyScope(over: Partial<ScienceKindScope> = {}): ScienceKindScope {
  return {
    playerFinishes: 100, wins: 64, losses: 30, resigns: 6,
    guessDistribution: { "1": 4, "3": 30, "4": 40, "5": 20, "6": 6 },
    openers: { count: 0, grayOnly: 0 },
    revealHints: {}, vowelHints: {},
    ...over,
  };
}

function summary(date: string, over: Partial<SciencePublicDailySummary> = {}): SciencePublicDailySummary {
  return {
    schemaVersion: 1, date, createdAt: 0, updatedAt: 0,
    totals: { events: 0, roundsStarted: 0, acceptedGuesses: 0, playerFinishes: 999,
      wins: 1, losses: 990, resigns: 8, powerups: 0, botEvents: 0 },
    segments: { roomKind: {}, wordLength: {}, mode: {}, edition: {} },
    participants: { roundStarts: 0,
      observedHumansAtStart: { count: 0, sum: 0, min: null, max: null, mean: null },
      observedBotsAtStart: { count: 0, sum: 0, min: null, max: null, mean: null } },
    guesses: {},
    outcomes: { byResult: {}, guessDistribution: { "6": 999 },
      elapsedMs: { count: 0, sum: 0, min: null, max: null, mean: null },
      points: { count: 0, sum: 0, min: null, max: null, mean: null } },
    powerups: { reveal_letter: 0, vowel_count: 0 },
    hintUsage: { revealHints: {}, vowelHints: {} },
    kinds: { daily: dailyScope() },
    generatedAt: 0,
    privacy: { noUsernames: true, noRawTimelines: true, wordStatsK: 3, wordStats: "k-anonymized" },
    ...over,
  };
}

const world = (over: Partial<World> = {}): World => ({
  date: "2026-06-02", word: "CRANE", edition: "default", voice: "yang",
  story: { title: "Why CRANE?", body: "A bird and a machine." }, createdAt: 0, ...over,
});

describe("buildDailyPost — extended findings", () => {
  it("adds first-try, gray-opener, and letter-reveal findings from the DAILY scope", () => {
    const s = summary("2026-06-02", {
      kinds: { daily: dailyScope({
        openers: { count: 90, grayOnly: 30 },
        revealHints: { "0": 89, "1": 11 },
      }) },
    });
    const post = buildDailyPost(s, world(), [], { todayUTC: "2026-06-03" });
    const byKind = Object.fromEntries(post.findings.map((f) => [f.kind, f]));
    expect(byKind.first_try_solves.value).toBe(4);          // daily guessDistribution["1"] = 4 of 100
    expect(byKind.gray_opener_rate.value).toBe(33);          // 30 of 90 daily opening guesses all-gray
    expect(byKind.letter_reveal_rate.value).toBe(11);        // 11 of 100 daily finishers revealed a letter
  });

  it("omits findings the data cannot support", () => {
    const post = buildDailyPost(summary("2026-06-02"), world(), [], { todayUTC: "2026-06-03" });
    const kinds = post.findings.map((f) => f.kind);
    expect(kinds).not.toContain("gray_opener_rate");
    expect(kinds).not.toContain("letter_reveal_rate");
  });
});

describe("brain notes", () => {
  it("seeds a non-trivial library spanning all four pillars", () => {
    const pillars = new Set(BRAIN_NOTES.map((n) => n.pillar));
    expect(BRAIN_NOTES.length).toBeGreaterThanOrEqual(8);
    expect([...pillars].sort()).toEqual(["body", "mind", "soul", "spirit"]);
    for (const n of BRAIN_NOTES) { expect(n.id).toBeTruthy(); expect(n.note.length).toBeGreaterThan(0); }
  });

  it("matches notes by declarative trigger over findings and derives pillars", () => {
    const findings = [{ kind: "letter_reveal_rate", value: 25, display: "25%", text: "" }] as const;
    const note = { id: "offload", pillar: "mind", title: "Cognitive offloading",
      note: "Reaching for a hint offloads memory to the tool.", trigger: { kind: "letter_reveal_rate", min: 15 } } as const;
    const matched = matchBrainNotes(findings as any, [note as any]);
    expect(matched.map((n) => n.id)).toEqual(["offload"]);
  });

  it("attaches matched notes + pillars to a past-day post", () => {
    const post = buildDailyPost(summary("2026-06-02"), world(), BRAIN_NOTES, { todayUTC: "2026-06-03" });
    expect(post.brainNotes.length).toBeGreaterThan(0);
    expect(post.pillars.length).toBeGreaterThan(0);
    for (const p of post.pillars) expect(["mind","body","spirit","soul"]).toContain(p);
  });
});

describe("privacy gate — active day", () => {
  it("withholds solve rate, difficulty, and the answer word for today; participation only", () => {
    const s = summary("2026-06-03"); // today
    const post = buildDailyPost(s, world({ date: "2026-06-03", word: "EMBER" }), BRAIN_NOTES, { todayUTC: "2026-06-03" });
    expect(post.published).toBe(false);
    const kinds = post.findings.map((f) => f.kind);
    expect(kinds).toEqual(["participation"]);           // ONLY participation
    expect(post.findings[0].value).toBe(100);            // daily players — never the 999 cross-mode pool
    expect(post.brainNotes).toEqual([]);
    expect(post.pillars).toEqual([]);
    expect(post.highlights).toEqual([]);
    const blob = JSON.stringify(post);
    expect(blob).not.toContain("EMBER");                 // never leak the active word
    expect(blob).not.toContain("solve_rate");
  });

  it("future dates are treated like the active day (never published)", () => {
    const post = buildDailyPost(summary("2026-06-10"), world({ date: "2026-06-10" }), BRAIN_NOTES, { todayUTC: "2026-06-03" });
    expect(post.published).toBe(false);
  });
});

describe("buildDailyPost — past-day data block", () => {
  it("computes solve rate, median, and participation from the DAILY scope, never pooled totals", () => {
    const post = buildDailyPost(summary("2026-06-02"), world(), [], { todayUTC: "2026-06-03" });
    expect(post.kind).toBe("daily-discovery");
    expect(post.slug).toBe("2026-06-02");
    expect(post.published).toBe(true);
    const byKind = Object.fromEntries(post.findings.map((f) => [f.kind, f]));
    expect(byKind.solve_rate.value).toBe(64);    // daily 64/100 — NOT the pooled 1/999
    expect(byKind.solve_rate.display).toBe("64%");
    expect(byKind.median_guesses.value).toBe(4); // weighted median of the daily distribution
    expect(byKind.participation.value).toBe(100);
  });
});

// Jun 7 2026 incident: GOLLY's post said "32% found it" from pooled cross-mode totals
// while the only two daily players both solved. Days recorded before per-kind scopes
// fall back to the daily answer's own word bucket; with neither source, the post
// publishes honestly empty rather than quoting the pool.
describe("legacy days — recorded before per-kind scopes", () => {
  const noStats = (over: Partial<SciencePublicDailySummary> = {}) =>
    summary("2026-06-02", { kinds: {}, ...over });

  it("falls back to the daily word's own bucket", () => {
    const s = noStats({
      dailyWord: { finishes: 2, wins: 2, losses: 0, resigns: 0, guesses: { "3": 1, "5": 1 },
        averageGuesses: { count: 2, sum: 8, min: 3, max: 5, mean: 4 } },
    });
    const post = buildDailyPost(s, world({ word: "GOLLY" }), [], { todayUTC: "2026-06-03" });
    const byKind = Object.fromEntries(post.findings.map((f) => [f.kind, f]));
    expect(byKind.solve_rate.value).toBe(100);
    expect(byKind.participation.value).toBe(2);
    expect(byKind.median_guesses.value).toBe(3);
    expect(post.headline).toContain("100% found it.");
    const kinds = post.findings.map((f) => f.kind);
    expect(kinds).not.toContain("gray_opener_rate");    // guess-level data can't be scoped retroactively
    expect(kinds).not.toContain("letter_reveal_rate");
  });

  it("publishes no numbers at all when no daily-scoped source exists", () => {
    const post = buildDailyPost(noStats(), world(), [], { todayUTC: "2026-06-03" });
    expect(post.published).toBe(true);
    expect(post.findings).toEqual([]);
    expect(post.headline).not.toContain("%");
  });
});

describe("editorial overlay", () => {
  it("rides on top of a past-day post without altering findings/highlights", () => {
    const ed = { title: "The week we all chased CRANE", intro: "A note from the lab." };
    const plain = buildDailyPost(summary("2026-06-02"), world(), BRAIN_NOTES, { todayUTC: "2026-06-03" });
    const withEd = buildDailyPost(summary("2026-06-02"), world({ feedEditorial: ed }), BRAIN_NOTES, { todayUTC: "2026-06-03" });
    expect(withEd.editorial).toEqual(ed);
    expect(withEd.findings).toEqual(plain.findings);     // data block identical
    expect(withEd.highlights).toEqual(plain.highlights);
    expect(withEd.headline).toEqual(plain.headline);
  });
});

function weekly(over: Partial<ScienceWeeklySummary> = {}): ScienceWeeklySummary {
  return {
    schemaVersion: 1, generatedAt: 0,
    dates: ["2026-05-28","2026-05-29","2026-05-30","2026-05-31","2026-06-01","2026-06-02","2026-06-03"],
    totals: { events: 0, roundsStarted: 0, acceptedGuesses: 0, playerFinishes: 700,
      wins: 420, losses: 240, resigns: 40, powerups: 0, botEvents: 0 },
    outcomes: { byResult: {}, guessDistribution: { "3": 200, "4": 300, "5": 200 },
      elapsedMs: { count: 0, sum: 0, min: null, max: null, mean: null },
      points: { count: 0, sum: 0, min: null, max: null, mean: null } },
    powerups: { reveal_letter: 0, vowel_count: 0 },
    daily: [summary("2026-06-02"), summary("2026-06-03")],
    ...over,
  };
}

describe("buildWeeklyPost", () => {
  it("rolls up the week into an honest, spoiler-safe note (excludes the active day)", () => {
    const post = buildWeeklyPost(weekly(), BRAIN_NOTES, { todayUTC: "2026-06-03" });
    expect(post.kind).toBe("weekly-note");
    expect(post.slug).toBe("weekly-2026-06-03");
    expect(post.published).toBe(true);
    const byKind = Object.fromEntries(post.findings.map((f) => [f.kind, f]));
    expect(byKind.solve_rate.value).toBe(60);   // 420/700
    expect(byKind.participation.value).toBe(700);
    // The active day's per-day summary must not contribute a daily breakdown that could spoil today.
    expect(JSON.stringify(post)).not.toContain("2026-06-03\":{\"word"); // no active-day word block
  });
});
