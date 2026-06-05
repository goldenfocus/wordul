import { DurableObject } from "cloudflare:workers";
import { WORDS_BY_SIZE, isSupportedSize } from "./wordsbysize.ts";
import { scoreGuess, countVowels, revealUngreened, type Color } from "./color.ts";
import { computeNextGuess } from "./solver.ts";
import { noobGuess, mistakeRateFor } from "./noob.ts";
import { planKeystrokes, NOOB_HAND, SHARP_HAND, type KeyStep } from "./rhythm.ts";
import { projectPlayerForClient, dueWotdPersonas } from "./bots.ts";
import { bumpScoreboard } from "./scoreboard.ts";
import { everyoneReady, COUNTDOWN_MS } from "./duel.ts";
import { nextSeatRole, applyKothRotation } from "./rotation.ts";
import { buildGameRecords, summarizeRoomGame, encodeSolveGrid, encodeSolveWords } from "./records.ts";
import { normalizeSlug } from "./identity.ts";
import { pointsEarned, goldFromPoints, speedBonusPoints, POINTS, settle, settleParts } from "./economy.ts";
import { topDaily, fullDaily } from "./leaderboard-core.ts";
import { DEFAULT_MODE, isAvailableMode, initialRuleset, seededRuleset } from "./modes.ts";
import { VANILLA, laneSig } from "./lane.ts";
import { activeDate } from "./daily-core.ts";
import { countMask, maskToPattern, type ScienceBaseEvent, type ScienceEvent, type ScienceOutcome, type ScienceRoomKind } from "./science.ts";
import { makeChallengeId, challengeRoundLocked } from "./challenge-core.ts";
import { newTape, tapePush, type GhostTape } from "./ghost-core.ts";
import {
  outpacedLosers,
  rematchReduce,
  nextAlarmAt,
  botAccepts,
  botDelay,
  dueBots,
  nextBotAlarmAt,
  REMATCH_TIMEOUT_MS,
  BOT_REMATCH_MIN_MS,
  BOT_REMATCH_MAX_MS,
  ABANDON_GRACE_MS,
  hasConnectedHuman,
  guessesFor,
  clampRows,
  type RematchEffect,
} from "./room-core.ts";
import type { RoomMode } from "./modes.ts";
import type {
  ChatEntry,
  ClientMessage,
  Env,
  PlayerState,
  RoomSnapshot,
  ServerMessage,
} from "./types.ts";

const DEFAULT_LENGTH = 5;
const MIN_LENGTH = 4;
const MAX_LENGTH = 12;
const MAX_PLAYERS = 8;
const MAX_CHAT = 40;
const MAX_CHAT_LEN = 200;
const CHAT_THROTTLE_MS = 800;

// Slice 0 — "the robot room". Any room whose slug is this always has a worduler in it.
const ROBOT_SLUG = "robots";
const BOT_NAME = "clanker";

// ARENA → ROOM POST /seed body (canonical contract). `path` is the DO-key form. `personas`
// is the full roster (capacity−1 distinct personas, human-looking usernames); `botCount` are
// injected into the lobby at seed and the rest fill on the human's join.
type SeedBody = {
  path: string;
  personas: { id: string; name: string; avatar: string }[];
  capacity: number;
  botCount: number;
  profile: "noob";
  edition: string;
  wordLength: number;
};

// Wordul of the Day: a flat gold goody on completion, on top of the score-based mint.
const DAILY_GOLD_BONUS = 100; // ← tune to taste (1 gold ≈ 100 points)

// A room whose canonical path is daily/<YYYY-MM-DD> is the day's puzzle.
function dailyDateOf(path: string): string | null {
  const m = /^daily\/(\d{4}-\d{2}-\d{2})$/.exec(path ?? "");
  return m ? m[1] : null;
}

