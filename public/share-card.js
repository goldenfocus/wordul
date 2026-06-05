// public/share-card.js — the shareable result card. Two parts: a PURE model
// (unit-tested, provably free of the answer word) and a canvas renderer that draws
// only from that model. The answer is NEVER in the model → never on the image.

const PHRASES = [
  "Free. No ads. Just the word.",
  "Your move.",
  "Come wordul with us.",
];

// Deterministic phrase from a seed so the same card is stable on re-render
// (no Math.random in the model — keeps it testable).
function pickPhrase(seed) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PHRASES[h % PHRASES.length];
}

export function buildShareCardModel({ username, guesses, won, score, challengeUrl }) {
  return {
    name: `@${username}`,
    grid: guesses.map((g) => g.mask.slice()), // colors only — no letters, no word
    won: !!won,
    score,
    phrase: pickPhrase(`${username}:${score}`),
    cta: challengeUrl,
  };
}

const BRAND = { bg: "#15101f", gold: "#f0c14b", violet: "#7c5cff", accent: "#9d8bff", fg: "#f7f1e3", muted: "#bdb6c9" };
// Correct (in-position) tiles use the brand ultraviolet — the live game's --hot —
// NOT NYT Wordle green. warm = brand gold-ish, cold = brand neutral.
const TILE = { hot: "#9d8bff", warm: "#c9a227", cold: "#2a2533" };

export function renderShareCard(model, cols) {
  const dpr = 2, W = 560, P = 40, gap = 8;
  const tile = Math.min(48, Math.floor((W - 2 * P - (cols - 1) * gap) / cols));
  const gridW = cols * tile + (cols - 1) * gap;
  const gridX = (W - gridW) / 2;
  const rows = model.grid.length;
  const gridH = rows > 0 ? rows * tile + (rows - 1) * gap : 0;
  const H = P + 38 + 20 + 40 + 24 + gridH + 24 + 28 + 64 + P;

  const canvas = document.createElement("canvas");
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = BRAND.bg; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  let cy = P;

  ctx.font = `800 30px ${FONT}`; ctx.fillStyle = BRAND.gold;
  ctx.fillText("WORDUL", W / 2, cy + 19); cy += 38 + 20;

  ctx.font = `800 32px ${FONT}`; ctx.fillStyle = model.won ? TILE.hot : BRAND.muted;
  ctx.fillText(`${model.name} · ${model.score}`, W / 2, cy + 20);
  cy += 40 + 24;

  let gy = cy;
  for (const maskRow of model.grid) {
    for (let c = 0; c < cols; c++) {
      const x = gridX + c * (tile + gap);
      roundRectSC(ctx, x, gy, tile, tile, 6);
      ctx.fillStyle = TILE[maskRow[c]] || "#2a2533"; ctx.fill();
    }
    gy += tile + gap;
  }
  cy += gridH + 24;

  ctx.font = `600 20px ${FONT}`; ctx.fillStyle = BRAND.fg;
  ctx.fillText(model.phrase, W / 2, cy + 14); cy += 28;

  roundRectSC(ctx, P, cy, W - 2 * P, 64, 12);
  ctx.fillStyle = BRAND.violet; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = `800 22px ${FONT}`;
  ctx.fillText("Beat my score →", W / 2, cy + 22);
  ctx.font = `600 18px ${FONT}`; ctx.fillText(model.cta, W / 2, cy + 46);

  return canvas;
}

function roundRectSC(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
