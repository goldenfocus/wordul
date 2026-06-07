import type { WorldDef } from "./worlds.ts";

export type VoiceSource =
  | { kind: "ai"; voiceName: string; rate?: number; pitch?: number }
  | { kind: "clips"; clipSetId: string; origin: "upload" | "clone-existing" | "clone-sample" | "record" };

export type WorldVoice = { on: boolean; source: VoiceSource };
export type VoiceOverrides = Record<string, WorldVoice>;
export const EMPTY_VOICE: VoiceOverrides = {};

export type VoiceNormResult =
  | { ok: true; value: VoiceOverrides }
  | { ok: false; reason: string };

const ID_RE = /^[a-z0-9-]{1,40}$/;
const ORIGINS = new Set(["upload", "clone-existing", "clone-sample", "record"]);
const NAME_MAX = 64;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Validate an admin-supplied voice map against the world base + known clip sets.
// Returns a cleaned doc (only whitelisted fields) or a human-readable reason.
export function normalizeVoiceOverrides(raw: unknown, base: WorldDef[], knownClipSets: string[]): VoiceNormResult {
  const o = asObj(raw);
  const baseIds = new Set(base.map((w) => w.id));
  const sets = new Set(knownClipSets);
  const out: VoiceOverrides = {};

  for (const id of Object.keys(o)) {
    if (!ID_RE.test(id)) return { ok: false, reason: `invalid id: ${id}` };
    if (!baseIds.has(id)) return { ok: false, reason: `unknown world id: ${id}` };
    const entry = asObj(o[id]);
    const src = asObj(entry.source);
    const on = entry.on === true || entry.on === 1 || entry.on === "true";

    if (src.kind === "ai") {
      const voiceName = typeof src.voiceName === "string" ? src.voiceName.trim() : "";
      if (!voiceName || voiceName.length > NAME_MAX) return { ok: false, reason: `bad voiceName for ${id}` };
      const source: VoiceSource = { kind: "ai", voiceName };
      if (src.rate != null) { const n = Number(src.rate); if (!Number.isFinite(n)) return { ok: false, reason: `bad rate for ${id}` }; source.rate = clamp(n, 0.5, 2); }
      if (src.pitch != null) { const n = Number(src.pitch); if (!Number.isFinite(n)) return { ok: false, reason: `bad pitch for ${id}` }; source.pitch = clamp(n, 0, 2); }
      out[id] = { on, source };
    } else if (src.kind === "clips") {
      const clipSetId = typeof src.clipSetId === "string" ? src.clipSetId : "";
      if (!ID_RE.test(clipSetId)) return { ok: false, reason: `bad clipSetId for ${id}` };
      if (!sets.has(clipSetId)) return { ok: false, reason: `unknown clipSet for ${id}: ${clipSetId}` };
      if (typeof src.origin !== "string" || !ORIGINS.has(src.origin)) return { ok: false, reason: `bad origin for ${id}` };
      out[id] = { on, source: { kind: "clips", clipSetId, origin: src.origin as "upload" | "clone-existing" | "clone-sample" | "record" } };
    } else {
      return { ok: false, reason: `unknown source kind for ${id}` };
    }
  }
  return { ok: true, value: out };
}
