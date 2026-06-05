// public/endcard.js — end-game word card helpers (kept out of app.js so they're testable).

// The OG tile art already shows the word (letter tiles) and the definition (tagline),
// so the duplicate text under it starts hidden. If the art can't load — offline, missing
// PNG, or a fallback word with no card — the art is removed and the text returns. The
// card can never end up showing neither.
export function wireCardArt(preview, textEls) {
  for (const el of textEls) el.classList.add("ewc-text-fallback");
  preview.addEventListener("error", () => {
    preview.remove();
    for (const el of textEls) el.classList.remove("ewc-text-fallback");
  });
}
