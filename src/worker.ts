import { Room } from "./room.ts";
import { User } from "./user.ts";
import { Challenge } from "./challenge.ts";
import { Daily } from "./daily.ts";
import { Science } from "./science-object.ts";
import { makeChallengeId } from "./challenge-core.ts";
import type { Env } from "./types.ts";
import { normalizeUsername, normalizeSlug, isValidUsername } from "./identity.ts";
import { activeDate } from "./daily-core.ts";
import type { World } from "./daily-core.ts";
import { buildDailyMeta, buildDailyJsonLd, dailyPrevNext, dailyDateFromPathname, dailySitemapUrls } from "./daily-seo.ts";
import { buildWeeklyScienceSummary, type SciencePublicDailySummary } from "./science.ts";
import { buildDailyPost, buildWeeklyPost, type FeedPost } from "./feed.ts";
import { BRAIN_NOTES } from "./brain-notes.ts";
export { Room, User, Challenge, Daily, Science };

const PROFILE_RE = /^\/@([a-z0-9_-]{3,20})$/;
const ROOM_RE = /^\/@([a-z0-9_-]{3,20})\/([a-z0-9-]{1,40})$/;
const CHALLENGE_RE = /^\/c\/([0-9A-Za-z]{5})$/;
const SCIENCE_DAILY_RE = /^\/api\/science\/daily\/(\d{4}-\d{2}-\d{2})(?:\.json)?$/;
const FEED_DATE_RE = /^\/feed\/(\d{4}-\d{2}-\d{2})(?:\.json)?$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Room WebSocket: /ws?room=<owner>/<slug>
    if (url.pathname === "/ws") {
      const challengeId = url.searchParams.get("challenge");
      if (challengeId && /^[0-9A-Za-z]{5}$/.test(challengeId)) {
        const player = normalizeUsername(url.searchParams.get("username") ?? "");
        if (!isValidUsername(player)) return new Response("invalid player", { status: 400 });
        const key = `c:${challengeId}:${player}`;
        const stub = env.ROOM.get(env.ROOM.idFromName(key));
        const upstream = new URL(req.url);
        upstream.searchParams.set("room", key);
        upstream.searchParams.set("challenge", challengeId);
        return stub.fetch(new Request(upstream.toString(), req));
      }
      const raw = url.searchParams.get("room") ?? "";
      const [ownerRaw, slugRaw] = raw.split("/");
      const owner = normalizeUsername(ownerRaw ?? "");
      const slug = normalizeSlug(slugRaw ?? "");
      if (!isValidUsername(owner) || slug.length < 1) {
        return new Response("invalid room", { status: 400 });
      }
      const requested = `${owner}/${slug}`;
      // A renamed room keeps its original DO key; the new (and any past) slug is a
      // KV alias back to that canonical path. Resolve it so old + new links both work.
      const canonical = (await env.DIRECTORY.get(`roomalias:${requested}`)) ?? requested;
      const stub = env.ROOM.get(env.ROOM.idFromName(canonical));
      const upstream = new URL(req.url);
      upstream.searchParams.set("room", canonical);
      return stub.fetch(new Request(upstream.toString(), req));
    }

    // Profile JSON API: /api/user/<name>
    if (url.pathname.startsWith("/api/user/")) {
      const name = normalizeUsername(decodeURIComponent(url.pathname.slice("/api/user/".length)));
      if (!isValidUsername(name)) return new Response("bad username", { status: 400 });
      const stub = env.USER.get(env.USER.idFromName(name));
      return stub.fetch(new Request(`https://do/?username=${name}`, { method: "GET" }));
    }

    // Mint a challenge: POST /api/challenge
    if (url.pathname === "/api/challenge" && req.method === "POST") {
      const id = makeChallengeId();
      const stub = env.CHALLENGE.get(env.CHALLENGE.idFromName(id));
      const body = (await req.json()) as Record<string, unknown>;
      return stub.fetch(new Request("https://do/", {
        method: "POST",
        body: JSON.stringify({ ...body, id }),
        headers: { "content-type": "application/json" },
      }));
    }

    // Challenge meta (no word): GET /api/challenge/<id>/meta
    const metaMatch = url.pathname.match(/^\/api\/challenge\/([0-9A-Za-z]{5})\/meta$/);
    if (metaMatch && req.method === "GET") {
      const stub = env.CHALLENGE.get(env.CHALLENGE.idFromName(metaMatch[1]));
      return stub.fetch(new Request("https://do/meta", { method: "GET" }));
    }

    // Sitemap from the directory.
    if (url.pathname === "/sitemap.xml") {
      return sitemap(env, url.origin);
    }

    // Bare /daily -> today's dated permalink (the daily lives at the date; "/" is the hub).
    if (url.pathname === "/daily") {
      return Response.redirect(url.origin + "/daily/" + activeDate(Date.now()), 302);
    }

    // Admin seed: POST /daily/schedule (Bearer token; closed/401 when DAILY_ADMIN_TOKEN unset).
    if (url.pathname === "/daily/schedule" && req.method === "POST") {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!env.DAILY_ADMIN_TOKEN || token !== env.DAILY_ADMIN_TOKEN) {
        return new Response("unauthorized", { status: 401 });
      }
      const stub = env.DAILY.get(env.DAILY.idFromName("daily"));
      return stub.fetch(new Request("https://do/schedule", {
        method: "POST",
        body: await req.text(),
        headers: { "content-type": "application/json" },
      }));
    }

    // Archive index.
    if (url.pathname === "/daily/archive") {
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter("Wordul Daily — Archive"))
        .on('[data-meta="description"]', new AttrSetter("content", "Every Wordul of the Day — the whole archive, one word at a time."))
        .on('[data-meta="canonical"]', new AttrSetter("href", url.origin + "/daily/archive"))
        .transform(shell);
    }

    // Dated permalink — the eternal artifact. /daily/<YYYY-MM-DD>
    const dailyDate = dailyDateFromPathname(url.pathname);
    if (dailyDate && dailyDate <= activeDate(Date.now())) {
      return injectDailyMeta(env, url, dailyDate);
    }

    // Public dates list (powers the archive UI).
    if (url.pathname === "/api/daily/dates") {
      const stub = env.DAILY.get(env.DAILY.idFromName("daily"));
      return stub.fetch(new Request("https://do/dates", { method: "GET" }));
    }

    // Public, privacy-preserving research artifacts. These are intentionally JSON-first
    // so AI systems and researchers can ingest them without scraping the app UI.
    if (url.pathname === "/science/latest.json" || url.pathname === "/api/science/today") {
      return scienceDaily(env, activeDate(Date.now()));
    }
    const scienceMatch = url.pathname.match(SCIENCE_DAILY_RE);
    if (scienceMatch && req.method === "GET") {
      return scienceDaily(env, scienceMatch[1]);
    }
    if (url.pathname === "/science/weekly.json" || url.pathname === "/api/science/weekly") {
      return scienceWeekly(env);
    }

    // Living Lab Feed — JSON-first (the honest AI/science surface).
    if (url.pathname === "/feed.json") {
      const posts = await feedStream(env);
      return Response.json({ generatedAt: Date.now(), posts }, { headers: { "cache-control": "public, max-age=300" } });
    }
    if (url.pathname === "/feed/weekly.json") {
      return Response.json(await feedWeeklyPost(env), { headers: { "cache-control": "public, max-age=300" } });
    }
    const feedJsonMatch = url.pathname.match(FEED_DATE_RE);
    if (feedJsonMatch && url.pathname.endsWith(".json") && req.method === "GET") {
      const post = await feedDailyPost(env, feedJsonMatch[1]);
      // A still-active day's post is not published — return 404 rather than a teaser blob to tools.
      if (!post.published) return new Response("not yet", { status: 404 });
      return Response.json(post, { headers: { "cache-control": "public, max-age=300" } });
    }

    if (url.pathname === "/feed") return renderFeedStream(env, url);
    if (url.pathname === "/feed/weekly") {
      const post = await feedWeeklyPost(env);
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter(post.headline))
        .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/feed/weekly`))
        .on('[data-feed-prose]', new RawHtmlSetter(feedPostProse(post, url.origin)))
        .transform(shell);
    }
    const feedHtmlMatch = url.pathname.match(FEED_DATE_RE);
    if (feedHtmlMatch && !url.pathname.endsWith(".json")) return renderFeedPost(env, url, feedHtmlMatch[1]);

    // Legacy redirect: /r or /r/<code> -> home (rooms are owner-nested now).
    if (url.pathname === "/r" || url.pathname.startsWith("/r/")) {
      return Response.redirect(url.origin + "/", 301);
    }

    // Design gallery: serve /designs/* from the DESIGNS R2 bucket (permanent,
    // upload-only — no redeploy needed to publish a new prototype).
    if (url.pathname === "/designs" || url.pathname === "/designs/") {
      const idx = await env.DESIGNS.get("designs/index.html");
      if (idx) {
        return new Response(idx.body, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("No designs yet.", { status: 404 });
    }
    if (url.pathname.startsWith("/designs/")) {
      const key = url.pathname.slice(1); // drop leading "/"
      // Pretty slug URLs (/designs/<slug>) map to <slug>.html objects; fall back
      // when the verbatim key misses so manifest.json / index.html still hit directly.
      const obj =
        (await env.DESIGNS.get(key)) ??
        (key.endsWith(".html") ? null : await env.DESIGNS.get(key + ".html"));
      if (obj) {
        const ct = obj.httpMetadata?.contentType ?? "text/html; charset=utf-8";
        return new Response(obj.body, { headers: { "content-type": ct } });
      }
      return new Response(
        "<!doctype html><meta charset=utf-8><title>Design not found</title>" +
          "<body style=font-family:system-ui;padding:3rem><h1>Design not found</h1>" +
          "<p><a href=/designs/>← back to the gallery</a></p>",
        { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    // Profile + room + challenge pages: serve SPA shell with per-route meta injected.
    const profileMatch = url.pathname.match(PROFILE_RE);
    const roomMatch = url.pathname.match(ROOM_RE);
    const challengeMatch = url.pathname.match(CHALLENGE_RE);
    if (profileMatch || roomMatch || challengeMatch) {
      return injectMeta(env, url, profileMatch, roomMatch, challengeMatch);
    }

    // Everything else: static asset (SPA fallback handled by wrangler).
    return env.ASSETS.fetch(req);
  },
};

async function sitemap(env: Env, origin: string): Promise<Response> {
  const urls: string[] = [origin + "/", origin + "/science/latest.json", origin + "/science/weekly.json"];
  let cursor: string | undefined;
  do {
    const page = await env.DIRECTORY.list({ limit: 1000, cursor });
    for (const k of page.keys) {
      if (k.name.startsWith("user:")) urls.push(`${origin}/@${k.name.slice(5)}`);
      else if (k.name.startsWith("room:")) urls.push(`${origin}/@${k.name.slice(5)}`);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // Daily surface: home, archive, and every known date (best-effort — a DAILY hiccup
  // must not 500 the sitemap).
  try {
    const res = await env.DAILY.get(env.DAILY.idFromName("daily")).fetch("https://do/dates");
    if (res.ok) {
      const { dates } = (await res.json()) as { dates: string[] };
      urls.push(...dailySitemapUrls(dates, origin));
    }
  } catch { /* skip daily urls */ }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml" } });
}

async function scienceDaily(env: Env, date: string): Promise<Response> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("bad date", { status: 400 });
  const includeWords = date < activeDate(Date.now());
  const stub = env.SCIENCE.get(env.SCIENCE.idFromName(date));
  const res = await stub.fetch(`https://do/summary?date=${date}&includeWords=${includeWords ? "1" : "0"}`);
  return withJsonCache(res, includeWords ? 300 : 60);
}

