import { DurableObject } from "cloudflare:workers";
import { WORDS_BY_SIZE, isSupportedSize } from "./wordsbysize.ts";
import { scoreGuess, countVowels, revealUngreened } from "./color.ts";
import { bumpScoreboard } from "./scoreboard.ts";
import { buildGameRecords } from "./records.ts";
import { normalizeSlug } from "./identity.ts";
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
      finishedAt: null,
      round: 0,
      chat: [],
      wordLength: DEFAULT_LENGTH,
      maxGuesses: guessesFor(DEFAULT_LENGTH),
      scoreboard: [],
    };
    // Async restore — DO ctor can't await, so we kick it off and gate writes via blockConcurrencyWhile.
    ctx.blockConcurrencyWhile(async () => {
      const restored = await ctx.storage.get<RoomSnapshot>("state");
      if (restored) {
        if (!Array.isArray(restored.chat)) restored.chat = [];
        if (!Array.isArray(restored.scoreboard)) restored.scoreboard = [];
        if (!restored.wordLength) restored.wordLength = DEFAULT_LENGTH;
        if (!restored.maxGuesses) restored.maxGuesses = guessesFor(restored.wordLength);
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
        return this.onHello(ws, msg.username, msg.wordLength);
      case "start":
        return this.onStart(ws);
      case "guess":
        return this.onGuess(ws, msg.word);
      case "rematch":
        return this.onRematch(ws);
      case "chat":
        return this.onChat(ws, msg.text);
      case "set_length":
        return this.onSetLength(ws, msg.wordLength);
      case "rename":
        return this.onRename(ws, msg.name);
      case "reveal_letter":
        return this.onRevealLetter(ws, msg.known);
      case "vowel_count":
        return this.onVowelCount(ws);
      case "ping":
        // Client heartbeat — round-trip with no state change so the network path
        // and DO both stay warm and the client can detect a dead conn faster.
        this.send(ws, { type: "pong" });
        return;
    }
  }

  private async onHello(ws: WebSocket, usernameRaw: string, wordLength?: number): Promise<void> {
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
      this.state.players.push({ username, connected: true, guesses: [], status: "playing" });
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

  private async onStart(ws: WebSocket): Promise<void> {
    if (this.state.phase === "playing") return;
    if (this.state.players.length < 1) return;
    const pool = WORDS_BY_SIZE[this.state.wordLength];
    if (!pool || pool.answers.length === 0) {
      this.send(ws, { type: "error", message: "no words available for that length" });
      return;
    }
    this.state.word = pool.answers[Math.floor(Math.random() * pool.answers.length)] ?? null;
    if (!this.state.word) return;
    this.state.phase = "playing";
    this.state.winner = null;
    this.state.startedAt = Date.now();
    this.state.finishedAt = null;
    this.state.round += 1;
    for (const p of this.state.players) {
      p.guesses = [];
      p.status = "playing";
    }
    const who = this.userFor(ws) ?? "someone";
    this.pushSystem(`${who} started the race${this.state.round > 1 ? ` (round ${this.state.round})` : ""}`);
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

    const mask = scoreGuess(word, this.state.word);
    player.guesses.push({ word, mask });
    const allGreen = mask.every((c) => c === "green");
    if (allGreen) {
      player.status = "won";
      if (!this.state.winner) this.state.winner = player.username;
    } else if (player.guesses.length >= this.state.maxGuesses) {
      player.status = "lost";
    }
    if (this.isGameOver()) {
      this.state.phase = "finished";
      this.state.finishedAt = Date.now();
      const winner = this.state.winner
        ? this.state.players.find((p) => p.username === this.state.winner)
        : null;
      if (winner) {
        this.pushSystem(`${winner.username} got it in ${winner.guesses.length}! The word was ${this.state.word}`);
      } else {
        this.pushSystem(`Nobody got it. The word was ${this.state.word}`);
      }
      await this.finishGame();
    }
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
    this.state.finishedAt = null;
    for (const p of this.state.players) {
      p.guesses = [];
      p.status = "playing";
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
    // Race ends as soon as someone wins OR all connected players have exhausted/lost.
    if (this.state.winner) return true;
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

  private snapshotFor(_audience: "player" | "all"): RoomSnapshot {
    // While playing, never leak the word.
    return {
      ...this.state,
      word: this.state.phase === "finished" ? this.state.word : null,
      players: this.state.players.map((p) => ({ ...p, guesses: [...p.guesses] })),
    };
  }

  private async persistAndBroadcast(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
    const snap: ServerMessage = { type: "snapshot", room: this.snapshotFor("all") };
    const payload = JSON.stringify(snap);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // ignore broken sockets
      }
    }
  }
}
