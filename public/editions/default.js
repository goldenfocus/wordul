// Default edition — "Ring-Bearer": obsidian cave, ULTRAVIOLET chrome, and gold
// reserved for the one thing you covet — "the precious" (the Hot/win tile).
// Moving chrome off gold fixes the gold≈yellow confusion: UV appears on zero tile
// states, so brand can never be mistaken for game feedback. Refined Fraunces +
// Instrument Sans, restrained motion. Palette mirrors style.css :root (no flash).
export const edition = {
  id: "default",
  name: "Wordul",
  // Blessed: this IS the elegant :root board, so it repaints the full surface. (See applyEdition.)
  morphBoard: true,
  palette: {
    bg: "#0e0e10", fg: "#f4f2ec", muted: "#8a8a8f", border: "#2a2a2e",
    tileEmpty: "#0e0e10", tilePendingBorder: "#46464c", keyBg: "#2a2a2e",
    // Chrome is ultraviolet; "warm" carries a silver-yellow whisper of old #2.
    hot: "#9d8bff", warm: "#d8c97a", cold: "#3a3a3e",
    accent: "#9d8bff", bgCard: "#17171a", error: "#e0796b",
  },
  fonts: {
    display: "'Fraunces', Georgia, serif",
    body: "'Instrument Sans', system-ui, sans-serif",
    link: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Instrument+Sans:wght@400;500;600&display=swap",
  },
  motion: { revealStaggerMs: 110, flipHalfMs: 200 },
  sound: { voice: { rate: 1.0, pitch: 1.0, on: true } },
  companion: {
    name: "Wordul",
    lines: {
      invalid: ["That's not a word. Take your time.", "Five real letters, please.", "Not quite a word yet."],
      wrong:   ["Closer than it feels.", "Noted. Adjust and continue.", "Warmer, precious. Keep going."],
      win:     ["The precious is yours. Elegant.", "Solved, with taste.", "Yesss — that's the standard. Again?"],
      loss:    ["It slips away. The word was {answer}.", "Even masters miss. It was {answer}."],
      idle:    ["The board is waiting, precious.", "Whenever you're ready."],
      wipe:    ["Clean slate. Begin again.", "Wiped. Choose more wisely.", "Gone. Start fresh, precious."],
    },
  },
};
