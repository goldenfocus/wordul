// Wordul — /how-to-play demo engine.
//
// Powers the live, auto-playing tile demos on the How to Play page. The scorer below is
// a faithful PORT of src/color.ts `scoreGuess` (same leftover-counter algorithm, same
// 'cold' spelling) so the demos color tiles by the EXACT rule the real game uses. The
// port is kept honest by test/howto-score.test.ts, which diffs it against the real
// scorer across many word pairs. If they ever drift, that test fails.
//
// DOM init is guarded so this module can be imported in a non-DOM (node/vitest) context
// to test `score` in isolation.

// --- The scorer: a direct port of src/color.ts scoreGuess. ---
// Returns one of "hot" | "warm" | "cold" per letter.
export function score(guess, answer) {
  const g = guess.toUpperCase();
  const a = answer.toUpperCase();
  const result = new Array(g.length).fill("cold");
  const leftover = {};
  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) result[i] = "hot";
    else leftover[a[i]] = (leftover[a[i]] ?? 0) + 1;
  }
  for (let i = 0; i < g.length; i++) {
    if (result[i] === "hot") continue;
    const c = g[i];
    if ((leftover[c] ?? 0) > 0) {
      result[i] = "warm";
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

// A pool of short, winnable demo runs. Each ends on its answer; `vibe` is the cheeky
// one-liner shown on the end card. Lengths vary (4–7) to show off the 4–12 range, and
// the pool is shuffled so a lingering visitor keeps seeing fresh words.
const DEMO_WORDS = [
  { answer: "REACT",   guesses: ["SLATE", "TRACE", "REACT"],     vibe: "What you'll do when the gold starts raining. 🪙" },
  { answer: "MONEY",   guesses: ["ARISE", "NOTED", "MONEY"],     vibe: "The whole point — well, the gold version of it." },
  { answer: "GHOST",   guesses: ["STAIR", "HOIST", "GHOST"],     vibe: "What you become on the leaderboard if you stop worduling." },
  { answer: "CRANE",   guesses: ["SLOTH", "TRAIN", "CRANE"],     vibe: "Every worduler's trusty opening guess." },
  { answer: "PIXEL",   guesses: ["SPEND", "SPIEL", "PIXEL"],     vibe: "One tiny square of pure glory." },
  { answer: "GOLD",    guesses: ["DUSK", "COLD", "GOLD"],        vibe: "Literally the score. Yes, it's meta." },
  { answer: "WINNER",  guesses: ["DANGER", "DINNER", "WINNER"],  vibe: "Manifesting. Keep worduling." },
  { answer: "VICTORY", guesses: ["MYSTERY", "HISTORY", "VICTORY"], vibe: "Tastes like coins falling from the sky." },
];

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build an empty board (rows × cols) of .grid-row > .tile, reusing the real game's
// classes so it looks identical to a live board.
function buildBoard(mount, rows, cols) {
  mount.replaceChildren();
  const board = document.createElement("div");
  board.className = "player-board howto-board";
  board.style.setProperty("--cols", String(cols));
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
    await sleep(110);
    tiles[i].classList.remove("pop");
  }
  await sleep(340);
  const mask = score(guess, answer);
  for (let i = 0; i < guess.length; i++) {
    tiles[i].classList.remove("filled");
    tiles[i].classList.add(mask[i], "reveal");
    await sleep(170);
  }
  return mask;
}

// The end card: the solved word + a vibey one-liner + a real "look it up" link. This is
// the demo's version of what the real game shows after you finish a round.
function showEndCard(mount, entry) {
  const card = document.createElement("div");
  card.className = "howto-endcard";

  const word = document.createElement("div");
  word.className = "howto-endcard-word";
  word.textContent = entry.answer;

  const vibe = document.createElement("div");
  vibe.className = "howto-endcard-vibe";
  vibe.textContent = entry.vibe;

  const link = document.createElement("a");
  link.className = "howto-endcard-link link";
  link.href =
    "https://www.google.com/search?q=" +
    encodeURIComponent("define " + entry.answer.toLowerCase());
  link.target = "_blank";
  link.rel = "noopener";
  link.tabIndex = -1; // decorative, ever-changing — mouse-clickable, not a keyboard trap
  link.textContent = "Look it up ↗";

  card.append(word, vibe, link);
  mount.appendChild(card);
  return card;
}

// Auto-play loop: walk a shuffled queue of words forever. `withEnd` mounts pause on the
// end card; the rest just flow to the next word. Pauses while the tab is hidden.
async function cycle(mount, withEnd) {
  let queue = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (document.hidden) { await sleep(600); continue; }
    if (queue.length === 0) queue = shuffled(DEMO_WORDS);
    const entry = queue.shift();

    const board = buildBoard(mount, entry.guesses.length, entry.answer.length);
    for (let r = 0; r < entry.guesses.length; r++) {
      await playRow(board, r, entry.guesses[r], entry.answer);
      await sleep(420);
    }

    if (withEnd) {
      showEndCard(mount, entry);
      await sleep(4200);
    } else {
      await sleep(1800);
    }
    await sleep(350);
  }
}

// A single static legend tile that flips on tap/hover so it feels alive + explorable.
function wireTappable(root) {
  root.querySelectorAll("[data-flip]").forEach((tile) => {
    const states = ["hot", "warm", "cold"];
    let i = states.indexOf(tile.dataset.flip);
    if (i < 0) i = 0;
    const apply = () => {
      tile.classList.remove("hot", "warm", "cold");
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
  document.querySelectorAll("[data-demo]").forEach((mount) => {
    cycle(mount, mount.hasAttribute("data-end"));
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
