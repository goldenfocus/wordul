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
