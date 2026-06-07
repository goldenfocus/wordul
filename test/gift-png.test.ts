import { describe, it, expect } from "vitest";
import { encodePng, renderGiftPng, GIFT_W, GIFT_H } from "../src/gift-png.ts";

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
