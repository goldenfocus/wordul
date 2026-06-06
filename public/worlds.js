// Browser twin of src/worlds.ts — KEEP IN SYNC. Single source of truth for the
// Worlds UI (the home strip, the /worlds theater, the /w/<slug> page). A World pairs
// a URL slug with an edition (public/editions/<id>.js). Launch Worlds === the 7
// shipped editions. Admin KV overrides (Plan 3) layer on top of these defaults.

export const WORLDS = [
  { id: "default",   slug: "wordul",       name: "Wordul",       blurb: "The original. Obsidian and ultraviolet.",  editionId: "default",   featured: true,  order: 0 },
  { id: "jackpot",   slug: "jackpot",      name: "Jackpot",      blurb: "High-roller neon. The House is watching.", editionId: "jackpot",   featured: true,  order: 1 },
  { id: "arcade",    slug: "arcade",       name: "Arcade",       blurb: "Insert coin. The Cabinet glows.",          editionId: "arcade",    featured: true,  order: 2 },
  { id: "editorial", slug: "editorial",    name: "Editorial",    blurb: "Quiet broadsheet. The Editor approves.",   editionId: "editorial", featured: true,  order: 3 },
  { id: "tactile",   slug: "tactile",      name: "Tactile",      blurb: "Warm paper and ink. Coach has notes.",     editionId: "tactile",   featured: false, order: 4 },
  { id: "robot",     slug: "tin-bot",      name: "Tin Bot",      blurb: "Cold circuits. Sprocket computes.",        editionId: "robot",     featured: false, order: 5 },
  { id: "yang",      slug: "yangs-table",  name: "Yang's Table", blurb: "A seat at Yang's table.",                  editionId: "yang",      featured: false, order: 6 },
];

// Runtime list: starts as the static base, replaced by hydrateWorlds() once the
// effective registry (code + admin KV overrides) is fetched at boot.
let CURRENT = [...WORLDS];
let BY_SLUG = new Map(CURRENT.map((w) => [w.slug, w]));

// Replace the runtime registry. Ignores non-arrays so a failed fetch is harmless.
export function hydrateWorlds(list) {
  if (!Array.isArray(list)) return;
  CURRENT = list.slice().sort((a, b) => a.order - b.order);
  BY_SLUG = new Map(CURRENT.map((w) => [w.slug, w]));
}

// Fetch the effective registry from the worker and hydrate. Returns true if the
// registry actually changed (so callers can re-render only when needed). Safe to call
// once at boot; swallows errors and keeps the static fallback (returns false).
export async function loadWorlds() {
  try {
    const res = await fetch("/worlds.json", { cache: "no-store" });
    if (!res.ok) return false;
    const next = await res.json();
    if (!Array.isArray(next)) return false;
    const before = JSON.stringify(CURRENT);
    hydrateWorlds(next);
    return JSON.stringify(CURRENT) !== before;
  } catch {
    return false; // keep the static fallback
  }
}

export function listWorlds() {
  return [...CURRENT].sort((a, b) => a.order - b.order);
}

export function featuredWorlds() {
  return listWorlds().filter((w) => w.featured);
}

export function getWorld(slug) {
  return typeof slug === "string" ? BY_SLUG.get(slug) ?? null : null;
}

export function isWorldSlug(slug) {
  return getWorld(slug) !== null;
}

export function worldSlugFromPath(pathname) {
  if (typeof pathname !== "string") return null;
  const m = pathname.match(/^\/w\/([a-z0-9-]{1,40})$/);
  return m ? m[1] : null;
}
