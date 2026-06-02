// src/daily-seo.ts — pure, dependency-free daily SEO/routing helpers (unit-tested).
import type { World } from "./daily-core.ts";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict YYYY-MM-DD AND a real calendar date (round-trips through UTC). */
export function isValidDateString(s: string): boolean {
  const m = DATE_RE.exec(s ?? "");
  if (!m) return false;
  const [, y, mo, d] = m;
  const dt = new Date(`${s}T00:00:00Z`);
  return (
    !Number.isNaN(dt.getTime()) &&
    dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() + 1 === Number(mo) &&
    dt.getUTCDate() === Number(d)
  );
}

/** /daily/<valid-date> → date string; anything else → null. */
export function dailyDateFromPathname(pathname: string): string | null {
  const m = /^\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(pathname ?? "");
  if (!m || !isValidDateString(m[1])) return null;
  return m[1];
}

/** Adjacent UTC dates for prev/next navigation + rel links. */
export function dailyPrevNext(date: string): { prev: string; next: string } {
  const base = Date.parse(`${date}T00:00:00Z`);
  const day = 86_400_000;
  return {
    prev: new Date(base - day).toISOString().slice(0, 10),
    next: new Date(base + day).toISOString().slice(0, 10),
  };
}
