import { Room } from "./room.ts";
import { User } from "./user.ts";
import type { Env } from "./types.ts";
import { normalizeUsername, normalizeSlug, isValidUsername } from "./identity.ts";
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
      const path = `${owner}/${slug}`;
      const stub = env.ROOM.get(env.ROOM.idFromName(path));
      const upstream = new URL(req.url);
      upstream.searchParams.set("room", path);
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

    // Profile + room pages: serve SPA shell with per-route meta injected.
    const profileMatch = url.pathname.match(PROFILE_RE);
    const roomMatch = url.pathname.match(ROOM_RE);
    if (profileMatch || roomMatch) {
      return injectMeta(env, url, profileMatch, roomMatch);
    }

    // Everything else: static asset.
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
): Promise<Response> {
  let title = "Wordle Race";
  let description = "Race your friends on the same Wordle.";

  if (roomMatch) {
    const [, owner, slug] = roomMatch;
    title = `${slug.replace(/-/g, " ")} — a Wordle Race room by ${owner}`;
    description = `Join ${owner}'s Wordle Race room and race on the same word.`;
  } else if (profileMatch) {
    const [, name] = profileMatch;
    // Best-effort: a DO hiccup or odd payload must degrade to default meta, not 500 the page.
    try {
      const res = await env.USER.get(env.USER.idFromName(name)).fetch(`https://do/?username=${name}`);
      if (res.ok) {
        const p = (await res.json()) as { stats?: { wins?: number; bestStreak?: number } };
        const wins = p.stats?.wins ?? 0;
        const streak = p.stats?.bestStreak ?? 0;
        title = `${name} on Wordle Race — ${wins} wins, best streak ${streak}`;
        description = `${name}'s Wordle Race profile: ${wins} wins, best streak ${streak}.`;
      } else {
        title = `${name} on Wordle Race`;
        description = `${name}'s Wordle Race profile.`;
      }
    } catch {
      title = `${name} on Wordle Race`;
      description = `${name}'s Wordle Race profile.`;
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
