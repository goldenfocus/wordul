// src/scoreboard.ts — pure per-room cumulative tally (no Cloudflare deps).

export type RoomScore = { username: string; wins: number; played: number };

export function bumpScoreboard(
  board: RoomScore[],
  round: { winner: string | null; participants: string[] },
): RoomScore[] {
  const map = new Map(board.map((e) => [e.username, { ...e }]));
  for (const u of round.participants) {
    const e = map.get(u) ?? { username: u, wins: 0, played: 0 };
    e.played += 1;
    if (round.winner === u) e.wins += 1;
    map.set(u, e);
  }
  return [...map.values()];
}
