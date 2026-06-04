// src/science.ts — privacy-preserving public research aggregates for Wordul.
// Pure logic only: no Cloudflare APIs, no usernames, no raw per-player timelines.
import type { Color } from "./color.ts";

export const SCIENCE_SCHEMA_VERSION = 1;
export const SCIENCE_WORD_K = 3;

export type ScienceRoomKind = "room" | "daily" | "challenge";
export type ScienceOutcome = "won" | "lost" | "resigned";
export type SciencePowerup = "reveal_letter" | "vowel_count";

export type ScienceBaseEvent = {
  at: number;
  date: string;
  roomKind: ScienceRoomKind;
  wordLength: number;
  maxGuesses: number;
  mode: string;
  edition: string;
  isBot?: boolean;
};

export type ScienceRoundStartedEvent = ScienceBaseEvent & {
  type: "round_started";
  participantCount: number;
  botCount: number;
};

export type ScienceGuessAcceptedEvent = ScienceBaseEvent & {
  type: "guess_accepted";
  guessNumber: number;
  elapsedMs: number | null;
  mask: string;
  green: number;
  yellow: number;
  gray: number;
  statusAfter: "playing" | "won" | "lost";
  points: number;
};

export type SciencePlayerFinishedEvent = ScienceBaseEvent & {
  type: "player_finished";
  outcome: ScienceOutcome;
  guesses: number;
  elapsedMs: number | null;
  points: number;
  answer?: string;
  revealHints: number;
  vowelHints: number;
};

export type SciencePowerupUsedEvent = ScienceBaseEvent & {
  type: "powerup_used";
  powerup: SciencePowerup;
  guessNumber: number;
  pointsSpent: number;
};

export type ScienceEvent =
  | ScienceRoundStartedEvent
  | ScienceGuessAcceptedEvent
  | SciencePlayerFinishedEvent
  | SciencePowerupUsedEvent;

export type CounterMap = Record<string, number>;

export type RunningStats = {
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
  mean: number | null;
};

export type ScienceGuessBucket = {
  count: number;
  solved: number;
  grayOnly: number;
  greenTiles: number;
  yellowTiles: number;
  maskPatterns: CounterMap;
  elapsedMs: RunningStats;
};

export type ScienceWordBucket = {
  finishes: number;
  wins: number;
  losses: number;
  resigns: number;
  guesses: CounterMap;
  averageGuesses: RunningStats;
};

export type ScienceDailyState = {
  schemaVersion: number;
  date: string;
  createdAt: number;
  updatedAt: number;
  totals: {
    events: number;
    roundsStarted: number;
    acceptedGuesses: number;
    playerFinishes: number;
    wins: number;
    losses: number;
    resigns: number;
    powerups: number;
    botEvents: number;
  };
  segments: {
    roomKind: CounterMap;
    wordLength: CounterMap;
    mode: CounterMap;
    edition: CounterMap;
  };
  participants: {
    roundStarts: number;
    observedHumansAtStart: RunningStats;
    observedBotsAtStart: RunningStats;
  };
  guesses: Record<string, ScienceGuessBucket>;
  outcomes: {
    byResult: CounterMap;
    guessDistribution: CounterMap;
    elapsedMs: RunningStats;
    points: RunningStats;
  };
  powerups: Record<SciencePowerup, number>;
  hintUsage: {
    revealHints: CounterMap;
    vowelHints: CounterMap;
  };
  words: Record<string, ScienceWordBucket>;
};

export type SciencePublicDailySummary = Omit<ScienceDailyState, "words"> & {
  generatedAt: number;
  privacy: {
    noUsernames: true;
    noRawTimelines: true;
    wordStatsK: number;
    wordStats: "withheld" | "k-anonymized";
  };
  words?: Record<string, ScienceWordBucket>;
};

export type ScienceWeeklySummary = {
  schemaVersion: number;
  generatedAt: number;
  dates: string[];
  totals: ScienceDailyState["totals"];
  outcomes: ScienceDailyState["outcomes"];
  powerups: Record<SciencePowerup, number>;
  daily: SciencePublicDailySummary[];
};

