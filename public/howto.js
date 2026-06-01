// Wordul — /how-to-play demo engine.
//
// Powers the live, auto-playing tile demos on the How to Play page. The scorer below is
// a faithful PORT of src/color.ts `scoreGuess` (same leftover-counter algorithm, same
// 'gray' spelling) so the demos color tiles by the EXACT rule the real game uses. The
// port is kept honest by test/howto-score.test.ts, which diffs it against the real
// scorer across many word pairs. If they ever drift, that test fails.
//
// DOM init is guarded so this module can be imported in a non-DOM (node/vitest) context
// to test `score` in isolation.

// --- The scorer: a direct port of src/color.ts scoreGuess. ---
// Returns one of "green" | "yellow" | "gray" per letter.
export function score(guess, answer) {
  const g = guess.toUpperCase();
  const a = answer.toUpperCase();
  const result = new Array(g.length).fill("gray");
  const leftover = {};
  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) result[i] = "green";
    else leftover[a[i]] = (leftover[a[i]] ?? 0) + 1;
  }
  for (let i = 0; i < g.length; i++) {
    if (result[i] === "green") continue;
    const c = g[i];
    if ((leftover[c] ?? 0) > 0) {
      result[i] = "yellow";
      leftover[c] -= 1;
    }
  }
  return result;
}

// --- Demo rendering (browser only). ---

const reducedMotion =
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const sleep = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? 0 : ms));

// Build an empty board (rows × answer.length) of .grid-row > .tile, reusing the real
// game's classes so it looks identical to a live board.
function buildBoard(mount, rows, cols) {
  mount.replaceChildren();
  const board = document.createElement("div");
  board.className = "player-board howto-board";
  for (let r = 0; r < rows; r++) {
    const row = document.createElement("div");
    row.className = "grid-row";
    for (let c = 0; c < cols; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    board.appendChild(row);
  }
  mount.appendChild(board);
  return board;
}

// Type a word into a row one letter at a time, then flip each tile to its scored color.
async function playRow(board, rowIndex, guess, answer) {
  const row = board.querySelectorAll(".grid-row")[rowIndex];
  const tiles = row.querySelectorAll(".tile");
  for (let i = 0; i < guess.length; i++) {
    tiles[i].textContent = guess[i].toUpperCase();
    tiles[i].classList.add("filled", "pop");
    await sleep(120);
    tiles[i].classList.remove("pop");
  }
  await sleep(360);
  const mask = score(guess, answer);
  for (let i = 0; i < guess.length; i++) {
    tiles[i].classList.remove("filled");
    tiles[i].classList.add(mask[i], "reveal");
    await sleep(180);
  }
  return mask;
}

function clearRow(board, rowIndex) {
  const tiles = board.querySelectorAll(".grid-row")[rowIndex].querySelectorAll(".tile");
  tiles.forEach((t) => {
    t.textContent = "";
    t.className = "tile";
  });
}

// An auto-playing scripted run that loops forever (until the tab is hidden).
async function runScript(board, answer, guesses) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (let r = 0; r < guesses.length; r++) {
      if (document.hidden) { await sleep(600); r--; continue; }
      await playRow(board, r, guesses[r], answer);
      await sleep(500);
    }
    await sleep(2400);
    for (let r = 0; r < guesses.length; r++) clearRow(board, r);
    await sleep(400);
  }
}

// A single static legend tile that flips on tap/hover so it feels alive + explorable.
function wireTappable(root) {
  root.querySelectorAll("[data-flip]").forEach((tile) => {
    const states = ["green", "yellow", "gray"];
    let i = states.indexOf(tile.dataset.flip);
    if (i < 0) i = 0;
    const apply = () => {
      tile.classList.remove("green", "yellow", "gray");
      tile.classList.add(states[i], "reveal");
    };
    apply();
    tile.setAttribute("role", "button");
    tile.setAttribute("tabindex", "0");
    tile.title = "Tap to flip";
    const next = () => { i = (i + 1) % states.length; apply(); };
    tile.addEventListener("click", next);
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); }
    });
  });
}

function init() {
  wireTappable(document);

  // Each [data-demo] mount carries its answer + a |-separated guess script.
  document.querySelectorAll("[data-demo]").forEach((mount) => {
    const answer = (mount.dataset.answer || "").toUpperCase();
    const guesses = (mount.dataset.guesses || "").split("|").filter(Boolean);
    if (!answer || guesses.length === 0) return;
    buildBoard(mount, guesses.length, answer.length);
    runScript(mount.querySelector(".howto-board"), answer, guesses);
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
