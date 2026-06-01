// Wordul — pre-generated word intel.
//
// Per answer word: a clean definition, one surprising philosophical/scientific fact,
// and a short quote from a great mind (with attribution). The end-screen word card
// reads this so every game teaches you something — instantly, offline, on-brand.
//
// This is SEEDED by hand for now; the full set (every answer in src/wordsbysize.ts)
// is produced by scripts/gen-word-intel.mjs via Claude. Words missing here fall back
// to the live dictionary lookup (definition only) in the word card. Quotes must be
// real + correctly attributed — never invent one; drop the quote if unsure.

export const WORD_INTEL = {
  POWER: {
    def: "The capacity to act or influence; in physics, the rate at which energy is transferred.",
    fact: "One watt is one joule per second — the unit is named for James Watt, whose steam engine helped launch the Industrial Revolution.",
    quote: "Power tends to corrupt, and absolute power corrupts absolutely.",
    author: "Lord Acton",
  },
  DREAM: {
    def: "A series of images and sensations during sleep; also a cherished hope or aspiration.",
    fact: "Vivid dreams cluster in REM sleep, discovered in 1953 — across a lifetime humans spend roughly six years dreaming.",
    quote: "All our dreams can come true, if we have the courage to pursue them.",
    author: "Walt Disney",
  },
  LIGHT: {
    def: "Electromagnetic radiation visible to the eye; also something of little weight.",
    fact: "Light travels at about 299,792 km per second — the cosmic speed limit nothing carrying information can beat.",
    quote: "Darkness cannot drive out darkness; only light can do that.",
    author: "Martin Luther King Jr.",
  },
  OCEAN: {
    def: "A vast body of salt water covering most of the Earth's surface.",
    fact: "The ocean holds about 97% of Earth's water and, mostly via plankton, produces more than half the oxygen we breathe.",
    quote: "We are tied to the ocean. And when we go back to the sea, we are going back from whence we came.",
    author: "John F. Kennedy",
  },
  TRUTH: {
    def: "That which is in accordance with fact or reality.",
    fact: "In logic, 'true' is one of the two Boolean values — the foundation every digital computer is built on.",
    quote: "Rather than love, than money, than fame, give me truth.",
    author: "Henry David Thoreau",
  },
  MONEY: {
    def: "A medium of exchange in the form of coins, notes, or their digital equivalent.",
    fact: "The word traces to the Roman goddess Juno Moneta, near whose temple Rome struck its first coins.",
    quote: "An investment in knowledge pays the best interest.",
    author: "Benjamin Franklin",
  },
};

// Look up intel for a word (case-insensitive). Returns null when we have nothing —
// the word card then falls back to the live dictionary definition.
export function wordIntel(word) {
  return WORD_INTEL[String(word || "").toUpperCase()] || null;
}
