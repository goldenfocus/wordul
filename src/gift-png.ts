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
