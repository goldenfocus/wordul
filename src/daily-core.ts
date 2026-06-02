// src/daily-core.ts — pure, dependency-free daily logic (unit-tested). No Cloudflare deps.
import { WORDS_BY_SIZE } from "./wordsbysize.ts";

export interface World {
  date: string;            // "2026-06-02" — UTC day it belongs to
  word: string;            // main answer (UPPERCASE)
  bonusWord?: string;      // RESERVED (#2): hidden word to discover; no behavior yet
  edition: string;         // design skin id (e.g. "yang", "default")
  voice: string;           // companion voice id (e.g. "yang")
  story: { title: string; body: string; tip?: string };
  curator?: { username: string; message: string }; // RESERVED (#4)
  createdAt: number;       // epoch ms
}

export type DailySchedule = Record<string, World>;

/** UTC calendar date string "YYYY-MM-DD" for an instant (rolls at 00:00:00 UTC). */
export function activeDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** FNV-1a 32-bit hash → unsigned int. Deterministic, dependency-free. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts; >>> 0 keeps it unsigned 32-bit.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic pick from an answer pool, seeded by the date string. */
export function fallbackWord(date: string, answers: string[]): string {
  if (!answers || answers.length === 0) return "";
  return answers[fnv1a(date) % answers.length];
}
