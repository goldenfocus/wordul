# Vibe Studio v1 — Increment 1: Data Foundation (`World` schema + `normalizeWorld`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `World` bundle with the additive, optional themed fields the Stage studio will author (`vibeTitle`, `rows`, `invented`, `colorScheme`, `glow`, `images`, `playlist`), and make `normalizeWorld` default/validate/clamp them and accept invented words — with full back-compat for already-scheduled days.

**Architecture:** All changes live in the pure, dependency-free `src/daily-core.ts` (unit-tested, no Cloudflare deps) and its test file. No UI, no worker wiring, no `roomConfig` yet — those are later increments. This increment ships a safe, tested data migration: the schedule endpoint will accept enriched Worlds, old Worlds still normalize unchanged, and nothing visually changes until the day-page increment consumes the new fields.

**Tech Stack:** TypeScript, Vitest. Pure functions only.

**Context:** Working in worktree `.claude/worktrees/vibe-studio` on branch `vibe-studio`. Lane 0 (the `.daily-unlock` clash fix + coherent `houseWorld`) already shipped as `prod-298`. Tests: `npx vitest run test/daily-core.test.ts`. Full suite + ship: `npm test && npm run typecheck` then `bash dev/ship.sh`.

**Resolved open items (facts, not decisions):**
- `WORDS_BY_SIZE` has pools for **every length 4–12** (4:4360 … 12:18843 words; length 5 is the answer/valid split). So "4–12 letters" needs no caveat — `invented` only bypasses *dictionary membership*, never length.
- The Room Sandbox keystone is implemented **client-side only** (`public/roomConfig.js`), with no server-side `sanitizeRoomConfig`. Therefore `roomConfig` is **deferred to the voice-editor increment** (Increment 4), not added here.

**Design decisions locked for this increment:**
- New fields are **all optional + additive**. `normalizeWorld` runs at *schedule (write)* time only; it does **not** re-run on read, so the day-page consumer (Increment 2) must also default-on-read. This plan defaults on write as defense-in-depth.
- `colorScheme` default is **omit when absent** (not derived from edition — edition palettes live in `public/`, unreachable from pure `src/`). An absent `colorScheme` means "fall back to the edition's `--accent`," exactly today's behavior.
- Optional enrichment fields that are *present but malformed* are **dropped (treated as absent)**, never cause the whole World to be rejected — except the two existing **hard gates**: a valid `date` and a valid `word`. `rows` out of range is **clamped**, not dropped.

---

## File Structure

- **Modify:** `src/daily-core.ts` — extend the `World` interface; add validation helpers; extend `normalizeWorld`.
- **Modify:** `test/daily-core.test.ts` — add a `describe("normalizeWorld — vibe fields")` block and a back-compat test.

No new files. Everything stays in the one pure module so it can be reasoned about in one context.

---

## Reference: current `normalizeWorld` (the function being extended)

`src/daily-core.ts` currently ends `normalizeWorld` by building `world` from `date`, `word`, `edition`, `voice`, `story`, `createdAt`, then conditionally attaching `bonusWord`, `curator`, `feedEditorial`. The hard word gate is:

```ts
const pool = WORDS_BY_SIZE[word.length];
if (!pool || !(pool.valid.has(word) || pool.answers.includes(word))) return null;
```

Tasks below insert new validation **after** the existing `feedEditorial` block (just before `return world;`) and **replace** the word gate in Task 3.

---

## Task 1: Extend the `World` interface

**Files:**
- Modify: `src/daily-core.ts` (the `World` interface, currently lines ~4-19)
- Test: `test/daily-core.test.ts` (type-level fixture)

- [ ] **Step 1: Write the failing test** — a typed fixture using every new field. Add to `test/daily-core.test.ts` inside the existing top-level scope (after imports):

