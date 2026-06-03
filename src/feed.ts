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

export type { BrainNote, BrainNoteTrigger } from "./brain-notes.ts";
import type { BrainNote } from "./brain-notes.ts";
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

export function matchBrainNotes(findings: Finding[], notes: BrainNote[]): BrainNote[] {
  const byKind = new Map(findings.map((f) => [f.kind, f.value]));
  return notes.filter((n) => {
    const v = byKind.get(n.trigger.kind);
    if (v == null) return false;
    if (n.trigger.min != null && v < n.trigger.min) return false;
    if (n.trigger.max != null && v > n.trigger.max) return false;
    return true;
  });
}

function uniquePillars(notes: BrainNote[]): Pillar[] {
  const order: Pillar[] = ["mind", "body", "spirit", "soul"];
  const present = new Set(notes.map((n) => n.pillar));
  return order.filter((p) => present.has(p));
}

function buildHighlights(s: SciencePublicDailySummary, world: World): Highlight[] {
  const out: Highlight[] = [{ label: "Word", value: world.word }];
  const sr = pct(s.totals.wins, s.totals.playerFinishes);
  if (s.totals.playerFinishes > 0) out.push({ label: "Solve rate", value: `${sr}%` });
  return out;
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
    const finishes = summary.totals.playerFinishes;
    const findings: Finding[] = finishes > 0
      ? [{ kind: "participation", value: finishes, display: String(finishes), text: `${finishes} players are wordling today.` }]
      : [];
    const headline = finishes > 0 ? `${finishes} players are wordling today.` : "Today's discovery is still being written.";
    return { ...base, headline, findings, highlights: [], brainNotes: [], pillars: [], published: false };
  }

  const findings = buildDailyFindings(summary);
  const matched = matchBrainNotes(findings, notes);
  // NOTE: cast shim — World.feedEditorial is added in Task 5, which removes this cast.
  const editorial = (world as World & { feedEditorial?: FeedEditorial }).feedEditorial;
  return {
    ...base,
    headline: dailyHeadline(summary.date, world.word, findings),
    findings,
    highlights: buildHighlights(summary, world),
    brainNotes: matched,
    pillars: uniquePillars(matched),
    published: true,
    ...(editorial ? { editorial } : {}),
  };
}

/** Share (%) of opening guesses that hit nothing (all gray), or null if no opener data. */
export function grayOpenerRate(s: SciencePublicDailySummary): number | null {
  const g1 = s.guesses["1"];
  if (!g1 || g1.count <= 0) return null;
  return Math.round((g1.grayOnly / g1.count) * 100);
}

/** Share (%) of finishes that revealed a letter, from the reveal-hint histogram, or null. */
export function letterRevealRate(s: SciencePublicDailySummary): number | null {
  const hist = s.hintUsage.revealHints;
  const total = Object.values(hist).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const hinted = Object.entries(hist).reduce((a, [k, v]) => (k === "0" ? a : a + v), 0);
  return Math.round((hinted / total) * 100);
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

  const firstTry = s.outcomes.guessDistribution["1"] ?? 0;
  if (firstTry > 0) out.push({ kind: "first_try_solves", value: firstTry, display: String(firstTry), text: `${firstTry} nailed it on the very first guess.` });

  const gray = grayOpenerRate(s);
  if (gray != null) out.push({ kind: "gray_opener_rate", value: gray, display: `${gray}%`, text: `${gray}% of opening guesses lit up nothing at all.` });

  const reveal = letterRevealRate(s);
  if (reveal != null) out.push({ kind: "letter_reveal_rate", value: reveal, display: `${reveal}%`, text: `${reveal}% spent gold to reveal a letter.` });

  return out;
}

function dailyHeadline(date: string, word: string, findings: Finding[]): string {
  const sr = findings.find((f) => f.kind === "solve_rate");
  const tail = sr ? ` ${sr.display} found it.` : "";
  return `${prettyDate(date)}: ${word}.${tail}`.trim();
}
