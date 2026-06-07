# Per-World Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each World/surface its own companion voice — silent by default, or AI-TTS / clip-set — curated by an admin, without changing which lines are spoken.

**Architecture:** A KV override map (`worlds:voice`) keyed by the shared world/edition/voice id, normalized by a pure validator, served at `/voice-config.json`, hydrated client-side, and merged into the existing `mergeConfig` voice contract. `companionReact` returns a voice descriptor (`silent`/`ai`/`clips`); playback dispatches on it. Uploaded clip sets live in a new R2 bucket; built-in edition clips stay in static ASSETS. An admin editor (`studio-voice`) mirrors the existing `studio-worlds` pattern.

**Tech Stack:** Cloudflare Workers (`wrangler`), TypeScript (server), vanilla ES modules (client), Vitest, KV (`DIRECTORY`), R2 (`VOICE`).

**Working directory:** `.claude/worktrees/studio-voice` (root edits are hook-blocked). Run `npm test` / `npm run typecheck` from here. Never `wrangler deploy` by hand — ship via `dev/ship.sh`.

---

## File structure

| File | Responsibility | New? |
|---|---|---|
| `src/voice-overrides.ts` | Pure types + `normalizeVoiceOverrides` + `EMPTY_VOICE` | Create |
| `src/voice.ts` | Server `getEffectiveVoice` + KV keys + clip-set registry helpers | Create |
| `src/worker.ts` | 5 endpoints + `Env` binding for `VOICE` | Modify |
| `wrangler.jsonc` | R2 bucket `wordul-voice` → binding `VOICE` | Modify |
| `public/voice-config.js` | Client hydrate + active-id + `voiceLayer` + `resolveClipBase` | Create |
| `public/edition.js` | `companionReact` merges voice layer, returns descriptor | Modify |
| `public/voice.js` | Generalize playback off `clipBase`; add `speakAI`; `playVoice` dispatch | Modify |
| `public/app.js` | Boot-hydrate voice config; set active id; route playback via descriptor | Modify |
| `public/studio-voice-core.js` | Pure editor transforms (`buildVoiceOverride`, source/clip CRUD) | Create |
| `public/studio-voice.js` | Editor controller (fetch/save/upload) | Create |
| `public/studio-voice.html` | Editor shell | Create |
| `test/voice-overrides.test.ts` | Validator tests | Create |
| `test/voice-config.test.js` | Client layer/resolve tests | Create |
| `test/studio-voice-core.test.js` | Editor core tests | Create |

---

## Phase A — Pure model + validation

### Task A1: Voice override types + validator

**Files:**
- Create: `src/voice-overrides.ts`
- Test: `test/voice-overrides.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/voice-overrides.test.ts
import { describe, it, expect } from "vitest";
import { normalizeVoiceOverrides, EMPTY_VOICE } from "../src/voice-overrides.ts";
import type { WorldDef } from "../src/worlds.ts";

const base: WorldDef[] = [
  { id: "default", slug: "wordul", name: "Wordul", blurb: "", editionId: "default", featured: true, order: 0 },
  { id: "yang", slug: "yangs-table", name: "Yang's Table", blurb: "", editionId: "yang", featured: false, order: 6 },
];
const clipSets = ["default", "yang", "my-upload"];

describe("normalizeVoiceOverrides", () => {
  it("accepts empty and round-trips an ai + clips doc", () => {
    expect(normalizeVoiceOverrides({}, base, clipSets)).toEqual({ ok: true, value: {} });
    const raw = {
      yang: { on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } },
      default: { on: false, source: { kind: "ai", voiceName: "Daniel", rate: 1.1, pitch: 0.9 } },
    };
    const r = normalizeVoiceOverrides(raw, base, clipSets);
    expect(r).toEqual({ ok: true, value: raw });
  });

  it("rejects an unknown world id", () => {
    const r = normalizeVoiceOverrides({ nope: { on: true, source: { kind: "ai", voiceName: "x" } } }, base, clipSets);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown source kind and a missing ai voiceName", () => {
    expect(normalizeVoiceOverrides({ yang: { on: true, source: { kind: "wat" } } }, base, clipSets).ok).toBe(false);
    expect(normalizeVoiceOverrides({ yang: { on: true, source: { kind: "ai", voiceName: "" } } }, base, clipSets).ok).toBe(false);
  });

  it("rejects a clipSetId not in the known set and a bad origin", () => {
    expect(normalizeVoiceOverrides({ yang: { on: true, source: { kind: "clips", clipSetId: "ghost", origin: "upload" } } }, base, clipSets).ok).toBe(false);
    expect(normalizeVoiceOverrides({ yang: { on: true, source: { kind: "clips", clipSetId: "yang", origin: "bad" } } }, base, clipSets).ok).toBe(false);
  });

  it("clamps ai rate/pitch into range", () => {
    const r = normalizeVoiceOverrides({ yang: { on: true, source: { kind: "ai", voiceName: "x", rate: 9, pitch: -3 } } }, base, clipSets);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.yang.source).toMatchObject({ rate: 2, pitch: 0 });
  });

  it("coerces on to boolean and drops unknown fields", () => {
    const r = normalizeVoiceOverrides({ yang: { on: 1, junk: true, source: { kind: "ai", voiceName: "x", junk: 1 } } } as any, base, clipSets);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.yang).toEqual({ on: true, source: { kind: "ai", voiceName: "x" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- voice-overrides`
