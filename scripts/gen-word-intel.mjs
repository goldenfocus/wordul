#!/usr/bin/env node
// Wordul — word-intel generator.
//
// Produces the def + fact + quote entries that power the end-screen word card, for
// every answer word in src/wordsbysize.ts, via Claude. It MERGES into the existing
// public/data/word-intel.js (hand-seeded entries are never overwritten) so it's safe
// to re-run and resume — only missing words are generated.
//
// Usage:
//   # Cloud (Claude) — needs the vault key:
//   export ANTHROPIC_API_KEY=...        # from: sops -d ~/golden-vault/secrets/<file>
//   node scripts/gen-word-intel.mjs            # generate everything still missing
//   node scripts/gen-word-intel.mjs --limit 50 # cap this run (batch in chunks)
//   node scripts/gen-word-intel.mjs WORD WORD2 # just these words
//   node scripts/gen-word-intel.mjs --length 4 # target the 4-letter answer pool (default 5)
//   # Local (Ollama) — free, no key:
//   node scripts/gen-word-intel.mjs --local                    # default model
//   node scripts/gen-word-intel.mjs --local --model qwen3:14b  # higher quality, slower
//   # Offline self-check (no API, no spend) — proves --length selects the right pool:
//   node scripts/gen-word-intel.mjs --check          # checks default length 5
//   node scripts/gen-word-intel.mjs --check --length 4
//
// Quotes: in cloud mode the prompt demands REAL, correctly-attributed quotes (omit if
// unsure). In --local mode quotes are NEVER generated and are hard-blanked — a local
// model's invented/misattributed quote on a public indexed page is a real trust risk.
// Either way, spot-check a sample before shipping a big batch.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INTEL_PATH = join(ROOT, "public/data/word-intel.js");
const WORDS_PATH = join(ROOT, "src/wordsbysize.ts");

function die(msg) { console.error(msg); process.exit(1); }

// Pull the answer pool for a given length out of the TS module by reading the literal that
// backs WORDS_BY_SIZE[length].answers. Length 5 keeps a dedicated answers list in
// `const A5 = "..."` (the classic game); every other length N uses a single pool declared as
// `const W<N> = "..."` that doubles as answers + valid guesses. Default length = 5 keeps the
// historical behavior (was a blanket scan of every `const A\d+`, of which only A5 exists).
function poolVarFor(length) {
  return length === 5 ? "A5" : `W${length}`;
}
function answerWords(length = 5) {
  const src = readFileSync(WORDS_PATH, "utf8");
  const name = poolVarFor(length);
  const re = new RegExp(`const ${name}\\s*=\\s*"([A-Z,]+)"`);
  const m = src.match(re);
  if (!m) die(`No answer pool '${name}' found in ${WORDS_PATH} for length ${length}.`);
  const out = new Set();
  for (const w of m[1].split(",")) if (w) out.add(w);
  return [...out];
}

// Offline proof that --length picks the correct pool. Compares the words this script would
// generate intel for against src/words.ts's answerWordsForLength(n) — no API call, no spend.
async function selfCheck(length) {
  const { answerWordsForLength } = await import(`file://${join(ROOT, "src/words.ts")}`);
  const fromScript = new Set(answerWords(length));
  const fromSrc = answerWordsForLength(length);
  const wrong = [...fromScript].filter((w) => w.length !== length);
  const missing = [...fromSrc].filter((w) => !fromScript.has(w));
  const extra = [...fromScript].filter((w) => !fromSrc.has(w));
  if (wrong.length || missing.length || extra.length || fromScript.size === 0) {
    die(`✗ length ${length} pool mismatch: size=${fromScript.size} ` +
        `wrongLen=${wrong.length} missing=${missing.length} extra=${extra.length}`);
  }
  console.log(`✓ length ${length}: ${fromScript.size} words, all ${length} letters, ` +
              `matches src/words.ts answerWordsForLength(${length}). (pool var '${poolVarFor(length)}')`);
}

