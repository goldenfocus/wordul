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

const BY_SLUG = new Map(WORLDS.map((w) => [w.slug, w]));

export function listWorlds() {
  return [...WORLDS].sort((a, b) => a.order - b.order);
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
