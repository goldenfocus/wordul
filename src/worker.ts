import { Room } from "./room.ts";
import { User } from "./user.ts";
import { Challenge } from "./challenge.ts";
import { Daily } from "./daily.ts";
import { makeChallengeId } from "./challenge-core.ts";
import type { Env } from "./types.ts";
import { normalizeUsername, normalizeSlug, isValidUsername } from "./identity.ts";
import { activeDate } from "./daily-core.ts";
import type { World } from "./daily-core.ts";
import { buildDailyMeta, buildDailyJsonLd, dailyPrevNext, dailyDateFromPathname, dailySitemapUrls } from "./daily-seo.ts";
export { Room, User, Challenge, Daily };

const PROFILE_RE = /^\/@([a-z0-9_-]{3,20})$/;
const ROOM_RE = /^\/@([a-z0-9_-]{3,20})\/([a-z0-9-]{1,40})$/;
const CHALLENGE_RE = /^\/c\/([0-9A-Za-z]{5})$/;

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
  const urls: string[] = [origin + "/"];
  let cursor: string | undefined;
  do {
    const page = await env.DIRECTORY.list({ limit: 1000, cursor });
    for (const k of page.keys) {
      if (k.name.startsWith("user:")) urls.push(`${origin}/@${k.name.slice(5)}`);
      else if (k.name.startsWith("room:")) urls.push(`${origin}/@${k.name.slice(5)}`);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml" } });
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

  const meta = buildDailyMeta(date, world, url.origin);
  const jsonld = JSON.stringify(buildDailyJsonLd(date, world, url.origin));
  const { prev, next } = dailyPrevNext(date);
  const prose =
    `<h1>${escapeHtml(meta.title)}</h1>` +
    `<h2>${escapeHtml(world.story.title)}</h2>` +
    `<p>${escapeHtml(world.story.body)}</p>` +
    (world.story.tip ? `<p><em>${escapeHtml(world.story.tip)}</em></p>` : "") +
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
    .on('[data-daily-jsonld]', new TextSetter(jsonld))
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
