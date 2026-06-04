// Pure logic for the Vibe Studio "Stage" editor. No DOM, no fetch — everything
// here is unit-tested. The DOM wiring lives in vibe-studio.js.

const clampInt = (n, lo, hi) => {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
};

// Clamp a word length to 4..12 and guess-rows to 3..10 (parent-spec limits).
export function reflowDims(len, rows) {
  return { len: clampInt(len, 4, 12), rows: clampInt(rows, 3, 10) };
}

// HSL → #rrggbb. h in degrees, s/l in 0..1.
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to2 = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

// A coherent 3-colour palette from a base hue: a1 vivid base, a2/a3 a split-
// complementary pair. Deterministic given baseHue so it is unit-testable; the
// live "🎲" supplies a varied hue.
export function randomHarmony(baseHue = 210) {
  const h = ((baseHue % 360) + 360) % 360;
  return {
    a1: hslToHex(h, 0.68, 0.58),
    a2: hslToHex(h + 150, 0.62, 0.62),
    a3: hslToHex(h + 210, 0.6, 0.55),
  };
}

// Soft, NON-BLOCKING classifier for the real ✓ / invented ✨ badge. `lookup` is
// an injected async (word) => boolean (the live one wraps dictionaryapi.dev), so
// this stays pure and fetch-free for tests. Any error → "invented" (never throws,
// never gates input). The only hard rule elsewhere is length 4–12.
export async function classifyWord(word, lookup) {
  const w = String(word || "").trim();
  if (w.length < 4) return "tooShort";
  try {
    return (await lookup(w)) ? "real" : "invented";
  } catch {
    return "invented";
  }
}

const DEFAULT_SCHEME = { a1: "#5ee27a", a2: "#f2c94c", a3: "#ff8a5c" };

// The seed prompt the ✨ AI-tune affordance would send. Editable by the curator
// (revealed via the chevron); persisted in the draft. The real model call is a
// later increment — v1 ships the affordance as a seam.
export const DEFAULT_AI_PROMPT = "Make this text legendary — vivid, cool, unforgettable.";

// Board columns follow the typed word (real or invented) — no separate length
// control. Empty word falls back to 5 so the matrix still reads as a board; a
// typed word grows it letter-by-letter, capped at 12.
export function previewCols(word) {
  const n = String(word || "").length;
  if (n === 0) return 5;
  return Math.min(n, 12);
}

export function defaultVibe() {
  return {
    vibeTitle: "", word: "", rows: 6, story: "", aiPrompt: DEFAULT_AI_PROMPT,
    colorScheme: { ...DEFAULT_SCHEME },
  };
}

export function serializeDraft(vibe) {
  return JSON.stringify(vibe);
}

// Tolerant restore: bad/partial input → a complete, clamped vibe (never throws).
export function restoreDraft(raw) {
  let obj = {};
  try { obj = raw ? JSON.parse(raw) : {}; } catch { obj = {}; }
  if (!obj || typeof obj !== "object") obj = {};
  const base = defaultVibe();
  const { rows } = reflowDims(5, obj.rows ?? base.rows);
  const cs = obj.colorScheme && typeof obj.colorScheme === "object" ? obj.colorScheme : {};
  return {
    vibeTitle: typeof obj.vibeTitle === "string" ? obj.vibeTitle : base.vibeTitle,
    word: String(obj.word ?? base.word).toUpperCase().replace(/[^A-Z]/g, ""),
    rows,
    story: typeof obj.story === "string" ? obj.story : base.story,
    aiPrompt: typeof obj.aiPrompt === "string" && obj.aiPrompt ? obj.aiPrompt : base.aiPrompt,
    colorScheme: {
      a1: cs.a1 || DEFAULT_SCHEME.a1,
      a2: cs.a2 || DEFAULT_SCHEME.a2,
      a3: cs.a3 || DEFAULT_SCHEME.a3,
    },
  };
}
