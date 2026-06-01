// Wordul — gold economy module.
// Owns the economy constants, the combo multiplier, the "raining from the sky"
// payout (coin-rain + HUD count-up), the clearer-wins SEQUENCED payout, and the
// gold HUD render. Gold STORAGE lives in edition.js (getGold/addGold/spendGold) —
// this module imports it and adds the presentation layer on top.
//
// Decoupling note: awardGold/playPayoutSequence take `reducedMotion` (and other
// app-owned callbacks like getTile/log/playChime) as PARAMS rather than reaching
// back into app.js — app.js is the <script type="module"> entry, so importing it
// here would cycle. The caller in app.js does `game.goldThisRound += delta` itself
// right after awarding so per-round earnings stay app-owned.
import { getGold, addGold } from "/edition.js";

// --- Gold economy: earn on progress, with combo multipliers, raining from the sky. ---
export const GOLD = {
  green: 100,             // each newly-revealed green
  yellow: 50,             // each newly-revealed yellow
  solve: 500,             // flat solve bonus
  speedPerGuessLeft: 300, // × unused guesses — solve fast, earn more
  revealCost: 4000,       // a letter is a splurge (gold is precious)
  vowelCost: 200,         // a cheap, frequent nudge
};

// Multiple discoveries in ONE guess pay a combo bonus: 2→1.5×, 3→2×, 4→2.5×, 5→3×.
export function comboMultiplier(discoveries) {
  return discoveries >= 2 ? 1 + (discoveries - 1) * 0.5 : 1;
}

// Add gold and play the "raining from the sky" payout: balance counts up + coins fall.
export function awardGold(delta, reducedMotion) {
  if (!delta) return;
  const before = getGold();
  addGold(delta);
  let hud = document.getElementById("goldHud");
  if (!hud) { renderGoldHud(); hud = document.getElementById("goldHud"); }
  if (!hud) return;
  const after = getGold();
  if (!reducedMotion) spawnGoldCoins(Math.min(28, Math.max(6, Math.round(delta / 18))));
  animateCount(hud, before, after);
  hud.classList.remove("gold-bump"); void hud.offsetWidth; hud.classList.add("gold-bump");
}

// Tween the balance number old→new with an easeOutCubic so it visibly climbs.
// `dur` is tunable so per-beat payout ticks can climb faster than the lump bump.
function animateCount(el, from, to, dur = 650) {
  if (!el) return;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    el.textContent = `◆ ${v}`;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Gold coins raining from the top of the screen.
function spawnGoldCoins(n) {
  for (let i = 0; i < n; i++) {
    const c = document.createElement("div");
    c.className = "gold-coin";
    c.textContent = "◆";
    c.style.left = `${8 + Math.random() * 84}vw`;
    c.style.setProperty("--gc-x", `${(Math.random() - 0.5) * 120}px`);
    c.style.setProperty("--gc-delay", `${Math.random() * 220}ms`);
    c.style.setProperty("--gc-dur", `${900 + Math.random() * 700}ms`);
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1900);
  }
}

// --- Clearer wins: the sequenced payout. ---
// Instead of one lump coin-burst, walk the discoveries one beat at a time so a win
// is *legible*: each yellow/green glows its tile, floats a "+N", ticks the HUD, plays
// an ascending note, and types a hacker-log line — then a finale "✦ N× COMBO" lands
// the multiplier last. Tunable cadence; reducedMotion / fast-payouts skip the pauses.
export const PAYOUT_BEAT_MS = 450;

