// Arcade edition — green-phosphor CRT. Near-black, vivid neon green, a cyan glint;
// techy Chakra Petch display + Space Mono body. Scanlines + tile glow live in
// edition-scoped CSS under html[data-edition="arcade"]. Companion = arcade announcer.
export const edition = {
  id: "arcade",
  name: "Arcade",
  palette: {
    bg: "#07090c", fg: "#dffbe9", muted: "#6f8597", border: "#16202c",
    tileEmpty: "#0b1117", tilePendingBorder: "#274058", keyBg: "#13202c",
    green: "#2bd47e", yellow: "#caa53a", gray: "#1e2a36",
    accent: "#39ff97", bgCard: "#0c141b", error: "#ff5c7a",
  },
  fonts: {
    display: "'Chakra Petch', system-ui, sans-serif",
    body: "'Space Mono', ui-monospace, monospace",
    link: "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Space+Mono:wght@400;700&display=swap",
  },
  motion: { revealStaggerMs: 95, flipHalfMs: 200 },
  sound: { voice: { rate: 1.06, pitch: 1.05, on: true } },
  companion: {
    name: "The Cabinet",
    lines: {
      invalid: [
        "ERROR: word not found in ROM.",
        "Insert a real word to continue.",
        "Syntax error. Five real letters, player one.",
        "That string did not compile.",
        "BZZT. Not in the dictionary banks.",
      ],
      wrong: [
        "Miss. Recalibrating...",
        "Negative. Adjust trajectory.",
        "Not the target. Keep firing.",
        "Wrong, but the algorithm's learning.",
        "Try again, the high score awaits.",
      ],
      win: [
        "TARGET ACQUIRED. Flawless.",
        "WINNER. Drop another coin?",
        "New high score energy right there.",
        "Cracked. The cabinet is impressed.",
        "GG. Respawn for round two?",
      ],
      loss: [
        "GAME OVER. The word was {answer}.",
        "Out of lives. It was {answer}.",
        "Continue? The answer was {answer}.",
        "The cabinet wins this round: {answer}.",
      ],
      idle: [
        "Insert coin... player still there?",
        "Attract mode engaged. Come back.",
        "The cursor blinks alone in the dark.",
        "Standing by. The grid hums quietly.",
      ],
      rush: [
        "COMBO x2! The board's on fire.",
        "Double green — multiplier rising!",
        "Two locked in. Crowd goes wild.",
        "Stack 'em up, that's a streak!",
      ],
    },
  },
};
