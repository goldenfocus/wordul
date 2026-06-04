import { DurableObject } from "cloudflare:workers";
import { WORDS_BY_SIZE, isSupportedSize } from "./wordsbysize.ts";
import { scoreGuess, countVowels, revealUngreened } from "./color.ts";
import { computeNextGuess } from "./solver.ts";
import { bumpScoreboard } from "./scoreboard.ts";
import { buildGameRecords, summarizeRoomGame } from "./records.ts";
import { normalizeSlug } from "./identity.ts";
import { DEFAULT_MODE, isAvailableMode } from "./modes.ts";
import type { RoomMode } from "./modes.ts";
import { everyoneReady, COUNTDOWN_MS } from "./duel.ts";
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

// Normalize a client-supplied edition id to the charset edition ids use (lowercase
// kebab). Empty/garbage collapses to "default". Not a whitelist — the client falls
// back to the default theme for any id it doesn't recognize.
function sanitizeEdition(raw: string): string {
  const id = (raw ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
  return id || "default";
}

function guessesFor(length: number): number {
  // length+1 preserves the Wordle 5/6 feel for short words (4→5, 5→6, 6→7, 7→8),
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
      goAt: null,
      finishedAt: null,
      round: 0,
      chat: [],
      wordLength: DEFAULT_LENGTH,
      maxGuesses: guessesFor(DEFAULT_LENGTH),
      mode: DEFAULT_MODE,
      scoreboard: [],
      history: [],
      edition: "default",
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
        if (restored.goAt === undefined) restored.goAt = null; // pre-countdown rooms
        for (const p of restored.players) {
          if (p.ready === undefined) p.ready = false; // pre-ready-gate players
        }
        this.state = restored;
      }
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/ws")) {
      const path = url.searchParams.get("room") ?? "";
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
    return new Response("not found", { status: 404 });
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
      // Dropping mid-countdown aborts it; cancelCountdown persists + broadcasts itself.
      if (this.state.phase === "countdown") { await this.cancelCountdown(); return; }
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
        return this.onHello(ws, msg.username, msg.wordLength, msg.edition, msg.mode);
      case "start":
        return this.onReady(ws, true);
      case "ready":
        return this.onReady(ws, msg.ready);
      case "guess":
        return this.onGuess(ws, msg.word);
      case "rematch":
        return this.onRematch(ws);
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

  private async onHello(ws: WebSocket, usernameRaw: string, wordLength?: number, edition?: string, mode?: RoomMode): Promise<void> {
    // Trust model is intentional: identity is passwordless by product decision (a casual
    // word game — "kindness model", see spec 2026-05-31-username-identity). The client-
    // supplied username is taken at face value; control is shared, owner is bookkeeping only.
    // Hardening (signed sessions / email recovery) is a deliberate future layer.
    const username = (usernameRaw ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);
    if (username.length < 3) {
      this.send(ws, { type: "error", message: "bad username" });
      return;
    }
    ws.serializeAttachment({ username });

    const existing = this.state.players.find((p) => p.username === username);
    if (existing) {
      const wasOffline = !existing.connected;
      existing.connected = true;
      if (wasOffline) this.pushSystem(`${username} reconnected`);
    } else {
      if (this.state.players.length >= MAX_PLAYERS) {
        this.send(ws, { type: "error", message: "room full" });
        return;
      }
      this.state.players.push({ username, connected: true, guesses: [], status: "playing", ready: false });
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
    this.ensureBot();
    await this.persistAndBroadcast();
  }

  private async registerRoom(): Promise<void> {
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

  // A player toggles their ready state in the lobby. When every connected player is
  // ready, the synchronized countdown begins automatically — no manual "start".
  private async onReady(ws: WebSocket, ready: boolean): Promise<void> {
    if (this.state.phase !== "lobby") return;
    const username = this.userFor(ws);
    const player = username ? this.state.players.find((p) => p.username === username) : null;
    if (!player) return;
    player.ready = !!ready;
    this.ensureBot(); // robot room: the worduler joins (already ready) so it counts toward the gate
    if (everyoneReady(this.state.players)) {
      await this.beginCountdown();
      return;
    }
    await this.persistAndBroadcast();
  }

  // Pick the word, reset boards, and enter the countdown phase with a server-stamped
  // goAt so every client renders 3-2-1 against the same clock. A DO alarm flips us live.
  private async beginCountdown(): Promise<void> {
    const pool = WORDS_BY_SIZE[this.state.wordLength];
    if (!pool || pool.answers.length === 0) return;
    const word = pool.answers[Math.floor(Math.random() * pool.answers.length)] ?? null;
    if (!word) return;
    this.state.word = word;
    this.state.winner = null;
    this.state.startedAt = null;
    this.state.finishedAt = null;
    this.state.round += 1;
    for (const p of this.state.players) {
      p.guesses = [];
      p.status = "playing";
    }
    this.state.phase = "countdown";
    this.state.goAt = Date.now() + COUNTDOWN_MS;
    this.pushSystem(`Get ready… round ${this.state.round}`);
    // One DO alarm slot serves both this go-live timer and the bot tick. They never
    // overlap in practice: bot ticks are only scheduled while phase === "playing", so
    // none is pending in lobby/countdown when this setAlarm runs (or when
    // cancelCountdown's deleteAlarm runs). The alarm() handler also dispatches by phase.
    await this.ctx.storage.setAlarm(this.state.goAt);
    await this.persistAndBroadcast();
  }

  // The countdown alarm fired: go live. Word + boards were prepared in beginCountdown.
  private async goLive(): Promise<void> {
    this.state.phase = "playing";
    this.state.startedAt = this.state.goAt ?? Date.now();
    this.state.goAt = null;
    for (const p of this.state.players) p.ready = false; // clean slate for the next lobby
    if (this.state.players.some((p) => p.isBot && p.status === "playing")) this.scheduleBotTick();
    await this.persistAndBroadcast();
  }

  // A player dropped during the countdown — abort back to the lobby and make everyone
  // ready up again, cancelling the pending go-live alarm.
  private async cancelCountdown(): Promise<void> {
    this.state.phase = "lobby";
    this.state.goAt = null;
    this.state.word = null;
    for (const p of this.state.players) p.ready = false;
    try { await this.ctx.storage.deleteAlarm(); } catch { /* no alarm pending */ }
    this.pushSystem("Countdown cancelled — ready up again");
    await this.persistAndBroadcast();
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
    const mask = scoreGuess(word, this.state.word!);
    player.guesses.push({ word, mask });
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
    await this.maybeFinish();
  }

  // --- Slice 0: the robot room ------------------------------------------------------
  // One themed room (slug "robots") always has a worduler. No memory, no Agent DO yet —
  // it reasons only from its own guesses + the colors it got back, never the answer.

  private isRobotRoom(): boolean {
    return this.state.slug === ROBOT_SLUG;
  }

  private ensureBot(): void {
    if (!this.isRobotRoom()) return;
    if (this.state.players.some((p) => p.isBot)) return;
    if (this.state.players.length >= MAX_PLAYERS) return;
    this.state.players.push({ username: BOT_NAME, connected: true, guesses: [], status: "playing", isBot: true, ready: true });
    this.pushSystem(`🤖 ${BOT_NAME} powered on — knows the basics, holds no grudges.`);
  }

  private scheduleBotTick(): void {
    // Human-paced and beatable ON PURPOSE. A slow "reading" beat before the opener,
    // then a real think between rows. clanker is in no hurry — he thinks he's just a
    // person playing a word game, and people are slow.
    const bot = this.state.players.find((p) => p.isBot);
    const opening = !bot || bot.guesses.length === 0;
    const base = opening ? 6000 : 4000;
    const delay = base + Math.floor(Math.random() * 6000); // opener 6–12s, then 4–10s
    void this.ctx.storage.setAlarm(Date.now() + delay);
  }

  // DO alarm: the robot's heartbeat. Wakes, plays ONE guess through the same path a human
  // guess takes, then reschedules until it has won or run out of rows. Hibernation-safe.
  async alarm(): Promise<void> {
    // Countdown go-live takes priority over the bot heartbeat (they share one alarm).
    if (this.state.phase === "countdown") {
      await this.goLive();
      return;
    }
    if (this.state.phase !== "playing" || !this.state.word) return;
    const bot = this.state.players.find((p) => p.isBot && p.status === "playing");
    if (!bot) return;
    // Dad's brain drives our body: the solver sees ONLY a BotView (length + its own
    // earned masks) — never this.state.word. The cheat-isolation wall stays intact.
    const word = computeNextGuess({ wordLength: this.state.wordLength, ownGuesses: bot.guesses });
    if (word) await this.applyGuess(bot, word);
    await this.persistAndBroadcast();
    const stillGoing = this.state.players.some((p) => p.isBot && p.status === "playing");
    if (stillGoing && this.state.phase === "playing") this.scheduleBotTick();
  }

  // Finish the round once every connected player is done — NOT the instant someone wins.
  // The winner was already announced; here we just reveal the word to everyone and record.
  private async maybeFinish(): Promise<void> {
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
    await this.maybeFinish();
    await this.persistAndBroadcast();
  }

  // EZ-mode power-up: reveal one letter the player hasn't greened yet. Only the DO
  // holds the answer, so this must happen server-side. No state change, no broadcast —
  // the hint goes only to the requester.
  private onRevealLetter(ws: WebSocket, known?: number[]): void {
    if (this.state.phase !== "playing" || !this.state.word) return;
    const username = this.userFor(ws);
    const player = this.state.players.find((p) => p.username === username);
    if (!player || player.status !== "playing") return;
    const hit = revealUngreened(this.state.word, player.guesses, known ?? []);
    if (hit) this.send(ws, { type: "revealed_letter", index: hit.index, letter: hit.letter });
  }

  // EZ-mode power-up: how many vowels are in the answer. Requester-only.
  private onVowelCount(ws: WebSocket): void {
    if (this.state.phase !== "playing" || !this.state.word) return;
    const username = this.userFor(ws);
    const player = this.state.players.find((p) => p.username === username);
    if (!player || player.status !== "playing") return;
    this.send(ws, { type: "vowels", count: countVowels(this.state.word) });
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
      Object.entries(records).map(([username, record]) =>
        this.env.USER.get(this.env.USER.idFromName(username))
          .fetch(`https://do/append?username=${encodeURIComponent(username)}`, { method: "POST", body: JSON.stringify(record) })
          .catch((e) => console.error("report failed", username, (e as Error).message)),
      ),
    );
  }

  private async onRematch(ws: WebSocket): Promise<void> {
    if (this.state.phase !== "finished") return;
    this.state.phase = "lobby";
    this.state.word = null;
    this.state.winner = null;
    this.state.startedAt = null;
    this.state.goAt = null;
    this.state.finishedAt = null;
    for (const p of this.state.players) {
      p.guesses = [];
      p.status = "playing";
      p.ready = false;
    }
    await this.persistAndBroadcast();
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
      players: this.state.players.map((p) => ({ ...p, guesses: [...p.guesses] })),
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