// Read the words already covered so we can skip them (resume-friendly).
function existingWords() {
  const js = readFileSync(INTEL_PATH, "utf8");
  const out = new Set();
  for (const m of js.matchAll(/^\s{2}([A-Z]{3,})\s*:\s*\{/gm)) out.add(m[1]);
  return out;
}

const ANTHROPIC_MODEL = "claude-opus-4-8";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

const SYSTEM_API =
  "You write tiny, accurate, delightful 'word intel' cards for a word game. " +
  "Return ONLY JSON: {\"def\":\"\",\"fact\":\"\",\"quote\":\"\",\"author\":\"\"," +
  "\"etymology\":\"\",\"pos\":\"\",\"syllables\":0}. " +
  "def: one crisp sentence. fact: one surprising, TRUE philosophical or scientific " +
  "fact connected to the word. quote: a short, REAL, correctly-attributed quote from " +
  "a great mind that resonates with the word — if you are not certain it is genuine, " +
  "set quote and author to empty strings. etymology: one short sentence on the word's " +
  "origin (empty string if unsure). pos: the primary part of speech (e.g. 'noun'). " +
  "syllables: integer syllable count. No markdown.";

// Local prompt never asks for a quote (see header note); intelForLocal also hard-blanks it.
const SYSTEM_LOCAL =
  "You write tiny, accurate 'word intel' cards for a word game. " +
  "Return ONLY JSON: {\"def\":\"\",\"fact\":\"\",\"etymology\":\"\",\"pos\":\"\",\"syllables\":0}. " +
  "def: one crisp, accurate sentence defining the word. fact: one genuinely TRUE fact " +
  "connected to the word — prefer a plainly-true detail over a dramatic one, and AVOID " +
  "superlatives like 'only/first/most/largest' unless you are certain; empty string if " +
  "unsure. etymology: one short sentence on the word's origin, empty string unless you are " +
  "confident (do NOT guess). pos: primary part of speech (e.g. 'noun'). syllables: integer " +
  "syllable count of the word. Accuracy matters more than flair; never invent. No markdown.";

const extractJson = (text) => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

let _anthropic = null;
async function intelForAnthropic(word) {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      die("ANTHROPIC_API_KEY not set. Decrypt it from the vault, or use --local:\n" +
          "  export ANTHROPIC_API_KEY=$(sops -d ~/golden-vault/secrets/<file>.env | grep ANTHROPIC_API_KEY | cut -d= -f2-)");
    }
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    _anthropic = new Anthropic();
  }
  const msg = await _anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 400,
    system: SYSTEM_API,
    messages: [{ role: "user", content: `Word: ${word}` }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return extractJson(text);
}

async function intelForLocal(word, model) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      think: false, // suppress reasoning preamble on thinking models so JSON is clean
      options: { temperature: 0.3 },
      messages: [
        { role: "system", content: SYSTEM_LOCAL },
        { role: "user", content: `Word: ${word}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status} ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const obj = extractJson(data.message?.content ?? "");
  obj.quote = ""; // never publish a quote a local model may have invented or misattributed
  obj.author = "";
  return obj;
}

// Re-serialize the whole map as a clean ES module (stable key order).
function writeIntel(map) {
  const keys = Object.keys(map).sort();
  const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const body = keys.map((k) => {
    const e = map[k];
    const lines = [`  ${k}: {`, `    def: "${esc(e.def)}",`, `    fact: "${esc(e.fact)}",`];
    if (e.etymology) lines.push(`    etymology: "${esc(e.etymology)}",`);
    if (e.pos) lines.push(`    pos: "${esc(e.pos)}",`);
    if (e.syllables) lines.push(`    syllables: ${Number(e.syllables) || 0},`);
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
  let length = 5;
  const ni = args.indexOf("--length");
  if (ni >= 0) { length = parseInt(args[ni + 1], 10) || 5; args.splice(ni, 2); }
  if (args.includes("--check")) { args.splice(args.indexOf("--check"), 1); return selfCheck(length); }
  const local = args.includes("--local");
  if (local) args.splice(args.indexOf("--local"), 1);
  let model = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct";
  const mi = args.indexOf("--model");
  if (mi >= 0) { model = args[mi + 1]; args.splice(mi, 2); }
  const explicit = args.filter((a) => /^[A-Za-z]+$/.test(a)).map((a) => a.toUpperCase());
  const intelFor = local ? (w) => intelForLocal(w, model) : intelForAnthropic;

  const have = existingWords();
  const todo = (explicit.length ? explicit : answerWords(length))
    .filter((w) => explicit.length || !have.has(w))
    .slice(0, limit);

  if (!todo.length) return console.log("Nothing to generate — all answers covered.");
  console.log(`Generating intel for ${todo.length} ${length}-letter words via ${local ? `Ollama (${model})` : `Claude (${ANTHROPIC_MODEL})`}…`);

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
