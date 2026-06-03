// public/feed.js — pure view-models for the in-app Living Lab reader. Takes the
// FeedPost shapes the worker already serves (/feed.json, /feed/<date>.json) and
// derives blog-style cards + a per-day post view. No DOM, no fetch — so it unit-
// tests like daily-stats.js. The findings/notes text is authored plain English on
// the server; we only select and arrange it here.

// Intro rule, shared by the stream card and the full post: an admin editorial
// intro wins; otherwise compose a lead from the first one or two finding sentences.
function introFor(post) {
  const ed = post && post.editorial && post.editorial.intro;
  if (typeof ed === "string" && ed.length > 0) return ed;
  const findings = (post && post.findings) || [];
  return findings.slice(0, 2).map((f) => f.text).join(" ");
}

/** /feed.json → { empty, cards:[{ date, title, intro, pillars }] } (newest first, as served). */
export function computeFeedStreamView(feed) {
  const posts = (feed && Array.isArray(feed.posts)) ? feed.posts : [];
  const cards = posts.map((p) => ({
    date: p.date,
    title: p.headline || "",
    intro: introFor(p),
    pillars: p.pillars || [],
  }));
  return { empty: cards.length === 0, cards };
}

/** A single FeedPost → { title, intro, findings:string[], notes, pillars }. */
export function computeFeedPostView(post) {
  return {
    title: (post && post.headline) || "",
    intro: introFor(post),
    findings: ((post && post.findings) || []).map((f) => f.text),
    notes: (post && post.brainNotes) || [],
    pillars: (post && post.pillars) || [],
  };
}
