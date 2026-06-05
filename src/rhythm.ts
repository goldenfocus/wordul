// Per-bot typing "hand": the rhythm data + the SINGLE pure planner that turns a decided word
// into a timed sequence of count-only ghost-fill pulses (the same {len} a human's keystrokes
// relay). This is the only code that reads a RhythmProfile. Future bot-studio vibes (keyboard
// layout, extrovert/cheater/guesser) are smarter planners of THIS signature — the emitter, the
// wire format, and the DO loop never change. No runtime imports: pure and unit-testable.
//
// The goal is HUMAN VARIETY, not a fixed cadence: a person types in chunks — a couple of quick
// letters, a beat to think, a few more, a fumbled backspace, a restart — and never the same shape
// twice. A uniform "wait, then type at one speed" is what makes a bot trivial to spot, so the
// planner layers: a varied opener, heavy-tailed per-key gaps, mid-word "thinking" pauses between
// chunks, and 1–3-letter corrections / esc-clears. Everything is bounded so a word still lands.

export interface RhythmProfile {
  firstKeyMs: number;     // baseline reaction before the first key (scaled 0.5×–1.8× per guess)
  readPauseMs: number;    // baseline "thinking" beat — drives mid-word chunk pauses + restart beats
  keyMeanMs: number;      // average gap between consecutive keystrokes
  keyJitter: number;      // 0..1 — spread of the per-key gaps
  hesitateRate: number;   // 0..1 — chance, per gap, of a mid-word think pause (the chunking)
  backspaceRate: number;  // 0..1 — chance of a 1–3 letter backspace fumble (up to twice/word)
  clearRate: number;      // 0..1 — chance of an esc full-clear-and-restart
}

export const SHARP_HAND: RhythmProfile = {
  firstKeyMs: 320, readPauseMs: 520, keyMeanMs: 130, keyJitter: 0.4,
  hesitateRate: 0.22, backspaceRate: 0.1, clearRate: 0.02,
};

export const NOOB_HAND: RhythmProfile = {
  firstKeyMs: 950, readPauseMs: 1400, keyMeanMs: 290, keyJitter: 0.7,
  hesitateRate: 0.5, backspaceRate: 0.32, clearRate: 0.1,
};

export type KeyStep = { atMs: number; len: number }; // len = filled-cell count at time atMs (ms from decide)

// The row's full typing span: the last step's atMs (0 for an empty timeline).
export function timelineMs(steps: KeyStep[]): number {
  return steps.length ? steps[steps.length - 1].atMs : 0;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// One per-key gap: jittered around the mean, with an occasional heavy-tail "slow letter" so the
// cadence isn't metronomic. Floored at 25% of the mean so it stays positive and readable.
function keyGap(profile: RhythmProfile, rng: () => number): number {
  const j = clamp01(profile.keyJitter);
  let g = profile.keyMeanMs * (1 + (rng() * 2 - 1) * j);
  if (rng() < 0.12) g *= 1.6 + rng() * 2.4;            // ~12% of keys land a beat slower
  return Math.max(Math.round(profile.keyMeanMs * 0.25), Math.round(g));
}

// A "thinking" pause between letter-chunks (or a flustered restart beat): a fraction-to-multiple
// of the read pause, so chunk gaps range from a short hitch to a real ~1–2s stare.
function thinkPause(profile: RhythmProfile, rng: () => number): number {
  return Math.round(profile.readPauseMs * (0.5 + rng() * 1.6));
}

/**
 * Turn a decided word into a timed sequence of count-only ghost-fill pulses with HUMAN variety:
 * a varied opener, heavy-tailed key gaps, mid-word think pauses (chunked typing), and the occasional
 * 1–3-letter backspace or esc full-clear. Pure & deterministic given `rng`. `len` is the filled-cell
 * count at `atMs`; the final step is always the full word. Hesitations and corrections are capped so
 * the timeline always terminates and never drags on indefinitely.
 */
export function planKeystrokes(word: string, profile: RhythmProfile, rng: () => number): KeyStep[] {
  const target = word.length;
  if (target <= 0) return [];
  const steps: KeyStep[] = [];
  // Varied opener: sometimes a quick start, sometimes a long stare-at-the-board.
  let t = Math.max(1, Math.round(profile.firstKeyMs * (0.5 + rng() * 1.3)));
  let len = 0;

  // Occasional esc full-clear-and-restart, once, before settling into the real type-out.
  if (rng() < clamp01(profile.clearRate)) {
    const partial = 1 + Math.floor(rng() * Math.max(1, target - 1));
    for (let i = 0; i < partial; i++) { len += 1; steps.push({ atMs: t, len }); t += keyGap(profile, rng); }
    len = 0; steps.push({ atMs: t, len }); t += thinkPause(profile, rng);   // cleared → flustered beat
  }

  let hesitations = 0;   // capped so a single word can't drag on forever
  let corrections = 0;
  while (len < target) {
    len += 1; steps.push({ atMs: t, len }); t += keyGap(profile, rng);
    if (len >= target) break;

    // Mid-word "stop and think" beat — this is the chunking that makes it read human.
    if (hesitations < 2 && rng() < clamp01(profile.hesitateRate)) {
      hesitations += 1;
      t += thinkPause(profile, rng);
    }

    // A correction: delete 1–3 letters (fast double/triple tap), maybe a beat to reconsider,
    // then the loop retypes. Capped at two corrections so the word still lands.
    if (corrections < 2 && rng() < clamp01(profile.backspaceRate)) {
      corrections += 1;
      const del = Math.min(len, 1 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.18 ? 1 : 0)); // 1–3
      for (let d = 0; d < del; d++) { len -= 1; steps.push({ atMs: t, len }); t += Math.round(keyGap(profile, rng) * 0.55); }
      if (rng() < 0.6) t += Math.round(thinkPause(profile, rng) * 0.5);
    }
  }
  return steps;
}
