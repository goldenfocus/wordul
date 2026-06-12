// Pure persona roster + deterministic picker + the SINGLE outbound disguise helper.
// No solver/wordsbysize/room runtime imports — only a type-import of PlayerState + the
// pure fnv1a hash. The disguise (projectPlayerForClient) is the one enforcement point
// that makes live seeding (Slice D) safe: isBot is kept server-side and stripped on
// every outbound projection.
import type { PlayerState } from "./types.ts";
import { fnv1a } from "./daily-core.ts";

export type BotPersona = {
  id: string;
  name: string;
  avatar: string;
  edition: string;
  blurb: string;
};

// v1 cast — names/avatars read as people, not robots. Editions drawn from the existing
// library {default,yang,jackpot,arcade,editorial,tactile,robot}. OWNER OPEN QUESTION #4:
// approve this cast or supply your own. `id` doubles as the in-room username (lowercased,
// ≥3 chars) and the H2H key, so it must stay a stable lowercase slug.
export const PERSONAS: BotPersona[] = [
  { id: "maya", name: "Maya", avatar: "🦊", edition: "default", blurb: "Plays for the warm-up coffee. Misses the obvious sometimes." },
  { id: "theo", name: "Theo", avatar: "🐢", edition: "tactile", blurb: "Slow and steady. Reads every row twice." },
  { id: "nova", name: "Nova", avatar: "🌙", edition: "editorial", blurb: "Night-owl solver. Sharp openers, shaky middles." },
  { id: "remy", name: "Remy", avatar: "🐭", edition: "arcade", blurb: "Speedruns the easy ones, fumbles the tricky greens." },
  { id: "juno", name: "Juno", avatar: "🦉", edition: "yang", blurb: "Calm and methodical, but only human." },
  { id: "pax", name: "Pax", avatar: "🐼", edition: "jackpot", blurb: "Lucky guesser. Sometimes too lucky, sometimes not." },
  { id: "ivy", name: "Ivy", avatar: "🦝", edition: "robot", blurb: "Curious and quick. Learns your style as you play." },
];

/**
 * Deterministic (no Math.random). Walks the roster starting at `seedCount`, skipping any
 * persona already open. Returns null when every persona is currently open.
 */
export function pickPersona(seedCount: number, openPersonaIds: ReadonlySet<string>): BotPersona | null {
  const len = PERSONAS.length;
  for (let i = 0; i < len; i++) {
    const p = PERSONAS[(seedCount + i) % len];
    if (openPersonaIds.has(p.id)) continue;
    return p;
  }
  return null;
}

/**
 * Deterministic multi-pick: walk the roster from `seedCount`, skipping any persona already
 * open (across all live rooms), and return up to `n` DISTINCT personas. Returns fewer when
 * the roster is exhausted (graceful — the caller shrinks the room), [] when n <= 0 or every
 * persona is open. `pickPersona` is the n=1 case.
 */
export function pickPersonas(
  seedCount: number,
  n: number,
  openPersonaIds: ReadonlySet<string>,
): BotPersona[] {
  if (n <= 0) return [];
  const out: BotPersona[] = [];
  const taken = new Set<string>(openPersonaIds);
  const len = PERSONAS.length;
  for (let i = 0; i < len && out.length < n; i++) {
    const p = PERSONAS[(seedCount + i) % len];
    if (taken.has(p.id)) continue;
    taken.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * The disguise. Strips the two server-only bot tells — `isBot` AND `nextGuessAt` (the per-bot
 * heartbeat schedule, present only on bots) — while letting every other PlayerState field pass
 * through automatically (a near-total omit, so non-tell fields don't need per-field maintenance).
 * Both snapshotFor branches route through this.
 */
export function projectPlayerForClient(p: PlayerState): Omit<PlayerState, "isBot" | "nextGuessAt"> {
  const { isBot: _isBot, nextGuessAt: _nextGuessAt, ...rest } = p;
  return rest;
}

/**
 * Which alternate solver line this persona plays in this room. Guaranteed DISTINCT
 * across the whole roster within one room: distinct roster indices + a shared
 * per-room rotation stay distinct mod roster length — so no two personas on the same
 * board can ever trace the same sharp line (the "Nova and Juno are clones" tell).
 * The fnv1a(path) rotation re-deals the styles per room/day, so no persona is
 * permanently stuck with the weakest line. Blindness-safe: derived from persona +
 * path only, never the answer. Unknown ids (the labeled /robots clanker) get
 * style 0 — the original sharp brain.
 */
export function botStyleFor(personaId: string, roomPath: string): number {
  const i = PERSONAS.findIndex((p) => p.id === personaId);
  if (i < 0) return 0;
  return (i + fnv1a(`style:${roomPath}`)) % PERSONAS.length;
}

/**
 * "Their hour": when this persona plays the word of the day. Deterministic per
 * (persona, date) — no Math.random (hibernation/replay-safe) — but different every
 * day, so the cast reads as people with routines, not cron jobs. UTC, matching
 * activeDate()'s day boundary.
 */
export function wotdPlayTime(personaId: string, date: string): { hour: number; minute: number } {
  const h = fnv1a(`wotd:${personaId}:${date}`);
  return { hour: h % 24, minute: (h >>> 5) % 60 };
}

/**
 * Which personas are due to play `date`'s word at `nowMs` and aren't already in the
 * room. Pure — the Room DO's /bots/tick is a thin caller, so idempotence is tested
 * here, not in DO glue. Catch-up by design: a room poked late joins every overdue
 * persona at once.
 */
export function dueWotdPersonas(
  date: string,
  nowMs: number,
  present: ReadonlySet<string>,
): BotPersona[] {
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(dayStart) || nowMs < dayStart) return [];
  return PERSONAS.filter((p) => {
    if (present.has(p.id)) return false;
    const t = wotdPlayTime(p.id, date);
    return nowMs >= dayStart + (t.hour * 60 + t.minute) * 60_000;
  });
}
