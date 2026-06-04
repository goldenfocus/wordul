#!/usr/bin/env node
// Render Yang's companion lines to cloned-voice clips with golden-voice.
//
// PREREQUISITES (local, macOS, offline):
//   1. golden-voice installed:  bash ~/golden-cloud/blocks/golden-voice/install.sh
//   2. a voice recorded:        gv record       (saves under ~/.claude/local-tts/voices/me/)
//   3. (recommended) daemon up: bash ~/.claude/local-tts/tts-daemon.sh start
//      — model loads once (~20s) instead of per-line, so 88 lines render fast.
//
// USAGE:  npm run voice:render
//
// We drive golden-voice's `gv-export.sh <name> <text>` directly (the `gv` command
// itself is a fish function, not on PATH). gv-export synthesizes in your cloned
// voice, loudness-normalizes to -16 LUFS, and writes
//   ~/.claude/local-tts/library/<name>/<name>.{wav,opus,mp3}
// We copy the mp3 (already mono + normalized — web-ready) into public/voice/yang/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { lineKey } from "../../public/voice-key.js";
import { edition } from "../../public/editions/yang.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "../../public/voice/yang");
const MANIFEST = join(OUT_DIR, "manifest.json");

const TTS_DIR = join(homedir(), ".claude/local-tts");
const GV_EXPORT = join(TTS_DIR, "bin/gv-export.sh");
const LIBRARY = join(TTS_DIR, "library");

if (!existsSync(GV_EXPORT)) {
  console.error(`✗ golden-voice not installed (missing ${GV_EXPORT}).`);
  console.error(`  Run: bash ~/golden-cloud/blocks/golden-voice/install.sh`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

// Walk the (now nested) line banks into a flat list of strings.
function collectLines(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const n of node) collectLines(n, out);
  else if (node && typeof node === "object") for (const n of Object.values(node)) collectLines(n, out);
  return out;
}

// Static lines render whole. Templated lines ("... {answer} ...") render their
// non-empty segments instead, so the cloned-voice frame is pre-recorded while the
// answer word is spoken live by the robotic browser voice at runtime.
const TOKEN = "{answer}";
const segments = new Set();
for (const line of new Set(collectLines(edition.companion.lines))) {
  const idx = line.indexOf(TOKEN);
  if (!line.includes("{")) { segments.add(line); continue; }
  if (idx === -1) continue; // an unknown token we can't pre-render — skip
  const pre = line.slice(0, idx).trim();
  const suf = line.slice(idx + TOKEN.length).trim();
  if (pre) segments.add(pre);
  if (suf) segments.add(suf);
}
const lines = [...segments];

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};

let made = 0, skipped = 0;
for (const text of lines) {
  const key = lineKey(text);
  const outMp3 = join(OUT_DIR, `${key}.mp3`);
  if (existsSync(outMp3)) { manifest[key] = `${key}.mp3`; skipped++; continue; }

  console.log(`▶ ${text}`);
  execFileSync("bash", [GV_EXPORT, key, text], { stdio: "inherit" });

  const src = join(LIBRARY, key, `${key}.mp3`);
  if (!existsSync(src)) {
    console.error(`✗ gv-export produced no mp3 at ${src} for "${text}".`);
    process.exit(1);
  }
  copyFileSync(src, outMp3);
  manifest[key] = `${key}.mp3`;
  made++;
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n✓ Rendered ${made}, skipped ${skipped}. Manifest: ${MANIFEST}`);
