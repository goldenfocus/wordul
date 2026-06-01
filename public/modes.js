// Browser twin of src/modes.ts — keep in sync. Single source of truth for the
// mode picker UI. Only `available: true` modes can be chosen; the rest are the
// visible "coming soon" roadmap. Labels/blurbs come from i18n at render time.

export const MODES = {
  race:      { id: "race",      label: "Live Race",      blurb: "Everyone sprints the same word at once.",         available: true  },
  longgame:  { id: "longgame",  label: "Long Game",      blurb: "Turn-based. 3-day clock. Play a row, then wait.",  available: false },
  challenge: { id: "challenge", label: "Open Challenge", blurb: "One word, always open. Beat the standing record.", available: false },
};

export function isAvailableMode(id) {
  return typeof id === "string" && MODES[id]?.available === true;
}