async function scienceWeekly(env: Env): Promise<Response> {
  const today = activeDate(Date.now());
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(today, -6 + i));
  const daily = await Promise.all(dates.map(async (date) => {
    const includeWords = date < today;
    const stub = env.SCIENCE.get(env.SCIENCE.idFromName(date));
    const res = await stub.fetch(`https://do/summary?date=${date}&includeWords=${includeWords ? "1" : "0"}`);
    return (await res.json()) as SciencePublicDailySummary;
  }));
  return Response.json(buildWeeklyScienceSummary(daily, Date.now()), {
    headers: { "cache-control": "public, max-age=300" },
  });
}

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function withJsonCache(res: Response, maxAge: number): Response {
  const headers = new Headers(res.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", `public, max-age=${maxAge}`);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function fetchSummary(env: Env, date: string, today: string): Promise<SciencePublicDailySummary> {
  const includeWords = date < today;
  const stub = env.SCIENCE.get(env.SCIENCE.idFromName(date));
  const res = await stub.fetch(`https://do/summary?date=${date}&includeWords=${includeWords ? "1" : "0"}`);
  return (await res.json()) as SciencePublicDailySummary;
}

async function fetchWorld(env: Env, date: string): Promise<World> {
  const res = await env.DAILY.get(env.DAILY.idFromName("daily")).fetch(`https://do/resolve?date=${date}`);
  return (await res.json()) as World;
}

async function feedDailyPost(env: Env, date: string): Promise<FeedPost> {
  const today = activeDate(Date.now());
  const [summary, world] = await Promise.all([fetchSummary(env, date, today), fetchWorld(env, date)]);
  return buildDailyPost(summary, world, BRAIN_NOTES, { todayUTC: today });
}

async function feedWeeklyPost(env: Env): Promise<FeedPost> {
  const today = activeDate(Date.now());
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(today, -6 + i));
  const daily = await Promise.all(dates.map((d) => fetchSummary(env, d, today)));
  const weekly = buildWeeklyScienceSummary(daily, Date.now());
  return buildWeeklyPost(weekly, BRAIN_NOTES, { todayUTC: today });
}

