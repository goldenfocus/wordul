#!/usr/bin/env node
// scripts/gen-word-images.mjs — per-word AI wiki art for the word wiki.
//
// For every answer word, generates THREE images and uploads them as WebP to R2:
//   slot 1  hero/<slug>.webp       — hero / meaning-scene (the verified primary sense)
//   slot 2  mnemonic/<slug>.webp   — "see it to spell it" memory hook
//   slot 3  etymology/<slug>.webp  — origin / etymology vignette
//
// Images come from Cloudflare Workers AI, model @cf/black-forest-labs/flux-1-schnell,
// via the REST API. House style is LOCKED in docs/ART-DIRECTION.md — the STYLE_SUFFIX and
// negative-prompt clause below are the machine-readable copy of that doc. No text is ever
// rendered into the pixels (diffusion can't spell); the word + def + mark are composited
// on afterward with the same branded frame as the OG cards (scripts/lib/og-card.mjs).
//
// ─────────────────────────────────────────────────────────────────────────────
//  SAFETY: this script SPENDS NOTHING unless WORDUL_IMG_GEN=1 is set.
//  Without that flag it DRY-RUNS: it prints every prompt and every R2 key it WOULD
//  write, calls no API, and uploads nothing. Always dry-run first.
// ─────────────────────────────────────────────────────────────────────────────
//
//  ROUGH COST (estimate — verify against current Cloudflare pricing before a big run):
//  Workers AI bills flux-1-schnell per ~512×512 "tile". A 1024×1024 image ≈ a few tiles.
//  At ~2,300 five-letter answer words × 3 images ≈ ~6,900 generations. Budget on the order
//  of a few US dollars to low tens of dollars for the full corpus, plus negligible R2 PUT +
//  storage. Use --limit to spend in small, checkable batches. Re-runs are FREE for words
//  whose 3 keys already exist in R2 (skip-existing); only missing slots are generated.
//
//  HOW TO RUN IT LATER (do NOT run during this task — it spends money):
//    # 1. Decrypt creds from the vault and export (account id + a Workers-AI-scoped token):
//    export R2_ACCOUNT_ID=...            # Cloudflare account id (same as upload-og.mjs)
//    export R2_ACCESS_KEY_ID=...         # R2 S3 access key id
//    export R2_SECRET_ACCESS_KEY=...     # R2 S3 secret
//    export CF_AI_TOKEN=...              # API token with "Workers AI" read permission
//    # 2. Dry-run first — spends nothing, prints prompts + keys:
//    node scripts/gen-word-images.mjs --limit 5
//    # 3. When the prompts look right, flip the safety flag to actually generate + upload:
//    WORDUL_IMG_GEN=1 node scripts/gen-word-images.mjs --limit 5      # small batch
//    WORDUL_IMG_GEN=1 node scripts/gen-word-images.mjs                # full corpus
//    WORDUL_IMG_GEN=1 node scripts/gen-word-images.mjs --word crane   # just one word
//
//  Flags:
//    --limit N   cap this run to the first N words still missing images
//    --word W    generate only this word (ignores skip-existing for that word's missing slots)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

import { answerWords, exclusions, slugFor } from "./lib/words.mjs";
import { ogCardSvg } from "./lib/og-card.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INTEL_PATH = join(ROOT, "public/data/word-intel.js");

// ── house style (locked — mirror of docs/ART-DIRECTION.md) ───────────────────
const STYLE_SUFFIX =
  "Editorial vignette illustration, single clear subject, cinematic rim lighting in " +
  "ultraviolet (#9d8bff) and warm gold (#f0c14b) against a deep near-black (#15101f) " +
  "background, soft volumetric fog, painterly semi-realistic style with clean shapes and " +
  "generous negative space, centered composition with room to overlay type, muted lavender " +
  "mid-tones (#bdb6c9), warm off-white highlights (#f7f1e3), tasteful film grain, cohesive " +
  "poster aesthetic, high craft, no text.";

// Flux Schnell has no separate negative-prompt field — fold it in as an "Avoid:" clause.
const NEGATIVE =
  "Avoid: text, letters, words, captions, watermark, signature, logo, typography, numbers, " +
  "UI, frame border, meme, lowres, blurry, deformed, extra limbs, mutated hands, " +
  "oversaturated, neon rainbow, teal-and-orange, stock-photo look, cluttered busy background.";

