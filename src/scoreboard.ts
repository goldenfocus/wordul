// src/scoreboard.ts — pure per-room cumulative W/L/T tally (no Cloudflare deps).

export type RoomScore = { username: string; wins: number; losses: number; ties: number; played: number };

export function bumpScoreboard(
  board: { username: string; wins: number; played: number; losses?: number; ties?: number }[],
  round: { winner: string | null; participants: string[] },
): RoomScore[] {
  // Spread fills losses/ties=0 for any legacy entry that predates W/L/T.
  const map = new Map<string, RoomScore>(
    board.map((e) => [e.username, { losses: 0, ties: 0, ...e } as RoomScore]),
  );
  for (const u of round.participants) {
    const e = map.get(u) ?? { username: u, wins: 0, losses: 0, ties: 0, played: 0 };
    e.played += 1;
    if (round.winner === null) e.ties += 1;
    else if (round.winner === u) e.wins += 1;
    else if (round.participants.includes(round.winner)) e.losses += 1; // a real opponent won
    map.set(u, e);
  }
  return [...map.values()];
}
