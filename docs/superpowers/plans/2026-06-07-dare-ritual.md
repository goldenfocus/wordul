# Dare Ritual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean post-game stage (hide speaker/hacklog/header icons during the daily finish ritual), a one-word golden ◆ DARE ◆ CTA between the board and the golden word card, and a spoiler-free per-player gift OG image on the shared daily link.

**Architecture:** Client: a `body.daily-ritual` class (toggled in `renderDailyUnlock`) CSS-hides non-ritual chrome; the existing `#dailyShareBtn` moves to the top of `#dailyUnlock` and is relabeled; `shareDailyResult` appends a colors-only `?g=<pattern>` to the share URL. Worker: a new dependency-free PNG module (`src/gift-png.ts`, CRC32 + `CompressionStream("deflate")` — no wasm, no runtime deps, keeps the repo's zero-runtime-deps property; this supersedes the spec's `workers-og` suggestion) renders the masked board at `GET /daily/og/<date>/<pattern>.png`; `injectDailyMeta` injects `og:image` + teaser meta when `?g=` is valid. Pure helpers live in `src/daily-seo.ts` (server) and `public/share-links.js` (client), both already unit-tested homes.

**Tech Stack:** Cloudflare Workers (HTMLRewriter, caches.default), vanilla JS client, vitest (node env, `test/setup.js` already handles localStorage).

**Spec:** `docs/superpowers/specs/2026-06-07-dare-ritual-design.md`
**Worktree:** `/Users/zang/wordul/.claude/worktrees/dare-ritual` (branch `dare-ritual`). All commands run from this directory.

**Two deliberate deviations from the spec (already reflected above):**
1. PNG generation uses a tiny hand-rolled encoder instead of `workers-og` — the image is only colored squares + a pixel wordmark; satori+resvg would add ~1.5MB of wasm and a font pipeline for nothing. The wordmark/date render in a 5×7 pixel font (matches the tile-grid aesthetic).
2. Share copy says "this Wordul", not "today's" — `shareDailyResult` is also used from past-day pages, where "today's" would lie.

---

### Task 1: Pure server helpers — gift pattern parsing/validation (`src/daily-seo.ts`)

**Files:**
- Modify: `src/daily-seo.ts` (append after `dailyPrevNext`, ~line 36)
- Test: `test/daily-seo.test.ts` (append a new describe block)

- [ ] **Step 1: Write the failing tests**

