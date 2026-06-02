// Default edition — premium, Apple-grade: warm near-black, one quiet gold accent,
// refined Fraunces (display) + Instrument Sans (body), restrained motion.
// Its palette mirrors style.css :root so the default never flashes an override.
export const edition = {
  id: "default",
  name: "Wordul",
  palette: {
    bg: "#0e0e10", fg: "#f4f2ec", muted: "#8a8a8f", border: "#2a2a2e",
    tileEmpty: "#0e0e10", tilePendingBorder: "#46464c", keyBg: "#2a2a2e",
    green: "#c8a96a", yellow: "#c8a96a", gray: "#3a3a3e", // gold accent (Obsidian)
    accent: "#c8a96a", bgCard: "#17171a", error: "#e0796b",
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
      wrong:   ["Closer than it feels.", "Noted. Adjust and continue.", "A reasonable theory. Keep going."],
      win:     ["Elegant. Well played.", "Solved, with taste.", "That's the standard. Again?"],
      loss:    ["It happens to the best. The word was {answer}.", "Even masters miss. It was {answer}."],
      idle:    ["The board is waiting.", "Whenever you're ready."],
    },
  },
};