/** The published stream: the last `days` PAST days, newest first, published only. */
async function feedStream(env: Env, days = 14): Promise<FeedPost[]> {
  const today = activeDate(Date.now());
  const dates = Array.from({ length: days }, (_, i) => shiftDate(today, -1 - i)); // yesterday backwards
  const posts = await Promise.all(dates.map((d) => feedDailyPost(env, d).catch(() => null)));
  return posts.filter((p): p is FeedPost => !!p && p.published);
}

function feedPostProse(post: FeedPost, origin: string): string {
  const findings = post.findings.map((f) => `<li>${escapeHtml(f.text)}</li>`).join("");
  const notes = post.brainNotes.map((n) =>
    `<aside class="brain-note" data-pillar="${n.pillar}"><h3>${escapeHtml(n.title)}</h3>` +
    `<p>${escapeHtml(n.note)}</p>${n.citation ? `<cite>${escapeHtml(n.citation)}</cite>` : ""}</aside>`).join("");
  const ed = post.editorial?.intro ? `<p class="lab-intro">${escapeHtml(post.editorial.intro)}</p>` : "";
  return `<article><h1>${escapeHtml(post.headline)}</h1>${ed}` +
    `<ul class="findings">${findings}</ul>${notes}` +
    `<p class="pillars">${post.pillars.map(escapeHtml).join(" · ")}</p>` +
    `<nav><a href="${origin}/feed">← the Lab feed</a></nav></article>`;
}

