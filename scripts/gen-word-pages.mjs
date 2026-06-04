#!/usr/bin/env node
// scripts/gen-word-pages.mjs — build the word wiki.
//   public/word/<slug>.html   per answer word (committed; full content)
//   public/words.html         A–Z index (committed)
//   dist/og/<slug>.png        OG card per word (gitignored; uploaded by upload-og.mjs)
// Idempotent. Skips excluded words (no public page).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { answerWords, exclusions, slugFor } from "./lib/words.mjs";
import { buildWordGraph } from "./lib/word-graph.mjs";
import { renderWordPage } from "./lib/word-page.mjs";
import { ogCardSvg } from "./lib/og-card.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = process.env.WIKI_ORIGIN || "https://wordul.com";

const { WORD_INTEL } = await import(pathToFileURL(join(ROOT, "public/data/word-intel.js")).href);
const words = answerWords();
const excluded = exclusions();
const graph = buildWordGraph(words);

const wordDir = join(ROOT, "public/word");
const ogDir = join(ROOT, "dist/og");
mkdirSync(wordDir, { recursive: true });
rmSync(ogDir, { recursive: true, force: true });
mkdirSync(ogDir, { recursive: true });

let pages = 0;
const indexed = [];
for (const W of words) {
  if (excluded.has(W)) continue;
  const slug = slugFor(W);
  const intel = WORD_INTEL[W] || {};
  writeFileSync(join(wordDir, `${slug}.html`), renderWordPage(W, intel, graph.get(W), ORIGIN));
  const svg = ogCardSvg(W, intel.def || "");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  writeFileSync(join(ogDir, `${slug}.png`), png);
  indexed.push(W);
  pages++;
}

// A–Z index page.
const grouped = {};
for (const W of indexed.sort()) (grouped[W[0]] ??= []).push(W);
const indexBody = Object.keys(grouped).sort().map((letter) =>
  `<section><h2>${letter}</h2><p>${grouped[letter].map((W) => `<a href="/word/${slugFor(W)}">${W}</a>`).join(" ")}</p></section>`
).join("\n");
writeFileSync(join(ROOT, "public/words.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Every Wordul word — the word wiki</title>
<meta name="description" content="Browse every answer word in Wordul, with definitions, facts and word play.">
<link rel="canonical" href="${ORIGIN}/words"><link rel="stylesheet" href="/word-page.css"></head>
<body class="wp"><header class="wp-head"><a class="wp-home" href="/">Wordul</a></header>
<main class="wp-main"><h1>The Wordul word wiki</h1><p>${indexed.length} words.</p>${indexBody}</main></body></html>`);

console.log(`wrote ${pages} word pages + index + ${pages} OG cards`);
