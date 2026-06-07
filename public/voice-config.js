// public/voice-config.js
// Client twin of the server voice map. Hydrated at boot from /voice-config.json.
// The active surface (a /w/ World page, or the daily/room bundle) sets the active
// voice id; activeVoiceLayer() returns the mergeConfig layer for it ({} => silent).
import { EDITIONS } from "/editions/index.js";

const BUILTIN = new Set(EDITIONS.map((e) => e.id));
let MAP = {};         // id -> { on, source }
let ACTIVE = null;    // current voice id

export function hydrateVoiceConfig(map) { MAP = (map && typeof map === "object" && !Array.isArray(map)) ? map : {}; }
export function setActiveVoiceId(id) { ACTIVE = typeof id === "string" ? id : null; }

// Pure: a WorldVoice -> a mergeConfig voice layer (or {} when silent).
export function voiceLayer(wv) {
  if (!wv || !wv.on || !wv.source) return {};
  return { voice: { source: wv.source } };
}

export function activeVoiceLayer() { return ACTIVE ? voiceLayer(MAP[ACTIVE]) : {}; }

// Built-in edition clips ship in static ASSETS; uploaded sets serve from R2.
export function resolveClipBase(clipSetId) {
  return BUILTIN.has(clipSetId) ? `/voice/${clipSetId}/` : `/voice-clips/${clipSetId}/`;
}

// Fetch + hydrate at boot. Swallows errors (keeps silent default). Returns changed?
export async function loadVoiceConfig() {
  try {
    const res = await fetch("/voice-config.json", { cache: "no-store" });
    if (!res.ok) return false;
    const next = await res.json();
    if (!next || typeof next !== "object" || Array.isArray(next)) return false;
    const before = JSON.stringify(MAP);
    hydrateVoiceConfig(next);
    return JSON.stringify(MAP) !== before;
  } catch { return false; }
}
