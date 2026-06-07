// public/share-links.js — the ONE place that decides which link a share gesture
// hands out. Challenge views (game.slug === null) and seeded arena rooms both share
// their /c/<id> challenge link; a plain room shares its /@owner/slug. Pure +
// unit-tested because the old inline fallbacks minted "/@papa/null" links.
export function shareTargetUrl({ origin, challengeId, shareChallengeId, owner, slug }) {
  const cid = challengeId || shareChallengeId || null;
  if (cid) return `${origin}/c/${cid}`;
  if (owner && slug) return `${origin}/@${owner}/${slug}`;
  return `${origin}/`; // never a "null" path segment — degrade to home
}

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
