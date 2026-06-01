// Wordul edition runtime: apply theme packs, picker, shared wallet, companion.
import { EDITIONS, getEdition } from "/editions/index.js";

const LS = { edition: "wordul.edition", gold: "wordul.gold", muted: "wordul.muted" };
const DEFAULT_GOLD = 0; // you start broke and earn your way up

export function getGold() {
  const n = parseInt(localStorage.getItem(LS.gold) ?? "", 10);
  if (Number.isNaN(n)) { setGold(DEFAULT_GOLD); return DEFAULT_GOLD; }
  return n;
}
export function setGold(n) {
  const v = Math.max(0, Math.floor(n));
  localStorage.setItem(LS.gold, String(v));
  return v;
}
// Signed writer: persists the balance WITHOUT the zero-clamp. The public balance
// (setGold/addGold/spendGold) still clamps at 0; this exists only so the C4
// bankruptcy mechanic can push gold negative. Floors (no fractional gold) but never
// clamps. getGold reads the raw value back (parseInt handles a leading "-").
function setGoldSigned(n) {
  const v = Math.floor(n);
  localStorage.setItem(LS.gold, String(v));
  return v;
}
export function spendGold(cost) {
  const g = getGold();
  if (g < cost) return false;
  setGold(g - cost);
  return true;
}
export function addGold(delta) {
  return setGold(getGold() + delta);
}
// Drain gold WITHOUT clamping at 0 — the C4 bankruptcy primitive. Unlike spendGold
// (affordability-gated) and addGold/setGold (clamped non-negative), this lets the
// balance dip below zero so Hard Mode can run you into bankruptcy. `amount` is the
// positive drain; returns the new (possibly negative) balance.
export function drainGold(amount) {
  return setGoldSigned(getGold() - amount);
}

let activeId = "default";
const reactCounters = {};

export function resolveEdition(id) { return getEdition(id); }
export function getActiveEditionId() {
  return localStorage.getItem(LS.edition) ?? "default";
}

export function companionReact(event, ctx = {}) {
  const ed = getEdition(activeId);
  const bank = ed.companion?.lines?.[event] ?? [];
  if (bank.length === 0) return { text: "", raw: "", speak: false };
  const i = (reactCounters[event] = (reactCounters[event] ?? -1) + 1) % bank.length;
  const raw = bank[i];
  let text = raw;
  if (ctx.answer) text = text.replace("{answer}", ctx.answer);
  // Safety net: never show or speak a naked token if no answer was supplied.
  text = text.replace("{answer}", "that one");
  const muted = localStorage.getItem(LS.muted) === "1";
  return { text, raw, speak: !!ed.sound?.voice?.on && !muted };
}

const VAR_MAP = {
  bg: "--bg", fg: "--fg", muted: "--muted", border: "--border",
  tileEmpty: "--tile-empty", tilePendingBorder: "--tile-pending-border",
  keyBg: "--key-bg", green: "--green", yellow: "--yellow", gray: "--gray",
  accent: "--accent", bgCard: "--bg-card", error: "--error",
};

export function applyEdition(id) {
  const ed = getEdition(id);
  activeId = ed.id;
  const html = document.documentElement;
  html.dataset.edition = ed.id;
  for (const [k, cssVar] of Object.entries(VAR_MAP)) {
    if (ed.palette[k] != null) html.style.setProperty(cssVar, ed.palette[k]);
  }
  html.style.setProperty("--font-display", ed.fonts.display);
  html.style.setProperty("--font-body", ed.fonts.body);
  if (ed.fonts.link) injectFontLink(ed.id, ed.fonts.link);
  window.WordulMotion = { ...ed.motion };
  localStorage.setItem(LS.edition, ed.id);
  return ed;
}

function injectFontLink(id, href) {
  const elId = `wordul-font-${id}`;
  if (document.getElementById(elId)) return;
  const link = document.createElement("link");
  link.id = elId; link.rel = "stylesheet"; link.href = href;
  document.head.appendChild(link);
}

export function renderEditionPicker(rootEl, onPick) {
  rootEl.innerHTML = "";
  const current = getActiveEditionId();
  for (const ed of EDITIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edition-chip" + (ed.id === current ? " is-active" : "");
    btn.textContent = ed.name;
    btn.addEventListener("click", () => {
      applyEdition(ed.id);
      rootEl.querySelectorAll(".edition-chip").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      onPick?.(ed.id);
    });
    rootEl.appendChild(btn);
  }
}