export function emptyRunningStats(): RunningStats {
  return { count: 0, sum: 0, min: null, max: null, mean: null };
}

export function emptyScienceState(date: string, now = Date.now()): ScienceDailyState {
  return {
    schemaVersion: SCIENCE_SCHEMA_VERSION,
    date,
    createdAt: now,
    updatedAt: now,
    totals: {
      events: 0,
      roundsStarted: 0,
      acceptedGuesses: 0,
      playerFinishes: 0,
      wins: 0,
      losses: 0,
      resigns: 0,
      powerups: 0,
      botEvents: 0,
    },
    segments: {
      roomKind: {},
      wordLength: {},
      mode: {},
      edition: {},
    },
    participants: {
      roundStarts: 0,
      observedHumansAtStart: emptyRunningStats(),
      observedBotsAtStart: emptyRunningStats(),
    },
    guesses: {},
    outcomes: {
      byResult: {},
      guessDistribution: {},
      elapsedMs: emptyRunningStats(),
      points: emptyRunningStats(),
    },
    powerups: { reveal_letter: 0, vowel_count: 0 },
    hintUsage: { revealHints: {}, vowelHints: {} },
    words: {},
  };
}

export function maskToPattern(mask: Color[]): string {
  return mask.map((c) => (c === "green" ? "G" : c === "yellow" ? "Y" : "X")).join("");
}

export function countMask(pattern: string): { green: number; yellow: number; gray: number } {
  const out = { green: 0, yellow: 0, gray: 0 };
  for (const c of pattern) {
    if (c === "G") out.green += 1;
    else if (c === "Y") out.yellow += 1;
    else out.gray += 1;
  }
  return out;
}

export function applyScienceEvent(state: ScienceDailyState, event: ScienceEvent): ScienceDailyState {
  state.updatedAt = Math.max(state.updatedAt, event.at);
  state.totals.events += 1;
  if (event.isBot) state.totals.botEvents += 1;

  inc(state.segments.roomKind, event.roomKind);
  inc(state.segments.wordLength, String(event.wordLength));
  inc(state.segments.mode, event.mode || "unknown");
  inc(state.segments.edition, event.edition || "default");

  switch (event.type) {
    case "round_started":
      state.totals.roundsStarted += 1;
      state.participants.roundStarts += 1;
      addStat(state.participants.observedHumansAtStart, event.participantCount);
      addStat(state.participants.observedBotsAtStart, event.botCount);
      break;
    case "guess_accepted":
      state.totals.acceptedGuesses += 1;
      applyGuessEvent(state, event);
      break;
    case "player_finished":
      state.totals.playerFinishes += 1;
      if (event.outcome === "won") state.totals.wins += 1;
      else if (event.outcome === "resigned") state.totals.resigns += 1;
      else state.totals.losses += 1;
      applyFinishEvent(state, event);
      break;
    case "powerup_used":
      state.totals.powerups += 1;
      state.powerups[event.powerup] = (state.powerups[event.powerup] ?? 0) + 1;
      break;
  }

  return state;
}

export function publicScienceSummary(
  state: ScienceDailyState,
  opts: { includeWords?: boolean; generatedAt?: number } = {},
): SciencePublicDailySummary {
  const includeWords = !!opts.includeWords;
  const { words: _privateWords, ...publicState } = state;
  const summary: SciencePublicDailySummary = {
    ...publicState,
    generatedAt: opts.generatedAt ?? Date.now(),
    privacy: {
      noUsernames: true,
      noRawTimelines: true,
      wordStatsK: SCIENCE_WORD_K,
      wordStats: includeWords ? "k-anonymized" : "withheld",
    },
  };
  if (includeWords) {
    const words: Record<string, ScienceWordBucket> = {};
    for (const [answer, bucket] of Object.entries(state.words)) {
      if (bucket.finishes >= SCIENCE_WORD_K) words[answer] = bucket;
    }
    summary.words = words;
  }
  return summary;
}