// Normalize a client-supplied edition id to the charset edition ids use (lowercase
// kebab). Empty/garbage collapses to "default". Not a whitelist — the client falls
// back to the default theme for any id it doesn't recognize.
function sanitizeEdition(raw: string): string {
  const id = (raw ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
  return id || "default";
}


export class Room extends DurableObject<Env> {
  private state: RoomSnapshot;
  /** In-memory only — fine if hibernation wipes it; we just reset throttle. */
  private chatThrottle = new Map<string, number>();
  // NOTE: the ghost tape lives on this.state.tape (NOT a class field) — the hibernation
  // API recycles this instance between bot turns, so in-memory state dies mid-race. It
  // rides the existing persist points (every guess); typing pulses between persists are
  // the only thing a hibernation can drop. Stripped outbound in snapshotFor like `seed`.

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = {
      path: "",
      owner: "",
      slug: "",
      name: "",
      phase: "lobby",
      players: [],
      word: null,
      winner: null,
      startedAt: null,
      goAt: null,
      finishedAt: null,
      round: 0,
      chat: [],
      wordLength: DEFAULT_LENGTH,
      maxGuesses: guessesFor(DEFAULT_LENGTH),
      capacity: MAX_PLAYERS, // placeholder; snapshotFor recomputes (seed?.capacity ?? MAX_PLAYERS) outbound
      mode: DEFAULT_MODE,
      scoreboard: [],
      history: [],
      edition: "default",
      ruleset: initialRuleset(false, DEFAULT_MODE),
      rotation: "koth",
      queue: [],
      throne: null,
      isDaily: false,
      story: null,
      challengeId: null,
      shareChallengeId: null,
    };
    // Async restore — DO ctor can't await, so we kick it off and gate writes via blockConcurrencyWhile.
    ctx.blockConcurrencyWhile(async () => {
      const restored = await ctx.storage.get<RoomSnapshot>("state");
      if (restored) {
        if (!Array.isArray(restored.chat)) restored.chat = [];
        if (!Array.isArray(restored.scoreboard)) restored.scoreboard = [];
        if (!Array.isArray(restored.history)) restored.history = [];
        if (!restored.wordLength) restored.wordLength = DEFAULT_LENGTH;
        if (!restored.maxGuesses) restored.maxGuesses = guessesFor(restored.wordLength);
        if (!restored.mode) restored.mode = DEFAULT_MODE;
        if (!restored.edition) restored.edition = "default"; // pre-theme rooms
        if (restored.isDaily === undefined) restored.isDaily = false;
        if (restored.shareChallengeId === undefined) restored.shareChallengeId = null;
        if (!restored.ruleset) restored.ruleset = initialRuleset(!!restored.isDaily, restored.mode);
        for (const p of restored.players) {
          if (typeof p.points !== "number") p.points = 0;
          if (typeof p.pointsSpent !== "number") p.pointsSpent = 0;
          if (typeof p.revealHints !== "number") p.revealHints = 0;
          if (typeof p.vowelHints !== "number") p.vowelHints = 0;
          if (typeof p.scienceOptOut !== "boolean") p.scienceOptOut = false;
          if (typeof p.ready !== "boolean") p.ready = false; // pre-duel rooms
        }
        // Duel-state backfill for rooms persisted before seats/queue/throne existed.
        if (restored.goAt === undefined) restored.goAt = null;
        if (!restored.rotation) restored.rotation = "koth";
        if (!Array.isArray(restored.queue)) restored.queue = [];
        if (restored.throne === undefined) restored.throne = null;
        if (restored.players.some((p) => p.role === undefined)) {
          // First two players are duelists, the rest queue (preserve array order).
          let seated = 0;
          restored.queue = [];
          for (const p of restored.players) {
            if (seated < 2) { p.role = "duelist"; seated++; }
            else { p.role = "queued"; restored.queue.push(p.username); }
          }
        }
        // A room caught mid-countdown by restore can't trust its stale goAt alarm — drop
        // back to lobby so duelists simply re-ready (cheap; avoids a stuck 3-2-1 overlay).
        if (restored.phase === "countdown") {
          restored.phase = "lobby";
          restored.goAt = null;
          for (const p of restored.players) p.ready = !!p.isBot;
        }
        this.state = restored;
      }
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Server-to-server seed: ARENA mints a room BEFORE any human connects. POST-only and
    // matched before /ws so a seeded room exists, registered + waiting, on first GET /ws.
    if (req.method === "POST" && url.pathname.endsWith("/seed")) {
      return this.handleSeed(req);
    }
    if (url.pathname.endsWith("/ws")) {
      const path = url.searchParams.get("room") ?? "";
      const challengeId = url.searchParams.get("challenge");
      if (challengeId && !this.state.challengeId) this.state.challengeId = challengeId;
      if (this.state.path === "") {
        this.state.path = path;
        const [owner, slug] = path.split("/");
        this.state.owner = owner ?? "";
        this.state.slug = slug ?? "";
        if (!this.state.name) this.state.name = (slug ?? "").replace(/-/g, " ");
      } else if (!this.state.slug) {
        // Backfill for rooms persisted before display-slug existed.
        this.state.slug = this.state.path.split("/")[1] ?? "";
      }
      return this.handleUpgrade(req);
    }
    // Cron-driven: wordulers play the word of the day at "their hour". The worker's
    // scheduled handler pokes this every tick; dueWotdPersonas is pure + idempotent
    // (already-present personas are skipped), so re-pokes are harmless. `path` stamps
    // identity on a cold DO — without it a fresh room has path "" and can't seed.
    if (req.method === "POST" && url.pathname === "/bots/tick") {
      const path = url.searchParams.get("path") ?? "";
      if (this.state.path === "" && /^daily\/\d{4}-\d{2}-\d{2}$/.test(path)) {
        this.state.path = path;
        const [owner, slug] = path.split("/");
        this.state.owner = owner ?? "";
        this.state.slug = slug ?? "";
      }
      return this.handleWotdBotTick();
    }
    // Read-only daily leaderboard: top N by gold + the caller's own rank. No socket,
    // no mutation — just a sort over the players already persisted in state.
    if (req.method === "GET" && url.pathname.endsWith("/leaderboard")) {
      const username = (url.searchParams.get("username") ?? "").toLowerCase().trim();
      const full = url.searchParams.get("full") === "1";
      const durationOf = (p: PlayerState) =>
        p.firstGuessAt != null && p.finishedAt != null
          ? Math.max(0, p.finishedAt - p.firstGuessAt)
          : undefined;
      // Shared base mapping. The full roster stays lean (no grid); the top-N view adds grid.
      const toRankable = (p: PlayerState) => ({
        username: p.username,
        guessCount: p.guesses.length,
        won: p.status === "won",
        resigned: p.resigned,
        isBot: p.isBot,
        goldAwarded: p.goldAwarded,
        score: p.points,
        durationMs: durationOf(p),
      });
      if (full) {
        return Response.json({ ...fullDaily(this.state.players.map(toRankable), username), lane: laneSig(this.state.ruleset ?? initialRuleset(!!this.state.isDaily, this.state.mode)) });
      }
      const n = Number(url.searchParams.get("n") ?? "3");
      // Proof-of-finish gate: a caller who presents today's finisher token (handed only to
      // a player who completed the daily) unlocks the REAL letter rows for every board — at
      // that point the answer isn't a secret to them anyway. Anyone else gets color-only
      // grids, so the public endpoint can never leak today's word.
      const t = url.searchParams.get("t") ?? "";
      const unlock = !!this.state.finisherSecret && t === this.state.finisherSecret;
      const players = this.state.players.map((p) => ({
        ...toRankable(p),
        grid: encodeSolveGrid(p.guesses),
        words: unlock ? encodeSolveWords(p.guesses) : undefined,
      }));
      return Response.json({ ...topDaily(players, username, n), lane: laneSig(this.state.ruleset ?? initialRuleset(!!this.state.isDaily, this.state.mode)) });
    }
    return new Response("not found", { status: 404 });
  }

  // Initialize a seeded (bot-hosted) room: stamp identity exactly as the /ws block does,
  // mark it seeded, and inject the persona as a silent waiting player. Idempotent — a
  // re-seed of an already-seeded room just acks. The room auto-starts when a human joins.
  private async handleSeed(req: Request): Promise<Response> {
    const b = (await req.json().catch(() => null)) as SeedBody | null;
    if (!b?.path || !Array.isArray(b.personas) || b.personas.length === 0 || b.profile !== "noob") {
      return new Response("bad request", { status: 400 });
    }
    if (this.state.seed) return Response.json({ ok: true }); // already seeded
    if (this.state.path === "") {
      this.state.path = b.path;
      const [owner, slug] = b.path.split("/");
      this.state.owner = owner ?? "";
      this.state.slug = slug ?? "";
      this.state.name = `${b.personas[0].name}'s room`;
    }
    // Clamp to a sane multi-bot range: capacity ≤ MAX_PLAYERS, and never more bots than the
    // roster supplies or seats allow (botCount ≤ personas.length and ≤ capacity−1).
    const capacity = Math.max(2, Math.min(MAX_PLAYERS, b.capacity || b.personas.length + 1));
    const botCount = Math.max(1, Math.min(b.botCount || 1, b.personas.length, capacity - 1));
    this.state.seed = { profile: b.profile, personaIds: b.personas.map((p) => p.id), capacity };
    this.state.edition = sanitizeEdition(b.edition);
    if (isSupportedSize(b.wordLength)) {
      this.state.wordLength = b.wordLength;
      this.state.maxGuesses = guessesFor(b.wordLength);
    }
    this.ensureBots(botCount); // inject the botCount bots that wait in the lobby
    await this.persistAndBroadcast();
    return Response.json({ ok: true });
  }

  private async handleUpgrade(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Use hibernation API so the DO can sleep between messages but keep connections.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      this.send(ws, { type: "error", message: "invalid json" });
      return;
    }
    try {
      await this.handle(ws, msg);
    } catch (e) {
      this.send(ws, { type: "error", message: (e as Error).message });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const username = this.userFor(ws);
    if (username) {
      const p = this.state.players.find((p) => p.username === username);
      if (p && p.connected) {
        p.connected = false;
        // Daily rooms persist NO presence lines: hundreds flow through over 24h and every
        // mobile background/foreground flap closed a WS — the 40-slot chat ring filled with
        // "left/reconnected" noise and real chat fell out. Race lobbies keep them (useful).
        if (!this.state.isDaily) this.pushSystem(`${p.username} left`);
      }
      // A pending rematch dies if either participant drops; the survivor (the
      // proposer, if it was the recipient who left) is settled Home via cancelled{left}.
      if (this.state.rematch && this.state.phase === "finished") {
        const { rematch, effects } = rematchReduce(this.state.rematch, { kind: "left" });
        this.state.rematch = rematch;
        await this.applyRematchEffects(effects);
      }
      // Public Arena room emptied of humans while still waiting in the lobby: don't strand
      // it in the open-games index for hours. Arm a grace alarm; the alarm delists it only
      // if STILL human-empty when it fires, so a plain refresh/hibernation WS blip doesn't
      // yank a live host's listing. (Seeded bot rooms never reach here — bots have no WS.)
      if (this.state.publicArena && this.state.phase === "lobby" && !hasConnectedHuman(this.state.players)) {
        this.state.abandonAt = Date.now() + ABANDON_GRACE_MS;
        void this.ctx.storage.setAlarm(this.state.abandonAt);
      }
      await this.persistAndBroadcast();
    }
  }

  // A seeded room seats exactly 1 human — but its word is published as a challenge.
  // Instead of a dead-end "room full", hand the visitor the challenge id: same word,
  // the original field's ghosts, the host's score to beat. Falls back to the legacy
  // error only when the mint failed or the race hasn't produced a host yet.
  private sendArenaHandoffOrFull(ws: WebSocket): void {
    const id = this.state.shareChallengeId;
    const host = this.state.players.find((p) => !p.isBot);
    if (!id || !host) {
      this.send(ws, { type: "error", message: "room full" });
      return;
    }
    this.send(ws, {
      type: "arena_handoff",
      challengeId: id,
      host: host.username,
      hostDone: host.status !== "playing" || this.state.phase === "finished",
    });
  }

  /** Read username from this WS's serialized attachment (survives hibernation). */
  private userFor(ws: WebSocket): string | null {
    try {
      const a = ws.deserializeAttachment() as { username?: string } | null;
      return a?.username ?? null;
    } catch {
      return null;
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // --- handlers ---

  private async handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "hello":
        return this.onHello(ws, msg.username, msg.wordLength, msg.edition, msg.mode, msg.scienceOptOut, msg.public, msg.sessionToken, msg.lane);
      case "start":
        return this.onStart(ws);
      case "ready":
        return this.onReady(ws, msg.ready);
      case "guess":
        return this.onGuess(ws, msg.word);
      case "typing":
        return this.onTyping(ws, msg.len);
      case "rematch_propose":
        return this.onRematchPropose(ws);
      case "rematch_accept":
        return this.onRematchAccept(ws);
      case "rematch_decline":
        return this.onRematchDecline(ws);
      case "chat":
        return this.onChat(ws, msg.text);
      case "set_length":
        return this.onSetLength(ws, msg.wordLength);
      case "set_rows":
        return this.onSetRows(ws, msg.rows);
      case "set_edition":
        return this.onSetEdition(ws, msg.edition);
      case "set_mode":
        return this.onSetMode(ws, msg.mode);
      case "rename":
        return this.onRename(ws, msg.name);
      case "reveal_letter":
        return this.onRevealLetter(ws, msg.known);
      case "vowel_count":
        return this.onVowelCount(ws);
      case "resign":
        return this.onResign(ws);
      case "ping":
        // Client heartbeat — round-trip with no state change so the network path
        // and DO both stay warm and the client can detect a dead conn faster.
        this.send(ws, { type: "pong" });
        return;
    }
  }

  private async onHello(
    ws: WebSocket,
    usernameRaw: string,
    wordLength?: number,
    edition?: string,
    mode?: RoomMode,
    scienceOptOut = false,
    isPublic = false,
    sessionToken?: string,
    lane?: "vanilla" | "wild",
  ): Promise<void> {
    // Trust model is intentional: identity is passwordless by product decision (a casual
    // word game — "kindness model", see spec 2026-05-31-username-identity). The client-
    // supplied username is taken at face value; control is shared, owner is bookkeeping only.
    // Hardening (signed sessions / email recovery) is a deliberate future layer.
    const username = (usernameRaw ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);
    if (username.length < 3) {
      this.send(ws, { type: "error", message: "bad username" });
      return;
    }
    // Seeded room: a human must not claim ANY persona's username (each === a persona id),
    // else the `existing` lookup below would treat them as the bot reconnecting. Reject
    // before that lookup. (Review fix, defect 19.)
    if (this.state.seed && this.state.seed.personaIds.includes(username)) {
      this.sendArenaHandoffOrFull(ws);
      return;
    }
    // Auth seam (P0): if the client presented a session token, ask the owning User DO whether
    // it's valid and stow the verdict on the WS attachment — NEVER on PlayerState (which is
    // broadcast). Casual play sends no token → no extra DO hop. Best-effort: a hiccup ⇒ unauthed.
    let authed = false;
    if (sessionToken) {
      try {
        const res = await this.env.USER.get(this.env.USER.idFromName(username))
          .fetch(`https://do/account/verify-session?username=${encodeURIComponent(username)}`, {
            method: "POST",
            body: JSON.stringify({ sessionToken }),
            headers: { "content-type": "application/json" },
          });
        if (res.ok) authed = !!((await res.json()) as { valid?: boolean }).valid;
      } catch (e) { console.error("verify-session failed", username, (e as Error).message); }
    }
    ws.serializeAttachment({ username, authed });

    const existing = this.state.players.find((p) => p.username === username);
    if (existing) {
      const wasOffline = !existing.connected;
      existing.connected = true;
      existing.scienceOptOut = !!scienceOptOut;
      if (wasOffline && !this.state.isDaily) this.pushSystem(`${username} reconnected`);
    } else {
      // Seeded room = exactly 1 persona (bot) + 1 human. A 2nd distinct human gets
      // handed the share challenge (same word + ghosts) instead of a dead-end.
      if (this.state.seed && this.state.players.some((p) => !p.isBot)) {
        this.sendArenaHandoffOrFull(ws);
        return;
      }
      if (!this.state.isDaily && this.state.players.length >= MAX_PLAYERS) {
        this.send(ws, { type: "error", message: "room full" });
        return;
      }
      const role: "duelist" | "queued" = this.isDuelRoom() ? nextSeatRole(this.state.players) : "duelist";
      this.state.players.push({
        username,
        connected: true,
        guesses: [],
        status: "playing",
        ready: false,
        role,
        scienceOptOut: !!scienceOptOut,
        revealHints: 0,
        vowelHints: 0,
        points: 0,
        pointsSpent: 0,
      });
      if (this.isDuelRoom() && role === "queued") this.state.queue.push(username);
      // The room's default word length follows its owner's preference, and only in a
      // pristine lobby. Anyone can still change it mid-lobby via set_length (shared control).
      if (
        username === this.state.owner &&
        wordLength != null &&
        isSupportedSize(wordLength) &&
        this.state.phase === "lobby" &&
        this.state.round === 0
      ) {
        this.state.wordLength = wordLength;
        this.state.maxGuesses = guessesFor(wordLength);
      }
      // Likewise the room's theme is seeded from its owner's current edition, only in a
      // pristine lobby. After that, anyone changes it live via set_edition (shared control).
      if (
        username === this.state.owner &&
        edition != null &&
        this.state.phase === "lobby" &&
        this.state.round === 0
      ) {
        this.state.edition = sanitizeEdition(edition);
      }
      // Likewise the room's game mode is seeded from its owner's choice, only in a pristine
      // lobby. After that, anyone changes it via set_mode (shared control).
      if (
        username === this.state.owner &&
        isAvailableMode(mode) &&
        this.state.phase === "lobby" &&
        this.state.round === 0
      ) {
        this.state.mode = mode;
      }
      // The room's lane follows its (possibly just-seeded) mode default, with an optional
      // explicit override — owner-only, pristine lobby. The override is dormant until a
      // creation-toggle UI sends `lane`; today this keeps the lane consistent with the mode.
      if (
        username === this.state.owner &&
        this.state.phase === "lobby" &&
        this.state.round === 0
      ) {
        this.state.ruleset = seededRuleset(this.state.mode, lane);
      }
      // A public Arena room opts into the open-games index at creation (owner, fresh lobby).
      if (
        isPublic &&
        username === this.state.owner &&
        this.state.phase === "lobby" &&
        this.state.round === 0
      ) {
        this.state.publicArena = true;
      }
      if (!this.state.isDaily) this.pushSystem(`${username} joined`);
    }

    // Register this player in the directory so profiles are discoverable (sitemap). Best-effort.
    try {
      await this.env.DIRECTORY.put(`user:${username}`, "1");
    } catch (e) {
      console.error("user register failed", username, (e as Error).message);
    }

    // Register the room under its owner (directory + owner profile) — best effort.
    if (username === this.state.owner) {
      void this.registerRoom();
    }
    await this.seedDailyIfNeeded();
    // A published wordul at <owner>/<slug> seeds the same one-shot engine (cheap no-op for
    // daily rooms — they already set isDaily+word above — and for non-wordul custom rooms).
    await this.seedWordulIfNeeded();
    // Daily gold is mint-confirmed: if a player finished but a prior mint failed (scored
    // still false), retry now that they're back. Idempotent — scorePlayer only marks
    // scored on a confirmed ledger write.
    if (this.state.isDaily) {
      const p = this.state.players.find((x) => x.username === username);
      if (p && p.status !== "playing" && !p.scored) await this.afterPlayerStatus(p);
    }
    this.ensureBots();
    // Seeded Arena room: the instant a human is connected, FILL the remaining seats with bots
    // (to capacity) and enter the 3-2-1 — the countdown alarm flips the race live through
    // runStart (the duel machinery, reused; the client overlay keys off the phase). Delist
    // from the open index NOW: a human committed; the 1-human cap hands off any 2nd visitor.
    if (
      this.state.seed &&
      this.state.phase === "lobby" &&
      this.state.players.some((p) => !p.isBot && p.connected)
    ) {
      this.ensureBots(this.state.seed.capacity);
      this.closeArena();
      await this.beginCountdown();
    }
    // Public human Arena room: list it in the open index while it waits in the lobby.
    // runStart/finishGame close it. Best-effort; a refresh just re-asserts the listing.
    // A human is here, so cancel any pending abandon-delist (this hello may be the host
    // returning within the grace window) and re-publish.
    if (this.state.publicArena && this.state.phase === "lobby") {
      if (this.state.abandonAt != null) {
        this.state.abandonAt = null;
        void this.ctx.storage.deleteAlarm();
      }
      this.publishArena();
    }
    await this.persistAndBroadcast();
  }

  // A daily room (path daily/<date>) pulls its World from the DAILY DO on first
  // contact and locks to it: the word never changes, the board goes straight to
  // "playing" (no host start), and the theme/story come from the World. Server→server
  // so the word never reaches a still-playing client. Idempotent — seeds once.
  private async seedDailyIfNeeded(): Promise<void> {
    const date = dailyDateOf(this.state.path);
    if (!date) return;                 // not a daily room
    if (date > activeDate(Date.now())) return; // future day → unplayable, never seed (anti gold-farm)
    if (this.state.isDaily && this.state.word) return; // already seeded
    try {
      const res = await this.env.DAILY.get(this.env.DAILY.idFromName("daily"))
        .fetch(`https://do/resolve?date=${date}`);
      if (!res.ok) {
        console.error("seedDaily resolve non-ok", this.state.path, res.status);
        this.pushSystem("Today's Wordul is warming up — refresh in a sec.");
        return;
      }
      const world = (await res.json()) as {
        word: string; edition: string; voice: string;
        story: { title: string; body: string; tip?: string };
        colorScheme?: { a1: string; a2: string; a3: string };
        vibeTitle?: string;
      };
      const word = (world.word ?? "").toUpperCase();
      if (!/^[A-Z]+$/.test(word)) {
        console.error("seedDaily empty/invalid word", this.state.path, JSON.stringify(world.word));
        this.pushSystem("Today's Wordul is warming up — refresh in a sec.");
        return;
      }
      this.applySeededWorld(world);
    } catch (e) {
      console.error("seedDaily failed", this.state.path, (e as Error).message);
      this.pushSystem("Today's Wordul is warming up — refresh in a sec.");
    }
  }

  // Apply a resolved one-shot World to room state: lock the word, theme/story/palette,
  // and flip the board straight to "playing". Shared by seedDailyIfNeeded and
  // seedWordulIfNeeded so a daily room and a wordul room have identical post-seed setup.
  private applySeededWorld(world: {
    word: string; edition: string; voice: string;
    story: { title: string; body: string; tip?: string };
    colorScheme?: { a1: string; a2: string; a3: string };
    vibeTitle?: string;
  }): void {
    const word = (world.word ?? "").toUpperCase();
    this.state.isDaily = true;
    this.state.word = word;
    this.state.wordLength = word.length;
    this.state.maxGuesses = guessesFor(word.length);
    this.state.edition = world.edition || "default";
    this.state.ruleset = { ...VANILLA }; // one-shot puzzles (daily + wordul) are the fair flagship board
    this.state.voice = world.voice || "yang";
    this.state.story = world.story ?? null;
    this.state.colorScheme = world.colorScheme ?? null;
    this.state.vibeTitle = world.vibeTitle;
    this.state.phase = "playing";    // async one-shot: always live, no lobby
    this.state.round = 1;
    this.state.startedAt = this.state.startedAt ?? Date.now();
    this.emitRoundStarted();
  }

  // True when this room is playing a published wordul (path <owner>/<slug>, seeded to
  // isDaily) rather than the calendar daily (path daily/<date>). The discriminator:
  // isDaily is set, but the path is NOT a daily date. Used to count plays + gate gold.
  private isWordulRoom(): boolean {
    return !!this.state.isDaily && !dailyDateOf(this.state.path);
  }

  // A room whose path is <owner>/<slug> AND matches a published wordul plays like a daily:
  // locked word, straight to "playing", theme/story from the wordul. Resolves server→server
  // from the owner's Worduls DO (which locks the word). Idempotent — seeds once.
  private async seedWordulIfNeeded(): Promise<void> {
    if (this.state.isDaily && this.state.word) return; // already seeded (daily or wordul)
    const [owner, slug] = this.state.path.split("/");
    if (!owner || !slug || dailyDateOf(this.state.path)) return; // not an owner/slug room
    try {
      const res = await this.env.WORDULS.get(this.env.WORDULS.idFromName(owner))
        .fetch(`https://do/resolve?slug=${encodeURIComponent(slug)}`);
      if (res.status === 404) return; // not a wordul → normal custom room, leave untouched
      if (!res.ok) { this.pushSystem("This wordul is warming up — refresh in a sec."); return; }
      const world = (await res.json()) as {
        word: string; edition: string; voice: string; rows?: number;
        story: { title: string; body: string; tip?: string };
        colorScheme?: { a1: string; a2: string; a3: string }; vibeTitle?: string;
      };
      const word = (world.word ?? "").toUpperCase();
      if (!/^[A-Z]+$/.test(word)) { this.pushSystem("This wordul is warming up — refresh in a sec."); return; }
      this.applySeededWorld(world);
    } catch (e) {
      console.error("seedWordul failed", this.state.path, (e as Error).message);
    }
  }

  private async registerRoom(): Promise<void> {
    if (this.state.isDaily) return; // daily rooms are NOT directory-discoverable
    const [owner, slug] = this.state.path.split("/");
    if (!owner || !slug) return;
    try {
      await this.env.DIRECTORY.put(`room:${this.state.path}`, JSON.stringify({ name: this.state.name }));
      await this.env.USER.get(this.env.USER.idFromName(owner)).fetch(`https://do/room?username=${encodeURIComponent(owner)}`, {
        method: "POST",
        body: JSON.stringify({ slug, name: this.state.name, lastPlayedAt: Date.now() }),
      });
    } catch (e) {
      console.error("registerRoom failed", this.state.path, (e as Error).message);
    }
  }

  private async onRename(ws: WebSocket, nameRaw: string): Promise<void> {
    const name = (nameRaw ?? "").replace(/[\x00-\x1f\x7f<>]/g, "").trim().slice(0, 40);
    if (!name) return;
    this.state.name = name;
    this.pushSystem(`Room renamed to “${name}”`);
    await this.adoptSlug(normalizeSlug(name));
    void this.registerRoom();
    await this.persistAndBroadcast();
  }

  // Point the room's URL at a new slug. The DO key (this.state.path) never moves;
  // instead we register a KV alias so the new slug — and every previous one — keeps
  // resolving to this same room. No reconnect, no state migration.
  private async adoptSlug(next: string): Promise<void> {
    if (!next || next === this.state.slug) return;
    const aliasPath = `${this.state.owner}/${next}`;
    if (aliasPath === this.state.path) {
      // Renamed back to the canonical slug — just point the display there.
      this.state.slug = next;
      return;
    }
    try {
      // Don't hijack a distinct room that already lives at this path.
      const taken = await this.env.DIRECTORY.get(`room:${aliasPath}`);
      const existingAlias = await this.env.DIRECTORY.get(`roomalias:${aliasPath}`);
      if (taken && existingAlias !== this.state.path) return;
      await this.env.DIRECTORY.put(`roomalias:${aliasPath}`, this.state.path);
      this.state.slug = next;
    } catch (e) {
      console.error("adoptSlug failed", aliasPath, (e as Error).message);
    }
  }

  private async onSetLength(ws: WebSocket, length: number): Promise<void> {
    if (this.state.isDaily) return; // daily word/theme are locked by the World
    if (this.state.phase !== "lobby") {
      this.send(ws, { type: "error", message: "can't change length mid-game" });
      return;
    }
    if (!isSupportedSize(length)) {
      this.send(ws, { type: "error", message: "unsupported word length" });
      return;
    }
    if (length === this.state.wordLength) return;
    this.state.wordLength = length;
    this.state.maxGuesses = guessesFor(length);
    const who = this.userFor(ws) ?? "someone";
    this.pushSystem(`${who} set word length to ${length}`);
    await this.persistAndBroadcast();
  }

  // Rows override: set maxGuesses directly, independent of letters. Mirrors onSetLength's
  // guards (lobby-only, not daily) and persist/broadcast. Out-of-range values are clamped
  // to [MIN_ROWS, MAX_ROWS]. Note: a later set_length resets maxGuesses to guessesFor(len).
  private async onSetRows(ws: WebSocket, rows: number): Promise<void> {
    if (this.state.isDaily) return; // daily word/theme are locked by the World
    if (this.state.phase !== "lobby") {
      this.send(ws, { type: "error", message: "can't change rows mid-game" });
      return;
    }
    if (typeof rows !== "number" || !Number.isFinite(rows)) {
      this.send(ws, { type: "error", message: "unsupported row count" });
      return;
    }
    const clamped = clampRows(rows);
    if (clamped === this.state.maxGuesses) return;
    this.state.maxGuesses = clamped;
    const who = this.userFor(ws) ?? "someone";
    this.pushSystem(`${who} set rows to ${clamped}`);
    await this.persistAndBroadcast();
  }

  // Theme is shared room state: anyone in the room can change it, and the new theme
  // broadcasts to everyone. Blocked mid-game so the look never shifts under a live board.
  // The id is only sanitized, not whitelisted — an unknown id renders the default theme
  // client-side (getEdition falls back), matching the game's passwordless "kindness model".
  private async onSetEdition(ws: WebSocket, editionRaw: string): Promise<void> {
    if (this.state.isDaily) return; // daily word/theme are locked by the World
    if (this.state.phase === "playing") {
      this.send(ws, { type: "error", message: "can't change theme mid-game" });
      return;
    }
    const edition = sanitizeEdition(editionRaw);
    if (edition === this.state.edition) return;
    this.state.edition = edition;
    const who = this.userFor(ws) ?? "someone";
    this.pushSystem(`${who} set the theme to ${edition}`);
    await this.persistAndBroadcast();
  }

  private async onSetMode(ws: WebSocket, mode: RoomMode): Promise<void> {
    if (this.state.isDaily) return; // daily word/theme are locked by the World
    if (this.state.phase !== "lobby") {
      this.send(ws, { type: "error", message: "can't change mode mid-game" });
      return;
    }
    if (!isAvailableMode(mode)) {
      this.send(ws, { type: "error", message: "mode not available" });
      return;
    }
    if (mode === this.state.mode) return;
    this.state.mode = mode;
    const who = this.userFor(ws) ?? "someone";
    this.pushSystem(`${who} set mode to ${mode}`);
    await this.persistAndBroadcast();
  }

  private async onStart(ws: WebSocket): Promise<void> {
    // Thin wrapper: the manual-start path keeps error feedback via the optional ws.
    await this.runStart(this.userFor(ws) ?? "someone", ws);
  }

  // The single startable core. Owns ALL start guards so both the human "start" message and
  // the seeded auto-start (onHello) go through exactly one path. When `ws` is present, guard
  // failures send an error to that socket; otherwise (auto-start) they log and return false.
  private async runStart(who: string, ws?: WebSocket): Promise<boolean> {
    if (this.state.phase === "playing") return false;
    if (this.state.isDaily) return false; // daily auto-starts on seed; no manual start
    // Death is final: a challenge is ONE run per player (the /attempt scoring was always
    // one-shot — a replay of the same pinned word rendered as a real win but never counted).
    if (challengeRoundLocked(this.state.challengeId ?? null, this.state.round)) {
      if (ws) this.send(ws, { type: "error", message: "One run per challenge — your score is locked." });
      return false;
    }
    this.ensureBots();
    if (this.state.players.length < 1) return false;
    const pool = WORDS_BY_SIZE[this.state.wordLength];
    if (!pool || pool.answers.length === 0) {
      if (ws) this.send(ws, { type: "error", message: "no words available for that length" });
      else console.error("runStart: no words for length", this.state.wordLength);
      return false;
    }
    if (this.state.challengeId) {
      // Challenge room: ALWAYS play the pinned word (even on rematch), fetched
      // server→server so the answer never touches the client.
      const cs = this.env.CHALLENGE.get(this.env.CHALLENGE.idFromName(this.state.challengeId));
      const res = await cs.fetch(new Request("https://do/word", { method: "GET" }));
      if (res.ok) {
        const { word, wordLength } = (await res.json()) as { word: string; wordLength: number };
        this.state.word = word ?? null;
        this.state.wordLength = wordLength ?? this.state.wordLength;
        this.state.maxGuesses = guessesFor(this.state.wordLength);
      } else {
        if (ws) this.send(ws, { type: "error", message: "challenge unavailable" });
        else console.error("runStart: challenge unavailable", this.state.challengeId);
        return false;
      }
    } else {
      this.state.word = pool.answers[Math.floor(Math.random() * pool.answers.length)] ?? null;
    }
    if (!this.state.word) return false;
    // Seeded Arena: publish this round's word as a challenge so a late visitor to the
    // shared link races the same word (+ the field's ghost tape, filed at finish).
    // Awaited — the handoff path needs the id now — but a mint hiccup only costs the
    // late-visitor experience; the race itself starts regardless.
    if (this.state.seed && !this.state.challengeId) {
      this.state.shareChallengeId = null;
      const host = this.state.players.find((p) => !p.isBot)?.username ?? this.state.owner;
      const id = makeChallengeId();
      try {
        const cs = this.env.CHALLENGE.get(this.env.CHALLENGE.idFromName(id));
        const res = await cs.fetch(new Request("https://do/", {
          method: "POST",
          body: JSON.stringify({ id, word: this.state.word, wordLength: this.state.wordLength, owner: host, ownerScore: "", ownerGrid: [] }),
          headers: { "content-type": "application/json" },
        }));
        if (res.ok) this.state.shareChallengeId = id;
        else console.error("share-challenge mint non-ok", res.status);
      } catch (e) { console.error("share-challenge mint failed", (e as Error).message); }
      this.state.tape = newTape(this.state.wordLength, this.state.maxGuesses,
        this.state.players.map((p) => ({ username: p.username, host: !p.isBot })));
    }
    this.state.phase = "playing";
    this.state.winner = null;
    this.state.startedAt = Date.now();
    this.state.finishedAt = null;
    this.state.round += 1;
    for (const p of this.state.players) {
      p.guesses = [];
      p.status = "playing";
      p.points = 0;
      p.pointsSpent = 0;
      p.revealHints = 0;
      p.vowelHints = 0;
      p.firstGuessAt = undefined;
      p.finishedAt = undefined;
      p.guessAts = undefined;
      p.receipt = undefined;
    }
    this.pushSystem(`${who} started the race${this.state.round > 1 ? ` (round ${this.state.round})` : ""}`);
    this.emitRoundStarted();
    this.armBotHeartbeat(true);
    this.closeArena(); // once it starts, it's no longer an open game (no-op for normal rooms)
    await this.persistAndBroadcast();
    return true;
  }

  // --- Duel: 1v1 seats + king-of-the-hill + ready-gate countdown ----------------
  // Normal / public / robots rooms are duel rooms: two duelists play, the rest queue,
  // and the winner is rotated against the queue (KOTH). Daily, seeded-Arena, and challenge
  // rooms are NOT duel rooms — they keep the classic start + rematch-handshake flow.
  private isDuelRoom(): boolean {
    return !this.state.isDaily && !dailyDateOf(this.state.path) && !this.state.seed && !this.state.challengeId;
  }

  /** The (up to two) players currently holding a duel seat. */
  private duelists(): PlayerState[] {
    return this.state.players.filter((p) => p.role === "duelist");
  }

  /** Reset readiness for the next ready-gate. Wordulers stay ready (they never tap Ready),
   *  so a human-vs-worduler duel advances round to round on the human's single tap. */
  private resetReady(): void {
    for (const p of this.state.players) p.ready = !!p.isBot;
  }

  /** Players whose results count this round: duelists in a duel room, else everyone.
   *  Falls back to all players if seats were never assigned (legacy/hand-built state) —
   *  in real runtime isGameOver requires a live duelist, so this only guards edge cases. */
  private finishParticipants(): PlayerState[] {
    if (!this.isDuelRoom()) return this.state.players;
    const ds = this.duelists();
    return ds.length ? ds : this.state.players;
  }

  // A duelist toggles ready / taps "Challenge 👑". When every connected duelist is ready —
  // in the lobby OR the between-rounds finished intermission — the 3-2-1 countdown begins.
  private async onReady(ws: WebSocket, ready: boolean): Promise<void> {
    if (!this.isDuelRoom()) return;
    if (this.state.phase !== "lobby" && this.state.phase !== "finished") return;
    const username = this.userFor(ws);
    const player = username ? this.state.players.find((p) => p.username === username) : null;
    if (!player || player.role !== "duelist") return; // only duelists ready up; spectators wait in the queue
    player.ready = !!ready;
    this.ensureBots(); // a worduler in the room counts toward the gate
    for (const p of this.state.players) if (p.isBot) p.ready = true; // wordulers are always ready
    if (everyoneReady(this.duelists())) { await this.beginCountdown(); return; }
    await this.persistAndBroadcast();
  }

  // Enter the 3-2-1 countdown. Stamp goAt + arm the DO alarm to flip the round live; the
  // word pick + board/economy reset are deferred to goLive→runStart so round-init runs the
  // single existing start path (challenge word, science emit, bot tick). Duel rooms never
  // have a rematch alarm pending, so a plain setAlarm can't clobber one.
  private async beginCountdown(): Promise<void> {
    this.state.phase = "countdown";
    this.state.goAt = Date.now() + COUNTDOWN_MS;
    this.resetReady(); // consumed; humans reset, wordulers stay ready
    this.pushSystem(`Get ready — round ${this.state.round + 1}`);
    void this.ctx.storage.setAlarm(this.state.goAt);
    await this.persistAndBroadcast();
  }

  // The countdown alarm fired: start the round through the shared runStart core, then align
  // startedAt to the synchronized goAt so every client's clock agrees on the start instant.
  private async goLive(): Promise<void> {
    const goAt = this.state.goAt;
    this.state.goAt = null;
    const ok = await this.runStart(this.state.seed ? "arena" : (this.state.throne?.username ?? "the duel"));
    if (ok) {
      if (goAt) { this.state.startedAt = goAt; await this.persistAndBroadcast(); }
    } else {
      // No word / guard failed — fall back to the lobby so the room isn't stuck mid-countdown.
      this.state.phase = "lobby";
      await this.persistAndBroadcast();
    }
  }

  // A duelist dropped during the 3-2-1 — abort back to the lobby and re-ready everyone.
  private async cancelCountdown(): Promise<void> {
    this.state.phase = "lobby";
    this.state.goAt = null;
    this.resetReady();
    try { await this.ctx.storage.deleteAlarm(); } catch { /* nothing pending */ }
    this.pushSystem("Countdown cancelled — ready up again");
    await this.persistAndBroadcast();
  }

  // King-of-the-hill advance, applied when a duel round ends. Winner keeps the throne
  // (streak++), loser drops to the back of the queue, the next challenger steps up; a tie
  // keeps the reigning king. Empty queue → the same two simply rematch. Pure: rotation.ts.
  private applyRotation(): void {
    if (this.state.rotation !== "koth") return;
    const current = this.duelists().map((p) => p.username);
    if (current.length < 2) {
      // Solo (one duelist): no rotation, but a solo win still grows the throne streak.
      if (this.state.winner && current.includes(this.state.winner)) {
        const prev = this.state.throne;
        this.state.throne = prev && prev.username === this.state.winner
          ? { username: this.state.winner, streak: prev.streak + 1 }
          : { username: this.state.winner, streak: 1 };
      }
      return;
    }
    const res = applyKothRotation({
      duelists: current,
      winner: this.state.winner,
      queue: this.state.queue,
      throne: this.state.throne,
    });
    const seated = new Set(res.duelists);
    const queued = new Set(res.queue);
    for (const p of this.state.players) {
      if (seated.has(p.username)) p.role = "duelist";
      else if (queued.has(p.username)) p.role = "queued";
    }
    this.state.queue = res.queue;
    this.state.throne = res.throne;
    if (res.throne) this.pushSystem(`👑 ${res.throne.username} holds the throne — ${res.throne.streak} in a row`);
  }

  private async onGuess(ws: WebSocket, wordRaw: string): Promise<void> {
    if (this.state.phase !== "playing" || !this.state.word) {
      this.send(ws, { type: "error", message: "game not in progress" });
      return;
    }
    const username = this.userFor(ws);
    if (!username) return;
    const player = this.state.players.find((p) => p.username === username);
    if (!player || player.status !== "playing") return;
    if (this.isDuelRoom() && player.role !== "duelist") return; // spectators in the queue can't guess
    if (player.guesses.length >= this.state.maxGuesses) return;

    const len = this.state.wordLength;
    const word = (wordRaw ?? "").toUpperCase().trim();
    if (word.length !== len || !/^[A-Z]+$/.test(word)) {
      this.send(ws, { type: "invalid_guess", reason: `must be ${len} letters` });
      return;
    }
    const pool = WORDS_BY_SIZE[len];
    if (!pool?.valid.has(word)) {
      this.send(ws, { type: "invalid_guess", reason: "not in word list" });
      return;
    }

    await this.applyGuess(player, word);
    await this.persistAndBroadcast();
  }

  // Live-typing pulse: relay a player's current row LENGTH to everyone else so opponents
  // see ghost cells fill/clear in real time. Deliberately ephemeral — NO storage write and
  // NO snapshot (keystrokes must not hammer DO storage), and it carries a count only, never
  // letters, preserving the same hidden-word rule as the spectator boards. Clients clear a
  // ghost on their own when a guess commits / a player goes out, so there's no reset to send.
  private onTyping(ws: WebSocket, lenRaw: number): void {
    if (this.state.phase !== "playing" || this.state.isDaily) return; // no opponents to show in daily
    const username = this.userFor(ws);
    if (!username) return;
    const player = this.state.players.find((p) => p.username === username);
    if (!player || player.status !== "playing") return;
    const n = Number.isFinite(lenRaw) ? Math.floor(lenRaw) : 0;
    const len = Math.max(0, Math.min(this.state.wordLength, n));
    if (this.state.tape && this.state.seed && this.state.startedAt) {
      tapePush(this.state.tape, { t: this.tapeT(Date.now()), u: username, k: "typing", len });
    }
    const payload = JSON.stringify({ type: "typing", username, len } satisfies ServerMessage);
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue; // never echo a player their own typing
      try {
        other.send(payload);
      } catch {
        // socket may be closing; ignore
      }
    }
  }

  // Bot counterpart to onTyping: broadcast a count-only ghost-fill pulse for a (socket-less) bot.
  // Same wire shape as a human's relay, sent to everyone (the bot has no socket to skip). Ephemeral
  // — no storage write, no snapshot. Guards mirror onTyping so it no-ops once the round is over.
  private emitBotTyping(username: string, len: number): void {
    if (this.state.phase !== "playing" || this.state.isDaily) return;
    const bot = this.state.players.find((p) => p.username === username);
    if (!bot || !bot.isBot || bot.status !== "playing") return;
    const n = Math.max(0, Math.min(this.state.wordLength, Math.floor(len)));
    if (this.state.tape && this.state.seed && this.state.startedAt) {
      tapePush(this.state.tape, { t: this.tapeT(Date.now()), u: username, k: "typing", len: n });
    }
    const payload = JSON.stringify({ type: "typing", username, len: n } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch { /* socket may be closing; ignore */ }
    }
  }

  // Type a decided word out as real-time ghost-fill pulses, pausing between keystrokes. This is
  // AWAITED by alarm(), so the DO stays awake the whole time and the setTimeout pauses actually
  // fire — a dormant DO (between alarm fires) never runs timers, which is why scheduling pulses
  // and returning collapsed the whole word into one burst. Stops early if the round ends mid-type.
  // Ephemeral: emitBotTyping does no storage writes.
  private async typeOutBot(username: string, steps: KeyStep[]): Promise<void> {
    let prev = 0;
    for (const step of steps) {
      const gap = Math.max(0, step.atMs - prev);
      prev = step.atMs;
      if (gap) await new Promise<void>((resolve) => setTimeout(resolve, gap));
      if (this.state.phase !== "playing") return; // round ended — stop typing
      this.emitBotTyping(username, step.len);
    }
  }

  // Shared guess core — both human onGuess (after validation) and the bot alarm call this,
  // so there is exactly ONE scoring/win path. Assumes `word` is a validated uppercase guess.
  private async applyGuess(player: PlayerState, word: string): Promise<void> {
    const now = Date.now();
    const priorStatus = player.status;
    const hadWinner = this.state.winner !== null;
    const mask = scoreGuess(word, this.state.word!);
    player.guesses.push({ word, mask });
    // Per-player solve clock: stamp on the FIRST accepted guess (start of the daily
    // solve duration + the wall-clock time bonus at mint). Never overwrite once set.
    if (player.firstGuessAt == null) player.firstGuessAt = now;
    // Capture real per-guess offset from round GO (startedAt). Stored on state.players so it
    // survives to finish time and gets copied into the GameRecord (for exact ghost replay on
    // future ?vs= / word challenges). Uses the same tapeT() helper the arena ghost tapes use.
    if (!player.guessAts) player.guessAts = [];
    const off = this.tapeT ? (this.tapeT(now) ?? 0) : 0;
    player.guessAts.push(off);
    // Spend accounting (spec §A): in WOTD power-ups cost real gold only, NOT round score —
    // so the daily round score EXCLUDES pointsSpent. Race rooms still net out the spend.
    const earned = pointsEarned(player.guesses, this.state.maxGuesses);
    player.points = this.state.isDaily ? earned : earned - player.pointsSpent;
    const allGreen = mask.every((c) => c === "hot");
    if (allGreen) {
      player.status = "won";
      if (!this.state.winner) this.state.winner = player.username;
      // Announce the solve right away (others may still be racing) but WITHOUT the word:
      // the per-viewer snapshot already gives the winner the answer; anyone still playing
      // must not see it. The remaining players keep going for their own gold/score.
      this.pushSystem(`${player.username} got it in ${player.guesses.length}!`);
    } else if (player.guesses.length >= this.state.maxGuesses) {
      player.status = "lost";
    }
    if (this.state.tape && this.state.seed && this.state.startedAt) {
      tapePush(this.state.tape, { t: this.tapeT(now), u: player.username, k: "guess", mask, status: player.status });
    }
    this.emitAcceptedGuess(player, mask, now);
    if (priorStatus === "playing" && player.status !== "playing") {
      player.finishedAt = now;
      this.emitPlayerFinished(player, player.status === "won" ? "won" : "lost", now);
      if (this.state.tape && this.state.seed && this.state.startedAt) {
        tapePush(this.state.tape, { t: this.tapeT(now), u: player.username, k: "finish", status: player.status === "won" ? "won" : "lost", guesses: player.guesses.length });
      }
    }
    // First solve ends the race for everyone (live, non-daily rooms — Arena AND
    // Friends). Flip the still-playing others to `lost` so they carry a real status
    // into the snapshot and emitPlayerFinished fires for science/records/H2H. The
    // existing afterPlayerStatus → maybeFinish then finds isGameOver() and finishes.
    if (!hadWinner && this.state.winner && !this.state.isDaily) {
      const racers = this.isDuelRoom() ? this.duelists() : this.state.players;
      for (const username of outpacedLosers(racers, this.state.winner)) {
        const other = this.state.players.find((p) => p.username === username);
        if (other) {
          other.status = "lost";
          if (other.finishedAt == null) other.finishedAt = now;
          this.emitPlayerFinished(other, "lost", now);
          if (this.state.tape && this.state.seed && this.state.startedAt) {
            tapePush(this.state.tape, { t: this.tapeT(now), u: other.username, k: "finish", status: "lost", guesses: other.guesses.length });
          }
        }
      }
    }
    // Post the finished human's result: to the pinned challenge this room is PLAYING
    // (challengeId), or to the challenge this seeded room PUBLISHED (shareChallengeId).
    const cid = this.state.challengeId ?? this.state.shareChallengeId;
    if (cid && (player.status === "won" || player.status === "lost") && !player.isBot) {
      const solved = player.status === "won";
      const score = solved ? `${player.guesses.length}/${this.state.maxGuesses}` : `X/${this.state.maxGuesses}`;
      const cs = this.env.CHALLENGE.get(this.env.CHALLENGE.idFromName(cid));
      this.ctx.waitUntil(cs.fetch(new Request("https://do/attempt", {
        method: "POST",
        body: JSON.stringify({ username: player.username, score, solved, guesses: player.guesses.length }),
        headers: { "content-type": "application/json" },
      })));
      // Seeded share-challenge: the human IS the challenge owner — stamp their real
      // result + color grid onto the card late visitors see.
      if (cid === this.state.shareChallengeId) {
        this.ctx.waitUntil(cs.fetch(new Request("https://do/owner-result", {
          method: "POST",
          body: JSON.stringify({ ownerScore: score, ownerGrid: encodeSolveGrid(player.guesses) }),
          headers: { "content-type": "application/json" },
        })));
      }
    }
    await this.afterPlayerStatus(player);
  }

  // --- Slice 0: the robot room ------------------------------------------------------
  // One themed room (slug "robots") always has a worduler. No memory, no Agent DO yet —
  // it reasons only from its own guesses + the colors it got back, never the answer.

  private isRobotRoom(): boolean {
    return this.state.slug === ROBOT_SLUG;
  }

  // Seeded Arena room: inject DISTINCT persona bots (username = persona id) until the room has
  // `target` players total (capped at MAX_PLAYERS), pulling ids from the seeded roster in order
  // and skipping any already present. /robots (not seeded) keeps its single labeled clanker.
  // `target` defaults to the current player count → a no-arg call is a safe no-op for seeded
  // rooms (used by the generic onHello/runStart hooks).
  private ensureBots(target?: number): void {
    if (this.state.isDaily) return; // no worduler in the daily room
    if (!this.isRobotRoom() && !this.state.seed) return;
    if (this.state.seed) {
      const want = Math.min(target ?? this.state.players.length, MAX_PLAYERS);
      for (const id of this.state.seed.personaIds) {
        if (this.state.players.length >= want) break;
        if (this.state.players.some((p) => p.username === id)) continue;
        this.state.players.push({
          username: id,
          connected: true,
          guesses: [],
          status: "playing",
          isBot: true,
          ready: true,        // wordulers are always ready (gate-counting)
          role: "duelist",    // seeded Arena rooms aren't duel rooms; role is inert there
          scienceOptOut: true,
          revealHints: 0,
          vowelHints: 0,
          points: 0,
          pointsSpent: 0,
        });
      }
      return;
    }
    // /robots: exactly one labeled clanker (unchanged).
    if (this.state.players.some((p) => p.isBot)) return;
    if (this.state.players.length >= MAX_PLAYERS) return;
    const botName = BOT_NAME;
    const botRole: "duelist" | "queued" = this.isDuelRoom() ? nextSeatRole(this.state.players) : "duelist";
    this.state.players.push({
      username: botName,
      connected: true,
      guesses: [],
      status: "playing",
      isBot: true,
      ready: true, // a worduler is born ready — it counts toward the duel ready-gate like a person
      role: botRole,
      scienceOptOut: true,
      revealHints: 0,
      vowelHints: 0,
      points: 0,
      pointsSpent: 0,
    });
    if (this.isDuelRoom() && botRole === "queued") this.state.queue.push(botName);
    // The worduler joins like any other player — no "powered on" announcement (worduler cover rule).
  }

  // Join every persona whose play time has passed and start the existing heartbeat.
  // Bots walk the REAL paths — join, solver, applyGuess, scorePlayer, leaderboard —
  // so every daily tick doubles as a beta test of the human pipeline.
  private async handleWotdBotTick(): Promise<Response> {
    await this.seedDailyIfNeeded();
    if (!this.state.isDaily || !this.state.word) {
      return Response.json({ ok: false, reason: "not seeded" }, { status: 409 });
    }
    const date = dailyDateOf(this.state.path) ?? "";
    const present = new Set(this.state.players.map((p) => p.username));
    const due = dueWotdPersonas(date, Date.now(), present);
    for (const persona of due) {
      this.state.players.push({
        username: persona.id,
        connected: true,
        guesses: [],
        status: "playing",
        isBot: true,
        ready: true,
        role: "duelist",       // inert in daily rooms
        scienceOptOut: true,   // bots stay out of the Science aggregates (spec)
        revealHints: 0,
        vowelHints: 0,
        points: 0,
        pointsSpent: 0,
      });
    }
    if (due.length > 0) {
      this.armBotHeartbeat(true); // arm nextGuessAt + the DO alarm → runBotPump plays them
      await this.persistAndBroadcast();
    }
    return Response.json({ ok: true, joined: due.map((p) => p.id) });
  }

  // Arm every playing bot's next guess time, then set the single DO alarm to the soonest.
  // One alarm drives N bots (min-heap on one timer). Seeded (Arena) bots read slow/beatable;
  // /robots keeps the snappier beat. `opening` = the round just started (slower first guess).
  private armBotHeartbeat(opening: boolean): void {
    const seeded = !!this.state.seed || !!this.state.isDaily;
    const now = Date.now();
    let any = false;
    for (const p of this.state.players) {
      if (p.isBot && p.status === "playing") {
        p.nextGuessAt = now + botDelay(opening, seeded, Math.random());
        any = true;
      }
    }
    if (!any) return;
    const at = nextBotAlarmAt(this.state.players);
    if (at != null) void this.ctx.storage.setAlarm(at);
  }

  // DO alarm: the room's single heartbeat. In the PLAYING phase it paces the bot's
  // guesses (unchanged). In the FINISHED phase it drives the rematch handshake's
  // delayed wakes (bot decision + proposal timeout). The two phases are mutually
  // exclusive, so they never contend for the one alarm.
  async alarm(): Promise<void> {
    if (this.state.phase === "countdown") {
      // Duel go-live: the 3-2-1 elapsed. Flip the round live (countdown owns this phase alone).
      if (this.state.goAt && Date.now() >= this.state.goAt) await this.goLive();
      return;
    }
    if (this.state.phase === "finished") {
      await this.handleRematchAlarm(Date.now());
      return;
    }
    if (this.state.phase === "lobby") {
      // Abandon-close: the grace window elapsed. If no human came back, delist the room
      // from the open-games index (a returning host's hello re-publishes it later).
      if (this.state.abandonAt && Date.now() >= this.state.abandonAt && !hasConnectedHuman(this.state.players)) {
        this.state.abandonAt = null;
        this.closeArena();
        await this.persistAndBroadcast();
      }
      return;
    }
    if (this.state.phase !== "playing" || !this.state.word) return;
    await this.runBotPump();
  }

  // The typing pump: run every due bot's turn CONCURRENTLY, launching each the moment its
  // nextGuessAt arrives — even while other bots are mid-word — so ghost-fills overlap like a
  // real room of humans (the old sequential loop made bot B wait out bot A's whole type-out).
  // alarm() awaits this, keeping the DO awake while any turn is in flight (a dormant DO never
  // runs setTimeout — the same constraint typeOutBot documents). Exits when nothing is in
  // flight and no bot is due, then re-arms the single DO alarm to the soonest nextGuessAt.
  private async runBotPump(): Promise<void> {
    const inflight = new Map<string, Promise<void>>();
    while (this.state.phase === "playing") {
      const now = Date.now();
      for (const b of dueBots(this.state.players, now)) {
        if (inflight.has(b.username)) continue; // nextGuessAt is stale until its turn commits
        const turn = this.runBotTurn(b)
          .catch((err) => {
            // Push the bot forward so a thrown turn can't become a tight relaunch loop.
            console.error("bot turn failed", b.username, err);
            b.nextGuessAt = Date.now() + botDelay(false, !!this.state.seed, Math.random());
          })
          .finally(() => { inflight.delete(b.username); });
        inflight.set(b.username, turn);
      }
      if (inflight.size === 0) break;
      // Wake when a turn finishes OR the next NOT-in-flight bot comes due. In-flight bots
      // keep a past nextGuessAt until they commit — including them would make this race
      // resolve instantly and busy-spin.
      const waits: Promise<unknown>[] = [...inflight.values()];
      const wakeAt = nextBotAlarmAt(this.state.players.filter((p) => !inflight.has(p.username)));
      if (wakeAt != null) waits.push(new Promise<void>((r) => setTimeout(r, Math.max(0, wakeAt - now))));
      await Promise.race(waits);
    }
    if (this.state.phase === "playing") {
      const at = nextBotAlarmAt(this.state.players);
      if (at != null) void this.ctx.storage.setAlarm(at);
    }
  }

  // One bot's full turn: decide → type out in real time → commit. Self-contained so the pump
  // can run many turns concurrently. The solver/noob see ONLY a BotView (length + own masks)
  // — never this.state.word; the cheat-isolation wall is unchanged. Seeded rooms play the
  // fallible noob (mistakeRate scaled by length AND field size); /robots stays sharp.
  // Winner safety: applyGuess is synchronous up to its final await, so two turns finishing
  // near-simultaneously can't both claim state.winner.
  private async runBotTurn(b: PlayerState): Promise<void> {
    const seeded = !!this.state.seed || !!this.state.isDaily; // daily bots pace like people
    const opponents = this.state.players.length - 1;
    const view = { wordLength: this.state.wordLength, ownGuesses: b.guesses };
    const word = seeded
      ? noobGuess(view, { mistakeRate: mistakeRateFor(this.state.wordLength, this.state.seed ? opponents : 1) }, Math.random())
      : computeNextGuess(view);
    if (!word) { b.nextGuessAt = Date.now() + botDelay(false, seeded, Math.random()); return; }
    await this.typeOutBot(b.username, planKeystrokes(word, seeded ? NOOB_HAND : SHARP_HAND, Math.random));
    if (this.state.phase !== "playing" || b.status !== "playing") {
      // the round ended (or this bot was outpaced) while it was typing — drop the guess, no commit
      b.nextGuessAt = Date.now() + botDelay(false, seeded, Math.random());
      return;
    }
    await this.applyGuess(b, word);
    b.nextGuessAt = Date.now() + botDelay(false, seeded, Math.random()); // think before next row
    await this.persistAndBroadcast();
  }

  // Process whichever rematch deadlines are due, then re-arm for any that remain.
  // Order matters: a fired timeout cancels the proposal, after which the bot
  // decision finds no pending state and safely no-ops (no double resolution).
  private async handleRematchAlarm(now: number): Promise<void> {
    let changed = false;
    if (this.state.rematchTimeoutAt && now >= this.state.rematchTimeoutAt) {
      this.state.rematchTimeoutAt = null;
      const { rematch, effects } = rematchReduce(this.state.rematch ?? null, { kind: "timeout" });
      this.state.rematch = rematch;
      await this.applyRematchEffects(effects);
      changed = true;
    }
    if (this.state.phase === "finished" && this.state.botRematchAt && now >= this.state.botRematchAt) {
      this.state.botRematchAt = null;
      changed = true;
      const bot = this.state.players.find((p) => p.isBot);
      if (bot) {
        const { rematch, effects } = rematchReduce(this.state.rematch ?? null, {
          kind: "bot_decision", accept: botAccepts(Math.random()), bot: bot.username,
        });
        this.state.rematch = rematch;
        await this.applyRematchEffects(effects);
      }
    }
    // If accept→start fired, phase is now "playing" and runStart armed the bot tick;
    // don't re-arm rematch. Otherwise re-arm any still-future rematch deadline.
    if (this.state.phase === "finished") this.armRematchAlarm();
    if (changed) await this.persistAndBroadcast();
  }

  // Finish the round once every connected player is done — NOT the instant someone wins.
  // The winner was already announced; here we just reveal the word to everyone and record.
  private async maybeFinish(): Promise<void> {
    if (this.state.phase === "finished") return;
    if (!this.isGameOver()) return;
    this.state.phase = "finished";
    this.state.finishedAt = Date.now();
    this.pushSystem(
      this.state.winner
        ? `The word was ${this.state.word}`
        : `Nobody got it. The word was ${this.state.word}`,
    );
    await this.finishGame();
    if (this.isDuelRoom()) {
      // KOTH: rotate seats for the next matchup, then sit in the finished phase as the
      // between-rounds intermission. Duelists ready up (onReady accepts "finished") → countdown.
      this.applyRotation();
      this.resetReady();
      this.state.goAt = null;
    }
  }

  // A player gives up (💀 / bankruptcy). Mark them lost so others see them OUT, and so
  // the per-viewer snapshot can reveal the word to THEM (they're done) without leaking it
  // to players still guessing. Ends the game if they were the last one playing.
  private async onResign(ws: WebSocket): Promise<void> {
    const username = this.userFor(ws);
    if (!username || this.state.phase !== "playing") return;
    const player = this.state.players.find((p) => p.username === username);
    if (!player || player.status !== "playing") return;
    player.status = "lost";
    // Giving up forfeits the run: zero the live score now (vs running out of guesses,
    // which keeps whatever was earned). scorePlayer then mints 0 gold for resigners.
    player.resigned = true;
    player.points = 0;
    const now = Date.now();
    player.finishedAt = now;
    if (!this.isGameOver()) this.pushSystem(`${username} gave up`);
    this.emitPlayerFinished(player, "resigned", now);
    await this.afterPlayerStatus(player);
    await this.persistAndBroadcast();
  }

  // EZ-mode power-up: reveal one letter the player hasn't greened yet. Only the DO
  // holds the answer, so this must happen server-side. No state change, no broadcast —
  // the hint goes only to the requester.
  private async onRevealLetter(ws: WebSocket, known?: number[]): Promise<void> {
    if (this.state.phase !== "playing" || !this.state.word) return;
    if (!this.state.ruleset?.powerUps) { this.send(ws, { type: "error", message: "power-ups are off in this room" }); return; }
    const username = this.userFor(ws);
    const player = this.state.players.find((p) => p.username === username);
    if (!player || player.status !== "playing") return;
    if (player.points < POINTS.revealCost) { this.send(ws, { type: "error", message: "not enough points" }); return; }
    const hit = revealUngreened(this.state.word, player.guesses, known ?? []);
    if (!hit) { this.send(ws, { type: "error", message: "nothing left to reveal" }); return; }
    player.pointsSpent += POINTS.revealCost;
    player.points -= POINTS.revealCost;
    player.revealHints = (player.revealHints ?? 0) + 1;
    this.emitPowerupUsed(player, "reveal_letter", POINTS.revealCost);
    this.send(ws, { type: "revealed_letter", index: hit.index, letter: hit.letter });
    await this.persistAndBroadcast();
  }

  // EZ-mode power-up: how many vowels are in the answer. Requester-only.
  private async onVowelCount(ws: WebSocket): Promise<void> {
    if (this.state.phase !== "playing" || !this.state.word) return;
    if (!this.state.ruleset?.powerUps) { this.send(ws, { type: "error", message: "power-ups are off in this room" }); return; }
    const username = this.userFor(ws);
    const player = this.state.players.find((p) => p.username === username);
    if (!player || player.status !== "playing") return;
    if (player.points < POINTS.vowelCost) { this.send(ws, { type: "error", message: "not enough points" }); return; }
    player.pointsSpent += POINTS.vowelCost;
    player.points -= POINTS.vowelCost;
    player.vowelHints = (player.vowelHints ?? 0) + 1;
    this.emitPowerupUsed(player, "vowel_count", POINTS.vowelCost);
    this.send(ws, { type: "vowels", count: countVowels(this.state.word) });
    await this.persistAndBroadcast();
  }

  private emitRoundStarted(): void {
    const now = this.state.startedAt ?? Date.now();
    this.emitScience({
      ...this.scienceBase(now),
      type: "round_started",
      participantCount: this.state.players.filter((p) => this.scienceEnabled(p)).length,
      botCount: this.state.players.filter((p) => p.isBot).length,
    });
  }

  private emitAcceptedGuess(player: PlayerState, mask: Color[], at: number): void {
    if (!this.scienceEnabled(player)) return;
    const pattern = maskToPattern(mask);
    const counts = countMask(pattern);
    this.emitScience({
      ...this.scienceBase(at),
      type: "guess_accepted",
      guessNumber: player.guesses.length,
      elapsedMs: this.elapsedSinceStart(at),
      mask: pattern,
      green: counts.green,
      yellow: counts.yellow,
      gray: counts.gray,
      statusAfter: player.status,
      points: player.points,
    });
  }

  private emitPlayerFinished(player: PlayerState, outcome: ScienceOutcome, at: number): void {
    if (!this.scienceEnabled(player)) return;
    this.emitScience({
      ...this.scienceBase(at),
      type: "player_finished",
      outcome,
      guesses: player.guesses.length,
      elapsedMs: this.elapsedSinceStart(at),
      points: player.points,
      answer: this.state.word ?? undefined,
      revealHints: player.revealHints ?? 0,
      vowelHints: player.vowelHints ?? 0,
    });
  }

  private emitPowerupUsed(player: PlayerState, powerup: "reveal_letter" | "vowel_count", pointsSpent: number): void {
    if (!this.scienceEnabled(player)) return;
    const at = Date.now();
    this.emitScience({
      ...this.scienceBase(at),
      type: "powerup_used",
      powerup,
      guessNumber: player.guesses.length + 1,
      pointsSpent,
    });
  }

  private scienceBase(at: number): ScienceBaseEvent {
    return {
      at,
      date: activeDate(at),
      roomKind: this.scienceRoomKind(),
      wordLength: this.state.wordLength,
      maxGuesses: this.state.maxGuesses,
      mode: this.state.mode,
      edition: this.state.edition || "default",
    };
  }

  private scienceRoomKind(): ScienceRoomKind {
    if (this.state.isDaily) return "daily";
    if (this.state.challengeId) return "challenge";
    return "room";
  }

  private scienceEnabled(player: PlayerState): boolean {
    return !player.isBot && !player.scienceOptOut;
  }

  private elapsedSinceStart(now: number): number | null {
    return this.state.startedAt ? Math.max(0, now - this.state.startedAt) : null;
  }

  /** Tape clock: ms since GO (startedAt is aligned to goAt by goLive). */
  private tapeT(at: number): number {
    return Math.max(0, at - (this.state.startedAt ?? at));
  }

  private emitScience(event: ScienceEvent): void {
    const stub = this.env.SCIENCE.get(this.env.SCIENCE.idFromName(event.date));
    this.ctx.waitUntil(
      stub.fetch(new Request("https://do/event", {
        method: "POST",
        body: JSON.stringify(event),
        headers: { "content-type": "application/json" },
      })).then((res) => {
        if (!res.ok) console.error("science event non-ok", event.type, event.date, res.status);
      }).catch((e) => {
        console.error("science event failed", event.type, event.date, (e as Error).message);
      }),
    );
  }

  /** On the finish transition: bump the room scoreboard, then report a personalized
   *  record to each player's User DO. Best-effort — never blocks the game finishing. */
  private async finishGame(): Promise<void> {
    // participants = all players (incl. disconnected); a player who left mid-game still
    // gets a "played" credit and a "lost" record (status "playing" -> "lost").
    this.state.scoreboard = bumpScoreboard(this.state.scoreboard, {
      winner: this.state.winner,
      participants: this.finishParticipants().map((p) => p.username),
    });
    // Append a compact summary to the room's game history (newest last, keep last 20).
    this.state.history.push(
      summarizeRoomGame({
        round: this.state.round,
        word: this.state.word ?? "",
        winner: this.state.winner,
        finishedAt: this.state.finishedAt ?? Date.now(),
        players: this.finishParticipants().map((p) => ({ username: p.username, status: p.status, guesses: p.guesses.length })),
      }),
    );
    if (this.state.history.length > 20) this.state.history = this.state.history.slice(-20);
    const records = buildGameRecords({
      roomPath: this.state.path,
      word: this.state.word ?? "",
      wordLength: this.state.wordLength,
      finishedAt: this.state.finishedAt ?? Date.now(),
      players: this.finishParticipants().map((p) => ({
        username: p.username,
        status: p.status,
        guesses: p.guesses.length,
      })),
    });
    // Stamp each player's record with their own board (colors + letters) so room games show
    // a full letter-card on profiles too. Room words aren't the shared daily answer, so they
    // ship freely; the live daily is the only thing publicProfile withholds.
    for (const p of this.finishParticipants()) {
      const rec = records[p.username];
      if (rec) {
        rec.solveGrid = encodeSolveGrid(p.guesses);
        rec.words = encodeSolveWords(p.guesses);
        // Attach real timing if we captured a full parallel array for this player's guesses.
        if (Array.isArray(p.guessAts) && p.guessAts.length === p.guesses.length) {
          rec.guessAts = p.guessAts.slice();
        }
      }
    }
    // Report to every player's User DO in parallel — caps the wait at one round-trip
    // instead of N. Best-effort AND off the critical path: scheduled via waitUntil so a
    // cold/slow USER DO can't gate the finish. onGuess broadcasts the win snapshot the
    // instant finishGame returns; without this, the board froze for seconds after a solve
    // (and a re-press surfaced "game not in progress" once phase had flipped to finished).
    // waitUntil keeps the DO alive until the writes settle. maybeFinish guards re-entry
    // (returns early once phase==="finished"), so this can never double-mint.
    this.ctx.waitUntil(
      Promise.allSettled(
        Object.entries(records).flatMap(([username, record]) => {
        const player = this.state.players.find((p) => p.username === username);
        const receipt = settle({
          buyIn: 0,                       // Phase 2 turns buy-ins on
          points: player ? player.points : 0,
          mult: 1,                        // Phase 1: no multiplier sources yet
          spends: 0,
          bonus: 0,
        });
        const stub = this.env.USER.get(this.env.USER.idFromName(username));
        const calls = [
          stub.fetch(`https://do/append?username=${encodeURIComponent(username)}`, { method: "POST", body: JSON.stringify(record) })
            .catch((e) => console.error("report failed", username, (e as Error).message)),
        ];
        if (receipt.payout > 0 && !player?.isBot) {
          calls.push(
            stub.fetch(`https://do/ledger/append?username=${encodeURIComponent(username)}`, {
              method: "POST",
              body: JSON.stringify({
                token: "gold", delta: receipt.payout, reason: "mint:cashout",
                ref: `${this.state.path}#${this.state.round}`, parts: settleParts(receipt),
              }),
            }).then((res) => {
              // HONEST RECEIPT: attach only on a confirmed write, then tell everyone.
              // (Same rule as the daily's goldAwarded — never celebrate an unconfirmed mint.)
              if (res.ok && player) {
                player.receipt = receipt;
                // Deliberately ephemeral — no storage.put: the receipt is a one-shot finish-screen payload; if the DO hibernates first, the client's refreshGold fallback still reconciles the wallet.
                // Per-socket: each viewer gets a snapshot whose `word`/`players` are
                // projected specifically for them (same loop as persistAndBroadcast).
                for (const ws of this.ctx.getWebSockets()) {
                  try {
                    ws.send(JSON.stringify({ type: "snapshot", room: this.snapshotFor(this.userFor(ws)) }));
                  } catch { /* socket closing; ignore */ }
                }
              } else if (!res.ok) {
                console.error("race mint non-ok", username, res.status);
              }
            }).catch((e) => console.error("mint failed", username, (e as Error).message)),
          );
        }
        return calls;
        }),
      ),
    );

    // Public, per-word solve stats: one DO per word (sharded by name). Skip bots — only
    // real players move a word's public stats. All of this round's human results go in ONE
    // batched bump (atomic read-modify-write). Best-effort AND off the critical path
    // (waitUntil): like the USER-DO writes above, awaiting this stats bump would freeze the
    // win reveal on a cold WORDSTATS DO. finishGame runs once per finish (maybeFinish guards
    // re-entry), so backgrounding it can't double-bump.
    const statsWord = (this.state.word ?? "").toUpperCase();
    const statHumans = this.finishParticipants().filter((p) => !p.isBot);
    if (statsWord && statHumans.length) {
      const statGames = statHumans.map((p) => ({
        result: p.status === "won" ? "won" : "lost",
        guesses: p.guesses.length,
      }));
      this.ctx.waitUntil(
        this.env.WORDSTATS.get(this.env.WORDSTATS.idFromName(statsWord))
          .fetch("https://do/bump", { method: "POST", body: JSON.stringify({ games: statGames }) })
          .catch((e) => console.error("wordstats bump failed", statsWord, (e as Error).message)),
      );
    }

    // Seeded room: record each human's head-to-head against EVERY persona they raced (each
    // bot's username === its persona id). Reads internal players (un-stripped); the !isBot
    // guard keeps personas out of any USER DO. Win = the human is the room winner.
    if (this.state.seed) {
      const personaIds = this.state.players.filter((p) => p.isBot).map((p) => p.username);
      for (const p of this.state.players) {
        if (p.isBot) continue;
        const result = this.state.winner === p.username ? "w" : "l";
        for (const personaId of personaIds) this.writeH2H(p.username, personaId, result);
      }
    }
    // Seeded Arena: file the race's ghost tape with the share challenge so late
    // visitors race the original field in replay. The DO is first-write-wins, so a
    // re-entry can't double-file; best-effort like every other post-finish write.
    if (this.state.seed && this.state.shareChallengeId && this.state.tape && this.state.tape.events.length) {
      const cs = this.env.CHALLENGE.get(this.env.CHALLENGE.idFromName(this.state.shareChallengeId));
      const body = JSON.stringify({ ghosts: this.state.tape });
      this.ctx.waitUntil(cs.fetch(new Request("https://do/tape", {
        method: "POST", body, headers: { "content-type": "application/json" },
      })).catch((e) => console.error("tape file failed", (e as Error).message)));
    }
    // Backstop: ensure a finished seeded room is gone from the open index (close-on-join
    // already removed it; close is idempotent in arena-core).
    this.closeArena();
  }

  // Best-effort H2H write to the human's USER DO (ctx.waitUntil — can't block the finish).
  private writeH2H(humanUsername: string, personaId: string, result: "w" | "l"): void {
    const stub = this.env.USER.get(this.env.USER.idFromName(humanUsername));
    this.ctx.waitUntil(
      stub
        .fetch(`https://do/h2h?username=${encodeURIComponent(humanUsername)}`, {
          method: "POST",
          body: JSON.stringify({ personaId, result }),
          headers: { "content-type": "application/json" },
        })
        .catch((e) => console.error("h2h write failed", humanUsername, (e as Error).message)),
    );
  }

  // Best-effort: list this human-hosted public room in ARENA's open index (humans alongside
  // bots). No-op unless the room opted into public Arena.
  private publishArena(): void {
    if (!this.state.publicArena) return;
    const arena = this.env.ARENA.get(this.env.ARENA.idFromName("arena"));
    const rec = {
      path: this.state.path,
      routePath: `/@${this.state.path}`,
      name: this.state.name,
      host: this.state.owner,
      personaId: "",            // not a bot
      personaIcon: "👤",         // humans have no emoji persona; neutral marker
      edition: this.state.edition,
      wordLength: this.state.wordLength,
      seats: "1/2",
      mintedAt: Date.now(),
      status: "registered" as const,
    };
    this.ctx.waitUntil(
      arena
        .fetch(new Request("https://do/publish", {
          method: "POST",
          body: JSON.stringify(rec),
          headers: { "content-type": "application/json" },
        }))
        .catch((e) => console.error("arena publish failed", this.state.path, (e as Error).message)),
    );
  }

  // Best-effort close of a seeded OR public room in ARENA's open index. No-op otherwise.
  private closeArena(): void {
    if (!this.state.seed && !this.state.publicArena) return;
    const arena = this.env.ARENA.get(this.env.ARENA.idFromName("arena"));
    this.ctx.waitUntil(
      arena
        .fetch(new Request("https://do/close", {
          method: "POST",
          body: JSON.stringify({ path: this.state.path }),
          headers: { "content-type": "application/json" },
        }))
        .catch((e) => console.error("arena close failed", this.state.path, (e as Error).message)),
    );
  }

  // Completion router. Race rooms finish all-at-once (maybeFinish); daily rooms score
  // each player the moment THEY finish (won/lost), exactly once, with no global finish.
  private async afterPlayerStatus(player: PlayerState): Promise<void> {
    // Wordul play counter — the "watch it tick up" loop. Bump once per distinct human who
    // reaches a terminal status (won/lost/resigned). Guarded by wordulCounted so reconnects
    // and the hello-retry never double-count. Fire-and-forget (best effort).
    if (
      this.isWordulRoom() && !player.isBot &&
      player.status !== "playing" && !player.wordulCounted
    ) {
      player.wordulCounted = true;
      const [owner, slug] = this.state.path.split("/");
      this.ctx.waitUntil(
        this.env.WORDULS.get(this.env.WORDULS.idFromName(owner))
          .fetch(`https://do/play?slug=${encodeURIComponent(slug)}`, { method: "POST" })
          .catch((e) => console.error("wordul play bump failed", this.state.path, (e as Error).message)),
      );
    }
    if (!this.state.isDaily) {
      await this.maybeFinish();
      return;
    }
    if (player.status !== "playing" && !player.scored) {
      if (this.state.winner === null && player.status === "won") this.state.winner = player.username;
      await this.scorePlayer(player);
    }
  }

  // Daily: record ONE player's result — scoreboard bump + game record + gold (score
  // mint + flat daily goody). Best-effort; never blocks the player's board flipping.
  private async scorePlayer(player: PlayerState): Promise<void> {
    // Mint the per-day "see everyone's board" secret on the very first finish, BEFORE the
    // reveal broadcast below — so snapshotFor can hand this finisher their dailyToken. Once
    // set it never changes (every later finisher gets the same key). Random + server-held;
    // a non-finisher never receives it, so the public leaderboard can't unlock letters.
    if (this.state.isDaily && !this.state.finisherSecret) this.state.finisherSecret = crypto.randomUUID();
    this.state.scoreboard = bumpScoreboard(this.state.scoreboard, {
      winner: player.status === "won" ? player.username : null,
      participants: [player.username],
    });
    // Reveal the finished board NOW, before the best-effort writes below. The record
    // append + gold mint can stall on a cold USER DO; without this early broadcast the
    // daily win froze for seconds (the snapshot in onGuess only fires after this method
    // returns). We still AWAIT the mint below — the gold ledger is not idempotent, so the
    // `scored` flag must be persisted atomically in this turn to prevent a reconnect
    // double-mint — but the player already sees the win the moment they solve.
    await this.persistAndBroadcast();
    // Daily is async one-shot: each record is intentionally SOLO (empty opponents) —
    // hundreds play the same word across 24h, so a per-player rival list is meaningless.
    // summarizeRoomGame + the profile UI already handle solo records gracefully.
    const records = buildGameRecords({
      roomPath: this.state.path,
      word: this.state.word ?? "",
      wordLength: this.state.wordLength,
      finishedAt: Date.now(),
      players: [{ username: player.username, status: player.status, guesses: player.guesses.length }],
    });
    const record = records[player.username];
    // Stamp the daily record with the player's color grid AND letters. The home stamp reads
    // the colors; profiles render the full letter-card from words — but publicProfile strips
    // words for the LIVE daily, so today's answer never leaves the server.
    if (record) {
      record.solveGrid = encodeSolveGrid(player.guesses);
      record.words = encodeSolveWords(player.guesses);
    }
    // Resigners forfeited to 0 (points were zeroed in onResign); everyone else gets the
    // score mint + flat daily goody + a wall-clock time bonus (faster solve → more gold).
    // elapsedMs spans the player's first accepted guess (firstGuessAt) → finish (finishedAt,
    // or now as a fallback); null/unstarted (e.g. never guessed) yields 0 bonus. The record
    // above still captures their solveGrid.
    const endMs = player.finishedAt ?? Date.now();
    const elapsedMs = player.firstGuessAt != null ? Math.max(0, endMs - player.firstGuessAt) : null;
    const timeBonusGold = elapsedMs == null ? 0 : goldFromPoints(speedBonusPoints(elapsedMs));
    const scoreGold = goldFromPoints(player.points);
    const gold = player.resigned
      ? 0
      : scoreGold + DAILY_GOLD_BONUS + timeBonusGold;
    // Granular breakdown for the gold history — the three components already computed above,
    // zero legs dropped (Σ parts === gold by construction). Race cash-out stays single-total.
    const parts = [
      { label: "score", delta: scoreGold },
      { label: "daily", delta: DAILY_GOLD_BONUS },
      { label: "speed", delta: timeBonusGold },
    ].filter((p) => p.delta > 0);
    const stub = this.env.USER.get(this.env.USER.idFromName(player.username));
    // Record append is best-effort but observable (FIX 10): log a non-2xx, never throw.
    try {
      const recRes = await stub.fetch(`https://do/append?username=${encodeURIComponent(player.username)}`, {
        method: "POST", body: JSON.stringify(record),
      });
      if (!recRes.ok) console.error("daily report non-ok", player.username, recRes.status);
    } catch (e) {
      console.error("daily report failed", player.username, (e as Error).message);
    }
    // Bots never mint — no ledger write, zero economy impact — but they DO get the
    // same computed gold number so rankedEntries ranks them like any finisher.
    if (player.isBot) {
      player.scored = true;
      player.goldAwarded = gold;
      return;
    }
    // Wordul rooms record the leaderboard + solveGrid above, but DO NOT mint daily gold:
    // worduls are user-authored and unlimited, so minting per solve would be a gold farm.
    // Mark scored (so the hello-retry stops) and goldAwarded=0. (Daily path below unchanged.)
    if (this.isWordulRoom()) {
      player.scored = true;
      player.goldAwarded = 0;
      return;
    }
    // Resigners forfeit to 0 gold — skip the pointless 0-delta ledger write, but still
    // mark scored + goldAwarded=0 so they stay RANKED (topDaily needs a number) as a 💀
    // shame-row at the bottom of the board.
    if (player.resigned) {
      player.scored = true;
      player.goldAwarded = 0;
      return;
    }
    // Gold goody must be HONEST: only mark scored + record goldAwarded once the ledger
    // write is confirmed (res.ok). A failed/thrown mint leaves scored=false so a later
    // reconnect retries — the player never sees "here's your gold" on a 0-gold mint.
    try {
      const res = await stub.fetch(`https://do/ledger/append?username=${encodeURIComponent(player.username)}`, {
        method: "POST",
        body: JSON.stringify({ token: "gold", delta: gold, reason: "mint:daily", ref: `${this.state.path}#${player.username}`, parts }),
      });
      if (res.ok) {
        player.scored = true;
        player.goldAwarded = gold;
      } else {
        console.error("daily mint non-ok", player.username, res.status);
      }
    } catch (e) {
      console.error("daily mint failed", player.username, (e as Error).message);
    }
  }

  private async onRematchPropose(ws: WebSocket): Promise<void> {
    if (this.state.isDaily || this.isDuelRoom() || this.state.phase !== "finished") return;
    const username = this.userFor(ws);
    if (!username) return;
    const me = this.state.players.find((p) => p.username === username);
    if (!me) return;
    const opponent = this.state.players.find((p) => p.username !== username);
    // A plain solo room (no opponent, not a pinned-word challenge, not a seeded Arena)
    // has nobody to handshake with — "Play again" should just start a fresh game,
    // smoothly, in place. Mirrors a mutual accept (accepted + start).
    const soloRestart = !opponent && !this.state.challengeId && !this.state.seed;
    if (!opponent && !soloRestart) {
      // Challenge / seeded Arena with the opponent already gone (e.g. a bot that
      // declined a prior proposal) ⇒ settle Home.
      this.broadcastAll({ type: "rematch_cancelled", reason: "left" });
      return;
    }
    const { rematch, effects } = rematchReduce(this.state.rematch ?? null, {
      kind: "propose", from: username, opponentIsBot: !!opponent?.isBot, solo: soloRestart, now: Date.now(),
    });
    this.state.rematch = rematch;
    const started = await this.applyRematchEffects(effects);
    if (!started) await this.persistAndBroadcast();
  }

  private async onRematchAccept(ws: WebSocket): Promise<void> {
    if (this.state.isDaily || this.isDuelRoom() || this.state.phase !== "finished") return;
    const username = this.userFor(ws);
    if (!username) return;
    const { rematch, effects } = rematchReduce(this.state.rematch ?? null, { kind: "accept", from: username });
    this.state.rematch = rematch;
    const started = await this.applyRematchEffects(effects);
    if (!started) await this.persistAndBroadcast();
  }

  private async onRematchDecline(ws: WebSocket): Promise<void> {
    if (this.state.isDaily || this.isDuelRoom() || this.state.phase !== "finished") return;
    const username = this.userFor(ws);
    if (!username) return;
    const { rematch, effects } = rematchReduce(this.state.rematch ?? null, { kind: "decline" });
    this.state.rematch = rematch;
    const started = await this.applyRematchEffects(effects);
    if (!started) await this.persistAndBroadcast();
  }

  private async onChat(ws: WebSocket, textRaw: string): Promise<void> {
    const username = this.userFor(ws);
    if (!username) return;
    const player = this.state.players.find((p) => p.username === username);
    if (!player) return;
    // Strip control chars + angle brackets at the boundary (same as usernames).
    const text =
      (textRaw ?? "")
        .replace(/[\x00-\x1f\x7f<>]/g, "")
        .trim()
        .slice(0, MAX_CHAT_LEN);
    if (!text) return;
    const now = Date.now();
    const last = this.chatThrottle.get(username) ?? 0;
    if (now - last < CHAT_THROTTLE_MS) {
      this.send(ws, { type: "error", message: "slow down a sec" });
      return;
    }
    this.chatThrottle.set(username, now);
    this.state.chat.push({ kind: "user", from: player.username, text, t: now });
    this.capChat();
    await this.persistAndBroadcast();
  }

  private pushSystem(text: string): void {
    this.state.chat.push({ kind: "system", text, t: Date.now() });
    this.capChat();
  }

  private capChat(): void {
    if (this.state.chat.length > MAX_CHAT) {
      this.state.chat = this.state.chat.slice(-MAX_CHAT);
    }
  }

  // Push a non-snapshot server message to every connected socket (handshake events).
  private broadcastAll(msg: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify(msg)); } catch { /* socket closing; ignore */ }
    }
  }

  private clearRematchAlarms(): void {
    this.state.botRematchAt = null;
    this.state.rematchTimeoutAt = null;
  }

  // One alarm to rule them all: set it to the earliest armed rematch deadline, or
  // clear it. Only called in the finished phase (bot-GUESS alarms own the playing
  // phase), so the two never fight over the single DO alarm.
  private armRematchAlarm(): void {
    const at = nextAlarmAt([this.state.botRematchAt, this.state.rematchTimeoutAt]);
    if (at != null) void this.ctx.storage.setAlarm(at);
    else void this.ctx.storage.deleteAlarm();
  }

  // Perform the side effects a rematchReduce() returned. `runStart` is the existing
  // round-restart (increment, word pick, GO!, bot tick) — the handshake's accept path.
  private async applyRematchEffects(effects: RematchEffect[]): Promise<boolean> {
    let starter = "someone";
    let started = false;
    for (const e of effects) {
      switch (e.kind) {
        case "proposed":
          this.broadcastAll({ type: "rematch_proposed", proposer: e.proposer });
          break;
        case "accepted":
          starter = e.by;
          this.broadcastAll({ type: "rematch_accepted", by: e.by });
          break;
        case "cancelled":
          this.clearRematchAlarms();
          this.armRematchAlarm();
          this.broadcastAll({ type: "rematch_cancelled", reason: e.reason });
          break;
        case "schedule_timeout":
          this.state.rematchTimeoutAt = Date.now() + REMATCH_TIMEOUT_MS;
          this.armRematchAlarm();
          break;
        case "schedule_bot":
          this.state.botRematchAt = Date.now() + BOT_REMATCH_MIN_MS
            + Math.floor(Math.random() * (BOT_REMATCH_MAX_MS - BOT_REMATCH_MIN_MS));
          this.armRematchAlarm();
          break;
        case "bot_leaves": {
          const i = this.state.players.findIndex((p) => p.isBot);
          if (i >= 0) this.state.players.splice(i, 1);
          break;
        }
        case "start":
          this.clearRematchAlarms();
          await this.runStart(starter); // resets everyone, picks word, GO!, arms the bot heartbeat
          started = true;
          break;
      }
    }
    return started;
  }

  private isGameOver(): boolean {
    // The race no longer ends the instant someone wins — remaining players keep going
    // for their own gold/score. It's over once every connected player is done (won/lost).
    const pool = this.isDuelRoom() ? this.duelists() : this.state.players;
    const active = pool.filter((p) => p.connected);
    if (active.length === 0) return false;
    return active.every((p) => p.status !== "playing");
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket may be closing; ignore
    }
  }

  // Build the snapshot for a specific viewer. The word is revealed once the GAME is
  // finished OR the viewer is personally done (won/lost/gave up) — so a player who's out
  // gets the answer + its end-screen intel, while anyone still guessing never sees it.
  private snapshotFor(viewer: string | null): RoomSnapshot {
    const me = viewer ? this.state.players.find((p) => p.username === viewer) : null;
    const duel = this.isDuelRoom();
    // Duel: only a finished DUELIST gets the word early; a queued spectator waits for finish.
    const reveal = this.state.phase === "finished"
      || (!!me && me.status !== "playing" && (!duel || me.role === "duelist"));
    return {
      ...this.state,
      isDuel: duel,
      // Seat capacity for the lobby "Your table" strip: seeded rooms expose their configured
      // capacity; normal rooms expose the hard max (8). Computed outbound — never persisted stale.
      capacity: this.state.seed?.capacity ?? MAX_PLAYERS,
      word: reveal ? this.state.word : null,
      // The daily story names the answer ("Why EMBER?") — gate it exactly like `word`,
      // else a still-playing viewer reads today's word straight off the WS payload.
      story: reveal ? this.state.story : null,
      // Disguise (the single enforcement point): strip isBot per-player AND the server-only
      // seed marker. `seed: undefined` MUST come after ...this.state to shadow the internal
      // key (Slice D sets state.seed). TS doesn't enforce the shadow (seed isn't on the
      // declared outbound shape via this path), so this comment documents the dependency.
      seed: undefined,
      tape: undefined, // internal-only ghost tape; ships to late visitors via the Challenge DO, never the room socket
      publicArena: undefined, // internal-only; not part of the client contract
      rematch: undefined,
      botRematchAt: undefined,
      rematchTimeoutAt: undefined,
      abandonAt: undefined, // internal-only; not part of the client contract
      // The per-day secret NEVER ships raw (strip it exactly like `seed`). It reaches a
      // client only as `dailyToken`, and only on a viewer who's finished today — their key
      // to unlock everyone's letter-boards in /leaderboard. Reuses `reveal` (which already
      // means "this viewer is done / the game is over") so it can't precede the answer.
      finisherSecret: undefined,
      dailyToken: this.state.isDaily && reveal && !!me && me.status !== "playing"
        ? this.state.finisherSecret
        : undefined,
      players: this.state.isDaily
        ? (me ? [projectPlayerForClient({ ...me, guesses: [...me.guesses] })] : [])
        : this.state.players.map((p) => projectPlayerForClient({ ...p, guesses: [...p.guesses] })),
    };
  }

  private async persistAndBroadcast(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
    // Per-socket: each viewer gets a snapshot whose `word` is revealed only if they're
    // allowed to see it (game over, or they're out). One JSON encode per distinct viewer.
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const snap: ServerMessage = { type: "snapshot", room: this.snapshotFor(this.userFor(ws)) };
        ws.send(JSON.stringify(snap));
      } catch {
        // ignore broken sockets
      }
    }
  }
}
