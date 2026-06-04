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

/** Names that may NOT be claimed via the open form (brand, role, impersonation bait).
 *  Lowercase, already-normalized form. Maintained here in version control (no KV hop). */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "wordul", "admin", "administrator", "official", "mod", "moderator", "staff",
  "support", "help", "root", "system", "owner", "team", "wordul-team",
  "yan", "yang", "jr", "goldenfocus", "golden-focus",
  "api", "www", "mail", "null", "undefined", "anonymous", "guest",
]);

/** True when a normalized username is reserved and cannot be claimed via the open path. */
export function isReserved(username: string): boolean {
  return RESERVED_USERNAMES.has(normalizeUsername(username));
}