Expected: FAIL — `Cannot find module '../src/voice-overrides.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/voice-overrides.ts
import type { WorldDef } from "./worlds.ts";

export type VoiceSource =
  | { kind: "ai"; voiceName: string; rate?: number; pitch?: number }
  | { kind: "clips"; clipSetId: string; origin: "upload" | "clone-existing" | "clone-sample" | "record" };

export type WorldVoice = { on: boolean; source: VoiceSource };
export type VoiceOverrides = Record<string, WorldVoice>;
export const EMPTY_VOICE: VoiceOverrides = {};

export type VoiceNormResult =
  | { ok: true; value: VoiceOverrides }
  | { ok: false; reason: string };

const ID_RE = /^[a-z0-9-]{1,40}$/;
const ORIGINS = new Set(["upload", "clone-existing", "clone-sample", "record"]);
const NAME_MAX = 64;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Validate an admin-supplied voice map against the world base + known clip sets.
// Returns a cleaned doc (only whitelisted fields) or a human-readable reason.
export function normalizeVoiceOverrides(raw: unknown, base: WorldDef[], knownClipSets: string[]): VoiceNormResult {
  const o = asObj(raw);
  const baseIds = new Set(base.map((w) => w.id));
  const sets = new Set(knownClipSets);
  const out: VoiceOverrides = {};

  for (const id of Object.keys(o)) {
    if (!ID_RE.test(id)) return { ok: false, reason: `invalid id: ${id}` };
    if (!baseIds.has(id)) return { ok: false, reason: `unknown world id: ${id}` };
    const entry = asObj(o[id]);
    const src = asObj(entry.source);
    const on = entry.on === true || entry.on === 1 || entry.on === "true";

    if (src.kind === "ai") {
      const voiceName = typeof src.voiceName === "string" ? src.voiceName.trim() : "";
      if (!voiceName || voiceName.length > NAME_MAX) return { ok: false, reason: `bad voiceName for ${id}` };
      const source: VoiceSource = { kind: "ai", voiceName };
      if (src.rate != null) { const n = Number(src.rate); if (!Number.isFinite(n)) return { ok: false, reason: `bad rate for ${id}` }; source.rate = clamp(n, 0.5, 2); }
      if (src.pitch != null) { const n = Number(src.pitch); if (!Number.isFinite(n)) return { ok: false, reason: `bad pitch for ${id}` }; source.pitch = clamp(n, 0, 2); }
      out[id] = { on, source };
    } else if (src.kind === "clips") {
      const clipSetId = typeof src.clipSetId === "string" ? src.clipSetId : "";
      if (!ID_RE.test(clipSetId)) return { ok: false, reason: `bad clipSetId for ${id}` };
      if (!sets.has(clipSetId)) return { ok: false, reason: `unknown clipSet for ${id}: ${clipSetId}` };
      if (typeof src.origin !== "string" || !ORIGINS.has(src.origin)) return { ok: false, reason: `bad origin for ${id}` };
      out[id] = { on, source: { kind: "clips", clipSetId, origin: src.origin as VoiceSource extends { kind: "clips" } ? never : never } as VoiceSource };
    } else {
      return { ok: false, reason: `unknown source kind for ${id}` };
    }
  }
  return { ok: true, value: out };
}
```

> Note: the `as VoiceSource ...` cast on `origin` is ugly — replace with a plain
> `{ kind: "clips", clipSetId, origin: src.origin as "upload" | "clone-existing" | "clone-sample" | "record" }`.
> Use that simpler form; it's written verbosely above only to flag the cast site.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- voice-overrides`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/voice-overrides.ts test/voice-overrides.test.ts
git commit -m "feat(voice): pure per-world voice override validator"
```

---

## Phase B — Server: effective resolve + read/write endpoints

### Task B1: `getEffectiveVoice` + KV keys + clip-set registry

**Files:**
- Create: `src/voice.ts`

- [ ] **Step 1: Write the implementation** (thin KV wrapper; covered by endpoint + validator tests)

```ts
// src/voice.ts
import { WORLDS } from "./worlds.ts";
import { normalizeVoiceOverrides, EMPTY_VOICE, type VoiceOverrides } from "./voice-overrides.ts";

export const VOICE_OVERRIDES_KEY = "worlds:voice";   // KV: the per-world voice map
export const CLIPSET_REGISTRY_KEY = "voice:clipsets"; // KV: string[] of uploaded clip-set ids

type VoiceEnv = { DIRECTORY: KVNamespace };

// Built-in clip sets === the launch editions (their clips ship in static ASSETS).
export function builtinClipSets(): string[] {
  return Array.from(new Set(WORLDS.map((w) => w.editionId)));
}

export async function uploadedClipSets(env: VoiceEnv): Promise<string[]> {
  try {
    const v = await env.DIRECTORY.get(CLIPSET_REGISTRY_KEY, "json");
    return Array.isArray(v) ? (v as unknown[]).filter((x) => typeof x === "string") as string[] : [];
  } catch { return []; }
}

export async function knownClipSets(env: VoiceEnv): Promise<string[]> {
  return [...builtinClipSets(), ...(await uploadedClipSets(env))];
}

