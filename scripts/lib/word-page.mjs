// scripts/lib/word-page.mjs — pure: render one answer word's full static wiki page.
// No I/O. Crawlers/AI get the complete content with no JS; word-page.js only hydrates
// the live-stats panel later.
const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const tiles = (word) =>
  `<div class="wp-tiles" aria-hidden="true">` +
  word.split("").map((c) => `<span class="wp-tile">${esc(c)}</span>`).join("") +
  `</div>`;

const links = (words) =>
  words.map((w) => `<a href="/word/${w.toLowerCase()}">${esc(w)}</a>`).join("");

export function renderWordPage(word, intel, graph, origin) {
  const W = word.toUpperCase();
  const slug = word.toLowerCase();
  const canonical = `${origin}/word/${slug}`;
  const ogImg = `${origin}/word/og/${slug}.png`;
  const i = intel || {};
  const g = graph || { anagrams: [], ladder: [], sharedStart: [] };
  const title = `What does "${W}" mean? — definition, facts & word game`;
  const desc = (i.def || `Definition, facts and word play for ${W}.`).slice(0, 155);

  // Up to 5 Q&As — each entry only included when its source field exists.
  const faqCandidates = [
    i.def && { q: `What does ${W} mean?`, a: i.def },
    { q: `Is ${W} a valid word?`, a: `Yes — ${W} is one of the answer words in Wordul, the daily word game.` },
    { q: `How many letters is ${W}?`, a: `${W} has ${W.length} letters and ${i.syllables ? `${i.syllables} syllable${i.syllables === 1 ? "" : "s"}` : "is a common English word"}.` },
    i.etymology && { q: `Where does ${W} come from?`, a: i.etymology },
    i.lesson && { q: `What can ${W} teach us?`, a: i.lesson },
  ];
  const faq = faqCandidates.filter(Boolean);

  const graphNodes = [
    { "@type": "DefinedTerm", "@id": "#term", name: W, description: i.def || "", inDefinedTermSet: `${origin}/words` },
    { "@type": "WebPage", name: title, url: canonical, primaryImageOfPage: { "@type": "ImageObject", url: ogImg } },
    { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];
  if (i.poem && i.poem.lines && i.poem.lines.length) {
    graphNodes.push({
      "@type": "CreativeWork",
      genre: "Poetry",
      name: `${W} — a little poem`,
      text: i.poem.lines.join("\n"),
      creator: { "@type": "Organization", name: "Wordul" },
      about: { "@id": "#term" },
    });
  }
  if (i.quote) {
    graphNodes.push({
      "@type": "Quotation",
      text: i.quote,
      ...(i.author ? { creator: { "@type": "Person", name: i.author } } : {}),
    });
  }

  const jsonld = {
    "@context": "https://schema.org",
    "@graph": graphNodes,
  };

  // Pronunciation appended to the .wp-meta line.
  const metaParts = [
    i.pos ? esc(i.pos) : "",
    i.syllables ? ` · ${i.syllables} syllable${i.syllables === 1 ? "" : "s"}` : "",
    i.ipa ? ` · ${esc(i.ipa)}` : "",
  ];

  const sensesBlock =
    i.senses && i.senses.length
      ? `<section class="wp-senses"><h2>Meanings</h2><ol>${i.senses
          .map(
            (s) =>
              `<li>${esc(s.gloss || "")}` +
              (s.example ? ` <em>${esc(s.example)}</em>` : "") +
              (s.register ? ` <span class="wp-register">${esc(s.register)}</span>` : "") +
              `</li>`,
          )
          .join("")}</ol></section>`
      : "";

  const factsBlock =
    i.facts && i.facts.length
      ? `<section class="wp-fact"><h2>Did you know?</h2><ul>${i.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></section>`
      : i.fact
        ? `<section class="wp-fact"><h2>Did you know?</h2><p>${esc(i.fact)}</p></section>`
        : "";

  const quoteBlock = i.quote
    ? `<blockquote class="wp-quote">"${esc(i.quote)}"${i.author ? `<cite>— ${esc(i.author)}</cite>` : ""}</blockquote>`
    : "";
  const etymBlock = i.etymology ? `<section class="wp-etym"><h2>Word origin</h2><p>${esc(i.etymology)}</p></section>` : "";

  const mnemonicBlock = i.mnemonic
    ? `<section class="wp-mnemonic"><h2>Remember it</h2><p>${esc(i.mnemonic)}</p></section>`
    : "";

  const poemBlock =
    i.poem && i.poem.lines && i.poem.lines.length
      ? `<section class="wp-poem"><h2>A little poem</h2><p class="wp-poem-body">${i.poem.lines
          .map((l) => esc(l))
          .join("<br>")}</p>${i.poem.form ? `<p class="wp-poem-form">${esc(i.poem.form)}</p>` : ""}</section>`
      : "";

  const jokesBlock =
    i.jokes && i.jokes.length
      ? `<section class="wp-jokes"><h2>Wordplay</h2><ul>${i.jokes
          .map((j) => `<li>${esc(j.text || "")}</li>`)
          .join("")}</ul></section>`
      : "";

  const lessonBlock = i.lesson
    ? `<section class="wp-lesson"><h2>What it teaches</h2><p>${esc(i.lesson)}</p></section>`
    : "";

  const relBlock = (label, words) =>
    words && words.length ? `<div class="wp-rel"><h3>${esc(label)}</h3><p>${links(words)}</p></div>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImg)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/word-page.css">
<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>
</head>
<body class="wp">
<header class="wp-head"><a class="wp-home" href="/">Wordul</a> · <a href="/words">all words</a></header>
<main class="wp-main" data-word="${esc(W)}">
  <article>
    ${tiles(W)}
    <p class="wp-meta">${metaParts.join("")}</p>
    <h1>${esc(W)}</h1>
    <section class="wp-def"><h2>What does &quot;${esc(W)}&quot; mean?</h2><p>${esc(i.def || "")}</p></section>
    ${sensesBlock}
    ${factsBlock}
    ${quoteBlock}
    ${etymBlock}
    ${mnemonicBlock}
    ${poemBlock}
    ${jokesBlock}
    ${lessonBlock}
    <section class="wp-faq"><h2>Quick facts</h2>${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>
    <section class="wp-related"><h2>Related words</h2>
      ${relBlock("Anagrams", g.anagrams)}
      ${relBlock("Change one letter", g.ladder)}
      ${relBlock("Same start", g.sharedStart)}
    </section>
    <section class="wp-stats" data-word="${esc(W)}"><h2>How players do</h2><p class="wp-stats-body">Be the first to solve it.</p></section>
    <p class="wp-cta"><a class="wp-play" href="/">Play today's Wordul →</a></p>
  </article>
</main>
<script src="/word-page.js" defer></script>
</body>
</html>`;
}
