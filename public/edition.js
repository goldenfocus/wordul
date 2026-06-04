// Wordul edition runtime: apply theme packs, picker, shared wallet, companion.
import { EDITIONS, getEdition } from "/editions/index.js";
import { resolveTier, shouldSpeak } from "/companion.js";
import { mergeConfig } from "/roomConfig.js";

const LS = { edition: "wordul.edition", gold: "wordul.gold", muted: "wordul.muted" };

// Gold is now server-authoritative (USER ledger). The local value is a display cache
// only; clear any pre-existing balance once so a hacked/leaked localStorage number
// can't pose as a real balance. (Spec: secured two-token economy.)
if (typeof localStorage !== "undefined" && localStorage.getItem("wordul.goldMigratedV2") !== "1") {
  localStorage.removeItem(LS.gold);
  localStorage.setItem("wordul.goldMigratedV2", "1");
}

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
  if (!Number.isFinite(n)) return getGold(); // never persist NaN — a bad write would silently wipe the bank on next read
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

// Rung 1: no per-room override exists yet, so the room voice config is empty and
// companionReact resolves byte-for-byte to the edition default. Rung 2 returns
// `currentSnapshot?.roomConfig?.voice ?? {}` here — the ONE place persistence wires in.
function snapshotVoiceConfig() { return {}; }

export function resolveEdition(id) { return getEdition(id); }
// Sensory feedback config for committing a sloppy mistake (reusing a proven-gray
// letter). Every room inherits this default; an edition can override via
// effects.mistake. See app.js mistakeFx().
const DEFAULT_MISTAKE_FX = { shake: true, crack: true, sound: "glass", flash: false, haptics: false };
export function activeMistakeFx() { return getEdition(activeId).effects?.mistake ?? DEFAULT_MISTAKE_FX; }
export function getActiveEditionId() {
  return localStorage.getItem(LS.edition) ?? "default";
}

// The companion always speaks in Yang's cloned voice + lines, regardless of the
// active visual theme. Voice is decoupled from theming on purpose.
export const VOICE_EDITION = "yang";

export function companionReact(event, ctx = {}) {
  const ed = getEdition(VOICE_EDITION);
  // Resolve config through the merge contract: edition default <- room override (empty in rung 1).
  const merged = mergeConfig(
    { voice: { react: ed.companion?.react ?? {}, lines: ed.companion?.lines ?? {} } },
    { voice: snapshotVoiceConfig() },
  );
  const react = merged.voice?.react;
  const banks = merged.voice?.lines?.[event];
  if (!banks) return { text: "", raw: "", tier: null, speak: false };

  // Flat bank → use the array; nested bank → resolve the tier and read its array.
  const tier = Array.isArray(banks) ? null : resolveTier(event, ctx, react);
  const bank = Array.isArray(banks) ? banks : (banks[tier] ?? []);
  if (bank.length === 0) return { text: "", raw: "", tier, speak: false };

  // Round-robin within the chosen tier so the same line never repeats back-to-back.
  const counterKey = tier ? `${event}:${tier}` : event;
  const i = (reactCounters[counterKey] = (reactCounters[counterKey] ?? -1) + 1) % bank.length;
  const raw = bank[i];

  let text = raw.replace("{answer}", ctx.answer ?? "that one");
  const muted = localStorage.getItem(LS.muted) === "1";
  const voiceOn = !!ed.sound?.voice?.on && !muted;
  return { text, raw, tier, speak: voiceOn && shouldSpeak(event, tier, react, ctx.rng) };
}

const VAR_MAP = {
  bg: "--bg", fg: "--fg", muted: "--muted", border: "--border",
  tileEmpty: "--tile-empty", tilePendingBorder: "--tile-pending-border",
  keyBg: "--key-bg", green: "--green", yellow: "--yellow", gray: "--gray",
  accent: "--accent", bgCard: "--bg-card", error: "--error",
};

// Vibe Studio — a curated day ships a 3-color palette {a1,a2,a3}. Map it to the CSS custom
// properties the day page re-themes from: a1 drives --accent (re-lighting every existing
// color-mix(var(--accent)) chrome for free), and a1/a2/a3 are exposed as atoms for the
// bespoke palette layers (atmosphere glow, gradient title). Returns null for an absent or
// malformed palette so callers fall straight back to the active edition's own accent.
export function colorSchemeVars(cs) {
  if (!cs || typeof cs !== "object") return null;
  const { a1, a2, a3 } = cs;
  for (const v of [a1, a2, a3]) if (typeof v !== "string" || !v) return null;
  return { "--accent": a1, "--a1": a1, "--a2": a2, "--a3": a3 };
}

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

export function renderEditionPicker(rootEl, onPick, { disabled = false } = {}) {
  rootEl.innerHTML = "";
  const current = getActiveEditionId();
  for (const ed of EDITIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edition-chip" + (ed.id === current ? " is-active" : "");
    btn.textContent = ed.name;
    btn.disabled = disabled; // locked mid-game — the room theme can't shift under a live board
    if (!disabled) {
      btn.addEventListener("click", () => {
        applyEdition(ed.id);
        rootEl.querySelectorAll(".edition-chip").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        onPick?.(ed.id);
      });
    }
    rootEl.appendChild(btn);
  }
  if (disabled) {
    const note = document.createElement("p");
    note.className = "picker-note";
    note.textContent = "Theme is locked during the game.";
    rootEl.appendChild(note);
  }
}
