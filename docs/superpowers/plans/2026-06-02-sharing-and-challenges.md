# Sharing & Challenges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finishing a Wordul game mints a server-stored challenge; a friend's link plays the exact same word as an isolated solo board, racing the owner's standing record — wrapped in an on-brand, no-spoiler share card and a frictionless desktop share flow.

**Architecture:** A challenge is a solo room seeded with a pinned word. Reuse the existing `Room` DO (server-side masking, gold, companion, replay) for gameplay; add a new `Challenge` DO that stores the word + an append-only attempts list and computes the standing record. The client gains a `/c/:id` route that opens an isolated per-player challenge room and shows the record on the end screen.

**Tech Stack:** TypeScript Cloudflare Workers + Durable Objects (KV-style `ctx.storage`), vanilla JS SPA (`public/app.js`), Canvas 2D for the share card, vitest + jsdom for tests.

**Reference spec:** `docs/superpowers/specs/2026-06-02-sharing-and-challenges-design.md`

**Worktree:** Run this plan inside a git worktree (colony shared-checkout hazard — other sessions may deploy). Create via `superpowers:using-git-worktrees` before Task 1.

---

## File Structure

| File | Responsibility | Phase |
|------|----------------|-------|
| `src/challenge-core.ts` (create) | Pure logic: base62 id generation (rng-injected), standing-record computation, meta serializer (omits word) | 1 |
| `test/challenge-core.test.js` (create) | Unit tests for the pure logic | 1 |
| `src/types.ts` (modify) | `ChallengeState`, `ChallengeAttempt`, `ChallengeRecord`, `ChallengeMeta` types | 1 |
| `src/challenge.ts` (create) | `Challenge` Durable Object — mint / meta / attempt over `ctx.storage` | 1 |
| `wrangler.jsonc` (modify) | `CHALLENGE` binding + `new_sqlite_classes` migration tag `v3` | 1 |
| `src/worker.ts` (modify) | `/api/challenge*` routes, `/ws?challenge=` routing, export `Challenge` | 1 |
| `src/room.ts` (modify) | Seed pinned word when `challengeId` is set; report attempt on finish | 1 |
| `public/app.js` (modify) | `/c/:id` route: meta fetch, banner, challenge WS connect, end-screen record + "share your own" | 1 |
| `public/share-card.js` (create) | `buildShareCardModel()` (pure, no word) + `renderShareCard(model)` canvas drawing | 2 |
| `test/share-card.test.js` (create) | Unit test: model carries grid + name + cta, never the answer word | 2 |
| `public/app.js` (modify) | Use `share-card.js`; mint challenge on finish; challenge URL in CTA; desktop share row | 2 |
| `public/style.css` (modify) | `.share-row` (URL field + Copy + Share) styling | 2 |

---

# PHASE 1 — Challenge Engine

## Task 1: Pure challenge core (id gen + record)

**Files:**
- Create: `src/challenge-core.ts`
- Test: `test/challenge-core.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/challenge-core.test.js
import { describe, it, expect } from "vitest";
import { makeChallengeId, computeRecord, toMeta } from "/src/challenge-core.ts";

describe("challenge-core", () => {
  it("makeChallengeId produces a 5-char base62 id from injected rng", () => {
    const id = makeChallengeId(() => 0); // rng always 0 → first base62 char repeated
    expect(id).toMatch(/^[0-9A-Za-z]{5}$/);
    expect(id.length).toBe(5);
  });

  it("computeRecord picks the solved attempt with fewest guesses", () => {
    const attempts = [
      { username: "amy", score: "4/6", solved: true, guesses: 4, at: 1 },
      { username: "ben", score: "X/6", solved: false, guesses: 6, at: 2 },
      { username: "cat", score: "3/6", solved: true, guesses: 3, at: 3 },
    ];
    expect(computeRecord(attempts)).toEqual({ username: "cat", score: "3/6", guesses: 3 });
  });

  it("computeRecord returns null when no one has solved", () => {
    expect(computeRecord([{ username: "ben", score: "X/6", solved: false, guesses: 6, at: 2 }])).toBeNull();
  });

  it("computeRecord breaks ties by earliest attempt", () => {
    const attempts = [
      { username: "late", score: "3/6", solved: true, guesses: 3, at: 50 },
      { username: "early", score: "3/6", solved: true, guesses: 3, at: 10 },
    ];
    expect(computeRecord(attempts).username).toBe("early");
  });

  it("toMeta never leaks the answer word", () => {
    const state = {
      id: "x7gk2", word: "SLATE", wordLength: 5, owner: "yan",
      ownerScore: "3/6", ownerGrid: [["green","gray","gray","gray","gray"]],
      createdAt: 1, attempts: [],
    };
    const meta = toMeta(state);
    expect(meta).not.toHaveProperty("word");
    expect(JSON.stringify(meta)).not.toContain("SLATE");
    expect(meta.owner).toBe("yan");
    expect(meta.ownerScore).toBe("3/6");
    expect(meta.wordLength).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/challenge-core.test.js`
