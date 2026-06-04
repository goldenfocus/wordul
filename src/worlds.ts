// Single source of truth for browsable Worlds — themed places at /w/<slug>.
// Mirrors the MODES pattern (src/modes.ts): this is the SERVER copy; the hand-synced
// browser twin is public/worlds.js. KEEP THEM IN SYNC.
//
// A World pairs a URL slug with an edition (the theme pack in public/editions/*).
// Launch Worlds === the 7 shipped editions. Plan 3 layers admin KV overrides on top
// of these code defaults; Plan 1 reads the static registry only.
//
// NOTE: type is WorldDef, NOT World — src/daily-core.ts already owns `World`
// (the curated-day bundle). These are deliberately distinct.

export type WorldDef = {
  id: string;        // stable identity (=== editionId for the launch Worlds)
  slug: string;      // URL slug at /w/<slug>; admin-renameable later (Plan 3)
  name: string;      // display name on the card / World page
  blurb: string;     // one-line tagline shown on the World page
  editionId: string; // which edition (public/editions/<id>.js) paints this World
  featured: boolean; // included in the home strip's Featured set (Plan 2)
  order: number;     // sort order within listings
};

export const WORLDS: WorldDef[] = [
  { id: "default",   slug: "wordul",       name: "Wordul",       blurb: "The original. Obsidian and ultraviolet.",  editionId: "default",   featured: true,  order: 0 },
  { id: "jackpot",   slug: "jackpot",      name: "Jackpot",      blurb: "High-roller neon. The House is watching.", editionId: "jackpot",   featured: true,  order: 1 },
  { id: "arcade",    slug: "arcade",       name: "Arcade",       blurb: "Insert coin. The Cabinet glows.",          editionId: "arcade",    featured: true,  order: 2 },
  { id: "editorial", slug: "editorial",    name: "Editorial",    blurb: "Quiet broadsheet. The Editor approves.",   editionId: "editorial", featured: true,  order: 3 },
  { id: "tactile",   slug: "tactile",      name: "Tactile",      blurb: "Warm paper and ink. Coach has notes.",     editionId: "tactile",   featured: false, order: 4 },
  { id: "robot",     slug: "tin-bot",      name: "Tin Bot",      blurb: "Cold circuits. Sprocket computes.",        editionId: "robot",     featured: false, order: 5 },
  { id: "yang",      slug: "yangs-table",  name: "Yang's Table", blurb: "A seat at Yang's table.",                  editionId: "yang",      featured: false, order: 6 },
];

const BY_SLUG = new Map<string, WorldDef>(WORLDS.map((w) => [w.slug, w]));

export function listWorlds(): WorldDef[] {
  return [...WORLDS].sort((a, b) => a.order - b.order);
}

export function featuredWorlds(): WorldDef[] {
  return listWorlds().filter((w) => w.featured);
}

export function getWorld(slug: unknown): WorldDef | null {
  return typeof slug === "string" ? BY_SLUG.get(slug) ?? null : null;
}

export function isWorldSlug(slug: unknown): boolean {
  return getWorld(slug) !== null;
}

// Pure path → slug extractor, shared by the client router (public/worlds.js twin)
// and the worker. "/w/jackpot" -> "jackpot"; anything else -> null.
export function worldSlugFromPath(pathname: unknown): string | null {
  if (typeof pathname !== "string") return null;
  const m = pathname.match(/^\/w\/([a-z0-9-]{1,40})$/);
  return m ? m[1] : null;
}
