import { Room } from "./room.ts";
import { User } from "./user.ts";
import type { Env } from "./types.ts";
import { normalizeUsername, normalizeSlug, isValidUsername } from "./identity.ts";
import { isWordPage, slugFor, wordOfTheDay, ANSWER_WORDS } from "./words.ts";
export { Room, User };

const PROFILE_RE = /^\/@([a-z0-9_-]{3,20})$/;
const ROOM_RE = /^\/@([a-z0-9_-]{3,20})\/([a-z0-9-]{1,40})$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Room WebSocket: /ws?room=<owner>/<slug>
    if (url.pathname === "/ws") {
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

    // OG cards for word pages live in the wordul-og R2 bucket (built + uploaded offline).
    if (url.pathname.startsWith("/word/og/")) {
      const key = url.pathname.slice("/word/og/".length);
      const obj = await env.OG.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
      });
    }

    // Word wiki. Note: wrangler serves matching static assets BEFORE the worker, so a
    // word page like /word/ocean is served straight from public/word/ocean.html; the
    // /word/ branch below only runs on asset misses (uppercase → lowercase redirect,
    // and the friendly 404 for non-answer/excluded words). The featured-word route lives
    // at top-level /today — NOT /word/today, which would be shadowed by the TODAY page.
    if (url.pathname === "/today") {
      const slug = slugFor(wordOfTheDay(new Date()));
      return Response.redirect(`${url.origin}/word/${slug}`, 302);
    }
    if (url.pathname.startsWith("/word/")) {
      const raw = url.pathname.slice("/word/".length).replace(/\/$/, "");
      const lower = raw.toLowerCase();
      if (raw !== lower) return Response.redirect(`${url.origin}/word/${lower}`, 301);
      if (isWordPage(lower)) {
        return env.ASSETS.fetch(new Request(`${url.origin}/word/${lower}.html`));
      }
      // Non-answer or excluded word: a friendly dead-endless 404.
      return new Response(
        `<!doctype html><meta charset=utf-8><title>No word page</title>` +
          `<p>No wiki page for that word. <a href="/words">Browse all words</a> or <a href="/">play Wordul</a>.</p>`,
        { status: 404, headers: { "content-type": "text/html" } },
      );
    }
    if (url.pathname === "/words") {
      return env.ASSETS.fetch(new Request(`${url.origin}/words.html`));
    }

    // Profile + room pages: serve SPA shell with per-route meta injected.
    const profileMatch = url.pathname.match(PROFILE_RE);
    const roomMatch = url.pathname.match(ROOM_RE);
    if (profileMatch || roomMatch) {
      return injectMeta(env, url, profileMatch, roomMatch);
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

  urls.push(origin + "/words");
  for (const w of ANSWER_WORDS) {
    if (isWordPage(w)) urls.push(`${origin}/word/${slugFor(w)}`);
  }

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
): Promise<Response> {
  let title = "Wordul";
  let description = "Race your friends on the same Wordle.";

  if (roomMatch) {
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

class TextSetter {
  constructor(private content: string) {}
  element(el: Element) { el.setInnerContent(this.content); }
}

class AttrSetter {
  constructor(private attr: string, private value: string) {}
  element(el: Element) { el.setAttribute(this.attr, this.value); }
}
