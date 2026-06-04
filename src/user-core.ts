// Pure profile helpers (mirrors daily-core.ts). No Cloudflare deps so the money-path
// self-heal + H2H logic is unit-testable in isolation. The USER DO calls these; it owns
// all persistence (ctx.storage.put).
import type { UserProfile } from "./types.ts";
import { emptyStats } from "./stats.ts";

// A brand-new profile, anchored on first contact (any access path).
export function freshProfile(username: string): UserProfile {
  return {
    username,
    createdAt: Date.now(),
    stats: emptyStats(),
    games: [],
    ownedRooms: [],
    ledger: [],
    balances: {},
    h2h: {},
  };
}

// Idempotent self-heal applied on every load. Mutates and returns `saved`. The caller
// persists only if something actually changed. The ledger→balances rebuild is the
// load-bearing gold-path invariant (do NOT drop it); h2h backfill is the only addition.
export function healProfile(saved: UserProfile, username: string): UserProfile {
  if (!saved.username && username) saved.username = username;
  if (!Array.isArray(saved.ledger)) saved.ledger = [];
  if (!saved.balances) {
    saved.balances = {};
    for (const tx of saved.ledger ?? []) {
      saved.balances[tx.token] = (saved.balances[tx.token] ?? 0) + tx.delta;
    }
  }
  if (!saved.h2h) saved.h2h = {};
  return saved;
}

// Increment the (w|l) counter for one persona. Mutates the passed map in place.
export function applyH2H(
  h2h: Record<string, { w: number; l: number }>,
  personaId: string,
  result: "w" | "l",
): void {
  const cur = h2h[personaId] ?? { w: 0, l: 0 };
  if (result === "w") cur.w += 1;
  else cur.l += 1;
  h2h[personaId] = cur;
}
