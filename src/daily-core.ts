// src/daily-core.ts — pure, dependency-free daily logic (unit-tested). No Cloudflare deps.
import { WORDS_BY_SIZE } from "./wordsbysize.ts";

export interface World {
  date: string;            // "2026-06-02" — UTC day it belongs to
  word: string;            // main answer (UPPERCASE)
  bonusWord?: string;      // RESERVED (#2): hidden word to discover; no behavior yet
  edition: string;         // design skin id (e.g. "yang", "default")
  voice: string;           // companion voice id (e.g. "yang")
  story: { title: string; body: string; tip?: string };
  curator?: { username: string; message: string }; // RESERVED (#4)
  feedEditorial?: {            // RESERVED: Living Lab Feed editorial overlay (admin-gated)
    title?: string;
    intro?: string;
    body?: string;
    media?: { images: string[]; video?: string };
  };
  createdAt: number;       // epoch ms
}

export type DailySchedule = Record<string, World>;

/** UTC calendar date string "YYYY-MM-DD" for an instant (rolls at 00:00:00 UTC). */
export function activeDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** FNV-1a 32-bit hash → unsigned int. Deterministic, dependency-free. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts; >>> 0 keeps it unsigned 32-bit.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic pick from an answer pool, seeded by the date string. */
export function fallbackWord(date: string, answers: string[]): string {
  if (!answers || answers.length === 0) return "";
  return answers[fnv1a(date) % answers.length];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A generic "house" World for any unauthored date — deterministic fallback word. */
export function houseWorld(date: string, nowMs: number): World {
  const word = fallbackWord(date, WORDS_BY_SIZE[5]?.answers ?? []);
  return {
    date,
    word,
    edition: "default",
    voice: "yang",
    story: {
      title: `Today's word`,
      body: `No curator claimed ${date} — so the house drew a word. Play it, then come back: a curated day is coming.`,
    },
    createdAt: nowMs,
  };
}

/** Curated World for the date if scheduled, else the deterministic house World. */
export function resolveWorld(schedule: DailySchedule, date: string, nowMs: number): World {
  return schedule[date] ?? houseWorld(date, nowMs);
}

/** Validate + normalize an admin-supplied World payload. Returns null if invalid. */
export function normalizeWorld(input: unknown): World | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const date = typeof o.date === "string" ? o.date : "";
  if (!DATE_RE.test(date)) return null;
  const word = typeof o.word === "string" ? o.word.toUpperCase().trim() : "";
  if (!/^[A-Z]+$/.test(word)) return null;
  // Reject a curator typo / off-board-size word at schedule time so it never produces
  // an unsolvable day (the word must be a real answer or valid guess for a supported size).
  const pool = WORDS_BY_SIZE[word.length];
  if (!pool || !(pool.valid.has(word) || pool.answers.includes(word))) return null;
  const story = (o.story && typeof o.story === "object" ? o.story : {}) as Record<string, unknown>;
  if (typeof story.title !== "string" || typeof story.body !== "string") return null;
  const world: World = {
    date,
    word,
    edition: typeof o.edition === "string" && o.edition ? o.edition : "default",
    voice: typeof o.voice === "string" && o.voice ? o.voice : "yang",
    story: {
      title: story.title,
      body: story.body,
      ...(typeof story.tip === "string" ? { tip: story.tip } : {}),
    },
    createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
  };
  if (typeof o.bonusWord === "string" && /^[A-Za-z]+$/.test(o.bonusWord)) world.bonusWord = o.bonusWord.toUpperCase();
  if (o.curator && typeof o.curator === "object") {
    const c = o.curator as Record<string, unknown>;
    if (typeof c.username === "string" && typeof c.message === "string") {
      world.curator = { username: c.username, message: c.message };
    }
  }
  if (o.feedEditorial && typeof o.feedEditorial === "object") {
    const e = o.feedEditorial as Record<string, unknown>;
    const ed: NonNullable<World["feedEditorial"]> = {};
    if (typeof e.title === "string") ed.title = e.title;
    if (typeof e.intro === "string") ed.intro = e.intro;
    if (typeof e.body === "string") ed.body = e.body;
    if (e.media && typeof e.media === "object") {
      const m = e.media as Record<string, unknown>;
      const images = Array.isArray(m.images) ? m.images.filter((x): x is string => typeof x === "string") : [];
      ed.media = { images, ...(typeof m.video === "string" ? { video: m.video } : {}) };
    }
    if (Object.keys(ed).length > 0) world.feedEditorial = ed;
  }
  return world;
}
