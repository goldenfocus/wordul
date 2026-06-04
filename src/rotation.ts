// src/rotation.ts — pure 1v1 seat + king-of-the-hill rotation (no Cloudflare deps).

export const MAX_DUELISTS = 2;

export type Throne = { username: string; streak: number } | null;

/** Seat for a newly joining player: a duelist seat while fewer than two are taken
 *  (by role — a disconnected duelist still holds their seat), otherwise the queue. */
export function nextSeatRole(players: { role: "duelist" | "queued" }[]): "duelist" | "queued" {
  const taken = players.filter((p) => p.role === "duelist").length;
  return taken < MAX_DUELISTS ? "duelist" : "queued";
}

export type KothInput = {
  duelists: string[];     // current duelist usernames (rotation only acts when there are two)
  winner: string | null;  // round winner, or null for a tie (nobody solved)
  queue: string[];        // waiting usernames, front = next challenger
  throne: Throne;
};
export type KothResult = { duelists: string[]; queue: string[]; throne: Throne };

/** King-of-the-hill advance, applied when a round ends. Winner keeps the throne
 *  (streak grows; a new winner resets it to 1); the loser drops to the back of the
 *  queue and the front steps up. A tie keeps the reigning king and sends the
 *  challenger to the back. An empty queue means the same two simply rematch. */
export function applyKothRotation(input: KothInput): KothResult {
  const { duelists, winner, queue, throne } = input;
  if (duelists.length < MAX_DUELISTS) return { duelists, queue, throne };
  const [d0, d1] = duelists;

  let champ: string;
  let challenged: string;
  let nextThrone: Throne;
  if (winner) {
    champ = winner;
    challenged = winner === d0 ? d1 : d0;
    nextThrone = throne && throne.username === champ
      ? { username: champ, streak: throne.streak + 1 }
      : { username: champ, streak: 1 };
  } else if (throne && (throne.username === d0 || throne.username === d1)) {
    champ = throne.username;
    challenged = throne.username === d0 ? d1 : d0;
    nextThrone = throne;
  } else {
    return { duelists: [d0, d1], queue, throne }; // tie, no reigning king → rematch
  }

  if (queue.length === 0) {
    return { duelists: [champ, challenged], queue, throne: nextThrone };
  }
  return { duelists: [champ, queue[0]], queue: [...queue.slice(1), challenged], throne: nextThrone };
}
