// Count letters that turned green in the player's LATEST guess but were not green
// in any earlier guess — the "new green" moments worth celebrating. Pure + testable.
export function newGreensInLast(guesses) {
  if (!guesses || guesses.length === 0) return 0;
  const last = guesses[guesses.length - 1];
  if (!last || !last.mask) return 0;
  const wasGreen = new Set();
  for (let g = 0; g < guesses.length - 1; g++) {
    const mask = guesses[g].mask || [];
    for (let i = 0; i < mask.length; i++) if (mask[i] === "green") wasGreen.add(i);
  }
  let count = 0;
  for (let i = 0; i < last.mask.length; i++) {
    if (last.mask[i] === "green" && !wasGreen.has(i)) count++;
  }
  return count;
}

// Count positions that turned yellow in the LATEST guess but were not yellow in any
// earlier guess at that position — the "new yellow" discoveries worth paying gold for.
export function newYellowsInLast(guesses) {
  if (!guesses || guesses.length === 0) return 0;
  const last = guesses[guesses.length - 1];
  if (!last || !last.mask) return 0;
  const wasYellow = new Set();
  for (let g = 0; g < guesses.length - 1; g++) {
    const mask = guesses[g].mask || [];
    for (let i = 0; i < mask.length; i++) if (mask[i] === "yellow") wasYellow.add(i);
  }
  let count = 0;
  for (let i = 0; i < last.mask.length; i++) {
    if (last.mask[i] === "yellow" && !wasYellow.has(i)) count++;
  }
  return count;
}

// Ordered list of the NEW discoveries in the player's LATEST guess — yellows first
// (small wins), then greens (big wins), positional (ascending column) within each
// group. This is the beat order the payout sequence walks. Duplicate-letter safe and
// per-position, same discipline as newGreensInLast/newYellowsInLast: a color already
// seen at that column in an earlier guess is NOT re-counted. Stays economy-free — no
// gold values here; gold.js attaches them when it consumes the list.
// Returns: Array<{index:number, kind:'yellow'|'green', letter:string}>.
// Invariant: filter(kind==='green').length === newGreensInLast(g) and the same for
// yellow — the staged beats total the identical discoveries as the old lump.
export function orderedDiscoveriesInLast(guesses) {
  if (!guesses || guesses.length === 0) return [];
  const last = guesses[guesses.length - 1];
  if (!last || !last.mask) return [];
  const wasGreen = new Set();
  const wasYellow = new Set();
  for (let g = 0; g < guesses.length - 1; g++) {
    const mask = guesses[g].mask || [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === "green") wasGreen.add(i);
      else if (mask[i] === "yellow") wasYellow.add(i);
    }
  }
  const word = last.word || "";
  const out = [];
  // Yellows first (ascending index)…
  for (let i = 0; i < last.mask.length; i++) {
    if (last.mask[i] === "yellow" && !wasYellow.has(i)) {
      out.push({ index: i, kind: "yellow", letter: word[i] });
    }
  }
  // …then greens (ascending index).
  for (let i = 0; i < last.mask.length; i++) {
    if (last.mask[i] === "green" && !wasGreen.has(i)) {
      out.push({ index: i, kind: "green", letter: word[i] });
    }
  }
  return out;
}

// --- Loss-side knowledge: which letters the player has PROVEN are dead. ---
// A letter is "dead" (the answer contains zero copies) only when it is gray
// SOMEWHERE and is NEVER green or yellow at ANY position in ANY guess. The two-pass
// rule is load-bearing: scoreGuess (src/color.ts) gives a duplicate letter one
// colored + one gray tile, so a letter can be gray at one column and green/yellow at
// another while the answer DOES contain it — flagging that as dead would wrongly
// penalize reuse. Mirrors the dup-safe discipline of newGreensInLast. Pure + testable.
// Returns a Set<string> of UPPERCASE dead letters.
export function deadLettersFrom(guesses) {
  if (!guesses || guesses.length === 0) return new Set();
  // Pass A: every letter that is green OR yellow anywhere — the answer contains it.
  const good = new Set();
  for (const g of guesses) {
    if (!g || !g.mask) continue;
    const word = g.word || "";
    for (let i = 0; i < g.mask.length; i++) {
      if (g.mask[i] === "green" || g.mask[i] === "yellow") {
        good.add((word[i] || "").toUpperCase());
      }
    }
  }
  // Pass B: a gray letter that never appears in `good` is truly dead.
  const dead = new Set();
  for (const g of guesses) {
    if (!g || !g.mask) continue;
    const word = g.word || "";
    for (let i = 0; i < g.mask.length; i++) {
      if (g.mask[i] === "gray") {
        const c = (word[i] || "").toUpperCase();
        if (c && !good.has(c)) dead.add(c);
      }
    }
  }
  return dead;
}

// Which already-proven-dead letters did the player WASTE by reusing them in the most
// recent accepted guess? Knowledge is derived from PRIOR guesses only (guesses before
// the last) — never let the current guess's own grays mark a letter dead and then
// penalize that same guess for a first-time discovery. Returns UNIQUE dead letters
// reused (deduped per-letter so the same dead letter typed twice counts once — matches
// the per-letter escalation Map the caller keys on). Pure + testable.
// Returns { letters: string[], count: number }.
export function wastedDeadLettersInLast(guesses) {
  if (!guesses || guesses.length < 2) return { letters: [], count: 0 };
  const last = guesses[guesses.length - 1];
  if (!last || !last.word) return { letters: [], count: 0 };
  const dead = deadLettersFrom(guesses.slice(0, -1)); // knowledge BEFORE the last guess
  const seen = new Set();
  const letters = [];
  const word = last.word || "";
  for (let i = 0; i < word.length; i++) {
    const c = (word[i] || "").toUpperCase();
    if (dead.has(c) && !seen.has(c)) {
      seen.add(c);
      letters.push(c);
    }
  }
  return { letters, count: letters.length };
}