export function buildWeeklyScienceSummary(
  daily: SciencePublicDailySummary[],
  generatedAt = Date.now(),
): ScienceWeeklySummary {
  const totals = emptyScienceState("weekly", generatedAt).totals;
  const outcomes = emptyScienceState("weekly", generatedAt).outcomes;
  const powerups: Record<SciencePowerup, number> = { reveal_letter: 0, vowel_count: 0 };

  for (const day of daily) {
    mergeTotals(totals, day.totals);
    mergeCounters(outcomes.byResult, day.outcomes.byResult);
    mergeCounters(outcomes.guessDistribution, day.outcomes.guessDistribution);
    mergeRunningStats(outcomes.elapsedMs, day.outcomes.elapsedMs);
    mergeRunningStats(outcomes.points, day.outcomes.points);
    powerups.reveal_letter += day.powerups.reveal_letter ?? 0;
    powerups.vowel_count += day.powerups.vowel_count ?? 0;
  }

  return {
    schemaVersion: SCIENCE_SCHEMA_VERSION,
    generatedAt,
    dates: daily.map((d) => d.date),
    totals,
    outcomes,
    powerups,
    daily,
  };
}

export function normalizeScienceEvent(input: unknown): ScienceEvent | null {
  if (!input || typeof input !== "object") return null;
  const e = input as Record<string, unknown>;
  if (typeof e.type !== "string") return null;
  if (typeof e.at !== "number" || !Number.isFinite(e.at)) return null;
  if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
  if (!isRoomKind(e.roomKind)) return null;
  if (typeof e.wordLength !== "number" || e.wordLength < 1 || e.wordLength > 32) return null;
  if (typeof e.maxGuesses !== "number" || e.maxGuesses < 1 || e.maxGuesses > 32) return null;
  const base = {
    at: e.at,
    date: e.date,
    roomKind: e.roomKind,
    wordLength: e.wordLength,
    maxGuesses: e.maxGuesses,
    mode: typeof e.mode === "string" ? e.mode.slice(0, 32) : "unknown",
    edition: typeof e.edition === "string" ? e.edition.slice(0, 32) : "default",
    ...(e.isBot === true ? { isBot: true } : {}),
  };

  if (e.type === "round_started") {
    if (typeof e.participantCount !== "number" || typeof e.botCount !== "number") return null;
    return { ...base, type: "round_started", participantCount: e.participantCount, botCount: e.botCount };
  }
  if (e.type === "guess_accepted") {
    if (typeof e.guessNumber !== "number" || typeof e.mask !== "string") return null;
    if (typeof e.green !== "number" || typeof e.yellow !== "number" || typeof e.gray !== "number") return null;
    if (e.statusAfter !== "playing" && e.statusAfter !== "won" && e.statusAfter !== "lost") return null;
    return {
      ...base,
      type: "guess_accepted",
      guessNumber: e.guessNumber,
      elapsedMs: typeof e.elapsedMs === "number" ? e.elapsedMs : null,
      mask: e.mask.replace(/[^GYX]/g, "").slice(0, 32),
      green: e.green,
      yellow: e.yellow,
      gray: e.gray,
      statusAfter: e.statusAfter,
      points: typeof e.points === "number" ? e.points : 0,
    };
  }
  if (e.type === "player_finished") {
    if (!isOutcome(e.outcome) || typeof e.guesses !== "number") return null;
    return {
      ...base,
      type: "player_finished",
      outcome: e.outcome,
      guesses: e.guesses,
      elapsedMs: typeof e.elapsedMs === "number" ? e.elapsedMs : null,
      points: typeof e.points === "number" ? e.points : 0,
      ...(typeof e.answer === "string" && /^[A-Z]+$/.test(e.answer) ? { answer: e.answer.slice(0, 32) } : {}),
      revealHints: typeof e.revealHints === "number" ? e.revealHints : 0,
      vowelHints: typeof e.vowelHints === "number" ? e.vowelHints : 0,
    };
  }
  if (e.type === "powerup_used") {
    if (!isPowerup(e.powerup) || typeof e.guessNumber !== "number" || typeof e.pointsSpent !== "number") return null;
    return { ...base, type: "powerup_used", powerup: e.powerup, guessNumber: e.guessNumber, pointsSpent: e.pointsSpent };
  }
  return null;
}

