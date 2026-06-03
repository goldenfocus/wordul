// src/feed.ts — pure, deterministic Living Lab Feed generator. No Cloudflare APIs,
// no randomness, no AI. findings/highlights are ALWAYS recomputed from the science
// aggregates so the data block can never drift from truth. English-templated prose
// (i18n of generated prose is a future layer).
import type { World } from "./daily-core.ts";
import type { SciencePublicDailySummary, ScienceWeeklySummary } from "./science.ts";

export type Pillar = "mind" | "body" | "spirit" | "soul";

export type FindingKind =
  | "solve_rate"
  | "median_guesses"
  | "participation"
  | "first_try_solves"
  | "gray_opener_rate"
  | "letter_reveal_rate";

export type Finding = { kind: FindingKind; value: number; display: string; text: string };
export type Highlight = { label: string; value: string };

export type FeedPost = {
  kind: "daily-discovery" | "weekly-note";
  slug: string;
  date: string;
  headline: string;
  findings: Finding[];
  highlights: Highlight[];
  brainNotes: BrainNote[];
  pillars: Pillar[];
  editorial?: FeedEditorial;
  published: boolean;
  generatedAt: number;
};

// Re-exported from brain-notes in Task 3; declared here so types compile in isolation.
// @ts-expect-error brain-notes.ts is created in Task 3
export type BrainNote = import("./brain-notes.ts").BrainNote;
export type FeedEditorial = {
  title?: string; intro?: string; body?: string;
  media?: { images: string[]; video?: string };
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export function prettyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function pct(n: number, d: number): number { return d > 0 ? Math.round((n / d) * 100) : 0; }

/** Weighted median guess count over the guess distribution, or null if empty. */
export function medianFromDistribution(dist: Record<string, number>): number | null {
  const pairs = Object.entries(dist)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .filter(([k, v]) => Number.isFinite(k) && v > 0)
    .sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return null;
  const mid = total / 2;
  let cum = 0;
  for (const [k, v] of pairs) { cum += v; if (cum >= mid) return k; }
  return pairs[pairs.length - 1][0];
}

export function buildDailyPost(
  summary: SciencePublicDailySummary,
  world: World,
  notes: BrainNote[],
  opts: { todayUTC: string; generatedAt?: number },
): FeedPost {
  const generatedAt = opts.generatedAt ?? Date.now();
  const isPast = summary.date < opts.todayUTC;
  const base = {
    kind: "daily-discovery" as const,
    slug: summary.date,
    date: summary.date,
    generatedAt,
  };

  // Privacy gate enforced HERE (Task 4 expands the teaser): the active/future day
  // exposes participation only — never solve rate, difficulty, or the answer word.
  if (!isPast) {
    return { ...base, headline: "", findings: [], highlights: [], brainNotes: [], pillars: [], published: false };
  }

  const findings = buildDailyFindings(summary);
  return {
    ...base,
    headline: dailyHeadline(summary.date, world.word, findings),
    findings,
    highlights: [],
    brainNotes: [],
    pillars: [],
    published: true,
  };
}

function buildDailyFindings(s: SciencePublicDailySummary): Finding[] {
  const finishes = s.totals.playerFinishes;
  const out: Finding[] = [];
  if (finishes <= 0) return out;

  const solveRate = pct(s.totals.wins, finishes);
  out.push({ kind: "solve_rate", value: solveRate, display: `${solveRate}%`, text: `${solveRate}% of players solved it.` });

  const median = medianFromDistribution(s.outcomes.guessDistribution);
  if (median != null) out.push({ kind: "median_guesses", value: median, display: String(median), text: `The middle player solved it in ${median} guesses.` });

  out.push({ kind: "participation", value: finishes, display: String(finishes), text: `${finishes} players finished the day.` });
  return out;
}

function dailyHeadline(date: string, word: string, findings: Finding[]): string {
  const sr = findings.find((f) => f.kind === "solve_rate");
  const tail = sr ? ` ${sr.display} found it.` : "";
  return `${prettyDate(date)}: ${word}.${tail}`.trim();
}
