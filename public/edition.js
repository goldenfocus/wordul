// Wordul edition runtime: apply theme packs, picker, shared wallet, companion.
import { EDITIONS, getEdition } from "/editions/index.js";

const LS = { edition: "wordul.edition", gold: "wordul.gold", muted: "wordul.muted" };
const DEFAULT_GOLD = 50;

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
export function earnGold(guessCount) {
  const payout = Math.max(10, 70 - guessCount * 10);
  setGold(getGold() + payout);
  return payout;
}
export function spendGold(cost) {
  const g = getGold();
  if (g < cost) return false;
  setGold(g - cost);
  return true;
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
  if (bank.length === 0) return { text: "", speak: false };
  const i = (reactCounters[event] = (reactCounters[event] ?? -1) + 1) % bank.length;
  let text = bank[i];
  if (ctx.answer) text = text.replace("{answer}", ctx.answer);
  const muted = localStorage.getItem(LS.muted) === "1";
  return { text, speak: !!ed.sound?.voice?.on && !muted };
}
