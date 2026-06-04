// scripts/lib/word-graph.mjs — pure, build-time. Given the answer-word list, compute
// per-word related sets used to render internal links on each wiki page.
const CAP = 12;
const sortLetters = (w) => w.split("").sort().join("");

export function buildWordGraph(words) {
  const all = [...words];
  const set = new Set(all);
  // Anagram buckets keyed by sorted letters.
  const byLetters = new Map();
  for (const w of all) {
    const k = sortLetters(w);
    (byLetters.get(k) ?? byLetters.set(k, []).get(k)).push(w);
  }
  // Shared-start buckets keyed by first 2 letters.
  const byPrefix = new Map();
  for (const w of all) {
    const k = w.slice(0, 2);
    (byPrefix.get(k) ?? byPrefix.set(k, []).get(k)).push(w);
  }
  const graph = new Map();
  for (const w of all) {
    const anagrams = (byLetters.get(sortLetters(w)) ?? []).filter((x) => x !== w).slice(0, CAP);
    const ladder = [];
    for (let i = 0; i < w.length; i++) {
      for (let c = 65; c <= 90; c++) {
        const cand = w.slice(0, i) + String.fromCharCode(c) + w.slice(i + 1);
        if (cand !== w && set.has(cand)) ladder.push(cand);
      }
    }
    const sharedStart = (byPrefix.get(w.slice(0, 2)) ?? []).filter((x) => x !== w).slice(0, CAP);
    graph.set(w, { anagrams, ladder: ladder.slice(0, CAP), sharedStart });
  }
  return graph;
}