// A "+N" that rises off a specific board tile and fades. Modeled on .gold-coin.
function spawnGoldFloater(tile, value) {
  if (!tile || typeof tile.getBoundingClientRect !== "function") return;
  const r = tile.getBoundingClientRect();
  const f = document.createElement("div");
  f.className = "gold-floater";
  f.textContent = `+${value}`;
  f.style.left = `${r.left + r.width / 2}px`;
  f.style.top = `${r.top + r.height / 2}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 800);
}

// CRITICAL GOLD-SUM CONTRACT (the regression auditor's #1 check):
// the TOTAL awarded MUST equal the old lump Math.round(base * mult), where
// base = Σ discovery values. We award the integer per-beat values as we go (their
// sum is exactly `base`, no per-beat rounding drift), then add the combo `bonus`
// (= round(base*mult) − base) ONCE at the finale. So:  Σbeats + bonus === total.
// playPayoutSequence({ discoveries, mult, hud, getTile, log, playChime,
//                      celebrateCombo, reducedMotion, onBalanceChange }) → Promise
//   discoveries  Array<{ index, kind:'yellow'|'green', letter, value }> (value attached by caller)
//   mult         combo multiplier for this guess (comboMultiplier(discoveries.length))
//   hud          the #goldHud element to tick (optional; resolved if omitted)
//   getTile      (index) → the board tile DOM for that column (optional; glow/floater skipped if null)
//   log          hacker-log API with logLine/addInstant (optional; no-op if null)
//   playChime    (notes) app-owned chime fn (optional)
//   celebrateCombo (count, mult) app-owned combo flourish (optional; finale)
//   reducedMotion / fastPayouts → award the whole total instantly, lines instant, no beats
//   onBalanceChange()  called after every balance mutation so callers can refresh the HUD
// Resolves once the full sequence (incl. finale) has been applied to the balance.
export function playPayoutSequence(opts = {}) {
  const {
    discoveries = [],
    mult = 1,
    getTile = null,
    log = null,
    playChime = null,
    celebrateCombo = null,
    reducedMotion = false,
    onBalanceChange = null,
  } = opts;
  let hud = opts.hud || document.getElementById("goldHud");

  const base = discoveries.reduce((s, d) => s + (d.value || 0), 0);
  const total = Math.round(base * mult);
  const bonus = total - base;        // the combo bonus, landed in the finale
  const hasCombo = discoveries.length >= 2;

  // Nothing to pay → resolve immediately (caller still records a no-op replay entry).
  if (discoveries.length === 0 || total === 0) return Promise.resolve();

  // Fast path: reducedMotion / fast-payouts → one award, all lines instant, no pauses.
  if (reducedMotion) {
    awardGold(total, true);          // awardGold's own coin-rain is already suppressed when reducedMotion
    for (const d of discoveries) {
      log?.addInstant(`> ${d.kind} ${String(d.letter || "").toUpperCase()} pos ${d.index + 1}  +${d.value}`, {
        tone: "gain",
      });
    }
    if (hasCombo) log?.addInstant(`✦ ${mult}× COMBO  +${bonus}`, { tone: "combo" });
    onBalanceChange?.();
    return Promise.resolve();
  }

  // Sequenced path: one beat per discovery, then a finale beat for combos.
  return new Promise((resolve) => {
    let i = 0;
    const C5 = 523.25; // an ascending arpeggio across the run (semitone steps)

    function beat() {
      if (i >= discoveries.length) {
        if (hasCombo) return finale();
        return resolve();
      }
      const d = discoveries[i];
      const tile = getTile ? getTile(d.index) : null;
      if (tile && tile.classList) {
        tile.classList.remove("gold-glow");
        void tile.offsetWidth;       // restart the animation if the same tile re-glows
        tile.classList.add("gold-glow");
        setTimeout(() => tile.classList && tile.classList.remove("gold-glow"), PAYOUT_BEAT_MS);
        spawnGoldFloater(tile, d.value);
      }
      const before = getGold();
      addGold(d.value);
      animateCount(hud, before, getGold(), Math.max(180, PAYOUT_BEAT_MS - 80));
      onBalanceChange?.();
      playChime?.([[C5 * Math.pow(2, i / 12), 0]]);
      log?.logLine(
        `${d.kind} ${String(d.letter || "").toUpperCase()} pos ${d.index + 1}  +${d.value}`,
        { tone: "gain" },
      );
      i++;
      setTimeout(beat, PAYOUT_BEAT_MS);
    }

    function finale() {
      const before = getGold();
      addGold(bonus);                // base→total: the combo bonus lands last
      const after = getGold();
      animateCount(hud, before, after, 520);
      if (hud) { hud.classList.remove("gold-bump"); void hud.offsetWidth; hud.classList.add("gold-bump"); }
      spawnGoldCoins(Math.min(28, Math.max(6, Math.round(total / 18))));
      onBalanceChange?.();
      celebrateCombo?.(discoveries.length, mult);
      log?.logLine(`✦ ${mult}× COMBO  +${bonus}`, { tone: "combo" });
      setTimeout(resolve, PAYOUT_BEAT_MS);
    }

    beat();
  });
}

// The gold HUD lives in the room header.
export function renderGoldHud() {
  const host =
    document.querySelector(".room-header") ||
    document.getElementById("roomName")?.parentElement ||
    null;
  if (!host) return;
  let hud = document.getElementById("goldHud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "goldHud";
    hud.className = "gold-hud";
    host.appendChild(hud);
  }
  hud.textContent = `◆ ${getGold()}`;
}
