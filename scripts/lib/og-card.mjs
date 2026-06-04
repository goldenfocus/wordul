// scripts/lib/og-card.mjs — pure: a 1200×630 branded OG card SVG for one word.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function ogCardSvg(word, def) {
  const W = word.toUpperCase();
  const tileW = 150, gap = 16, total = W.length * tileW + (W.length - 1) * gap;
  const startX = (1200 - total) / 2;
  const tiles = W.split("").map((c, idx) => {
    const x = startX + idx * (tileW + gap);
    return `<g><rect x="${x}" y="170" width="${tileW}" height="${tileW}" rx="12" fill="#9d8bff"/>` +
      `<text x="${x + tileW / 2}" y="${170 + tileW / 2 + 28}" text-anchor="middle" ` +
      `font-family="Arial, sans-serif" font-size="84" font-weight="800" fill="#fff">${esc(c)}</text></g>`;
  }).join("");
  const tagline = esc((def || "").slice(0, 90));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#15101f"/>
  ${tiles}
  <text x="600" y="430" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" fill="#bdb6c9">${tagline}</text>
  <text x="600" y="560" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#f0c14b">wordul.com</text>
</svg>`;
}
