// public/daily-recover.js — cross-browser self-heal for your daily solve.
//
// You finished today's Wordul on another browser/device. The server knows — your rank
// and gold sync through your account — but THIS browser is missing the two CLIENT-ONLY
// artifacts that make the recap come alive:
//   • wr.dailySolve:<date> — your own letters (powers the letter stamp + replay, and
//     profile-core's "played today" unlock)
//   • wr.dailyToken:<date> — the finisher token that unlocks everyone's letter-boards
//     on /leaderboard
// Without them you see your own board as blank color squares and every profile says
// "play today first", with no way back in (the home recap replaces the play path).
//
// Rather than opening a new letters-over-HTTP surface, we reuse the room's existing
// contract: a finished player's WS snapshot ALREADY carries `dailyToken` + their own
// guesses (words + masks) — exactly what a reload in the solving browser receives. So
// when the home spots "server says I finished, but I hold no solve/token", it opens
// that socket once, harvests both, closes, and re-renders. No new answer leak: the
// snapshot only reveals these to a viewer whose player is already done (snapshotFor's
// `reveal` gate), same as any reconnect today.

const CELL = { hot: "g", warm: "y", cold: "x" };

// Pure: a player's finished guesses → the wr.dailySolve payload (same shape app.js's
// captureDailySolve writes at the live win/loss moment).
export function encodeLocalSolve(me) {
  return {
    won: me.status === "won",
    guesses: me.guesses.length,
    words: me.guesses.map((g) => String(g.word || "").toUpperCase()),
    grid: me.guesses.map((g) => (g.mask || []).map((c) => CELL[c] || "x").join("")),
  };
}

// Pure: pull { token, solve } for `username` out of one server message, or null when
// this message can't prove a finished solve (not a snapshot / not a daily room /
// viewer still playing / no guesses). token is null on an older server that doesn't
// hand one out — the solve alone still restores the letter stamp.
export function harvestDailyArtifacts(msg, username) {
  if (!msg || msg.type !== "snapshot" || !msg.room || !msg.room.isDaily) return null;
  const me = (msg.room.players || []).find((p) => p && p.username === username);
  if (!me || me.status === "playing" || !Array.isArray(me.guesses) || me.guesses.length === 0) return null;
  return { token: msg.room.dailyToken || null, solve: encodeLocalSolve(me) };
}

// Does this browser still need the recovery? True when either artifact is absent.
export function needsDailyRecovery(date, storage) {
  try {
    return !storage.getItem(`wr.dailySolve:${date}`) || !storage.getItem(`wr.dailyToken:${date}`);
  } catch { return false; } // storage off — nowhere to recover INTO
}

// One-shot recovery socket. Opens ws to the day's room, says hello, waits for the
// first snapshot that proves our finished solve, writes both artifacts, closes.
// Resolves true on success, false on timeout/error — always best-effort, never throws.
export function recoverDailyArtifacts({ date, username, storage, makeSocket, hello, timeoutMs = 8000 }) {
  return new Promise((resolve) => {
    let ws;
    try { ws = makeSocket(); } catch { resolve(false); return; }
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    ws.addEventListener("open", () => {
      try { ws.send(JSON.stringify(hello)); } catch { finish(false); }
    });
    ws.addEventListener("message", (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const got = harvestDailyArtifacts(msg, username);
      if (!got) return; // not ours / not finished yet — keep listening until timeout
      try {
        storage.setItem(`wr.dailySolve:${date}`, JSON.stringify(got.solve));
        if (got.token) storage.setItem(`wr.dailyToken:${date}`, got.token);
      } catch { finish(false); return; } // storage full/off — recap stays color-only
      finish(true);
    });
    ws.addEventListener("error", () => finish(false));
    ws.addEventListener("close", () => finish(false));
  });
}
