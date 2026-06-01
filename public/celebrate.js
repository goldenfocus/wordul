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
