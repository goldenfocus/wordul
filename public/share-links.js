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
