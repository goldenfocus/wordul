import { DurableObject } from "cloudflare:workers";
import { WORDS_BY_SIZE, isSupportedSize } from "./wordsbysize.ts";
import { scoreGuess, countVowels, revealUngreened, type Color } from "./color.ts";
import { computeNextGuess } from "./solver.ts";
import { noobGuess, NOOB } from "./noob.ts";
import { projectPlayerForClient } from "./bots.ts";
import { bumpScoreboard } from "./scoreboard.ts";
import { buildGameRecords, summarizeRoomGame } from "./records.ts";
import { normalizeSlug } from "./identity.ts";
import { pointsEarned, goldFromPoints, POINTS } from "./economy.ts";
import { topDaily } from "./leaderboard-core.ts";
import { DEFAULT_MODE, isAvailableMode } from "./modes.ts";
import { activeDate } from "./daily-core.ts";
import { countMask, maskToPattern, type ScienceBaseEvent, type ScienceEvent, type ScienceOutcome, type ScienceRoomKind } from "./science.ts";
import {
  outpacedLosers,
  rematchReduce,
  nextAlarmAt,
  botAccepts,
  REMATCH_TIMEOUT_MS,
  BOT_REMATCH_MIN_MS,
  BOT_REMATCH_MAX_MS,
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

// ARENA → ROOM POST /seed body (canonical contract). `path` is the DO-key form
// "arena/<personaId>-<seedCount>"; the persona is injected with a human-looking username.
type SeedBody = {
  path: string;
  persona: { id: string; name: string; avatar: string };
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

function guessesFor(length: number): number {
  // length+1 preserves the classic 5/6 feel for short words (4→5, 5→6, 6→7, 7→8),
  // then plateaus at 8. Longer words convey more info per guess, so we don't
  // actually need 13 rows for a 12-letter board — it just looks intimidating.
  return Math.min(length + 1, 8);
}

export class Room extends DurableObject<Env> {
  private state: RoomSnapshot;
  /** In-memory only — fine if hibernation wipes it; we just reset throttle. */
  private chatThrottle = new Map<string, number>();

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
      finishedAt: null,
      round: 0,
      chat: [],
      wordLength: DEFAULT_LENGTH,
      maxGuesses: guessesFor(DEFAULT_LENGTH),
      mode: DEFAULT_MODE,
      scoreboard: [],
      history: [],
      edition: "default",
      isDaily: false,
      story: null,
      challengeId: null,
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
        for (const p of restored.players) {
          if (typeof p.points !== "number") p.points = 0;
          if (typeof p.pointsSpent !== "number") p.pointsSpent = 0;
          if (typeof p.revealHints !== "number") p.revealHints = 0;
          if (typeof p.vowelHints !== "number") p.vowelHints = 0;
          if (typeof p.scienceOptOut !== "boolean") p.scienceOptOut = false;
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
    // Read-only daily leaderboard: top N by gold + the caller's own rank. No socket,
    // no mutation — just a sort over the players already persisted in state.
    if (req.method === "GET" && url.pathname.endsWith("/leaderboard")) {
      const username = (url.searchParams.get("username") ?? "").toLowerCase().trim();
      const n = Number(url.searchParams.get("n") ?? "3");
      const players = this.state.players.map((p) => ({
        username: p.username,
        guessCount: p.guesses.length,
        won: p.status === "won",
        isBot: p.isBot,
        goldAwarded: p.goldAwarded,
      }));
      return Response.json(topDaily(players, username, n));
    }
    return new Response("not found", { status: 404 });
  }

  // Initialize a seeded (bot-hosted) room: stamp identity exactly as the /ws block does,
  // mark it seeded, and inject the persona as a silent waiting player. Idempotent — a
  // re-seed of an already-seeded room just acks. The room auto-starts when a human joins.
  private async handleSeed(req: Request): Promise<Response> {
    const b = (await req.json().catch(() => null)) as SeedBody | null;
    if (!b?.path || !b.persona?.id || b.profile !== "noob") {
      return new Response("bad request", { status: 400 });
    }
    if (this.state.seed) return Response.json({ ok: true }); // already seeded
    if (this.state.path === "") {
      this.state.path = b.path;
      const [owner, slug] = b.path.split("/");
      this.state.owner = owner ?? "";
      this.state.slug = slug ?? "";
      this.state.name = `${b.persona.name}'s room`;
    }
    this.state.seed = { personaId: b.persona.id, profile: b.profile };
    this.state.edition = sanitizeEdition(b.edition);
    if (isSupportedSize(b.wordLength)) {
      this.state.wordLength = b.wordLength;
      this.state.maxGuesses = guessesFor(b.wordLength);
    }
    this.ensureBot(b.persona);
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
        this.pushSystem(`${p.username} left`);
      }
      // A pending rematch dies if either participant drops; the survivor (the
      // proposer, if it was the recipient who left) is settled Home via cancelled{left}.
      if (this.state.rematch && this.state.phase === "finished") {
        const { rematch, effects } = rematchReduce(this.state.rematch, { kind: "left" });
        this.state.rematch = rematch;
        await this.applyRematchEffects(effects);
      }
      await this.persistAndBroadcast();
    }
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
        return this.onHello(ws, msg.username, msg.wordLength, msg.edition, msg.mode, msg.scienceOptOut, msg.public);
      case "start":
        return this.onStart(ws);
      case "guess":
        return this.onGuess(ws, msg.word);
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
    // Seeded room: a human must not claim the persona's username (it === seed.personaId),
    // else the `existing` lookup below would treat them as the bot reconnecting. Reject
    // before that lookup. (Review fix, defect 19.)
    if (this.state.seed && this.state.seed.personaId === username) {
      this.send(ws, { type: "error", message: "room full" });
      return;
    }
    ws.serializeAttachment({ username });

    const existing = this.state.players.find((p) => p.username === username);
    if (existing) {
      const wasOffline = !existing.connected;
      existing.connected = true;
      existing.scienceOptOut = !!scienceOptOut;
      if (wasOffline) this.pushSystem(`${username} reconnected`);
    } else {
      // Seeded room = exactly 1 persona (bot) + 1 human. Reject a 2nd distinct human.
      if (this.state.seed && this.state.players.some((p) => !p.isBot)) {
        this.send(ws, { type: "error", message: "room full" });
        return;
      }
      if (!this.state.isDaily && this.state.players.length >= MAX_PLAYERS) {
        this.send(ws, { type: "error", message: "room full" });
        return;
      }
      this.state.players.push({
        username,
        connected: true,
        guesses: [],
        status: "playing",
        scienceOptOut: !!scienceOptOut,
        revealHints: 0,
        vowelHints: 0,
        points: 0,
        pointsSpent: 0,
      });
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
      // A public Arena room opts into the open-games index at creation (owner, fresh lobby).
      if (
        isPublic &&
        username === this.state.owner &&
        this.state.phase === "lobby" &&
        this.state.round === 0
      ) {
        this.state.publicArena = true;
      }
      this.pushSystem(`${username} joined`);
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
    // Daily gold is mint-confirmed: if a player finished but a prior mint failed (scored
    // still false), retry now that they're back. Idempotent — scorePlayer only marks
    // scored on a confirmed ledger write.
    if (this.state.isDaily) {
      const p = this.state.players.find((x) => x.username === username);
      if (p && p.status !== "playing" && !p.scored) await this.afterPlayerStatus(p);
    }
    this.ensureBot();
    // Seeded Arena room: auto-start the instant the first human is connected (no host
    // "start" click). runStart closes the room out of the open index (a human committed;
    // the 2-cap already rejects a 2nd human).
    if (
      this.state.seed &&
      this.state.phase === "lobby" &&
      this.state.players.some((p) => !p.isBot && p.connected)
    ) {
      const persona = this.state.players.find((p) => p.isBot);
      await this.runStart(persona?.username ?? "arena");
    }
    // Public human Arena room: list it in the open index while it waits in the lobby.
    // runStart/finishGame close it. Best-effort; a refresh just re-asserts the listing.
    if (this.state.publicArena && this.state.phase === "lobby") {
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
      this.state.isDaily = true;
      this.state.word = word;
      this.state.wordLength = word.length;
      this.state.maxGuesses = guessesFor(word.length);
      this.state.edition = world.edition || "default";
      this.state.voice = world.voice || "yang";
      this.state.story = world.story ?? null;
      this.state.colorScheme = world.colorScheme ?? null;
      this.state.vibeTitle = world.vibeTitle;
      this.state.phase = "playing";    // async one-shot: always live, no lobby
      this.state.round = 1;
      this.state.startedAt = this.state.startedAt ?? Date.now();
      this.emitRoundStarted();
    } catch (e) {
      console.error("seedDaily failed", this.state.path, (e as Error).message);
      this.pushSystem("Today's Wordul is warming up — refresh in a sec.");
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
    this.ensureBot();
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
    }
    this.pushSystem(`${who} started the race${this.state.round > 1 ? ` (round ${this.state.round})` : ""}`);
    this.emitRoundStarted();
    if (this.state.players.some((p) => p.isBot && p.status === "playing")) this.scheduleBotTick();
    this.closeArena(); // once it starts, it's no longer an open game (no-op for normal rooms)
    await this.persistAndBroadcast();
    return true;
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

  // Shared guess core — both human onGuess (after validation) and the bot alarm call this,
  // so there is exactly ONE scoring/win path. Assumes `word` is a validated uppercase guess.
  private async applyGuess(player: PlayerState, word: string): Promise<void> {
    const now = Date.now();
    const priorStatus = player.status;
    const hadWinner = this.state.winner !== null;
    const mask = scoreGuess(word, this.state.word!);
    player.guesses.push({ word, mask });
    player.points = pointsEarned(player.guesses, this.state.maxGuesses) - player.pointsSpent;
    const allGreen = mask.every((c) => c === "green");
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
    this.emitAcceptedGuess(player, mask, now);
    if (priorStatus === "playing" && player.status !== "playing") {
      this.emitPlayerFinished(player, player.status === "won" ? "won" : "lost", now);
    }
    // First solve ends the race for everyone (live, non-daily rooms — Arena AND
    // Friends). Flip the still-playing others to `lost` so they carry a real status
    // into the snapshot and emitPlayerFinished fires for science/records/H2H. The
    // existing afterPlayerStatus → maybeFinish then finds isGameOver() and finishes.
    if (!hadWinner && this.state.winner && !this.state.isDaily) {
      for (const username of outpacedLosers(this.state.players, this.state.winner)) {
        const other = this.state.players.find((p) => p.username === username);
        if (other) {
          other.status = "lost";
          this.emitPlayerFinished(other, "lost", now);
        }
      }
    }
    if (this.state.challengeId && (player.status === "won" || player.status === "lost") && !player.isBot) {
      const solved = player.status === "won";
      const score = solved ? `${player.guesses.length}/${this.state.maxGuesses}` : `X/${this.state.maxGuesses}`;
      const cs = this.env.CHALLENGE.get(this.env.CHALLENGE.idFromName(this.state.challengeId));
      this.ctx.waitUntil(cs.fetch(new Request("https://do/attempt", {
        method: "POST",
        body: JSON.stringify({ username: player.username, score, solved, guesses: player.guesses.length }),
        headers: { "content-type": "application/json" },
      })));
    }
    await this.afterPlayerStatus(player);
  }

  // --- Slice 0: the robot room ------------------------------------------------------
  // One themed room (slug "robots") always has a worduler. No memory, no Agent DO yet —
  // it reasons only from its own guesses + the colors it got back, never the answer.

  private isRobotRoom(): boolean {
    return this.state.slug === ROBOT_SLUG;
  }

  private ensureBot(persona?: { id: string; name: string; avatar: string }): void {
    if (this.state.isDaily) return; // no worduler in the daily room
    // Fires for the labeled /robots room OR a seeded Arena room. A seeded room injects its
    // persona (human-looking username); the /robots room uses BOT_NAME (clanker).
    if (!this.isRobotRoom() && !this.state.seed) return;
    if (this.state.players.some((p) => p.isBot)) return;
    if (this.state.players.length >= MAX_PLAYERS) return;
    this.state.players.push({
      username: persona ? persona.id : BOT_NAME,
      connected: true,
      guesses: [],
      status: "playing",
      isBot: true,
      scienceOptOut: true,
      revealHints: 0,
      vowelHints: 0,
      points: 0,
      pointsSpent: 0,
    });
    // Only the labeled /robots room announces the worduler. Seeded Arena rooms (Slice D)
    // inject their persona silently — no system line, no disguise tell.
    if (this.isRobotRoom()) {
      this.pushSystem(`🤖 ${BOT_NAME} powered on — knows the basics, holds no grudges.`);
    }
  }

  private scheduleBotTick(): void {
    // Human-paced and beatable ON PURPOSE. A slow "reading" beat before the opener,
    // then a real think between rows. clanker is in no hurry — he thinks he's just a
    // person playing a word game, and people are slow.
    const bot = this.state.players.find((p) => p.isBot);
    const opening = !bot || bot.guesses.length === 0;
    // Seeded (Arena bot) rooms pace slower so the persona reads beatable; labeled /robots
    // rooms keep the original snappier cadence. `state.seed` is falsy until Slice D seeds.
    const seeded = !!this.state.seed;
    const base = seeded ? (opening ? 10000 : 7000) : (opening ? 6000 : 4000);
    const spread = seeded ? 10000 : 6000; // seeded: 10–20s opener, 7–17s subsequent
    const delay = base + Math.floor(Math.random() * spread);
    void this.ctx.storage.setAlarm(Date.now() + delay);
  }

  // DO alarm: the room's single heartbeat. In the PLAYING phase it paces the bot's
  // guesses (unchanged). In the FINISHED phase it drives the rematch handshake's
  // delayed wakes (bot decision + proposal timeout). The two phases are mutually
  // exclusive, so they never contend for the one alarm.
  async alarm(): Promise<void> {
    if (this.state.phase === "finished") {
      await this.handleRematchAlarm(Date.now());
      return;
    }
    if (this.state.phase !== "playing" || !this.state.word) return;
    const bot = this.state.players.find((p) => p.isBot && p.status === "playing");
    if (!bot) return;
    // Dad's brain drives our body: the solver sees ONLY a BotView (length + its own
    // earned masks) — never this.state.word. The cheat-isolation wall stays intact.
    // Seeded rooms play through the fallible noob; labeled /robots rooms stay sharp.
    // `state.seed` is falsy until Slice D, so every existing room keeps the sharp path.
    const view = { wordLength: this.state.wordLength, ownGuesses: bot.guesses };
    const word = this.state.seed ? noobGuess(view, NOOB, Math.random()) : computeNextGuess(view);
    if (word) await this.applyGuess(bot, word);
    await this.persistAndBroadcast();
    const stillGoing = this.state.players.some((p) => p.isBot && p.status === "playing");
    if (stillGoing && this.state.phase === "playing") this.scheduleBotTick();
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
    if (!this.isGameOver()) this.pushSystem(`${username} gave up`);
    this.emitPlayerFinished(player, "resigned", Date.now());
    await this.afterPlayerStatus(player);
    await this.persistAndBroadcast();
  }

  // EZ-mode power-up: reveal one letter the player hasn't greened yet. Only the DO
  // holds the answer, so this must happen server-side. No state change, no broadcast —
  // the hint goes only to the requester.
  private async onRevealLetter(ws: WebSocket, known?: number[]): Promise<void> {
    if (this.state.phase !== "playing" || !this.state.word) return;
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
      participants: this.state.players.map((p) => p.username),
    });
    // Append a compact summary to the room's game history (newest last, keep last 20).
    this.state.history.push(
      summarizeRoomGame({
        round: this.state.round,
        word: this.state.word ?? "",
        winner: this.state.winner,
        finishedAt: this.state.finishedAt ?? Date.now(),
        players: this.state.players.map((p) => ({ username: p.username, status: p.status, guesses: p.guesses.length })),
      }),
    );
    if (this.state.history.length > 20) this.state.history = this.state.history.slice(-20);
    const records = buildGameRecords({
      roomPath: this.state.path,
      word: this.state.word ?? "",
      wordLength: this.state.wordLength,
      finishedAt: this.state.finishedAt ?? Date.now(),
      players: this.state.players.map((p) => ({
        username: p.username,
        status: p.status,
        guesses: p.guesses.length,
      })),
    });
    // Report to every player's User DO in parallel — caps the wait at one round-trip
    // instead of N. Best-effort: a failed/slow write can't block or break the finish.
    await Promise.allSettled(
      Object.entries(records).flatMap(([username, record]) => {
        const player = this.state.players.find((p) => p.username === username);
        const gold = goldFromPoints(player ? player.points : 0);
        const stub = this.env.USER.get(this.env.USER.idFromName(username));
        const calls = [
          stub.fetch(`https://do/append?username=${encodeURIComponent(username)}`, { method: "POST", body: JSON.stringify(record) })
            .catch((e) => console.error("report failed", username, (e as Error).message)),
        ];
        if (gold > 0 && !player?.isBot) {
          calls.push(
            stub.fetch(`https://do/ledger/append?username=${encodeURIComponent(username)}`, {
              method: "POST",
              body: JSON.stringify({ token: "gold", delta: gold, reason: "mint:cashout", ref: `${this.state.path}#${this.state.round}` }),
            }).catch((e) => console.error("mint failed", username, (e as Error).message)),
          );
        }
        return calls;
      }),
    );
    // Seeded room: record the head-to-head for each human against the persona. Reads
    // this.state.players (internal, un-stripped) — the !isBot guard keeps the persona out
    // of any USER DO (defect 21). Win = the human is the winner, else loss (defect 20).
    if (this.state.seed) {
      const personaId = this.state.seed.personaId;
      for (const p of this.state.players) {
        if (p.isBot) continue;
        this.writeH2H(p.username, personaId, this.state.winner === p.username ? "w" : "l");
      }
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
    this.state.scoreboard = bumpScoreboard(this.state.scoreboard, {
      winner: player.status === "won" ? player.username : null,
      participants: [player.username],
    });
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
    const gold = goldFromPoints(player.points) + DAILY_GOLD_BONUS; // score mint + goody
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
    // Bots never mint; mark them scored so they don't retry forever.
    if (player.isBot) {
      player.scored = true;
      return;
    }
    // Gold goody must be HONEST: only mark scored + record goldAwarded once the ledger
    // write is confirmed (res.ok). A failed/thrown mint leaves scored=false so a later
    // reconnect retries — the player never sees "here's your gold" on a 0-gold mint.
    try {
      const res = await stub.fetch(`https://do/ledger/append?username=${encodeURIComponent(player.username)}`, {
        method: "POST",
        body: JSON.stringify({ token: "gold", delta: gold, reason: "mint:daily", ref: `${this.state.path}#${player.username}` }),
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
    if (this.state.isDaily || this.state.phase !== "finished") return;
    const username = this.userFor(ws);
    if (!username) return;
    const me = this.state.players.find((p) => p.username === username);
    if (!me) return;
    const opponent = this.state.players.find((p) => p.username !== username);
    // Opponent already gone (e.g. a bot that declined a prior proposal) ⇒ settle Home.
    if (!opponent) {
      this.broadcastAll({ type: "rematch_cancelled", reason: "left" });
      return;
    }
    const { rematch, effects } = rematchReduce(this.state.rematch ?? null, {
      kind: "propose", from: username, opponentIsBot: !!opponent.isBot, now: Date.now(),
    });
    this.state.rematch = rematch;
    const started = await this.applyRematchEffects(effects);
    if (!started) await this.persistAndBroadcast();
  }

  private async onRematchAccept(ws: WebSocket): Promise<void> {
    if (this.state.isDaily || this.state.phase !== "finished") return;
    const username = this.userFor(ws);
    if (!username) return;
    const { rematch, effects } = rematchReduce(this.state.rematch ?? null, { kind: "accept", from: username });
    this.state.rematch = rematch;
    const started = await this.applyRematchEffects(effects);
    if (!started) await this.persistAndBroadcast();
  }

  private async onRematchDecline(ws: WebSocket): Promise<void> {
    if (this.state.isDaily || this.state.phase !== "finished") return;
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
          await this.runStart(starter); // resets everyone, picks word, GO!, schedules bot tick
          started = true;
          break;
      }
    }
    return started;
  }

  private isGameOver(): boolean {
    // The race no longer ends the instant someone wins — remaining players keep going
    // for their own gold/score. It's over once every connected player is done (won/lost).
    const active = this.state.players.filter((p) => p.connected);
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
    const reveal = this.state.phase === "finished" || (!!me && me.status !== "playing");
    return {
      ...this.state,
      word: reveal ? this.state.word : null,
      // The daily story names the answer ("Why EMBER?") — gate it exactly like `word`,
      // else a still-playing viewer reads today's word straight off the WS payload.
      story: reveal ? this.state.story : null,
      // Disguise (the single enforcement point): strip isBot per-player AND the server-only
      // seed marker. `seed: undefined` MUST come after ...this.state to shadow the internal
      // key (Slice D sets state.seed). TS doesn't enforce the shadow (seed isn't on the
      // declared outbound shape via this path), so this comment documents the dependency.
      seed: undefined,
      publicArena: undefined, // internal-only; not part of the client contract
      rematch: undefined,
      botRematchAt: undefined,
      rematchTimeoutAt: undefined,
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
