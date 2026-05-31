// src/identity.ts — pure identity/slug helpers (no Cloudflare deps).

const USERNAME_MAX = 20;
const SLUG_MAX = 40;

/** Lowercase, keep [a-z0-9_-], trim leading/trailing separators, clip length. */
export function normalizeUsername(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, USERNAME_MAX)
    .replace(/^[-_]+|[-_]+$/g, ""); // re-trim: clipping at MAX can expose a trailing separator
}

export function isValidUsername(input: string): boolean {
  const n = normalizeUsername(input);
  return n.length >= 3 && n.length <= USERNAME_MAX && /^[a-z0-9_-]+$/.test(n);
}

/** Room-code style: lowercase, [a-z0-9-], collapse + trim hyphens, clip. */
export function normalizeSlug(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
}

export function roomPath(owner: string, slug: string): string {
  return `${owner}/${slug}`;
}
