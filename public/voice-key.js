// Stable, dependency-free hash of a companion line → clip filename stem.
// FNV-1a (32-bit). Identical output in the browser and in Node (render.mjs),
// so the same line always maps to the same pre-rendered clip.
export function lineKey(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
