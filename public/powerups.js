// Wordul — power-ups module.
// Owns the reveal-a-letter / count-the-vowels power-ups, the DIRECT-HIT rail that
// surfaces them (#powerRail, over the 🔊 speaker), and the 💀 give-up / bankruptcy
// affordance (C4). The two server messages (`reveal_letter` / `vowel_count`) are
// UNCHANGED — this module is purely the client gateway. EZ mode is retired: the
// power-ups are always available, but a power-up button only appears once you can afford
// it (no price shown — you learn the cost by watching the balance dip), and tapping it
// buys immediately (no ✨ launcher, no popover — "direct hit", Jun 8).
//
// C4 — gold can go NEGATIVE: power-up spends + penalties route through edition.js
// drainGold (no zero-clamp). In HARD MODE, sinking past BANKRUPTCY_THRESHOLD ends the
// game by bankruptcy. The 💀 icon surfaces when stuck (idle / too many errors) and
// taps to give up = the same explosion in ANY mode. Both reuse the app-owned
// triggerLoseSequence(snap, me) (passed via ctx), setting game.finishReason.
//
// Like gold.js, this module avoids importing app.js (which is the <script
// type="module"> entry — importing it would cycle). The wiring instead receives a
// `ctx` of app-owned callbacks: { game, send, render, toast, renderGoldHud,
// getGold, drainGold, getUsername, forfeit }. forfeit(reason)
// records the loss + runs the lose explosion (fire-once). Pure selectors
// (affordablePowerups / cheapestAvailableCost / isStuck) are exported for unit tests.
import { GOLD, isBankrupt } from "/gold.js";
import { powerUpsOn } from "/lane.js";
import { activeDifficulty } from "/settings.js";

// The catalogue. `icon` is what the popover shows; `cost` comes from gold.js; the
// `available` predicate decides whether the power-up still has anything to offer this
// round (a vowel count is one-and-done; reveal runs out when every slot is known).
export const POWERUPS = [
  {
    id: "reveal",
    icon: "🎰",
    label: "Reveal a letter",
    cost: GOLD.revealCost,
    available: (state, snap) => state.revealed.length < (snap?.wordLength ?? Infinity),
  },
  {
    id: "vowel",
    icon: "🔍",
    label: "Vowel count",
    cost: GOLD.vowelCost,
    available: (state) => state.vowels == null,
  },
];

// Pure selector (unit-tested): which power-ups are buyable RIGHT NOW — still have
// something to offer this round AND you can afford them. `state` = { revealed, vowels }.
export function affordablePowerups(gold, state, snap) {
  return POWERUPS.filter((p) => p.available(state, snap) && gold >= p.cost);
}

// Pure helper (unit-tested): the cheapest still-AVAILABLE power-up cost, or null when
// none remain buyable this round. Drives the ✨ hide-unaffordable gate: show the icon
// only when gold >= this value.
export function cheapestAvailableCost(state, snap) {
  const costs = POWERUPS.filter((p) => p.available(state, snap)).map((p) => p.cost);
  return costs.length ? Math.min(...costs) : null;
}

// Pure predicate (unit-tested): should the ✨ icon be visible? Hidden unless we're
// playing, it's my turn, at least one power-up is still buyable this round, and I can
// afford the cheapest one.
export function shouldShowMagic(gold, state, snap, me) {
  if (!snap || snap.phase !== "playing" || !me || me.status !== "playing") return false;
  if (!powerUpsOn(snap)) return false; // Gate A: no ✨ in the Vanilla lane
  const cheapest = cheapestAvailableCost(state, snap);
  return cheapest != null && gold >= cheapest;
}

// --- Per-round state (lives on `game`, owned/reset here) ---

// Reset the power-up half of a fresh round. (The gold-economy half — goldThisRound,
// replay, deadLetterReuse — is reset by the caller alongside this, see app.js.)
export function resetPowerHints(game, round) {
  game.ezRound = round;
  game.revealed = [];
  game.vowels = null;
  game.pendingReveal = false;
  game.pendingVowel = false;
  // C4: a fresh round resets the 💀 stuck affordance (idle flag + per-round error count).
  game.stuck = false;
  game.errorCount = 0;
  game.lastRejected = null; // the remembered dud word is per-round too
}

