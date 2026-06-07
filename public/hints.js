// Wordul — Easy-mode typing hints (pure; no DOM, no app.js imports)
// Derives what prior guesses PROVED about each letter of the pending word, so the
// typing row can confirm/warn live. Honest-claims rule: every hint is a statement
// proven by prior masks — nothing speculative.
//   "dead"      — letter proven absent (gray somewhere, never green/yellow anywhere)
//   "confirmed" — this letter was proven GREEN at exactly this column
//   "present"   — letter proven in the word (green/yellow anywhere), slot unproven
//   null        — nothing proven about this letter
// Reuses deadLettersFrom (celebrate.js) — the dup-letter-safe two-pass — rather than
// duplicating that logic. Mirrors the purity discipline of celebrate.js/roomConfig.js.
import { deadLettersFrom } from "/celebrate.js";

export function typingHints(pending, guesses) {
  const word = (pending || "").toUpperCase();
  const out = new Array(word.length).fill(null);
  if (!word.length) return out;
  const dead = deadLettersFrom(guesses || []);
  const greenAt = new Map(); // col -> letter proven hot there
  const present = new Set(); // letters proven in-word (hot or warm anywhere)
  for (const gRow of guesses || []) {
    if (!gRow || !gRow.mask) continue;
    const w = gRow.word || "";
    for (let i = 0; i < gRow.mask.length; i++) {
      const c = (w[i] || "").toUpperCase();
      if (gRow.mask[i] === "hot") { greenAt.set(i, c); present.add(c); }
      else if (gRow.mask[i] === "warm") present.add(c);
    }
  }
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    // confirmed/dead are mutually exclusive by construction: deadLettersFrom's
    // two-pass excludes any letter ever hot/warm, so a greenAt match can't be dead.
    // confirmed is checked first anyway — the clearer order if that ever changes.
    if (greenAt.get(i) === c) out[i] = "confirmed";
    else if (dead.has(c)) out[i] = "dead";
    else if (present.has(c)) out[i] = "present";
  }
  return out;
}
