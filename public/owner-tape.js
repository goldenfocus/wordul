// public/owner-tape.js — re-cut the owner's finished run as a ghost tape at mint
// time, so a /c/<id> visitor races a replay of the challenger instead of a static
// score line. Masks only (no letters, no answer) — the same hidden-word rule as the
// arena tapes the Room DO records.
// When real commit times (from game.myGuessTimes + myRoundStartAt) are supplied and
// complete, use *exact* offsets (first row = commit0 - roundStart; subsequent = real gaps).
// No MIN/MAX clamping — "if it took 10 minutes so be it". Falls back to fixed cadence only
// on incomplete/missing times (mid-game reloads etc). This mirrors the server tapeFromSolveGrid
// behavior for legacy vs new GameRecords.
export const FIRST_GUESS_MS = 4500;
export const DEFAULT_GAP_MS = 7000;

export function buildOwnerTape({ username, wordLength, maxGuesses, masks, won, times, startAt = null }) {
  if (!Array.isArray(masks) || masks.length === 0) return null;
  // Times must cover every row (a mid-game reload loses the early ones) — else cadence.
  const haveTimes = Array.isArray(times) && times.length === masks.length;
  const events = [];
  let t = 0;
  for (let i = 0; i < masks.length; i++) {
    if (haveTimes) {
      if (i === 0) {
        // Real first offset from when the round actually started for this player (lobby→playing).
        // Falls back to the old synthetic lead-in only if no startAt was captured.
        t = (startAt != null) ? Math.max(0, times[0] - startAt) : FIRST_GUESS_MS;
      } else {
        t += (times[i] - times[i - 1]); // exact gap, no clamping
      }
    } else {
      t += i === 0 ? FIRST_GUESS_MS : DEFAULT_GAP_MS;
    }
    const last = i === masks.length - 1;
    events.push({
      t, u: username, k: "guess",
      mask: masks[i].slice(),
      status: last ? (won ? "won" : "lost") : "playing",
    });
  }
  events.push({ t, u: username, k: "finish", status: won ? "won" : "lost", guesses: masks.length });
  return { v: 1, wordLength, maxGuesses, players: [{ username, host: true }], events };
}
