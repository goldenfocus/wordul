// src/duel.ts — pure duel/ready logic (no Cloudflare deps), unit-tested in test/duel.test.ts.

/** How long the 3-2-1-GO countdown runs before the round goes live. */
export const COUNTDOWN_MS = 3000;

/** A countdown begins only when there is at least one connected player and every
 *  connected player has readied up. Disconnected players are ignored (a player who
 *  dropped in the lobby never blocks the rest). */
export function everyoneReady(players: { connected: boolean; ready: boolean }[]): boolean {
  const active = players.filter((p) => p.connected);
  if (active.length === 0) return false;
  return active.every((p) => p.ready);
}
