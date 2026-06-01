// Wordul — i18n layer.
//
// A tiny, build-free translation engine: every user-facing string lives in a locale
// dictionary (locales/<code>.js), and the UI reads it via t(key, vars). Adding a
// language = adding one locale module and registering it in LOCALES below — no code
// changes. Until a string is migrated to a key it can stay hardcoded; this is the
// foundation, not a finished sweep.
//
// Interpolation: t("greet", { name: "Yan" }) replaces {name} in the string.
// Resolution order: active locale → English → the key itself (so a missing key is
// visible, never a blank).

import { en } from "/locales/en.js";

// Register locales here as they're authored. en is always the fallback.
const LOCALES = { en };

let activeCode = "en";
let dict = en;

export function availableLocales() {
  return Object.keys(LOCALES);
}

export function getLang() {
  return activeCode;
}

// Map a navigator.language (e.g. "fr-CA") to a locale we ship, else English.
export function detectLang(navLang) {
  const code = String(navLang || "en").toLowerCase().split("-")[0];
  return LOCALES[code] ? code : "en";
}

export function setLang(code) {
  activeCode = LOCALES[code] ? code : "en";
  dict = LOCALES[activeCode];
  try { localStorage.setItem("wordul.lang", activeCode); } catch { /* storage off */ }
  try { document.documentElement.setAttribute("lang", activeCode); } catch { /* no DOM */ }
  return activeCode;
}

// Resolve the startup language: explicit saved pick wins, else locale auto-detect.
export function initLang() {
  let saved = null;
  try { saved = localStorage.getItem("wordul.lang"); } catch { /* storage off */ }
  const navLang = (typeof navigator !== "undefined" && navigator.language) || "en";
  return setLang(saved || detectLang(navLang));
}

export function t(key, vars) {
  let s = (dict && dict[key]) ?? en[key] ?? key;
  if (vars) {
    for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
  }
  return s;
}
