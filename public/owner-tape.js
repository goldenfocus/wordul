// public/owner-tape.js — re-cut the owner's finished run as a ghost tape at mint
// time, so a /c/<id> visitor races a replay of the challenger instead of a static
// score line. Masks only (no letters, no answer) — the same hidden-word rule as the
// arena tapes the Room DO records. Pacing is clamped: a daily left open for three
// hours must not replay for three hours.
export const FIRST_GUESS_MS = 4500;  // lead-in before the first row lands
export const MIN_GAP_MS = 1200;      // floor — rows never machine-gun
export const MAX_GAP_MS = 12000;     // ceiling — marathon pauses compress
export const DEFAULT_GAP_MS = 7000;  // cadence when commit times are unknown

export function buildOwnerTape({ username, wordLength, maxGuesses, masks, won, times }) {
  if (!Array.isArray(masks) || masks.length === 0) return null;
  // Times must cover every row (a mid-game reload loses the early ones) — else cadence.
  const haveTimes = Array.isArray(times) && times.length === masks.length;
  const events = [];
  let t = 0;
  for (let i = 0; i < masks.length; i++) {
    const gap = haveTimes && i > 0 ? times[i] - times[i - 1] : DEFAULT_GAP_MS;
    t += i === 0 ? FIRST_GUESS_MS : Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, gap));
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
