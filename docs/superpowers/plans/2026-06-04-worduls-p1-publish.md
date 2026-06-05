# Worduls P1 — Forge, Share & Solo-Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a claimed user publish a Vibe-Studio creation as a "wordul" that lives at `/@you/<slug>`, appears in their `/@you/worduls` gallery, is public, shareable, and **solo-playable** with a per-wordul leaderboard and story reveal — the full *create → share → watch plays tick up* loop.

**Architecture:** A per-owner `Worduls` Durable Object (SQLite, sharded `idFromName(username)`) is the authoritative store of a user's creations. A published wordul is also addressable as a room at `/@you/<slug>`: the room's first-contact seam resolves its playable bundle from the owner's `Worduls` DO (parallel to how a daily room resolves from `Daily`), then runs the existing daily-style one-shot engine (locked word, per-player one attempt, leaderboard, story reveal, post-solve chat). Publish/edit are owner-gated by the accounts `account/verify-session` seam.

**Tech Stack:** Cloudflare Workers, Durable Objects (SQLite migrations), TypeScript, vitest, vanilla browser JS (no framework). Spec: `docs/superpowers/specs/2026-06-04-worduls-publish-design.md`.

---

## Naming (read first — avoids a real clash)

The codebase already has two "world" types. **Do not reuse either** for this feature:

| Concept | Existing code name | Do not touch for P1 |
|---|---|---|
| Daily-puzzle bundle | `World` (`src/daily-core.ts`) | reuse its *playable fields* via a shared validator only |
| Global editions browser `/w/<slug>` | `WorldDef` (`src/worlds.ts`) | unrelated; leave alone |

**This feature's type is `Wordul`, stored in the `Worduls` DO.** A `Wordul` *carries* a playable
`World`-bundle subset; it is not a `World`. New files use the `wordul`/`worduls` names.

---

## Prerequisite gate (MUST pass before Task 1)

- [ ] **Confirm the accounts auth layer is on `origin/main`.**

Run:
```bash
git fetch origin --prune
git show origin/main:src/account-crypto.ts >/dev/null 2>&1 && echo "ACCOUNTS PRESENT" || echo "ACCOUNTS MISSING"
git show origin/main:src/user.ts 2>/dev/null | grep -q "account/verify-session" && echo "VERIFY-SESSION PRESENT" || echo "VERIFY-SESSION MISSING"
```
Expected: `ACCOUNTS PRESENT` and `VERIFY-SESSION PRESENT`.

If either is MISSING: **stop.** Accounts must land first (separate workstream). Then recreate this
worktree off the updated main:
```bash
cd /Users/theoutsider/wordul && bash dev/start.sh worduls-p1
```
This plan assumes `account/verify-session` (POST `{sessionToken}` → `{valid:boolean}`, in `src/user.ts`)
and `hashToken` (`src/account-crypto.ts`) exist.

---

## File structure

**Create:**
- `src/wordul-core.ts` — pure, CF-free: `Wordul` type, `normalizeWordul`, `slugify`, `RESERVED_SLUGS`, `passesContentGate` (no-op P1), `wordulToWorld` synthesizer.
- `src/wordul-core.test.ts` — unit tests for the above.
- `src/worduls.ts` — `Worduls` DurableObject (storage, publish/list/get/patch/resolve).
- `src/worduls.test.ts` — DO behavior tests.
- `public/wordul-publish.js` — client: build wordul from Vibe-Studio state, slug confirm, POST publish, success/share screen.
- `public/worduls-gallery.js` — client: render `/@you/worduls` gallery.

**Modify:**
- `src/daily-core.ts` — extract shared `normalizeWorldBundle`; `normalizeWorld` delegates to it.
- `src/daily-core.test.ts` — add a test that `normalizeWorld` still passes (regression guard).
- `src/types.ts` — add `WORDULS` to `Env`; add reserved `follows`/`followers` to `UserProfile`.
- `src/user-core.ts` — seed `follows`/`followers` in `freshProfile`/`healProfile`.
- `src/worker.ts` — routes `POST/GET/PATCH /api/worlds...`, owner-gate, `/@you/worduls` + wordul SSR meta.
- `src/room.ts` — `seedWordulIfNeeded` first-contact seam; call it alongside `seedDailyIfNeeded`.
- `wrangler.jsonc` — `WORDULS` DO binding + migration with `new_sqlite_classes: ["Worduls"]`.
- `public/vibe-studio.html` — enable the Submit seam; load `wordul-publish.js`.
- `public/vibe-studio.js` — wire Submit → `wordul-publish.js`.

---

## Task 1: Extract shared `normalizeWorldBundle` from `normalizeWorld`

**Files:**
- Modify: `src/daily-core.ts` (the `normalizeWorld` function ~line 111)
- Test: `src/daily-core.test.ts`

- [ ] **Step 1: Write a regression test that locks current `normalizeWorld` behavior**

