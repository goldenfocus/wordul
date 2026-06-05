// De-Wordle vocabulary ratchet (see the spec:
// docs/superpowers/specs/2026-06-05-dewordle-rename-design.md).
//
// wordul's match vocabulary was renamed off Wordle's words:
//   green  -> hot    (right letter, right spot — renders ultraviolet)
//   yellow -> warm   (right letter, wrong spot)
//   gray   -> cold   (not in the word)
//   wasted -> bad    (the dead-letter-reuse penalty LABEL)
//
// This is a RATCHET. It greps src/ + public/ and FAILS if any of the OLD tokens
// reappear as a live code reference:
//   • "green" / "yellow" / "gray" as a quoted Color/mask/discovery-kind value
//   • .tile.green / .key.green / .preview-tile.green (+ .yellow/.gray) selectors
//   • green-spark / yellow-spark / gray-spark animation classes
//   • --green / --yellow / --gray CSS custom properties (defs or var() refs)
//   • data-flip="green" (+ "yellow"/"gray") HTML attribute values
//   • a standalone quoted "wasted" / 'wasted' penalty label
//
// It is deliberately TARGETED so incidental English never trips it: the words
// "hot", "warm", "cold" are the NEW vocab and unbounded; and a handful of OLD-word
// IDENTIFIERS are legitimately retained and allow-listed below (they are NOT mask
// values, CSS, or labels — renaming them is out of the rename's scope):
//   • POINTS.green / POINTS.yellow — economy-constant object keys (src/economy.ts)
//   • science.ts countMask()/science-event keys green/yellow/gray — a separate
//     aggregate-stat axis on the persisted science wire, not a tile mask
//   • English identifiers like greenedPositions, newGreensInLast, wastedDeadLettersInLast,
//     wastedLetterPenalty — function/var/constant names, not the rebranded tokens
//   • prose in comments ("phosphor green", "gray tap highlight", "cold deep-link")
//
// To clear a future failure: rename the offending token to the new vocab. NEVER
// widen the allow-list to silence a real mask/CSS/label regression.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const PUBLIC = join(ROOT, "public");

// Collect every file we audit: all of src/ and public/ (recursively), restricted
// to the source/markup/style extensions the rename touched.
//
// EXCLUDED: the word-wiki SEO corpus (public/word/** and public/words.html) is pure
// English prose + the self-contained `wp-*` page classes — it carries NO tile-mask
// vocabulary (verified: zero data-flip / .tile.* / --green / *-spark tokens there),
// but it is full of incidental quoted English ("green plant", 'green' etymology) that
// would false-positive the prose-prone quoted-value rule. Skipping it keeps the guard
// targeted at the game code where the rebranded tokens actually live.
const EXTS = new Set([".ts", ".js", ".mjs", ".css", ".html"]);
const WIKI_DIR = join(PUBLIC, "word");
const WIKI_INDEX = join(PUBLIC, "words.html");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (full === WIKI_DIR) continue; // skip the SEO word-wiki prose corpus
    if (entry.isDirectory()) out.push(...walk(full));
    else if (full !== WIKI_INDEX && EXTS.has(full.slice(full.lastIndexOf(".")))) out.push(full);
  }
  return out;
}
const FILES = [...walk(SRC), ...walk(PUBLIC)];

// Each rule: a name, a regex that matches the OLD token as a LIVE code reference,
// and a sample string the regex MUST match (proving the guard is wired, not a
// permanently-green no-op).
type Rule = { name: string; re: RegExp; sample: string };
const RULES: Rule[] = [
  {
    name: 'quoted Color/mask/kind value "green" | "yellow" | "gray"',
    re: /["'](?:green|yellow|gray)["']/,
    sample: 'result[i] = "green";',
  },
  {
    name: ".tile / .key / .preview-tile .green|.yellow|.gray selector",
    re: /\.(?:tile|key|preview-tile)\.(?:green|yellow|gray)\b/,
    sample: ".tile.green { background: var(--green); }",
  },
  {
    name: "green-spark | yellow-spark | gray-spark animation class",
    re: /\b(?:green|yellow|gray)-spark\b/,
    sample: ".green-spark { animation: green-spark 0.7s; }",
  },
  {
    name: "--green | --yellow | --gray CSS custom property",
    re: /--(?:green|yellow|gray)\b/,
    sample: ":root { --green: #9d8bff; } a { color: var(--green); }",
  },
  {
    name: 'data-flip="green" | "yellow" | "gray"',
    re: /data-flip=["']?(?:green|yellow|gray)\b/,
    sample: '<span class="tile" data-flip="green">H</span>',
  },
  {
    name: 'quoted/templated "wasted" penalty LABEL (renamed to "bad")',
    // A string/template that STARTS with the word "wasted" as the log label —
    // quote or backtick, then `wasted`, then a word boundary (space, punctuation,
    // or the closing delimiter). Deliberately NOT matched: the retained identifiers
    // wastedLetterPenalty / wastedCapPerGuess / wastedDeadLettersInLast, which are
    // never preceded by an opening quote.
    re: /["'`]wasted(?:\b|["'`])/,
    sample: 'penaltyLines.push("wasted " + letter);',
  },
];

describe("de-wordle vocab ratchet", () => {
  // Sanity: every rule's regex actually matches its sample. If a regex is silently
  // broken (always-false), this fails LOUDLY rather than letting the audit pass
  // vacuously — the same self-proving trick as the ios-input-zoom guard.
  it("each rule's regex matches its sample token (guard is live, not a no-op)", () => {
    for (const r of RULES) {
      expect(r.re.test(r.sample), `rule "${r.name}" failed to match its own sample`).toBe(true);
    }
  });

  it("audits a non-trivial set of src/ + public/ files", () => {
    // Guards against a glob/walk regression that would silently scan nothing.
    expect(FILES.length).toBeGreaterThan(40);
  });

  it("no old Wordle vocabulary (green/yellow/gray/wasted) reappears as a live token", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const r of RULES) {
          if (r.re.test(line)) {
            offenders.push(`${file.replace(ROOT + "/", "")}:${i + 1}  [${r.name}]  ${line.trim()}`);
          }
        }
      });
    }
    expect(
      offenders,
      `Old Wordle vocab reappeared — rename to hot/warm/cold (tiles) or bad (penalty):\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
