// public/world-card.js — one themed World card, reused by the home strip and the
// /worlds theater. The card self-paints in its World's edition chrome (paintEditionVars),
// so a row of cards reads as a wall of distinct vibes. Also the client-only "recent
// Worlds" store behind the theater's "Mine" tab (kept out of worlds.js, which must stay
// a byte-parity twin of the server registry and therefore localStorage-free).
import { paintEditionVars } from "/edition.js";

// Build one card as an <a> to /w/<slug>, painted in the World's skin. Name via
// textContent (XSS-safe; Plan 3 makes World names admin-editable).
export function renderWorldCard(world) {
  const a = document.createElement("a");
  a.className = "world-card";
  a.href = `/w/${world.slug}`;
  paintEditionVars(a, world.editionId);
  const name = document.createElement("span");
  name.className = "world-card-name";
  name.textContent = world.name;
  const blurb = document.createElement("span");
  blurb.className = "world-card-blurb";
  blurb.textContent = world.blurb;
  a.append(name, blurb);
  return a;
}

const LS_RECENT = "wordul.recentWorlds";
const RECENT_MAX = 12;

export function getRecentWorldSlugs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_RECENT) ?? "[]");
    return Array.isArray(raw) ? raw.filter((s) => typeof s === "string" && s) : [];
  } catch { return []; }
}

export function pushRecentWorld(slug) {
  if (typeof slug !== "string" || !slug) return;
  const next = [slug, ...getRecentWorldSlugs().filter((s) => s !== slug)].slice(0, RECENT_MAX);
  try { localStorage.setItem(LS_RECENT, JSON.stringify(next)); } catch { /* storage full/disabled */ }
}