Append to `test/daily-seo.test.ts` (match the file's existing import style — it imports from `../src/daily-seo.ts`; extend that import with the three new names):

```ts
import { giftPatternFromSearch, dailyOgFromPathname, buildGiftMeta } from "../src/daily-seo.ts";

describe("gift pattern (dare ritual)", () => {
  it("accepts a strictly valid ?g= pattern", () => {
    expect(giftPatternFromSearch("?g=chwcc-hhhhh")).toBe("chwcc-hhhhh");
    expect(giftPatternFromSearch("?g=hhhhh")).toBe("hhhhh");
    expect(giftPatternFromSearch("?g=ccccc-ccccc-ccccc-ccccc-ccccc-hhhhh")).toBe("ccccc-ccccc-ccccc-ccccc-ccccc-hhhhh");
  });

  it("rejects malformed patterns", () => {
    for (const bad of ["", "?g=", "?g=hhhh", "?g=hhhhhh", "?g=abcde", "?g=hhhhh-", "?g=HHHHH",
      "?g=ccccc-ccccc-ccccc-ccccc-ccccc-ccccc-hhhhh", "?x=hhhhh"]) {
      expect(giftPatternFromSearch(bad)).toBe(null);
    }
  });

  it("parses /daily/og/<date>/<pattern>.png", () => {
    expect(dailyOgFromPathname("/daily/og/2026-06-07/chwcc-hhhhh.png"))
      .toEqual({ date: "2026-06-07", pattern: "chwcc-hhhhh" });
  });

  it("rejects bad og paths (date, pattern, shape)", () => {
    for (const bad of [
      "/daily/og/2026-13-07/hhhhh.png",      // not a real date
      "/daily/og/2026-06-07/hhhh.png",        // 4-cell row
      "/daily/og/2026-06-07/abcde.png",       // wrong alphabet
      "/daily/og/2026-06-07/hhhhh",           // no .png
      "/daily/og/hhhhh.png",                  // no date
    ]) expect(dailyOgFromPathname(bad)).toBe(null);
  });

  it("buildGiftMeta derives the solved count only from an all-hot last row", () => {
    expect(buildGiftMeta("ccccc-hhhhh").description).toContain("Solved in 2");
    expect(buildGiftMeta("ccccc-chwcc").description).not.toContain("Solved");
    expect(buildGiftMeta("hhhhh").title).toBe("You've been dared — Wordul of the Day");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/daily-seo.test.ts`
Expected: FAIL — `giftPatternFromSearch` is not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/daily-seo.ts` after `dailyPrevNext`:

```ts
/* ——— Dare-ritual gift link (spec 2026-06-07-dare-ritual) ——— */

// Colors-only board mask: 1–6 rows of 5 cells, each h(ot)/w(arm)/c(old).
// By construction this alphabet can never carry a letter of the answer.
const GIFT_PATTERN_RE = /^[hwc]{5}(-[hwc]{5}){0,5}$/;

/** `?g=<pattern>` from a URL search string; null unless strictly valid. */
export function giftPatternFromSearch(search: string): string | null {
  const g = new URLSearchParams(search ?? "").get("g");
  return g && GIFT_PATTERN_RE.test(g) ? g : null;
}

/** /daily/og/<date>/<pattern>.png → { date, pattern }; anything else → null. */
export function dailyOgFromPathname(pathname: string): { date: string; pattern: string } | null {
  const m = /^\/daily\/og\/(\d{4}-\d{2}-\d{2})\/([hwc-]{5,35})\.png$/.exec(pathname ?? "");
  if (!m || !isValidDateString(m[1]) || !GIFT_PATTERN_RE.test(m[2])) return null;
  return { date: m[1], pattern: m[2] };
}

/** OG teaser for a dared daily link. Spoiler-free: derived from row colors only. */
export function buildGiftMeta(pattern: string): { title: string; description: string } {
  const rows = pattern.split("-");
  const solved = rows[rows.length - 1] === "hhhhh" ? rows.length : null;
  return {
    title: "You've been dared — Wordul of the Day",
    description: solved
      ? `Solved in ${solved}. One word, the whole world — your turn.`
      : "One word, the whole world — your turn.",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/daily-seo.test.ts`
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/daily-seo.ts test/daily-seo.test.ts
git commit -m "feat(daily): gift-pattern helpers — ?g= validation, og path parse, teaser meta"
```

---

### Task 2: Pure client helper — `masksToGiftPattern` (`public/share-links.js`)

**Files:**
- Modify: `public/share-links.js` (append)
- Test: `test/share-links.test.js` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `test/share-links.test.js` (extend the existing import from `../public/share-links.js` with `masksToGiftPattern`):

```js
describe("masksToGiftPattern", () => {
  const W = "warm", H = "hot", C = "cold";

  it("encodes masks as h/w/c rows joined by dashes", () => {
    expect(masksToGiftPattern([[C, H, W, C, C], [H, H, H, H, H]])).toBe("chwcc-hhhhh");
  });

  it("returns null for non-standard boards (wrong row length, 0 or >6 rows)", () => {
    expect(masksToGiftPattern([])).toBe(null);
    expect(masksToGiftPattern([[H, H, H, H]])).toBe(null);              // 4-letter row
    expect(masksToGiftPattern(Array(7).fill([H, H, H, H, H]))).toBe(null);
    expect(masksToGiftPattern(null)).toBe(null);
    expect(masksToGiftPattern([[H, H, "tepid", H, H]])).toBe(null);     // unknown state
  });

  it("SPOILER GUARANTEE: output alphabet is exactly {h,w,c,-}", () => {
    const p = masksToGiftPattern([[C, C, C, C, C], [W, W, W, W, W], [H, H, H, H, H]]);
    expect(p).toMatch(/^[hwc-]+$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/share-links.test.js`
Expected: FAIL — `masksToGiftPattern` is not exported.

- [ ] **Step 3: Implement**

Append to `public/share-links.js`:

```js
/** Colors-only gift pattern from a finished run's masks ("hot"/"warm"/"cold" per
    cell) → "chwcc-hhhhh". Null unless it's a standard 5-letter, 1–6-row board —
    the worker's OG route only renders that shape. Letters never enter this
    encoding, so the share URL is spoiler-free by construction. */
export function masksToGiftPattern(masks) {
  if (!Array.isArray(masks) || masks.length < 1 || masks.length > 6) return null;
  const rows = masks.map((m) =>
    Array.isArray(m) && m.length === 5 && m.every((c) => c === "hot" || c === "warm" || c === "cold")
      ? m.map((c) => c[0]).join("")
      : null,
  );
  return rows.every(Boolean) ? rows.join("-") : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/share-links.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/share-links.js test/share-links.test.js
git commit -m "feat(share): masksToGiftPattern — colors-only board encoding for the gift link"
```

---

### Task 3: PNG encoder (`src/gift-png.ts` — encoder half)

**Files:**
- Create: `src/gift-png.ts`
- Test: `test/gift-png.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `test/gift-png.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodePng } from "../src/gift-png.ts";

/** Minimal PNG reader for OUR encoder's output: parses IHDR dims and inflates the
    single IDAT back to filter-prefixed scanlines. Uses DecompressionStream, the
    inverse of the encoder's CompressionStream — a round-trip proof. */
export async function decodePng(png: Uint8Array) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = dv.getUint32(16), height = dv.getUint32(20);
  let off = 8, idat: Uint8Array | null = null;
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    if (type === "IDAT") idat = png.subarray(off + 8, off + 8 + len);
    off += 12 + len;
  }
  const stream = new Blob([idat!]).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  return { width, height, raw };
}