Add to `src/daily-core.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeWorld } from "./daily-core.ts";

describe("normalizeWorld (regression after bundle extraction)", () => {
  it("accepts a valid dated world and defaults edition/voice/rows", () => {
    const w = normalizeWorld({ date: "2026-06-10", word: "ember", story: { title: "Why", body: "B" } });
    expect(w).not.toBeNull();
    expect(w!.word).toBe("EMBER");
    expect(w!.edition).toBe("default");
    expect(w!.voice).toBe("yang");
    expect(w!.rows).toBe(6);
  });
  it("rejects a bad date", () => {
    expect(normalizeWorld({ date: "nope", word: "ember", story: { title: "t", body: "b" } })).toBeNull();
  });
  it("rejects a non-pool word that is not invented", () => {
    expect(normalizeWorld({ date: "2026-06-10", word: "zzzzz", story: { title: "t", body: "b" } })).toBeNull();
  });
  it("accepts an invented non-pool word", () => {
    expect(normalizeWorld({ date: "2026-06-10", word: "zzzzz", invented: true, story: { title: "t", body: "b" } })).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm current behavior passes**

Run: `npx vitest run src/daily-core.test.ts`
Expected: PASS (these assert today's behavior).

- [ ] **Step 3: Extract `normalizeWorldBundle` and make `normalizeWorld` delegate**

In `src/daily-core.ts`, add this exported helper ABOVE `normalizeWorld`. It validates and defaults
ONLY the shared playable fields (word, invented, rows, voice, story, colorScheme, glow, images,
playlist) — no `date`/`edition`/`curator`/`feedEditorial`/`bonusWord`:
```ts
/** The fields a playable bundle shares between a daily World and a user Wordul. */
export type WorldBundle = {
  word: string; invented: boolean; rows: number; voice: string;
  story: { title: string; body: string; tip?: string };
  colorScheme?: { a1: string; a2: string; a3: string };
  glow?: World["glow"]; images?: World["images"]; playlist?: World["playlist"];
};

/** Validate + normalize the shared playable fields. Returns null if word/story invalid. */
export function normalizeWorldBundle(input: unknown): WorldBundle | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const word = typeof o.word === "string" ? o.word.toUpperCase().trim() : "";
  if (!/^[A-Z]+$/.test(word)) return null;
  if (word.length < 4 || word.length > 12) return null;
  const invented = o.invented === true;
  const pool = WORDS_BY_SIZE[word.length];
  const inPool = !!pool && (pool.valid.has(word) || pool.answers.includes(word));
  if (!inPool && !invented) return null;
  const story = (o.story && typeof o.story === "object" ? o.story : {}) as Record<string, unknown>;
  if (typeof story.title !== "string" || typeof story.body !== "string") return null;
  const bundle: WorldBundle = {
    word, invented,
    rows: clampNum(o.rows, 3, 10, 6),
    voice: typeof o.voice === "string" && o.voice ? o.voice : "yang",
    story: { title: story.title, body: story.body, ...(typeof story.tip === "string" ? { tip: story.tip } : {}) },
  };
  if (typeof o.vibeTitle === "string" && o.vibeTitle) (bundle as WorldBundle & { vibeTitle?: string }).vibeTitle = o.vibeTitle;
  if (o.colorScheme && typeof o.colorScheme === "object") {
    const c = o.colorScheme as Record<string, unknown>;
    if (isColor(c.a1) && isColor(c.a2) && isColor(c.a3)) bundle.colorScheme = { a1: c.a1, a2: c.a2, a3: c.a3 };
  }
  if (o.glow && typeof o.glow === "object") {
    const g = o.glow as Record<string, unknown>;
    const glow: NonNullable<World["glow"]> = {};
    for (const band of ["atmosphere", "header", "middle", "footer"] as const) {
      if (typeof g[band] === "number" && Number.isFinite(g[band])) glow[band] = clampNum(g[band], 0, 1, 0);
    }
    if (Object.keys(glow).length) bundle.glow = glow;
  }
  return bundle;
}
```
Then **refactor `normalizeWorld`** to delegate (preserving date/edition/curator/feedEditorial/bonusWord):
replace its word/invented/rows/voice/story/colorScheme/glow validation with a call to
`normalizeWorldBundle`, returning null if it returns null, and merging the bundle with the dated
fields. Keep the existing `date` (`DATE_RE`) check, `edition` default, `bonusWord`, `curator`,
`feedEditorial`, and `images`/`playlist` handling exactly as they are now.

- [ ] **Step 4: Run the regression test + the full daily-core suite**

Run: `npx vitest run src/daily-core.test.ts`
Expected: PASS (behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts src/daily-core.test.ts
git commit -m "refactor(daily): extract normalizeWorldBundle shared validator"
```

---

## Task 2: `wordul-core.ts` — pure Wordul type, validation, slug, synthesizer

