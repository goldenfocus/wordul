// src/daily-core.ts — pure, dependency-free daily logic (unit-tested). No Cloudflare deps.
import { WORDS_BY_SIZE } from "./wordsbysize.ts";

export interface World {
  date: string;            // "2026-06-02" — UTC day it belongs to
  word: string;            // main answer (UPPERCASE)
  bonusWord?: string;      // RESERVED (#2): hidden word to discover; no behavior yet
  edition: string;         // design skin id (e.g. "yang", "default")
  voice: string;           // companion voice id (e.g. "yang")
  story: { title: string; body: string; tip?: string };
  // --- Vibe Studio v1 (all optional + additive; default-on-write in normalizeWorld) ---
  vibeTitle?: string;                                  // header title; falls back to story.title
  rows?: number;                                       // guess rows, 3–10, default 6
  invented?: boolean;                                  // intentional coinage; skip dictionary gate
  colorScheme?: { a1: string; a2: string; a3: string }; // the 3 palette colors (absent → edition --accent)
  glow?: { atmosphere?: number; header?: number; middle?: number; footer?: number }; // each 0–1
  images?: { header?: string; middle?: string; footer?: string };  // R2 keys
  playlist?: { keys: string[]; autoplayOnEntry?: boolean };          // R2 keys of mp3s
  // roomConfig?: deferred to the voice-editor increment (needs server-side sanitizer)
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

/**
 * Deterministic pick from an answer pool, seeded by the date string.
 *
 * `salt` is an optional SERVER-ONLY secret folded into the seed so the daily
 * pick can't be predicted off the public date alone. It is a strict NO-OP when
 * empty: `date + '' === date`, so an unset salt reproduces the exact unsalted
 * pick (`answers[fnv1a(date) % answers.length]`). Set it via:
 *   wrangler secret put DAILY_SALT
 */
export function fallbackWord(date: string, answers: string[], salt = ""): string {
  if (!answers || answers.length === 0) return "";
  return answers[fnv1a(date + salt) % answers.length];
}

/** The salt to fold into the house-word seed for `date`: the server `secret` only
 *  on/after the `from` cutoff ("YYYY-MM-DD"), else "" (a strict NO-OP). House worlds are
 *  recomputed on demand (not stored), so an ungated salt would rewrite every past/today
 *  uncurated answer; the cutoff keeps already-played days byte-identical while making every
 *  future house day unpredictable. Empty/undefined secret is also a NO-OP. */
export function saltForDate(date: string, secret: string | undefined, from: string): string {
  return secret && date >= from ? secret : "";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Clamp n into [lo, hi]; return fallback if n is not a finite number. */
function clampNum(n: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** Accept #rgb / #rrggbb hex, or any hsl()/rgb()/hsla()/rgba() string. */
function isColor(v: unknown): v is string {
  return typeof v === "string" &&
    (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^(hsl|rgb)a?\(/i.test(v.trim()));
}

/** A generic "house" World for any unauthored date — deterministic fallback word.
 *  `salt` (server-only secret; empty = NO-OP) threads through to fallbackWord. */
export function houseWorld(date: string, nowMs: number, salt = ""): World {
  const word = fallbackWord(date, WORDS_BY_SIZE[5]?.answers ?? [], salt);
  return {
    date,
    word,
    // Coherent house vibe: gold edition + gold voice. (Was default(UV)+yang(gold),
    // which clashed with the warm companion and the daily-unlock chrome.)
    edition: "yang",
    voice: "yang",
    story: {
      title: `Today's word`,
      body: `No curator claimed ${date} — so the house drew a word. Play it, then come back: a curated day is coming.`,
    },
    createdAt: nowMs,
  };
}

/** Curated World for the date if scheduled, else the deterministic house World.
 *  `salt` (server-only secret; empty = NO-OP) threads through to fallbackWord. */
export function resolveWorld(schedule: DailySchedule, date: string, nowMs: number, salt = ""): World {
  return schedule[date] ?? houseWorld(date, nowMs, salt);
}

/** The fields a playable bundle shares between a daily World and a user Wordul. */
export type WorldBundle = {
  word: string; invented: boolean; rows: number; voice: string;
  story: { title: string; body: string; tip?: string };
  vibeTitle?: string;
  colorScheme?: { a1: string; a2: string; a3: string };
  glow?: World["glow"]; images?: World["images"]; playlist?: World["playlist"];
};

/** Validate + normalize the shared playable fields. Returns null if word/story invalid.
 *  Handles word/invented/rows/voice/story/vibeTitle/colorScheme/glow — NOT date-bundle
 *  fields (date/edition/curator/feedEditorial/bonusWord/images/playlist). */
export function normalizeWorldBundle(input: unknown): WorldBundle | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const word = typeof o.word === "string" ? o.word.toUpperCase().trim() : "";
  if (!/^[A-Z]+$/.test(word)) return null;
  if (word.length < 4 || word.length > 12) return null; // hard length gate
  const invented = o.invented === true;
  // Dictionary gate is soft for invented coinages ("guess the curator's word"):
  // a real pooled word is always fine; a non-pooled word ships only when invented:true.
  const pool = WORDS_BY_SIZE[word.length];
  const inPool = !!pool && (pool.valid.has(word) || pool.answers.includes(word));
  if (!inPool && !invented) return null;
  const story = (o.story && typeof o.story === "object" ? o.story : {}) as Record<string, unknown>;
  if (typeof story.title !== "string" || typeof story.body !== "string") return null;
  const bundle: WorldBundle = {
    word, invented,
    rows: clampNum(o.rows, 3, 10, 6),
    voice: typeof o.voice === "string" && o.voice ? o.voice : "yang",
    story: {
      title: story.title,
      body: story.body,
      ...(typeof story.tip === "string" ? { tip: story.tip } : {}),
    },
  };
  if (typeof o.vibeTitle === "string" && o.vibeTitle) bundle.vibeTitle = o.vibeTitle;
  if (o.colorScheme && typeof o.colorScheme === "object") {
    const c = o.colorScheme as Record<string, unknown>;
    if (isColor(c.a1) && isColor(c.a2) && isColor(c.a3)) {
      bundle.colorScheme = { a1: c.a1, a2: c.a2, a3: c.a3 };
    }
  }
  if (o.glow && typeof o.glow === "object") {
    const g = o.glow as Record<string, unknown>;
    const glow: NonNullable<World["glow"]> = {};
    for (const band of ["atmosphere", "header", "middle", "footer"] as const) {
      if (typeof g[band] === "number" && Number.isFinite(g[band])) {
        glow[band] = clampNum(g[band], 0, 1, 0);
      }
    }
    if (Object.keys(glow).length > 0) bundle.glow = glow;
  }
  return bundle;
}

/** Validate + normalize an admin-supplied World payload. Returns null if invalid.
 *  Delegates the shared playable fields to normalizeWorldBundle, then layers the
 *  date-bundle-specific fields (date/edition/bonusWord/curator/feedEditorial/images/playlist). */
export function normalizeWorld(input: unknown): World | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const date = typeof o.date === "string" ? o.date : "";
  if (!DATE_RE.test(date)) return null;
  const bundle = normalizeWorldBundle(input);
  if (!bundle) return null;
  const world: World = {
    date,
    word: bundle.word,
    edition: typeof o.edition === "string" && o.edition ? o.edition : "default",
    voice: bundle.voice,
    invented: bundle.invented,
    story: bundle.story,
    rows: bundle.rows,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
    ...(bundle.colorScheme ? { colorScheme: bundle.colorScheme } : {}),
    ...(bundle.glow ? { glow: bundle.glow } : {}),
  };
  if (bundle.vibeTitle) world.vibeTitle = bundle.vibeTitle;
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

  // --- Vibe Studio v1 themed fields not in the shared bundle (images/playlist) ---
  if (o.images && typeof o.images === "object") {
    const im = o.images as Record<string, unknown>;
    const images: NonNullable<World["images"]> = {};
    for (const band of ["header", "middle", "footer"] as const) {
      if (typeof im[band] === "string" && im[band]) images[band] = im[band] as string;
    }
    if (Object.keys(images).length > 0) world.images = images;
  }
  if (o.playlist && typeof o.playlist === "object") {
    const pl = o.playlist as Record<string, unknown>;
    const keys = Array.isArray(pl.keys) ? pl.keys.filter((k): k is string => typeof k === "string" && !!k) : [];
    if (keys.length > 0) {
      world.playlist = { keys, autoplayOnEntry: pl.autoplayOnEntry === true };
    }
  }

  return world;
}