function feedArticleJsonLd(post: FeedPost, origin: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.headline,
    datePublished: post.date,
    author: { "@type": "Organization", name: "Wordul" },
    publisher: { "@type": "Organization", name: "Wordul", url: origin },
    about: post.pillars,
    isPartOf: { "@type": "WebSite", name: "Wordul Living Lab", url: `${origin}/feed` },
  };
}

async function renderFeedPost(env: Env, url: URL, date: string): Promise<Response> {
  const post = await feedDailyPost(env, date);
  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  if (!post.published) {
    // Active/unknown day: no-spoiler shell, self canonical, no findings.
    return new HTMLRewriter()
      .on('[data-meta="title"]', new TextSetter("The Wordul Lab"))
      .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/feed/${date}`))
      .transform(shell);
  }
  const title = post.headline;
  const desc = post.findings.map((f) => f.text).join(" ").slice(0, 200);
  const jsonld = JSON.stringify(feedArticleJsonLd(post, url.origin)).replace(/</g, "\\u003c");
  return new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter(title))
    .on('[data-meta="og:title"]', new AttrSetter("content", title))
    .on('[data-meta="description"]', new AttrSetter("content", desc))
    .on('[data-meta="og:description"]', new AttrSetter("content", desc))
    .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/feed/${date}`))
    .on('[data-meta="og:url"]', new AttrSetter("content", `${url.origin}/feed/${date}`))
    .on('[data-feed-jsonld]', new RawHtmlSetter(jsonld))
    .on('[data-feed-prose]', new RawHtmlSetter(feedPostProse(post, url.origin)))
    .transform(shell);
}

