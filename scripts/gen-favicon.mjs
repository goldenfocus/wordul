// scripts/gen-favicon.mjs — render public/favicon.svg → public/favicon.ico.
// favicon.svg is the single source of truth; browsers/crawlers that never read a
// <link rel="icon"> (and the wiki pages, which don't emit one) fall back to the
// default /favicon.ico path — this fills it. Re-run after editing the SVG:
//   node scripts/gen-favicon.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const svg = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
const sizes = [16, 32, 48];
const pngs = sizes.map((s) => new Resvg(svg, { fitTo: { mode: "width", value: s } }).render().asPng());

// ICO container with PNG-compressed entries (valid in every modern browser).
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // image type: icon
header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const entries = pngs.map((png, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(sizes[i], 0); // width  (0 would mean 256)
  e.writeUInt8(sizes[i], 1); // height
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});
writeFileSync(new URL("../public/favicon.ico", import.meta.url), Buffer.concat([header, ...entries, ...pngs]));
console.log(`wrote public/favicon.ico (${sizes.join("+")}px, ${offset} bytes)`);
