// Per-bot typing "hand": the rhythm data + the SINGLE pure planner that turns a decided word
// into a timed sequence of count-only ghost-fill pulses (the same {len} a human's keystrokes
// relay). This is the only code that reads a RhythmProfile. Future bot-studio vibes (keyboard
// layout, extrovert/cheater/guesser) are smarter planners of THIS signature — the emitter, the
// wire format, and the DO loop never change. No runtime imports: pure and unit-testable.

export interface RhythmProfile {
  firstKeyMs: number;     // reaction delay before the first key of a row (keeps atMs > 0)
  readPauseMs: number;    // a flustered restart beat (used after an esc full-clear)
  keyMeanMs: number;      // average gap between consecutive keystrokes
  keyJitter: number;      // 0..1 — how irregular the per-key gaps are
  backspaceRate: number;  // 0..1 — chance a row includes a single/double backspace fumble
  clearRate: number;      // 0..1 — chance a row includes an esc full-clear-and-restart
}

export const SHARP_HAND: RhythmProfile = {
  firstKeyMs: 300, readPauseMs: 400, keyMeanMs: 120, keyJitter: 0.15, backspaceRate: 0.02, clearRate: 0.0,
};

export const NOOB_HAND: RhythmProfile = {
  firstKeyMs: 900, readPauseMs: 1500, keyMeanMs: 280, keyJitter: 0.5, backspaceRate: 0.25, clearRate: 0.06,
};

export type KeyStep = { atMs: number; len: number }; // len = filled-cell count at time atMs (ms from decide)

// The row's full typing span: the last step's atMs (0 for an empty timeline).
export function timelineMs(steps: KeyStep[]): number {
  return steps.length ? steps[steps.length - 1].atMs : 0;
}

// One per-key gap around keyMeanMs, spread by jitter, floored at 20% of the mean so it stays positive.
function keyGap(profile: RhythmProfile, rng: () => number): number {
  const j = Math.max(0, Math.min(1, profile.keyJitter));
  const factor = 1 + (rng() * 2 - 1) * j;               // symmetric jitter in [1-j, 1+j]
  const floor = Math.round(profile.keyMeanMs * 0.2);
  return Math.max(floor, Math.round(profile.keyMeanMs * factor));
}

/**
 * Turn a decided word into a timed sequence of count-only ghost-fill pulses, including the
 * occasional human correction (single/double backspace, esc full-clear). Pure & deterministic
 * given `rng`. `len` is the filled-cell count at `atMs`; the final step is always the full word.
 */
export function planKeystrokes(word: string, profile: RhythmProfile, rng: () => number): KeyStep[] {
  const target = word.length;
  if (target <= 0) return [];
  const steps: KeyStep[] = [];
  let t = Math.max(1, profile.firstKeyMs);               // reaction before the first key (atMs > 0)
  let len = 0;

  // optional esc full-clear-and-restart once, before the real type-out
  if (rng() < profile.clearRate) {
    const partial = 1 + Math.floor(rng() * Math.max(1, target - 1)); // type 1..target-1 first
    for (let i = 0; i < partial; i++) { len += 1; steps.push({ atMs: t, len }); t += keyGap(profile, rng); }
    len = 0; steps.push({ atMs: t, len });               // esc → row cleared
    t += Math.round(profile.readPauseMs * 0.6);          // flustered restart beat
  }

  // optional one backspace fumble during the real type-out (single, or a fast double-tap)
  const willBackspace = rng() < profile.backspaceRate;
  const doubleBack = willBackspace && rng() < 0.4;
  const fumbleAt = willBackspace ? 1 + Math.floor(rng() * Math.max(1, target - 1)) : -1;
  let fumbled = false;

  while (len < target) {
    len += 1; steps.push({ atMs: t, len }); t += keyGap(profile, rng);
    if (!fumbled && len === fumbleAt) {
      fumbled = true;
      len -= 1; steps.push({ atMs: t, len }); t += Math.round(keyGap(profile, rng) * 0.5); // fast delete
      if (doubleBack && len > 0) { len -= 1; steps.push({ atMs: t, len }); t += Math.round(keyGap(profile, rng) * 0.5); }
    }
  }
  return steps;
}
