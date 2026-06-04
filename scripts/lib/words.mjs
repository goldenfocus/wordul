// scripts/lib/words.mjs — build-side mirror of src/words.ts, reading the TS sources by
// regex (the same trick gen-word-intel.mjs already uses for the answer pools) so the
// generator and the worker never drift.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function answerWords() {
  const src = readFileSync(join(ROOT, "src/wordsbysize.ts"), "utf8");
  const out = new Set();
  for (const m of src.matchAll(/const A\d+\s*=\s*"([A-Z,]+)"/g))
    for (const w of m[1].split(",")) if (w.length === 5) out.add(w);
  return [...out];
}

export function exclusions() {
  const src = readFileSync(join(ROOT, "src/word-exclusions.ts"), "utf8");
  const block = src.slice(src.indexOf("["), src.indexOf("]") + 1);
  return new Set([...block.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1].toUpperCase()));
}

export const slugFor = (w) => w.toLowerCase();
