// Wordul — gold economy module.
// Owns the economy constants, the combo multiplier, the "raining from the sky"
// payout (coin-rain + HUD count-up), and the gold HUD render. Gold STORAGE lives
// in edition.js (getGold/addGold/spendGold) — this module imports it and adds the
// presentation layer on top.
//
// Decoupling note: awardGold takes `reducedMotion` as a param (rather than reaching
// back into app.js getSettings) and no longer writes game.goldThisRound — app.js is
// the <script type="module"> entry, so importing it here would cycle. The caller in
// app.js does `game.goldThisRound += delta` itself right after awardGold.
import { getGold, addGold } from "/edition.js";

// --- Gold economy: earn on progress, with combo multipliers, raining from the sky. ---
export const GOLD = {
  green: 25,             // each newly-revealed green
  yellow: 8,             // each newly-revealed yellow
  solve: 100,            // flat solve bonus
  speedPerGuessLeft: 60, // × unused guesses — solve fast, earn more
  revealCost: 1000,      // a letter is a splurge (gold is precious)
  vowelCost: 150,        // a cheap, frequent nudge
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
function animateCount(el, from, to) {
  const dur = 650, start = performance.now();
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
