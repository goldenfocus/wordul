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