**Files:**
- Create: `src/wordul-core.ts`
- Test: `src/wordul-core.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/wordul-core.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { slugify, RESERVED_SLUGS, normalizeWordul, wordulToWorld, passesContentGate, type Wordul } from "./wordul-core.ts";

describe("slugify", () => {
  it("lowercases, hyphenates, strips junk", () => {
    expect(slugify("Ocean Day!")).toBe("ocean-day");
    expect(slugify("  multiple   spaces ")).toBe("multiple-spaces");
    expect(slugify("Café 2026")).toBe("caf-2026");
  });
  it("falls back to 'world' when empty", () => {
    expect(slugify("!!!")).toBe("world");
  });
});

describe("RESERVED_SLUGS", () => {
  it("reserves gallery + system words", () => {
    for (const s of ["worduls", "daily", "settings", "feed", "api", "ws", "c"]) {
      expect(RESERVED_SLUGS.has(s)).toBe(true);
    }
  });
});

describe("normalizeWordul", () => {
  const ok = { vibeTitle: "Ocean Day", word: "ocean", story: { title: "Why", body: "Tides." }, colorScheme: { a1: "#012", a2: "#345", a3: "#678" } };
  it("produces a published wordul owned by the caller", () => {
    const w = normalizeWordul(ok, { owner: "zang", slug: "ocean-day", worldId: "wd_1", now: 1000 });
    expect(w).not.toBeNull();
    expect(w!.owner).toBe("zang");
    expect(w!.slug).toBe("ocean-day");
    expect(w!.worldId).toBe("wd_1");
    expect(w!.status).toBe("published");
    expect(w!.word).toBe("OCEAN");
    expect(w!.wordLocked).toBe(false);
    expect(w!.plays).toBe(0);
    expect(w!.visibility).toBe("public");
  });
  it("rejects an invalid bundle (bad word)", () => {
    expect(normalizeWordul({ word: "x", story: { title: "t", body: "b" } }, { owner: "zang", slug: "s", worldId: "id", now: 1 })).toBeNull();
  });
  it("allows an invented word", () => {
    const w = normalizeWordul({ word: "zzzzz", invented: true, story: { title: "t", body: "b" } }, { owner: "z", slug: "s", worldId: "id", now: 1 });
    expect(w).not.toBeNull();
    expect(w!.invented).toBe(true);
  });
});

describe("wordulToWorld", () => {
  it("synthesizes a playable World with a stable sentinel date + owned edition", () => {
    const w = normalizeWordul({ word: "ocean", story: { title: "Why", body: "B" }, vibeTitle: "Ocean Day" }, { owner: "zang", slug: "ocean-day", worldId: "wd_42", now: 5 })!;
    const world = wordulToWorld(w);
    expect(world.word).toBe("OCEAN");
    expect(world.date).toBe("world:wd_42");
    expect(world.edition).toBe("owned");
    expect(world.vibeTitle).toBe("Ocean Day");
    expect(world.story.title).toBe("Why");
  });
});

describe("passesContentGate (P1 no-op)", () => {
  it("always returns true in P1", () => {
    expect(passesContentGate("anything", "any", "any", "any")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/wordul-core.test.ts`
Expected: FAIL ("Cannot find module './wordul-core.ts'").

- [ ] **Step 3: Implement `src/wordul-core.ts`**

```ts
// src/wordul-core.ts — pure, dependency-free logic for user-authored worduls.
// A Wordul is a user's published creation. It CARRIES a playable World-bundle subset
// (validated via daily-core's normalizeWorldBundle) plus ownership + lifecycle.
// Distinct from World (daily bundle) and WorldDef (editions browser, worlds.ts).
import { normalizeWorldBundle, type World } from "./daily-core.ts";

export interface Wordul {
  worldId: string;
  owner: string;
  slug: string;
  status: "draft" | "published" | "unpublished";
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  vibeTitle: string;
  word: string;
  wordLocked: boolean;
  invented: boolean;
  rows: number;
  voice: string;
  story: { title: string; body: string; tip?: string };
  colorScheme?: { a1: string; a2: string; a3: string };
  glow?: World["glow"];
  images?: World["images"];
  playlist?: World["playlist"];
  plays: number;
  visibility: "public"; // RESERVED: future unlisted/password/invite
  remixedFrom?: { owner: string; slug: string; worldId: string }; // RESERVED
}

// Slugs that must never be a wordul slug (collide with routes/gallery/system).
export const RESERVED_SLUGS = new Set<string>([
  "worduls", "daily", "settings", "feed", "api", "ws", "c", "w", "r",
  "account", "login", "about", "designs", "science", "arena",
]);

export function slugify(title: string): string {
  const s = String(title || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "world";
}

// P1 content gate is a deliberate NO-OP (see spec §4.5). The call site exists so a
// denylist is a small additive change later, not a repaint.
export function passesContentGate(_word: string, _title: string, _story: string, _slug: string): boolean {
  return true;
}

export function normalizeWordul(
  input: unknown,
  meta: { owner: string; slug: string; worldId: string; now: number },
): Wordul | null {
  const bundle = normalizeWorldBundle(input);
  if (!bundle) return null;
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const vibeTitle = typeof o.vibeTitle === "string" && o.vibeTitle ? o.vibeTitle : bundle.story.title;
  if (!passesContentGate(bundle.word, vibeTitle, bundle.story.body, meta.slug)) return null;
  return {
    worldId: meta.worldId,
    owner: meta.owner,
    slug: meta.slug,
    status: "published",
    createdAt: meta.now,
    updatedAt: meta.now,
    publishedAt: meta.now,
    vibeTitle,
    word: bundle.word,
    wordLocked: false,
    invented: bundle.invented,
    rows: bundle.rows,
    voice: bundle.voice,
    story: bundle.story,
    ...(bundle.colorScheme ? { colorScheme: bundle.colorScheme } : {}),
    ...(bundle.glow ? { glow: bundle.glow } : {}),
    ...(bundle.images ? { images: bundle.images } : {}),
    ...(bundle.playlist ? { playlist: bundle.playlist } : {}),
    plays: 0,
    visibility: "public",
  };
}

/** Synthesize the playable World a room seeds from. Sentinel date keeps leaderboard
 *  keys unique + stable; edition "owned" marks it as a user creation. */
export function wordulToWorld(w: Wordul): World {
  return {
    date: `world:${w.worldId}`,
    word: w.word,
    edition: "owned",
    voice: w.voice,
    invented: w.invented,
    story: w.story,
    rows: w.rows,
    vibeTitle: w.vibeTitle,
    createdAt: w.createdAt,
    ...(w.colorScheme ? { colorScheme: w.colorScheme } : {}),
    ...(w.glow ? { glow: w.glow } : {}),
    ...(w.images ? { images: w.images } : {}),
    ...(w.playlist ? { playlist: w.playlist } : {}),
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/wordul-core.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/wordul-core.ts src/wordul-core.test.ts
git commit -m "feat(worduls): pure Wordul type, normalizeWordul, slugify, synthesizer"
```

