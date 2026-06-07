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
