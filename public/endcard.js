// public/endcard.js — end-game word card helpers (kept out of app.js so they're testable).

// The OG tile art shows the word (letter tiles) and the definition (tagline), so once
// the art has LOADED the duplicate text under it hides. Text is the default: hiding it
// at wire time left the panel blank for the whole download on a slow connection (the
// empty THE WORD bug, Jun 5) — `error` never fires for an image that's merely slow.
// If the art can't load — offline, missing PNG, or a fallback word with no card — the
// art is removed and the text returns. The card can never end up showing neither.
export function wireCardArt(preview, textEls) {
  const hide = () => { for (const el of textEls) el.classList.add("ewc-text-fallback"); };
  const show = () => { for (const el of textEls) el.classList.remove("ewc-text-fallback"); };
  if (preview.complete && preview.naturalWidth > 0) hide(); // cached: load already fired
  else preview.addEventListener("load", hide);
  preview.addEventListener("error", () => {
    preview.remove();
    show();
  });
}

// "Look it up" hand-off to Google AI Mode (udm=50) — used when the dictionary has no
// entry, so the link never dead-ends on a missing /word/<w> page. The prompt MUST stay
// in sync with the wiki's "Continue with AI ✦" CTA in scripts/lib/word-page.mjs.
export function aiLookupHref(word) {
  const W = word.toUpperCase();
  const prompt = `Tell me something surprising about the word "${W}" — where it comes from, how its meaning has shifted over the centuries, and a cool way it's used today.`;
  return `https://www.google.com/search?udm=50&q=${encodeURIComponent(prompt)}`;
}