---

## Task 3: `Worduls` Durable Object + wrangler binding

**Files:**
- Create: `src/worduls.ts`
- Test: `src/worduls.test.ts`
- Modify: `src/types.ts` (add `WORDULS` to `Env`), `wrangler.jsonc`

- [ ] **Step 1: Add the `WORDULS` binding to `Env`**

In `src/types.ts`, inside `interface Env`, after `ARENA: DurableObjectNamespace;` add:
```ts
  WORDULS: DurableObjectNamespace;
```

- [ ] **Step 2: Write the failing DO tests**

`src/worduls.test.ts` (mirror the existing DO test pattern; use the vitest workers pool already
configured for this repo — see `src/worlds.test.ts`/`src/account-core.test.ts` for the import style).
If the repo tests DO logic via a plain class harness, instantiate `Worduls` with a fake `ctx.storage`
Map-backed stub:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Worduls } from "./worduls.ts";

// Minimal in-memory DurableObjectState stub: only ctx.storage.get/put used.
function makeStub() {
  const map = new Map<string, unknown>();
  const ctx = { storage: {
    get: async (k: string) => map.get(k),
    put: async (k: string, v: unknown) => void map.set(k, v),
  } } as unknown as DurableObjectState;
  return new Worduls(ctx, {} as never);
}
async function call(o: Worduls, method: string, path: string, body?: unknown) {
  return o.fetch(new Request(`https://do${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  }));
}

describe("Worduls DO", () => {
  let o: Worduls;
  beforeEach(() => { o = makeStub(); });

  it("publishes a wordul and lists it", async () => {
    const pub = await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "ocean-day", bundle: { vibeTitle: "Ocean Day", word: "ocean", story: { title: "Why", body: "Tides." } }, now: 1000 });
    expect(pub.status).toBe(200);
    const { url, worldId } = await pub.json() as { url: string; worldId: string };
    expect(url).toBe("/@zang/ocean-day");
    expect(worldId).toMatch(/^wd_/);
    const list = await (await call(o, "GET", "/list?owner=zang")).json() as { worlds: unknown[] };
    expect(list.worlds.length).toBe(1);
  });

  it("auto-suffixes a colliding slug", async () => {
    const base = { owner: "zang", bundle: { vibeTitle: "Dup", word: "ocean", story: { title: "t", body: "b" } } };
    await call(o, "POST", "/publish", { ...base, desiredSlug: "dup", now: 1 });
    const second = await call(o, "POST", "/publish", { ...base, desiredSlug: "dup", now: 2 });
    expect((await second.json() as { url: string }).url).toBe("/@zang/dup-2");
  });

  it("rejects a reserved slug by suffixing past it", async () => {
    const res = await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "worduls", bundle: { word: "ocean", story: { title: "t", body: "b" } }, now: 1 });
    expect((await res.json() as { url: string }).url).not.toBe("/@zang/worduls");
  });

  it("rejects an invalid bundle", async () => {
    const res = await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "x", bundle: { word: "x", story: { title: "t", body: "b" } }, now: 1 });
    expect(res.status).toBe(400);
  });

  it("resolves a playable World and increments plays", async () => {
    await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "ocean-day", bundle: { word: "ocean", story: { title: "Why", body: "B" } }, now: 1 });
    const r1 = await call(o, "GET", "/resolve?slug=ocean-day");
    expect(r1.status).toBe(200);
    expect((await r1.json() as { word: string }).word).toBe("OCEAN");
    await call(o, "GET", "/resolve?slug=ocean-day");
    const list = await (await call(o, "GET", "/list?owner=zang&includeAll=1")).json() as { worlds: Array<{ plays: number; wordLocked: boolean }> };
    expect(list.worlds[0].plays).toBe(2);
    expect(list.worlds[0].wordLocked).toBe(true); // locked after first resolve/play
  });

  it("404s resolve for an unknown slug", async () => {
    expect((await call(o, "GET", "/resolve?slug=nope")).status).toBe(404);
  });

  it("patches cosmetics but refuses to change a locked word", async () => {
    await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "ocean-day", bundle: { word: "ocean", story: { title: "Why", body: "B" } }, now: 1 });
    await call(o, "GET", "/resolve?slug=ocean-day"); // locks the word
    const patch = await call(o, "PATCH", "/patch?slug=ocean-day", { vibeTitle: "Renamed", word: "OTHER" });
    expect(patch.status).toBe(200);
    const got = await (await call(o, "GET", "/get?slug=ocean-day")).json() as { vibeTitle: string; word: string };
    expect(got.vibeTitle).toBe("Renamed");
    expect(got.word).toBe("OCEAN"); // word change ignored once locked
  });

  it("unpublishes (hidden from public list, still present for owner)", async () => {
    await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "ocean-day", bundle: { word: "ocean", story: { title: "Why", body: "B" } }, now: 1 });
    await call(o, "PATCH", "/patch?slug=ocean-day", { status: "unpublished" });
    const pub = await (await call(o, "GET", "/list?owner=zang")).json() as { worlds: unknown[] };
    expect(pub.worlds.length).toBe(0);
    const all = await (await call(o, "GET", "/list?owner=zang&includeAll=1")).json() as { worlds: unknown[] };
    expect(all.worlds.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/worduls.test.ts`
Expected: FAIL ("Cannot find module './worduls.ts'").

- [ ] **Step 4: Implement `src/worduls.ts`**

```ts
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
    // Deterministic-enough id without Math.random/Date.now (banned in pure core, fine here
    // but kept simple): timestamp + storage size. Collisions impossible within one owner DO.
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

    // Server→server: a room seeds its playable World here, locking the word + counting a play.
    if (req.method === "GET" && url.pathname === "/resolve") {
      const w = state.worlds[url.searchParams.get("slug") ?? ""];
      if (!w || w.status === "unpublished") return new Response("not found", { status: 404 });
      w.plays += 1;
      if (!w.wordLocked) w.wordLocked = true;
      await this.save(state);
      return Response.json(wordulToWorld(w));
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
```
> Note: the test's `/list?...&includeAll=1` asserts `worlds[0].plays`/`wordLocked` — `publicCard`
> includes both. The test's `/get` asserts `word` — `/get` returns the full record. Consistent.

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run src/worduls.test.ts`
Expected: PASS.

- [ ] **Step 6: Register the DO in `wrangler.jsonc`**

In the `durable_objects.bindings` array, add:
```jsonc
      { "name": "WORDULS", "class_name": "Worduls" }
```
Add a NEW migration entry at the end of the `migrations` array (use the next tag number after the
last existing one — check the file; it must be a new tag, never edit a shipped one):
```jsonc
    { "tag": "v7", "new_sqlite_classes": ["Worduls"] }
```
(If `v7` already exists, use the next free tag.) Then export the class from the Worker entrypoint
(wherever `Room`, `User`, `Daily`, `Arena` are re-exported — likely `src/worker.ts` bottom or an
index): add `export { Worduls } from "./worduls.ts";`.

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.
```bash
git add src/worduls.ts src/worduls.test.ts src/types.ts wrangler.jsonc src/worker.ts
git commit -m "feat(worduls): per-owner Worduls DO + binding + migration"
```

---

## Task 4: Worker routes — publish/list/get/patch with owner-gate, + resolve

**Files:**
- Modify: `src/worker.ts`
- Test: `src/worduls-routes.test.ts` (create — integration-style if the repo has a worker test
  harness; otherwise unit-test the `verifyOwner` helper in isolation)

- [ ] **Step 1: Write the failing test for the owner-gate helper**

Create `src/worduls-routes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { extractBearer } from "./worduls-routes.ts";

describe("extractBearer", () => {
  it("pulls the token from an Authorization header", () => {
    expect(extractBearer(new Request("https://x", { headers: { Authorization: "Bearer abc123" } }))).toBe("abc123");
  });
  it("returns empty string when absent or malformed", () => {
    expect(extractBearer(new Request("https://x"))).toBe("");
    expect(extractBearer(new Request("https://x", { headers: { Authorization: "Basic zzz" } }))).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/worduls-routes.test.ts`
Expected: FAIL ("Cannot find module './worduls-routes.ts'").

- [ ] **Step 3: Implement `src/worduls-routes.ts` (small pure-ish helpers) + wire into worker**

Create `src/worduls-routes.ts`:
```ts
// src/worduls-routes.ts — helpers for the worker's /api/worlds endpoints.
import type { Env } from "./types.ts";

export function extractBearer(req: Request): string {
  const a = req.headers.get("Authorization") ?? "";
  return a.startsWith("Bearer ") ? a.slice(7) : "";
}

/** Owner-gate: a request is the owner iff its Bearer session validates against the
 *  owner's User DO (account/verify-session). */
export async function isOwner(env: Env, owner: string, token: string): Promise<boolean> {
  if (!token) return false;
  const res = await env.USER.get(env.USER.idFromName(owner))
    .fetch("https://do/account/verify-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionToken: token }),
    });
  if (!res.ok) return false;
  return (await res.json() as { valid?: boolean }).valid === true;
}

export function wordulsStub(env: Env, owner: string) {
  return env.WORDULS.get(env.WORDULS.idFromName(owner));
}
```
In `src/worker.ts`, add this route block (place it near the existing `/api/account/` and
`/api/user/` blocks; import the helpers + `normalizeUsername`/`isValidUsername` already in scope):
```ts
    // --- Worduls: user-authored creations ---
    if (url.pathname === "/api/worlds" && req.method === "POST") {
      const body = await req.json().catch(() => null) as { owner?: string; desiredSlug?: string; bundle?: unknown } | null;
      const owner = normalizeUsername(body?.owner ?? "");
      if (!isValidUsername(owner)) return Response.json({ error: "bad_owner" }, { status: 400 });
      if (!(await isOwner(env, owner, extractBearer(req)))) return Response.json({ error: "unauthorized" }, { status: 401 });
      return wordulsStub(env, owner).fetch("https://do/publish", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner, desiredSlug: body?.desiredSlug, bundle: body?.bundle, now: Date.now() }),
      });
    }
    const wlist = url.pathname.match(/^\/api\/worlds\/([a-z0-9_-]{3,20})$/);
    if (wlist && req.method === "GET") {
      const owner = normalizeUsername(wlist[1]);
      const includeAll = await isOwner(env, owner, extractBearer(req));
      return wordulsStub(env, owner).fetch(`https://do/list?owner=${owner}${includeAll ? "&includeAll=1" : ""}`);
    }
    const wone = url.pathname.match(/^\/api\/worlds\/([a-z0-9_-]{3,20})\/([a-z0-9-]{1,40})$/);
    if (wone) {
      const owner = normalizeUsername(wone[1]);
      const slug = wone[2];
      if (req.method === "GET") {
        // Owner gets the full record (incl. word) for editing; public gets the card via /list.
        if (await isOwner(env, owner, extractBearer(req))) {
          return wordulsStub(env, owner).fetch(`https://do/get?slug=${slug}`);
        }
        return Response.json({ error: "owner_only" }, { status: 403 });
      }
      if (req.method === "PATCH") {
        if (!(await isOwner(env, owner, extractBearer(req)))) return Response.json({ error: "unauthorized" }, { status: 401 });
        const patch = await req.text();
        return wordulsStub(env, owner).fetch(`https://do/patch?slug=${slug}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: patch,
        });
      }
    }
```

- [ ] **Step 4: Run helper test + typecheck**

Run: `npx vitest run src/worduls-routes.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/worduls-routes.ts src/worduls-routes.test.ts src/worker.ts
git commit -m "feat(worduls): worker routes + owner-gate via verify-session"
```

---

## Task 5: Room seam — `seedWordulIfNeeded` (solo play of a published wordul)

**Files:**
- Modify: `src/room.ts` (add `seedWordulIfNeeded`; call it where `seedDailyIfNeeded` is called, ~line 495)

- [ ] **Step 1: Add `seedWordulIfNeeded` next to `seedDailyIfNeeded`**

In `src/room.ts`, add this method right after `seedDailyIfNeeded` (~line 575). It mirrors the daily
seeding but resolves from the owner's `Worduls` DO and only fires when the room's path
`<owner>/<slug>` corresponds to a published wordul:
```ts
  // A room whose path is <owner>/<slug> AND matches a published wordul plays like a daily:
  // locked word, straight to "playing", theme/story from the wordul. Resolves server→server
  // from the owner's Worduls DO (which counts the play + locks the word). Idempotent.
  private async seedWordulIfNeeded(): Promise<void> {
    if (this.state.isDaily && this.state.word) return; // already seeded (daily or wordul)
    const [owner, slug] = this.state.path.split("/");
    if (!owner || !slug || dailyDateOf(this.state.path)) return; // not an owner/slug room
    try {
      const res = await this.env.WORDULS.get(this.env.WORDULS.idFromName(owner))
        .fetch(`https://do/resolve?slug=${encodeURIComponent(slug)}`);
      if (res.status === 404) return; // not a wordul → normal custom room, leave untouched
      if (!res.ok) { this.pushSystem("This wordul is warming up — refresh in a sec."); return; }
      const world = (await res.json()) as {
        word: string; edition: string; voice: string; rows?: number;
        story: { title: string; body: string; tip?: string };
        colorScheme?: { a1: string; a2: string; a3: string }; vibeTitle?: string;
      };
      const word = (world.word ?? "").toUpperCase();
      if (!/^[A-Z]+$/.test(word)) { this.pushSystem("This wordul is warming up — refresh in a sec."); return; }
      // Reuse the exact daily one-shot wiring: lock word, theme, story, rows.
      this.state.isDaily = true;
      this.state.word = word;
      this.state.wordLength = word.length;
      // Apply the same theme/story assignment seedDailyIfNeeded does below its word block —
      // copy that tail (edition/voice/story/colorScheme/vibeTitle/rows) here verbatim.
    } catch (e) {
      console.error("seedWordul failed", this.state.path, (e as Error).message);
    }
  }
```
> **Implementation note for the engineer:** open `seedDailyIfNeeded` and copy the lines AFTER its
> `this.state.wordLength = word.length;` (the part that sets edition/voice/story/colorScheme/vibeTitle/
> rows and flips the board to "playing") into the marked spot above, so a wordul room and a daily room
> share identical post-seed setup. If that tail is long, extract it into a private
> `applySeededWorld(world)` helper and call it from BOTH seeders (DRY).

- [ ] **Step 2: Call the seam on first contact**

Find where `await this.seedDailyIfNeeded();` is called (~line 495 in `onHello`). Immediately after it,
add:
```ts
    await this.seedWordulIfNeeded();
```
Order matters: daily first (cheap path check returns immediately for non-daily), then wordul.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (`WORDULS` is on `Env` from Task 3).

- [ ] **Step 4: Add a focused unit test for the path discrimination (if room logic is unit-testable)**

If `room.ts` has no test harness, SKIP automated tests here and rely on the Task 9 browser
verification. If it does (check for `src/room*.test.ts`), add a test that a `daily/<date>` path is NOT
treated as a wordul (i.e. `seedWordulIfNeeded` early-returns) and an `<owner>/<slug>` path queries
`WORDULS`. Use the existing room test mocks.

- [ ] **Step 5: Commit**

```bash
git add src/room.ts
git commit -m "feat(worduls): room seeds a published wordul for solo play"
```

---

## Task 6: Reserved profile seams (`follows`/`followers`)

**Files:**
- Modify: `src/types.ts` (`UserProfile`), `src/user-core.ts` (`freshProfile`, `healProfile`)
- Test: `src/user-core.test.ts` (extend existing)

- [ ] **Step 1: Add the reserved fields to `UserProfile`**

In `src/types.ts`, in `UserProfile`, add (optional — reserved, no behavior in P1):
```ts
  follows?: string[];   // RESERVED (P-later): usernames this user follows
  followers?: string[]; // RESERVED (P-later): usernames following this user
```

- [ ] **Step 2: Write a failing test that fresh/healed profiles default them to []**

In `src/user-core.test.ts` add:
```ts
it("seeds empty follows/followers arrays", () => {
  const p = freshProfile("zang", 1000); // match the real freshProfile signature
  expect(p.follows).toEqual([]);
  expect(p.followers).toEqual([]);
});
```
(Adjust the `freshProfile` call to its actual signature — check `src/user-core.ts`.)

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/user-core.test.ts`
Expected: FAIL (`follows` undefined).

- [ ] **Step 4: Default them in `freshProfile` and backfill in `healProfile`**

In `src/user-core.ts`:
- In `freshProfile`, add `follows: [], followers: []` to the returned object.
- In `healProfile`, add `if (!Array.isArray(p.follows)) p.follows = [];` and the same for `followers`.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/user-core.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/user-core.ts src/user-core.test.ts
git commit -m "feat(worduls): reserve follows/followers profile seams"
```

---

## Task 7: Client — publish flow from Vibe Studio

**Files:**
- Create: `public/wordul-publish.js`
- Modify: `public/vibe-studio.html` (enable Submit, load script), `public/vibe-studio.js` (wire click)

- [ ] **Step 1: Build the publish module**

Create `public/wordul-publish.js`. It reads the current Vibe-Studio `vibe` state, confirms a slug
(prefilled from the title), POSTs to `/api/worlds` with the stored session token, and on success
redirects to the new wordul page.
```js
// public/wordul-publish.js — turn the current Vibe-Studio draft into a published wordul.
// Session token + username come from the accounts client (localStorage keys set at login).
const SESSION_KEY = "wordul.session.token";   // adjust to the real accounts key (see public/account*.js)
const USERNAME_KEY = "wordul.session.username";   // adjust to the real accounts key

function slugify(t) {
  return (String(t || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "world";
}

export async function publishWordul(vibe) {
  const token = localStorage.getItem(SESSION_KEY);
  const owner = localStorage.getItem(USERNAME_KEY);
  if (!token || !owner) {
    // Not claimed/logged in → send to the claim/login flow, return here after.
    location.href = `/account?next=${encodeURIComponent(location.pathname)}`;
    return;
  }
  const desiredSlug = prompt("Your wordul's link:  /@" + owner + "/", slugify(vibe.vibeTitle || vibe.word));
  if (desiredSlug === null) return; // cancelled
  const bundle = {
    vibeTitle: vibe.vibeTitle, word: vibe.word, rows: vibe.rows,
    story: { title: vibe.vibeTitle || "Why this word", body: vibe.story || "" },
    colorScheme: vibe.colorScheme,
  };
  const res = await fetch("/api/worlds", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ owner, desiredSlug: slugify(desiredSlug), bundle }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error === "unauthorized" ? "Please log in again to publish." : "Could not publish — try again.");
    return;
  }
  const { url } = await res.json();
  location.href = url; // land on the new wordul page (share link + play counter)
}
```
> **Engineer note:** the two `localStorage` key names are placeholders — open `public/account*.js`
> (the accounts client that ships with the auth layer) and use the ACTUAL keys it writes the session
> token + username under. Fix the typo'd const names (`SESSION_KEY`) to clean identifiers while
> you're there. Do not invent a new auth storage scheme.

- [ ] **Step 2: Enable the Submit seam in `vibe-studio.html`**

Replace the inert button (`public/vibe-studio.html:173-175`):
```html
    <button class="schedule-seam" type="button" id="publish-wordul">
      Forge this wordul → <span class="soon">publish to your profile</span>
    </button>
```
And add near the other module scripts at the bottom:
```html
    <script type="module" src="/wordul-publish.js"></script>
```

- [ ] **Step 3: Wire the click in `vibe-studio.js`**

At the bottom of `public/vibe-studio.js`, import and bind:
```js
import { publishWordul } from "/wordul-publish.js";
document.getElementById("publish-wordul")?.addEventListener("click", () => publishWordul(vibe));
```

- [ ] **Step 4: Manual smoke (local dev)**

Run: `npm run dev` (in this worktree) and open the vibe studio. The button is now active and clicking
it (while logged out) redirects to `/account`. Full publish is verified in Task 9.

- [ ] **Step 5: Commit**

```bash
git add public/wordul-publish.js public/vibe-studio.html public/vibe-studio.js
git commit -m "feat(worduls): wire Vibe Studio Submit -> publish a wordul"
```

---

## Task 8: Client — `/@you/worduls` gallery + wordul-page SSR meta

**Files:**
- Create: `public/worduls-gallery.js`
- Modify: `src/worker.ts` (route `/@<user>/worduls` to a gallery page + wordul SSR meta)

- [ ] **Step 1: Add the gallery + wordul routes to the SSR layer**

In `src/worker.ts` `injectMeta` (or the `/@user/...` HTML handler ~line 477), add handling so:
- `/@<user>/worduls` serves the gallery shell (static HTML that loads `worduls-gallery.js`), with
  `<title>@<user>'s worduls</title>` + OG tags. Reuse the existing meta-injection helper.
- `/@<user>/<slug>` (an existing room route) gets OG meta that, for a published wordul, shows
  `vibeTitle` + palette + a **masked board** — **never the word**. Fetch the card via the owner's
  `Worduls` DO `/list` (public projection has no word) to populate the title/palette; if the slug
  isn't a wordul, fall back to the existing room meta.

Concretely, before the generic room-meta branch, add:
```ts
    const galleryMatch = url.pathname.match(/^\/@([a-z0-9_-]{3,20})\/worduls$/);
    if (galleryMatch) {
      const owner = normalizeUsername(galleryMatch[1]);
      return injectGalleryMeta(env, url, owner); // sets title "@owner's worduls", loads worduls-gallery.js
    }
```
Implement `injectGalleryMeta` next to `injectMeta`: it serves the static app shell (the same one
`injectMeta` serves) but with `<title>` / OG describing the gallery. Keep it small; mirror
`injectMeta`'s asset-fetch + string-replace approach.

- [ ] **Step 2: Build the gallery client**

Create `public/worduls-gallery.js`:
```js
// public/worduls-gallery.js — renders @<owner>'s published worduls as play cards.
const m = location.pathname.match(/^\/@([a-z0-9_-]{3,20})\/worduls$/);
const owner = m ? m[1] : null;

async function render() {
  if (!owner) return;
  const token = localStorage.getItem("wordul.session.token"); // use the real key (see account*.js)
  const res = await fetch(`/api/worlds/${owner}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  const { worlds } = await res.json();
  const root = document.getElementById("worduls-root") || document.body;
  root.innerHTML = `<h1>@${owner}'s worduls</h1>` + (worlds.length
    ? `<ul class="wordul-cards">` + worlds.map(cardHtml).join("") + `</ul>`
    : `<p class="empty">No worduls yet.</p>`);
}

function cardHtml(w) {
  const cs = w.colorScheme || {};
  const swatch = [cs.a1, cs.a2, cs.a3].filter(Boolean)
    .map((c) => `<span style="background:${c}"></span>`).join("");
  const board = Array.from({ length: w.rows || 6 }, () => `<i></i>`).join(""); // masked board
  const tag = w.status !== "published" ? ` <em>(${w.status})</em>` : "";
  return `<li class="wordul-card">
    <a href="/@${w.owner}/${w.slug}">
      <div class="swatch">${swatch}</div>
      <div class="masked-board" data-cols="${w.rows || 6}">${board}</div>
      <h3>${escapeHtml(w.vibeTitle)}${tag}</h3>
      <p class="plays">${w.plays || 0} ${(w.plays === 1) ? "play" : "plays"}</p>
    </a></li>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
render();
```
> The gallery shell HTML needs a `<div id="worduls-root"></div>` and a
> `<script type="module" src="/worduls-gallery.js"></script>`. If `injectGalleryMeta` serves the SPA
> shell, ensure that shell loads `worduls-gallery.js` on the `/worduls` route (gate by pathname in the
> shell's bootstrap, mirroring how `profile.js` is loaded for `/@user`).

- [ ] **Step 3: Add a minimal card style**

Add to the relevant stylesheet (where profile/room styles live — grep for `.wordul` or the profile
CSS file): a small `.wordul-cards`/`.wordul-card`/`.swatch`/`.masked-board` ruleset (grid of cards,
palette swatch row, faint masked board). Keep it consistent with existing card styling on the site.

- [ ] **Step 4: Commit**

```bash
git add public/worduls-gallery.js src/worker.ts
git commit -m "feat(worduls): /@you/worduls gallery + spoiler-safe wordul SSR meta"
```

---

## Task 9: End-to-end verification (browser)

**Files:** none (uses the `browse`/`gstack` skill against `npm run dev`).

- [ ] **Step 1: Start dev + log in a test account**

Run `npm run dev`. Using the accounts flow, claim/login a test handle (e.g. `tester`). Confirm the
session token + username land in localStorage under the real keys.

- [ ] **Step 2: Forge a wordul**

In the Vibe Studio: set a title ("Ocean Day"), a real word ("OCEAN"), a palette, a story. Click
**Forge this wordul →**. Accept the slug. Expect redirect to `/@tester/ocean-day`.

- [ ] **Step 3: Verify the loop**

- The wordul page loads, themed by the palette, with a share link.
- Open `/@tester/worduls` → the card shows, `0 plays`, masked board, no word visible in page source.
- Play the wordul to a solve → leaderboard records you, story reveals, chat unlocks.
- Reload `/@tester/worduls` → play count incremented.
- Edit the title via `PATCH` (or the edit UI if built) → reflected; attempting to change the word
  after a play is rejected.
- Unpublish → disappears from the public gallery; still visible to you (owner token).

- [ ] **Step 4: Verify spoiler-safety**

View-source / OG debugger on `/@tester/ocean-day` and the gallery: confirm the **word never appears**
in HTML/meta before solving.

- [ ] **Step 5: Run the full suite + typecheck before shipping**

Run: `npm test && npm run typecheck`
Expected: all green.

---

## Self-review notes (author)

- **Spec coverage:** §3 architecture → Tasks 3,5; §4 data model + DRY validator → Tasks 1,2,3,6;
  §5 flows (publish/play/edit/unpublish/gallery/share) → Tasks 4,5,7,8,9; §6 routes → Task 4;
  §7 reserved seams → `visibility`/`remixedFrom` (Task 2 type), `follows`/`followers` (Task 6),
  content-gate no-op (Task 2); §8 edge cases (slug collision, reserved, word-lock, unpublish,
  unclaimed gate) → Tasks 2,3,7; §9 testing → Tasks 1–6,9; §10 prerequisite → gate at top.
- **Out of scope (spec §11)** correctly absent: no 1v1/arena/remix/follow-behavior/visibility-tiers/
  OG-image/moderation tasks.
- **Type consistency:** `Wordul`, `normalizeWordul`, `wordulToWorld`, `normalizeWorldBundle`,
  `WordBundle`→`WorldBundle`, `Worduls` DO, `WORDULS` binding, `isOwner`/`extractBearer`/`wordulsStub`
  used consistently across tasks.
- **Known soft spots flagged inline:** the two client `localStorage` key names + the room
  seed-tail copy (Task 5 Step 1) require reading the real accounts client / `seedDailyIfNeeded` body;
  both are called out as engineer notes rather than guessed.