Expected: FAIL — `makeChallengeId` / module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/challenge-core.ts — pure, dependency-free challenge logic (unit-tested).
export type ChallengeAttempt = {
  username: string;
  score: string;      // "3/6" or "X/6"
  solved: boolean;
  guesses: number;    // rows used
  at: number;         // epoch ms
};

export type ChallengeRecord = { username: string; score: string; guesses: number } | null;

export type ChallengeState = {
  id: string;
  word: string;
  wordLength: number;
  owner: string;
  ownerScore: string;
  ownerGrid: string[][];   // color masks of the owner's guesses (for the share card)
  createdAt: number;
  attempts: ChallengeAttempt[];
};

export type ChallengeMeta = {
  id: string;
  owner: string;
  ownerScore: string;
  ownerGrid: string[][];
  wordLength: number;
  record: ChallengeRecord;
};

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// 5 base62 chars ≈ 916M combos. rng injected so tests are deterministic.
export function makeChallengeId(rng: () => number = Math.random): string {
  let id = "";
  for (let i = 0; i < 5; i++) id += B62[Math.floor(rng() * B62.length)];
  return id;
}

// Standing record: fewest guesses among solved attempts; ties → earliest.
export function computeRecord(attempts: ChallengeAttempt[]): ChallengeRecord {
  const solved = attempts.filter((a) => a.solved);
  if (solved.length === 0) return null;
  solved.sort((a, b) => a.guesses - b.guesses || a.at - b.at);
  const best = solved[0];
  return { username: best.username, score: best.score, guesses: best.guesses };
}

