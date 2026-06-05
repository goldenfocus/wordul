// src/worduls.ts — per-owner Durable Object (idFromName(username)). Authoritative store
// of a user's authored worduls. Owner-gating is enforced UPSTREAM in the worker (it
// verifies the Bearer session against the owner's User DO before calling /publish|/patch).
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import { normalizeWordul, wordulToWorld, RESERVED_SLUGS, slugify, type Wordul } from "./wordul-core.ts";

type WordulsState = { worlds: Record<string, Wordul> }; // keyed by slug

export class Worduls extends DurableObject<Env> {
  private async load(): Promise<WordulsState> {
    return (await this.ctx.storage.get<WordulsState>("state")) ?? { worlds: {} };
  }
  private async save(s: WordulsState): Promise<void> {
    await this.ctx.storage.put("state", s);
  }
  private uniqueSlug(state: WordulsState, desired: string): string {
    let base = slugify(desired);
    if (RESERVED_SLUGS.has(base)) base = `${base}-1`;
    if (!state.worlds[base] && !RESERVED_SLUGS.has(base)) return base;
    for (let n = 2; ; n++) {
      const cand = `${base}-${n}`;
      if (!state.worlds[cand] && !RESERVED_SLUGS.has(cand)) return cand;
    }
  }
  private newId(now: number): string {
    // Deterministic-enough id without Math.random/Date.now: timestamp base36.
    // Collisions within one owner DO are resolved by the caller (append "x").
    return `wd_${now.toString(36)}`;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const state = await this.load();

    if (req.method === "POST" && url.pathname === "/publish") {
      const body = await req.json().catch(() => null) as
        { owner?: string; desiredSlug?: string; bundle?: unknown; now?: number } | null;
      if (!body || typeof body.owner !== "string") return new Response("bad request", { status: 400 });
      const now = typeof body.now === "number" ? body.now : 0;
      const slug = this.uniqueSlug(state, body.desiredSlug || (body.bundle as { vibeTitle?: string })?.vibeTitle || "world");
      let worldId = this.newId(now);
      while (Object.values(state.worlds).some((w) => w.worldId === worldId)) worldId += "x";
      const wordul = normalizeWordul(body.bundle, { owner: body.owner, slug, worldId, now });
      if (!wordul) return new Response("invalid wordul", { status: 400 });
      state.worlds[slug] = wordul;
      await this.save(state);
      return Response.json({ url: `/@${body.owner}/${slug}`, worldId, slug });
    }

    if (req.method === "GET" && url.pathname === "/list") {
      const includeAll = url.searchParams.get("includeAll") === "1";
      const worlds = Object.values(state.worlds)
        .filter((w) => includeAll || w.status === "published")
        .sort((a, b) => (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt))
        .map((w) => publicCard(w));
      return Response.json({ worlds });
    }

    if (req.method === "GET" && url.pathname === "/get") {
      const w = state.worlds[url.searchParams.get("slug") ?? ""];
      if (!w) return new Response("not found", { status: 404 });
      return Response.json(w); // owner-only route upstream; full record incl. word
    }

    // Server→server: a room seeds its playable World here. Locks the word (anti rug-pull) on first
    // seed. Does NOT count a play — a wordul room is ONE shared DO seeded once, so coupling plays to
    // resolve would count ~1 ever. Plays are bumped per-player via POST /play (below).
    if (req.method === "GET" && url.pathname === "/resolve") {
      const w = state.worlds[url.searchParams.get("slug") ?? ""];
      if (!w || w.status === "unpublished") return new Response("not found", { status: 404 });
      if (!w.wordLocked) { w.wordLocked = true; await this.save(state); }
      return Response.json(wordulToWorld(w));
    }

    // Server→server: the room bumps this ONCE per distinct player who plays the wordul (Task 5 calls
    // it from the per-player terminal-status path, guarded so reconnects don't double-count).
    if (req.method === "POST" && url.pathname === "/play") {
      const w = state.worlds[url.searchParams.get("slug") ?? ""];
      if (!w) return new Response("not found", { status: 404 });
      w.plays += 1;
      await this.save(state);
      return Response.json({ plays: w.plays });
    }

    if (req.method === "PATCH" && url.pathname === "/patch") {
      const w = state.worlds[url.searchParams.get("slug") ?? ""];
      if (!w) return new Response("not found", { status: 404 });
      const patch = await req.json().catch(() => null) as Record<string, unknown> | null;
      if (!patch) return new Response("bad request", { status: 400 });
      if (typeof patch.vibeTitle === "string" && patch.vibeTitle) w.vibeTitle = patch.vibeTitle;
      if (patch.story && typeof patch.story === "object") {
        const s = patch.story as Record<string, unknown>;
        if (typeof s.title === "string" && typeof s.body === "string") {
          w.story = { title: s.title, body: s.body, ...(typeof s.tip === "string" ? { tip: s.tip } : {}) };
        }
      }
      if (patch.colorScheme && typeof patch.colorScheme === "object") {
        const c = patch.colorScheme as Record<string, unknown>;
        if (typeof c.a1 === "string" && typeof c.a2 === "string" && typeof c.a3 === "string") {
          w.colorScheme = { a1: c.a1, a2: c.a2, a3: c.a3 };
        }
      }
      if (typeof patch.voice === "string" && patch.voice) w.voice = patch.voice;
      if (typeof patch.rows === "number") w.rows = Math.min(10, Math.max(3, Math.round(patch.rows)));
      // Word change ONLY allowed before first play (anti rug-pull).
      if (typeof patch.word === "string" && !w.wordLocked) {
        const up = patch.word.toUpperCase().trim();
        if (/^[A-Z]{4,12}$/.test(up)) w.word = up;
      }
      if (patch.status === "published" || patch.status === "unpublished" || patch.status === "draft") {
        w.status = patch.status;
      }
      w.updatedAt = typeof patch.now === "number" ? patch.now : w.updatedAt;
      await this.save(state);
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  }
}

/** Public card projection: NEVER includes the word (spoiler-safe). */
function publicCard(w: Wordul) {
  return {
    owner: w.owner, slug: w.slug, worldId: w.worldId, status: w.status,
    vibeTitle: w.vibeTitle, rows: w.rows, voice: w.voice,
    colorScheme: w.colorScheme, plays: w.plays, wordLocked: w.wordLocked,
    publishedAt: w.publishedAt, createdAt: w.createdAt,
    storyTitle: w.story.title, // title is safe; body is the post-solve reveal
  };
}