async function renderFeedStream(env: Env, url: URL): Promise<Response> {
  const posts = await feedStream(env);
  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  const list = posts.map((p) =>
    `<li><a href="${url.origin}/feed/${p.slug}"><strong>${escapeHtml(p.headline)}</strong></a>` +
    (p.findings[0] ? `<span>${escapeHtml(p.findings[0].text)}</span>` : "") + `</li>`).join("");
  const prose = `<h1>The Wordul Living Lab</h1><p>Honest, privacy-preserving discoveries from the daily puzzle.</p><ul class="feed-stream">${list}</ul>`;
  return new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter("The Wordul Living Lab — daily discoveries"))
    .on('[data-meta="description"]', new AttrSetter("content", "Honest, privacy-preserving discoveries about how people learn and reason, from the Wordul of the Day."))
    .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/feed`))
    .on('[data-feed-prose]', new RawHtmlSetter(prose))
    .transform(shell);
}

async function injectMeta(
  env: Env,
  url: URL,
  profileMatch: RegExpMatchArray | null,
  roomMatch: RegExpMatchArray | null,
  challengeMatch: RegExpMatchArray | null = null,
): Promise<Response> {
  let title = "Wordul";
  let description = "Race your friends on the same word — come wordul with us.";

  if (challengeMatch) {
    const [, id] = challengeMatch;
    // Best-effort OG meta for a shared challenge link — a DO hiccup degrades to default.
    try {
      const res = await env.CHALLENGE.get(env.CHALLENGE.idFromName(id)).fetch("https://do/meta");
      if (res.ok) {
        const m = (await res.json()) as { owner?: string; ownerScore?: string };
        const owner = m.owner ?? "someone";
        title = `Beat @${owner}'s Wordul challenge`;
        description = `@${owner} scored ${m.ownerScore ?? "?"} on this word. Same word, your turn — beat the score.`;
      } else {
        title = "A Wordul challenge";
        description = "Same word, your turn — beat the score.";
      }
    } catch {
      title = "A Wordul challenge";
      description = "Same word, your turn — beat the score.";
    }
  } else if (roomMatch) {
    const [, owner, slug] = roomMatch;
    title = `${slug.replace(/-/g, " ")} — a Wordul room by ${owner}`;
    description = `Join ${owner}'s Wordul room and race on the same word.`;
  } else if (profileMatch) {
    const [, name] = profileMatch;
    // Best-effort: a DO hiccup or odd payload must degrade to default meta, not 500 the page.
    try {
      const res = await env.USER.get(env.USER.idFromName(name)).fetch(`https://do/?username=${name}`);
      if (res.ok) {
        const p = (await res.json()) as { stats?: { wins?: number; bestStreak?: number } };
        const wins = p.stats?.wins ?? 0;
        const streak = p.stats?.bestStreak ?? 0;
        title = `${name} on Wordul — ${wins} wins, best streak ${streak}`;
        description = `${name}'s Wordul profile: ${wins} wins, best streak ${streak}.`;
      } else {
        title = `${name} on Wordul`;
        description = `${name}'s Wordul profile.`;
      }
    } catch {
      title = `${name} on Wordul`;
      description = `${name}'s Wordul profile.`;
    }
  }

  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  const canonical = url.origin + url.pathname;
  return new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter(title))
    .on('[data-meta="og:title"]', new AttrSetter("content", title))
    .on('[data-meta="description"]', new AttrSetter("content", description))
    .on('[data-meta="og:description"]', new AttrSetter("content", description))
    .on('[data-meta="canonical"]', new AttrSetter("href", canonical))
    .on('[data-meta="og:url"]', new AttrSetter("content", canonical))
    .transform(shell);
}

