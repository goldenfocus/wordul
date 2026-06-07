// src/voice.ts
import { WORLDS } from "./worlds.ts";
import { normalizeVoiceOverrides, EMPTY_VOICE, type VoiceOverrides } from "./voice-overrides.ts";

export const VOICE_OVERRIDES_KEY = "worlds:voice";   // KV: the per-world voice map
export const CLIPSET_REGISTRY_KEY = "voice:clipsets"; // KV: string[] of uploaded clip-set ids

type VoiceEnv = { DIRECTORY: KVNamespace };

// Built-in clip sets === the launch editions (their clips ship in static ASSETS).
export function builtinClipSets(): string[] {
  return Array.from(new Set(WORLDS.map((w) => w.editionId)));
}

export async function uploadedClipSets(env: VoiceEnv): Promise<string[]> {
  try {
    const v = await env.DIRECTORY.get(CLIPSET_REGISTRY_KEY, "json");
    return Array.isArray(v) ? (v as unknown[]).filter((x) => typeof x === "string") as string[] : [];
  } catch { return []; }
}

export async function knownClipSets(env: VoiceEnv): Promise<string[]> {
  return [...builtinClipSets(), ...(await uploadedClipSets(env))];
}

// Effective voice map = KV override normalized against the world base + known sets.
// Never throws: any KV failure or corrupt blob falls back to {} (everything silent).
export async function getEffectiveVoice(env: VoiceEnv): Promise<VoiceOverrides> {
  try {
    const stored = await env.DIRECTORY.get(VOICE_OVERRIDES_KEY, "json");
    if (!stored) return EMPTY_VOICE;
    const norm = normalizeVoiceOverrides(stored, WORLDS, await knownClipSets(env));
    return norm.ok ? norm.value : EMPTY_VOICE;
  } catch { return EMPTY_VOICE; }
}