// Sensitive-but-still-indexable words: get the clean poster fallback, NEVER an AI guess.
// (WORD_EXCLUSIONS in src/word-exclusions.ts are a stronger list — those words have no page
// at all and are skipped entirely. This DENY_LIST is the gray zone that still gets a page.)
const DENY_LIST = new Set(
  [].map((w) => w.toUpperCase()), // fill from a sensitivity pass before a full run
);

const BRAND = { bg: "#15101f", accent: "#9d8bff", gold: "#f0c14b", fg: "#f7f1e3", muted: "#bdb6c9" };
const BUCKET = "wordul-og"; // reuse the existing OG R2 bucket
const MODEL = "@cf/black-forest-labs/flux-1-schnell";
const IMG = 1024; // square; composited type sits on top
const CONCURRENCY = Number(process.env.GEN_CONCURRENCY) || 4; // gentle on the Workers AI rate limit
const LIVE = process.env.WORDUL_IMG_GEN === "1"; // the one flag that unlocks spending

// Optional local / worker-binding modes — used when we lack R2 S3 keys or a Workers-AI API
// token (e.g. generating via a temporary worker route under `wrangler dev --remote`):
//   --out-dir DIR    write composited <slot>/<slug>.webp under DIR instead of R2 (QA locally)
//   --endpoint URL   POST {prompt} to a worker route (header x-img-gen-key: IMG_GEN_KEY) that
//                    runs the AI binding, instead of calling the Cloudflare AI REST API direct
//   --words a,b,c    generate only this curated comma-list of words
let OUT_DIR = null;
let ENDPOINT = null;
const ENDPOINT_KEY = process.env.IMG_GEN_KEY || "";

const die = (msg) => { console.error(msg); process.exit(1); };

// ── word intel (verified defs — anchor homographs on the primary sense) ──────
async function loadIntel() {
  const mod = await import(`file://${INTEL_PATH}?t=${Date.now()}`);
  return mod.WORD_INTEL || {};
}

// ── slot prompts ─────────────────────────────────────────────────────────────
// `def` (the verified definition from word-intel) anchors every slot so homographs like
// CRANE / BASS / SEWER resolve to their fact-checked primary sense, not the model's guess.
function promptsFor(word, def) {
  // IMPORTANT: never name the word in the prompt — flux renders the literal word as garbled
  // text in the pixels (it ignores "no text" when a quoted word is present). We describe only
  // the MEANING; the word itself is composited on afterward. The verified def anchors the
  // subject (and resolves homographs to the primary sense).
  // Lead with the word as a lowercase keyword ("Subject: ocean — <def>") to ground the
  // subject (fixes drift like OCEAN→planet from the bare def's "Earth's surface"). Lowercase
  // + mid-sentence avoids the baked-text artifact that a quoted UPPERCASE word triggers.
  const subject = def
    ? `Subject: ${word.toLowerCase()} — ${def}`
    : `Subject: ${word.toLowerCase()}, in its primary common meaning`;
  return {
    hero:
      `A single clear cinematic scene showing this subject beautifully and literally, one ` +
      `subject only. ${subject}. ${STYLE_SUFFIX} ${NEGATIVE}`,
    mnemonic:
      `A vivid, slightly surreal, exaggerated dreamlike memory-hook image of this subject — ` +
      `an association you can't un-see, memorable over literal. ${subject}. ${STYLE_SUFFIX} ${NEGATIVE}`,
    etymology:
      `A quiet, antique, archival-mood historical vignette evoking the origin of this subject ` +
      `and the era or root it grew from. ${subject}. ${STYLE_SUFFIX} ${NEGATIVE}`,
  };
}

const SLOT_KEY = { hero: "hero", mnemonic: "mnemonic", etymology: "etymology" };
const keyFor = (slot, slug) => `${SLOT_KEY[slot]}/${slug}.webp`;

