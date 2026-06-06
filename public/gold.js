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
import { getGold, addGold, drainGold } from "/edition.js";

// The default "wallet": the sacred persistent gold balance (edition.js). A caller can
// pass a different adapter — e.g. the DAILY round-score counter — so the SAME payout/drain
// choreography drives an EPHEMERAL display instead of the real gold balance. Daily
// discoveries must never move the ◆ wallet (the mint is server-authoritative, cashed out
// once at the end); they pump #roundScore through a counter adapter instead.
const GOLD_WALLET = { get: getGold, add: addGold, drain: drainGold };

// --- Gold economy: earn on progress, with combo multipliers, raining from the sky. ---
export const GOLD = {
  hot: 100,             // each newly-revealed hot
  warm: 50,             // each newly-revealed warm
  validWord: 25,        // flat per accepted non-winning guess (twin: POINTS.validWord)
  solve: 500,             // flat solve bonus
  speedPerGuessLeft: 300, // × unused guesses — solve fast, earn more
  revealCost: 4000,       // a letter is a splurge (gold is precious)
  vowelCost: 200,         // a cheap, frequent nudge
  // --- Loss penalties (C2): wins AND losses cost gold, so play stays legible. ---
  invalidPenalty: 50,        // submit a non-word → lose gold (still doesn't burn a slot)
  wastedLetterPenalty: 50,   // reuse a known-dead letter in an accepted guess (per letter, base)
  wastedCapPerGuess: 200,    // cap so one all-dead guess can't nuke you in a single shot
};

// C4 bankruptcy: gold may go negative; in HARD MODE ONLY, sinking past this floor ends
// the game by bankruptcy (Hard Mode "finally has teeth"). Rescaled to the round numbers
// above — a single legit reveal (4000) only fires bankruptcy when you were already deep
// in the red, never from one buy at a healthy balance. Tunable (spec "Open tuning").
export const BANKRUPTCY_THRESHOLD = -300;

// Repeating the SAME mistake costs progressively more. `reuseCount` is how many times
// THIS dead letter was already wasted earlier this game (0 on the first reuse). Linear
// curve: 1st reuse = base, 2nd = 2×base, 3rd = 3×base… Tunable (spec "Open tuning").
export function escalatedPenalty(base, reuseCount) {
  return base * (Math.max(0, reuseCount) + 1);
}

// Pure predicate (unit-tested): is this balance bankrupt? Bankruptcy is HARD-MODE-ONLY —
// in normal play gold can sink arbitrarily negative with no death. The CALLER guards
// fire-once (so a balance already past the floor doesn't re-trigger every render).
export function isBankrupt(gold, hardMode) {
  return !!hardMode && gold <= BANKRUPTCY_THRESHOLD;
}

// Pure predicate (unit-tested): may the daily §B cash-out fire for this player snapshot?
// The daily server broadcasts TWICE on a finish — an early "fast board flip" snapshot
// (status flipped, NO goldAwarded yet) and, after the awaited ledger mint, a confirmed
// one (goldAwarded: number — room.ts scorePlayer sets it only on res.ok). Cashing out on
// the first snapshot burned the one-shot guard with mint=0 (the ◆0 race), so: ready only
// when the player is done AND the mint is confirmed AND the guard hasn't fired yet.
export function dailyCashOutReady(me, cashedOut) {
  return !cashedOut && !!me && me.status !== "playing" && typeof me.goldAwarded === "number";
}

// Multiple discoveries in ONE guess pay a combo bonus: 2→1.5×, 3→2×, 4→2.5×, 5→3×.
export function comboMultiplier(discoveries) {
  return discoveries >= 2 ? 1 + (discoveries - 1) * 0.5 : 1;
}

// Add gold and play the "raining from the sky" payout: balance counts up + coins fall.
// `wallet` (default = the real gold balance) lets a daily round-score counter borrow the
// same animation; `hud`/`prefix` let it target a non-#goldHud element (e.g. #roundScore).
export function awardGold(delta, reducedMotion, opts = {}) {
  if (!delta) return;
  const wallet = opts.wallet || GOLD_WALLET;
  const prefix = opts.prefix ?? "◆ ";
  const before = wallet.get();
  wallet.add(delta);
  let hud = opts.hud;
  if (!hud) { hud = document.getElementById("goldHud"); if (!hud) { renderGoldHud(); hud = document.getElementById("goldHud"); } }
  if (!hud) return;
  const after = wallet.get();
  if (!reducedMotion) spawnGoldCoins(Math.min(28, Math.max(6, Math.round(delta / 18))));
  animateCount(hud, before, after, 650, prefix);
  hud.classList.remove("gold-bump"); void hud.offsetWidth; hud.classList.add("gold-bump");
}

// Drain gold — awardGold in reverse. The balance tweens DOWN, the HUD flashes a red
// "loss" bump, and a descending de-tune chime plays instead of coin-rain. Routes
// through edition.js drainGold (the C4 signed primitive) so the balance CAN dip below
// zero — a penalty at a broke balance now bites for real, and Hard Mode bankruptcy
// becomes reachable. The red hacker-log line is emitted by the CALLER (so its text
// matches the trigger), not here — goldDrain stays generic. Signature mirrors
// awardGold(delta, reducedMotion); `amount` is the positive drain.
export function goldDrain(amount, reducedMotion, playChime, opts = {}) {
  if (!amount || amount <= 0) return;
  const wallet = opts.wallet || GOLD_WALLET;
  const prefix = opts.prefix ?? "◆ ";
  const before = wallet.get();
  wallet.drain(amount);
  let hud = opts.hud;
  if (!hud) { hud = document.getElementById("goldHud"); if (!hud) { renderGoldHud(); hud = document.getElementById("goldHud"); } }
  if (!hud) return;
  const after = wallet.get();
  animateCount(hud, before, after, 650, prefix);
  hud.classList.remove("gold-bump-loss"); void hud.offsetWidth; hud.classList.add("gold-bump-loss");
  if (!reducedMotion && typeof playChime === "function") playChime([[392, 0], [330, 0.08]]); // descending: a sad trombone, lite
}

