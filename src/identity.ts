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

/** Names that may NOT be claimed via the open form — impersonation/brand/system bait only.
 *  Real people (incl. the owners: yan, antonio, yanik, zang) claim their handles like anyone
 *  else; only names that could impersonate the product, staff, or system are reserved.
 *  Lowercase, already-normalized form. Maintained here in version control (no KV hop). */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  // Product / brand impersonation (incl. the Wordle namesake)
  "wordul", "worduls", "wordule", "wordulofficial", "wordul-team",
  "wordle", "wordles", "wordleofficial", "nyt", "nytimes",
  // Authority / staff impersonation
  "admin", "admins", "administrator", "official", "verified", "mod", "mods",
  "moderator", "moderation", "staff", "support", "helpdesk", "help",
  "security", "abuse", "billing", "owner", "team", "root", "system",
  "sysadmin", "superuser",
  // Company brand
  "goldenfocus", "golden-focus",
  // System / auth / reserved routes
  "api", "www", "mail", "email", "login", "signin", "signup", "register",
  "logout", "account", "accounts", "settings", "profile", "password",
  "null", "undefined", "none", "anonymous", "guest", "nobody", "everyone",
  "deleted", "bot", "bots",
]);

/** True when a normalized username is reserved and cannot be claimed via the open path. */
export function isReserved(username: string): boolean {
  return RESERVED_USERNAMES.has(normalizeUsername(username));
}
