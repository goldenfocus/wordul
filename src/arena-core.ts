// Pure, fully-tested index reducer for the ARENA coordinator. Zero Cloudflare deps so
// it runs under plain Vitest. The DO wrapper (arena.ts) is the only thing that persists
// the ArenaState this module produces.

export type SeedStatus = "minted" | "registered" | "closed";

export type SeedRec = {
  path: string; // DO key form: "arena/<personaId>-<seedCount>"
  routePath: string; // routable form: "/@arena/<personaId>-<seedCount>" ← client navigates here
  name: string; // room display name
  host: string; // persona display name (looks human)
  personaId: string; // stable key: persona uniqueness + H2H
  personaIcon: string; // human avatar (emoji)
  edition: string; // theme id from the existing library
  wordLength: number; // always 5 in v1
  seats: string; // "1/2"
  mintedAt: number; // epoch ms at mint
  status: SeedStatus;
};

export type ArenaState = { seeded: Record<string, SeedRec>; seedCount: number };

export type ArenaEvent =
  | { type: "mint"; rec: SeedRec }
  | { type: "publish"; rec: SeedRec }
  | { type: "register"; path: string }
  | { type: "close"; path: string };

// Client projection — NO internal fields (no mintedAt, status, personaId).
export type OpenGame = Pick<
  SeedRec,
  "routePath" | "name" | "host" | "personaIcon" | "edition" | "wordLength" | "seats"
>;

export const STALE_MS = 60_000; // minted-not-registered TTL
export const MAX_OPEN_MS = 4 * 60 * 60 * 1000; // registered max lifetime FROM MINT
export const TARGET_OPEN = 3;
export const MAX_SEEDED = 10;

// --- Living Arena (v2 inc.1): liveliness knobs. desiredOpen drifts within this band; each
// seeded room gets a jittered lifetime and a weighted word length. All chosen by PURE
// helpers taking an injected roll so arena.ts (Math.random) stays the only impure layer.
export const ARENA_MIN_OPEN = 1;
export const ARENA_MAX_OPEN = 6;
export const LIFETIME_MIN_MS = 45_000;
export const LIFETIME_MAX_MS = 180_000;
// Friendly lengths common, long ones rare — atmosphere without a wall of brutal rooms.
export const LENGTH_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [4, 3], [5, 5], [6, 3], [7, 2], [8, 1], [9, 1],
];

// Random-walk the desired open-room count one step within [MIN, MAX]. roll in [0,1):
// low third → -1, high third → +1, middle → hold. A slow tide, never a sawtooth.
export function driftTarget(current: number, roll: number): number {
  const base = Number.isFinite(current) ? current : ARENA_MIN_OPEN;
  let next = base;
  if (roll < 1 / 3) next = base - 1;
  else if (roll >= 2 / 3) next = base + 1;
  return Math.max(ARENA_MIN_OPEN, Math.min(ARENA_MAX_OPEN, next));
}

// Weighted pick of a seeded room's word length. roll in [0,1).
export function rollWordLength(roll: number): number {
  const total = LENGTH_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let t = Math.max(0, Math.min(0.999999, roll)) * total;
  for (const [len, w] of LENGTH_WEIGHTS) {
    if (t < w) return len;
    t -= w;
  }
  return LENGTH_WEIGHTS[LENGTH_WEIGHTS.length - 1][0];
}

// A seeded room's jittered expiry budget (ms from mint). roll in [0,1).
export function rollLifetime(roll: number): number {
  const r = Math.max(0, Math.min(1, roll));
  return Math.round(LIFETIME_MIN_MS + r * (LIFETIME_MAX_MS - LIFETIME_MIN_MS));
}

export function emptyArenaState(): ArenaState {
  return { seeded: {}, seedCount: 0 };
}

export function apply(state: ArenaState, event: ArenaEvent): ArenaState {
  switch (event.type) {
    case "mint":
      return {
        seedCount: state.seedCount + 1,
        seeded: { ...state.seeded, [event.rec.path]: { ...event.rec, status: "minted" } },
      };
    case "publish":
      // A human-hosted public room: already live (no mint/seed handshake), so it goes
      // straight to "registered" and does NOT consume a persona seedCount.
      return {
        ...state,
        seeded: { ...state.seeded, [event.rec.path]: { ...event.rec, status: "registered" } },
      };
    case "register": {
      const cur = state.seeded[event.path];
      // No-op if missing or already closed — register must never resurrect a closed room.
      if (!cur || cur.status !== "minted") return state;
      return {
        ...state,
        seeded: { ...state.seeded, [event.path]: { ...cur, status: "registered" } },
      };
    }
    case "close": {
      const cur = state.seeded[event.path];
      if (!cur) return state;
      return {
        ...state,
        seeded: { ...state.seeded, [event.path]: { ...cur, status: "closed" } },
      };
    }
  }
}

// Drop minted that never registered (STALE_MS), registered past MAX_OPEN_MS measured
// FROM MINT (not reset on register — review fix, defect 7), and always GC closed.
export function prune(state: ArenaState, nowMs: number): ArenaState {
  const seeded: Record<string, SeedRec> = {};
  for (const [path, r] of Object.entries(state.seeded)) {
    if (r.status === "closed") continue;
    if (r.status === "minted" && nowMs - r.mintedAt > STALE_MS) continue;
    if (r.status === "registered" && nowMs - r.mintedAt > MAX_OPEN_MS) continue;
    seeded[path] = r;
  }
  return { ...state, seeded };
}

export function openGames(state: ArenaState): OpenGame[] {
  return Object.values(state.seeded)
    .filter((r) => r.status === "registered")
    .map((r) => ({
      routePath: r.routePath,
      name: r.name,
      host: r.host,
      personaIcon: r.personaIcon,
      edition: r.edition,
      wordLength: r.wordLength,
      seats: r.seats,
    }));
}

export function liveCount(state: ArenaState): number {
  return Object.values(state.seeded).filter((r) => r.status !== "closed").length;
}

// The monotonic seedCount makes every mint's key unique. `path` is the DO key (idFromName);
// `routePath` is what the client navigates to — the worker's ROOM_RE accepts /@arena/<slug>
// and resolves /ws?room=arena/<slug> to the byte-identical key.
export function seedPaths(personaId: string, seedCount: number): { path: string; routePath: string } {
  const slug = `${personaId}-${seedCount}`;
  return { path: `arena/${slug}`, routePath: `/@arena/${slug}` };
}
