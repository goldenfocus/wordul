import { DurableObject } from "cloudflare:workers";
import { WORDS_BY_SIZE, isSupportedSize } from "./wordsbysize.ts";
import { scoreGuess } from "./color.ts";
import type {
  ChatEntry,
  ClientMessage,
  PlayerState,
  RoomSnapshot,
  ServerMessage,
} from "./types.ts";

type Env = Record<string, unknown>;

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
    // Hydrate from persisted state if present, else fresh.
    const saved = ctx.storage.getAlarm; // probe — just for type
    void saved;
    this.state = {
      code: "",
      phase: "lobby",
      hostId: "",
      players: [],
      word: null,
      winnerId: null,
      startedAt: null,
      finishedAt: null,
      round: 0,
      chat: [],
      wordLength: DEFAULT_LENGTH,
      maxGuesses: guessesFor(DEFAULT_LENGTH),
    };
    // Async restore — DO ctor can't await, so we kick it off and gate writes via blockConcurrencyWhile.
    ctx.blockConcurrencyWhile(async () => {
      const restored = await ctx.storage.get<RoomSnapshot>("state");
      if (restored) {
        if (!Array.isArray(restored.chat)) restored.chat = [];
        if (!restored.wordLength) restored.wordLength = DEFAULT_LENGTH;
        if (!restored.maxGuesses) restored.maxGuesses = guessesFor(restored.wordLength);
        this.state = restored;
      }
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/ws")) {
      const code = url.searchParams.get("code") ?? "";
      if (this.state.code === "") this.state.code = code;
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
    const pid = this.pidFor(ws);
    if (pid) {
      const p = this.state.players.find((p) => p.id === pid);
      if (p && p.connected) {
        p.connected = false;
        this.pushSystem(`${p.nickname} left`);
      }
      await this.persistAndBroadcast();
    }
  }

  /** Read playerId from this WS's serialized attachment (survives hibernation). */
  private pidFor(ws: WebSocket): string | null {
    try {
      const a = ws.deserializeAttachment() as { playerId?: string } | null;
      return a?.playerId ?? null;
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
        return this.onHello(ws, msg.nickname, msg.playerId, msg.wordLength);
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
      case "ping":
        // Client heartbeat — round-trip with no state change so the network path
        // and DO both stay warm and the client can detect a dead conn faster.
        this.send(ws, { type: "pong" });
        return;
    }
  }

  private async onHello(ws: WebSocket, nicknameRaw: string, playerId: string, wordLength?: number): Promise<void> {
    // Defense in depth: client uses textContent, but we also sanitize at the boundary.
    // Strip ASCII control chars and angle brackets to neuter HTML/script tag attempts.
    const nickname =
      (nicknameRaw ?? "")
        .replace(/[ -<>]/g, "")
        .trim()
        .slice(0, 20) || "Player";
    if (!playerId || playerId.length > 64) {
      this.send(ws, { type: "error", message: "bad player id" });
      return;
    }
    ws.serializeAttachment({ playerId });
    const existing = this.state.players.find((p) => p.id === playerId);
    if (existing) {
      const wasOffline = !existing.connected;
      existing.connected = true;
      existing.nickname = nickname;
      if (wasOffline) this.pushSystem(`${nickname} reconnected`);
    } else {
      if (this.state.players.length >= MAX_PLAYERS) {
        this.send(ws, { type: "error", message: "room full" });
        return;
      }
      const player: PlayerState = {
        id: playerId,
        nickname,
        connected: true,
        guesses: [],
        status: "playing",
      };
      this.state.players.push(player);
      if (!this.state.hostId) {
        this.state.hostId = playerId;
        // First connect = host. Adopt their preferred word length if valid AND we're
        // still in pristine lobby state (no one's started a game yet).
        if (
          wordLength != null &&
          isSupportedSize(wordLength) &&
          this.state.phase === "lobby" &&
          this.state.round === 0
        ) {
          this.state.wordLength = wordLength;
          this.state.maxGuesses = guessesFor(wordLength);
        }
      }
      this.pushSystem(`${nickname} joined`);
    }
    await this.persistAndBroadcast();
  }

  private async onSetLength(ws: WebSocket, length: number): Promise<void> {
    const pid = this.pidFor(ws);
    if (pid !== this.state.hostId) {
      this.send(ws, { type: "error", message: "only host can change word length" });
      return;
    }
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
    const host = this.state.players.find((p) => p.id === this.state.hostId);
    this.pushSystem(`${host?.nickname ?? "host"} set word length to ${length}`);
    await this.persistAndBroadcast();
  }

  private async onStart(ws: WebSocket): Promise<void> {
    const pid = this.pidFor(ws);
    if (pid !== this.state.hostId) {
      this.send(ws, { type: "error", message: "only host can start" });
      return;
    }
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
    this.state.winnerId = null;
    this.state.startedAt = Date.now();
    this.state.finishedAt = null;
    this.state.round += 1;
    for (const p of this.state.players) {
      p.guesses = [];
      p.status = "playing";
    }
    const host = this.state.players.find((p) => p.id === this.state.hostId);
    this.pushSystem(`${host?.nickname ?? "host"} started the race${this.state.round > 1 ? ` (round ${this.state.round})` : ""}`);
    await this.persistAndBroadcast();
  }

  private async onGuess(ws: WebSocket, wordRaw: string): Promise<void> {
    if (this.state.phase !== "playing" || !this.state.word) {
      this.send(ws, { type: "error", message: "game not in progress" });
      return;
    }
    const pid = this.pidFor(ws);
    if (!pid) return;
    const player = this.state.players.find((p) => p.id === pid);
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
      if (!this.state.winnerId) this.state.winnerId = player.id;
    } else if (player.guesses.length >= this.state.maxGuesses) {
      player.status = "lost";
    }
    if (this.isGameOver()) {
      this.state.phase = "finished";
      this.state.finishedAt = Date.now();
      const winner = this.state.winnerId
        ? this.state.players.find((p) => p.id === this.state.winnerId)
        : null;
      if (winner) {
        this.pushSystem(`${winner.nickname} got it in ${winner.guesses.length}! The word was ${this.state.word}`);
      } else {
        this.pushSystem(`Nobody got it. The word was ${this.state.word}`);
      }
    }
    await this.persistAndBroadcast();
  }

  private async onRematch(ws: WebSocket): Promise<void> {
    const pid = this.pidFor(ws);
    if (pid !== this.state.hostId) {
      this.send(ws, { type: "error", message: "only host can rematch" });
      return;
    }
    if (this.state.phase !== "finished") return;
    this.state.phase = "lobby";
    this.state.word = null;
    this.state.winnerId = null;
    this.state.startedAt = null;
    this.state.finishedAt = null;
    for (const p of this.state.players) {
      p.guesses = [];
      p.status = "playing";
    }
    await this.persistAndBroadcast();
  }

  private async onChat(ws: WebSocket, textRaw: string): Promise<void> {
    const pid = this.pidFor(ws);
    if (!pid) return;
    const player = this.state.players.find((p) => p.id === pid);
    if (!player) return;
    // Strip control chars + angle brackets at the boundary (same as nicknames).
    const text =
      (textRaw ?? "")
        .replace(/[\x00-\x1f\x7f<>]/g, "")
        .trim()
        .slice(0, MAX_CHAT_LEN);
    if (!text) return;
    const now = Date.now();
    const last = this.chatThrottle.get(pid) ?? 0;
    if (now - last < CHAT_THROTTLE_MS) {
      this.send(ws, { type: "error", message: "slow down a sec" });
      return;
    }
    this.chatThrottle.set(pid, now);
    this.state.chat.push({ kind: "user", from: player.nickname, text, t: now });
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
    if (this.state.winnerId) return true;
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
