// Pure end-of-race copy derivation — no DOM, no imports, unit-tested via test/race-copy.test.js.
// Now that the first solve ends the race, a player can lose two ways:
//   - "outpaced": still had guess rows left but an opponent solved first, or
//   - "exhausted": used every row.
// Returns the key suffix; app.js maps it to an endscreen.* i18n key. null = not a loss.
export function lossKind({ status, guessCount, maxGuesses, winner, me }) {
  if (status !== "lost") return null;
  const outpaced = !!winner && winner !== me && guessCount < maxGuesses;
  return outpaced ? "outpaced" : "exhausted";
}

// The untold-duel verdict. A ?vs= challenge races in the dark — no live ghost, no
// spoilers — and settles HERE, at the end, on what's real: guesses. (Never replay
// timing; a re-cut tape's pacing is synthetic.) Solve beats bust; fewer rows beats
// more; equal rows is a dead heat.
export function duelVerdict({ myWon, myGuesses, maxGuesses, theirWon, theirGuesses, name }) {
  const mine = myWon ? `${myGuesses}/${maxGuesses}` : `X/${maxGuesses}`;
  const theirs = theirWon ? `${theirGuesses}/${maxGuesses}` : `X/${maxGuesses}`;
  if (!myWon && !theirWon) return "The word beat you both. Some words keep their secrets.";
  if (myWon && (!theirWon || myGuesses < theirGuesses)) return `You out-worded @${name} — ${mine} vs ${theirs} 👑`;
  if (myWon && theirWon && myGuesses === theirGuesses) return `Dead heat — you both got it in ${mine}. Twinning.`;
  return `@${name} takes it — ${theirs} vs your ${mine}.`;
}
