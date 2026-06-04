// Editorial edition — newsprint. Ink-on-paper-dark, near-monochrome with a single
// restrained green, heavy Fraunces display + JetBrains Mono body. Square-ish tiles
// and hairline rules live in edition-scoped CSS. Companion = a dry copy editor.
export const edition = {
  id: "editorial",
  name: "Editorial",
  palette: {
    bg: "#111210", fg: "#f4f1ea", muted: "#8d887c", border: "#2a2a26",
    tileEmpty: "#111210", tilePendingBorder: "#4a4a44", keyBg: "#191a16",
    green: "#5b8c4e", yellow: "#c2a23b", gray: "#3a3b36",
    accent: "#e8e3d6", bgCard: "#191a16", error: "#c8584a",
  },
  fonts: {
    display: "'Fraunces', Georgia, serif",
    body: "'JetBrains Mono', ui-monospace, monospace",
    link: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,900&family=JetBrains+Mono:wght@400;500;700&display=swap",
  },
  motion: { revealStaggerMs: 125, flipHalfMs: 200 },
  sound: { voice: { rate: 0.98, pitch: 0.98, on: true } },
  companion: {
    name: "The Editor",
    lines: {
      invalid: [
        "That doesn't pass the copy desk.",
        "No such entry. Check your sources.",
        "Spike it — five real letters, please.",
        "Not in the style guide, I'm afraid.",
        "Rejected at fact-check.",
      ],
      wrong: [
        "A draft, not the final cut.",
        "Wrong, but the thesis has promise.",
        "Revise and resubmit.",
        "Not the lede. Keep digging.",
        "Close. Tighten it and try again.",
      ],
      win: [
        "Print it. Clean copy.",
        "Filed on deadline. Sharp work.",
        "That's front-page material.",
        "Solved, and elegantly phrased.",
        "Publish. No notes.",
      ],
      loss: [
        "We go to press without it. The word was {answer}.",
        "Killed for space. It was {answer}.",
        "The story got away: {answer}.",
        "Out of column inches. Answer: {answer}.",
      ],
      wipe: [
        "Spiked the draft. Start the lede again.",
        "Cleared the copy. Rewrite from the top.",
        "Blank page, fresh angle. Go.",
      ],
      idle: [
        "The page is blank. Awaiting your byline.",
        "Deadline's patient. For now.",
        "The cursor waits, pen poised.",
        "White space, no copy yet.",
      ],
    },
  },
};
