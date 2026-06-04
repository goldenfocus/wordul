import type { Color } from "./color.ts";
import type { UserStats } from "./stats.ts";
import type { GameRecord, RoomGame } from "./records.ts";
import type { RoomScore } from "./scoreboard.ts";
import type { RoomMode } from "./modes.ts";
import type { LedgerTx } from "./economy.ts";

export type OwnedRoom = { slug: string; name: string; lastPlayedAt: number };

export type UserProfile = {
  username: string;
  createdAt: number;
  stats: UserStats;
  games: GameRecord[];     // most-recent-first, capped
  ownedRooms: OwnedRoom[];
  ledger: LedgerTx[];   // append-only token transactions; capped audit log (last 500)
  balances: Record<string, number>;  // running per-token balance; authoritative (ledger is a capped audit log)
  h2h?: Record<string, { w: number; l: number }>; // per-(human, persona) record, keyed by persona id
};

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
  USER: DurableObjectNamespace;
  WORDSTATS: DurableObjectNamespace;
  CHALLENGE: DurableObjectNamespace;
  DAILY: DurableObjectNamespace;
  SCIENCE: DurableObjectNamespace;
  ARENA: DurableObjectNamespace;
  DIRECTORY: KVNamespace;
  DESIGNS: R2Bucket;
  OG: R2Bucket;
  AI?: Ai;                    // Workers AI — powers POST /vibe-studio/tune (optional: route 503s if absent)
  DAILY_ADMIN_TOKEN?: string; // wrangler secret; gates POST /daily/schedule
}

export type GuessRow = { word: string; mask: Color[] };

export type PlayerState = {
  username: string;
  connected: boolean;
  guesses: GuessRow[];
  status: "playing" | "won" | "lost";
  isBot?: boolean;         // a worduler — born in Wordul, plays from public masks only
  scienceOptOut?: boolean; // true = skip player-level research telemetry
  revealHints?: number;    // per-round count, powers aggregate hint-use research
  vowelHints?: number;     // per-round count, powers aggregate hint-use research
  points: number;        // live in-game points (earned − spent); reset each round
  pointsSpent: number;   // running power-up spend this round (internal accumulator)
  scored?: boolean;        // daily: this player's one result has been recorded (mint once)
  goldAwarded?: number;    // daily: gold actually minted on a confirmed (res.ok) ledger write
  resigned?: boolean;      // gave up (vs ran out of guesses) — both land status "lost"
  nextGuessAt?: number;    // bot-only: epoch ms this bot is next due to guess (per-bot heartbeat, Inc.2)
};

export type RoomPhase = "lobby" | "playing" | "finished";

export type ChatEntry =
  | { kind: "user"; from: string; text: string; t: number }
  | { kind: "system"; text: string; t: number };

// Server-only marker stamped on a seeded (bot-hosted) room. NEVER reaches a client:
// snapshotFor (Slice C) shadows it with `seed: undefined` on the outbound projection.
export type SeedMarker = { personaId: string; profile: "noob" };

export type RoomSnapshot = {
  path: string;            // "<owner>/<slug>" — immutable canonical DO key
  owner: string;           // owner username
  slug: string;            // current URL slug (renameable; old slugs alias to canonical path)
  name: string;            // display name (renameable)
  phase: RoomPhase;
  players: PlayerState[];
  word: string | null;
  winner: string | null;   // winner username
  startedAt: number | null;
  finishedAt: number | null;
  round: number;
  chat: ChatEntry[];
  wordLength: number;      // letters per guess (4-12)
  maxGuesses: number;      // rows per board, derived from wordLength
  mode: RoomMode;          // room game format; "race" today, more later
  scoreboard: RoomScore[];
  history: RoomGame[];     // finished games in this room, newest last (capped)
  edition: string;         // theme/edition id bound to the room — everyone in it sees this theme
  challengeId?: string | null; // set when this room plays a pinned challenge word
  // Daily-mode (Wordul of the Day). Absent/false on normal race rooms.
  isDaily?: boolean;       // async one-shot, locked word, no resets, per-player scoring
  story?: { title: string; body: string; tip?: string } | null; // World story for the unlock
  voice?: string;          // World companion voice id (forward-compat; client still defaults)
  // --- Vibe Studio v1: curated day-page theming (additive; absent on legacy days) ---
  colorScheme?: { a1: string; a2: string; a3: string } | null; // palette → CSS-var re-theme
  vibeTitle?: string;      // curated title; becomes the daily board title when present
  seed?: SeedMarker;       // INTERNAL ONLY — present on seeded bot rooms; stripped outbound (Slice C)
  publicArena?: boolean;   // INTERNAL ONLY — a human-hosted public Arena room; stripped outbound
  // Rematch handshake — INTERNAL ONLY; stripped outbound in snapshotFor (like seed/publicArena).
  rematch?: { proposer: string; deadline: number } | null;
  botRematchAt?: number | null;     // epoch ms the bot decides; null = none pending
  rematchTimeoutAt?: number | null; // epoch ms the proposal auto-cancels; null = none pending
};

export type ClientMessage =
  | { type: "hello"; username: string; wordLength?: number; mode?: RoomMode; edition?: string; scienceOptOut?: boolean; public?: boolean }
  | { type: "start" }
  | { type: "guess"; word: string }
  | { type: "typing"; len: number } // ephemeral: how many letters are in my current row (no letters sent)
  | { type: "rematch_propose" }
  | { type: "rematch_accept" }
  | { type: "rematch_decline" }
  | { type: "chat"; text: string }
  | { type: "set_length"; wordLength: number }
  | { type: "set_mode"; mode: RoomMode }
  | { type: "set_edition"; edition: string }
  | { type: "rename"; name: string }
  | { type: "reveal_letter"; known?: number[] }
  | { type: "vowel_count" }
  | { type: "resign" }
  | { type: "ping" };

export type ServerMessage =
  | { type: "snapshot"; room: RoomSnapshot }
  | { type: "typing"; username: string; len: number } // relayed live-typing pulse (anonymous: count only)
  | { type: "error"; message: string }
  | { type: "invalid_guess"; reason: string }
  | { type: "revealed_letter"; index: number; letter: string }
  | { type: "vowels"; count: number }
  | { type: "pong" }
  | { type: "rematch_proposed"; proposer: string }
  | { type: "rematch_accepted"; by: string }
  | { type: "rematch_cancelled"; reason: "declined" | "timeout" | "left" };

// Challenge link types live in challenge-core.ts (pure + unit-tested); re-export
// here so DO/worker/room import them alongside the other shared types.
export type { ChallengeAttempt, ChallengeRecord, ChallengeState, ChallengeMeta } from "./challenge-core.ts";
