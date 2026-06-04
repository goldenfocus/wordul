import { colorSchemeVars } from "/edition.js";
import {
  reflowDims, randomHarmony, classifyWord, serializeDraft, restoreDraft, defaultVibe,
  previewCols,
} from "/vibe-studio-core.js";

const DRAFT_KEY = "wordul.vibeStudio.draft";
const $ = (id) => document.getElementById(id);

// Live dictionary lookup for the soft badge — same CORS-friendly, key-less API
// app.js already uses for definitions. Injected into the pure classifyWord.
async function dictLookup(word) {
  const res = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`
  );
  return res.ok; // 200 → real word; 404 → not found
}

let vibe = restoreDraft(localStorage.getItem(DRAFT_KEY) || serializeDraft(defaultVibe()));

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, serializeDraft(vibe));
}

// Apply the palette through the LOCKED Increment-2 contract (a1→--accent + atoms).
function applyPalette() {
  const vars = colorSchemeVars(vibe.colorScheme); // { --accent, --a1, --a2, --a3 }
  if (!vars) return;
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
}

// Sample colour pattern for the preview row: greens/yellows/grays, deterministic by position.
function sampleClass(i) {
  const pat = ["green", "gray", "yellow", "green", "gray", "yellow"];
  return pat[i % pat.length];
}

function renderBoard() {
  const board = $("previewBoard");
  const cols = previewCols(vibe.word); // columns follow the typed word; no length control
  board.style.setProperty("--cols", cols);
  const letters = (vibe.word || "").padEnd(cols).slice(0, cols).split("");
  let html = "";
  for (let r = 0; r < vibe.rows; r++) {
    html += '<div class="preview-row">';
    for (let c = 0; c < cols; c++) {
      // Only the first row shows the sample colouring + the word's letters.
      const cls = r === 0 ? " " + sampleClass(c) : "";
      const ch = r === 0 ? (letters[c] || "").trim() : "";
      html += `<div class="preview-tile${cls}">${ch}</div>`;
    }
    html += "</div>";
  }
  board.innerHTML = html;
  $("rowsReadout").textContent = `${vibe.rows} guess${vibe.rows === 1 ? "" : "es"}`;
  $("rowsMinus").disabled = vibe.rows <= 3;
  $("rowsPlus").disabled = vibe.rows >= 10;
}

function renderLabel() {
  $("wordLabel").textContent = vibe.word ? vibe.word.split("").join(" ") : "";
}

let badgeToken = 0;
function renderBadge() {
  const el = $("wordBadge");
  const token = ++badgeToken; // ignore stale async results
  if (!vibe.word || vibe.word.length < 4) {
    el.className = "badge muted";
    el.textContent = vibe.word ? "keep typing (min 4)" : "";
    return;
  }
  el.className = "badge muted";
  el.textContent = "checking…";
  classifyWord(vibe.word, dictLookup).then((status) => {
    if (token !== badgeToken) return;
    if (status === "real") { el.className = "badge real"; el.textContent = "✓ real word"; }
    else if (status === "invented") { el.className = "badge invented"; el.textContent = "✨ invented — guess the curator's coinage"; }
    else { el.className = "badge muted"; el.textContent = ""; }
  });
}

function syncInputs() {
  $("studioTitle").value = vibe.vibeTitle;
  $("wordInput").value = vibe.word;
  $("storyInput").value = vibe.story;
  $("aiPromptInput").value = vibe.aiPrompt;
  $("sw1").value = vibe.colorScheme.a1;
  $("sw2").value = vibe.colorScheme.a2;
  $("sw3").value = vibe.colorScheme.a3;
}

function renderAll() {
  applyPalette();
  renderLabel();
  renderBoard();
  renderBadge();
  saveDraft();
}

// --- wiring ---
$("studioTitle").addEventListener("input", (e) => { vibe.vibeTitle = e.target.value; saveDraft(); });

let badgeDebounce;
$("wordInput").addEventListener("input", (e) => {
  const w = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 12);
  e.target.value = w;
  vibe.word = w;
  renderLabel();
  renderBoard();
  saveDraft();
  clearTimeout(badgeDebounce);
  badgeDebounce = setTimeout(renderBadge, 350);
});

// Guess rows live ON the matrix — spreadsheet-style +/− (3–10).
function nudgeRows(delta) {
  vibe.rows = reflowDims(5, vibe.rows + delta).rows;
  renderBoard();
  saveDraft();
}
$("rowsMinus").addEventListener("click", () => nudgeRows(-1));
$("rowsPlus").addEventListener("click", () => nudgeRows(1));

// Why-this-word: the story seed (becomes the published story + feeds the AI).
$("storyInput").addEventListener("input", (e) => { vibe.story = e.target.value; saveDraft(); });

// ✨ AI tune — instant rewrite of the "why this word" note via Workers AI.
// The curator's own words are preserved in `originalStory` so Respin always rewrites
// from the original (never compounding) and Revert can restore them.
let originalStory = null;

const TUNE_ERRORS = {
  ai_unavailable: "AI isn't wired up here yet — try it on the live site.",
  empty_story: "Write a few words first, then tap ✨.",
  no_output: "The model came back empty — tap Respin.",
  tune_failed: "Couldn't reach the AI — tap Respin.",
  network: "Network hiccup — tap Respin.",
};

function setTuning(on) {
  $("storyInput").parentElement.classList.toggle("tuning", on);
  $("aiSparkle").disabled = on;
  $("aiSparkle").classList.toggle("spin", on);
  $("aiRespin").disabled = on;
}

function tuneStatus(msg) { $("tuneStatus").textContent = msg || ""; }

async function tune() {
  const source = originalStory != null ? originalStory : ($("storyInput").value || "");
  if (!source.trim()) { tuneStatus(""); $("storyInput").focus(); return; }
  if (originalStory == null) originalStory = source; // capture the curator's words once
  $("aiTune").classList.add("open"); // reveal the prompt that's being used
  setTuning(true);
  tuneStatus("Tuning…");
  try {
    const res = await fetch("/vibe-studio/tune", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ story: source, prompt: vibe.aiPrompt }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.text) { tuneStatus(TUNE_ERRORS[data.error] || "Tune failed — tap Respin."); return; }
    $("storyInput").value = data.text;
    vibe.story = data.text;
    saveDraft();
    tuneStatus("");
  } catch {
    tuneStatus(TUNE_ERRORS.network);
  } finally {
    setTuning(false);
  }
}

$("aiSparkle").addEventListener("click", tune);
$("aiRespin").addEventListener("click", tune);
$("aiPromptInput").addEventListener("input", (e) => { vibe.aiPrompt = e.target.value; saveDraft(); });

// Save = accept the tuned text as the new baseline; collapse the panel.
$("aiSave").addEventListener("click", () => {
  originalStory = null;
  $("aiTune").classList.remove("open");
  tuneStatus("");
});

// Revert = restore the curator's own words (what they typed before the first ✨).
$("aiRevert").addEventListener("click", () => {
  if (originalStory != null) {
    $("storyInput").value = originalStory;
    vibe.story = originalStory;
    saveDraft();
  }
  originalStory = null;
  $("aiTune").classList.remove("open");
  tuneStatus("");
});

for (const [id, key] of [["sw1", "a1"], ["sw2", "a2"], ["sw3", "a3"]]) {
  $(id).addEventListener("input", (e) => { vibe.colorScheme[key] = e.target.value; applyPalette(); renderBoard(); saveDraft(); });
}

$("harmonyBtn").addEventListener("click", () => {
  // vary the hue each roll without Math.random determinism concerns in core
  const hue = Math.floor(Math.random() * 360);
  vibe.colorScheme = randomHarmony(hue);
  syncInputs();
  applyPalette(); renderBoard(); saveDraft();
});

// --- boot ---
syncInputs();
renderAll();
