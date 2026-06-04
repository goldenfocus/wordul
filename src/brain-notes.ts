// src/brain-notes.ts — curated, evergreen brain-science notes matched to findings by
// declarative trigger. Authored strings (translatable when stable). Grows incrementally.
import type { FindingKind, Pillar } from "./feed.ts";

export type BrainNoteTrigger = { kind: FindingKind; min?: number; max?: number };

export type BrainNote = {
  id: string;
  pillar: Pillar;
  title: string;
  note: string;          // 1–3 sentences, evergreen, true
  citation?: string;
  trigger: BrainNoteTrigger;
};

export const BRAIN_NOTES: BrainNote[] = [
  { id: "hypercorrection", pillar: "mind", title: "Learning from being wrong",
    note: "Recovering from a confident wrong guess can fix a memory more firmly than getting it right the first time — the brain encodes the correction.",
    citation: "Metcalfe, 2017, Annual Review of Psychology", trigger: { kind: "median_guesses", min: 4 } },
  { id: "priming", pillar: "mind", title: "Pattern priming",
    note: "A first-guess solve usually means the opener primed the right pattern instantly — recognition, not luck.",
    trigger: { kind: "first_try_solves", min: 1 } },
  { id: "offloading", pillar: "mind", title: "Cognitive offloading",
    note: "Reaching for a reveal offloads part of the problem to a tool. Used sparingly it frees working memory; leaned on, it can crowd out recall.",
    citation: "Risko & Gilbert, 2016, Trends in Cognitive Sciences", trigger: { kind: "letter_reveal_rate", min: 15 } },
  { id: "desirable-difficulty", pillar: "mind", title: "Desirable difficulty",
    note: "A hard day that still gets solved is the sweet spot for learning — effortful retrieval is what makes knowledge stick.",
    citation: "Bjork & Bjork, 2011", trigger: { kind: "solve_rate", max: 55 } },
  { id: "flow", pillar: "body", title: "Flow on tap",
    note: "When challenge meets skill, attention narrows and time bends — a high solve rate on a real puzzle is a small dose of flow.",
    citation: "Csikszentmihalyi, 1990", trigger: { kind: "solve_rate", min: 70 } },
  { id: "pause", pillar: "body", title: "The productive pause",
    note: "A brief pause before committing a guess lets pattern-recognition circuits settle — slowing down a beat often speeds up the solve.",
    trigger: { kind: "gray_opener_rate", min: 25 } },
  { id: "exploration", pillar: "body", title: "Explore before you exploit",
    note: "Opening into a blank board is the explore move — spend information early, exploit it late. Good foragers do the same.",
    trigger: { kind: "gray_opener_rate", min: 40 } },
  { id: "collective-ritual", pillar: "spirit", title: "A shared ritual",
    note: "Doing the same small thing as thousands of strangers at the same time builds a quiet sense of belonging — synchrony bonds people.",
    citation: "Wiltermuth & Heath, 2009", trigger: { kind: "participation", min: 100 } },
  { id: "near-miss", pillar: "spirit", title: "The honest near-miss",
    note: "Sharing a near-miss builds more connection than a brag — vulnerability, not victory, is what makes people feel close.",
    trigger: { kind: "solve_rate", max: 60 } },
  { id: "savoring", pillar: "soul", title: "Savoring the small win",
    note: "Naming a small daily win — even a five-letter one — trains attention toward the good and compounds over time.",
    citation: "Bryant & Veroff, 2007", trigger: { kind: "solve_rate", min: 60 } },
  { id: "cadence", pillar: "soul", title: "A kept cadence",
    note: "The mind loves a predictable rhythm. A word at the same hour each day is a tiny anchor the nervous system comes to trust.",
    trigger: { kind: "participation", min: 1 } },
  { id: "mastery", pillar: "soul", title: "Quiet mastery",
    note: "Most people landing the answer in four guesses is the signature of a crowd that has quietly gotten good at something.",
    trigger: { kind: "median_guesses", max: 4 } },
];