// ── Cloudflare Workers AI: flux-1-schnell → PNG bytes ────────────────────────
async function generate(prompt) {
  // Worker-route mode: POST the prompt to a deployed/dev worker that runs the AI binding
  // (no offline CF_AI_TOKEN needed — the worker's runtime binding authorizes the call).
  if (ENDPOINT) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-img-gen-key": ENDPOINT_KEY },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error(`endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const acct = process.env.R2_ACCOUNT_ID;
  const token = process.env.CF_AI_TOKEN;
  const url = `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt, width: IMG, height: IMG }),
  });
  const ctype = res.headers.get("content-type") || "";
  if (!res.ok) throw new Error(`Workers AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  // flux-1-schnell returns either raw image bytes or JSON { result: { image: <base64> } }.
  if (ctype.includes("application/json")) {
    const data = await res.json();
    const b64 = data?.result?.image;
    if (!b64) throw new Error(`Workers AI: no image in JSON: ${JSON.stringify(data).slice(0, 300)}`);
    return Buffer.from(b64, "base64");
  }
  return Buffer.from(await res.arrayBuffer());
}

// ── compositing: brand frame overlay (type lives here, never in the pixels) ──
function frameSvg(word, def, slot) {
  const W = word.toUpperCase();
  const tag = String(def || "").slice(0, 64).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const label = slot === "mnemonic" ? "remember it" : slot === "etymology" ? "origin" : "meaning";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${IMG}" height="${IMG}">
    <defs><linearGradient id="g" x1="0" y1="0.6" x2="0" y2="1">
      <stop offset="0" stop-color="${BRAND.bg}" stop-opacity="0"/>
      <stop offset="1" stop-color="${BRAND.bg}" stop-opacity="0.92"/></linearGradient></defs>
    <rect width="${IMG}" height="${IMG}" fill="url(#g)"/>
    <rect x="6" y="6" width="${IMG - 12}" height="${IMG - 12}" rx="22" fill="none"
      stroke="${BRAND.accent}" stroke-opacity="0.35" stroke-width="3"/>
    <text x="48" y="${IMG - 120}" font-family="Arial, sans-serif" font-size="26"
      letter-spacing="6" fill="${BRAND.gold}">${label.toUpperCase()}</text>
    <text x="48" y="${IMG - 64}" font-family="Arial, sans-serif" font-size="88"
      font-weight="800" fill="${BRAND.fg}">${W}</text>
    <text x="${IMG - 48}" y="48" text-anchor="end" font-family="Arial, sans-serif"
      font-size="24" font-weight="700" fill="${BRAND.muted}">wordul.com</text>
    ${tag ? `<text x="48" y="${IMG - 28}" font-family="Arial, sans-serif" font-size="24"
      fill="${BRAND.muted}">${tag}</text>` : ""}
  </svg>`;
}

async function compositeWebp(pngBytes, word, def, slot) {
  const overlay = Buffer.from(frameSvg(word, def, slot));
  return sharp(pngBytes)
    .resize(IMG, IMG, { fit: "cover" })
    .composite([{ input: overlay }])
    .webp({ quality: 82 })
    .toBuffer();
}

// Poster-only fallback for deny-listed words: brand card, no diffusion, no spend.
async function posterWebp(word, def) {
  const png = await sharp(Buffer.from(ogCardSvg(word, def))).png().toBuffer();
  return sharp(png).resize(IMG, IMG, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
}

// ── R2 (mirrors upload-og.mjs: account-scoped S3 client, same creds) ─────────
function makeS3() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    die("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (decrypt from the vault).");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

async function existsInR2(s3, key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
  catch { return false; }
}

async function putR2(s3, key, body) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "image/webp" }));
}

// Local-output helpers (mirror the R2 key path under OUT_DIR).
const localPathFor = (key) => join(OUT_DIR, key);
const existsLocal = (key) => existsSync(localPathFor(key));
function putLocal(key, body) {
  const p = localPathFor(key);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

// ── per-word work ────────────────────────────────────────────────────────────
async function processWord(s3, word, def, forced) {
  const slug = slugFor(word.toUpperCase());
  const slots = ["hero", "mnemonic", "etymology"];
  const denied = DENY_LIST.has(word.toUpperCase());

  for (const slot of slots) {
    const key = keyFor(slot, slug);

    if (LIVE && !forced && (OUT_DIR ? existsLocal(key) : await existsInR2(s3, key))) {
      console.log(`  · skip ${key} (exists)`);
      continue;
    }

    if (denied) {
      console.log(`  ⚑ ${key} — deny-listed → poster-only fallback (no AI spend)`);
      if (LIVE) { const b = await posterWebp(word, def); if (OUT_DIR) putLocal(key, b); else await putR2(s3, key, b); }
      continue;
    }

    const prompt = promptsFor(word, def)[slot];
    if (!LIVE) {
      console.log(`  [DRY] would write ${key}`);
      console.log(`        prompt: ${prompt}`);
      continue;
    }
    const png = await generate(prompt);
    const webp = await compositeWebp(png, word, def, slot);
    if (OUT_DIR) putLocal(key, webp); else await putR2(s3, key, webp);
    console.log(`  ✓ ${key}${OUT_DIR ? " (local)" : ""}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let limit = Infinity;
  const li = args.indexOf("--limit");
  if (li >= 0) { limit = parseInt(args[li + 1], 10) || Infinity; args.splice(li, 2); }
  let only = null;
  const wi = args.indexOf("--word");
  if (wi >= 0) { only = (args[wi + 1] || "").toUpperCase(); args.splice(wi, 2); }
  let onlyList = null;
  const wli = args.indexOf("--words");
  if (wli >= 0) { onlyList = (args[wli + 1] || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean); args.splice(wli, 2); }
  const oi = args.indexOf("--out-dir");
  if (oi >= 0) { OUT_DIR = args[oi + 1]; args.splice(oi, 2); }
  const ei = args.indexOf("--endpoint");
  if (ei >= 0) { ENDPOINT = args[ei + 1]; args.splice(ei, 2); }

  const intel = await loadIntel();
  const excluded = exclusions(); // WORD_EXCLUSIONS — no public page, skip entirely

  // Source the answer-word list exactly like the other generators (scripts/lib/words.mjs).
  let words = answerWords()
    .map((w) => w.toUpperCase())
    .filter((w) => !excluded.has(w));

  if (only) {
    words = words.includes(only) ? [only] : [];
    if (!words.length) die(`"${only}" is not an indexable answer word (excluded or unknown).`);
  } else if (onlyList && onlyList.length) {
    const set = new Set(words);
    const picked = onlyList.filter((w) => set.has(w));
    if (!picked.length) die(`none of --words are indexable answer words.`);
    words = picked;
  } else {
    // skip-existing happens per-slot inside processWord; without R2 (dry-run) we still cap here
    words = words.slice(0, limit);
  }

  console.log(
    `${LIVE ? "LIVE" : "DRY-RUN (no spend — set WORDUL_IMG_GEN=1 to generate)"} · ` +
    `${words.length} word(s) · model ${MODEL} · bucket ${BUCKET}`,
  );
  if (!LIVE) console.log("Dry-run prints the prompts and the R2 keys it WOULD write. Nothing is uploaded.\n");

  if (OUT_DIR) console.log(`out-dir: ${OUT_DIR}${ENDPOINT ? ` · endpoint: ${ENDPOINT}` : ""}`);
  const s3 = LIVE && !OUT_DIR ? makeS3() : null; // local out-dir mode needs no R2 creds

  const queue = [...words];
  let n = 0;
  async function worker() {
    while (queue.length) {
      const word = queue.shift();
      const def = intel[word]?.def || "";
      if (!def && !DENY_LIST.has(word)) {
        // Homograph safety: no verified def → don't risk illustrating the wrong sense.
        console.log(`(${++n}/${words.length}) ${word} — skip: no verified def in word-intel`);
        continue;
      }
      console.log(`(${++n}/${words.length}) ${word}`);
      try { await processWord(s3, word, def, Boolean(only)); }
      catch (e) { console.warn(`  ✗ ${word}: ${e.message}`); }
    }
  }
  await Promise.all(Array.from({ length: LIVE ? CONCURRENCY : 1 }, worker));
  console.log(`\nDone. ${LIVE ? "Generated + uploaded." : "Dry-run only — spent nothing."}`);
}

main().catch((e) => die(e.stack || String(e)));