// Effective voice map = KV override normalized against the world base + known sets.
// Never throws: any KV failure or corrupt blob falls back to {} (everything silent).
export async function getEffectiveVoice(env: VoiceEnv): Promise<VoiceOverrides> {
  try {
    const stored = await env.DIRECTORY.get(VOICE_OVERRIDES_KEY, "json");
    if (!stored) return EMPTY_VOICE;
    const norm = normalizeVoiceOverrides(stored, WORLDS, await knownClipSets(env));
    return norm.ok ? norm.value : EMPTY_VOICE;
  } catch { return EMPTY_VOICE; }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/voice.ts
git commit -m "feat(voice): server effective-voice resolver + clip-set registry"
```

### Task B2: read/write endpoints in `worker.ts`

**Files:**
- Modify: `src/worker.ts` (add imports near line 14; add routes after the `/admin/worlds` POST block ~line 407)

- [ ] **Step 1: Add imports** (next to the worlds import at `worker.ts:14`)

```ts
import { getEffectiveVoice, knownClipSets, builtinClipSets, VOICE_OVERRIDES_KEY } from "./voice.ts";
import { normalizeVoiceOverrides } from "./voice-overrides.ts";
```

- [ ] **Step 2: Add routes** (immediately after the `/admin/worlds` POST handler, after `worker.ts:407`)

```ts
    // Public effective voice map (code base silent-default + admin KV overrides).
    if (url.pathname === "/voice-config.json" && req.method === "GET") {
      const map = await getEffectiveVoice(env);
      return new Response(JSON.stringify(map), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    // Admin: read effective map + base (world list + available clip sets) for the editor.
    if (url.pathname === "/admin/voice" && req.method === "GET") {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const effective = await getEffectiveVoice(env);
      const clipSets = await knownClipSets(env);
      return new Response(JSON.stringify({ base: { worlds: WORLDS, clipSets, builtin: builtinClipSets() }, effective }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    // Admin: write the voice override map.
    if (url.pathname === "/admin/voice" && req.method === "POST") {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const len = Number(req.headers.get("content-length") ?? "0");
      if (len > 64 * 1024) {
        return new Response(JSON.stringify({ error: "payload_too_large" }), { status: 413, headers: { "content-type": "application/json" } });
      }
      let raw: unknown;
      try { raw = await req.json(); }
      catch { return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: { "content-type": "application/json" } }); }
      const result = normalizeVoiceOverrides(raw, WORLDS, await knownClipSets(env));
      if (!result.ok) {
        return new Response(JSON.stringify({ error: result.reason }), { status: 400, headers: { "content-type": "application/json" } });
      }
      await env.DIRECTORY.put(VOICE_OVERRIDES_KEY, JSON.stringify(result.value));
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`WORLDS` is already imported in `worker.ts`.)

- [ ] **Step 4: Manual smoke** (local dev)

Run: `npm run dev` then in another shell:
```bash
curl -s localhost:8787/voice-config.json            # expect: {}
curl -s localhost:8787/admin/voice                  # expect: 401 unauthorized
```
Expected: `{}` and `unauthorized`.

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts
git commit -m "feat(voice): /voice-config.json + GET/POST /admin/voice endpoints"
```

---

## Phase C — Upload + R2 serving

### Task C1: R2 bucket binding

**Files:**
- Modify: `wrangler.jsonc` (the `r2_buckets` array, ~line 78)

- [ ] **Step 1: Add the bucket** (append to the `r2_buckets` array)

```jsonc
    { "binding": "VOICE", "bucket_name": "wordul-voice" }
```

- [ ] **Step 2: Create the bucket** (one-time, requires `wrangler login`)

Run: `npx wrangler r2 bucket create wordul-voice`
Expected: "Created bucket wordul-voice".

- [ ] **Step 3: Add `VOICE` to the `Env` type** (wherever `Env` is declared in `src/worker.ts`; it already has `DESIGNS`/`OG: R2Bucket`)

```ts
  VOICE: R2Bucket;
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add wrangler.jsonc src/worker.ts
git commit -m "chore(voice): add wordul-voice R2 bucket binding (VOICE)"
```

### Task C2: upload + serve routes

**Files:**
- Modify: `src/worker.ts` (add routes after the `/admin/voice` POST block; add serve route near the DESIGNS route ~line 526)

- [ ] **Step 1: Add the upload route** (after the `/admin/voice` POST handler)

```ts
    // Admin: upload one clip into a clip set. multipart form: clipSetId, lineKey, file (wav/mp3).
    if (url.pathname === "/admin/voice/clips" && req.method === "POST") {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const form = await req.formData().catch(() => null);
      if (!form) return new Response(JSON.stringify({ error: "bad_form" }), { status: 400, headers: { "content-type": "application/json" } });
      const clipSetId = String(form.get("clipSetId") ?? "");
      const lineKey = String(form.get("lineKey") ?? "");
      const file = form.get("file");
      if (!/^[a-z0-9-]{1,40}$/.test(clipSetId)) return new Response(JSON.stringify({ error: "bad_clipSetId" }), { status: 400, headers: { "content-type": "application/json" } });
      if (!/^[a-z0-9._-]{1,80}$/.test(lineKey)) return new Response(JSON.stringify({ error: "bad_lineKey" }), { status: 400, headers: { "content-type": "application/json" } });
      if (!(file instanceof File)) return new Response(JSON.stringify({ error: "no_file" }), { status: 400, headers: { "content-type": "application/json" } });
      if (!["audio/wav", "audio/x-wav", "audio/mpeg"].includes(file.type)) return new Response(JSON.stringify({ error: "bad_type" }), { status: 415, headers: { "content-type": "application/json" } });
      if (file.size > 2 * 1024 * 1024) return new Response(JSON.stringify({ error: "too_large" }), { status: 413, headers: { "content-type": "application/json" } });

      const ext = file.type === "audio/mpeg" ? "mp3" : "wav";
      const fname = `${lineKey}.${ext}`;
      await env.VOICE.put(`clipsets/${clipSetId}/${fname}`, file.stream(), { httpMetadata: { contentType: file.type } });

      // Update the per-set manifest (lineKey -> filename).
      const mkey = `clipsets/${clipSetId}/manifest.json`;
      let manifest: Record<string, string> = {};
      const cur = await env.VOICE.get(mkey);
      if (cur) { try { manifest = JSON.parse(await cur.text()) || {}; } catch { manifest = {}; } }
      manifest[lineKey] = fname;
      await env.VOICE.put(mkey, JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });

      // Register the set id so the validator accepts it.
      const reg = new Set(await knownClipSets(env));
      if (!builtinClipSets().includes(clipSetId)) {
        reg.add(clipSetId);
        await env.DIRECTORY.put("voice:clipsets", JSON.stringify([...reg].filter((s) => !builtinClipSets().includes(s))));
      }
      return new Response(JSON.stringify({ ok: true, file: fname }), { headers: { "content-type": "application/json" } });
    }
```

- [ ] **Step 2: Add the serve route** (near the DESIGNS serve route, ~`worker.ts:526`)

```ts
    // Serve uploaded voice clips from the VOICE R2 bucket at /voice-clips/<set>/<file>.
    if (url.pathname.startsWith("/voice-clips/")) {
      const key = "clipsets/" + url.pathname.slice("/voice-clips/".length);
      const obj = await env.VOICE.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "public, max-age=300" },
      });
    }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat(voice): admin clip upload to R2 + /voice-clips serve route"
