#!/usr/bin/env node
// Render Yang's companion lines to cloned-voice clips with golden-voice (gv).
//
// PREREQUISITES (local, macOS, offline):
//   1. golden-voice installed and a "yang" voice profile recorded (`gv record me`)
//   2. the resident engine running: `bash tts-daemon.sh start`
//   3. ffmpeg on PATH (golden-voice installs it)
//
// USAGE:  npm run voice:render
//
// gv's export output location/format is the one external unknown. This script
// assumes `gv export <key> "<text>"` writes <key>.<ext> into GV_EXPORT_DIR.
// VERIFY ON FIRST RUN: run `gv export probe "hello there"` once and confirm where
// the file lands; if it differs, set GV_EXPORT_DIR to that directory and re-run.
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { lineKey } from "../../public/voice-key.js";
import { edition } from "../../public/editions/yang.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "../../public/voice/yang");
const MANIFEST = join(OUT_DIR, "manifest.json");
const GV_EXPORT_DIR = process.env.GV_EXPORT_DIR
  || join(homedir(), "golden-cloud/blocks/golden-voice/exports");

mkdirSync(OUT_DIR, { recursive: true });

// All companion lines, deduped. Skip lines with a {token}: their word is dynamic
// at runtime and can't be pre-rendered — they fall back to speechSynthesis.
const lines = [...new Set(Object.values(edition.companion.lines).flat())]
  .filter((l) => !l.includes("{"));

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};

function findGvOutput(key) {
  // newest file in GV_EXPORT_DIR whose name starts with the key
  if (!existsSync(GV_EXPORT_DIR)) return null;
  const matches = readdirSync(GV_EXPORT_DIR)
    .filter((f) => f.startsWith(key + "."))
    .map((f) => ({ f, t: statSync(join(GV_EXPORT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return matches.length ? join(GV_EXPORT_DIR, matches[0].f) : null;
}

let made = 0, skipped = 0;
for (const text of lines) {
  const key = lineKey(text);
  const outMp3 = join(OUT_DIR, `${key}.mp3`);
  if (existsSync(outMp3)) { manifest[key] = `${key}.mp3`; skipped++; continue; }

  console.log(`▶ ${text}`);
  execFileSync("gv", ["export", key, text], { stdio: "inherit" });
  const raw = findGvOutput(key);
  if (!raw) {
    console.error(`✗ Could not find gv output for "${key}" in ${GV_EXPORT_DIR}.`);
    console.error(`  Run \`gv export probe "hi"\` to see where gv writes, then set GV_EXPORT_DIR.`);
    process.exit(1);
  }
  // Normalize to small mono mp3 (universal browser support, ~tiny for speech).
  execFileSync("ffmpeg", ["-y", "-i", raw, "-ac", "1", "-b:a", "32k", outMp3], { stdio: "inherit" });
  manifest[key] = `${key}.mp3`;
  made++;
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n✓ Rendered ${made}, skipped ${skipped}. Manifest: ${MANIFEST}`);
