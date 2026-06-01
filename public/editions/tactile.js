// Tactile edition — soft warm glass. Warm dark with ambient glow, rounded pressable
// tiles + keys, glassy panels. Bricolage display + Outfit body. The depth (rounded
// tiles, glass cards, 3D keycaps) lives in edition-scoped CSS. Companion = a warm coach.
export const edition = {
  id: "tactile",
  name: "Tactile",
  palette: {
    bg: "#16130f", fg: "#f7efe6", muted: "#a89a89", border: "#2e2820",
    tileEmpty: "#241f18", tilePendingBorder: "#4a4030", keyBg: "#241f18",
    green: "#5fae5a", yellow: "#e0b14a", gray: "#3a342b",
    accent: "#ff9a52", bgCard: "#1f1a14", error: "#e0796b",
  },
  fonts: {
    display: "'Bricolage Grotesque', Georgia, serif",
    body: "'Outfit', system-ui, sans-serif",
    link: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Outfit:wght@400;500;600;700&display=swap",
  },
  motion: { revealStaggerMs: 110, flipHalfMs: 200 },
  sound: { voice: { rate: 1.0, pitch: 1.02, on: true } },
  companion: {
    name: "Coach",
    lines: {
      invalid: [
        "Hmm, not a word yet — give it another go.",
        "Not in the book. You've got this.",
        "Almost! Real letters this time.",
        "That one's not landing — try again.",
        "No dice, but I believe in you.",
      ],
      wrong: [
        "Good swing. Closer than you think.",
        "Not it, but your instincts are solid.",
        "Keep going — you're warming up.",
        "Nice try. Read the clues and reload.",
        "Onward, you're learning the shape of it.",
      ],
      win: [
        "Yes! That's how it's done.",
        "Beautiful. You earned that one.",
        "Boom — solved it. Proud of you.",
        "Clean finish. Go again?",
        "There it is! Pure instinct.",
      ],
      loss: [
        "So close — the word was {answer}. Next one's yours.",
        "Tough board. It was {answer}.",
        "Shake it off, it was {answer}.",
        "We'll get the next one. Answer: {answer}.",
      ],
      idle: [
        "Take your time — no rush here.",
        "I'm right here when you're ready.",
        "The board's warm, come on back.",
        "Whenever you are. No pressure.",
      ],
      rush: [
        "Two greens! You're cooking now.",
        "Double green — that's the stuff!",
        "Look at you go, back to back.",
        "On a roll — keep it rolling!",
      ],
    },
  },
};
