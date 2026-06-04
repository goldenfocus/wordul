import { colorSchemeVars } from "/edition.js";
import {
  reflowDims, randomHarmony, classifyWord, serializeDraft, restoreDraft, defaultVibe,
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

// Sample colour pattern for the preview row: greens/yellows/grays, deterministic by length.
function sampleClass(i) {
  const pat = ["green", "gray", "yellow", "green", "gray", "yellow"];
  return pat[i % pat.length];
}

function renderBoard() {
  const board = $("previewBoard");
  board.style.setProperty("--cols", vibe.len);
  const letters = (vibe.word || "").padEnd(vibe.len).slice(0, vibe.len).split("");
  let html = "";
  for (let r = 0; r < vibe.rows; r++) {
    html += '<div class="preview-row">';
    for (let c = 0; c < vibe.len; c++) {
      // Only the first row shows the sample colouring + the word's letters.
      const cls = r === 0 ? " " + sampleClass(c) : "";
      const ch = r === 0 ? (letters[c] || "").trim() : "";
      html += `<div class="preview-tile${cls}">${ch}</div>`;
    }
    html += "</div>";
  }
  board.innerHTML = html;
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
  $("lenInput").value = vibe.len;
  $("rowsInput").value = vibe.rows;
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
  // typing the word auto-sets length to match (still clamped, still editable)
  if (w.length >= 4) { vibe.len = reflowDims(w.length, vibe.rows).len; $("lenInput").value = vibe.len; }
  renderLabel();
  renderBoard();
  saveDraft();
  clearTimeout(badgeDebounce);
  badgeDebounce = setTimeout(renderBadge, 350);
});

$("lenInput").addEventListener("input", (e) => {
  vibe.len = reflowDims(e.target.value, vibe.rows).len;
  renderBoard(); saveDraft();
});
$("lenInput").addEventListener("blur", () => { $("lenInput").value = vibe.len; });

$("rowsInput").addEventListener("input", (e) => {
  vibe.rows = reflowDims(vibe.len, e.target.value).rows;
  renderBoard(); saveDraft();
});
$("rowsInput").addEventListener("blur", () => { $("rowsInput").value = vibe.rows; });

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
