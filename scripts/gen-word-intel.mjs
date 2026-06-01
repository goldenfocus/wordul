#!/usr/bin/env node
// Wordul — word-intel generator.
//
// Produces the def + fact + quote entries that power the end-screen word card, for
// every answer word in src/wordsbysize.ts, via Claude. It MERGES into the existing
// public/data/word-intel.js (hand-seeded entries are never overwritten) so it's safe
// to re-run and resume — only missing words are generated.
//
// Usage:
//   export ANTHROPIC_API_KEY=...        # from: sops -d ~/golden-vault/secrets/<file>
//   node scripts/gen-word-intel.mjs            # generate everything still missing
//   node scripts/gen-word-intel.mjs --limit 50 # cap this run (batch in chunks)
//   node scripts/gen-word-intel.mjs WORD WORD2 # just these words
//
// Quotes must be REAL and correctly attributed; the prompt tells the model to omit the
// quote rather than invent one. Spot-check a sample before shipping a big batch.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INTEL_PATH = join(ROOT, "public/data/word-intel.js");
const WORDS_PATH = join(ROOT, "src/wordsbysize.ts");
const MODEL = "claude-opus-4-8";

function die(msg) { console.error(msg); process.exit(1); }

if (!process.env.ANTHROPIC_API_KEY) {
  die("ANTHROPIC_API_KEY not set. Decrypt it from the vault first:\n" +
      "  export ANTHROPIC_API_KEY=$(sops -d ~/golden-vault/secrets/<file>.env | grep ANTHROPIC_API_KEY | cut -d= -f2-)");
}

// Pull the answer pools (the words that can actually be the solution) out of the TS
// module: each `const A<len> = "WORD,WORD,..."` literal is an answers list.
function answerWords() {
  const src = readFileSync(WORDS_PATH, "utf8");
  const out = new Set();
  for (const m of src.matchAll(/const A\d+\s*=\s*"([A-Z,]+)"/g)) {
    for (const w of m[1].split(",")) if (w) out.add(w);
  }
  return [...out];
}

// Read the words already covered so we can skip them (resume-friendly).
function existingWords() {
  const js = readFileSync(INTEL_PATH, "utf8");
  const out = new Set();
  for (const m of js.matchAll(/^\s{2}([A-Z]{3,})\s*:\s*\{/gm)) out.add(m[1]);
  return out;
}

const client = new Anthropic();

async function intelFor(word) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      "You write tiny, accurate, delightful 'word intel' cards for a word game. " +
      "Return ONLY JSON: {\"def\":\"\",\"fact\":\"\",\"quote\":\"\",\"author\":\"\"}. " +
      "def: one crisp sentence. fact: one surprising, TRUE philosophical or scientific " +
      "fact connected to the word. quote: a short, REAL, correctly-attributed quote from " +
      "a great mind that resonates with the word — if you are not certain it is genuine, " +
      "set quote and author to empty strings. No markdown.",
    messages: [{ role: "user", content: `Word: ${word}` }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

// Re-serialize the whole map as a clean ES module (stable key order).
function writeIntel(map) {
  const keys = Object.keys(map).sort();
  const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const body = keys.map((k) => {
    const e = map[k];
    const lines = [`  ${k}: {`, `    def: "${esc(e.def)}",`, `    fact: "${esc(e.fact)}",`];
    if (e.quote) { lines.push(`    quote: "${esc(e.quote)}",`); lines.push(`    author: "${esc(e.author)}",`); }
    lines.push("  },");
    return lines.join("\n");
  }).join("\n");
  const header = readFileSync(INTEL_PATH, "utf8").split("export const WORD_INTEL")[0];
  const footer =
    "\n// Look up intel for a word (case-insensitive). Returns null when we have nothing —\n" +
    "// the word card then falls back to the live dictionary definition.\n" +
    "export function wordIntel(word) {\n" +
    "  return WORD_INTEL[String(word || \"\").toUpperCase()] || null;\n}\n";
  writeFileSync(INTEL_PATH, `${header}export const WORD_INTEL = {\n${body}\n};\n${footer}`);
}

// Load the current map by importing it (data-URL bust so re-imports see fresh content).
async function loadMap() {
  const mod = await import(`file://${INTEL_PATH}?t=${Date.now()}`);
  return { ...mod.WORD_INTEL };
}

async function main() {
  const args = process.argv.slice(2);
  let limit = Infinity;
  const li = args.indexOf("--limit");
  if (li >= 0) { limit = parseInt(args[li + 1], 10) || Infinity; args.splice(li, 2); }
  const explicit = args.filter((a) => /^[A-Za-z]+$/.test(a)).map((a) => a.toUpperCase());

  const have = existingWords();
  const todo = (explicit.length ? explicit : answerWords())
    .filter((w) => explicit.length || !have.has(w))
    .slice(0, limit);

  if (!todo.length) return console.log("Nothing to generate — all answers covered.");
  console.log(`Generating intel for ${todo.length} words…`);

  const map = await loadMap();
  let done = 0;
  for (const word of todo) {
    try {
      map[word] = await intelFor(word);
      writeIntel(map);           // persist after each word — resumable on crash
      console.log(`  ✓ ${word} (${++done}/${todo.length})`);
    } catch (e) {
      console.warn(`  ✗ ${word}: ${e.message}`);
    }
  }
  console.log(`Done. ${done} words written to ${INTEL_PATH}.`);
}

main().catch((e) => die(e.stack || String(e)));