function applyGuessEvent(state: ScienceDailyState, event: ScienceGuessAcceptedEvent): void {
  const key = String(event.guessNumber);
  const bucket = state.guesses[key] ??= emptyGuessBucket();
  bucket.count += 1;
  bucket.greenTiles += event.green;
  bucket.yellowTiles += event.yellow;
  if (event.gray === event.wordLength) bucket.grayOnly += 1;
  if (event.statusAfter === "won") bucket.solved += 1;
  inc(bucket.maskPatterns, event.mask || "?");
  if (event.elapsedMs != null) addStat(bucket.elapsedMs, event.elapsedMs);
}

function applyFinishEvent(state: ScienceDailyState, event: SciencePlayerFinishedEvent): void {
  inc(state.outcomes.byResult, event.outcome);
  inc(state.outcomes.guessDistribution, String(event.guesses));
  inc(state.hintUsage.revealHints, String(event.revealHints));
  inc(state.hintUsage.vowelHints, String(event.vowelHints));
  if (event.elapsedMs != null) addStat(state.outcomes.elapsedMs, event.elapsedMs);
  addStat(state.outcomes.points, event.points);

  if (!event.answer) return;
  const word = state.words[event.answer] ??= emptyWordBucket();
  word.finishes += 1;
  if (event.outcome === "won") word.wins += 1;
  else if (event.outcome === "resigned") word.resigns += 1;
  else word.losses += 1;
  inc(word.guesses, String(event.guesses));
  addStat(word.averageGuesses, event.guesses);
}

function emptyGuessBucket(): ScienceGuessBucket {
  return {
    count: 0,
    solved: 0,
    grayOnly: 0,
    greenTiles: 0,
    yellowTiles: 0,
    maskPatterns: {},
    elapsedMs: emptyRunningStats(),
  };
}

function emptyWordBucket(): ScienceWordBucket {
  return {
    finishes: 0,
    wins: 0,
    losses: 0,
    resigns: 0,
    guesses: {},
    averageGuesses: emptyRunningStats(),
  };
}

function inc(map: CounterMap, key: string, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

function addStat(stats: RunningStats, value: number): void {
  if (!Number.isFinite(value)) return;
  stats.count += 1;
  stats.sum += value;
  stats.min = stats.min == null ? value : Math.min(stats.min, value);
  stats.max = stats.max == null ? value : Math.max(stats.max, value);
  stats.mean = stats.sum / stats.count;
}

function mergeCounters(into: CounterMap, from: CounterMap): void {
  for (const [k, v] of Object.entries(from)) inc(into, k, v);
}

function mergeRunningStats(into: RunningStats, from: RunningStats): void {
  if (from.count === 0) return;
  into.count += from.count;
  into.sum += from.sum;
  into.min = into.min == null ? from.min : (from.min == null ? into.min : Math.min(into.min, from.min));
  into.max = into.max == null ? from.max : (from.max == null ? into.max : Math.max(into.max, from.max));
  into.mean = into.count > 0 ? into.sum / into.count : null;
}

function mergeTotals(into: ScienceDailyState["totals"], from: ScienceDailyState["totals"]): void {
  for (const key of Object.keys(into) as (keyof ScienceDailyState["totals"])[]) {
    into[key] += from[key];
  }
}

function isRoomKind(v: unknown): v is ScienceRoomKind {
  return v === "room" || v === "daily" || v === "challenge";
}

function isOutcome(v: unknown): v is ScienceOutcome {
  return v === "won" || v === "lost" || v === "resigned";
}

function isPowerup(v: unknown): v is SciencePowerup {
  return v === "reveal_letter" || v === "vowel_count";
}
