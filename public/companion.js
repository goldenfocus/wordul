// Pure companion line scoring + selection. No DOM, no localStorage — every
// function is deterministic given its inputs, so the whole engine is unit-tested
// without a browser. edition.js wires this to the active edition's line banks;
// the web studio (subsystem B) will later edit the same `react` config shape.

// How big was the win? genius (fast), clutch (last-gasp), or solid (the rest).
export function scoreWin(guessesUsed, cfg = {}) {
  if (cfg.win?.genius && guessesUsed <= cfg.win.genius.maxGuesses) return "genius";
  if (cfg.win?.clutch && guessesUsed >= cfg.win.clutch.minGuesses) return "clutch";
  return "solid";
}

// Which green-burst bucket — the line always matches the real count (kills the
// hardcoded "two" bug). Clamped to the configured thresholds.
export function scoreGreens(count, cfg = {}) {
  const thresholds = cfg.greens?.thresholds ?? [2, 3, 4, 5];
  const lo = thresholds[0], hi = thresholds[thresholds.length - 1];
  return String(Math.max(lo, Math.min(hi, count)));
}

// A wrong guess is "sloppy" when it reused a letter already known dead this round
// (the same signal the gold economy penalizes); otherwise it's a "normal" miss.
export function scoreMistake(ctx = {}, cfg = {}) {
  if (cfg.mistake?.sloppy?.repeatedKnownGray && ctx.reusedDeadLetter) return "sloppy";
  return "normal";
}

// Should this reaction actually speak aloud? Big moments, wins, and losses always
// do. A normal wrong guess and an invalid word are the only "routine" events, and
// they speak only `voiceBudget.routine` of the time so voice stays a scarce, loud
// resource. rng is injectable for deterministic tests.
export function shouldSpeak(event, tier, cfg = {}, rng = Math.random) {
  const routine = event === "invalid" || (event === "wrong" && tier === "normal");
  if (!routine) return true;
  return rng() < (cfg.voiceBudget?.routine ?? 1);
}

// Resolve the tier key to read within an event's bank. Returns null for flat
// banks (invalid, idle, loss), where the caller uses the array directly.
export function resolveTier(event, ctx = {}, cfg = {}) {
  switch (event) {
    case "win": return scoreWin(ctx.guessesUsed ?? 99, cfg);
    case "greens": return scoreGreens(ctx.count ?? 2, cfg);
    case "wrong": return scoreMistake(ctx, cfg);
    default: return null;
  }
}

// Split a templated line on {answer} into a trimmed prefix + suffix, so the prefix
// can play in the cloned voice and the answer can be spoken by the robotic voice.
export function splitTemplate(line, token = "{answer}") {
  const idx = line.indexOf(token);
  if (idx === -1) return { prefix: line, suffix: "" };
  return { prefix: line.slice(0, idx).trim(), suffix: line.slice(idx + token.length).trim() };
}