// Persist the accumulated hints (revealed positions + known vowel count) so learned
// info stays on-screen after the announcing toast fades.
function renderPowerHints(game) {
  const el = document.getElementById("powerHints");
  if (!el) return;
  const parts = game.revealed
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((r) => `pos ${r.index + 1} = ${r.letter}`);
  if (game.vowels != null) parts.push(`${game.vowels} vowel${game.vowels === 1 ? "" : "s"}`);
  el.textContent = parts.join("  ·  ");
  el.hidden = parts.length === 0;
}

// --- Server-message handling ---

// Apply a reveal/vowel reply: charge gold, record the hint, announce it. Returns true
// if the message was a power-up reply (so the caller can early-return). C4: the charge
// goes through drainGold (no zero-clamp) so a buy can push the balance negative; after
// charging we check Hard-Mode bankruptcy (a reveal at the brink can tip you under).
export function handlePowerupMessage(ctx, msg) {
  const { game, render, toast, renderGoldHud, drainGold } = ctx;
  if (msg.type === "revealed_letter") {
    game.pendingReveal = false;
    // Charge only when this is genuinely new info (immune to duplicate responses).
    if (!game.revealed.some((r) => r.index === msg.index)) {
      game.revealed.push({ index: msg.index, letter: msg.letter });
      drainGold(GOLD.revealCost);
      toast(`Position ${msg.index + 1} is ${msg.letter}`, { duration: 2600 });
      renderGoldHud();
      checkBankruptcy(ctx);
    }
    if (game.snapshot) render();
    return true;
  }
  if (msg.type === "vowels") {
    game.pendingVowel = false;
    if (game.vowels == null) {
      game.vowels = msg.count;
      drainGold(GOLD.vowelCost);
      toast(`${msg.count} vowel${msg.count === 1 ? "" : "s"} in the word`, { duration: 2600 });
      renderGoldHud();
      checkBankruptcy(ctx);
    }
    if (game.snapshot) render();
    return true;
  }
  return false;
}

// --- ✨ magic icon + popover ---

function buyPowerup(ctx, id) {
  const { game, send, getGold, render } = ctx;
  if (id === "reveal") {
    if (game.pendingReveal || getGold() < GOLD.revealCost) return;
    if (game.revealed.length >= (game.snapshot?.wordLength ?? Infinity)) return;
    game.pendingReveal = true;
    // Send what we already know so the server reveals a NEW letter each buy.
    send({ type: "reveal_letter", known: game.revealed.map((r) => r.index) });
    // Safety: if nothing new is left the server stays silent — re-enable shortly.
    setTimeout(() => {
      if (game.pendingReveal) { game.pendingReveal = false; if (game.snapshot) render(); }
    }, 2000);
  } else if (id === "vowel") {
    if (game.pendingVowel || getGold() < GOLD.vowelCost || game.vowels != null) return;
    game.pendingVowel = true;
    send({ type: "vowel_count" });
  }
}

// Render the power-up rail: the currently-affordable power-ups as DIRECT-HIT buttons
// over the 🔊 speaker (no ✨ launcher, no popover — "direct hit", Jun 8). Each tap buys
// immediately via the existing server message. The rail is rebuilt every render (mount
// re-clones the node, and the affordable set shifts as gold moves), so listeners are
// attached fresh each pass — no per-node wiring guard needed. Also keeps the persistent
// learned-hints text + the 💀 give-up affordance in sync. Mirrors the old contract
// (called from app.js render()).
export function renderPowerups(ctx, snap, me) {
  const { game, renderGoldHud, getGold } = ctx;
  const rail = document.getElementById("powerRail");
  if (!rail) return;

  const show = shouldShowMagic(getGold(), game, snap, me);
  rail.textContent = "";
  rail.hidden = !show;
  if (show) {
    for (const p of affordablePowerups(getGold(), game, game.snapshot)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "power-hit";
      b.dataset.action = p.id;
      b.textContent = p.icon;
      b.title = p.label;
      b.setAttribute("aria-label", p.label);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        buyPowerup(ctx, p.id);
      });
      rail.appendChild(b);
    }
  }

  const canPlay = snap.phase === "playing" && me && me.status === "playing";
  if (canPlay) {
    renderGoldHud();
    renderPowerHints(game);
  } else {
    const h = document.getElementById("powerHints");
    if (h) h.hidden = true;
  }

  // Keep the 💀 give-up affordance in sync on every render too.
  renderGiveUp(ctx, snap, me);
}

