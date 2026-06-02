// Wordul — English locale (the source-of-truth / fallback dictionary).
//
// Keys are dotted by surface (endscreen.*, etc.). To add a language, copy this file
// to locales/<code>.js, translate the VALUES (keep the keys + {placeholders}), and
// register it in i18n.js → LOCALES. New copy lands here first.

export const en = {
  // End-of-game stats / word card
  "endscreen.theWord": "THE WORD",
  "endscreen.lookup": "Look it up ↗",
  "endscreen.looking": "Looking it up…",
  "endscreen.noEntry": "No dictionary entry — tap “Look it up” to explore.",
  "endscreen.offline": "Definition unavailable offline — tap “Look it up”.",
  "endscreen.goldBreakdown": "Gold breakdown",
  "endscreen.youWon": "🎉 You got it in {n}!",
  "endscreen.someoneWon": "{who} got it first.",
  "endscreen.nobodyWon": "Nobody got it this time.",
  "endscreen.didYouKnow": "Did you know",

  // Stats modal (server-truth)
  "stats.needUsername": "Pick a username to track your stats.",
  "stats.loadFailed": "Couldn’t load your stats right now.",

  // Mode picker (lobby)
  "mode.heading": "Choose a mode",
  "mode.comingSoon": "soon",
  "mode.race.label": "Live Race",
  "mode.race.blurb": "Everyone sprints the same word at once.",
  "mode.longgame.label": "Long Game",
  "mode.longgame.blurb": "Turn-based. 3-day clock. Play a row, then wait.",
  "mode.challenge.label": "Open Challenge",
  "mode.challenge.blurb": "One word, always open. Beat the standing record.",
};
