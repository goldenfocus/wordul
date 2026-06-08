// public/tape-replay.js — DOM driver for the real-solve replay ("watch the real solve").
// Consumes buildTapeSchedule steps inside the leaderboard replay modal. Decoupling rule
// (daily-lb.js pattern): NEVER imports app.js. Voice goes straight to /voice.js with the
// DESCRIPTOR RECORDED IN THE TAPE (the player's world voice at solve time); the viewer's
// mute is enforced both here and inside voice.js. Timer chip always counts TRUE elapsed
// time — speed (1x/2x/4x) squeezes dt between steps but never lies about the clock.
// Security: tape data is untrusted (another player's recorded keystrokes) — every
// tape-derived string (letters, power tags, voice lines) only ever reaches the DOM via
// textContent, never innerHTML.
import { buildTapeSchedule, sanitizeVoiceLine, THINK_MS } from "/tape-replay-core.js";
import { playVoice, stopSpeaking } from "/voice.js";

const MUTE_LS = "wordul.muted";
const SPEEDS = [1, 2, 4];

export function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
const fmtThink = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};
const CELL = { g: "hot", y: "warm", x: "cold" };

// Build the replay stage: empty tile rows + timer + think bubble + controls bar.
// grid/words come from the leaderboard entry (words exist — the tape fetch needed the
// same finisher token). Returns the mutable stage handle applyStep works against.
export function buildTapeStage(mount, { rows, cols, grid, words }) {
  mount.innerHTML = `
    <div class="tape-stage">
      <div class="tape-head"><span class="tape-timer">0:00</span><span class="tape-think" hidden></span></div>
      <div class="tape-board">${Array.from({ length: rows }, () =>
        `<div class="tape-row">${'<span class="tile"></span>'.repeat(cols)}</div>`).join("")}</div>
      <div class="tape-controls">
        <button type="button" class="tape-play" aria-label="Pause">⏸</button>
        <button type="button" class="tape-speed">1×</button>
        <button type="button" class="tape-skip" aria-label="Skip to next guess">⏭</button>
      </div>
    </div>`;
  return {
    mount, grid: grid ?? [], words: words ?? [], cols,
    cursor: { row: 0, col: 0 },
    rowsEls: [...mount.querySelectorAll(".tape-row")],
    timerEl: mount.querySelector(".tape-timer"),
    thinkEl: mount.querySelector(".tape-think"),
  };
}

// Apply ONE step to the stage. Exported separately so tests drive it without timers.
export function applyStep(stage, step) {
  stage.timerEl.textContent = fmtClock(step.trueT ?? 0);
  const rowEl = stage.rowsEls[stage.cursor.row];
  if (!rowEl && step.kind !== "voice" && step.kind !== "commit") return;
  const tiles = rowEl ? rowEl.querySelectorAll(".tile") : [];
  if (step.kind === "type" && stage.cursor.col < stage.cols) {
    tiles[stage.cursor.col].textContent = step.letter;
    stage.cursor.col++;
  } else if (step.kind === "back" && stage.cursor.col > 0) {
    stage.cursor.col--;
    tiles[stage.cursor.col].textContent = "";
  } else if (step.kind === "clear") {
    tiles.forEach((t) => { t.textContent = ""; });
    stage.cursor.col = 0;
    rowEl.classList.remove("shake");
  } else if (step.kind === "reject") {
    rowEl.classList.remove("shake");
    void rowEl.offsetWidth;
    rowEl.classList.add("shake");
  } else if (step.kind === "commit") {
    // Target the STEP's row, not the cursor row — the truncated finish() replays
    // commits for rows 0..N while the cursor sits wherever playback stopped.
    const commitEl = stage.rowsEls[step.row];
    if (commitEl) {
      const mask = String(stage.grid[step.row] ?? "");
      const word = String(stage.words[step.row] ?? "");
      commitEl.querySelectorAll(".tile").forEach((t, i) => {
        if (word[i]) t.textContent = word[i]; // server truth beats taped keys
        t.classList.add(CELL[mask[i]] ?? "cold");
      });
    }
    stage.cursor = { row: step.row + 1, col: 0 };
  } else if (step.kind === "think") {
    stage.thinkEl.hidden = false;
    stage.thinkEl.textContent = `💭 thinking… ${fmtThink(step.trueMs)}`;
    setTimeout(() => { stage.thinkEl.hidden = true; }, THINK_MS);
  } else if (step.kind === "power") {
    stage.thinkEl.hidden = false;
    stage.thinkEl.textContent = `⚡ ${step.what}`;
    setTimeout(() => { stage.thinkEl.hidden = true; }, 900);
  } else if (step.kind === "voice") {
    const l = sanitizeVoiceLine(step.line); // re-check the untrusted descriptor (see tape-replay-core)
    if (l && localStorage.getItem(MUTE_LS) !== "1") {
      playVoice(l.voice, l.raw, l.text, { answer: l.answer }, l.revealVoice);
    }
  }
}

// Play a full tape into mount. Returns { stop } so the modal can cancel on close.
export function playTapeReplay(mount, { events, grid, words, rows, cols, truncated }) {
  const stage = buildTapeStage(mount, { rows, cols, grid, words });
  const { steps } = buildTapeSchedule(events);
  let i = 0, timer = 0, paused = false, speedIdx = 0;
  const playBtn = mount.querySelector(".tape-play");
  const speedBtn = mount.querySelector(".tape-speed");
  const skipBtn = mount.querySelector(".tape-skip");
  const finish = () => {
    // Truncated tape (capped recorder): jump-cut to the final board so it always ends true.
    if (truncated) (grid ?? []).forEach((_, r) => applyStep(stage, { kind: "commit", row: r, trueT: steps.at(-1)?.trueT ?? 0 }));
    playBtn.disabled = skipBtn.disabled = true;
  };
  const next = () => {
    if (paused) return;
    if (i >= steps.length) return finish();
    const step = steps[i++];
    if (step.kind !== "noop") applyStep(stage, step);
    const upcoming = steps[i];
    if (!upcoming) return finish();
    const dt = upcoming.fixed ? upcoming.dt : upcoming.dt / SPEEDS[speedIdx];
    timer = setTimeout(next, Math.min(dt, 10000)); // belt-and-braces: no multi-minute stall
  };
  playBtn.addEventListener("click", () => {
    paused = !paused;
    playBtn.textContent = paused ? "▶" : "⏸";
    playBtn.setAttribute("aria-label", paused ? "Play" : "Pause");
    if (!paused) next();
    else clearTimeout(timer);
  });
  speedBtn.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    speedBtn.textContent = `${SPEEDS[speedIdx]}×`;
  });
  skipBtn.addEventListener("click", () => {
    clearTimeout(timer);
    while (i < steps.length && steps[i].kind !== "commit") applyStep(stage, steps[i++]);
    if (i < steps.length) applyStep(stage, steps[i++]); // land the commit itself
    if (!paused) next();
  });
  next();
  return { stop: () => { paused = true; clearTimeout(timer); stopSpeaking(); } }; // silence in-flight voice too
}
