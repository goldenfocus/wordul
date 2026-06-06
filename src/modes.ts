// Single source of truth for room game modes. Only `available: true` modes can be
// chosen; the rest exist deliberately as the visible roadmap in the mode picker.
// Labels/blurbs here are English fallbacks — the rendered UI strings come from i18n.

import { VANILLA, WILD, lanePreset, type Ruleset } from "./lane.ts";

export type RoomMode = "race"; // future: "longgame" | "challenge" | ...

export const DEFAULT_MODE: RoomMode = "race";

type ModeDef = {
  id: string; label: string; blurb: string; available: boolean;
  defaultRuleset: Ruleset;   // the lane a fresh room of this mode starts in
  lockRuleset?: boolean;     // true → creators cannot override (integrity modes)
};

export const MODES: Record<string, ModeDef> = {
  race:      { id: "race",      label: "Live Race",      blurb: "Everyone sprints the same word at once.",         available: true,  defaultRuleset: WILD },
  longgame:  { id: "longgame",  label: "Long Game",      blurb: "Turn-based. 3-day clock. Play a row, then wait.",  available: false, defaultRuleset: WILD },
  challenge: { id: "challenge", label: "Open Challenge", blurb: "One word, always open. Beat the standing record.", available: false, defaultRuleset: WILD },
};

export function isAvailableMode(id: unknown): id is RoomMode {
  return typeof id === "string" && MODES[id]?.available === true;
}

// The lane a fresh room of this mode starts in (Wild for any unknown mode).
export function defaultRulesetForMode(id: unknown): Ruleset {
  const def = typeof id === "string" ? MODES[id] : undefined;
  return def ? { ...def.defaultRuleset } : { ...WILD };
}

// The lane a NEW room gets at birth: daily is the fair flagship (Vanilla), everything
// else takes its mode default. Also used to backfill legacy rooms with no stored ruleset.
export function initialRuleset(isDaily: boolean, mode: unknown): Ruleset {
  return isDaily ? { ...VANILLA } : defaultRulesetForMode(mode);
}

// The lane to seed when the owner creates a room: an explicit, UNLOCKED lane choice wins,
// otherwise the mode default. (The override is dormant until a creation-toggle UI ships.)
export function seededRuleset(mode: unknown, lane?: unknown): Ruleset {
  const def = typeof mode === "string" ? MODES[mode] : undefined;
  if ((lane === "vanilla" || lane === "wild") && !def?.lockRuleset) return lanePreset(lane);
  return defaultRulesetForMode(mode);
}
