// src/wordul-core.ts — pure, dependency-free logic for user-authored worduls.
// A Wordul is a user's published creation. It CARRIES a playable World-bundle subset
// (validated via daily-core's normalizeWorldBundle) plus ownership + lifecycle.
// Distinct from World (daily bundle) and WorldDef (editions browser, worlds.ts).
import { normalizeWorldBundle, type World } from "./daily-core.ts";

export interface Wordul {
  worldId: string;
  owner: string;
  slug: string;
  status: "draft" | "published" | "unpublished";
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  vibeTitle: string;
  word: string;
  wordLocked: boolean;
  invented: boolean;
  rows: number;
  voice: string;
  story: { title: string; body: string; tip?: string };
  colorScheme?: { a1: string; a2: string; a3: string };
  glow?: World["glow"];
  images?: World["images"];
  playlist?: World["playlist"];
  plays: number;
  visibility: "public"; // RESERVED: future unlisted/password/invite
  remixedFrom?: { owner: string; slug: string; worldId: string }; // RESERVED
}

// Slugs that must never be a wordul slug (collide with routes/gallery/system).
export const RESERVED_SLUGS = new Set<string>([
  "worduls", "daily", "settings", "feed", "api", "ws", "c", "w", "r",
  "account", "login", "about", "designs", "science", "arena",
]);

export function slugify(title: string): string {
  const s = String(title || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "world";
}

// P1 content gate is a deliberate NO-OP (see spec §4.5). The call site exists so a
// denylist is a small additive change later, not a repaint.
export function passesContentGate(_word: string, _title: string, _story: string, _slug: string): boolean {
  return true;
}

export function normalizeWordul(
  input: unknown,
  meta: { owner: string; slug: string; worldId: string; now: number },
): Wordul | null {
  const bundle = normalizeWorldBundle(input);
  if (!bundle) return null;
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const vibeTitle = typeof o.vibeTitle === "string" && o.vibeTitle ? o.vibeTitle : bundle.story.title;
  if (!passesContentGate(bundle.word, vibeTitle, bundle.story.body, meta.slug)) return null;
  return {
    worldId: meta.worldId,
    owner: meta.owner,
    slug: meta.slug,
    status: "published",
    createdAt: meta.now,
    updatedAt: meta.now,
    publishedAt: meta.now,
    vibeTitle,
    word: bundle.word,
    wordLocked: false,
    invented: bundle.invented,
    rows: bundle.rows,
    voice: bundle.voice,
    story: bundle.story,
    ...(bundle.colorScheme ? { colorScheme: bundle.colorScheme } : {}),
    ...(bundle.glow ? { glow: bundle.glow } : {}),
    ...(bundle.images ? { images: bundle.images } : {}),
    ...(bundle.playlist ? { playlist: bundle.playlist } : {}),
    plays: 0,
    visibility: "public",
  };
}

/** Synthesize the playable World a room seeds from. Sentinel date keeps leaderboard
 *  keys unique + stable; edition "owned" marks it as a user creation. */
export function wordulToWorld(w: Wordul): World {
  return {
    date: `world:${w.worldId}`,
    word: w.word,
    edition: "owned",
    voice: w.voice,
    invented: w.invented,
    story: w.story,
    rows: w.rows,
    vibeTitle: w.vibeTitle,
    createdAt: w.createdAt,
    ...(w.colorScheme ? { colorScheme: w.colorScheme } : {}),
    ...(w.glow ? { glow: w.glow } : {}),
    ...(w.images ? { images: w.images } : {}),
    ...(w.playlist ? { playlist: w.playlist } : {}),
  };
}
