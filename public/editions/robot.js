// Tin Bot edition — a 1950s wind-up pal. The only LIGHT edition in the lineup:
// warm cream + chrome, coral accent, teal sidekick, rounded bezels, gentle bounce.
// Companion "Sprocket" is wholesome beep-boop. Light-bg fixes (dark hover tints,
// dark text on yellow/absent tiles) live in edition-scoped CSS under
// html[data-edition="robot"] — every other edition is dark, so a cream surface
// needs those overrides or hovers vanish and tile letters lose contrast.
export const edition = {
  id: "robot",
  name: "Tin Bot",
  palette: {
    bg: "#f4efe6", fg: "#2a2622", muted: "#7a6e60", border: "#cfc4b2",
    tileEmpty: "#fbf8f2", tilePendingBorder: "#c2b6a2", keyBg: "#e7decf",
    green: "#2e9e6b", yellow: "#e0a23c", gray: "#b3a998",
    accent: "#ff7043", bgCard: "#fbf8f2", error: "#e5484d",
  },
  fonts: {
    display: "'Fredoka', system-ui, sans-serif",
    body: "'DM Sans', system-ui, sans-serif",
    link: "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=DM+Sans:wght@400;500;700&display=swap",
  },
  motion: { revealStaggerMs: 120, flipHalfMs: 210 },
  sound: { voice: { rate: 1.02, pitch: 1.12, on: true } },
  companion: {
    name: "Sprocket",
    lines: {
      invalid: [
        "Beep! That's not in my memory banks. Try again, pal!",
        "Bzzt — five real letters, friend!",
        "Does not compute... but I believe in you!",
        "Hmm, my dictionary gears don't know that one.",
        "Whirr — let's try a word that's in the manual!",
      ],
      wrong: [
        "So close I can feel it in my gears!",
        "Recalibrating... you've got this!",
        "Whirr — good guess, keep cranking!",
        "Not quite, but my circuits are optimistic!",
        "Tick tick — adjust and wind it up again!",
      ],
      win: [
        "Whirr-CLICK! You did it! My gears are SO proud!",
        "BEEP BEEP! Solved! *happy spinning*",
        "Ding ding ding! A shiny win for my favorite human!",
        "Sparks of joy! That was beautifully assembled.",
        "*celebratory windup* Flawless, partner!",
      ],
      loss: [
        "Aw, beep. It was {answer}. We'll get the next one!",
        "*sad windup unwinding* The word was {answer}. Chin up, pal!",
        "Bzzt... it was {answer}. No rust on you, let's go again!",
        "My gears wobbled too. The answer was {answer}.",
      ],
      idle: [
        "*ticking* ...still wound up and ready when you are!",
        "Beep? You still there, buddy?",
        "*gentle whirring* I'll keep the springs warm.",
        "Standing by, polished and ready, pal.",
      ],
      rush: [
        "TWO greens?! My circuits are sparkling!",
        "Combo! *excited beeping* Keep 'em coming!",
        "Double-locked! My springs are bouncing!",
        "Whirr-whirr — you're on a roll, partner!",
      ],
    },
  },
};