// Serve the SPA shell themed for a daily date: meta + JSON-LD + crawlable story
// prose + prev/next links injected. `date` is a validated YYYY-MM-DD.
async function injectDailyMeta(env: Env, url: URL, date: string): Promise<Response> {
  let world: World | null = null;
  try {
    const res = await env.DAILY.get(env.DAILY.idFromName("daily")).fetch(`https://do/resolve?date=${date}`);
    if (res.ok) world = (await res.json()) as World;
  } catch { /* degrade to default meta below */ }

  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  if (!world) {
    // DAILY unavailable — still serve a sane shell with a self canonical.
    return new HTMLRewriter()
      .on('[data-meta="title"]', new TextSetter("Wordul of the Day"))
      .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/daily/${date}`))
      .transform(shell);
  }

  // The ACTIVE puzzle must NEVER reveal its answer via SEO — a curated story like
  // "Why EMBER?" would leak today's word to anyone reading view-source. Today: generic,
  // no-spoiler meta + prose. Past days are archival → full story.
  const isActive = date === activeDate(Date.now());
  const seoWorld: World = isActive
    ? { ...world, story: { title: "Today's Wordul", body: "One word, the whole world. Solve today's Wordul to reveal the story behind the word." } }
    : world;
  const meta = buildDailyMeta(date, seoWorld, url.origin);
  const jsonld = JSON.stringify(buildDailyJsonLd(date, seoWorld, url.origin));
  const { prev, next } = dailyPrevNext(date);
  const prose =
    `<h1>${escapeHtml(meta.title)}</h1>` +
    `<h2>${escapeHtml(seoWorld.story.title)}</h2>` +
    `<p>${escapeHtml(seoWorld.story.body)}</p>` +
    (seoWorld.story.tip ? `<p><em>${escapeHtml(seoWorld.story.tip)}</em></p>` : "") +
    `<nav><a href="${url.origin}/daily/${prev}">← ${prev}</a> · ` +
    `<a href="${url.origin}/daily/archive">archive</a> · ` +
    `<a href="${url.origin}/daily/${next}">${next} →</a></nav>`;

  return new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter(meta.title))
    .on('[data-meta="og:title"]', new AttrSetter("content", meta.title))
    .on('[data-meta="description"]', new AttrSetter("content", meta.description))
    .on('[data-meta="og:description"]', new AttrSetter("content", meta.description))
    .on('[data-meta="canonical"]', new AttrSetter("href", meta.canonical))
    .on('[data-meta="og:url"]', new AttrSetter("content", meta.canonical))
    .on('[data-daily-jsonld]', new RawHtmlSetter(jsonld.replace(/</g, "\\u003c")))
    .on('[data-daily-prose]', new RawHtmlSetter(prose))
    .transform(shell);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

class TextSetter {
  constructor(private content: string) {}
  element(el: Element) { el.setInnerContent(this.content); }
}

class AttrSetter {
  constructor(private attr: string, private value: string) {}
  element(el: Element) { el.setAttribute(this.attr, this.value); }
}

class RawHtmlSetter {
  constructor(private html: string) {}
  element(el: Element) { el.setInnerContent(this.html, { html: true }); }
}
