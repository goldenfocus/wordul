// Pure persona roster + deterministic picker + the SINGLE outbound disguise helper.
// No solver/wordsbysize/room runtime imports — only a type-import of PlayerState. The
// disguise (projectPlayerForClient) is the one enforcement point that makes live seeding
// (Slice D) safe: isBot is kept server-side and stripped on every outbound projection.
import type { PlayerState } from "./types.ts";

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