/** RGB triple at (x, y) from decoded filter-prefixed scanlines. */
export function px(d: { width: number; raw: Uint8Array }, x: number, y: number): number[] {
  const o = y * (d.width * 3 + 1) + 1 + x * 3;
  return [d.raw[o], d.raw[o + 1], d.raw[o + 2]];
}

describe("encodePng", () => {
  it("round-trips a tiny RGB buffer", async () => {
    // 2×2: red, green / blue, white
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const d = await decodePng(await encodePng(2, 2, rgb));
    expect([d.width, d.height]).toEqual([2, 2]);
    expect(px(d, 0, 0)).toEqual([255, 0, 0]);
    expect(px(d, 1, 0)).toEqual([0, 255, 0]);
    expect(px(d, 0, 1)).toEqual([0, 0, 255]);
    expect(px(d, 1, 1)).toEqual([255, 255, 255]);
  });

  it("rejects a mis-sized buffer", async () => {
    await expect(encodePng(2, 2, new Uint8Array(5))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/gift-png.test.ts`
Expected: FAIL — module `../src/gift-png.ts` not found.

- [ ] **Step 3: Implement the encoder**

Create `src/gift-png.ts`:

```ts
// src/gift-png.ts — the dare-ritual gift image: a dependency-free PNG writer + the
// masked-board renderer. The image is colored squares + a 5×7 pixel wordmark, so a
// ~100-line truecolor encoder beats shipping satori/resvg wasm (and keeps this
// worker's zero-runtime-deps property). IDAT compression is the platform's
// CompressionStream("deflate") — zlib-wrapped DEFLATE, exactly PNG's format.

/* ——— PNG plumbing ——— */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode a row-major RGB buffer (3 bytes/px) as a truecolor PNG. */
export async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  if (rgb.length !== width * height * 3) throw new Error("rgb buffer size mismatch");
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB (10–12 stay 0: compression/filter/interlace)
  const stride = width * 3 + 1; // +1 filter byte (None) per scanline
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * stride + 1);
  const idat = await zlibDeflate(raw);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/gift-png.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gift-png.ts test/gift-png.test.ts
git commit -m "feat(gift): dependency-free truecolor PNG encoder (CRC32 + CompressionStream)"
```

---

### Task 4: Gift board renderer (`src/gift-png.ts` — renderer half)

**Files:**
- Modify: `src/gift-png.ts` (append)
- Test: `test/gift-png.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/gift-png.test.ts` (the `decodePng`/`px` helpers from Task 3 are in this same file; extend the import with `renderGiftPng, GIFT_W, GIFT_H`):

```ts
describe("renderGiftPng", () => {
  it("renders 1200×630 with correct tile colors and letters nowhere", async () => {
    const d = await decodePng(await renderGiftPng("2026-06-07", "chwcc-hhhhh"));
    expect([d.width, d.height]).toEqual([GIFT_W, GIFT_H]);
    // Geometry (mirrors the renderer's constants): TILE=72 GAP=10, board centered,
    // 64px reserved under the board for the wordmark strip.
    // rows=2 → boardH = 2*72+10 = 154; y0 = (630-154-64)/2 = 206; x0 = (1200-400)/2 = 400.
    const bg = px(d, 10, 10);
    expect(bg).toEqual([14, 14, 16]); // --bg #0e0e10
    const cold = px(d, 400 + 36, 206 + 36);       // row 0 col 0 = 'c' (center)
    expect(cold).toEqual([13, 13, 15]);           // #0d0d0f fill
    const hot = px(d, 400 + 36, 206 + 82 + 36);   // row 1 col 0 = 'h' (center)
    expect(hot[0]).toBeGreaterThan(180);          // gold gradient midpoint ≈ [211,176,97]
    expect(hot[1]).toBeGreaterThan(140);
    expect(hot[2]).toBeLessThan(130);
    const warmEdge = px(d, 400 + 2 * 82, 206 + 1); // row 0 col 2 = 'w', top edge strip
    expect(warmEdge).toEqual([216, 201, 122]);     // #d8c97a border
  });

  it("rejects an invalid pattern even if a caller skips route validation", async () => {
    await expect(renderGiftPng("2026-06-07", "abcde")).rejects.toThrow();
    await expect(renderGiftPng("2026-06-07", "hhhh")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/gift-png.test.ts`
Expected: FAIL — `renderGiftPng` is not exported.

- [ ] **Step 3: Implement the renderer**

Append to `src/gift-png.ts`:

```ts
/* ——— The gift board ——— */

type RGB = [number, number, number];
// Colors mirror the Default edition (style.css :root + [data-edition="default"]).
const BG: RGB = [14, 14, 16];          // --bg #0e0e10
const GOLD_HI: RGB = [255, 231, 163];  // hot-tile gradient start #ffe7a3
const GOLD_LO: RGB = [168, 122, 31];   //                    end #a87a1f
const GOLD: RGB = [233, 178, 61];      // wordmark #e9b23d
const WARM_EDGE: RGB = [216, 201, 122]; // #d8c97a
const WARM_FILL: RGB = [26, 25, 22];    // rgba(216,201,122,.06) composited on --bg
const COLD_FILL: RGB = [13, 13, 15];    // #0d0d0f
const COLD_EDGE: RGB = [31, 31, 35];    // #1f1f23
const MUTED: RGB = [138, 138, 143];     // --muted #8a8a8f

class Raster {
  data: Uint8Array;
  constructor(public w: number, public h: number, bg: RGB) {
    this.data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.data.set(bg, i * 3);
  }
  fillRect(x: number, y: number, w: number, h: number, c: RGB) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) this.data.set(c, (yy * this.w + xx) * 3);
  }
  /** Diagonal two-stop gradient — the precious-gold tile. */
  fillGradient(x: number, y: number, w: number, h: number, from: RGB, to: RGB) {
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const t = (xx + yy) / (w + h - 2);
        const o = ((y + yy) * this.w + (x + xx)) * 3;
        for (let i = 0; i < 3; i++) this.data[o + i] = Math.round(from[i] + (to[i] - from[i]) * t);
      }
  }
}

// 5×7 pixel font — only the glyphs the gift needs (WORDUL. + date digits).
// Squares-on-squares: the wordmark deliberately speaks the board's own language.
const FONT: Record<string, string[]> = {
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  ".": [".....", ".....", ".....", ".....", ".....", "..##.", "..##."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "####.", "#...#", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "#...#", ".###."],
};

function drawText(r: Raster, text: string, centerX: number, y: number, scale: number, color: RGB) {
  const adv = 6 * scale; // 5 glyph columns + 1 gap
  let x = Math.round(centerX - (text.length * adv - scale) / 2);
  for (const ch of text) {
    const glyph = FONT[ch];
    if (glyph)
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < 5; gx++)
          if (glyph[gy][gx] === "#") r.fillRect(x + gx * scale, y + gy * scale, scale, scale, color);
    x += adv;
  }
}

export const GIFT_W = 1200;
export const GIFT_H = 630;
const TILE = 72;
const GAP = 10;

/** The gift: the sharer's board, letters hidden — only h/w/c colors ever reach
    this function, so the answer cannot appear in the image by construction.
    Route-level validation is repeated here to keep direct callers honest. */
export async function renderGiftPng(date: string, pattern: string): Promise<Uint8Array> {
  if (!/^[hwc]{5}(-[hwc]{5}){0,5}$/.test(pattern)) throw new Error("bad gift pattern");
  const rows = pattern.split("-");
  const r = new Raster(GIFT_W, GIFT_H, BG);
  const boardW = 5 * TILE + 4 * GAP;
  const boardH = rows.length * TILE + (rows.length - 1) * GAP;
  const x0 = Math.round((GIFT_W - boardW) / 2);
  const y0 = Math.round((GIFT_H - boardH - 64) / 2); // 64px strip below for the wordmark
  rows.forEach((row, ri) => {
    for (let ci = 0; ci < 5; ci++) {
      const x = x0 + ci * (TILE + GAP);
      const y = y0 + ri * (TILE + GAP);
      if (row[ci] === "h") r.fillGradient(x, y, TILE, TILE, GOLD_HI, GOLD_LO);
      else {
        const [edge, fill] = row[ci] === "w" ? [WARM_EDGE, WARM_FILL] : [COLD_EDGE, COLD_FILL];
        r.fillRect(x, y, TILE, TILE, edge);
        r.fillRect(x + 2, y + 2, TILE - 4, TILE - 4, fill);
      }
    }
  });
  drawText(r, "WORDUL.", GIFT_W / 2, y0 + boardH + 28, 4, GOLD);
  drawText(r, date, GIFT_W / 2, y0 + boardH + 28 + 36, 2, MUTED);
  return encodePng(GIFT_W, GIFT_H, r.data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/gift-png.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gift-png.ts test/gift-png.test.ts
git commit -m "feat(gift): masked-board renderer — golden tiles, pixel wordmark, spoiler-free"
```

---

### Task 5: Worker wiring — OG route + `?g=` meta injection

**Files:**
- Modify: `src/worker.ts` (import block ~line 21; route dispatch ~line 537; `injectDailyMeta` ~line 1102)
- Modify: `public/index.html:14` (og:image gains `data-meta`)

No new unit test here — the route and rewriter are thin shells over the Task 1/3/4 helpers (HTMLRewriter doesn't exist in the node test env; this repo's pattern is pure-helper tests + thin worker glue, e.g. `daily-seo.ts` itself). Verification is `npm run typecheck` + the manual QA in Task 8.

- [ ] **Step 1: Extend imports in `src/worker.ts`**

Line 21 currently reads:

```ts
import { buildDailyMeta, buildDailyJsonLd, dailyPrevNext, dailyDateFromPathname, dailySitemapUrls } from "./daily-seo.ts";
```

Replace with:

```ts
import { buildDailyMeta, buildDailyJsonLd, buildGiftMeta, dailyPrevNext, dailyDateFromPathname, dailyOgFromPathname, giftPatternFromSearch, dailySitemapUrls } from "./daily-seo.ts";
import { renderGiftPng } from "./gift-png.ts";
```

- [ ] **Step 2: Add the OG route**

In `fetch`, directly ABOVE this existing block (~line 537):

```ts
    // Dated permalink — the eternal artifact. /daily/<YYYY-MM-DD>
    const dailyDate = dailyDateFromPathname(url.pathname);
```

insert:

```ts
    // Dare-ritual gift image: /daily/og/<date>/<pattern>.png — the sharer's board,
    // letters hidden. Pattern is colors-only (validated), so the route is public,
    // spoiler-free, and immutable-cacheable: one render per board per colo.
    const ogGift = dailyOgFromPathname(url.pathname);
    if (ogGift && req.method === "GET") {
      const cached = await caches.default.match(req);
      if (cached) return cached;
      const png = await renderGiftPng(ogGift.date, ogGift.pattern);
      const res = new Response(png, {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
      });
      ctx.waitUntil(caches.default.put(req, res.clone()));
      return res;
    }
```

- [ ] **Step 3: Inject gift meta in `injectDailyMeta`**

In `injectDailyMeta` (~line 1102), the function ends with a `return new HTMLRewriter()...transform(shell);` chain. Replace that final return statement with:

```ts
  // A ?g=<pattern> link is a dare: override the teaser meta and point og:image at
  // the masked-board gift. Registered AFTER the base setters — same selector, later
  // registration runs later, so the gift values win. Canonical stays the bare
  // /daily/<date> (meta.canonical), so ?g= never fragments search indexing.
  const gift = giftPatternFromSearch(url.search);
  const giftMeta = gift ? buildGiftMeta(gift) : null;
  let rw = new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter(meta.title))
    .on('[data-meta="og:title"]', new AttrSetter("content", meta.title))
    .on('[data-meta="description"]', new AttrSetter("content", meta.description))
    .on('[data-meta="og:description"]', new AttrSetter("content", meta.description))
    .on('[data-meta="canonical"]', new AttrSetter("href", meta.canonical))
    .on('[data-meta="og:url"]', new AttrSetter("content", meta.canonical))
    .on('[data-daily-jsonld]', new RawHtmlSetter(jsonld.replace(/</g, "\\u003c")))
    .on('[data-daily-prose]', new RawHtmlSetter(prose));
  if (gift && giftMeta) {
    rw = rw
      .on('[data-meta="og:title"]', new AttrSetter("content", giftMeta.title))
      .on('[data-meta="og:description"]', new AttrSetter("content", giftMeta.description))
      .on('[data-meta="og:image"]', new AttrSetter("content", `${url.origin}/daily/og/${date}/${gift}.png`));
  }
  return rw.transform(shell);
```

(The early `!world` degraded branch stays as-is — no gift meta there; an unresolvable day already serves minimal meta.)

- [ ] **Step 4: Make og:image targetable**

`public/index.html:14` currently:

```html
<meta property="og:image" content="/og.png" />
```

Replace with:

```html
<meta property="og:image" data-meta="og:image" content="/og.png" />
```

- [ ] **Step 5: Typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: both clean (no worker test exercises these lines; typecheck proves the wiring).

- [ ] **Step 6: Commit**

```bash
git add src/worker.ts public/index.html
git commit -m "feat(worker): /daily/og gift route + ?g= og:image meta injection"
```

---

### Task 6: Client share flow — gift link + dare copy

**Files:**
- Modify: `public/app.js:19` (import), `public/app.js:399-410` (`shareDailyResult`), `public/app.js:2627` (callsite)

The pattern-building logic was tested in Task 2; `shareDailyResult` itself is untestable glue around `navigator.share` (existing style — it has no test today). Verification: `npm test` stays green + Task 8 manual QA.

- [ ] **Step 1: Extend the import**

`public/app.js:19` currently:

```js
import { shareTargetUrl } from "/share-links.js";
```

Replace with:

```js
import { shareTargetUrl, masksToGiftPattern } from "/share-links.js";
```

- [ ] **Step 2: Update `shareDailyResult`**

Replace the function at `public/app.js:399-410` (keep its existing comment block above, updating it as shown):

```js
// Challenge a friend onto this day's Wordul — a spoiler-free dare line + the day's
// link. When the run's masks are on hand, the link carries ?g=<colors-only pattern>
// so the unfurl shows the sharer's golden board, letters hidden (the worker's
// /daily/og route renders it). Native sheet, else clipboard.
// `date` pins the link to the day being shared (past-day pages); omitted → today.
function shareDailyResult(result, date) {
  const pattern = masksToGiftPattern(result?.masks);
  const url = location.origin + "/daily/" + (date || todayUTC()) + (pattern ? `?g=${pattern}` : "");
  const line = result && result.won
    ? `I got this Wordul in ${result.guesses} — I dare you.`
    : "This Wordul beat me — I dare you to avenge me.";
  if (typeof navigator.share === "function") {
    navigator.share({ title: "Wordul of the Day", text: line, url }).catch(() => {});
  } else if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(`${line} ${url}`).then(() => toast("Copied — share it anywhere")).catch(() => {});
  } else {
    toast("Sharing isn't supported on this browser");
  }
}
```

- [ ] **Step 3: Thread masks through the daily callsite**

`public/app.js:2627` currently:

```js
    share.addEventListener("click", () => shareDailyResult({ won, guesses: me.guesses.length }, game.dailyDate));
```

Replace with:

```js
    share.addEventListener("click", () => shareDailyResult({ won, guesses: me.guesses.length, masks: me.guesses.map((g) => g.mask) }, game.dailyDate));
```

(The home-page callsite at `app.js:287` passes `cbs.dailyResult` with no masks — `masksToGiftPattern` returns null there and the link degrades to today's behavior. Leave it.)

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS — no regressions (module-graph test guards imports; share-links alias already exists in vitest.config).

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(daily): share link carries the ?g= gift pattern + dare copy"
```

---

### Task 7: The stage — ◆ Dare ◆ CTA placement + ritual chrome hiding

**Files:**
- Modify: `public/index.html` (move `#dailyShareBtn`, ~lines 283 and 304)
- Modify: `public/locales/en.js:80` (relabel)
- Modify: `public/app.js` (`renderDailyUnlock` ~2555-2628, leave-room cleanup ~5253)
- Modify: `public/style.css` (new rules near the `.daily-reveal` block ~2788)

- [ ] **Step 1: Move the button in `index.html`**

(a) In the `.daily-bridge` block (~line 304), DELETE this line (the rail stays):

```html
          <button type="button" class="btn primary block daily-bridge-btn" id="dailyShareBtn"></button>
```

(b) Make the button the FIRST child of `#dailyUnlock` — directly after `<section id="dailyUnlock" class="daily-unlock" hidden>` and BEFORE the `#dailyReveal` comment block, insert:

```html
        <!-- ◆ Dare ◆ — the one-word bridge between your board and the golden card:
             a spoiler-free share of THIS day's link (+ masked-board gift unfurl).
             Filled + wired by renderDailyUnlock; aria-label carries the full verb. -->
        <button type="button" class="daily-dare" id="dailyShareBtn" aria-label="Dare — challenge a friend on this word"></button>
```

- [ ] **Step 2: Relabel in `en.js`**

`public/locales/en.js:80` currently:

```js
  "daily.challenge": "Challenge a friend",
```

Replace with (key renamed — `daily.challenge` has exactly one consumer, updated in Step 3):

```js
  "daily.dare": "◆ Dare ◆",
```

- [ ] **Step 3: Update `renderDailyUnlock` in `app.js`**

(a) Ritual class — after the line `box.hidden = !done;` (~2560), and BEFORE the `if (!done) return;`, insert:

```js
  // The ritual stage: once you're done, non-ritual chrome (mute, hacklog, header
  // chat/link) bows out via CSS — see body.daily-ritual in style.css. Toggled (not
  // added) so a not-yet-done render never leaves a stale stage class behind.
  document.body.classList.toggle("daily-ritual", done);
```

(b) Vibe title anchor — the dare button is now `box.firstChild`, so the vibe title must crown the card, not the button. The line (~2568):

```js
    box.insertBefore(h, box.firstChild);
```

becomes:

```js
    box.insertBefore(h, $("#dailyReveal")); // crown the card — the dare button stays first
```

(c) Label — the line (~2624):

```js
    share.textContent = t("daily.challenge");
```

becomes:

```js
    share.textContent = t("daily.dare");
```

- [ ] **Step 4: Drop the class on room exit**

At `public/app.js:5253`, next to the existing cleanup:

```js
  document.body.classList.remove("daily");
```

add directly below it:

```js
  document.body.classList.remove("daily-ritual");
```

- [ ] **Step 5: Add the CSS**

In `public/style.css`, directly ABOVE the `.daily-reveal { text-align: center; ...}` rule (~line 2789), insert:

```css
/* ——— The Dare ritual (spec 2026-06-07) ——— */
/* Stage cleanup: once the daily is finished (body.daily-ritual, renderDailyUnlock),
   non-ritual chrome bows out — mute, hacklog, header chat + room-link. CSS-only and
   class-gated: mid-game behavior is untouched and everything returns when the class
   drops (leave room / next day). */
body.daily-ritual #muteBtn,
body.daily-ritual #hacklog,
body.daily-ritual #chatTopBtn,
body.daily-ritual #roomLinkBtn {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease;
}

/* ◆ Dare ◆ — the one-word golden bridge between the board and the card. Speaks the
   precious-gold vocabulary of the hot tile; rises first in the unlock's child-rise. */
.daily-dare {
  display: block;
  margin: 2px auto 22px;
  padding: 13px 44px;
  background: linear-gradient(135deg, #ffe7a3, #e9b23d 55%, #a87a1f);
  color: #2a1d05;
  border: none;
  border-radius: 999px;
  font-family: ui-serif, Georgia, serif;
  font-weight: 800;
  font-size: 18px;
  letter-spacing: 0.14em;
  cursor: pointer;
  box-shadow: 0 0 0 1px rgba(255,231,163,.5), 0 0 18px rgba(233,178,61,.35);
}
.daily-dare:hover {
  box-shadow: 0 0 0 1px rgba(255,231,163,.7), 0 0 26px rgba(233,178,61,.55);
}
.daily-unlock > .daily-dare { animation-delay: 0.02s; }
```

(The existing `.daily-unlock > *` rule gives the button the same `daily-child-rise` entrance as the card; the `0.02s` delay slots it before `.daily-reveal`'s `0.10s`.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. If any DOM test references `daily.challenge` or `.daily-bridge-btn`, update it to `daily.dare` / `.daily-dare` (a `grep -rn "daily.challenge\|daily-bridge-btn" test/` should come back empty — as of planning, the only consumer was `app.js:2624`).

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/locales/en.js public/app.js public/style.css
git commit -m "feat(daily): the Dare ritual — clean stage + golden one-word CTA between board and card"
```

---

### Task 8: Preview deploy + manual QA

**Files:** none (verification only)

- [ ] **Step 1: Full local gate**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 2: Deploy to the preview lane**

(Version Preview URLs never work for this DO worker — the preview worker is the staging lane.)

Run: `npx wrangler deploy -c wrangler.preview.jsonc`
Expected: deploys to `wordul-preview.love-00b.workers.dev`.

- [ ] **Step 3: OG image smoke (curl)**

```bash
curl -s -o /tmp/gift.png -w "%{http_code} %{content_type}\n" "https://wordul-preview.love-00b.workers.dev/daily/og/2026-06-07/chwcc-hhhhh.png"
curl -s -o /dev/null -w "%{http_code}\n" "https://wordul-preview.love-00b.workers.dev/daily/og/2026-06-07/abcde.png"
curl -s "https://wordul-preview.love-00b.workers.dev/daily/2026-06-06?g=chwcc-hhhhh" | grep -o 'og:image[^>]*'
```

Expected: `200 image/png` (open /tmp/gift.png and LOOK at it — golden board, blanked letters, WORDUL. wordmark, date); `404`; the og:image meta pointing at `/daily/og/2026-06-06/chwcc-hhhhh.png`.

- [ ] **Step 4: Manual mobile pass (390px viewport, /browse skill or real phone)**

On the preview URL:
1. Play (or revisit) the daily. After the supernova settles: speaker, hacklog ▸, header 💬 and 🔗 are gone (faded); board → ◆ DARE ◆ → golden card, in that order.
2. Tap DARE → share sheet (or clipboard toast) carries "I dare you" + a `/daily/<date>?g=...` link matching your board's colors.
3. Reload the finished daily — same clean stage, dare present immediately (revisit path).
4. Open a non-daily room — speaker/hacklog/chat/link all behave normally (no ritual class).
5. Paste the `?g=` link into iMessage/Slack — unfurl shows the masked golden board.

- [ ] **Step 5: Report**

Show Yan screenshots of: the finished-daily stage (board → DARE → card) and the unfurled gift image. STOP — shipping to prod (`dev/ship.sh`) is Yan's call.

---

## Self-review notes (done at planning time)

- **Spec coverage:** §1 stage cleanup → Task 7; §2 DARE CTA → Task 7; §3 encoding/route/meta → Tasks 1-6; §4 copy → Task 6; testing section → per-task TDD + Task 8. Two documented deviations (no `workers-og`; "this Wordul" copy) are listed in the header.
- **Type consistency:** `masksToGiftPattern` (Tasks 2, 6); `giftPatternFromSearch`/`dailyOgFromPathname`/`buildGiftMeta` (Tasks 1, 5); `renderGiftPng`/`encodePng`/`GIFT_W`/`GIFT_H` (Tasks 3, 4, 5) — names match across tasks.
- **Geometry cross-check (Task 4 test):** rows=2 → boardH=154, y0=206, x0=400; tile centers at +36; row pitch 82. Wordmark fits: 6 rows → y0=42, board ends 524, wordmark 552-580, date 588-602 < 630.