```ts
describe("World type — vibe fields", () => {
  it("accepts a fully-enriched World fixture (compile-time shape)", () => {
    const w: World = {
      date: "2026-06-10", word: "EMBER", edition: "yang", voice: "yang",
      story: { title: "t", body: "b" },
      vibeTitle: "Embers",
      rows: 6,
      invented: false,
      colorScheme: { a1: "#f0c14b", a2: "#6f9e7a", a3: "#0b0a0c" },
      glow: { atmosphere: 0.4, header: 0.2 },
      images: { header: "designs/x/header.jpg" },
      playlist: { keys: ["designs/x/1.mp3"], autoplayOnEntry: true },
      createdAt: 1,
    };
    expect(w.vibeTitle).toBe("Embers");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts -t "fully-enriched World fixture"`
Expected: FAIL — TypeScript error "Object literal may only specify known properties" (e.g. `vibeTitle` does not exist on type `World`). (Vitest reports the transform/type error.)

- [ ] **Step 3: Add the fields to the `World` interface** in `src/daily-core.ts`, immediately after the `story` line and before `curator?`:

```ts
  // --- Vibe Studio v1 (all optional + additive; default-on-write in normalizeWorld) ---
  vibeTitle?: string;                                  // header title; falls back to story.title
  rows?: number;                                       // guess rows, 3–10, default 6
  invented?: boolean;                                  // intentional coinage; skip dictionary gate
  colorScheme?: { a1: string; a2: string; a3: string }; // the 3 palette colors (absent → edition --accent)
  glow?: { atmosphere?: number; header?: number; middle?: number; footer?: number }; // each 0–1
  images?: { header?: string; middle?: string; footer?: string };  // R2 keys
  playlist?: { keys: string[]; autoplayOnEntry?: boolean };          // R2 keys of mp3s
  // roomConfig?: deferred to the voice-editor increment (needs server-side sanitizer)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts -t "fully-enriched World fixture"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): add optional vibe fields to the World interface"
```

---

## Task 2: `rows` — default 6, clamp to 3–10

**Files:**
- Modify: `src/daily-core.ts` (`normalizeWorld`, before `return world;`)
- Test: `test/daily-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("normalizeWorld — rows", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("defaults rows to 6 when absent", () => {
    expect(normalizeWorld(base)?.rows).toBe(6);
  });
  it("keeps a valid rows value", () => {
    expect(normalizeWorld({ ...base, rows: 4 })?.rows).toBe(4);
  });
  it("clamps rows below 3 up to 3 and above 10 down to 10", () => {
    expect(normalizeWorld({ ...base, rows: 1 })?.rows).toBe(3);
    expect(normalizeWorld({ ...base, rows: 99 })?.rows).toBe(10);
  });
  it("defaults rows to 6 for a non-numeric value", () => {
    expect(normalizeWorld({ ...base, rows: "lots" })?.rows).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — rows"`
Expected: FAIL — `rows` is `undefined` (not yet defaulted).

- [ ] **Step 3: Add a clamp helper + the rows logic.** Add this helper near the top of `src/daily-core.ts` (after `const DATE_RE = ...`):

```ts
/** Clamp n into [lo, hi]; return fallback if n is not a finite number. */
function clampNum(n: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
```

Then, in `normalizeWorld`, immediately before `return world;`, add:

```ts
  world.rows = clampNum(o.rows, 3, 10, 6);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — rows"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): normalizeWorld defaults+clamps rows (3-10, default 6)"
```

---

## Task 3: Invented words — relax the dictionary gate, enforce length 4–12

**Files:**
- Modify: `src/daily-core.ts` (`normalizeWorld` — replace the word gate; attach `invented`)
- Test: `test/daily-core.test.ts`