// Client-safe view of a challenge — NEVER includes `word`.
export function toMeta(state: ChallengeState): ChallengeMeta {
  return {
    id: state.id,
    owner: state.owner,
    ownerScore: state.ownerScore,
    ownerGrid: state.ownerGrid,
    wordLength: state.wordLength,
    record: computeRecord(state.attempts),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/challenge-core.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/challenge-core.ts test/challenge-core.test.js
git commit -m "feat(challenge): pure core — id gen, standing record, no-spoiler meta"
```

---

## Task 2: Challenge types in shared types module

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Re-export the challenge types so server modules import from one place**

Add to the end of `src/types.ts`:

```typescript
// Challenge link types live in challenge-core.ts (pure + unit-tested); re-export
// here so DO/worker/room import them alongside the other shared types.
export type { ChallengeAttempt, ChallengeRecord, ChallengeState, ChallengeMeta } from "./challenge-core.ts";
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(challenge): re-export challenge types from shared types"
```

---

## Task 3: Challenge Durable Object

**Files:**
- Create: `src/challenge.ts`

- [ ] **Step 1: Write the Challenge DO**

```typescript
// src/challenge.ts — one Durable Object per challenge id. Holds the pinned word,
// the owner's result (for the share card), and an append-only attempts list.
// The word NEVER leaves the server: /meta returns toMeta() which omits it, and the
// pinned word is handed only to a seeded Room DO (server→server) for masking.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import type { ChallengeState, ChallengeAttempt } from "./challenge-core.ts";
import { toMeta, computeRecord } from "./challenge-core.ts";

export class Challenge extends DurableObject<Env> {
  private async load(): Promise<ChallengeState | null> {
    return (await this.ctx.storage.get<ChallengeState>("state")) ?? null;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Mint: POST /  body = { id, word, wordLength, owner, ownerScore, ownerGrid }
    if (req.method === "POST" && url.pathname === "/") {
      const body = (await req.json()) as Omit<ChallengeState, "createdAt" | "attempts">;
      const existing = await this.load();
      if (existing) return Response.json({ id: existing.id }); // idempotent on id reuse
      const state: ChallengeState = { ...body, createdAt: Date.now(), attempts: [] };
      await this.ctx.storage.put("state", state);
      return Response.json({ id: state.id });
    }

    // Meta: GET /meta  → client-safe view (no word)
    if (req.method === "GET" && url.pathname === "/meta") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      return Response.json(toMeta(state));
    }

    // Word for a seeded room (server→server only): GET /word
    if (req.method === "GET" && url.pathname === "/word") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      return Response.json({ word: state.word, wordLength: state.wordLength });
    }

    // Attempt: POST /attempt  body = ChallengeAttempt (no `at`; server stamps it)
    if (req.method === "POST" && url.pathname === "/attempt") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      const a = (await req.json()) as Omit<ChallengeAttempt, "at">;
      state.attempts.push({ ...a, at: Date.now() });
      if (state.attempts.length > 500) state.attempts = state.attempts.slice(-500);
      await this.ctx.storage.put("state", state);
      return Response.json({ record: computeRecord(state.attempts) });
    }

    return new Response("not found", { status: 404 });
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes (the `CHALLENGE` binding on `Env` comes in Task 4 — if it errors on `Env`, proceed; Task 4 fixes it. Re-run after Task 4.)

- [ ] **Step 3: Commit**

```bash
git add src/challenge.ts
git commit -m "feat(challenge): Challenge Durable Object — mint, meta, word, attempt"
```

---

## Task 4: Wrangler binding + migration + Env type

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `src/types.ts`

- [ ] **Step 1: Add the CHALLENGE binding**

In `wrangler.jsonc`, inside `durable_objects.bindings`, after the `USER` entry:

```jsonc
      {
        "name": "CHALLENGE",
        "class_name": "Challenge"
      }
```

- [ ] **Step 2: Add the SQLite migration tag**

In `wrangler.jsonc`, append to the `migrations` array (after the `v2` entry):

```jsonc
    {
      // New DO namespace on the free plan MUST be SQLite-backed (else deploy fails
      // with err 10097 — dry-run won't catch it). Challenge uses the KV-style
      // ctx.storage.get/put API, which is supported on new_sqlite_classes.
      "tag": "v3",
      "new_sqlite_classes": ["Challenge"]
    }
```

- [ ] **Step 3: Add CHALLENGE to the Env type**

Find the `Env` interface in `src/types.ts` (it declares `ROOM`, `USER`, `DIRECTORY`, etc.). Add:

```typescript
  CHALLENGE: DurableObjectNamespace;
```

(Match the exact style of the existing `ROOM` / `USER` lines — if they use `DurableObjectNamespace<Room>` generics, mirror that with `Challenge`.)

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: passes, including `src/challenge.ts`.

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc src/types.ts
git commit -m "feat(challenge): wire CHALLENGE binding + v3 sqlite migration"
```

---

## Task 5: Worker routes for challenges

**Files:**
- Modify: `src/worker.ts`

- [ ] **Step 1: Export the Challenge class**

At the top of `src/worker.ts`, update the imports/exports:

```typescript
import { Challenge } from "./challenge.ts";
export { Room, User, Challenge };
```

- [ ] **Step 2: Add the `/api/challenge` routes**

In the `fetch` handler, immediately after the `/api/user/` block, add:

```typescript
    // Mint a challenge: POST /api/challenge
    if (url.pathname === "/api/challenge" && req.method === "POST") {
      const id = makeChallengeId();
      const stub = env.CHALLENGE.get(env.CHALLENGE.idFromName(id));
      const body = await req.json();
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
```

Add the import at the top of `src/worker.ts`:

```typescript
import { makeChallengeId } from "./challenge-core.ts";
```

- [ ] **Step 3: Add challenge WS routing (isolated per-player solo room)**

In the `/ws` block, after the existing `room` param handling, add a parallel branch. Replace the start of the `/ws` block so it handles a `challenge` param too:

```typescript
    if (url.pathname === "/ws") {
      const challengeId = url.searchParams.get("challenge");
      if (challengeId && /^[0-9A-Za-z]{5}$/.test(challengeId)) {
        const player = normalizeUsername(url.searchParams.get("username") ?? "");
        if (!isValidUsername(player)) return new Response("invalid player", { status: 400 });
        // One isolated Room DO per (challenge, player) so each friend's solo replay
        // is private. The room seeds its word from the challenge (see room.ts).
        const key = `c:${challengeId}:${player}`;
        const stub = env.ROOM.get(env.ROOM.idFromName(key));
        const upstream = new URL(req.url);
        upstream.searchParams.set("room", key);
        upstream.searchParams.set("challenge", challengeId);
        return stub.fetch(new Request(upstream.toString(), req));
      }
      // ...existing owner/slug handling unchanged below...
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts
git commit -m "feat(challenge): worker routes — mint, meta, per-player challenge WS"
```

---

## Task 6: Room seeds the pinned word + reports attempts

**Files:**
- Modify: `src/room.ts`

- [ ] **Step 1: Capture the challenge id on connect**

In `room.ts`, find where the room reads the incoming request (the `fetch`/WS-accept path that already reads `url.searchParams.get("room")`). Add, alongside it:

```typescript
    const challengeId = url.searchParams.get("challenge");
    if (challengeId && !this.state.challengeId) this.state.challengeId = challengeId;
```

Add `challengeId?: string | null` to the room state type (the same interface that declares `word`, `phase`, `round` — found near `src/types.ts` `RoomState` or the inline state type in `room.ts`). Initialize it `null` where the initial state object is built (the block with `word: null, ... round: 0`).

- [ ] **Step 2: Seed the word from the challenge in `onStart`**

Replace the random-pick line in `onStart` (`src/room.ts:377`):

```typescript
    this.state.word = pool.answers[Math.floor(Math.random() * pool.answers.length)] ?? null;
```

with:

```typescript
    if (this.state.challengeId) {
      // Challenge room: ALWAYS play the pinned word (even on rematch), fetched
      // server→server so the answer never touches the client.
      const cs = this.env.CHALLENGE.get(this.env.CHALLENGE.idFromName(this.state.challengeId));
      const res = await cs.fetch(new Request("https://do/word", { method: "GET" }));
      if (res.ok) {
        const { word, wordLength } = (await res.json()) as { word: string; wordLength: number };
        this.state.word = word ?? null;
        this.state.wordLength = wordLength ?? this.state.wordLength;
      }
    } else {
      this.state.word = pool.answers[Math.floor(Math.random() * pool.answers.length)] ?? null;
    }
```

(Confirm the DO reaches `env` as `this.env`; the `User` DO uses `this.ctx`/`this.env` from `DurableObject<Env>` — match `room.ts`'s existing access pattern, e.g. `this.env.ROOM`.)

- [ ] **Step 3: Report the attempt when a challenge game finishes**

In `applyGuess`, after a player's `status` becomes `"won"` or `"lost"` (right after the `else if (... ) player.status = "lost";` branch, before `await this.maybeFinish();`), add:

```typescript
    if (this.state.challengeId && (player.status === "won" || player.status === "lost") && !player.isBot) {
      const solved = player.status === "won";
      const score = solved ? `${player.guesses.length}/${this.state.maxGuesses}` : `X/${this.state.maxGuesses}`;
      const cs = this.env.CHALLENGE.get(this.env.CHALLENGE.idFromName(this.state.challengeId));
      this.ctx.waitUntil(cs.fetch(new Request("https://do/attempt", {
        method: "POST",
        body: JSON.stringify({ username: player.username, score, solved, guesses: player.guesses.length }),
        headers: { "content-type": "application/json" },
      })));
    }
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/room.ts src/types.ts
git commit -m "feat(challenge): room seeds pinned word + reports attempts to challenge"
```

---

## Task 7: Client `/c/:id` route — banner, connect, record

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Route the `/c/:id` path**

In the route resolver (`routeFor`/the `location.pathname.match` block near `public/app.js:66-72`), add a challenge branch BEFORE the room/profile checks:

```javascript
  const challenge = location.pathname.match(/^\/c\/([0-9A-Za-z]{5})$/);
  if (challenge) return { kind: "challenge", id: challenge[1] };
```

In the top-level router that switches on `kind` (where it calls `showRoom` / `showRoomEntry` / profile), add:

```javascript
  if (route.kind === "challenge") { showChallenge(route.id); return; }
```

- [ ] **Step 2: Implement `showChallenge`**

Add near `showRoom` in `public/app.js`:

```javascript
// A challenge link (/c/<id>): solo board on the owner's exact word, racing their
// standing record. Reuses the room engine via a per-player challenge WS.
async function showChallenge(id) {
  let meta;
  try {
    const res = await fetch(`/api/challenge/${id}/meta`);
    if (!res.ok) throw new Error("gone");
    meta = await res.json();
  } catch {
    toast("That challenge link has expired.", { error: true, duration: 3000 });
    navigate("/");
    return;
  }
  game.challengeId = id;
  game.challengeMeta = meta;
  const target = meta.record
    ? `${meta.record.username} holds the record at ${meta.record.score}`
    : `@${meta.owner} scored ${meta.ownerScore}`;
  toast(`Challenge from @${meta.owner} — ${target}. Beat it.`, { duration: 4200 });
  // Connect a per-player challenge room (word length comes from the challenge).
  connectChallenge(id, meta.wordLength);
}
```

- [ ] **Step 3: Implement `connectChallenge` (mirror of the room WS connect)**

Find the existing WS connect (`const ws = new WebSocket(url)` near `public/app.js:785`). Factor the URL build so challenges reuse it. Add:

```javascript
function connectChallenge(id, wordLength) {
  const username = getUsername();
  if (!username) { showUsernameGate(() => connectChallenge(id, wordLength)); return; }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws?challenge=${id}&username=${encodeURIComponent(username)}`;
  openSocket(url); // the same function the room path uses to wire ws handlers
}
```

(If the room path doesn't yet have an `openSocket(url)` helper, extract the body of the existing connect — everything from `new WebSocket(url)` through the handler wiring — into `function openSocket(url) {...}` and have the room path call it. This keeps ONE socket-handling path. `showUsernameGate` = the existing username-prompt entry the lobby uses; reuse it.)

- [ ] **Step 4: Show the standing record on the end screen**

In the end-of-game modal builder (`showEndStats`/where `prepareShareCard()` is called, ~`public/app.js:2340`), add — when `game.challengeId` is set — a line after the score:

```javascript
  if (game.challengeId) {
    const me = game.snapshot?.players.find((p) => p.username === getUsername());
    const myScore = me?.status === "won" ? `${me.guesses.length}/${game.snapshot.maxGuesses}` : `X/${game.snapshot.maxGuesses}`;
    // Re-fetch meta so the record reflects my just-posted attempt.
    fetch(`/api/challenge/${game.challengeId}/meta`).then((r) => r.json()).then((m) => {
      const rec = m.record ? `Record: @${m.record.username} ${m.record.score}` : "You set the first record!";
      const el = $("#challengeRecordLine");
      if (el) el.textContent = `You: ${myScore} · ${rec}`;
    }).catch(() => {});
  }
```

Add a `<p id="challengeRecordLine" class="challenge-record"></p>` to the stats-modal markup (find the modal template in `public/index.html` or the JS that builds it; place it just below the score line).

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, then:
1. Open `http://localhost:8787/`, start + finish a solo game.
2. (Until Task 9 mints automatically, mint by hand:) in the browser console:
   `await (await fetch('/api/challenge',{method:'POST',body:JSON.stringify({word:'SLATE',wordLength:5,owner:'yan',ownerScore:'3/6',ownerGrid:[]}),headers:{'content-type':'application/json'}})).json()` → note the `id`.
3. Visit `http://localhost:8787/c/<id>` → banner shows "Challenge from @yan…", board is 5 wide, the word is `SLATE`.
4. Finish → end screen shows "You: N/6 · Record…".
Expected: same word every reload; record line populates.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/index.html
git commit -m "feat(challenge): /c/:id solo replay route + standing-record end screen"
```

---

## Task 8: Phase 1 deploy + verify (SQLite DO)

- [ ] **Step 1: Full gauntlet**

Run: `npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 2: Deploy**

Run: `npm run deploy`
Expected: "Deployed" with no `10097` error. If `10097` appears, the `v3` migration didn't apply — confirm `new_sqlite_classes: ["Challenge"]` and redeploy.

- [ ] **Step 3: Smoke the live mint → meta round-trip**

```bash
ID=$(curl -s -X POST https://wordul.com/api/challenge -H 'content-type: application/json' \
  -d '{"word":"SLATE","wordLength":5,"owner":"yan","ownerScore":"3/6","ownerGrid":[]}' | sed 's/.*"id":"\([^"]*\)".*/\1/')
echo "minted $ID"
curl -s https://wordul.com/api/challenge/$ID/meta
```

Expected: meta JSON with `owner:"yan"`, `ownerScore:"3/6"`, and **no `word` field**.

- [ ] **Step 4: Commit (no code; this is a checkpoint)** — proceed to Phase 2.

---

# PHASE 2 — Share Surfaces

## Task 9: Pure share-card model (no spoiler) + mint on finish

**Files:**
- Create: `public/share-card.js`
- Test: `test/share-card.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/share-card.test.js
import { describe, it, expect } from "vitest";
import { buildShareCardModel } from "/public/share-card.js";

describe("share-card model", () => {
  const guesses = [
    { word: "CRANE", mask: ["gray","gray","yellow","gray","green"] },
    { word: "SLATE", mask: ["green","green","green","green","green"] },
  ];

  it("carries the color grid, name, score, phrase, and cta — but NEVER the word", () => {
    const m = buildShareCardModel({ username: "yan", guesses, won: true, score: "2/6",
      answer: "SLATE", challengeUrl: "wordul.com/c/x7gk2" });
    expect(m.grid).toEqual([["gray","gray","yellow","gray","green"], ["green","green","green","green","green"]]);
    expect(m.name).toBe("@yan");
    expect(m.score).toBe("2/6");
    expect(typeof m.phrase).toBe("string");
    expect(m.phrase.length).toBeGreaterThan(0);
    expect(m.cta).toBe("wordul.com/c/x7gk2");
    // The spoiler guarantee:
    expect(JSON.stringify(m)).not.toContain("SLATE");
    expect(m).not.toHaveProperty("answer");
    expect(m).not.toHaveProperty("words");
  });

  it("marks a loss with X score and no green-row assumption", () => {
    const m = buildShareCardModel({ username: "amy", guesses: [guesses[0]], won: false,
      score: "X/6", answer: "SLATE", challengeUrl: "wordul.com/c/x7gk2" });
    expect(m.score).toBe("X/6");
    expect(m.won).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/share-card.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the model + canvas drawing**

```javascript
// public/share-card.js — the shareable result card. Two parts: a PURE model
// (unit-tested, provably free of the answer word) and a canvas renderer that draws
// only from that model. The answer is NEVER in the model → never on the image.

const PHRASES = [
  "Free. No ads. Just the word.",
  "Your move.",
  "Come wordul with us.",
];

// Pick a phrase deterministically from the score so the same card is stable on
// re-render (no Math.random in the model — keeps it testable).
function pickPhrase(seed) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PHRASES[h % PHRASES.length];
}

export function buildShareCardModel({ username, guesses, won, score, challengeUrl }) {
  return {
    name: `@${username}`,
    grid: guesses.map((g) => g.mask.slice()), // colors only — no letters, no word
    won: !!won,
    score,
    phrase: pickPhrase(`${username}:${score}`),
    cta: challengeUrl,
  };
}

// Brand palette (ultraviolet chrome + gold). Tiles keep wordle colors (they ARE
// the score); chrome + CTA go brand.
const BRAND = { bg: "#15101f", gold: "#f0c14b", violet: "#7c5cff", fg: "#f7f1e3", muted: "#bdb6c9" };
const TILE = { green: "#538d4e", yellow: "#b59f3b", gray: "#3a3a3c" };

export function renderShareCard(model, cols) {
  const dpr = 2, W = 560, P = 40, gap = 8;
  const tile = Math.min(48, Math.floor((W - 2 * P - (cols - 1) * gap) / cols));
  const gridW = cols * tile + (cols - 1) * gap;
  const gridX = (W - gridW) / 2;
  const rows = model.grid.length;
  const gridH = rows > 0 ? rows * tile + (rows - 1) * gap : 0;
  const H = P + 38 + 20 + 40 + 24 + gridH + 24 + 28 + 64 + P;

  const canvas = document.createElement("canvas");
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = BRAND.bg; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  let cy = P;

  // Wordmark: WORDUL in gold
  ctx.font = `800 30px ${FONT}`; ctx.fillStyle = BRAND.gold;
  ctx.fillText("WORDUL", W / 2, cy + 19); cy += 38 + 20;

  // Name + score
  ctx.font = `800 32px ${FONT}`; ctx.fillStyle = model.won ? TILE.green : BRAND.muted;
  ctx.fillText(`${model.name} · ${model.won ? model.score : `${model.score}`}`, W / 2, cy + 20);
  cy += 40 + 24;

  // Grid (colors only)
  let gy = cy;
  for (const maskRow of model.grid) {
    for (let c = 0; c < cols; c++) {
      const x = gridX + c * (tile + gap);
      roundRectSC(ctx, x, gy, tile, tile, 6);
      ctx.fillStyle = TILE[maskRow[c]] || "#2a2533"; ctx.fill();
    }
    gy += tile + gap;
  }
  cy += gridH + 24;

  // Phrase
  ctx.font = `600 20px ${FONT}`; ctx.fillStyle = BRAND.fg;
  ctx.fillText(model.phrase, W / 2, cy + 14); cy += 28;

  // CTA pill (violet) + url
  roundRectSC(ctx, P, cy, W - 2 * P, 64, 12);
  ctx.fillStyle = BRAND.violet; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = `800 22px ${FONT}`;
  ctx.fillText("Beat my score →", W / 2, cy + 22);
  ctx.font = `600 18px ${FONT}`; ctx.fillText(model.cta, W / 2, cy + 46);

  return canvas;
}

function roundRectSC(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/share-card.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add public/share-card.js test/share-card.test.js
git commit -m "feat(share): brand share-card — pure no-spoiler model + canvas renderer"
```

---

## Task 10: Wire mint-on-finish + challenge CTA into the share flow

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Import the new card module**

At the top of `public/app.js`, alongside the other imports:

```javascript
import { buildShareCardModel, renderShareCard } from "/share-card.js";
```

- [ ] **Step 2: Mint a challenge when MY game finishes, then build the card from it**

Replace the body of `prepareShareCard()` (`public/app.js` ~2360-2392). The new version mints a challenge (so the CTA is a real `/c/:id`), then renders the brand card from the pure model:

```javascript
async function prepareShareCard() {
  game.shareImage = null;
  const snap = game.snapshot;
  if (!snap || snap.phase !== "finished") return;
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;

  const maxG = snap.maxGuesses ?? 6;
  const won = me.status === "won";
  const score = won ? `${me.guesses.length}/${maxG}` : `X/${maxG}`;

  // Mint (or reuse) a challenge for THIS word so the card's CTA is a real replay link.
  // If we arrived via a challenge link already, reuse that id (don't re-mint the same word).
  let challengeId = game.challengeId;
  if (!challengeId) {
    try {
      const res = await fetch("/api/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          word: (snap.word || "").toUpperCase(),
          wordLength: snap.wordLength ?? 5,
          owner: getUsername(),
          ownerScore: score,
          ownerGrid: (me.guesses || []).map((g) => g.mask),
        }),
      });
      challengeId = (await res.json()).id;
    } catch { /* offline / mint failed — fall back to the room link below */ }
  }
  const cardUrl = challengeId
    ? `${location.origin}/c/${challengeId}`
    : `${location.origin}/@${game.owner}/${game.slug}`;

  const model = buildShareCardModel({
    username: getUsername(), guesses: me.guesses || [], won, score,
    challengeUrl: cardUrl.replace(/^https?:\/\//, ""),
  });
  const canvas = renderShareCard(model, snap.wordLength ?? 5);
  const text = won ? `Solved Wordul in ${score} — beat me?` : `Wordul got me. Your turn?`;
  game.shareImage = { file: null, url: cardUrl, text, canvas };
  canvas.toBlob((blob) => {
    if (blob && game.shareImage && game.shareImage.canvas === canvas) {
      game.shareImage.file = new File([blob], "wordul.png", { type: "image/png" });
    }
  }, "image/png");
}
```

- [ ] **Step 3: Make the call site await-safe**

`prepareShareCard()` is now async. At its call site (~`public/app.js:2341`), change `prepareShareCard();` to `void prepareShareCard();` (fire-and-forget is fine — `shareResult()` already guards on `img?.file`, and the synchronous `navigator.share` requirement is satisfied because the blob resolves before the user clicks Share). Verify the share still works in the manual step.

- [ ] **Step 4: Delete the now-dead old renderer**

Remove the old `renderResultCanvas` + its `drawHeader` helper (the NYT-branded, answer-spoiling versions, ~`public/app.js:2448`+) since `share-card.js` replaces them. Grep first to confirm no other caller:

Run: `grep -n "renderResultCanvas\|drawHeader" public/app.js`
Expected after deletion: no matches.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, finish a solo game, open the share card (Save image on desktop). Confirm: WORDUL gold wordmark, your @name, color grid with **no letters**, a phrase, violet "Beat my score →" with a `wordul.com/c/XXXXX` link. Open that link → same word.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat(share): mint challenge on finish, brand card CTA → /c/:id, drop spoiler renderer"
```

---

## Task 11: Desktop share row (URL field + Copy + Share)

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`
- Modify: `public/index.html`

- [ ] **Step 1: Add the share-row markup to the stats modal**

In the stats-modal template (where `#modalShare` lives), replace the single Share button with a share row:

```html
<div class="share-row">
  <input class="share-url" id="shareUrl" readonly />
  <button class="share-copy" id="shareCopy" type="button">Copy</button>
  <button class="share-native" id="modalShare" type="button">Share</button>
</div>
```

- [ ] **Step 2: Style it**

Append to `public/style.css`:

```css
.share-row { display: flex; gap: 8px; align-items: stretch; margin-top: 14px; }
.share-url {
  flex: 1; min-width: 0; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg-card, #1a1622);
  color: var(--fg); font: 600 14px system-ui; overflow: hidden; text-overflow: ellipsis;
}
.share-copy, .share-native {
  padding: 10px 16px; border-radius: 8px; border: 0; cursor: pointer;
  font: 700 14px system-ui; color: #fff;
}
.share-copy { background: var(--accent, #7c5cff); }
.share-copy.ok { background: var(--green, #538d4e); }
.share-native { background: var(--gold, #f0c14b); color: #1a1410; }
/* Hide native Share where the API is absent (desktop browsers without it). */
.share-row.no-native .share-native { display: none; }
```

- [ ] **Step 3: Wire the row when the modal opens**

Where `#modalShare.onclick` is set (~`public/app.js:2343`), add:

```javascript
  const urlEl = $("#shareUrl");
  const copyBtn = $("#shareCopy");
  const row = document.querySelector(".share-row");
  if (urlEl && game.shareImage) urlEl.value = game.shareImage.url;
  if (row) row.classList.toggle("no-native", typeof navigator.share !== "function");
  if (copyBtn) copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(game.shareImage?.url ?? location.href);
      copyBtn.textContent = "✓ Copied"; copyBtn.classList.add("ok");
      setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("ok"); }, 1600);
    } catch { prompt("Copy this link:", game.shareImage?.url ?? location.href); }
  };
```

- [ ] **Step 4: Apply the same row to the lobby invite**

The lobby invite (`#inviteBtn`, ~`public/app.js:511`) gets the same treatment: a visible `#inviteUrl` field + Copy + Share. Reuse the markup/CSS; point the field at `${location.origin}/@${game.owner}/${game.slug}`. `shareRoomInvite()` stays as the Share button's handler.

- [ ] **Step 5: Manual verification**

Run: `npm run dev` on desktop (no `navigator.share`): open the end modal → see the URL in a field, click Copy → "✓ Copied", paste → it's the `/c/:id` link. The Share button is hidden on desktop, shown on mobile.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/style.css public/index.html
git commit -m "feat(share): desktop share row — visible URL + Copy + native Share"
```

---

## Task 12: Phase 2 ship

- [ ] **Step 1: Full gauntlet**

Run: `npm run typecheck && npm test`
Expected: all pass (incl. `challenge-core`, `share-card`).

- [ ] **Step 2: Ship via the push skill**

Use the `push` skill (commit → rebase → gauntlet → push GitHub → deploy → smoke). Post the Post-Deploy Summary.

- [ ] **Step 3: Live smoke the full loop**

1. Finish a game on `https://wordul.com`.
2. Copy the share link from the desktop row.
3. Open it in a private window → same word, banner shows score-to-beat.
4. Finish → standing record updates.

Expected: end-to-end challenge loop works on prod; share card has no answer letters.

---

## Self-Review Notes (author)

- **Spec coverage:** Challenge DO (T3), wrangler sqlite (T4), worker routes (T5), room seeding + attempt (T6), `/c/:id` + record (T7), card restyle no-spoiler (T9–10), desktop UX (T11) — all spec sections mapped.
- **Type consistency:** `ChallengeState/Attempt/Record/Meta` defined in T1, re-exported T2, consumed T3/T6. `buildShareCardModel`/`renderShareCard` defined T9, used T10. `openSocket(url)` introduced T7 and reused by the room path.
- **Open plan-time call (from spec):** attempt reporting is done **server-side from the room** (T6) — chosen over client-side so the answer/score stay server-authoritative.
- **Watch-item:** T10 Step 3 makes `prepareShareCard` async; confirm iOS native share still fires (blob resolves before click). If iOS rejects, pre-mint the challenge earlier (on game finish, before modal open).
