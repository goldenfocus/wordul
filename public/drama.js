// Reactive race audio: opponents you can HEAR. A pure cue detector (tested) diffs
// consecutive snapshots into drama cues; a tiny chiptune Web Audio half plays them —
// progress stings, a time-bomb tick while an opponent is deep, a fanfare when they
// bust. Zero assets, zero server involvement; honors the global 🔊 mute. Spec:
// docs/superpowers/specs/2026-06-05-race-drama-audio-design.md
import { newGreensInLast, newYellowsInLast } from "/celebrate.js";

// --- pure half ---------------------------------------------------------------

// Diff two snapshot player lists into drama cues from MY point of view.
// ctx = { me, maxGuesses, phase, isDaily }. Total function: bad/missing input → silence.
// Cues: {kind:"hot",count} new hot letters · {kind:"warm"} warm-only row ·
// {kind:"bust",deep} opponent ran out while I'm alive. dangerLevel 0|1|2 tracks the
// DEEPEST still-playing opponent (maxGuesses-2 rows → 1, final row → 2).
export function detectCues(prevPlayers, nextPlayers, ctx) {
  const none = { cues: [], dangerLevel: 0 };
  if (!prevPlayers || !nextPlayers || !ctx || ctx.isDaily || ctx.phase !== "playing") return none;
  const meP = nextPlayers.find((p) => p.username === ctx.me);
  if (!meP || meP.status !== "playing") return none;
  const deepRows = ctx.maxGuesses - 2;
  const cues = [];
  let dangerLevel = 0;
  for (const p of nextPlayers) {
    if (p.username === ctx.me) continue;
    const before = prevPlayers.find((q) => q.username === p.username);
    if (!before) continue; // joined this snapshot — their board is history, not news
    if (before.status === "playing" && p.status === "lost") {
      cues.push({ kind: "bust", deep: (before.guesses?.length ?? 0) >= deepRows });
      continue;
    }
    if (p.status !== "playing") continue;
    const rows = p.guesses?.length ?? 0;
    if (rows >= ctx.maxGuesses - 1) dangerLevel = 2;
    else if (rows >= deepRows) dangerLevel = Math.max(dangerLevel, 1);
    if (rows > (before.guesses?.length ?? 0)) {
      const hots = newGreensInLast(p.guesses);
      if (hots > 0) cues.push({ kind: "hot", count: hots });
      else if (newYellowsInLast(p.guesses) > 0) cues.push({ kind: "warm" });
    }
  }
  return { cues, dangerLevel };
}

// --- impure half: the chiptune synth -------------------------------------------

const MUTE_LS = "wordul.muted"; // same key playChime/playNoise honor
const STING_COOLDOWN_MS = 1500;
const TICK_MS = [0, 1100, 550]; // per dangerLevel

let audioCtx = null;
let layerLevel = 0;
let layerTimer = null;
let lastStingAt = 0;

function isMuted() { return localStorage.getItem(MUTE_LS) === "1"; }

// Own lazy AudioContext, same suspended-until-gesture handling as app.js's chimes.
function ac() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => { try { ac(); } catch { /* nice-to-have */ } }, { once: true });
  window.addEventListener("touchend", () => { try { ac(); } catch { /* nice-to-have */ } }, { once: true });
}

function note(freq, at, dur, gainPeak, type = "square") {
  const a = ac();
  const t0 = a.currentTime + at;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function tickBlip(level) {
  if (isMuted()) return;
  try {
    note(level === 2 ? 1250 : 1000, 0, 0.035, level === 2 ? 0.09 : 0.05);
    if (level === 2) note(65, 0, 0.1, 0.2, "sine"); // heartbeat thump under the fast tick
  } catch { /* audio is a nice-to-have */ }
}

// One tick loop total: recreated on level change, cleared at level 0. setInterval
// cadence (±50ms wobble) reads MORE human for a bomb tick than sample-accurate audio.
function setLayer(level) {
  if (level === layerLevel) return;
  layerLevel = level;
  if (layerTimer) { clearInterval(layerTimer); layerTimer = null; }
  if (level > 0) layerTimer = setInterval(() => tickBlip(layerLevel), TICK_MS[level]);
}

function sting(cue) {
  if (isMuted()) return;
  try {
    if (cue.kind === "bust") {
      const g = cue.deep ? 0.14 : 0.1; // shallow busts celebrate a little quieter
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.09, 0.08, g));
    } else if (cue.kind === "hot") {
      const base = 660 * Math.pow(2, (Math.min(cue.count, 5) - 1) / 12); // +1 semitone per extra hot
      note(base, 0, 0.07, 0.12);
      note(base * Math.pow(2, -1 / 12), 0.08, 0.09, 0.12); // minor-2nd drop = wrongness
    } else {
      note(240, 0, 0.09, 0.07, "triangle"); // warm: they're sniffing around
    }
  } catch { /* audio is a nice-to-have */ }
}

// Apply one snapshot's worth of drama: ONE tick layer at the deepest opponent's level,
// at most one sting per cooldown window (bust > hot > warm). A bust bypasses the
// cooldown — it's the payoff, and it just killed the tension layer.
export function dramaApply({ cues, dangerLevel }) {
  setLayer(dangerLevel);
  if (!cues.length) return;
  const best = cues.find((c) => c.kind === "bust")
    ?? cues.find((c) => c.kind === "hot")
    ?? cues[0];
  const now = Date.now();
  if (best.kind !== "bust" && now - lastStingAt < STING_COOLDOWN_MS) return;
  lastStingAt = now;
  sting(best);
}

export function dramaStop() {
  setLayer(0);
}

// The one-call site for app.js: diff → apply.
export function dramaUpdate(prevPlayers, nextPlayers, ctx) {
  dramaApply(detectCues(prevPlayers, nextPlayers, ctx));
}
