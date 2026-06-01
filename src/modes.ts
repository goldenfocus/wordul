// Single source of truth for room game modes. Only `available: true` modes can be
// chosen; the rest exist deliberately as the visible roadmap in the mode picker.
// Labels/blurbs here are English fallbacks — the rendered UI strings come from i18n.

export type RoomMode = "race"; // future: "longgame" | "challenge" | ...

export const DEFAULT_MODE: RoomMode = "race";

type ModeDef = { id: string; label: string; blurb: string; available: boolean };

export const MODES: Record<string, ModeDef> = {
  race:      { id: "race",      label: "Live Race",      blurb: "Everyone sprints the same word at once.",         available: true  },
  longgame:  { id: "longgame",  label: "Long Game",      blurb: "Turn-based. 3-day clock. Play a row, then wait.",  available: false },
  challenge: { id: "challenge", label: "Open Challenge", blurb: "One word, always open. Beat the standing record.", available: false },
};

export function isAvailableMode(id: unknown): id is RoomMode {
  return typeof id === "string" && MODES[id]?.available === true;
}
