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

/** Human "June 2, 2026" from a YYYY-MM-DD (UTC, locale-stable). */
function prettyDate(date: string): string {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const [y, m, d] = date.split("-").map(Number);
  return `${months[m - 1]} ${d}, ${y}`;
}

export function buildDailyMeta(
  date: string,
  world: World,
  origin: string,
): { title: string; description: string; canonical: string } {
  const pretty = prettyDate(date);
  const firstLine = (world.story.body || "").split("\n")[0].slice(0, 150);
  return {
    title: `Wordul of the Day — ${pretty}`,
    description: world.story.title
      ? `${world.story.title} ${firstLine}`.trim().slice(0, 200)
      : `Play the Wordul of the Day for ${pretty}. One word, the whole world, free — no ads.`,
    canonical: `${origin}/daily/${date}`,
  };
}

export function buildDailyJsonLd(date: string, world: World, origin: string): object {
  const url = `${origin}/daily/${date}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url,
        name: `Wordul of the Day — ${prettyDate(date)}`,
        description: world.story.body,
        datePublished: date,
        isPartOf: { "@type": "WebSite", name: "Wordul", url: origin },
      },
      {
        "@type": "Game",
        name: `Wordul of the Day — ${prettyDate(date)}`,
        url,
        gamePlatform: "Web browser",
        applicationCategory: "GameApplication",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ],
  };
}

/** Sitemap URLs for the daily surface: home, archive, and every known date. */
export function dailySitemapUrls(dates: string[], origin: string): string[] {
  const out = [`${origin}/`, `${origin}/daily/archive`];
  for (const d of dates) if (isValidDateString(d)) out.push(`${origin}/daily/${d}`);
  return out;
}
