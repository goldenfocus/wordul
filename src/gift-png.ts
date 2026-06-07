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