// --- 💀 give-up + bankruptcy (C4) ---

// How many invalid / not-enough-letter errors before the 💀 give-up affordance appears.
// Tunable (spec "Open tuning"). The existing idle timer ALSO surfaces it (via app.js).
export const STUCK_ERROR_THRESHOLD = 3;

// True when the player is "stuck" enough to be offered a 💀 give-up: either the idle
// timer flagged it (game.stuck) or they've racked up enough errors this round.
export function isStuck(game) {
  return !!game.stuck || (game.errorCount ?? 0) >= STUCK_ERROR_THRESHOLD;
}

// Bump the per-round error counter (invalid submit / not-enough-letters / hard-mode
// violation) and surface 💀 once the threshold trips. Called from app.js's error paths.
export function bumpErrorCount(ctx) {
  const { game } = ctx;
  game.errorCount = (game.errorCount ?? 0) + 1;
  if (isStuck(game)) surfaceGiveUp(ctx);
}

// Flag the player as stuck (from the idle timer fire) and reveal 💀. Idempotent.
export function surfaceGiveUp(ctx) {
  const { game } = ctx;
  game.stuck = true;
  const snap = game.snapshot;
  const me = snap?.players?.find?.((p) => p.username === ctx.getUsername?.());
  renderGiveUp(ctx, snap, me);
}

// Render the 💀 icon: visible only when it's my turn AND I'm stuck. Wires the tap once.
function renderGiveUp(ctx, snap, me) {
  const { game } = ctx;
  const btn = document.getElementById("giveUpBtn");
  if (!btn) return;
  const myTurn = !!(snap && snap.phase === "playing" && me && me.status === "playing");
  btn.hidden = !(myTurn && isStuck(game));
  // Per-node guard: #giveUpBtn is re-cloned on each room mount (mount() does
  // innerHTML="" + cloneNode), so a module-level boolean would leave the fresh button
  // unwired on the 2nd+ room — the dataset flag rides the node itself.
  if (btn.dataset.wired !== "1") {
    btn.dataset.wired = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      giveUp(ctx);
    });
  }
}

// Give up immediately, in ANY mode → the same lose explosion as running out of guesses.
// Delegates to the app-owned ctx.forfeit(reason), which resigns to the server
// (the loss is recorded server-side), guards fire-once (hasShownEndStats), and
// runs triggerLoseSequence. Guarded here too so a stray tap after the end is a no-op.
export function giveUp(ctx) {
  const { game } = ctx;
  const snap = game.snapshot;
  if (!snap || snap.phase !== "playing" || game.hasShownEndStats) return;
  const me = snap.players.find((p) => p.username === ctx.getUsername?.());
  if (!me || me.status !== "playing") return;
  ctx.forfeit("gave_up");
}

// Hard-Mode bankruptcy check — fires after any drain. Ends the game once gold sinks past
// the threshold. Easy/medium never die (gold just goes negative). Guarded fire-once
// via game.hasShownEndStats so a balance already in the red can't re-trigger.
export function checkBankruptcy(ctx) {
  const { game, getGold } = ctx;
  const snap = game.snapshot;
  if (!snap || snap.phase !== "playing" || game.hasShownEndStats) return;
  if (!isBankrupt(getGold(), activeDifficulty() === "hard")) return;
  const me = snap.players.find((p) => p.username === ctx.getUsername?.());
  if (!me || me.status !== "playing") return;
  ctx.forfeit("bankrupt");
}