```

---

## Phase D — Client runtime

### Task D1: `voice-config.js` (pure-ish hydrate + layer + resolve)

**Files:**
- Create: `public/voice-config.js`
- Test: `test/voice-config.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/voice-config.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { hydrateVoiceConfig, setActiveVoiceId, activeVoiceLayer, voiceLayer, resolveClipBase } from "../public/voice-config.js";

describe("voiceLayer", () => {
  it("returns {} for absent / off / sourceless", () => {
    expect(voiceLayer(undefined)).toEqual({});
    expect(voiceLayer({ on: false, source: { kind: "ai", voiceName: "x" } })).toEqual({});
    expect(voiceLayer({ on: true })).toEqual({});
  });
  it("wraps an on source as a voice layer", () => {
    expect(voiceLayer({ on: true, source: { kind: "ai", voiceName: "x" } }))
      .toEqual({ voice: { source: { kind: "ai", voiceName: "x" } } });
  });
});

describe("resolveClipBase", () => {
  it("built-in editions resolve to static ASSETS, others to R2 route", () => {
    expect(resolveClipBase("yang")).toBe("/voice/yang/");
    expect(resolveClipBase("my-upload")).toBe("/voice-clips/my-upload/");
  });
});

describe("active voice layer", () => {
  beforeEach(() => { hydrateVoiceConfig({}); setActiveVoiceId(null); });
  it("is {} when nothing active or not configured", () => {
    expect(activeVoiceLayer()).toEqual({});
    setActiveVoiceId("yang");
    expect(activeVoiceLayer()).toEqual({});
  });
  it("returns the active id's layer once hydrated", () => {
    hydrateVoiceConfig({ yang: { on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } } });
    setActiveVoiceId("yang");
    expect(activeVoiceLayer()).toEqual({ voice: { source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- voice-config`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// public/voice-config.js
// Client twin of the server voice map. Hydrated at boot from /voice-config.json.
// The active surface (a /w/ World page, or the daily/room bundle) sets the active
// voice id; activeVoiceLayer() returns the mergeConfig layer for it ({} ⇒ silent).
import { EDITIONS } from "/editions/index.js";

const BUILTIN = new Set(EDITIONS.map((e) => e.id));
let MAP = {};         // id -> { on, source }
let ACTIVE = null;    // current voice id

export function hydrateVoiceConfig(map) { MAP = (map && typeof map === "object" && !Array.isArray(map)) ? map : {}; }
export function setActiveVoiceId(id) { ACTIVE = typeof id === "string" ? id : null; }

// Pure: a WorldVoice -> a mergeConfig voice layer (or {} when silent).
export function voiceLayer(wv) {
  if (!wv || !wv.on || !wv.source) return {};
  return { voice: { source: wv.source } };
}

export function activeVoiceLayer() { return ACTIVE ? voiceLayer(MAP[ACTIVE]) : {}; }

// Built-in edition clips ship in static ASSETS; uploaded sets serve from R2.
export function resolveClipBase(clipSetId) {
  return BUILTIN.has(clipSetId) ? `/voice/${clipSetId}/` : `/voice-clips/${clipSetId}/`;
}

// Fetch + hydrate at boot. Swallows errors (keeps silent default). Returns changed?
export async function loadVoiceConfig() {
  try {
    const res = await fetch("/voice-config.json", { cache: "no-store" });
    if (!res.ok) return false;
    const next = await res.json();
    if (!next || typeof next !== "object" || Array.isArray(next)) return false;
    const before = JSON.stringify(MAP);
    hydrateVoiceConfig(next);
    return JSON.stringify(MAP) !== before;
  } catch { return false; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- voice-config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/voice-config.js test/voice-config.test.js
git commit -m "feat(voice): client voice-config hydrate + active layer + clip-base resolver"
```

### Task D2: `companionReact` returns a voice descriptor

**Files:**
- Modify: `public/edition.js` (import at top ~line 4; `companionReact` body ~lines 84-129)

- [ ] **Step 1: Add the import** (near `import { mergeConfig } from "/roomConfig.js";`, `edition.js:4`)

```js
import { activeVoiceLayer, resolveClipBase } from "/voice-config.js";
```

- [ ] **Step 2: Splice the active voice layer into the merge** (replace the `mergeConfig(...)` call at `edition.js:87-90`)

```js
  const merged = mergeConfig(
    { voice: { react: ed.companion?.react ?? {}, lines: ed.companion?.lines ?? {} } },
    activeVoiceLayer(),                 // per-surface voice source (silent ⇒ {})
    { voice: snapshotVoiceConfig() },
  );
```

- [ ] **Step 3: Replace the speak-gate + return** (replace `edition.js:115-128`, the `const muted...` through `return {...}`)

```js
  const muted = localStorage.getItem(LS.muted) === "1";
  const source = merged.voice?.source ?? null;   // null ⇒ this surface is silent
  const allowed = isVoiceEnabled()
    ? shouldSpeak(event, tier, react, ctx.rng)
    : raw.includes("{answer}");
  const speak = !!source && !muted && allowed;

  const revealVoice = snapshotVoiceConfig().reveal
    ?? getEdition(activeId).sound?.voice?.reveal ?? "robot";

  // Audio descriptor consumed by the playback dispatcher (app.js / voice.js).
  let voice = { mode: "silent" };
  if (source?.kind === "ai") voice = { mode: "ai", voiceName: source.voiceName, rate: source.rate, pitch: source.pitch };
  else if (source?.kind === "clips") voice = { mode: "clips", clipBase: resolveClipBase(source.clipSetId) };

  return { text, raw, tier, revealVoice, speak, voice };
```

- [ ] **Step 4: Typecheck the bundle builds** (no TS here; run the existing edition test)

Run: `npm test -- edition`
Expected: PASS (existing `companionReact` tests still green — `speak` is now gated by a configured source, so any existing test asserting speech must set up an active voice layer; update those tests in this step if they fail, by calling `hydrateVoiceConfig`+`setActiveVoiceId` from `/voice-config.js`).

- [ ] **Step 5: Commit**

```bash
git add public/edition.js test/edition.test.js
git commit -m "feat(voice): companionReact returns a per-surface voice descriptor"
```

### Task D3: generalize `voice.js` playback + add `playVoice`/`speakAI`

**Files:**
- Modify: `public/voice.js`

- [ ] **Step 1: Generalize `loadManifest`/`speakLine`/`speakTemplated` to take a `clipBase`** instead of `editionId`. Replace the manifest fetch + the two exported speak functions:

```js
const manifests = {}; // clipBase -> { lineKey: filename }

async function loadManifest(clipBase) {
  if (manifests[clipBase]) return manifests[clipBase];
  try {
    const res = await fetch(`${clipBase}manifest.json`);
    if (res.ok) return (manifests[clipBase] = (await res.json()) || {});
  } catch { /* transient — do not memoize */ }
  return {};
}

export async function speakLine(clipBase, rawLine, spokenText) {
  if (!rawLine || isMuted()) return;
  const map = await loadManifest(clipBase);
  if (isMuted()) return;
  const file = map[lineKey(rawLine)];
  if (file) playClip(`${clipBase}${file}`);
  else fallbackSpeak(spokenText ?? rawLine);
}

export async function speakTemplated(clipBase, rawLine, ctx = {}, revealVoice = "robot") {
  if (!rawLine || isMuted()) return;
  if (!rawLine.includes("{answer}")) return speakLine(clipBase, rawLine, rawLine);
  const { prefix, suffix } = splitTemplate(rawLine);
  const map = await loadManifest(clipBase);
  if (isMuted()) return;
  stopSpeaking();
  const playSegment = (seg) => new Promise((resolve) => {
    if (!seg) return resolve();
    const file = map[lineKey(seg)];
    if (file) {
      stopSpeaking();
      try { const audio = new Audio(`${clipBase}${file}`); current = { audio }; audio.addEventListener("ended", resolve, { once: true }); audio.play().catch(resolve); }
      catch { resolve(); }
    } else {
      try { const u = new SpeechSynthesisUtterance(seg); u.addEventListener("end", resolve, { once: true }); window.speechSynthesis.speak(u); } catch { resolve(); }
    }
  });
  const sayAnswer = () => new Promise((resolve) => {
    if (!ctx.answer || !window.speechSynthesis) return resolve();
    try { const u = roboticUtterance(ctx.answer); u.addEventListener("end", resolve, { once: true }); window.speechSynthesis.speak(u); } catch { resolve(); }
  });
  await playSegment(prefix);
  if (isMuted()) return;
  await sayAnswer();
  if (isMuted()) return;
  await playSegment(suffix);
}
```

- [ ] **Step 2: Add `speakAI` + the `playVoice` dispatcher** (export both)

```js
// Speak arbitrary text via a named system TTS voice (the "ai" source).
export function speakAI(voiceName, text, rate, pitch) {
  if (!text || !window.speechSynthesis) return;
  stopSpeaking();
  try {
    const u = new SpeechSynthesisUtterance(text);
    const v = (window.speechSynthesis.getVoices?.() ?? []).find((x) => x.name === voiceName);
    if (v) u.voice = v;
    if (typeof rate === "number") u.rate = rate;
    if (typeof pitch === "number") u.pitch = pitch;
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

// Dispatch a companionReact `voice` descriptor to the right playback path.
export function playVoice(voice, raw, text, ctx = {}, revealVoice = "robot") {
  if (!voice || voice.mode === "silent") return;
  if (voice.mode === "ai") return speakAI(voice.voiceName, raw.includes("{answer}") ? text : (text ?? raw), voice.rate, voice.pitch);
  if (voice.mode === "clips") {
    if (raw.includes("{answer}")) return speakTemplated(voice.clipBase, raw, ctx, revealVoice);
    return speakLine(voice.clipBase, raw, text);
  }
}
```

- [ ] **Step 3: Run the existing voice tests**

Run: `npm test -- voice.test`
Expected: PASS — update any test passing an `editionId` to pass a `clipBase` like `/voice/yang/` instead.

- [ ] **Step 4: Commit**

```bash
git add public/voice.js test/voice.test.js
git commit -m "feat(voice): playback off clipBase + speakAI + playVoice dispatcher"
```

### Task D4: wire boot-hydrate, active id, and playback dispatch in `app.js`

**Files:**
- Modify: `public/app.js` (imports ~lines 7 & 30; boot; `showCompanion` ~1486; reveal/forfeit call sites 1516, 1524, 4488; world routing & daily/room bundle apply sites)

- [ ] **Step 1: Update imports**

At `app.js:7` add `playVoice` to the voice.js import (find the existing `import { ... } from "/voice.js"`; add `playVoice`). Add a new import:
```js
import { loadVoiceConfig, setActiveVoiceId } from "/voice-config.js";
```

- [ ] **Step 2: Boot-hydrate** (next to the existing `loadWorlds().then(...)` boot call)

```js
  loadVoiceConfig();
```

- [ ] **Step 3: Set the active voice id where each surface activates.**
  - World page route (where `getWorld(slug)` resolves the world before applying its edition): `setActiveVoiceId(getWorld(slug)?.id ?? null);`
  - Daily/room/challenge apply (where the bundle's `voice`/`edition` is applied via `applyEdition`): `setActiveVoiceId(bundle.voice ?? null);` (use the local variable holding the bundle).
  - Home / non-game surfaces: `setActiveVoiceId(null);`

  Grep for `applyEdition(` and `getWorld(` call sites and set the active id adjacent to each.

- [ ] **Step 4: Route playback through `playVoice`.** Replace the speak dispatch in `showCompanion` (`app.js:1487-1488`):

```js
function showCompanion(event, ctx = {}) {
  const { text, raw, tier, speak, revealVoice, voice } = companionReact(event, ctx);
  if (!text) return;
  const big = tier && !(event === "wrong" && tier === "normal");
  toast(text, { duration: big ? 4200 : 3200 });
  if (!speak || event === "wipe") return;
  playVoice(voice, raw, text, ctx, revealVoice);
}
```

  Then update the other three call sites to use the descriptor:
  - `app.js:1516` winReveal: `const { raw, speak, revealVoice, voice } = companionReact("winReveal", { answer }); if (speak) playVoice(voice, raw, raw.replace("{answer}", answer), { answer }, revealVoice);`
  - `app.js:1524` loss speech-twin: same shape with `companionReact("loss", { answer })`.
  - `app.js:4488` forfeit: replace `if (forfeited && isVoiceEnabled()) speakLine(VOICE_EDITION, inspire, inspire);` with a `companionReact`-driven `playVoice` (or, if `inspire` is ad-hoc text not from a bank, gate on the active layer: `const { voice, speak } = companionReact("loss", {}); if (forfeited && speak) playVoice(voice, inspire, inspire);`). Pick the form that matches the surrounding `inspire` source.

- [ ] **Step 5: Verify in the app** (manual — this is the integration seam)

Run: `npm run dev`. With no voice configured, every surface is silent (toasts still show). Then `POST /admin/voice` a `yang` clips entry (see Phase F) and confirm the daily speaks. Use a browser; check the console for no errors.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat(voice): boot-hydrate voice config, set active id per surface, dispatch playback"
```

---

## Phase E — Admin editor

### Task E1: `studio-voice-core.js` (pure)

**Files:**
- Create: `public/studio-voice-core.js`
- Test: `test/studio-voice-core.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/studio-voice-core.test.js
import { describe, it, expect } from "vitest";
import { setOn, setSource, buildVoiceOverride } from "../public/studio-voice-core.js";

const base = [{ id: "yang" }, { id: "default" }]; // worlds

describe("studio-voice-core", () => {
  it("setOn toggles a world entry, creating it if absent", () => {
    const w = setOn({}, "yang", true);
    expect(w.yang.on).toBe(true);
  });
  it("setSource replaces the source and preserves on", () => {
    const w = setSource({ yang: { on: true, source: { kind: "ai", voiceName: "a" } } }, "yang", { kind: "clips", clipSetId: "yang", origin: "clone-existing" });
    expect(w.yang).toEqual({ on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } });
  });
  it("buildVoiceOverride keeps only configured, complete entries", () => {
    const working = {
      yang: { on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } },
      default: { on: false },                 // no source ⇒ dropped
    };
    expect(buildVoiceOverride(working, base)).toEqual({
      yang: { on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- studio-voice-core`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// public/studio-voice-core.js
// Pure transforms for the voice editor. No DOM, no fetch.
// working shape: { [worldId]: { on: boolean, source?: VoiceSource } }

export function setOn(working, id, on) {
  const cur = working[id] ?? {};
  return { ...working, [id]: { ...cur, on: !!on } };
}

export function setSource(working, id, source) {
  const cur = working[id] ?? { on: false };
  return { ...working, [id]: { ...cur, source } };
}

export function clearVoice(working, id) {
  const next = { ...working };
  delete next[id];
  return next;
}

// Emit the minimal override doc the server validator accepts: only entries that have
// a complete source. (on:false with a source is kept — a deactivated-but-assigned voice.)
export function buildVoiceOverride(working, base) {
  const ids = new Set(base.map((w) => w.id));
  const out = {};
  for (const id of Object.keys(working)) {
    if (!ids.has(id)) continue;
    const e = working[id];
    if (!e || !e.source || !e.source.kind) continue;
    out[id] = { on: !!e.on, source: e.source };
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- studio-voice-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/studio-voice-core.js test/studio-voice-core.test.js
git commit -m "feat(voice): pure studio-voice editor transforms"
```

### Task E2: `studio-voice.html` + `studio-voice.js` controller

**Files:**
- Create: `public/studio-voice.html`, `public/studio-voice.js`

- [ ] **Step 1: Create the shell** `public/studio-voice.html` (mirror `studio-worlds.html` structure: a token field, a worlds table, a save + revert button, a status line)

```html
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studio · Voice</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 880px; margin: 2rem auto; padding: 0 1rem; }
  table { width: 100%; border-collapse: collapse; } td, th { padding: .4rem .5rem; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  .muted { color: #777; } button { cursor: pointer; }
  select, input[type=text], input[type=number] { font: inherit; padding: .2rem .3rem; }
</style></head>
<body>
  <h1>Studio · Voice</h1>
  <p class="muted">Each World is silent unless you give it a voice. Edits affect the live game. Voice & clips reuse Yang's line set.</p>
  <p><label>Admin token <input id="token" type="text" size="40" placeholder="DAILY_ADMIN_TOKEN"></label></p>
  <table id="rows"><thead><tr><th>World</th><th>On</th><th>Source</th><th>Detail</th><th></th></tr></thead><tbody></tbody></table>
  <p><button id="save">Save</button> <span id="status" class="muted"></span></p>
  <script type="module" src="/studio-voice.js"></script>
</body></html>
```

- [ ] **Step 2: Create the controller** `public/studio-voice.js`

```js
import { setOn, setSource, clearVoice, buildVoiceOverride } from "/studio-voice-core.js";

const TOKEN_LS = "wordul.admin.token";
let BASE = { worlds: [], clipSets: [], builtin: [] };
let working = {};

const $ = (s, r = document) => r.querySelector(s);
const token = () => $("#token").value.trim();

async function load() {
  const res = await fetch("/admin/voice", { headers: authHeaders() });
  if (!res.ok) { setStatus(`load failed: ${res.status}`); return; }
  const data = await res.json();
  BASE = data.base; working = { ...data.effective };
  render();
}

function authHeaders() { return token() ? { Authorization: `Bearer ${token()}` } : {}; }
function setStatus(t) { $("#status").textContent = t; }

function aiVoiceNames() {
  return (window.speechSynthesis?.getVoices?.() ?? []).map((v) => v.name);
}

function render() {
  const tb = $("#rows tbody"); tb.innerHTML = "";
  for (const w of BASE.worlds) {
    const e = working[w.id] ?? {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${w.name}<br><span class="muted">${w.id}</span></td>
      <td><input type="checkbox" ${e.on ? "checked" : ""} data-on="${w.id}"></td>
      <td><select data-kind="${w.id}">
        <option value="">— silent —</option>
        <option value="ai" ${e.source?.kind === "ai" ? "selected" : ""}>AI voice</option>
        <option value="clips" ${e.source?.kind === "clips" ? "selected" : ""}>Clip set</option>
        <option value="record" disabled>Record (soon)</option>
        <option value="clone-sample" disabled>Clone from sample (soon)</option>
      </select></td>
      <td data-detail="${w.id}"></td>
      <td><button data-clear="${w.id}">Remove</button></td>`;
    tb.appendChild(tr);
    renderDetail(w.id);
  }
  bind();
}

function renderDetail(id) {
  const cell = $(`[data-detail="${id}"]`); const e = working[id] ?? {};
  if (e.source?.kind === "ai") {
    const opts = aiVoiceNames().map((n) => `<option ${n === e.source.voiceName ? "selected" : ""}>${n}</option>`).join("");
    cell.innerHTML = `<select data-ai-voice="${id}">${opts}</select>
      <label>rate <input type="number" step="0.1" min="0.5" max="2" value="${e.source.rate ?? 1}" data-ai-rate="${id}" style="width:4rem"></label>
      <label>pitch <input type="number" step="0.1" min="0" max="2" value="${e.source.pitch ?? 1}" data-ai-pitch="${id}" style="width:4rem"></label>`;
  } else if (e.source?.kind === "clips") {
    const sets = BASE.clipSets.map((s) => `<option ${s === e.source.clipSetId ? "selected" : ""}>${s}</option>`).join("");
    cell.innerHTML = `reuse set <select data-clip-set="${id}">${sets}</select>
      <span class="muted">(upload UI: POST /admin/voice/clips per line — v1 reuse only)</span>`;
  } else { cell.innerHTML = `<span class="muted">no voice</span>`; }
}

function bind() {
  for (const cb of document.querySelectorAll("[data-on]")) cb.onchange = () => { working = setOn(working, cb.dataset.on, cb.checked); };
  for (const sel of document.querySelectorAll("[data-kind]")) sel.onchange = () => {
    const id = sel.dataset.kind;
    if (sel.value === "ai") working = setSource(working, id, { kind: "ai", voiceName: aiVoiceNames()[0] ?? "" });
    else if (sel.value === "clips") working = setSource(working, id, { kind: "clips", clipSetId: BASE.clipSets[0] ?? "yang", origin: "clone-existing" });
    else working = clearVoice(working, id);
    renderDetail(id);
  };
  for (const el of document.querySelectorAll("[data-ai-voice]")) el.onchange = () => mutAi(el.dataset.aiVoice, { voiceName: el.value });
  for (const el of document.querySelectorAll("[data-ai-rate]")) el.onchange = () => mutAi(el.dataset.aiRate, { rate: Number(el.value) });
  for (const el of document.querySelectorAll("[data-ai-pitch]")) el.onchange = () => mutAi(el.dataset.aiPitch, { pitch: Number(el.value) });
  for (const el of document.querySelectorAll("[data-clip-set]")) el.onchange = () => working = setSource(working, el.dataset.clipSet, { kind: "clips", clipSetId: el.value, origin: "clone-existing" });
  for (const b of document.querySelectorAll("[data-clear]")) b.onclick = () => { working = clearVoice(working, b.dataset.clear); render(); };
}

function mutAi(id, patch) {
  const cur = (working[id]?.source) ?? { kind: "ai", voiceName: "" };
  working = setSource(working, id, { ...cur, ...patch, kind: "ai" });
}

$("#save").onclick = async () => {
  const doc = buildVoiceOverride(working, BASE.worlds);
  const res = await fetch("/admin/voice", { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify(doc) });
  const out = await res.json().catch(() => ({}));
  setStatus(res.ok ? "saved ✓" : `error: ${out.error ?? res.status}`);
};

$("#token").value = localStorage.getItem(TOKEN_LS) ?? "";
$("#token").onchange = () => localStorage.setItem(TOKEN_LS, token());
if ($("#token").value) load();
// getVoices() is async in some browsers — re-render details when the list arrives.
window.speechSynthesis?.addEventListener?.("voiceschanged", () => { for (const w of BASE.worlds) renderDetail(w.id); });
```

- [ ] **Step 3: Manual check**

Run: `npm run dev`, open `/studio-voice.html`, paste the dev admin token, toggle a world to a clip set, Save → expect "saved ✓". Reload `/voice-config.json` → the entry is present.

- [ ] **Step 4: Commit**

```bash
git add public/studio-voice.html public/studio-voice.js
git commit -m "feat(voice): studio-voice admin editor (assign AI voice / clip set per world)"
```

---

## Phase F — Migration + integration verification

### Task F1: seed the speaking surfaces (ops, post-merge)

**Files:** none (runtime KV write).

- [ ] **Step 1:** After this branch ships to prod, seed the surfaces that should keep speaking so prod doesn't go silent (recommended default from spec §8 — Yang's clip set, which the daily uses via `bundle.voice: "yang"`):

```bash
curl -X POST https://wordul.com/admin/voice \
  -H "Authorization: Bearer $DAILY_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"yang":{"on":true,"source":{"kind":"clips","clipSetId":"yang","origin":"clone-existing"}}}'
```
Expected: `{"ok":true}`. (Token from `~/golden-cloud/secrets/wordul-prod.env` is for deploy creds only — `DAILY_ADMIN_TOKEN` is a worker secret; use the value you set via `wrangler secret put`.)

- [ ] **Step 2:** Verify: `curl -s https://wordul.com/voice-config.json` shows the `yang` entry; play the daily and confirm the companion speaks; play another World and confirm it's silent.

### Task F2: full suite + ship

- [ ] **Step 1: Run the whole suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 2: Ship**

Run: `bash dev/ship.sh`
Expected: tests → rebase on `origin/main` → merge → CI deploys.

---

## Self-review (completed)

- **Spec coverage:** §2 contract reuse → D2/D3; §3.1 model/key → A1; §3.2 clip sets/R2 → B1/C1/C2/D1; §3.3 merge layer → D1/D2; §4.1 voice-only (lines unchanged) → D2 (line pick untouched); §4.2 active id → D1/D4; §4.3 endpoints → B2/C2; §4.4 boot-hydrate → D1/D4; §5 editor → E1/E2; §6 validation → A1; §7 testing → A1/D1/E1 + manual seams; §8 migration → F1; §9 out-of-scope → not built. All covered.
- **Placeholder scan:** none — every code step has full code. The one verbose cast in A1 Step 3 is called out with the exact simpler replacement.
- **Type consistency:** `VoiceSource`/`WorldVoice`/`VoiceOverrides`, `normalizeVoiceOverrides(raw, base, knownClipSets)`, `getEffectiveVoice(env)`, `voiceLayer`/`activeVoiceLayer`/`resolveClipBase`/`setActiveVoiceId`/`hydrateVoiceConfig`/`loadVoiceConfig`, `playVoice`/`speakAI`/`speakLine(clipBase,…)`/`speakTemplated(clipBase,…)`, editor `setOn`/`setSource`/`clearVoice`/`buildVoiceOverride` — names consistent across tasks.
- **Known integration risks (flagged for the executor):** D2 Step 4 / D3 Step 3 — existing `edition`/`voice` tests may assume the old always-on Yang voice; update them to hydrate an active layer. D4 Step 3/4 — `app.js` call sites must be located by grep (line numbers drift); the daily/room forfeit path (4488) uses ad-hoc `inspire` text, so choose the gating form that matches its source.