// Tween the balance number old→new with an easeOutCubic so it visibly climbs.
// `dur` is tunable so per-beat payout ticks can climb faster than the lump bump.
function animateCount(el, from, to, dur = 650, prefix = "◆ ") {
  if (!el) return;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    el.textContent = `${prefix}${v}`;
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
// is *legible*: each warm/hot glows its tile, floats a "+N", ticks the HUD, plays
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
//   discoveries  Array<{ index, kind:'warm'|'hot', letter, value }> (value attached by caller)
//   mult         combo multiplier for this guess (comboMultiplier(discoveries.length))
//   hud          the #goldHud element to tick (optional; resolved if omitted)
//   getTile      (index) → the board tile DOM for that column (optional; glow/floater skipped if null)
//   log          hacker-log API with logLine/addInstant (optional; no-op if null)
//   playChime    (notes) app-owned chime fn (optional)
//   celebrateCombo (count, mult) app-owned combo flourish (optional; finale)
//   reducedMotion / fastPayouts → award the whole total instantly, lines instant, no beats
//   onBalanceChange()  called after every balance mutation so callers can refresh the HUD
//   wallet         { get, add, drain } adapter (default = the real gold balance). DAILY passes
//                  a round-score counter so discoveries pump #roundScore, never the ◆ wallet.
//   prefix         HUD text prefix for the count-up (default "◆ "; daily passes "" for a bare score)
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
  const wallet = opts.wallet || GOLD_WALLET;
  const prefix = opts.prefix ?? "◆ ";
  let hud = opts.hud || document.getElementById("goldHud");

  const base = discoveries.reduce((s, d) => s + (d.value || 0), 0);
  const total = Math.round(base * mult);
  const bonus = total - base;        // the combo bonus, landed in the finale
  const hasCombo = discoveries.length >= 2;

  // Nothing to pay → resolve immediately (caller still records a no-op replay entry).
  if (discoveries.length === 0 || total === 0) return Promise.resolve();

  // Fast path: reducedMotion / fast-payouts → one award, all lines instant, no pauses.
  if (reducedMotion) {
    awardGold(total, true, { wallet, hud, prefix }); // coin-rain already suppressed under reducedMotion
    for (const d of discoveries) {
      log?.addInstant(`> ${d.kind} ${String(d.letter || "").toUpperCase()} pos ${d.index + 1}  +${d.value}`, {
        tone: d.kind, // hacklog tones mirror the tile palette: hot → --hot, warm → --warm
      });
    }
    // GOLD-SUM (F5): the per-discovery lines already show +base; the combo line shows ONLY
    // the +bonus delta (with a (=total) annotation), so the visible +N numbers sum to the
    // real total — never base+total. The bonus equals round(base*mult) − base.
    if (hasCombo) log?.addInstant(`> ↳ ×${mult} combo  +${bonus}  (=${total})`, { tone: "combo" });
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
      const before = wallet.get();
      wallet.add(d.value);
      animateCount(hud, before, wallet.get(), Math.max(180, PAYOUT_BEAT_MS - 80), prefix);
      onBalanceChange?.();
      playChime?.([[C5 * Math.pow(2, i / 12), 0]]);
      log?.logLine(
        `${d.kind} ${String(d.letter || "").toUpperCase()} pos ${d.index + 1}  +${d.value}`,
        { tone: d.kind }, // tile-palette tone: hot → --hot, warm → --warm
      );
      i++;
      setTimeout(beat, PAYOUT_BEAT_MS);
    }

    function finale() {
      const before = wallet.get();
      wallet.add(bonus);             // base→total: the combo bonus lands last
      const after = wallet.get();
      animateCount(hud, before, after, 520, prefix);
      if (hud) { hud.classList.remove("gold-bump"); void hud.offsetWidth; hud.classList.add("gold-bump"); }
      spawnGoldCoins(Math.min(28, Math.max(6, Math.round(total / 18))));
      onBalanceChange?.();
      celebrateCombo?.(discoveries.length, mult);
      // GOLD-SUM (F5): the finale reads as a TOTAL, not a fresh +total increment. Show only
      // the +bonus delta (the beats already paid +base) with a (=total) tally, so the visible
      // +N numbers sum to the real delta: Σbeats(+base) + finale(+bonus) === total.
      log?.logLine(`↳ ×${mult} combo  +${bonus}  (=${total})`, { tone: "combo" });
      setTimeout(resolve, PAYOUT_BEAT_MS);
    }

    beat();
  });
}

// The gold HUD lives in the room header. It's a tappable button that jumps to the player's
// public gold history (/@<username>#gold-history) — the ◆ balance is the door to its story.
// No-op tap when there's no known username (the count-up/animations are untouched either way).
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
    hud.setAttribute("role", "button");
    hud.setAttribute("tabindex", "0");
    hud.style.cursor = "pointer";
    hud.setAttribute("aria-label", "View your gold history");
    const goToHistory = () => {
      let u = "";
      try { u = localStorage.getItem("wr.username") || ""; } catch { /* storage off */ }
      if (u) location.href = `/@${encodeURIComponent(u)}#gold-history`;
    };
    hud.addEventListener("click", goToHistory);
    hud.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goToHistory(); }
    });
    host.appendChild(hud);
  }
  hud.textContent = `◆ ${getGold()}`;
}
