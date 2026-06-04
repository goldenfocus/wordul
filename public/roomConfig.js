// The Room Sandbox config foundation. PURE — no DOM, no localStorage, no imports
// from app.js. Two functions ship this rung: pickGuessEvent (the never-silent
// guess-reaction resolver) and mergeConfig (the override merge contract). Both are
// the canonical implementations from the Room Sandbox architecture spec (rung 00);
// everything else in that schema (presets, diff, sanitize) is deferred to the rung
// that consumes it. roomConfig is an OVERRIDE delta: {} means "pure edition default".

// Limit constants from the Keystone. Rung 1 reads only bankMax (capping merged banks).
export const CONFIG_CAPS = { historyMax: 50, bankMax: 24, lineMax: 140 };

// ── pickGuessEvent ───────────────────────────────────────────────────────────
// Resolve a valid guess to exactly ONE companion event, by priority. Never silent:
// even if every guess event is toggled off, the terminal `wrong` fallback fires.
//   greens   — newGreens >= 2            → ctx.count = real green count (kills the "two" bug)
//   progress — one green OR any yellow    → modest positive
//   wrong    — anything else / fallback   → carries the sloppy-reuse flag
// `voice` is the merged voice override (optional). Rung 1 always passes {}; the param
// exists now so rung 2 wires the real override with no signature change.
export function pickGuessEvent(ng, ny, reusedDeadLetter, voice = {}) {
  const priority = voice.priority ?? ["greens", "progress", "wrong"];
  for (const event of priority) {
    if (voice.events?.[event] === false) continue;          // disabled as a priority slot
    if (event === "greens" && ng >= 2) return { event: "greens", ctx: { count: ng } };
    if (event === "progress" && (ng === 1 || ny >= 1)) return { event: "progress", ctx: {} };
    if (event === "wrong") return { event: "wrong", ctx: { reusedDeadLetter } };
  }
  return { event: "wrong", ctx: { reusedDeadLetter } };      // terminal fallback — always speaks
}

// ── mergeConfig ──────────────────────────────────────────────────────────────
// Merge override layers left→right (later wins) into a resolved RoomConfig.
// Locked rules (Keystone §Merge semantics):
//  1. sections fall through independently;
//  2. voice keys shallow-replace, EXCEPT voice.react deep-merges by sub-key
//     (voiceBudget/win/greens/mistake), and voice.events shallow-merges key-by-key;
//  3. voice.priority replaces wholesale;
//  4. line banks APPEND unless wrapped { replace: [...] };
//  5. other sections (palette/…/preset) replace wholesale (stubs this rung).
// Guarantee: mergeConfig(base, {}) deep-equals base.
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const cap = (arr) => arr.slice(0, CONFIG_CAPS.bankMax);
const NESTED_LINE_EVENTS = new Set(["wrong", "win", "greens"]);

// Deep-merge react by sub-key: each direct sub-key (voiceBudget/win/greens/mistake)
// shallow-merges one more level so retuning one tier keeps the others.
function mergeReact(base = {}, over = {}) {
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = isObj(base[k]) && isObj(over[k]) ? { ...base[k], ...over[k] } : over[k];
  }
  return out;
}

// One leaf bank: base is string[]|undefined; over is string[]|{replace}|undefined.
function mergeBank(base, over) {
  if (over == null) return base;
  if (isObj(over) && Array.isArray(over.replace)) return cap(over.replace.slice());
  const b = Array.isArray(base) ? base : [];
  const o = Array.isArray(over) ? over : [];
  return cap(b.concat(o));
}

function mergeLineBanks(base = {}, over = {}) {
  const out = { ...base };
  for (const ev of Object.keys(over)) {
    if (NESTED_LINE_EVENTS.has(ev)) {
      const bsub = base[ev] || {}, osub = over[ev] || {};
      const merged = { ...bsub };
      for (const tier of Object.keys(osub)) merged[tier] = mergeBank(bsub[tier], osub[tier]);
      out[ev] = merged;
    } else {
      out[ev] = mergeBank(base[ev], over[ev]);
    }
  }
  return out;
}

function mergeVoice(base = {}, over = {}) {
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (k === "react") out.react = mergeReact(base.react, over.react);
    else if (k === "lines") out.lines = mergeLineBanks(base.lines, over.lines);
    else if (k === "events") out.events = { ...(base.events || {}), ...over.events };
    else out[k] = over[k]; // talkativeness, priority (wholesale), voiceEdition, preset
  }
  return out;
}

export function mergeConfig(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const section of Object.keys(layer)) {
      if (section === "voice") out.voice = mergeVoice(out.voice, layer.voice);
      else out[section] = layer[section]; // sections fall through / replace (stubs this rung)
    }
  }
  return out;
}