The current gate rejects any word not in `WORDS_BY_SIZE[len]`. New rule: **hard** gates are `^[A-Z]+$` and length 4–12; a word passes the dictionary check if it is **in the pool OR** `invented === true`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("normalizeWorld — invented words", () => {
  const base = { date: "2026-06-10", story: { title: "t", body: "b" } };
  it("accepts a real pooled word with invented false/absent", () => {
    expect(normalizeWorld({ ...base, word: "EMBER" })?.word).toBe("EMBER");
    expect(normalizeWorld({ ...base, word: "EMBER" })?.invented).toBe(false);
  });
  it("rejects a non-pooled word when invented is not set", () => {
    expect(normalizeWorld({ ...base, word: "ZZZZX" })).toBeNull();
  });
  it("accepts a non-pooled word when invented is true and flags it", () => {
    const w = normalizeWorld({ ...base, word: "ZZZZX", invented: true });
    expect(w?.word).toBe("ZZZZX");
    expect(w?.invented).toBe(true);
  });
  it("still enforces length 4–12 even when invented is true", () => {
    expect(normalizeWorld({ ...base, word: "ABC", invented: true })).toBeNull();      // 3
    expect(normalizeWorld({ ...base, word: "ABCDEFGHIJKLM", invented: true })).toBeNull(); // 13
    expect(normalizeWorld({ ...base, word: "ABCD", invented: true })?.word).toBe("ABCD");  // 4 ok
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — invented words"`
Expected: FAIL — the `invented:true` non-pooled case returns null; `invented` field is undefined.

- [ ] **Step 3: Replace the word gate.** In `normalizeWorld`, the lines:

```ts
  const word = typeof o.word === "string" ? o.word.toUpperCase().trim() : "";
  if (!/^[A-Z]+$/.test(word)) return null;
  // Reject a curator typo / off-board-size word at schedule time ...
  const pool = WORDS_BY_SIZE[word.length];
  if (!pool || !(pool.valid.has(word) || pool.answers.includes(word))) return null;
```

become:

```ts
  const word = typeof o.word === "string" ? o.word.toUpperCase().trim() : "";
  if (!/^[A-Z]+$/.test(word)) return null;
  if (word.length < 4 || word.length > 12) return null; // hard length gate
  const invented = o.invented === true;
  // Dictionary gate is soft for invented coinages ("guess the curator's word").
  const pool = WORDS_BY_SIZE[word.length];
  const inPool = !!pool && (pool.valid.has(word) || pool.answers.includes(word));
  if (!inPool && !invented) return null;
```

Then add `invented` to the constructed `world` object literal (alongside `edition`/`voice`):

```ts
    invented,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — invented words"`
Expected: PASS

- [ ] **Step 5: Run the FULL daily-core suite** (the word-gate change touches existing tests):

Run: `npx vitest run test/daily-core.test.ts`
Expected: PASS (all). If any prior test scheduled a <4 or >12 word expecting success, update it — none should exist.

- [ ] **Step 6: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): accept invented words (soft dict gate), enforce length 4-12"
```

---

## Task 4: `colorScheme` — validate the trio or drop it

**Files:**
- Modify: `src/daily-core.ts`
- Test: `test/daily-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("normalizeWorld — colorScheme", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("omits colorScheme when absent", () => {
    expect(normalizeWorld(base)?.colorScheme).toBeUndefined();
  });
  it("keeps a valid hex trio", () => {
    const cs = { a1: "#f0c14b", a2: "#6f9e7a", a3: "#0B0A0C" };
    expect(normalizeWorld({ ...base, colorScheme: cs })?.colorScheme).toEqual(cs);
  });
  it("accepts hsl() / rgb() colors", () => {
    const cs = { a1: "hsl(45 80% 62%)", a2: "rgb(111,158,122)", a3: "#000" };
    expect(normalizeWorld({ ...base, colorScheme: cs })?.colorScheme).toEqual(cs);
  });
  it("drops the whole colorScheme if any color is invalid (does not reject the World)", () => {
    const w = normalizeWorld({ ...base, colorScheme: { a1: "#f0c14b", a2: "notacolor", a3: "#000" } });
    expect(w).not.toBeNull();
    expect(w?.colorScheme).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — colorScheme"`
Expected: FAIL — `colorScheme` not handled.

- [ ] **Step 3: Add an `isColor` helper + the colorScheme logic.** Add helper near `clampNum`:

```ts
/** Accept #rgb / #rrggbb hex, or any hsl()/rgb()/hsla()/rgba() string. */
function isColor(v: unknown): v is string {
  return typeof v === "string" &&
    (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^(hsl|rgb)a?\(/i.test(v.trim()));
}
```

In `normalizeWorld`, before `return world;`:

```ts
  if (o.colorScheme && typeof o.colorScheme === "object") {
    const c = o.colorScheme as Record<string, unknown>;
    if (isColor(c.a1) && isColor(c.a2) && isColor(c.a3)) {
      world.colorScheme = { a1: c.a1, a2: c.a2, a3: c.a3 };
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — colorScheme"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): normalizeWorld validates colorScheme trio (hex/hsl/rgb)"
```

---

## Task 5: `glow` — clamp each band to 0–1

**Files:**
- Modify: `src/daily-core.ts`
- Test: `test/daily-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("normalizeWorld — glow", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("omits glow when absent", () => {
    expect(normalizeWorld(base)?.glow).toBeUndefined();
  });
  it("keeps and clamps provided glow bands to 0–1", () => {
    const w = normalizeWorld({ ...base, glow: { atmosphere: 0.5, header: 2, footer: -1 } });
    expect(w?.glow).toEqual({ atmosphere: 0.5, header: 1, footer: 0 });
  });
  it("ignores non-numeric glow bands", () => {
    const w = normalizeWorld({ ...base, glow: { atmosphere: "bright", middle: 0.3 } });
    expect(w?.glow).toEqual({ middle: 0.3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — glow"`
Expected: FAIL — `glow` not handled.

- [ ] **Step 3: Add the glow logic** in `normalizeWorld`, before `return world;`:

```ts
  if (o.glow && typeof o.glow === "object") {
    const g = o.glow as Record<string, unknown>;
    const glow: NonNullable<World["glow"]> = {};
    for (const band of ["atmosphere", "header", "middle", "footer"] as const) {
      if (typeof g[band] === "number" && Number.isFinite(g[band])) {
        glow[band] = clampNum(g[band], 0, 1, 0);
      }
    }
    if (Object.keys(glow).length > 0) world.glow = glow;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — glow"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): normalizeWorld clamps per-band glow to 0-1"
```

---

## Task 6: `images` — validate string R2 keys per band

**Files:**
- Modify: `src/daily-core.ts`
- Test: `test/daily-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("normalizeWorld — images", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("omits images when absent", () => {
    expect(normalizeWorld(base)?.images).toBeUndefined();
  });
  it("keeps only string band keys", () => {
    const w = normalizeWorld({ ...base, images: { header: "d/h.jpg", middle: 5, footer: "d/f.jpg" } });
    expect(w?.images).toEqual({ header: "d/h.jpg", footer: "d/f.jpg" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — images"`
Expected: FAIL — `images` not handled.

- [ ] **Step 3: Add the images logic** in `normalizeWorld`, before `return world;`:

```ts
  if (o.images && typeof o.images === "object") {
    const im = o.images as Record<string, unknown>;
    const images: NonNullable<World["images"]> = {};
    for (const band of ["header", "middle", "footer"] as const) {
      if (typeof im[band] === "string" && im[band]) images[band] = im[band] as string;
    }
    if (Object.keys(images).length > 0) world.images = images;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — images"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): normalizeWorld validates per-band image keys"
```

---

## Task 7: `playlist` — validate keys[] + autoplayOnEntry

**Files:**
- Modify: `src/daily-core.ts`
- Test: `test/daily-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("normalizeWorld — playlist", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("omits playlist when absent", () => {
    expect(normalizeWorld(base)?.playlist).toBeUndefined();
  });
  it("keeps string keys and the autoplay flag", () => {
    const w = normalizeWorld({ ...base, playlist: { keys: ["a.mp3", 3, "b.mp3"], autoplayOnEntry: true } });
    expect(w?.playlist).toEqual({ keys: ["a.mp3", "b.mp3"], autoplayOnEntry: true });
  });
  it("defaults autoplayOnEntry to false and drops an empty playlist", () => {
    expect(normalizeWorld({ ...base, playlist: { keys: ["a.mp3"] } })?.playlist)
      .toEqual({ keys: ["a.mp3"], autoplayOnEntry: false });
    expect(normalizeWorld({ ...base, playlist: { keys: [] } })?.playlist).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — playlist"`
Expected: FAIL — `playlist` not handled.

- [ ] **Step 3: Add the playlist logic** in `normalizeWorld`, before `return world;`:

```ts
  if (o.playlist && typeof o.playlist === "object") {
    const pl = o.playlist as Record<string, unknown>;
    const keys = Array.isArray(pl.keys) ? pl.keys.filter((k): k is string => typeof k === "string" && !!k) : [];
    if (keys.length > 0) {
      world.playlist = { keys, autoplayOnEntry: pl.autoplayOnEntry === true };
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — playlist"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): normalizeWorld validates playlist keys + autoplay flag"
```

---

## Task 8: `vibeTitle` — validate string

**Files:**
- Modify: `src/daily-core.ts`
- Test: `test/daily-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("normalizeWorld — vibeTitle", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("omits vibeTitle when absent", () => {
    expect(normalizeWorld(base)?.vibeTitle).toBeUndefined();
  });
  it("keeps a string vibeTitle, ignores non-strings", () => {
    expect(normalizeWorld({ ...base, vibeTitle: "Embers" })?.vibeTitle).toBe("Embers");
    expect(normalizeWorld({ ...base, vibeTitle: 42 })?.vibeTitle).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — vibeTitle"`
Expected: FAIL — `vibeTitle` not handled.

- [ ] **Step 3: Add the vibeTitle logic** in `normalizeWorld`, before `return world;`:

```ts
  if (typeof o.vibeTitle === "string" && o.vibeTitle) world.vibeTitle = o.vibeTitle;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — vibeTitle"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): normalizeWorld accepts vibeTitle"
```

---

## Task 9: Back-compat — an old World normalizes unchanged

**Files:**
- Modify: `test/daily-core.test.ts`
- (no `src` change — this is the safety assertion that the migration is non-breaking)

- [ ] **Step 1: Write the test** (it should already pass once defaults are correct — a regression guard)

```ts
describe("normalizeWorld — back-compat", () => {
  it("normalizes a pre-vibe World without adding visual fields (only rows/invented defaults)", () => {
    const old = {
      date: "2026-05-31", word: "EMBER", edition: "yang", voice: "yang",
      story: { title: "Why EMBER?", body: "warmth" }, createdAt: 1,
    };
    const w = normalizeWorld(old)!;
    expect(w.colorScheme).toBeUndefined();
    expect(w.glow).toBeUndefined();
    expect(w.images).toBeUndefined();
    expect(w.playlist).toBeUndefined();
    expect(w.vibeTitle).toBeUndefined();
    // The only defaults a legacy World gains are the non-visual rows + invented flag:
    expect(w.rows).toBe(6);
    expect(w.invented).toBe(false);
    // Existing fields untouched:
    expect(w.word).toBe("EMBER");
    expect(w.edition).toBe("yang");
    expect(w.story.title).toBe("Why EMBER?");
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run test/daily-core.test.ts -t "normalizeWorld — back-compat"`
Expected: PASS (proves the migration is non-breaking).

- [ ] **Step 3: Commit**

```bash
git add test/daily-core.test.ts
git commit -m "test(daily): back-compat guard — legacy World normalizes non-destructively"
```

---

## Task 10: Full verification + ship

**Files:** none

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all test files pass; `tsc --noEmit` exits 0.

- [ ] **Step 2: Ship**

Run: `bash dev/ship.sh`
Expected: tests → rebase onto `origin/main` → backup tag → fast-forward main → `wrangler deploy` → release tag `prod-<N>`. If main was pushed by another tab, re-run `dev/ship.sh`.

- [ ] **Step 3: Confirm the deploy** — the schedule endpoint now accepts enriched Worlds. Smoke (admin token required), optional:

```bash
# replace TOKEN; schedules an enriched future day, then reads it back
curl -s -X POST https://wordul.com/daily/schedule \
  -H "Authorization: Bearer $DAILY_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"date":"2099-01-01","word":"QUARTZ","invented":false,"rows":7,"colorScheme":{"a1":"#f0c14b","a2":"#6f9e7a","a3":"#0b0a0c"},"story":{"title":"t","body":"b"}}'
```
Expected: 200 + the normalized World echoing `rows:7` and the `colorScheme`. (Nothing visual changes yet — Increment 2 renders these.)

---

## Self-Review (run against the spec)

**Spec coverage (data-model section, spec lines 111–135):** `vibeTitle` ✓(T8) `rows` ✓(T2) `invented` ✓(T3) `colorScheme` ✓(T4) `glow` ✓(T5) `images` ✓(T6) `playlist` ✓(T7); `normalizeWorld` defaults+back-compat ✓(T2/T9); invented-word dictionary relaxation + length 4–12 ✓(T3); clamping ✓(T2/T5/T4). **Deferred (documented):** `roomConfig`/`lineAudio` → Increment 4 (needs server-side sanitizer); curator scheduling → Increment 5; `colorScheme` default-from-edition → intentionally omit (edition palette lives in `public/`).

**Placeholder scan:** none — every code step shows real code; every run step shows the command + expected result.

**Type consistency:** helper names `clampNum`/`isColor` used consistently; field names match the `World` interface added in Task 1 (`colorScheme.a1/a2/a3`, `glow.atmosphere/header/middle/footer`, `playlist.keys/autoplayOnEntry`). `invented` is set unconditionally (default `false`), matching the back-compat assertion in T9.

---

## Roadmap — the remaining increments (each its own plan + ship)

These are **not** detailed here; each becomes its own `writing-plans` doc + `dev/ship.sh` when its turn comes. Listed so the sequence and each increment's blocking open-items are visible.

2. **Theme-driven day page** — `renderDailyUnlock` (`public/app.js`) + `.daily-unlock` consume `colorScheme` (→ `--a1/--a2/--a3` + `--accent`), `rows`, `images`+per-band `glow`, long `story.body`, `playlist` autoplay. *Defaults-on-read* for legacy Worlds. (Lane 0 already removed the hardcoded purple; this makes the page *consume* curated colors.) **Open:** exact CSS-var contract (does `colorScheme` drive `--accent` or a new `--a1`?).
3. **Studio shell + Word/size + Palette** — the Stage WYSIWYG surface (`public/vibe-studio.js` + route), admin-gated; the cheap high-signal core (title, word/size with live reflow + real/invented badge, 3-swatch palette + Random harmony re-lighting live). Glass Aurora, zero pills.
4. **Voice editor over `roomConfig`** — **first builds the server-side `sanitizeRoomConfig` + `roomConfig` field** (the deferred piece), then the voice UI (picker, core+advanced curse tiers, `speechSynthesis` TTS, per-line audio, frequency). **Open:** port keystone sanitizer to `src/`.
5. **Images & glow + MP3 player** — R2 upload path (signed PUT vs worker proxy), the seekable MP3 player (consider a reusable GoldenBlock). **Open:** R2 bucket/key convention; GoldenBlock reuse.
6. **Role-scoped scheduling** — curator assignment record (`date → {curator, token}`) on the DAILY DO + **server-enforced** date-pin; admin date-picker. **Open:** assignment storage shape + admin assign action.
7. **Mobile pass** — bottom sheets, hidden keyboard-capture input, scroll-aware top schedule bar, CSS-derived responsive board.
8. **AI / clone / Suno / hidden-gift seams** — visible optional ghosts wired to stubs, honoring the failure contract (manual work never blocked/overwritten). **Open:** define or drop "B.E.O." before any celebration UI ships.
